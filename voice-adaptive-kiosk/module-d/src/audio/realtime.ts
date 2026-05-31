// src/audio/realtime.ts
//
// OpenAI Realtime 음성 STT 세션(브라우저 WebRTC).
//
// 흐름:
//   1) 백엔드(Module A) /realtime/session 에서 ephemeral client_secret 발급
//   2) 브라우저가 그 토큰으로 OpenAI Realtime 에 직접 WebRTC 연결
//      (마이크 트랙 추가 + 이벤트용 data channel)
//   3) server VAD 가 2초 침묵을 감지하면 turn 을 자동 종료
//   4) conversation.item.input_audio_transcription.completed 이벤트에서
//      최종 한국어 transcript 를 onTranscript 콜백으로 돌려준다
//   5) 정지 버튼은 input_audio_buffer.commit 으로 즉시 turn 을 닫는 보조 수단
//
// 표준 OpenAI API 키는 절대 브라우저에 노출하지 않는다(백엔드가 임시 토큰만 발급).

import { createRealtimeSession } from "../api/client";

const OPENAI_REALTIME_BASE = "https://api.openai.com/v1/realtime";

export interface RealtimeSessionCallbacks {
  /** 최종 한국어 transcript 가 확정됐을 때(VAD 자동종료 또는 수동 commit) */
  onTranscript: (transcript: string) => void;
  /** 연결 실패·끊김 등 오류(한국어 메시지) */
  onError?: (message: string) => void;
  /** 마이크 입력으로 발화가 감지되기 시작했을 때(UI 상태 표시용, 선택) */
  onSpeechStarted?: () => void;
  /** WebRTC 연결이 열려 듣기 시작했을 때(선택) */
  onOpen?: () => void;
}

/**
 * 단일 음성 입력 턴을 위한 Realtime WebRTC 세션.
 * start() → 사용자가 말함 → 2초 침묵(server VAD) → onTranscript → close().
 */
export class RealtimeVoiceSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private cbs: RealtimeSessionCallbacks;
  private closed = false;
  private delivered = false;

  constructor(cbs: RealtimeSessionCallbacks) {
    this.cbs = cbs;
  }

  /** 마이크 권한 요청 → 세션 발급 → WebRTC 연결. 실패 시 한국어 오류로 폴백. */
  async start(): Promise<void> {
    if (!isRealtimeSupported()) {
      this.fail("이 브라우저에서는 음성 주문을 사용할 수 없습니다.");
      return;
    }
    try {
      const session = await createRealtimeSession();

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (this.closed) {
        this.teardownStream();
        return;
      }

      const pc = new RTCPeerConnection();
      this.pc = pc;

      // 마이크 트랙 송신
      for (const track of this.stream.getAudioTracks()) {
        pc.addTrack(track, this.stream);
      }
      // OpenAI 가 보내는 오디오는 STT 전용이라 재생하지 않지만, m-line 협상을 위해 수신 트랜시버를 둔다.
      pc.addTransceiver("audio", { direction: "recvonly" });

      // 이벤트 채널
      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.addEventListener("open", () => this.cbs.onOpen?.());
      dc.addEventListener("message", (ev) => this.handleEvent(ev.data));

      pc.addEventListener("connectionstatechange", () => {
        if (this.closed || this.delivered) return;
        const st = pc.connectionState;
        if (st === "failed" || st === "disconnected") {
          this.fail("음성 연결이 끊어졌습니다. 다시 시도해 주세요.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await this.exchangeSdp(session.client_secret, session.model, offer.sdp ?? "");
      if (this.closed) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err: any) {
      this.fail(err?.message ? `음성 주문을 시작하지 못했습니다: ${err.message}` : "음성 주문을 시작하지 못했습니다.");
    }
  }

  /**
   * 정지 버튼(보조): server VAD 자동종료를 기다리지 않고 즉시 현재 입력을 마감한다.
   * 입력 버퍼를 commit 하면 OpenAI 가 전사를 마무리하고 completed 이벤트를 보낸다.
   */
  stop(): void {
    if (this.closed || this.delivered) return;
    try {
      this.dc?.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch {
      // data channel 이 아직 열리지 않았거나 닫힌 경우 — VAD 자동종료에 맡긴다.
    }
  }

  /** 세션 종료 + 자원 정리. 더 이상 콜백을 부르지 않는다. */
  close(): void {
    this.closed = true;
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.teardownStream();
    this.dc = null;
    this.pc = null;
  }

  // ── 내부 ──────────────────────────────────────────────────

  private async exchangeSdp(clientSecret: string, model: string, offerSdp: string): Promise<string> {
    // GA Realtime WebRTC 핸드셰이크는 /v1/realtime/calls 로 SDP 를 POST 한다.
    // (구 베타의 /v1/realtime?model= 은 400 "Beta API no longer supported" 로 폐기됨)
    const url = `${OPENAI_REALTIME_BASE}/calls?model=${encodeURIComponent(model)}`;
    const res = await fetch(url, {
      method: "POST",
      body: offerSdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!res.ok) throw new Error(`OpenAI Realtime 핸드셰이크 실패: ${res.status}`);
    return res.text();
  }

  private handleEvent(raw: unknown): void {
    if (this.closed) return;
    if (typeof raw !== "string") return;
    let evt: any;
    try {
      evt = JSON.parse(raw);
    } catch {
      return;
    }

    if (evt?.type === "input_audio_buffer.speech_started") {
      this.cbs.onSpeechStarted?.();
      return;
    }

    if (evt?.type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(evt.transcript ?? "").trim();
      this.deliver(transcript);
      return;
    }

    if (evt?.type === "error") {
      const message = evt?.error?.message ? `음성 인식 오류: ${evt.error.message}` : "음성 인식 중 오류가 발생했습니다.";
      this.fail(message);
    }
  }

  private deliver(transcript: string): void {
    if (this.delivered || this.closed) return;
    this.delivered = true;
    this.cbs.onTranscript(transcript);
  }

  private fail(message: string): void {
    if (this.delivered || this.closed) return;
    this.delivered = true;
    this.cbs.onError?.(message);
    this.close();
  }

  private teardownStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/** 브라우저가 WebRTC + 마이크 캡처를 지원하는지. */
export function isRealtimeSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}
