// src/audio/tts.ts
//
// 음성 안내(TTS, 한국어). 기본은 OpenAI Realtime TTS(Module A /tts)이고,
// 키가 없거나(503) 실패하면 브라우저 SpeechSynthesis 로 폴백한다.
// 적응 강도는 항상 고령자 최대로 고정되므로, 안내는 일정한 안내 방송 톤으로 읽는다.
//
// 사용:
//   speak("이 중에서 골라 주세요.");
//   cancelSpeech();

import { apiConfig } from "../api/client";

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

// VITE_TTS_NARRATION 이 "false"/"0" 이 아니면 OpenAI Realtime TTS 안내를 먼저 시도.
const NARRATION_ENABLED =
  apiConfig &&
  !apiConfig.USE_MOCK &&
  import.meta.env.VITE_TTS_NARRATION !== "false" &&
  import.meta.env.VITE_TTS_NARRATION !== "0";

// 키 없음(503) 등으로 한 번 실패하면 이후엔 곧장 브라우저 TTS 로(불필요한 요청 방지).
let realtimeTtsUnavailable = false;
let currentAudio: HTMLAudioElement | null = null;

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
  if (NARRATION_ENABLED && !realtimeTtsUnavailable) {
    void speakWithOpenAITTS(text, opts).catch(() => speakWithBrowserTTS(text, opts));
  } else {
    speakWithBrowserTTS(text, opts);
  }
}

/** OpenAI Realtime TTS(Module A /tts → wav). 실패 시 throw → 호출부가 브라우저 폴백. */
async function speakWithOpenAITTS(text: string, opts: SpeakOptions): Promise<void> {
  const res = await fetch(`${apiConfig.ANALYZE_URL}/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (res.status === 503) {
    realtimeTtsUnavailable = true; // 키 없음 — 이후엔 곧장 브라우저 TTS
    throw new Error("tts unavailable");
  }
  if (!res.ok) throw new Error(`tts ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (currentAudio === audio) currentAudio = null;
    opts.onEnd?.();
  };
  // 재생 시작이 막히면(autoplay 등) reject → 호출부가 브라우저 폴백
  await audio.play();
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

/** 진행 중 안내 즉시 중단(OpenAI TTS 오디오 + 브라우저 TTS 모두). */
export function cancelSpeech(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (!isTTSSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
