import { createRealtimeSession } from "../api/client";
import { AGENT_TOOLS, buildAgentInstructions } from "../flow/agentTools";
import type { Menu } from "@contracts/types";

const OPENAI_REALTIME_BASE = "https://api.openai.com/v1/realtime";

export interface AgentCallbacks {
  /** 도구 호출 실행 -> 결과(JSON) 반환. */
  onToolCall: (name: string, args: Record<string, any>) => Promise<Record<string, any>>;
  /** 손님 발화 확정 자막 */
  onUserTranscript?: (text: string) => void;
  /** 비서 음성 자막. done=false 는 누적 delta, done=true 는 최종 문장. */
  onAssistantText?: (text: string, done: boolean) => void;
  onOpen?: () => void;
  onError?: (message: string) => void;
}

export class RealtimeAgent {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  private assistantBuf = "";

  constructor(
    private readonly menu: Menu,
    private readonly cbs: AgentCallbacks,
  ) {}

  async start(): Promise<void> {
    if (!isRealtimeAgentSupported()) {
      this.cbs.onError?.("이 브라우저에서는 대화형 음성 주문을 사용할 수 없습니다.");
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
        this.teardown();
        return;
      }

      const pc = new RTCPeerConnection();
      this.pc = pc;
      for (const track of this.stream.getAudioTracks()) {
        pc.addTrack(track, this.stream);
      }

      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      this.audioEl.setAttribute("aria-hidden", "true");
      this.audioEl.setAttribute("playsinline", "true");
      this.audioEl.style.display = "none";
      document.body.appendChild(this.audioEl);
      pc.ontrack = (event) => {
        if (!this.audioEl) return;
        this.audioEl.srcObject = event.streams[0];
        void this.audioEl.play().catch(() => {
          this.cbs.onError?.("브라우저가 비서 음성 자동재생을 막았습니다. 다시 한 번 눌러 주세요.");
        });
      };

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.addEventListener("open", () => {
        this.configureSession();
        this.cbs.onOpen?.();
      });
      dc.addEventListener("message", (event) => void this.handleEvent(event.data));

      pc.addEventListener("connectionstatechange", () => {
        if (this.closed) return;
        const state = pc.connectionState;
        if (state === "failed" || state === "disconnected") {
          this.cbs.onError?.("음성 연결이 끊어졌어요. 다시 시도해 주세요.");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await this.exchangeSdp(session.client_secret, session.model, offer.sdp ?? "");
      if (this.closed) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err: any) {
      this.cbs.onError?.(
        err?.message ? `대화를 시작하지 못했어요: ${err.message}` : "대화를 시작하지 못했어요.",
      );
      this.close();
    }
  }

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
    this.teardown();
    this.dc = null;
    this.pc = null;
  }

  private configureSession(): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: buildAgentInstructions(this.menu),
        tools: AGENT_TOOLS,
        tool_choice: "auto",
      },
    });
    this.send({ type: "response.create" });
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audioEl) {
      try {
        this.audioEl.pause();
        this.audioEl.srcObject = null;
        this.audioEl.remove();
      } catch {
        /* ignore */
      }
      this.audioEl = null;
    }
  }

  private send(obj: unknown): void {
    try {
      this.dc?.send(JSON.stringify(obj));
    } catch {
      /* data channel not open or already closed */
    }
  }

  private async exchangeSdp(clientSecret: string, model: string, offerSdp: string): Promise<string> {
    const url = `${OPENAI_REALTIME_BASE}/calls?model=${encodeURIComponent(model)}`;
    const res = await fetch(url, {
      method: "POST",
      body: offerSdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!res.ok) throw new Error(`Realtime 핸드셰이크 실패: ${res.status}`);
    return res.text();
  }

  private async handleEvent(raw: unknown): Promise<void> {
    if (this.closed || typeof raw !== "string") return;

    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    switch (event.type) {
      case "conversation.item.input_audio_transcription.completed":
        this.cbs.onUserTranscript?.(String(event.transcript ?? "").trim());
        break;
      case "response.output_audio_transcript.delta":
        this.assistantBuf += String(event.delta ?? "");
        this.cbs.onAssistantText?.(this.assistantBuf, false);
        break;
      case "response.output_audio_transcript.done":
        this.cbs.onAssistantText?.(String(event.transcript ?? this.assistantBuf), true);
        this.assistantBuf = "";
        break;
      case "response.function_call_arguments.done":
        await this.handleFunctionCall(String(event.name), String(event.call_id ?? ""), event.arguments);
        break;
      case "response.output_item.done":
        if (event.item?.type === "function_call") {
          await this.handleFunctionCall(
            String(event.item.name),
            String(event.item.call_id ?? ""),
            event.item.arguments,
          );
        }
        break;
      case "error":
        this.cbs.onError?.(
          event?.error?.message ? `음성 오류: ${event.error.message}` : "음성 처리 중 오류가 발생했어요.",
        );
        break;
      default:
        break;
    }
  }

  private async handleFunctionCall(
    name: string,
    callId: string,
    rawArguments: unknown,
  ): Promise<void> {
    let args: Record<string, any> = {};
    try {
      args = JSON.parse(String(rawArguments || "{}"));
    } catch {
      args = {};
    }

    let output: Record<string, any>;
    try {
      output = await this.cbs.onToolCall(name, args);
    } catch (err: any) {
      output = { ok: false, error: err?.message ?? "tool error" };
    }

    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });
    this.send({ type: "response.create" });
  }
}

export function isRealtimeAgentSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}
