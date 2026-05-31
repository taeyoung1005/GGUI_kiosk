import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleMenu } from "@contracts/mocks";
import { Orchestrator } from "./orchestrator";

vi.mock("../audio/tts", () => ({
  cancelSpeech: vi.fn(),
  speak: vi.fn(),
}));

vi.mock("../audio/realtime", () => ({
  isRealtimeSupported: () => false,
  RealtimeVoiceSession: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const mocks = await import("@contracts/mocks");
  return {
    USE_MOCK: false,
    analyze: vi.fn(async (_audio: Blob | null, opts: { transcript?: string } = {}) => ({
      transcript: opts.transcript ?? "라떼 한 잔 주세요",
      language: "ko",
      duration_ms: 0,
    })),
    getMenu: vi.fn(async () => mocks.sampleMenu),
    searchMenu: vi.fn(async () => mocks.sampleMenu.items.slice(0, 3)),
    generateUI: vi.fn(async () => ({
      render_id: "test-render",
      embed_url: "",
      contract: {},
    })),
    groundIntent: vi.fn(async () => null),
    createOrder: vi.fn(async () => ({
      order_id: "ord-test",
      total: 4500,
      status: "paid",
    })),
  };
});

describe("Orchestrator agent tools", () => {
  let flow: Orchestrator;

  beforeEach(() => {
    flow = new Orchestrator();
  });

  it("startConversation primes adaptive state with menu candidates", async () => {
    const items = await flow.startConversation({ startAgent: false });
    const state = flow.getState();
    expect(items.length).toBe(sampleMenu.items.length);
    expect(state.phase).toBe("adaptive");
    expect(state.step).toBe("recommend");
    expect(state.analyze?.language).toBe("ko");
    expect(state.candidates.length).toBeGreaterThan(0);
  });

  it("runAgentTool drives item selection, option selection, payment and order confirmation", async () => {
    await flow.startConversation({ startAgent: false });

    const selectResult = await flow.runAgentTool("select_item", { item_id: "caffe-latte-003" });
    expect(selectResult.ok).toBe(true);
    expect(flow.getState().step).toBe("options");

    const optionResult = await flow.runAgentTool("set_option", {
      option_type: "온도",
      choice_label: "뜨겁게",
    });
    expect(optionResult.ok).toBe(true);
    expect(flow.getState().orderState.selected_options["온도"]).toBe("뜨겁게");

    await flow.runAgentTool("set_fulfillment", { value: "Take Out" });
    await flow.runAgentTool("set_loyalty", { value: "none" });
    await flow.runAgentTool("set_payment", { value: "Credit Card" });
    const orderResult = await flow.runAgentTool("confirm_order", {});

    expect(orderResult).toMatchObject({ ok: true, order_id: "ord-test", total: 4500 });
    expect(flow.getState().phase).toBe("done");
  });
});
