// src/App.tsx
//
// Static ↔ Adaptive 토글 + 데모 진행 표시.
// 기본 화면 = StaticKiosk(평소 키오스크 = before/폴백).
// 마이크(음성 주문) 시작 시 → AdaptiveKiosk(GGUI 적응 UI = after)로 전환.
// A/C 오류 시 자동으로 StaticKiosk 폴백 유도(에러 화면 → "일반 화면으로").
//
// mock 모드(VITE_USE_MOCK)면 백엔드/키 없이 전체 흐름이 화면에서 돈다.

import { useEffect, useMemo, useState } from "react";
import StaticKiosk from "./ui/StaticKiosk";
import AdaptiveKiosk from "./ui/AdaptiveKiosk";
import { Orchestrator, type FlowState, initialFlowState } from "./flow/orchestrator";
import { USE_MOCK, apiConfig } from "./api/client";
import { isRecordingSupported } from "./audio/recorder";
import "./styles.css";

type Mode = "compare" | "static" | "adaptive";

const STEP_ORDER: { key: string; label: string }[] = [
  { key: "voice", label: "Voice Input" },
  { key: "analyze", label: "Analyze (A)" },
  { key: "menu", label: "Menu (B)" },
  { key: "generate", label: "Adaptive UI (C)" },
  { key: "order", label: "Payment (B)" },
  { key: "done", label: "Done" },
];

export default function App() {
  // orchestrator 는 앱 수명 동안 단일 인스턴스
  const flow = useMemo(() => new Orchestrator(), []);
  const [state, setState] = useState<FlowState>(initialFlowState());
  const [mode, setMode] = useState<Mode>("compare");
  const [variant, setVariant] = useState<"elder" | "youth">("elder");

  useEffect(() => flow.subscribe(setState), [flow]);

  // 음성 흐름이 진행되면 자동으로 adaptive 모드로 전환
  useEffect(() => {
    if (state.phase !== "idle" && mode === "static") setMode("compare");
  }, [mode, state.phase]);

  useEffect(() => {
    if (state.phase === "idle") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [state.phase, state.step]);

  function startVoice() {
    flow.setMockVariant(variant);
    setMode("compare");
    flow.startVoiceOrder();
  }

  const recording = state.phase === "recording";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>OBA Adaptive Kiosk</h1>
          <small>Before and after, on one demo screen</small>
        </div>

        <div className="header-actions">
          <span className={"badge " + (USE_MOCK ? "mock" : "live")}>
            {USE_MOCK ? "MOCK" : "LIVE"}
          </span>
          <div className="mode-toggle">
            <button
              className={mode === "compare" ? "active" : ""}
              onClick={() => setMode("compare")}
            >
              Compare
            </button>
            <button
              className={mode === "static" ? "active" : ""}
              onClick={() => setMode("static")}
            >
              Standard (Before)
            </button>
            <button
              className={mode === "adaptive" ? "active" : ""}
              onClick={() => setMode("adaptive")}
            >
              Adaptive (After)
            </button>
          </div>
        </div>
      </header>

      {/* 데모 진행 스텝퍼 */}
      <DemoStepper state={state} />

      <main className="content">
        {/* 마이크 바 — 어느 모드에서든 음성 주문 시작 가능 */}
        <div className="mic-bar">
          {!recording ? (
            <button className="mic-btn" onClick={startVoice}>
              🎤 Start Voice Order
            </button>
          ) : (
            <>
              <button
                className="mic-btn recording"
                onClick={() => flow.stopAndRun()}
              >
                ⏹ Stop Speaking
              </button>
              <button className="mic-btn secondary" onClick={() => flow.cancel()}>
                Cancel
              </button>
            </>
          )}
          <span className="mic-status">{state.message}</span>

          {/* mock 데모용 변형 토글: 같은 발화라도 신호가 달라 화면이 갈린다 */}
          {USE_MOCK && (
            <div className="variant">
              <button
                className={variant === "elder" ? "active" : ""}
                onClick={() => setVariant("elder")}
                title="sixties, slower speech -> assist_level 2"
              >
                Senior (Slow)
              </button>
              <button
                className={variant === "youth" ? "active" : ""}
                onClick={() => setVariant("youth")}
                title="twenties, faster speech -> assist_level 0"
              >
                Younger (Fast)
              </button>
            </div>
          )}
        </div>

        {!isRecordingSupported() && !USE_MOCK && (
          <p className="hint">
            This browser does not support microphone recording. The demo will
            continue with a sample utterance.
          </p>
        )}

        {/* 본문: 모드에 따라 일반/적응 */}
        <section className={"kiosk-stage " + mode}>
          {(mode === "compare" || mode === "static") && (
            <section className="demo-pane before-pane" aria-label="Standard kiosk before screen">
              <div className="pane-heading">
                <div>
                  <p>Standard / Before</p>
                  <h2>Dense fallback kiosk</h2>
                </div>
                <span>Fallback</span>
              </div>
              <StaticKiosk />
            </section>
          )}

          {(mode === "compare" || mode === "adaptive") && (
            <section className="demo-pane after-pane" aria-label="Adaptive kiosk after screen">
              <div className="pane-heading">
                <div>
                  <p>Adaptive / After</p>
                  <h2>Voice-driven assist UI</h2>
                </div>
                <span>GGUI</span>
              </div>
              <AdaptiveKiosk flow={flow} state={state} />
            </section>
          )}
        </section>
      </main>

      <footer className="contract-footer">
        A {apiConfig.ANALYZE_URL} · B {apiConfig.MENU_URL} · C{" "}
        {apiConfig.GGUI_URL} · Adaptation signal = behavioral assist_level, age is secondary
      </footer>
    </div>
  );
}

// ── 데모 진행 스텝퍼 ─────────────────────────────────────────
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
