// src/ui/AdaptiveKiosk.tsx
//
// 적응 UI — 데모의 "after". Module C(/generate-ui)의 결과를 그린다.
//
// 두 가지 렌더 경로:
//   1) embed_url 이 있으면 → @ggui-ai/react 임베드(가능 시) 또는 단순 iframe(src=embed_url).
//   2) embed_url 이 비어 있으면(mock/폴백) → 내장 적응 렌더러로 동일 구조를 직접 그린다.
//      구조 고정(큰 카드 2~3 + 옵션 + 예/아니요), assist_level 로 글자·여백·음성안내만 강화.
//
// 사용자 액션은 orchestrator 에 위임한다(selectMenu / setOption / confirmOptions / placeOrder).

import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "@contracts/types";
import type { FlowState, Orchestrator } from "../flow/orchestrator";
import { USE_MOCK, menuAssetUrl } from "../api/client";
import { artFor, emojiFor, won } from "./emoji";

export interface AdaptiveKioskProps {
  flow: Orchestrator;
  state: FlowState;
}

export default function AdaptiveKiosk({ flow, state }: AdaptiveKioskProps) {
  const assist = state.analyze?.behavioral.assist_level ?? 0;
  const embedUrl = state.generated?.embed_url || "";

  // ── 진행/완료/오류 오버레이 ──────────────────────────────
  if (
    state.phase === "analyzing" ||
    state.phase === "matching" ||
    state.phase === "generating" ||
    state.phase === "recording"
  ) {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">{state.message}</div>
        {state.analyze && (
          <SignalStrip state={state} />
        )}
      </div>
    );
  }

  if (state.phase === "ordering") {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">Processing payment...</div>
        <p className="hint">Please wait a moment.</p>
      </div>
    );
  }

  if (state.phase === "done" && state.order) {
    return (
      <div className="overlay">
        <div className="done-check">Paid</div>
        <div className="big">Payment Complete!</div>
        <p className="hint">
          Order <b>{state.order.order_id}</b> · Total {won(state.order.total)}
        </p>
        <button className="btn-primary" onClick={() => flow.reset(true)}>
          Start Over
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div>
        <div className="error-box">{state.message}</div>
        <button className="btn-primary" onClick={() => flow.reset(true)}>
          Back to Standard Screen
        </button>
      </div>
    );
  }

  // ── adaptive 단계: embed_url 우선, 없으면 내장 렌더러 ──────
  if (state.phase === "adaptive") {
    return (
      <div className="adaptive" data-assist={assist}>
        <GenBanner state={state} />
        {state.analyze && <SignalStrip state={state} />}

        {embedUrl ? (
          <GGUIEmbedFrame url={embedUrl} />
        ) : (
          <BuiltInAdaptive flow={flow} state={state} />
        )}
      </div>
    );
  }

  // idle 등 — 안내만
  return (
    <div className="overlay">
      <div className="big">Ready for voice order</div>
      <p className="hint">{state.message}</p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// GGUI 임베드: @ggui-ai/react 가 있으면 사용, 없으면 iframe.
// ────────────────────────────────────────────────────────────
function GGUIEmbedFrame({ url }: { url: string }) {
  const [GGUIComp, setGGUIComp] = useState<any>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    let alive = true;
    // optionalDependency — 미설치면 import 실패 → iframe 폴백.
    import("@ggui-ai/react")
      .then((m: any) => {
        if (!alive) return;
        const Comp = m.GGUIEmbed || m.default || null;
        setGGUIComp(() => Comp);
      })
      .catch(() => {})
      .finally(() => alive && setTried(true));
    return () => {
      alive = false;
    };
  }, [url]);

  if (GGUIComp) {
    // @ggui-ai/react 의 실제 prop 형태는 런타임에 위임. url/src 둘 다 넘긴다.
    return <GGUIComp url={url} src={url} embedUrl={url} />;
  }
  // 아직 시도 중이면 iframe 으로 먼저 보여줘도 무방
  void tried;
  return (
    <iframe
      className="embed-frame"
      src={url}
      title="GGUI adaptive UI"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}

// ────────────────────────────────────────────────────────────
// 내장 적응 렌더러 (mock/폴백) — 구조 고정, 내용/강도만 적응.
// ────────────────────────────────────────────────────────────
function BuiltInAdaptive({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
}) {
  if (state.step === "recommend") {
    return <RecommendStep flow={flow} state={state} />;
  }
  if (state.step === "options" && state.selectedItem) {
    return <OptionsStep flow={flow} state={state} item={state.selectedItem} />;
  }
  if (state.step === "confirm" && state.selectedItem) {
    return <ConfirmStep flow={flow} state={state} item={state.selectedItem} />;
  }
  return <p className="hint">Preparing your screen...</p>;
}

