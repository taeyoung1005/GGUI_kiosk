// src/flow/orchestrator.ts
//
// 전체 흐름 오케스트레이션:
//   마이크 → A.analyze → B.menu/search → C.generate-ui → AdaptiveKiosk 렌더
//          → (옵션 확정) → B.orders → "결제 완료"
// 멀티턴(재발화)을 지원한다: step 이 recommend → options → confirm 으로 진행하고,
// 사용자가 다시 말하면 같은 cart 컨텍스트 위에서 새 analyze 를 돌린다.
//
// React 와 분리된 순수 상태기계 + 콜백. App/AdaptiveKiosk 가 onState 로 구독한다.

import type {
  AdaptiveOrderState,
  AdaptiveStep,
  AnalyzeResult,
  Menu,
  MenuItem,
  GenerateUIResponse,
  GroundIntentResponse,
  OrderLine,
  OrderResponse,
} from "@contracts/types";
import {
  USE_MOCK,
  analyze,
  getMenu,
  searchMenu,
  generateUI,
  groundIntent,
  createOrder,
} from "../api/client";
import { RealtimeAgent } from "../audio/realtimeAgent";
import { RealtimeVoiceSession, isRealtimeSupported } from "../audio/realtime";
import { speak, cancelSpeech } from "../audio/tts";
import { FULFILLMENT_VALUES, LOYALTY_VALUES, PAYMENT_VALUES } from "./agentTools";
import { interpretVoiceTurn } from "./voiceIntent";

// ── 흐름 단계 ───────────────────────────────────────────────
export type FlowPhase =
  | "idle" // 대기 (StaticKiosk 노출)
  | "recording" // 마이크 녹음 중
  | "analyzing" // A.analyze 진행
  | "matching" // B.menu/search 진행
  | "generating" // C.generate-ui 진행
  | "adaptive" // AdaptiveKiosk 렌더(추천/옵션/확인 단계)
  | "ordering" // B.orders 진행(결제 애니메이션)
  | "done" // 결제 완료
  | "error"; // 오류 → StaticKiosk 폴백

export interface FlowState {
  phase: FlowPhase;
  /** 진행 메시지(데모 표시용) */
  message: string;
  /** 마지막 분석 결과 */
  analyze: AnalyzeResult | null;
  /** 적응 단계 */
  step: AdaptiveStep;
  /** 추천 후보 */
  candidates: MenuItem[];
  /** 현재 선택된 아이템 */
  selectedItem: MenuItem | null;
  /** 선택된 옵션 맵 { 온도: HOT, ... } */
  selectedOptions: Record<string, string>;
  /** 매 턴 GGUI에 전달하는 주문 상태 */
  orderState: AdaptiveOrderState;
  /** C 의 적응 UI 응답(embed_url 또는 내장 렌더 컨텍스트) */
  generated: GenerateUIResponse | null;
  /** 주문 결과 */
  order: OrderResponse | null;
  /** 오류 메시지 */
  error: string | null;
  /** 대화형 에이전트가 들은 손님 최종 발화 */
  userTranscript: string;
  /** 대화형 에이전트의 응답 자막 */
  assistantText: string;
  /** Realtime function-calling agent 모드 여부 */
  conversational: boolean;
}

export function initialFlowState(): FlowState {
  return {
    phase: "idle",
    message: "마이크를 누르고 주문을 말씀해 주세요.",
    analyze: null,
    step: "recommend",
    candidates: [],
    selectedItem: null,
    selectedOptions: {},
    orderState: initialOrderState(),
    generated: null,
    order: null,
    error: null,
    userTranscript: "",
    assistantText: "",
    conversational: false,
  };
}

type Listener = (s: FlowState) => void;

export class Orchestrator {
  private state: FlowState = initialFlowState();
  private listeners = new Set<Listener>();
  /** 현재 진행 중인 Realtime 음성 세션(없으면 null) */
  private voice: RealtimeVoiceSession | null = null;
  /** 이번 음성 턴이 첫 발화인지(initial) 멀티턴 재발화인지(followup) */
  private voiceTurn: "initial" | "followup" = "initial";
  private menu: Menu | null = null;
  private agent: RealtimeAgent | null = null;
  private conversational = false;

