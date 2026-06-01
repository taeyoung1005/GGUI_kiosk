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
  /** 손님 발화가 감지되기 시작했을 때. */
  onSpeechStarted?: () => void;
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
  private greeted = false;
  private responseActive = false;
  private pendingTextTurn: string | null = null;
  private handledFunctionCallIds = new Set<string>();
  private sessionReady = false;

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

  /** Dev/test helper: send a user text turn over the live Realtime data channel. */
  submitTextTurn(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || !this.dc || this.dc.readyState !== "open") return false;
    if (!this.sessionReady) {
      this.pendingTextTurn = trimmed;
      return true;
    }
    if (this.responseActive || this.assistantBuf) {
      this.pendingTextTurn = trimmed;
      this.send({ type: "response.cancel" });
      this.send({ type: "output_audio_buffer.clear" });
      this.assistantBuf = "";
      this.cbs.onAssistantText?.("", true);
      return true;
    }
    this.sendTextTurn(trimmed);
    return true;
  }

  private sendTextTurn(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.requestResponse();
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
      case "session.updated":
        this.sessionReady = true;
        this.cbs.onOpen?.();
        if (this.pendingTextTurn) {
          const pending = this.pendingTextTurn;
          this.pendingTextTurn = null;
          this.sendTextTurn(pending);
          break;
        }
        if (!this.greeted) {
          this.greeted = true;
          this.requestResponse();
        }
        break;
      case "response.created":
        this.responseActive = true;
        break;
      case "input_audio_buffer.speech_started":
        this.cbs.onSpeechStarted?.();
        if (this.responseActive || this.assistantBuf) {
          this.send({ type: "response.cancel" });
          this.send({ type: "output_audio_buffer.clear" });
        }
        this.assistantBuf = "";
        this.cbs.onAssistantText?.("", true);
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.cbs.onUserTranscript?.(String(event.transcript ?? "").trim());
        break;
      case "response.output_audio_transcript.delta":
        this.responseActive = true;
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
        if (isBenignRealtimeError(event?.error?.message)) break;
        this.cbs.onError?.(
          event?.error?.message ? `음성 오류: ${event.error.message}` : "음성 처리 중 오류가 발생했어요.",
        );
        break;
      case "response.done":
        this.responseActive = false;
        if (this.pendingTextTurn) {
          const pending = this.pendingTextTurn;
          this.pendingTextTurn = null;
          this.sendTextTurn(pending);
        }
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
    if (callId) {
      if (this.handledFunctionCallIds.has(callId)) return;
      this.handledFunctionCallIds.add(callId);
    }

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
    this.requestResponse();
  }

  private requestResponse(): void {
    this.responseActive = true;
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

function isBenignRealtimeError(message: unknown): boolean {
  return typeof message === "string" && message.includes("Cancellation failed: no active response found");
}
