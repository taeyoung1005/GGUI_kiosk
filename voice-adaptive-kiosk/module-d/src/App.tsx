// src/App.tsx
//
// kiosk ↔ voice 2-phase 전체 전환.
//   - phase === idle  → kiosk(일반 키오스크 = StaticKiosk, 폴백 겸용)
//   - 그 외(음성 주문 진행 중) → voice(GGUI 적응 UI = AdaptiveKiosk)
//
// StaticKiosk 안의 상시 음성 주문 버튼이 음성 흐름을 시작하면 voice phase 로 전환되고,
// 흐름이 끝나거나 취소되면(phase=idle) 다시 kiosk phase 로 복귀한다.
//
// mock 모드(VITE_USE_MOCK)면 고정 데이터로 전체 흐름이 화면에서 돈다.

import { useEffect, useMemo, useState } from "react";
import StaticKiosk from "./ui/StaticKiosk";
import AdaptiveKiosk from "./ui/AdaptiveKiosk";
import { Orchestrator, type FlowState, initialFlowState } from "./flow/orchestrator";
import "./styles.css";

type AppMode = "kiosk" | "voice";
const CONVERSATIONAL = import.meta.env.VITE_CONVERSATIONAL !== "false";

const STEP_ORDER: { key: string; label: string }[] = [
  { key: "voice", label: "음성 주문" },
  { key: "analyze", label: "듣는 중" },
  { key: "menu", label: "메뉴" },
  { key: "generate", label: "선택" },
  { key: "order", label: "결제" },
  { key: "done", label: "완료" },
];

export default function App() {
  // orchestrator 는 앱 수명 동안 단일 인스턴스
  const flow = useMemo(() => new Orchestrator(), []);
  const [state, setState] = useState<FlowState>(initialFlowState());

  useEffect(() => flow.subscribe(setState), [flow]);

  // dev 전용 e2e/스크린샷 테스트 훅 — orchestrator 를 노출(프로덕션 빌드에서는 제거됨).
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __giosk?: Orchestrator }).__giosk = flow;
  }, [flow]);

  // phase === idle 이면 kiosk, 그 외(음성 주문 진행 중)면 voice
  const mode: AppMode = state.phase === "idle" ? "kiosk" : "voice";

  useEffect(() => {
    if (state.phase === "idle") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [state.phase, state.step]);

  function startVoice() {
    if (CONVERSATIONAL) {
      void flow.startConversation();
    } else if (state.phase === "adaptive") {
      flow.respeak();
    } else {
      flow.startVoiceOrder();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Giosk</h1>
          <small>말하면 나에게 맞는 화면이 뜨는 음성 키오스크</small>
        </div>
      </header>

      {/* 음성 주문 진행 스텝퍼(voice phase 에서만 표시) */}
      {mode === "voice" && <DemoStepper state={state} />}

      <main className="content">
        <section className={"kiosk-stage " + mode}>
          {mode === "kiosk" ? (
            <section className="standard-showcase" aria-label="일반 키오스크 화면">
              <div className="kiosk-frame standard-frame">
                <StaticKiosk onStartVoice={startVoice} />
              </div>
            </section>
          ) : (
            <section className="standard-showcase" aria-label="음성 주문 적응 화면">
              <div className="kiosk-frame adaptive-frame">
                <AdaptiveKiosk flow={flow} state={state} />
              </div>
            </section>
          )}
        </section>
      </main>

      <footer className="contract-footer">
        결제 전에 주문 내용을 확인해 주세요.
      </footer>
    </div>
  );
}

// ── 음성 주문 진행 스텝퍼 ─────────────────────────────────────
function DemoStepper({ state }: { state: FlowState }) {
  const activeKey = phaseToStep(state.phase);
  const activeIdx = STEP_ORDER.findIndex((s) => s.key === activeKey);

  return (
    <div className="stepper">
      {STEP_ORDER.map((s, i) => {
        const cls =
          i < activeIdx ? "chip done" : i === activeIdx ? "chip active" : "chip";
        return (
          <span className={cls} key={s.key}>
            {i + 1}. {s.label}
          </span>
        );
      })}
    </div>
  );
}

function phaseToStep(phase: FlowState["phase"]): string {
  switch (phase) {
    case "recording":
      return "voice";
    case "analyzing":
      return "analyze";
    case "matching":
      return "menu";
    case "generating":
      return "generate";
    case "adaptive":
      return "generate";
    case "ordering":
      return "order";
    case "done":
      return "done";
    default:
      return "voice";
  }
}