function RecommendStep({ flow, state }: { flow: Orchestrator; state: FlowState }) {
  const cands = state.candidates.slice(0, 3); // 큰 카드 2~3장
  return (
    <div>
      <div className="question">
        Which menu item would you like?
      </div>
      <div className="big-cards">
        {cands.map((it) => (
          <button
            key={it.id}
            className="big-card"
            onClick={() => flow.selectMenu(it)}
          >
            <img
              className="big-art"
              src={USE_MOCK ? artFor(it) : menuAssetUrl(it.image_url)}
              alt=""
              aria-hidden="true"
            />
            <div className="b-name">{it.name}</div>
            <div className="b-price">{won(it.price)}</div>
          </button>
        ))}
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function OptionsStep({
  flow,
  state,
  item,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
}) {
  const cur = useMemo(
    () => unitTotal(item, state.selectedOptions),
    [item, state.selectedOptions],
  );
  return (
    <div>
      <div className="question">
        {emojiFor(item)} {item.name} - Choose your options
      </div>

      {item.options.map((opt) => (
        <div className="option-group" key={opt.type}>
          <div className="o-label">{opt.type}</div>
          <div className="choices">
            {opt.choices.map((c) => (
              <button
                key={c.label}
                className={
                  "choice" +
                  (state.selectedOptions[opt.type] === c.label ? " selected" : "")
                }
                onClick={() => flow.setOption(opt.type, c.label)}
              >
                {c.label}
                {c.price_delta > 0 && <small>+{won(c.price_delta)}</small>}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="confirm-box">
        <div className="c-total">
          <span>Total</span>
          <span>{won(cur)}</span>
        </div>
      </div>

      <div className="yesno">
        <button className="btn-no" onClick={() => flow.reset(false)}>
          Choose Again
        </button>
        <button className="btn-yes" onClick={() => flow.confirmOptions()}>
          This Looks Good
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function ConfirmStep({
  flow,
  state,
  item,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
}) {
  const cur = unitTotal(item, state.selectedOptions);
  const optText = Object.entries(state.selectedOptions)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return (
    <div>
      <div className="question">Would you like to order this?</div>
      <div className="confirm-box">
        <div className="c-line">
          <span>
            {emojiFor(item)} {item.name}
          </span>
          <span>{won(item.price)}</span>
        </div>
        {optText && (
          <div className="c-line">
            <span>{optText}</span>
            <span>{won(cur - item.price)}</span>
          </div>
        )}
        <div className="c-total">
          <span>Total</span>
          <span>{won(cur)}</span>
        </div>
      </div>

      <div className="yesno">
        <button
          className="btn-no"
          onClick={() =>
            item.options.length ? flow.backToOptions() : flow.reset(false)
          }
        >
          No, Change It
        </button>
        <button className="btn-yes" onClick={() => flow.placeOrder()}>
          Yes, Pay
        </button>
      </div>
    </div>
  );
}

// 멀티턴(재발화) 막대
function MultiTurnBar({ flow }: { flow: Orchestrator }) {
  return (
    <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
      <button className="mic-btn secondary" onClick={() => flow.respeak()}>
        🎤 Speak Again
      </button>
      <button className="mic-btn secondary" onClick={() => flow.reset(true)}>
        Start Over
      </button>
    </div>
  );
}

// 분석 신호 표시(데모 핵심: 같은 말이라도 신호가 다르면 화면이 달라진다)
function SignalStrip({ state }: { state: FlowState }) {
  const a = state.analyze;
  if (!a) return null;
  return (
    <div className="signal-strip">
      <span className="sig">
        Transcript <b>"{a.transcript}"</b>
      </span>
      <span className="sig">
        Age Group <b>{a.age.group}</b>
      </span>
      <span className="sig">
        Speech Rate <b>{a.behavioral.speech_rate.toFixed(1)}</b> syllables/sec
      </span>
      <span className="sig">
        Assist Level <b>assist {a.behavioral.assist_level}</b>
      </span>
    </div>
  );
}

function GenBanner({ state }: { state: FlowState }) {
  const meta = state.generated?.contract;
  const mock = meta?._mock;
  return (
    <div className="gen-banner">
      * {mock ? "Built-in adaptive renderer (mock)" : "GGUI generated screen"} ·{" "}
      {state.step === "recommend"
        ? "Recommendation"
        : state.step === "options"
          ? "Options"
          : "Confirmation"}{" "}
      step · assist_level {state.analyze?.behavioral.assist_level ?? 0}
    </div>
  );
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