  // ── 구독 ─────────────────────────────────────────────────
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  getState(): FlowState {
    return this.state;
  }
  private set(patch: Partial<FlowState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  // ── 음성 주문 시작(OpenAI Realtime) ─────────────────────────
  /**
   * 음성 주문 시작. 백엔드에서 ephemeral 세션을 받아 WebRTC로 OpenAI Realtime에
   * 연결하고, server VAD가 2초 침묵을 감지하면 자동으로 turn을 닫아 최종 한국어
   * transcript를 받는다. 연결 실패 시 한국어 오류로 폴백한다.
   * mock/미지원 환경에서는 데모 발화로 즉시 흐름을 진행한다.
   */
  async startVoiceOrder(): Promise<void> {
    cancelSpeech();
    this.conversational = false;
    this.reset(false);
    this.voiceTurn = "initial";
    await this.openVoiceSession();
  }

  /** 대화형 음성 주문 시작: 메뉴를 로드하고 에이전트가 운전할 추천 화면으로 진입한다. */
  async startConversation(opts: { startAgent?: boolean } = {}): Promise<MenuItem[]> {
    this.conversational = true;
    cancelSpeech();
    this.reset(false);
    this.conversational = true;
    if (!this.menu) this.menu = await getMenu();
    const result: AnalyzeResult = { transcript: "", language: "ko", duration_ms: 0 };
    const candidates = this.menu.items.slice(0, 8);
    this.set({
      analyze: result,
      candidates,
      phase: "adaptive",
      step: "recommend",
      message: "무엇을 도와드릴까요?",
      userTranscript: "",
      assistantText: "",
      conversational: true,
    });
    if (opts.startAgent !== false && !USE_MOCK) {
      this.agent = new RealtimeAgent(this.menu, {
        onToolCall: (name, args) => this.runAgentTool(name, args),
        onUserTranscript: (transcript) => this.set({ userTranscript: transcript }),
        onAssistantText: (text) => this.set({ assistantText: text }),
        onOpen: () => this.set({ message: "말씀해 주세요. 듣고 있어요." }),
        onError: (message) => this.fail(message),
      });
      await this.agent.start();
    }
    return this.menu.items;
  }

  endConversation(): void {
    this.agent?.close();
    this.agent = null;
    this.conversational = false;
    this.reset(true);
  }

  /**
   * 정지 버튼(보조): server VAD 자동종료를 기다리지 않고 즉시 입력을 마감한다.
   * mock/미지원 환경에서는 데모 발화로 진행한다.
   */
  async stopAndRun(): Promise<void> {
    if (this.voice) {
      this.set({ phase: "analyzing", message: "주문 내용을 확인하고 있어요..." });
      this.voice.stop();
      return;
    }
    // 세션이 없으면(미지원/mock) 데모 발화로 진행
    const turn = this.voiceTurn;
    this.voiceTurn = "initial";
    const transcript = turn === "followup" ? nextDemoUtteranceForStep(this.state.step) : DEMO_INITIAL_UTTERANCE;
    if (turn === "followup" || this.state.phase === "adaptive") {
      await this.handleTranscript(transcript);
    } else {
      await this.runInitialTurn(transcript);
    }
  }

  /** 음성 흐름 취소 → idle 복귀(StaticKiosk). */
  cancel(): void {
    cancelSpeech();
    this.agent?.close();
    this.agent = null;
    this.voice?.close();
    this.voice = null;
    this.conversational = false;
    this.voiceTurn = "initial";
    this.set({ ...initialFlowState() });
  }

  /** Realtime 세션을 열고 transcript 콜백을 상태기계에 연결. 실패 시 데모/오류 폴백. */
  private async openVoiceSession(): Promise<void> {
    const isFollowup = this.voiceTurn === "followup";
    if (!isRealtimeSupported()) {
      // 미지원 환경: 데모 발화로 흐름을 보여준다.
      this.set({ phase: "recording", message: "(데모) 주문을 듣고 있어요..." });
      await wait(350);
      const transcript = isFollowup ? nextDemoUtteranceForStep(this.state.step) : DEMO_INITIAL_UTTERANCE;
      this.voiceTurn = "initial";
      if (isFollowup) await this.handleTranscript(transcript);
      else await this.runInitialTurn(transcript);
      return;
    }

    const session = new RealtimeVoiceSession({
      onOpen: () => {
        this.set({ phase: "recording", message: "듣고 있어요. 주문을 말씀해 주세요." });
      },
      onSpeechStarted: () => {
        this.set({ message: "말씀을 듣고 있어요..." });
      },
      onTranscript: (transcript) => {
        void this.onVoiceTranscript(transcript, isFollowup);
      },
      onError: (message) => {
        this.voice = null;
        this.voiceTurn = "initial";
        this.fail(message);
      },
    });
    this.voice = session;
    this.set({ phase: "recording", message: "마이크를 준비하고 있어요..." });
    await session.start();
  }

  /** Realtime 최종 transcript 수신 → 세션 정리 후 상태기계로 전달. */
  private async onVoiceTranscript(transcript: string, isFollowup: boolean): Promise<void> {
    this.voice?.close();
    this.voice = null;
    this.voiceTurn = "initial";
    const text = transcript.trim();
    if (!text) {
      this.set({ message: "잘 들리지 않았어요. 다시 한 번 말씀해 주세요." });
      this.announce("잘 들리지 않았어요. 다시 한 번 말씀해 주세요.");
      return;
    }
    if (isFollowup || this.state.phase === "adaptive" || this.state.analyze) {
      await this.handleTranscript(text);
    } else {
      await this.runInitialTurn(text);
    }
  }

  /** 첫 발화 transcript → 메뉴 검색 → recommend 단계 GGUI 생성. */
  private async runInitialTurn(transcript: string): Promise<void> {
    try {
      this.set({ phase: "analyzing", message: "주문 내용을 이해하고 있어요..." });
      const result = await analyze(null, { transcript });
      this.set({ analyze: result });

      this.set({ phase: "matching", message: "메뉴를 찾고 있어요..." });
      if (!this.menu) this.menu = await getMenu();
      const candidates = await this.recommendCandidates(result.transcript);

      await this.generateForStep("recommend", candidates, null, result);
      this.announce("말씀하신 주문에 맞는 메뉴예요. 이 중에서 골라 주세요.");
    } catch (e: any) {
      this.fail(e?.message ?? "주문을 준비하는 중 문제가 발생했습니다.");
    }
  }

  /** 멀티턴 transcript → 의도 해석 후 상태기계에 적용. */
  private async handleTranscript(transcript: string): Promise<void> {
    this.set({ phase: "analyzing", message: "다음 요청을 이해하고 있어요..." });
    const result = await analyze(null, { transcript });
    await this.applyVoiceTranscript(transcript, result);
  }

  async submitVoiceTurn(transcript: string): Promise<void> {
    const result = this.state.analyze ?? await analyze(null, { transcript });
    await this.applyVoiceTranscript(transcript, { ...result, transcript });
  }

  /** Realtime function call을 기존 주문 상태기계 메서드로 실행한다. */
  async runAgentTool(name: string, args: Record<string, any>): Promise<Record<string, any>> {
    if (!this.menu) this.menu = await getMenu();
    const byId = new Map(this.menu.items.map((item) => [item.id, item]));

    switch (name) {
      case "select_item": {
        const item = byId.get(String(args.item_id));
        if (!item) {
          return {
            ok: false,
            error: "해당 item_id가 없습니다.",
            valid_ids: [...byId.keys()].slice(0, 20),
          };
        }
        await this.selectMenu(item);
        return {
          ok: true,
          name: item.name,
          price: item.price,
          options: item.options.map((option) => ({
            type: option.type,
            choices: option.choices.map((choice) => ({
              label: choice.label,
              price_delta: choice.price_delta,
            })),
          })),
          has_options: item.options.length > 0,
        };
      }
      case "set_option": {
        const item = this.state.selectedItem;
        if (!item) return { ok: false, error: "먼저 select_item이 필요합니다." };
        const option = item.options.find((candidate) => candidate.type === String(args.option_type));
        const choice = option?.choices.find((candidate) => candidate.label === String(args.choice_label));
        if (!option || !choice) {
          return {
            ok: false,
            error: "옵션 type/label이 메뉴와 일치하지 않습니다.",
            available: item.options.map((candidate) => ({
              type: candidate.type,
              choices: candidate.choices.map((candidateChoice) => candidateChoice.label),
            })),
          };
        }
        this.setOption(option.type, choice.label);
        return {
          ok: true,
          selected_options: this.state.selectedOptions,
          total: this.state.orderState.total,
        };
      }
      case "set_fulfillment": {
        const value = parseEnumValue(args.value, FULFILLMENT_VALUES, "Take Out");
        await this.setFulfillment(value);
        return { ok: true, fulfillment: value, total: this.state.orderState.total };
      }
      case "set_loyalty": {
        const value = parseEnumValue(args.value, LOYALTY_VALUES, "none");
        await this.setLoyalty(value);
        return { ok: true, loyalty: value };
      }
      case "set_payment": {
        const value = parseEnumValue(args.value, PAYMENT_VALUES, "Credit Card");
        await this.setPaymentMethod(value);
        return { ok: true, payment_method: value, total: this.state.orderState.total };
      }
      case "confirm_order": {
        await this.placeOrder();
        return {
          ok: true,
          order_id: this.state.order?.order_id ?? null,
          total: this.state.order?.total ?? this.state.orderState.total,
          status: this.state.order?.status ?? "paid",
        };
      }
      case "cancel_order": {
        this.reset(true);
        return { ok: true };
      }
      default:
        return { ok: false, error: `알 수 없는 도구: ${name}` };
    }
  }

  private async applyVoiceTranscript(transcript: string, result: AnalyzeResult): Promise<void> {
    if (!this.menu) this.menu = await getMenu();
    const freshCandidates =
      this.state.step === "recommend" || this.state.candidates.length === 0
        ? await this.recommendCandidates(transcript)
        : this.state.candidates;
    const candidates = freshCandidates.length ? freshCandidates : this.state.candidates;
    this.set({ analyze: result, candidates });
    const grounded = await this.tryGroundIntent(this.state.step, transcript, candidates, this.state.selectedItem);
    if (grounded && await this.applyGroundedIntent(grounded, candidates, result)) return;
    const intent = interpretVoiceTurn({
      step: this.state.step,
      transcript,
      candidates,
      selectedItem: this.state.selectedItem,
      orderState: this.state.orderState,
    });

    if (intent.type === "cancel") {
      this.reset(true);
      return;
    }
    if (intent.type === "change") {
      if (this.state.step === "confirm") await this.generateForStep("payment", candidates, this.state.selectedItem, result);
      else if (this.state.step === "payment") await this.generateForStep("loyalty", candidates, this.state.selectedItem, result);
      else if (this.state.step === "loyalty") await this.generateForStep("fulfillment", candidates, this.state.selectedItem, result);
      else if (this.state.step === "fulfillment") await this.generateForStep("options", candidates, this.state.selectedItem, result);
      else await this.backToRecommendations();
      return;
    }
    if (intent.type === "select_item") {
      await this.selectMenu(intent.item);
      return;
    }
    if (intent.type === "set_options") {
      this.setOptionsPatch(intent.options);
      await this.generateForStep("fulfillment", candidates, this.state.selectedItem, result);
      this.announce("옵션을 바꿨어요. 매장에서 드시나요, 포장하시나요?");
      return;
    }
    if (intent.type === "fulfillment") {
      await this.setFulfillment(intent.value);
      return;
    }
    if (intent.type === "loyalty") {
      await this.setLoyalty(intent.value);
      return;
    }
    if (intent.type === "payment") {
      await this.setPaymentMethod(intent.value);
      return;
    }
    if (intent.type === "confirm") {
      if (this.state.step === "options") await this.confirmOptions();
      else if (this.state.step === "confirm") await this.placeOrder();
      return;
    }

    await this.generateForStep(this.state.step, candidates, this.state.selectedItem, result);
    this.announce("잘 못 들었어요. 화면의 보기 중 하나를 말씀하시거나 버튼을 눌러 주세요.");
  }

  /** 주어진 step 에 대해 C.generate-ui 를 호출하고 adaptive 단계로 전환. */
  private async generateForStep(
    step: AdaptiveStep,
    candidates: MenuItem[],
    selectedItem: MenuItem | null,
    result: AnalyzeResult,
  ): Promise<void> {
    this.set({ phase: "generating", message: "화면을 준비하고 있어요..." });

    const menuContext: MenuItem[] = selectedItem ? [selectedItem] : candidates;
    const generated = await generateUI({
      transcript: result.transcript,
      menu_context: menuContext,
      order_state: this.currentOrderState(selectedItem),
      possible_actions: possibleActionsForStep(step),
      step,
    });

    this.set({
      phase: "adaptive",
      step,
      candidates,
      selectedItem,
      orderState: this.currentOrderState(selectedItem),
      generated,
      message:
        step === "recommend"
          ? "메뉴를 골라 주세요."
          : step === "options"
            ? "옵션을 골라 주세요."
            : step === "fulfillment"
              ? "매장에서 드시나요, 포장하시나요?"
              : step === "loyalty"
                ? "적립하시겠어요, 아니면 건너뛰시겠어요?"
                : step === "payment"
                  ? "결제 방법을 골라 주세요."
                  : "주문 내용을 확인해 주세요.",
    });
  }

  // ── AdaptiveKiosk 가 호출하는 사용자 액션 핸들러 ─────────────

  /** 추천 단계에서 메뉴 선택 → options 단계(옵션 없으면 confirm 으로 점프). */
  async selectMenu(item: MenuItem): Promise<void> {
    if (!this.state.analyze) return;
    cancelSpeech();
    if (!item.options || item.options.length === 0) {
      this.set({ selectedItem: item, selectedOptions: {}, orderState: this.currentOrderState(item, {}) });
      await this.generateForStep("fulfillment", this.state.candidates, item, this.state.analyze);
      this.announce(`${item.name}, ${wonForSpeech(item.price)}. 매장에서 드시나요, 포장하시나요?`);
      return;
    }
    // 옵션 기본값(첫 choice)으로 초기화
    const defaults: Record<string, string> = {};
    for (const opt of item.options) defaults[opt.type] = opt.choices[0]?.label ?? "";
    this.set({ selectedItem: item, selectedOptions: defaults, orderState: this.currentOrderState(item, defaults) });
    await this.generateForStep("options", this.state.candidates, item, this.state.analyze);
    this.announce(`${item.name}을(를) 골랐어요. 옵션을 골라 주세요.`);
  }

  /** 옵션 단계에서 한 옵션 선택값 변경. */
  setOption(type: string, label: string): void {
    this.setOptionsPatch({ [type]: label });
  }

  private setOptionsPatch(patch: Record<string, string>): void {
    const next = { ...this.state.selectedOptions, ...patch };
    this.set({ selectedOptions: next, orderState: this.currentOrderState(this.state.selectedItem, next) });
  }

  /** 옵션 확정 → confirm 단계. */
  async confirmOptions(): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    cancelSpeech();
    await this.generateForStep(
      "fulfillment",
      this.state.candidates,
      this.state.selectedItem,
      this.state.analyze,
    );
    const it = this.state.selectedItem;
    this.announce(`${it.name}. 매장에서 드시나요, 포장하시나요?`);
  }

