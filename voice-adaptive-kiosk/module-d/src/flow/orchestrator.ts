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
  analyze,
  analyzeKoreanSeniorProxy,
  getMenu,
  searchMenu,
  generateUI,
  groundIntent,
  createOrder,
  USE_MOCK,
  proxyAnalyzeToAnalyzeResult,
  type KoreanProxyVoiceChoice,
  type KoreanSeniorProxyAnalyzeResult,
} from "../api/client";
import { MicRecorder, isRecordingSupported, type RecordedClip } from "../audio/recorder";
import { speak, cancelSpeech } from "../audio/tts";
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
  /** 한국어 주문 → 영어 senior proxy bridge 데모 trace */
  proxyTrace: KoreanSeniorProxyAnalyzeResult | null;
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
}

export function initialFlowState(): FlowState {
  return {
    phase: "idle",
    message: "Press the microphone and tell us your order.",
    analyze: null,
    proxyTrace: null,
    step: "recommend",
    candidates: [],
    selectedItem: null,
    selectedOptions: {},
    orderState: initialOrderState(),
    generated: null,
    order: null,
    error: null,
  };
}

type Listener = (s: FlowState) => void;

export class Orchestrator {
  private state: FlowState = initialFlowState();
  private listeners = new Set<Listener>();
  private recorder: MicRecorder | null = null;
  private recordingTurn: "initial" | "followup" = "initial";
  private menu: Menu | null = null;
  /** mock 데모에서 어르신/청년 변형을 토글하기 위한 힌트 */
  private mockVariant: "elder" | "youth" = "elder";
  private proxyVoice: KoreanProxyVoiceChoice = "voice-1";

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

  setMockVariant(v: "elder" | "youth") {
    this.mockVariant = v;
  }

  setProxyVoice(v: KoreanProxyVoiceChoice) {
    this.proxyVoice = v;
  }

  // ── 마이크 흐름 시작 ───────────────────────────────────────
  /**
   * 마이크 녹음 시작. mock 모드이거나 녹음 미지원이면 즉시 가짜 발화로 진행한다.
   * (데모 보장: 마이크 권한 없이도 흐름이 화면에서 돈다.)
   */
  async startVoiceOrder(): Promise<void> {
    cancelSpeech();
    this.reset(false);
    this.recordingTurn = "initial";
    if (!isRecordingSupported()) {
      this.set({
        phase: "recording",
        message: "Listening for your order...",
      });
      await wait(350);
      await this.runKoreanProxyPipeline(null);
      return;
    }

    try {
      this.recorder = new MicRecorder();
      await this.recorder.start();
      this.set({ phase: "recording", message: "Listening. Press stop when you are finished." });
    } catch {
      this.recorder = null;
      this.set({
        phase: "recording",
        message: "Listening for your order...",
      });
      await wait(350);
      await this.runKoreanProxyPipeline(null);
    }
  }

  /** 녹음 종료 후 파이프라인 실행. */
  async stopAndRun(): Promise<void> {
    const recordingTurn = this.recordingTurn;
    if (!this.recorder) {
      // 녹음 중이 아니면 mock 흐름
      this.recordingTurn = "initial";
      if (recordingTurn === "followup" || this.state.phase === "adaptive") await this.runVoiceTurn(null);
      else if (this.state.phase === "recording") await this.runKoreanProxyPipeline(null);
      else await this.runPipeline(null);
      return;
    }
    let clip: RecordedClip | null = null;
    try {
      clip = await this.recorder.stop();
    } catch {
      clip = null;
    } finally {
      this.recorder = null;
      this.recordingTurn = "initial";
    }
    if (recordingTurn === "followup") await this.runVoiceTurn(clip?.blob ?? null);
    else await this.runKoreanProxyPipeline(clip?.blob ?? null);
  }

  /** 마이크 흐름 취소 → idle 복귀(StaticKiosk). */
  cancel(): void {
    cancelSpeech();
    this.recorder?.cancel();
    this.recorder = null;
    this.recordingTurn = "initial";
    this.set({ ...initialFlowState() });
  }

