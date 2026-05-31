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
import StandardComparisonKiosk from "./ui/StandardComparisonKiosk";
import { Orchestrator, type FlowState, initialFlowState } from "./flow/orchestrator";
import { KOREAN_PROXY_VOICES, USE_MOCK, type KoreanProxyVoiceChoice } from "./api/client";
import { isRecordingSupported } from "./audio/recorder";
import "./styles.css";

type AppMode = "standard-only" | "adaptive-compare";

const STEP_ORDER: { key: string; label: string }[] = [
  { key: "voice", label: "Voice Order" },
  { key: "analyze", label: "Listening" },
  { key: "menu", label: "Menu" },
  { key: "generate", label: "Choose" },
  { key: "order", label: "Payment" },
  { key: "done", label: "Complete" },
];

export default function App() {
  // orchestrator 는 앱 수명 동안 단일 인스턴스
  const flow = useMemo(() => new Orchestrator(), []);
  const [state, setState] = useState<FlowState>(initialFlowState());
  const [mode, setMode] = useState<AppMode>("standard-only");
  const [playbackVoice, setPlaybackVoice] = useState<KoreanProxyVoiceChoice>("voice-1");

  useEffect(() => flow.subscribe(setState), [flow]);

  // 음성 흐름이 진행되면 자동으로 비교 모드로 전환
  useEffect(() => {
    if (state.phase !== "idle" && mode === "standard-only") setMode("adaptive-compare");
    if (state.phase === "idle" && mode !== "standard-only") setMode("standard-only");
  }, [mode, state.phase]);

  useEffect(() => {
    if (state.phase === "idle") return;
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [state.phase, state.step]);

  function startVoice() {
    flow.setMockVariant("elder");
    flow.setProxyVoice(playbackVoice);
    setMode("adaptive-compare");
    if (state.phase === "adaptive") {
      flow.respeak();
    } else {
      flow.startVoiceOrder();
    }
  }

  function choosePlaybackVoice(next: KoreanProxyVoiceChoice) {
    setPlaybackVoice(next);
    flow.setProxyVoice(next);
  }

  const recording = state.phase === "recording";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>OBA Cafe Kiosk</h1>
          <small>Voice-assisted ordering</small>
        </div>
      </header>

      {/* 데모 진행 스텝퍼 */}
      <DemoStepper state={state} />

      <main className="content">
        {/* 마이크 바 — 어느 모드에서든 음성 주문 시작 가능 */}
        <div className="mic-bar">
          {!recording ? (
            <button className="mic-btn" onClick={startVoice}>
              🎤 {state.phase === "adaptive" ? "Speak Next" : "Start Voice Order"}
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
          {!recording && (
            <div className="voice-selector" aria-label="Playback voice">
              {KOREAN_PROXY_VOICES.map((voice) => (
                <button
                  key={voice.id}
                  className={playbackVoice === voice.id ? "active" : ""}
                  type="button"
                  onClick={() => choosePlaybackVoice(voice.id)}
                >
                  {voice.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!isRecordingSupported() && !USE_MOCK && (
          <p className="hint">
            This browser does not support microphone recording. The demo will
            continue with a sample utterance.
          </p>
        )}

        <section className={"kiosk-stage " + mode}>
          {mode === "standard-only" && (
            <section className="standard-showcase" aria-label="Standard kiosk before screen">
              <div className="kiosk-frame standard-frame">
                <div className="pane-heading">
                  <div>
                    <p>Standard / Before</p>
                    <h2>Existing kiosk payment flow</h2>
                  </div>
                  <span>Original</span>
                </div>
                <StaticKiosk />
              </div>
            </section>
          )}

          {mode === "adaptive-compare" && (
            <section className="comparison-grid" aria-label="Standard and adaptive kiosk comparison">
              <section className="compare-pane standard" aria-label="Standard kiosk comparison pane">
                <div className="kiosk-frame standard-frame">
                  <div className="pane-heading">
                    <div>
                      <p>Standard / Same Step</p>
                      <h2>Original kiosk path</h2>
                    </div>
                    <span>Complex</span>
                  </div>
                  <StandardComparisonKiosk state={state} />
                </div>
              </section>

              <section className="compare-pane adaptive" aria-label="Adaptive kiosk after screen">
                <div className="kiosk-frame adaptive-frame">
                  <div className="pane-heading">
                    <div>
                      <p>Voice Order</p>
                      <h2>Easy order screen</h2>
                    </div>
                    <span>Assisted</span>
                  </div>
                  <AdaptiveKiosk flow={flow} state={state} />
                </div>
              </section>
            </section>
          )}
        </section>
      </main>

      <footer className="contract-footer">
        Please check your order before payment.
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
