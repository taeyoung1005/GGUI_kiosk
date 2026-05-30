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
  AnalyzeResult,
  Menu,
  MenuItem,
  GenerateUIResponse,
  OrderLine,
  OrderResponse,
} from "@contracts/types";
import {
  analyze,
  getMenu,
  searchMenu,
  generateUI,
  createOrder,
  USE_MOCK,
} from "../api/client";
import { MicRecorder, isRecordingSupported, type RecordedClip } from "../audio/recorder";
import { speak, cancelSpeech } from "../audio/tts";

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

export type AdaptiveStep = "recommend" | "options" | "confirm";

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
    step: "recommend",
    candidates: [],
    selectedItem: null,
    selectedOptions: {},
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
  private menu: Menu | null = null;
  /** mock 데모에서 어르신/청년 변형을 토글하기 위한 힌트 */
  private mockVariant: "elder" | "youth" = "elder";

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

  // ── 마이크 흐름 시작 ───────────────────────────────────────
  /**
   * 마이크 녹음 시작. mock 모드이거나 녹음 미지원이면 즉시 가짜 발화로 진행한다.
   * (데모 보장: 마이크 권한 없이도 흐름이 화면에서 돈다.)
   */
  async startVoiceOrder(): Promise<void> {
    cancelSpeech();
    this.reset(false);

    // mock 또는 녹음 미지원 → 녹음 단계를 건너뛰고 바로 파이프라인 실행
    if (USE_MOCK || !isRecordingSupported()) {
      this.set({
        phase: "recording",
        message: "(Demo) Recognizing your request...",
      });
      await wait(600);
      await this.runPipeline(null);
      return;
    }

    try {
      this.recorder = new MicRecorder();
      await this.recorder.start();
      this.set({ phase: "recording", message: "Listening. Press stop when you are finished." });
    } catch (e) {
      // 마이크 권한 거부 등 → mock 발화로 폴백(데모 끊김 방지)
      this.set({
        phase: "recording",
        message: "(Microphone unavailable - using a demo utterance)",
      });
      await wait(500);
      await this.runPipeline(null);
    }
  }

  /** 녹음 종료 후 파이프라인 실행. */
  async stopAndRun(): Promise<void> {
    if (!this.recorder) {
      // 녹음 중이 아니면 mock 흐름
      await this.runPipeline(null);
      return;
    }
    let clip: RecordedClip | null = null;
    try {
      clip = await this.recorder.stop();
    } catch {
      clip = null;
    } finally {
      this.recorder = null;
    }
    await this.runPipeline(clip?.blob ?? null);
  }

  /** 마이크 흐름 취소 → idle 복귀(StaticKiosk). */
  cancel(): void {
    cancelSpeech();
    this.recorder?.cancel();
    this.recorder = null;
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
      const candidates = await searchMenu(result.transcript);

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
      step,
    });

    this.set({
      phase: "adaptive",
      step,
      candidates,
      selectedItem,
      generated,
      message:
        step === "recommend"
          ? "Please choose a menu item."
          : step === "options"
            ? "Please choose your options."
            : "Please confirm your order.",
    });
  }

  // ── AdaptiveKiosk 가 호출하는 사용자 액션 핸들러 ─────────────

  /** 추천 단계에서 메뉴 선택 → options 단계(옵션 없으면 confirm 으로 점프). */
  async selectMenu(item: MenuItem): Promise<void> {
    if (!this.state.analyze) return;
    cancelSpeech();
    if (!item.options || item.options.length === 0) {
      this.set({ selectedItem: item, selectedOptions: {} });
      await this.generateForStep("confirm", this.state.candidates, item, this.state.analyze);
      this.announce(`${item.name}, ${wonForSpeech(item.price)}. Would you like to order this?`, this.assist());
      return;
    }
    // 옵션 기본값(첫 choice)으로 초기화
    const defaults: Record<string, string> = {};
    for (const opt of item.options) defaults[opt.type] = opt.choices[0]?.label ?? "";
    this.set({ selectedItem: item, selectedOptions: defaults });
    await this.generateForStep("options", this.state.candidates, item, this.state.analyze);
    this.announce(`${item.name} selected. Please choose your options.`, this.assist());
  }

  /** 옵션 단계에서 한 옵션 선택값 변경. */
  setOption(type: string, label: string): void {
    this.set({ selectedOptions: { ...this.state.selectedOptions, [type]: label } });
  }

  /** 옵션 확정 → confirm 단계. */
  async confirmOptions(): Promise<void> {
    if (!this.state.analyze || !this.state.selectedItem) return;
    cancelSpeech();
    await this.generateForStep(
      "confirm",
      this.state.candidates,
      this.state.selectedItem,
      this.state.analyze,
    );
    const it = this.state.selectedItem;
    this.announce(`${it.name}. Would you like to order this? Please answer yes or no.`, this.assist());
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
      qty: 1,
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
    await this.startVoiceOrder();
  }

  /** 처음으로(새 주문). */
  reset(toIdle = true): void {
    cancelSpeech();
    this.recorder?.cancel();
    this.recorder = null;
    const base = initialFlowState();
    this.state = toIdle ? base : { ...base, phase: this.state.phase };
    if (toIdle) this.listeners.forEach((l) => l(this.state));
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
}

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function wonForSpeech(n: number): string {
  return `${n.toLocaleString("en-US")} Korean won`;
}
