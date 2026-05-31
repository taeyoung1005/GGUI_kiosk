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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, PaymentMethod } from "@contracts/types";
import type { FlowState, Orchestrator } from "../flow/orchestrator";
import { USE_MOCK, consumeGguiEvents, menuAssetUrl } from "../api/client";
import { emojiFor, won } from "./emoji";
import { KIOSK_PROGRESS_STEPS } from "./kioskProgress";

export interface AdaptiveKioskProps {
  flow: Orchestrator;
  state: FlowState;
}

export default function AdaptiveKiosk({ flow, state }: AdaptiveKioskProps) {
  const assist = effectiveAssistLevel(state);
  const embedUrl = state.generated?.embed_url || "";
  const ggui = state.generated?.contract?._ggui;
  const gguiHtml = typeof ggui?.html === "string" ? ggui.html : "";
  const gguiMeta = ggui?.meta && typeof ggui.meta === "object" ? ggui.meta : null;
  const gguiRenderId =
    typeof gguiMeta?.["ai.ggui/render"]?.renderId === "string"
      ? gguiMeta["ai.ggui/render"].renderId
      : state.generated?.render_id || "";
  const [embedTimedOut, setEmbedTimedOut] = useState(false);

  useEffect(() => {
    setEmbedTimedOut(false);
    if (state.phase !== "adaptive" || (!embedUrl && !gguiHtml)) return;
    if (gguiHtml) return;
    const id = window.setTimeout(() => setEmbedTimedOut(true), 3500);
    return () => window.clearTimeout(id);
  }, [embedUrl, gguiHtml, state.phase, state.step]);

  const handleAction = useCallback(
    (action: string, data: any) => {
      void routeAdaptiveAction(flow, state, action, data);
    },
    [flow, state],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.source !== "ggui-local" || msg.type !== "action") return;
      const data = msg.data || {};
      handleAction(msg.action, data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [handleAction]);

  useEffect(() => {
    // Voice flow owns state transitions in this demo. Some generated GGUI apps can
    // emit queued/default events through consume(), so keep live GGUI as a renderer
    // unless a future contract explicitly enables remote action consumption.
    if (
      state.phase !== "adaptive" ||
      !gguiRenderId ||
      !gguiHtml ||
      state.generated?.contract?._enable_ggui_events !== true
    ) {
      return;
    }
    let cancelled = false;
    const seen = new Set<string>();
    const poll = async () => {
      while (!cancelled) {
        try {
          const out = await consumeGguiEvents(gguiRenderId, 15);
          if (cancelled) return;
          for (const event of out.events) {
            const key = event.actionId || `${event.intent}:${event.firedAt || ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (event.intent) handleAction(event.intent, event.actionData ?? {});
          }
        } catch {
          if (!cancelled) await wait(1000);
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [gguiHtml, gguiRenderId, handleAction, state.phase]);

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
    const useEmbed = Boolean((embedUrl || gguiHtml) && !embedTimedOut);
    return (
      <div className="adaptive" data-assist={assist}>
        {useEmbed ? (
          <GGUIEmbedFrame url={embedUrl} html={gguiHtml} meta={gguiMeta} />
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
function GGUIEmbedFrame({
  url,
  html,
  meta,
}: {
  url: string;
  html?: string;
  meta?: Record<string, any> | null;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useLayoutEffect(() => {
    if (!html || !meta) return;
    const onMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.jsonrpc !== "2.0" || data.method !== "ui/initialize") return;
      const source = event.source;
      if (source && "postMessage" in source) {
        source.postMessage(
          {
            jsonrpc: "2.0",
            id: data.id,
            result: {
              protocolVersion: "2026-01-26",
              hostInfo: { name: "oba-module-d", version: "0.1.0" },
              hostCapabilities: {},
              hostContext: {
                availableDisplayModes: ["inline"],
                currentDisplayMode: "inline",
              },
              toolOutput: { _meta: meta },
            },
          },
          "*",
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html, meta]);

  if (html) {
    return (
      <iframe
        ref={iframeRef}
        className="embed-frame"
        srcDoc={html}
        title="GGUI adaptive UI"
        sandbox="allow-scripts"
      />
    );
  }

  return (
    <iframe
      className="embed-frame"
      src={url}
      title="GGUI adaptive UI"
      sandbox="allow-scripts allow-same-origin allow-forms"
    />
  );
}

async function routeAdaptiveAction(
  flow: Orchestrator,
  state: FlowState,
  action: string,
  data: any,
) {
  if (action === "selectMenu") {
    const itemId = data?.item_id ?? data?.id ?? data?.itemId;
    const item = state.candidates.find((it) => it.id === itemId);
    if (item) await flow.selectMenu(item);
  } else if (action === "selectOption") {
    flow.setOption(String(data?.type || ""), String(data?.label || data?.value || ""));
  } else if (action === "setFulfillment") {
    await flow.setFulfillment(data?.value === "Dine In" ? "Dine In" : "Take Out");
  } else if (action === "setLoyalty") {
    const value = data?.value === "scan" || data?.value === "phone" ? data.value : "none";
    await flow.setLoyalty(value);
  } else if (action === "setPayment") {
    const method = String(data?.value || "Credit Card") as PaymentMethod;
    await flow.setPaymentMethod(method);
  } else if (action === "back") {
    await flow.backToRecommendations();
  } else if (action === "confirmOptions") {
    await flow.confirmOptions();
  } else if (action === "confirmYes") {
    await flow.placeOrder();
  } else if (action === "confirmNo") {
    await flow.backToOptions();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const mode = adaptiveMode(state);
  const modeLabel = adaptiveModeLabel(mode);
  const screenCopy = kioskScreenCopy(state);
  const stepLabel =
    state.step === "recommend"
      ? "Pick"
      : state.step === "options"
        ? "Options"
        : state.step === "fulfillment"
          ? "Place"
          : state.step === "loyalty"
            ? "Points"
            : state.step === "payment"
              ? "Payment"
              : "Review";

  let content = <p className="hint">Preparing your screen...</p>;
  if (state.step === "recommend") {
    content = <RecommendStep flow={flow} state={state} mode={mode} />;
  } else if (state.step === "options" && state.selectedItem) {
    content = <OptionsStep flow={flow} state={state} item={state.selectedItem} mode={mode} />;
  } else if (state.step === "fulfillment" && state.selectedItem) {
    content = <FulfillmentStep flow={flow} state={state} item={state.selectedItem} mode={mode} />;
  } else if (state.step === "loyalty" && state.selectedItem) {
    content = <LoyaltyStep flow={flow} state={state} item={state.selectedItem} mode={mode} />;
  } else if (state.step === "payment" && state.selectedItem) {
    content = <PaymentStep flow={flow} state={state} item={state.selectedItem} mode={mode} />;
  } else if (state.step === "confirm" && state.selectedItem) {
    content = <ConfirmStep flow={flow} state={state} item={state.selectedItem} mode={mode} />;
  }

  return (
    <section className={`adaptive-scene age-${mode}`}>
      <div className="adaptive-head">
        <div>
          <div className="mode-pill">{modeLabel}</div>
          <h2>{stepLabel}</h2>
          <p>{screenCopy}</p>
        </div>
        <div className="step-rail" aria-label="Order progress">
          {KIOSK_PROGRESS_STEPS.map((step, index) => (
            <span key={step.key} className={state.step === step.key ? "active" : ""} title={step.label}>
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      <div className="adaptive-layout">
        <main className="adaptive-main">{content}</main>
        {mode !== "express" && (
          <aside className="care-panel">
            <div className="care-kicker">Voice assistant</div>
            <strong>{carePanelCopy(state)}</strong>
            <span>{mode === "guided" ? "Two large choices first." : "Fast choices stay visible."}</span>
          </aside>
        )}
      </div>
    </section>
  );
}

function RecommendStep({
  flow,
  state,
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  mode: AdaptiveMode;
}) {
  const cands = state.candidates.slice(0, cardCountForState(state)); // 큰 카드 2~3장
  const showDetails = mode !== "guided";
  return (
    <div>
      <div className="question">
        {mode === "guided" ? "Choose one large card." : "Which menu item would you like?"}
      </div>
      <div className={`big-cards cards-${mode}`}>
        {cands.map((it, index) => (
          <button
            key={it.id}
            className={`big-card ${index === 0 ? "primary" : "secondary"}`}
            onClick={() => flow.selectMenu(it)}
          >
            <span className="rank-pill">{rankLabel(index, mode)}</span>
            <img
              className="big-art"
              src={USE_MOCK ? it.image_url : menuAssetUrl(it.image_url)}
              alt=""
              aria-hidden="true"
            />
            <div className="b-copy">
              <div className="b-name">{it.name}</div>
              <div className="b-price">{won(it.price)}</div>
              {showDetails && <p>{it.desc || it.category}</p>}
            </div>
            <div className="card-action">Choose</div>
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
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
  mode: AdaptiveMode;
}) {
  const cur = useMemo(
    () => unitTotal(item, state.selectedOptions),
    [item, state.selectedOptions],
  );
  return (
    <div>
      <div className="question">
        {emojiFor(item)} {mode === "guided" ? `${item.name} options` : `${item.name} - Choose your options`}
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
        <button className="btn-no" onClick={() => flow.backToRecommendations()}>
          Choose Again
        </button>
        <button className="btn-yes" onClick={() => flow.confirmOptions()}>
          Continue
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function FulfillmentStep({
  flow,
  state,
  item,
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
  mode: AdaptiveMode;
}) {
  return (
    <div>
      <div className="question">
        {mode === "guided" ? "Eat here or take out?" : `Where should we prepare ${item.name}?`}
      </div>
      <p className="voice-affordance">You can say "take out" or tap one.</p>
      <div className="yesno">
        <button
          className={"choice-tile" + (state.orderState.fulfillment === "Dine In" ? " selected" : "")}
          onClick={() => flow.setFulfillment("Dine In")}
        >
          <strong>Dine In</strong>
          <span>Eat at the store</span>
        </button>
        <button
          className={"choice-tile" + (state.orderState.fulfillment === "Take Out" ? " selected" : "")}
          onClick={() => flow.setFulfillment("Take Out")}
        >
          <strong>Take Out</strong>
          <span>Pack to go</span>
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function LoyaltyStep({
  flow,
  state,
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
  mode: AdaptiveMode;
}) {
  return (
    <div>
      <div className="question">
        {mode === "guided" ? "Coupons or points?" : "Do you want to use coupons or earn points?"}
      </div>
      <p className="voice-affordance">You can say "skip points", "coupon", or "earn points".</p>
      <div className="adaptive-choice-grid">
        <button className={"choice-tile" + (state.orderState.loyalty === "scan" ? " selected" : "")} onClick={() => flow.setLoyalty("scan")}>
          <strong>App Coupon</strong>
          <span>Scan QR code</span>
        </button>
        <button className={"choice-tile" + (state.orderState.loyalty === "phone" ? " selected" : "")} onClick={() => flow.setLoyalty("phone")}>
          <strong>Earn Points</strong>
          <span>Use phone number</span>
        </button>
        <button className={"choice-tile" + (state.orderState.loyalty === "none" ? " selected" : "")} onClick={() => flow.setLoyalty("none")}>
          <strong>Skip</strong>
          <span>No coupon or points</span>
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function PaymentStep({
  flow,
  state,
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
  mode: AdaptiveMode;
}) {
  const methods: PaymentMethod[] = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"];
  return (
    <div>
      <div className="question">
        {mode === "guided" ? "How will you pay?" : "Choose a payment method"}
      </div>
      <p className="voice-affordance">You can say "card", "Kakao Pay", or tap one.</p>
      <div className="adaptive-choice-grid">
        {methods.map((method) => (
          <button
            key={method}
            className={"choice-tile" + (state.orderState.payment_method === method ? " selected" : "")}
            onClick={() => flow.setPaymentMethod(method)}
          >
            <strong>{method}</strong>
            <span>{method === "Credit Card" ? "Tap or insert card" : "Use selected payment"}</span>
          </button>
        ))}
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function ConfirmStep({
  flow,
  state,
  item,
  mode,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
  mode: AdaptiveMode;
}) {
  const cur = unitTotal(item, state.selectedOptions);
  const optText = Object.entries(state.selectedOptions)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
  return (
    <div>
      <div className="question">{mode === "guided" ? "Ready to pay?" : "Would you like to order this?"}</div>
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
          <span>{won(state.orderState.total || cur)}</span>
        </div>
        <div className="order-state-line">
          <span>{state.orderState.fulfillment ?? "Place not selected"}</span>
          <span>{state.orderState.loyalty === "none" ? "No points" : state.orderState.loyalty ?? "Points not selected"}</span>
          <span>{state.orderState.payment_method ?? "Payment not selected"}</span>
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
      <MultiTurnBar flow={flow} />
    </div>
  );
}

// 멀티턴(재발화) 막대
function MultiTurnBar({ flow }: { flow: Orchestrator }) {
  const [text, setText] = useState("");
  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    void flow.submitVoiceTurn(value);
  };
  return (
    <div className="multi-turn">
      <button className="mic-btn secondary" onClick={() => flow.respeak()}>
        Speak Next
      </button>
      <input
        className="voice-turn-input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
        }}
        placeholder='Try "vanilla latte", "iced large", "take out", "card"'
        aria-label="Demo voice turn"
      />
      <button className="mic-btn secondary voice-turn-submit" onClick={submit}>
        Send as Voice
      </button>
      <button className="mic-btn secondary" onClick={() => flow.reset(true)}>
        Start Over
      </button>
    </div>
  );
}

function effectiveAssistLevel(state: FlowState): 0 | 1 | 2 | 3 {
  const raw = state.analyze?.behavioral.assist_level ?? 0;
  const senior = new Set(["senior_adult", "fifties", "sixties", "seventies_plus"]);
  if (state.analyze && senior.has(state.analyze.age.group) && raw < 3) {
    return (raw + 1) as 1 | 2 | 3;
  }
  return raw;
}

function cardCountForState(state: FlowState): 2 | 3 {
  return effectiveAssistLevel(state) >= 3 ? 2 : 3;
}

type AdaptiveMode = "express" | "comfort" | "guided";

function adaptiveMode(state: FlowState): AdaptiveMode {
  const assist = effectiveAssistLevel(state);
  if (assist >= 2) return "guided";
  if (assist === 1) return "comfort";
  return "express";
}

function adaptiveModeLabel(mode: AdaptiveMode): string {
  if (mode === "guided") return "Easy order mode";
  if (mode === "comfort") return "Comfort order mode";
  return "Quick order mode";
}

function rankLabel(index: number, mode: AdaptiveMode): string {
  if (index === 0) return mode === "express" ? "Top pick" : "Best match";
  if (index === 1) return mode === "guided" ? "Easy second choice" : "Alternative";
  return "Quick option";
}

function carePanelCopy(state: FlowState): string {
  if (state.step === "recommend") return "I found the clearest matches for your voice order.";
  if (state.step === "options") return "Only the needed options are shown here.";
  if (state.step === "fulfillment") return "Choose whether this order is for here or to go.";
  if (state.step === "loyalty") return "You can skip points if you do not need them.";
  if (state.step === "payment") return "No payment is charged until the final confirmation.";
  return "Check the total, then choose the payment button.";
}

function kioskScreenCopy(state: FlowState): string {
  if (state.step === "recommend") return "I found menu items for your order.";
  if (state.step === "options") return "Choose the options you want.";
  if (state.step === "fulfillment") return "Choose where to receive your order.";
  if (state.step === "loyalty") return "Choose coupons, points, or skip.";
  if (state.step === "payment") return "Choose a payment method.";
  return "Review your order before payment.";
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