  // ── 핵심 파이프라인: analyze → menu → generate-ui ─────────────
  private async runPipeline(audio: Blob | null): Promise<void> {
    try {
      // 1) A.analyze
      this.set({ phase: "analyzing", message: "Analyzing your voice..." });
      const result = await analyze(audio, { mockVariant: this.mockVariant });
      this.set({ analyze: result });

      // 2) B.menu(최초 1회 캐시) + 후보 검색
      this.set({ phase: "matching", message: "Finding matching menu items..." });
      if (!this.menu) this.menu = await getMenu();
      const candidates = await this.recommendCandidates(result.transcript);

      // 3) C.generate-ui (recommend 단계)
      await this.generateForStep("recommend", candidates, null, result);

      // 추천 단계 음성 안내(assist_level 반영)
      const lvl = result.behavioral.assist_level;
      this.announce(
        lvl >= 2
          ? `${result.transcript.toLowerCase().includes("latte") ? "Latte" : "Menu"} options are shown in larger text. Please choose one.`
          : "Please choose from the recommended menu items.",
        lvl,
      );
    } catch (e: any) {
      this.fail(e?.message ?? "Something went wrong while analyzing your voice.");
    }
  }

  private async runKoreanProxyPipeline(audio: Blob | null): Promise<void> {
    try {
      this.set({
        phase: "analyzing",
        message: audio ? "Understanding your order..." : "Preparing your order screen...",
      });

      let koreanText: string | undefined;
      if (audio) {
        const spoken = await analyze(audio, { mockVariant: this.mockVariant, forceLive: true });
        koreanText = spoken.transcript.trim() || undefined;
      }

      const proxy = await analyzeKoreanSeniorProxy(koreanText, this.proxyVoice);
      this.set({ proxyTrace: proxy });
      this.set({ phase: "analyzing", message: "Playing back your order..." });
      await playProxyAudioBase64(proxy.audio_base64);

      const result = proxyAnalyzeToAnalyzeResult(proxy);
      this.set({ analyze: result });

      this.set({ phase: "matching", message: "Finding menu items..." });
      if (!this.menu) this.menu = await getMenu();
      const candidates = await this.recommendCandidates(result.transcript);

      await this.generateForStep("recommend", candidates, null, result);
      this.announce(
        "Here are the best matches. Please choose one.",
        result.behavioral.assist_level,
      );
    } catch (e: any) {
      this.fail(e?.message ?? "Something went wrong while preparing your order.");
    }
  }

  private async runVoiceTurn(audio: Blob | null): Promise<void> {
    this.set({ phase: "analyzing", message: "Understanding your next request..." });
    const result = await analyze(audio, { mockVariant: this.mockVariant });
    await this.applyVoiceTranscript(result.transcript, result);
  }

  async submitVoiceTurn(transcript: string): Promise<void> {
    const result = this.state.analyze ?? await analyze(null, { mockVariant: this.mockVariant });
    await this.applyVoiceTranscript(transcript, { ...result, transcript });
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
      this.announce("Options updated. Dine in or take out?", this.assist());
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
    this.announce("I did not catch that. Please say one of the choices on screen, or tap a button.", this.assist());
  }

  /** 주어진 step 에 대해 C.generate-ui 를 호출하고 adaptive 단계로 전환. */
  private async generateForStep(
    step: AdaptiveStep,
    candidates: MenuItem[],
    selectedItem: MenuItem | null,
    result: AnalyzeResult,
  ): Promise<void> {
    this.set({ phase: "generating", message: "Building your adaptive screen..." });

    const menuContext: MenuItem[] = selectedItem ? [selectedItem] : candidates;
    const generated = await generateUI({
      transcript: result.transcript,
      age_group: result.age.group,
      assist_level: result.behavioral.assist_level,
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
          ? "Please choose a menu item."
          : step === "options"
            ? "Please choose your options."
            : step === "fulfillment"
              ? "Please choose dine in or take out."
              : step === "loyalty"
                ? "Please choose points or skip."
                : step === "payment"
                  ? "Please choose a payment method."
                  : "Please confirm your order.",
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
      this.announce(`${item.name}, ${wonForSpeech(item.price)}. Dine in or take out?`, this.assist());
      return;
    }
    // 옵션 기본값(첫 choice)으로 초기화
    const defaults: Record<string, string> = {};
    for (const opt of item.options) defaults[opt.type] = opt.choices[0]?.label ?? "";
    this.set({ selectedItem: item, selectedOptions: defaults, orderState: this.currentOrderState(item, defaults) });
    await this.generateForStep("options", this.state.candidates, item, this.state.analyze);
    this.announce(`${item.name} selected. Please choose your options.`, this.assist());
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
    this.announce(`${it.name}. Dine in or take out?`, this.assist());
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
    this.announce("Would you like to earn points or skip?", this.assist());
  }

  async setLoyalty(value: "scan" | "phone" | "none"): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    this.set({ orderState: { ...this.state.orderState, loyalty: value } });
    await this.generateForStep("payment", this.state.candidates, this.state.selectedItem, this.state.analyze);
    this.announce("Please choose a payment method.", this.assist());
  }

