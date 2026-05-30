// src/audio/recorder.ts
//
// MediaRecorder 기반 마이크 캡처. 16kHz mono 를 지향하되,
// 브라우저가 강제 샘플레이트를 무시할 수 있으므로 다운샘플 PCM(WAV) 변환도 제공한다.
// Module A(/analyze)는 16kHz mono wav 를 받으므로, 가능한 한 wav 로 보낸다.
//
// 사용:
//   const rec = new MicRecorder();
//   await rec.start();
//   ... 사용자가 말함 ...
//   const clip = await rec.stop();   // { blob, durationMs, mimeType }
//
// mock 모드(VITE_USE_MOCK)에서는 마이크 권한 없이도 흐름이 돌아야 하므로
// orchestrator 가 recorder 를 건너뛸 수 있게, 여기서는 순수 캡처만 담당한다.

export interface RecordedClip {
  /** 녹음된 오디오 Blob (wav 우선, 실패 시 원본 webm/ogg) */
  blob: Blob;
  /** 녹음 길이(ms) */
  durationMs: number;
  /** Blob MIME 타입 */
  mimeType: string;
  /** wav 로 변환 성공 여부 (false 면 원본 압축 포맷) */
  isWav: boolean;
}

const TARGET_SAMPLE_RATE = 16000;

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    "MediaRecorder" in window
  );
}

/** 사용 가능한 첫 audio MIME 타입을 고른다. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export class MicRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mimeType = "";

  /** 마이크 권한 요청 + 녹음 시작. */
  async start(): Promise<void> {
    if (!isRecordingSupported()) {
      throw new Error("This browser does not support microphone recording.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: TARGET_SAMPLE_RATE, // 힌트 — 브라우저가 무시할 수 있음
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    this.mimeType = pickMimeType();
    this.chunks = [];
    this.mediaRecorder = new MediaRecorder(
      this.stream,
      this.mimeType ? { mimeType: this.mimeType } : undefined,
    );
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.mediaRecorder.start();
    this.startedAt = performance.now();
  }

  /** 녹음 종료 → wav(16kHz mono) 변환 시도 후 클립 반환. */
  async stop(): Promise<RecordedClip> {
    const mr = this.mediaRecorder;
    if (!mr) throw new Error("Recording has not started.");

    const stopped = new Promise<void>((resolve) => {
      mr.onstop = () => resolve();
    });
    mr.stop();
    await stopped;

    const durationMs = Math.round(performance.now() - this.startedAt);
    this.teardownStream();

    const raw = new Blob(this.chunks, {
      type: this.mimeType || "audio/webm",
    });

    // wav(16kHz mono PCM) 변환 시도 — 실패하면 원본 그대로 보낸다.
    try {
      const wav = await blobToWav16k(raw);
      return { blob: wav, durationMs, mimeType: "audio/wav", isWav: true };
    } catch {
      return {
        blob: raw,
        durationMs,
        mimeType: raw.type || "audio/webm",
        isWav: false,
      };
    }
  }

  /** 녹음 중인지 여부. */
  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  /** 중단 + 트랙 정리(취소 시). */
  cancel(): void {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }
    } catch {
      /* ignore */
    }
    this.teardownStream();
    this.chunks = [];
  }

  private teardownStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// ────────────────────────────────────────────────────────────
// Blob(webm/ogg) → 16kHz mono WAV 변환 (WebAudio 디코드 + 다운샘플)
// ────────────────────────────────────────────────────────────

async function blobToWav16k(blob: Blob): Promise<Blob> {
  const AudioCtx: typeof AudioContext =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) throw new Error("AudioContext is not supported.");

  const arrayBuf = await blob.arrayBuffer();
  const ctx = new AudioCtx();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
    const mono = downmixToMono(decoded);
    const resampled = await resample(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    return encodeWavPCM16(resampled, TARGET_SAMPLE_RATE);
  } finally {
    await ctx.close().catch(() => {});
  }
}

function downmixToMono(buf: AudioBuffer): Float32Array {
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const len = buf.length;
  const out = new Float32Array(len);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] += data[i] / buf.numberOfChannels;
  }
  return out;
}

async function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  if (fromRate === toRate) return input;
  const OfflineCtx: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext ||
    (window as any).webkitOfflineAudioContext;

  const targetLength = Math.max(1, Math.round((input.length * toRate) / fromRate));

  if (OfflineCtx) {
    const offline = new OfflineCtx(1, targetLength, toRate);
    const srcBuf = offline.createBuffer(1, input.length, fromRate);
    srcBuf.getChannelData(0).set(input);
    const node = offline.createBufferSource();
    node.buffer = srcBuf;
    node.connect(offline.destination);
    node.start(0);
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  }

  // OfflineAudioContext 미지원 시 선형 보간 폴백
  const out = new Float32Array(targetLength);
  const ratio = input.length / targetLength;
  for (let i = 0; i < targetLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWavPCM16(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(off, s, true);
    off += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}
