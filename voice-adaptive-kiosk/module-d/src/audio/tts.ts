// src/audio/tts.ts
//
// 음성 안내(TTS, 한국어). 대화형 기본 경로에서는 RealtimeAgent가 직접 말하므로
// 이 파일은 VITE_CONVERSATIONAL=false 단계형 폴백에서만 브라우저 TTS로 사용한다.
// 적응 강도는 항상 고령자 최대로 고정되므로, 안내는 일정한 안내 방송 톤으로 읽는다.
//
// 사용:
//   speak("이 중에서 골라 주세요.");
//   cancelSpeech();

export interface SpeakOptions {
  /** 읽기 속도(0.1~10). 브라우저 폴백에만 적용. */
  rate?: number;
  /** 음량(0~1) */
  volume?: number;
  /** 음높이(0~2). 브라우저 폴백에만 적용. */
  pitch?: number;
  /** 끝난 뒤 콜백 */
  onEnd?: () => void;
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let announcerVoice: SpeechSynthesisVoice | null = null;
let voicesRequested = false;

/** 한국어(ko-KR) 안내 음성을 고른다(브라우저 폴백용). */
function ensureAnnouncerVoice(): void {
  if (!isTTSSupported() || voicesRequested) return;
  voicesRequested = true;

  const pick = () => {
    const voices = window.speechSynthesis.getVoices();
    const korean = voices.filter((v) => v.lang?.toLowerCase().startsWith("ko"));
    const preferred = ["yuna", "google 한국의", "google korean", "microsoft heami", "microsoft sun-hi"];
    announcerVoice =
      korean.find((v) => preferred.some((name) => v.name.toLowerCase().includes(name))) ??
      korean.find((v) => v.lang?.toLowerCase().startsWith("ko-kr")) ??
      korean[0] ??
      null;
  };
  pick();
  window.speechSynthesis.onvoiceschanged = () => pick();
}

/** 한국어 안내 발화. 진행 중인 발화는 끊고 새로 읽는다. */
export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!text?.trim()) {
    opts.onEnd?.();
    return;
  }
  cancelSpeech();
  speakWithBrowserTTS(text, opts);
}

function speakWithBrowserTTS(text: string, opts: SpeakOptions = {}): void {
  if (!isTTSSupported()) {
    opts.onEnd?.();
    return;
  }
  ensureAnnouncerVoice();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  if (announcerVoice) u.voice = announcerVoice;
  u.rate = opts.rate ?? 1.0;
  u.volume = opts.volume ?? 1;
  u.pitch = opts.pitch ?? 1.05;
  if (opts.onEnd) u.onend = () => opts.onEnd?.();

  window.speechSynthesis.speak(u);
}

/** 진행 중 안내 즉시 중단. */
export function cancelSpeech(): void {
  if (!isTTSSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
