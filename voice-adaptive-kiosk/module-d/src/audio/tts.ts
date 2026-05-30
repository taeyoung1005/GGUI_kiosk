// src/audio/tts.ts
//
// window.speechSynthesis 기반 한국어 음성 안내(TTS).
// assist_level 이 높을수록 천천히/또박또박 안내하도록 rate 를 낮춘다.
//
// 사용:
//   speak("따뜻한 라떼로 주문할까요?", { assistLevel: 2 });
//   cancelSpeech();

export interface SpeakOptions {
  /** UI 적응 강도(0~3). 높을수록 느리게 읽는다. */
  assistLevel?: 0 | 1 | 2 | 3;
  /** 직접 지정 시 rate 우선(0.1~10). 생략 시 assistLevel 로 계산. */
  rate?: number;
  /** 음량(0~1) */
  volume?: number;
  /** 음높이(0~2) */
  pitch?: number;
  /** 끝난 뒤 콜백 */
  onEnd?: () => void;
}

export function isTTSSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

let enVoice: SpeechSynthesisVoice | null = null;
let voicesRequested = false;

/** English voice lookup, with a second pass when browsers populate voices late. */
function ensureEnglishVoice(): void {
  if (!isTTSSupported() || voicesRequested) return;
  voicesRequested = true;

  const pick = () => {
    const voices = window.speechSynthesis.getVoices();
    enVoice =
      voices.find((v) => v.lang?.toLowerCase().startsWith("en-us")) ??
      voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
      null;
  };
  pick();
  // voiceschanged 이벤트로 한 번 더 갱신
  window.speechSynthesis.onvoiceschanged = () => pick();
}

/** assist_level → 읽기 속도(rate). 높을수록 느림. */
function rateFor(assistLevel: number): number {
  switch (assistLevel) {
    case 3:
      return 0.78;
    case 2:
      return 0.85;
    case 1:
      return 0.95;
    default:
      return 1.0;
  }
}

/** 한국어 안내 발화. 진행 중인 발화는 끊고 새로 읽는다. */
export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!isTTSSupported() || !text?.trim()) {
    opts.onEnd?.();
    return;
  }
  ensureEnglishVoice();

  // 진행 중 발화 취소(멀티턴에서 안내 중첩 방지)
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (enVoice) u.voice = enVoice;
  u.rate = opts.rate ?? rateFor(opts.assistLevel ?? 0);
  u.volume = opts.volume ?? 1;
  u.pitch = opts.pitch ?? 1;
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