  async setPaymentMethod(value: "Credit Card" | "Gift Card" | "Kakao Pay" | "Naver Pay" | "Pay at Counter"): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    this.set({ orderState: { ...this.state.orderState, payment_method: value } });
    await this.generateForStep("confirm", this.state.candidates, this.state.selectedItem, this.state.analyze);
    this.announce("Please check the total. Say yes or tap pay to finish.", this.assist());
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
    this.set({ phase: "ordering", message: "Processing payment..." });
    this.announce("Processing your payment. Please wait a moment.", this.assist());

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
        message: `Payment complete. Order ${order.order_id}.`,
      });
      this.announce(
        `Payment complete. We will call you when your ${item.name} is ready. Thank you.`,
        this.assist(),
      );
    } catch (e: any) {
      this.fail(e?.message ?? "Something went wrong while processing payment.");
    }
  }

  /**
   * 멀티턴 재발화: 현재 컨텍스트를 유지한 채 다시 음성 입력을 받는다.
   * (예: 추천 화면에서 "따뜻한 거로?" 라고 다시 말함)
   */
  async respeak(): Promise<void> {
    cancelSpeech();
    if (USE_MOCK || !isRecordingSupported()) {
      this.set({
        phase: "recording",
        message: "(Demo) Listening for the next step...",
      });
      await wait(350);
      await this.applyVoiceTranscript(nextDemoUtteranceForStep(this.state.step), {
        ...(this.state.analyze ?? await analyze(null, { mockVariant: this.mockVariant })),
        transcript: nextDemoUtteranceForStep(this.state.step),
      });
      return;
    }
    try {
      this.recorder = new MicRecorder();
      this.recordingTurn = "followup";
      await this.recorder.start();
      this.set({ phase: "recording", message: "Listening for the next step. Press stop when finished." });
    } catch {
      this.recordingTurn = "initial";
      await this.runVoiceTurn(null);
    }
  }

  /** 처음으로(새 주문). */
  reset(toIdle = true): void {
    cancelSpeech();
    this.recorder?.cancel();
    this.recorder = null;
    this.recordingTurn = "initial";
    const base = initialFlowState();
    this.state = toIdle ? base : { ...base, phase: this.state.phase };
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
  private assist(): 0 | 1 | 2 | 3 {
    return this.state.analyze?.behavioral.assist_level ?? 0;
  }
  private announce(text: string, level: 0 | 1 | 2 | 3) {
    // assist_level 0(빠른 청년)은 음성안내를 생략해 압축 경험을 준다.
    if (level >= 1) speak(text, { assistLevel: level });
  }
  private fail(msg: string) {
    cancelSpeech();
    this.set({
      phase: "error",
      error: msg,
      message: `${msg} Continuing with the standard screen.`,
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

    const intentText = [
      transcript,
      this.state.proxyTrace?.korean_text,
      this.state.proxyTrace?.english_proxy_text,
    ]
      .filter(Boolean)
      .join(" ");
    return rankMenuCatalog(allItems, intentText).slice(0, 5);
  }

  private async tryGroundIntent(
    step: AdaptiveStep,
    transcript: string,
    candidates: MenuItem[],
    selectedItem: MenuItem | null,
  ): Promise<GroundIntentResponse | null> {
    if (!this.menu) this.menu = await getMenu();
    const useInitialProxy = step === "recommend";
    try {
      return await groundIntent({
        step,
        transcript,
        korean_text: useInitialProxy ? (this.state.proxyTrace?.korean_text ?? "") : "",
        english_proxy_text: useInitialProxy ? (this.state.proxyTrace?.english_proxy_text ?? "") : "",
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
      this.announce("Options updated. Dine in or take out?", this.assist());
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

async function playProxyAudioBase64(audioBase64: string): Promise<void> {
  if (!audioBase64 || typeof Audio === "undefined") return;
  try {
    const audio = new Audio(`data:audio/mpeg;base64,${audioBase64}`);
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      };
      const timeout = window.setTimeout(done, 12000);
      audio.onended = done;
      audio.onerror = done;
      audio.play().catch(done);
    });
  } catch {
    // Browser autoplay policy or mock-empty audio should not block the demo flow.
  }
}

function wonForSpeech(n: number): string {
  return `${n.toLocaleString("en-US")} Korean won`;
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

function nextDemoUtteranceForStep(step: AdaptiveStep): string {
  if (step === "recommend") return "vanilla latte";
  if (step === "options") return "iced large";
  if (step === "fulfillment") return "take out";
  if (step === "loyalty") return "skip points";
  if (step === "payment") return "credit card";
  return "yes";
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
