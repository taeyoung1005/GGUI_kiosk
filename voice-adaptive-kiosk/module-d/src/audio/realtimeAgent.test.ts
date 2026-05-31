import { describe, expect, it, vi } from "vitest";
import { sampleMenu } from "@contracts/mocks";
import { createRealtimeSession } from "../api/client";
import { RealtimeAgent } from "./realtimeAgent";

vi.mock("../api/client", () => ({
  createRealtimeSession: vi.fn(),
}));

interface PrivateRealtimeAgent {
  dc: { send: ReturnType<typeof vi.fn> } | null;
  assistantBuf: string;
  configureSession: () => void;
  handleEvent: (raw: unknown) => Promise<void>;
}

function privateAgent(agent: RealtimeAgent): PrivateRealtimeAgent {
  return agent as unknown as PrivateRealtimeAgent;
}

describe("RealtimeAgent event handling", () => {
  it("waits for session.updated before requesting the first assistant greeting", async () => {
    const agent = new RealtimeAgent(sampleMenu, { onToolCall: vi.fn() });
    const send = vi.fn();
    const internals = privateAgent(agent);
    internals.dc = { send, readyState: "open" } as unknown as PrivateRealtimeAgent["dc"];

    internals.configureSession();

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ type: "session.update" });

    await internals.handleEvent(JSON.stringify({ type: "session.updated" }));

    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(send.mock.calls[1][0])).toEqual({ type: "response.create" });
  });

  it("cancels assistant speech and clears output audio when the customer barges in", async () => {
    const onAssistantText = vi.fn();
    const agent = new RealtimeAgent(sampleMenu, {
      onToolCall: vi.fn(),
      onAssistantText,
    });
    const send = vi.fn();
    const internals = privateAgent(agent);
    internals.dc = { send };

    await internals.handleEvent(JSON.stringify({
      type: "response.output_audio_transcript.delta",
      delta: "잠시만요",
    }));
    await internals.handleEvent(JSON.stringify({ type: "input_audio_buffer.speech_started" }));

    expect(send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      { type: "response.cancel" },
      { type: "output_audio_buffer.clear" },
    ]);
    expect(onAssistantText).toHaveBeenLastCalledWith("", true);
    expect(internals.assistantBuf).toBe("");
  });

  it("does not surface Realtime cancellation races as fatal voice errors", async () => {
    const onError = vi.fn();
    const agent = new RealtimeAgent(sampleMenu, {
      onToolCall: vi.fn(),
      onError,
    });
    const send = vi.fn();
    const internals = privateAgent(agent);
    internals.dc = { send };

    await internals.handleEvent(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await internals.handleEvent(JSON.stringify({
      type: "error",
      error: { message: "Cancellation failed: no active response found" },
    }));

    expect(onError).not.toHaveBeenCalled();
  });

  it("can inject a text turn over the same Realtime data channel for dev diagnostics", () => {
    const agent = new RealtimeAgent(sampleMenu, { onToolCall: vi.fn() });
    const send = vi.fn();
    const internals = privateAgent(agent);
    internals.dc = { send, readyState: "open" } as unknown as PrivateRealtimeAgent["dc"];

    agent.submitTextTurn("따뜻한 카페라떼 주세요");

    expect(send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "따뜻한 카페라떼 주세요" }],
        },
      },
      { type: "response.create" },
    ]);
  });

  it("attaches the assistant audio element to the DOM and removes it on close", async () => {
    vi.mocked(createRealtimeSession).mockResolvedValue({
      client_secret: "ek_test",
      model: "gpt-realtime",
      expires_at: 123,
    });

    const appended: any[] = [];
    const audioEl = {
      autoplay: false,
      style: {} as Record<string, string>,
      setAttribute: vi.fn(),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      remove: vi.fn(),
      srcObject: null,
    };
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => audioEl),
      body: {
        appendChild: vi.fn((element: any) => {
          appended.push(element);
          return element;
        }),
      },
    });
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getAudioTracks: () => [{ kind: "audio" }],
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => "answer-sdp",
    })));
    vi.stubGlobal("RTCPeerConnection", class {
      connectionState = "connected";
      ontrack: ((event: { streams: unknown[] }) => void) | null = null;
      addTrack = vi.fn();
      createDataChannel = vi.fn(() => ({
        addEventListener: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      }));
      addEventListener = vi.fn();
      createOffer = vi.fn(async () => ({ sdp: "offer-sdp" }));
      setLocalDescription = vi.fn(async () => undefined);
      setRemoteDescription = vi.fn(async () => undefined);
      close = vi.fn();
    });

    const agent = new RealtimeAgent(sampleMenu, { onToolCall: vi.fn() });

    await agent.start();

    expect(document.body.appendChild).toHaveBeenCalledWith(audioEl);
    expect(appended).toContain(audioEl);
    expect(audioEl.autoplay).toBe(true);
    expect(audioEl.style.display).toBe("none");

    agent.close();

    expect(audioEl.remove).toHaveBeenCalled();
  });
});