  /** 옵션 단계로 되돌아가기(멀티턴/수정). */
  async backToOptions(): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    cancelSpeech();
    await this.generateForStep(
      this.state.selectedItem.options.length ? "options" : "recommend",
      this.state.candidates,
      this.state.selectedItem.options.length ? this.state.selectedItem : null,
      this.state.analyze,
    );
  }

  async setFulfillment(value: "Dine In" | "Take Out"): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    this.set({ orderState: { ...this.state.orderState, fulfillment: value } });
    await this.generateForStep("loyalty", this.state.candidates, this.state.selectedItem, this.state.analyze);
    this.announce("적립하시겠어요, 아니면 건너뛰시겠어요?");
  }

  async setLoyalty(value: "scan" | "phone" | "none"): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    this.set({ orderState: { ...this.state.orderState, loyalty: value } });
    await this.generateForStep("payment", this.state.candidates, this.state.selectedItem, this.state.analyze);
    this.announce("결제 방법을 골라 주세요.");
  }

  async setPaymentMethod(value: "Credit Card" | "Gift Card" | "Kakao Pay" | "Naver Pay" | "Pay at Counter"): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    this.set({ orderState: { ...this.state.orderState, payment_method: value } });
    await this.generateForStep("confirm", this.state.candidates, this.state.selectedItem, this.state.analyze);
    this.announce("합계를 확인해 주세요. \"네\"라고 말씀하시거나 결제 버튼을 눌러 주세요.");
  }

  /** 옵션 단계에서 메뉴 추천으로 되돌아가기. */
  async backToRecommendations(): Promise<void> {
    if (!this.state.analyze) return;
    cancelSpeech();
    this.set({ selectedItem: null, selectedOptions: {} });
    await this.generateForStep(
      "recommend",
      this.state.candidates,
      null,
      this.state.analyze,
    );
  }

  /** 확인 단계에서 결제 확정 → B.orders(mock). */
  async placeOrder(): Promise<void> {
    const item = this.state.selectedItem;
    if (!item) return;
    cancelSpeech();
    this.set({ phase: "ordering", message: "결제를 진행하고 있어요..." });
    this.announce("결제를 진행하고 있어요. 잠시만 기다려 주세요.");

    const line: OrderLine = {
      item_id: item.id,
      options: this.state.selectedOptions,
      qty: this.state.orderState.quantity,
    };
    try {
      const order = await createOrder({ items: [line] });
      this.set({
        phase: "done",
        order,
        message: `결제가 완료됐어요. 주문번호 ${order.order_id}.`,
      });
      this.announce(
        `결제가 완료됐어요. ${item.name} 준비되면 불러 드릴게요. 감사합니다.`,
      );
    } catch (e: any) {
      this.fail(e?.message ?? "결제를 진행하는 중 문제가 발생했습니다.");
    }
  }

  /**
   * 멀티턴 재발화: 현재 컨텍스트를 유지한 채 다시 음성 입력을 받는다.
   * (예: 추천 화면에서 "따뜻한 거로?" 라고 다시 말함)
   */
  async respeak(): Promise<void> {
    if (this.conversational) return;
    cancelSpeech();
    this.agent?.close();
    this.agent = null;
    this.voice?.close();
    this.voice = null;
    this.voiceTurn = "followup";
    await this.openVoiceSession();
  }

  /** 처음으로(새 주문). */
  reset(toIdle = true): void {
    cancelSpeech();
    this.agent?.close();
    this.agent = null;
    this.voice?.close();
    this.voice = null;
    this.voiceTurn = "initial";
    if (toIdle) this.conversational = false;
    const base = initialFlowState();
    this.state = toIdle
      ? base
      : { ...base, phase: this.state.phase, conversational: this.conversational };
    if (toIdle) this.listeners.forEach((l) => l(this.state));
  }

  private currentOrderState(
    selectedItem = this.state.selectedItem,
    selectedOptions = this.state.selectedOptions,
  ): AdaptiveOrderState {
    const quantity = this.state.orderState?.quantity ?? 1;
    const total = selectedItem ? unitTotal(selectedItem, selectedOptions) * quantity : 0;
    return {
      ...this.state.orderState,
      selected_item_id: selectedItem?.id ?? null,
      selected_item_name: selectedItem?.name ?? null,
      selected_options: selectedOptions,
      quantity,
      total,
    };
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────
  /** 한국어 음성 안내. 적응 강도는 항상 고령자 최대로 고정되므로 항상 읽어 준다. */
  private announce(text: string) {
    if (this.conversational) return;
    speak(text);
  }
  private fail(msg: string) {
    cancelSpeech();
    this.agent?.close();
    this.agent = null;
    this.voice?.close();
    this.voice = null;
    this.set({
      phase: "error",
      error: msg,
      message: `${msg} 일반 화면으로 계속 진행합니다.`,
    });
  }

  private async recommendCandidates(transcript: string): Promise<MenuItem[]> {
    const allItems = this.menu?.items ?? [];
    const grounded = await this.tryGroundIntent("recommend", transcript, allItems, null);
    const groundedItems = this.itemsFromGrounding(grounded);
    if (groundedItems.length) return groundedItems;

    try {
      const searched = await searchMenu(transcript);
      if (searched.length) return searched.slice(0, 5);
    } catch {
      // Grounding is allowed to fall back to deterministic local ranking.
    }

    return rankMenuCatalog(allItems, transcript).slice(0, 5);
  }

  private async tryGroundIntent(
    step: AdaptiveStep,
    transcript: string,
    candidates: MenuItem[],
    selectedItem: MenuItem | null,
  ): Promise<GroundIntentResponse | null> {
    if (!this.menu) this.menu = await getMenu();
    try {
      return await groundIntent({
        step,
        transcript,
        menu_context: step === "recommend" ? this.menu.items : (this.menu.items ?? candidates),
        selected_item: selectedItem,
        order_state: this.currentOrderState(selectedItem),
      });
    } catch {
      return null;
    }
  }

  private itemsFromGrounding(grounded: GroundIntentResponse | null): MenuItem[] {
    if (!grounded || grounded.needs_clarification || !this.menu) return [];
    const byId = new Map(this.menu.items.map((item) => [item.id, item]));
    return grounded.item_candidates
      .map((candidate) => byId.get(candidate.item_id))
      .filter((item): item is MenuItem => Boolean(item))
      .slice(0, 5);
  }

  private async applyGroundedIntent(
    grounded: GroundIntentResponse,
    candidates: MenuItem[],
    result: AnalyzeResult,
  ): Promise<boolean> {
    if (grounded.intent === "cancel") {
      this.reset(true);
      return true;
    }
    if (grounded.intent === "change") {
      await this.backForGroundedChange(result);
      return true;
    }
    if (this.state.step === "recommend") {
      const item = this.itemsFromGrounding(grounded)[0] ?? candidates[0] ?? null;
      if (!item) return false;
      await this.selectMenu(item);
      return true;
    }
    if (this.state.step === "options" && Object.keys(grounded.selected_options || {}).length > 0) {
      this.setOptionsPatch(grounded.selected_options);
      await this.generateForStep("fulfillment", candidates, this.state.selectedItem, result);
      this.announce("옵션을 바꿨어요. 매장에서 드시나요, 포장하시나요?");
      return true;
    }
    if (this.state.step === "fulfillment" && grounded.fulfillment) {
      await this.setFulfillment(grounded.fulfillment);
      return true;
    }
    if (this.state.step === "loyalty" && grounded.loyalty) {
      await this.setLoyalty(grounded.loyalty);
      return true;
    }
    if (this.state.step === "payment" && grounded.payment_method) {
      await this.setPaymentMethod(grounded.payment_method);
      return true;
    }
    if (this.state.step === "confirm" && grounded.confirm) {
      if (grounded.confirm === "yes") await this.placeOrder();
      else if (grounded.confirm === "change" || grounded.confirm === "no") await this.backToOptions();
      return true;
    }
    return false;
  }

  private async backForGroundedChange(result: AnalyzeResult): Promise<void> {
    if (this.state.step === "confirm") {
      await this.backToOptions();
    } else if (this.state.step === "payment") {
      await this.generateForStep("loyalty", this.state.candidates, this.state.selectedItem, result);
    } else if (this.state.step === "loyalty") {
      await this.generateForStep("fulfillment", this.state.candidates, this.state.selectedItem, result);
    } else if (this.state.step === "fulfillment") {
      await this.generateForStep("options", this.state.candidates, this.state.selectedItem, result);
    } else {
      await this.backToRecommendations();
    }
  }
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function wonForSpeech(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function initialOrderState(): AdaptiveOrderState {
  return {
    selected_item_id: null,
    selected_item_name: null,
    selected_options: {},
    quantity: 1,
    fulfillment: null,
    loyalty: null,
    payment_method: null,
    total: 0,
  };
}

function possibleActionsForStep(step: AdaptiveStep): string[] {
  if (step === "recommend") return ["select_item", "change", "cancel"];
  if (step === "options") return ["set_option", "confirm", "change", "cancel"];
  if (step === "fulfillment") return ["set_fulfillment", "change", "cancel"];
  if (step === "loyalty") return ["set_loyalty", "skip_loyalty", "change", "cancel"];
  if (step === "payment") return ["set_payment", "change", "cancel"];
  return ["confirm", "change", "cancel"];
}

function parseEnumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const candidate = String(value ?? "");
  return allowed.includes(candidate as T) ? (candidate as T) : fallback;
}

/** mock/미지원 환경에서 첫 음성 주문을 대신하는 데모 발화. */
const DEMO_INITIAL_UTTERANCE = "라떼 한 잔 주세요";

function nextDemoUtteranceForStep(step: AdaptiveStep): string {
  if (step === "recommend") return "바닐라 라떼";
  if (step === "options") return "아이스 크게";
  if (step === "fulfillment") return "포장";
  if (step === "loyalty") return "적립 안 할게요";
  if (step === "payment") return "카드";
  return "네";
}

function unitTotal(item: MenuItem, opts: Record<string, string>): number {
  let p = item.price;
  for (const [type, label] of Object.entries(opts)) {
    const opt = item.options.find((o) => o.type === type);
    const ch = opt?.choices.find((c) => c.label === label);
    if (ch) p += ch.price_delta;
  }
  return p;
}

const MENU_ALIASES: Record<string, string[]> = {
  "yuzu-tea-032": ["유자", "유자차", "yuzu", "yuza", "yuja", "citron"],
  "salt-bread-041": ["소금빵", "소금 빵", "salt bread", "saltbread"],
  "strawberry-shortcake-046": ["딸기", "딸기케이크", "딸기 케이크", "strawberry", "strawberry cake", "shortcake", "cake"],
};

function rankMenuCatalog(items: MenuItem[], query: string): MenuItem[] {
  const queryNorm = normForMenuRank(query);
  if (!queryNorm) return items;
  const tokens = String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !["would", "like", "please", "order", "하나", "주문", "줘", "해주세요"].includes(token));

  return items
    .map((item, index) => ({
      item,
      index,
      score: scoreMenuItem(item, queryNorm, tokens),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}

function scoreMenuItem(item: MenuItem, queryNorm: string, tokens: string[]): number {
  const haystack = normForMenuRank(`${item.id} ${item.name} ${item.category} ${item.desc || ""}`);
  let score = 0;
  for (const alias of MENU_ALIASES[item.id] || []) {
    const aliasNorm = normForMenuRank(alias);
    if (aliasNorm && queryNorm.includes(aliasNorm)) score += 100;
  }
  const nameNorm = normForMenuRank(item.name);
  if (nameNorm && queryNorm.includes(nameNorm)) score += 80;
  for (const token of tokens) {
    const tokenNorm = normForMenuRank(token);
    if (tokenNorm && haystack.includes(tokenNorm)) score += 8;
  }
  return score;
}

function normForMenuRank(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
