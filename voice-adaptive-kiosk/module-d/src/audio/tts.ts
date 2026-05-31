// src/audio/tts.ts
//
// ElevenLabs 기반 영어 음성 안내(TTS).
// UI 보조 강도와 음색은 분리한다. 시니어 모드여도 목소리는 자연스러운 안내 방송 톤이다.
// Module A가 서버에서 ElevenLabs mp3를 생성하고, 실패 시에만 browser speechSynthesis로 폴백한다.
//
// 사용:
//   speak("따뜻한 라떼로 주문할까요?", { assistLevel: 2 });
//   cancelSpeech();

import { apiConfig } from "../api/client";

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

let announcerVoice: SpeechSynthesisVoice | null = null;
let voicesRequested = false;
let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;
const ELEVENLABS_NARRATION_ENABLED =
  import.meta.env.VITE_ELEVENLABS_NARRATION === undefined
    ? true
    : import.meta.env.VITE_ELEVENLABS_NARRATION !== "false" &&
      import.meta.env.VITE_ELEVENLABS_NARRATION !== "0";

/** English announcer-like voice lookup, with a second pass when browsers populate voices late. */
function ensureAnnouncerVoice(): void {
  if (!isTTSSupported() || voicesRequested) return;
  voicesRequested = true;

  const pick = () => {
    const voices = window.speechSynthesis.getVoices();
    const english = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
    const preferred = [
      "samantha",
      "ava",
      "allison",
      "karen",
      "google us english",
      "microsoft aria",
      "microsoft jenny",
    ];
    announcerVoice =
      english.find((v) => preferred.some((name) => v.name.toLowerCase().includes(name))) ??
      english.find((v) => v.lang?.toLowerCase().startsWith("en-us")) ??
      english[0] ??
      null;
  };
  pick();
  // voiceschanged 이벤트로 한 번 더 갱신
  window.speechSynthesis.onvoiceschanged = () => pick();
}

/** assist_level → 읽기 속도(rate). 안내 방송처럼 일정하게 유지한다. */
function rateFor(assistLevel: number): number {
  void assistLevel;
  return 1.0;
}

/** 영어 안내 발화. 진행 중인 발화는 끊고 새로 읽는다. */
export function speak(text: string, opts: SpeakOptions = {}): void {
  if (!text?.trim()) {
    opts.onEnd?.();
    return;
  }

  cancelSpeech();

  if (ELEVENLABS_NARRATION_ENABLED) {
    void speakWithElevenLabs(text, opts).then((played) => {
      if (!played) speakWithBrowserTTS(text, opts);
    });
    return;
  }

  speakWithBrowserTTS(text, opts);
}

async function speakWithElevenLabs(text: string, opts: SpeakOptions): Promise<boolean> {
  try {
    const res = await fetch(`${apiConfig.ANALYZE_URL}/demo/announcer-voice/audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (!blob.size) return false;

    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;
    currentAudioUrl = url;
    audio.volume = opts.volume ?? 1;
    audio.onended = () => {
      cleanupAudio(audio, url);
      opts.onEnd?.();
    };
    audio.onerror = () => {
      cleanupAudio(audio, url);
    };
    try {
      await audio.play();
    } catch (error) {
      cleanupAudio(audio, url);
      throw error;
    }
    return true;
  } catch {
    return false;
  }
}

function speakWithBrowserTTS(text: string, opts: SpeakOptions = {}): void {
  if (!isTTSSupported()) {
    opts.onEnd?.();
    return;
  }
  ensureAnnouncerVoice();

  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (announcerVoice) u.voice = announcerVoice;
  u.rate = opts.rate ?? rateFor(opts.assistLevel ?? 0);
  u.volume = opts.volume ?? 1;
  u.pitch = opts.pitch ?? 1.05;
  if (opts.onEnd) u.onend = () => opts.onEnd?.();

  window.speechSynthesis.speak(u);
}

/** 진행 중 안내 즉시 중단. */
export function cancelSpeech(): void {
  if (currentAudio) {
    currentAudio.pause();
    cleanupAudio(currentAudio, currentAudioUrl);
  }
  currentAudio = null;
  currentAudioUrl = null;
  if (!isTTSSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function cleanupAudio(audio: HTMLAudioElement, url: string | null): void {
  if (currentAudio === audio) currentAudio = null;
  if (currentAudioUrl === url) currentAudioUrl = null;
  if (url) URL.revokeObjectURL(url);
}
