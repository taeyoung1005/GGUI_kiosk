// src/ui/AdaptiveKiosk.tsx
//
// 적응 UI — 음성 주문(voice phase) 본체. Module C(/generate-ui)의 결과를 그린다.
//
// 두 가지 렌더 경로:
//   1) embed_url(또는 GGUI html)이 있으면 → @ggui-ai/react 임베드(가능 시) 또는 iframe.
//   2) embed_url 이 비어 있으면(mock/폴백) → 내장 적응 렌더러로 동일 구조를 직접 그린다.
//
// 적응 강도는 항상 고령자 친화 최대로 고정한다(큰 글씨 + 2장 카드 + 음성 안내 상시).
// 사용자 액션은 orchestrator 에 위임한다(selectMenu / setOption / confirmOptions / placeOrder).

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MenuItem, PaymentMethod } from "@contracts/types";
import type { FlowState, Orchestrator } from "../flow/orchestrator";
import { USE_MOCK, consumeGguiEvents, menuAssetUrl } from "../api/client";
import { emojiFor, won } from "./emoji";
import { KIOSK_PROGRESS_STEPS } from "./kioskProgress";

/** 고령자 친화 강도 고정: 추천 카드는 큰 글씨로 2장만 보여 준다. */
const SENIOR_CARD_COUNT = 2;

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  "Credit Card": "신용카드",
  "Gift Card": "상품권",
  "Kakao Pay": "카카오페이",
  "Naver Pay": "네이버페이",
  "Pay at Counter": "카운터 결제",
};

export interface AdaptiveKioskProps {
  flow: Orchestrator;
  state: FlowState;
}

export default function AdaptiveKiosk({ flow, state }: AdaptiveKioskProps) {
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
        <VoiceControlBar flow={flow} />
      </div>
    );
  }

  if (state.phase === "ordering") {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">결제를 진행하고 있어요...</div>
        <p className="hint">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  if (state.phase === "done" && state.order) {
    return (
      <div className="overlay">
        <div className="done-check">완료</div>
        <div className="big">결제가 완료됐어요!</div>
        <p className="hint">
          주문번호 <b>{state.order.order_id}</b> · 합계 {won(state.order.total)}
        </p>
        <button className="btn-primary" onClick={() => flow.reset(true)}>
          처음으로
        </button>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div>
        <div className="error-box">{state.message}</div>
        <button className="btn-primary" onClick={() => flow.reset(true)}>
          일반 화면으로 돌아가기
        </button>
      </div>
    );
  }

  // ── adaptive 단계: 내장 인터랙티브 렌더러(터치+음성) 기본 ──────
  // GGUI iframe 은 표시 전용이라(안의 버튼이 흐름을 진행시키지 못함) 기본 off.
  // 시각 확인용으로 보려면 VITE_GGUI_EMBED=true.
  if (state.phase === "adaptive") {
    const useEmbed =
      import.meta.env.VITE_GGUI_EMBED === "true" &&
      Boolean((embedUrl || gguiHtml) && !embedTimedOut);
    return (
      <div className="adaptive">
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
      <div className="big">음성 주문 준비 완료</div>
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
        title="GGUI 적응 UI"
        sandbox="allow-scripts"
      />
    );
  }

  return (
    <iframe
      className="embed-frame"
      src={url}
      title="GGUI 적응 UI"
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
// 내장 적응 렌더러 (mock/폴백) — 구조 고정, 항상 고령자 친화 최대 강도.
// ────────────────────────────────────────────────────────────
function BuiltInAdaptive({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
}) {
  const screenCopy = kioskScreenCopy(state);
  const stepLabel =
    state.step === "recommend"
      ? "메뉴 선택"
      : state.step === "options"
        ? "옵션"
        : state.step === "fulfillment"
          ? "장소"
          : state.step === "loyalty"
            ? "적립"
            : state.step === "payment"
              ? "결제"
              : "확인";

  let content = <p className="hint">화면을 준비하고 있어요...</p>;
  if (state.step === "recommend") {
    content = <RecommendStep flow={flow} state={state} />;
  } else if (state.step === "options" && state.selectedItem) {
    content = <OptionsStep flow={flow} state={state} item={state.selectedItem} />;
  } else if (state.step === "fulfillment" && state.selectedItem) {
    content = <FulfillmentStep flow={flow} state={state} item={state.selectedItem} />;
  } else if (state.step === "loyalty" && state.selectedItem) {
    content = <LoyaltyStep flow={flow} state={state} item={state.selectedItem} />;
  } else if (state.step === "payment" && state.selectedItem) {
    content = <PaymentStep flow={flow} state={state} item={state.selectedItem} />;
  } else if (state.step === "confirm" && state.selectedItem) {
    content = <ConfirmStep flow={flow} state={state} item={state.selectedItem} />;
  }

  return (
    <section className="adaptive-scene">
      <div className="adaptive-head">
        <div>
          <div className="mode-pill">쉬운 주문 모드</div>
          <h2>{stepLabel}</h2>
          <p>{screenCopy}</p>
        </div>
        <div className="step-rail" aria-label="주문 진행 상황">
          {KIOSK_PROGRESS_STEPS.map((step, index) => (
            <span key={step.key} className={state.step === step.key ? "active" : ""} title={step.label}>
              {index + 1}
            </span>
          ))}
        </div>
      </div>
      <div className="adaptive-layout">
        <main className="adaptive-main">{content}</main>
        <aside className="care-panel">
          <div className="care-kicker">음성 도우미</div>
          <strong>{carePanelCopy(state)}</strong>
          <span>큰 글씨로 두 가지만 먼저 보여 드려요.</span>
        </aside>
      </div>
    </section>
  );
}

function RecommendStep({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
}) {
  const cands = state.candidates.slice(0, SENIOR_CARD_COUNT); // 큰 카드 2장
  return (
    <div>
      <div className="question">이 중에서 골라 주세요.</div>
      <div className="big-cards cards-guided">
        {cands.map((it, index) => (
          <button
            key={it.id}
            className={`big-card ${index === 0 ? "primary" : "secondary"}`}
            onClick={() => flow.selectMenu(it)}
          >
            <span className="rank-pill">{index === 0 ? "추천" : "다른 메뉴"}</span>
            <img
              className="big-art"
              src={USE_MOCK ? it.image_url : menuAssetUrl(it.image_url)}
              alt=""
              aria-hidden="true"
            />
            <div className="b-copy">
              <div className="b-name">{it.name}</div>
              <div className="b-price">{won(it.price)}</div>
            </div>
            <div className="card-action">선택</div>
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
        {emojiFor(item)} {item.name} 옵션을 골라 주세요
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
          <span>합계</span>
          <span>{won(cur)}</span>
        </div>
      </div>

      <div className="yesno">
        <button className="btn-no" onClick={() => flow.backToRecommendations()}>
          다시 고르기
        </button>
        <button className="btn-yes" onClick={() => flow.confirmOptions()}>
          계속하기
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function FulfillmentStep({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
}) {
  return (
    <div>
      <div className="question">매장에서 드시나요, 포장하시나요?</div>
      <p className="voice-affordance">"포장"이라고 말씀하시거나 버튼을 눌러 주세요.</p>
      <div className="yesno">
        <button
          className={"choice-tile" + (state.orderState.fulfillment === "Dine In" ? " selected" : "")}
          onClick={() => flow.setFulfillment("Dine In")}
        >
          <strong>매장</strong>
          <span>매장에서 드세요</span>
        </button>
        <button
          className={"choice-tile" + (state.orderState.fulfillment === "Take Out" ? " selected" : "")}
          onClick={() => flow.setFulfillment("Take Out")}
        >
          <strong>포장</strong>
          <span>가져가실 수 있게 포장해요</span>
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function LoyaltyStep({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
}) {
  return (
    <div>
      <div className="question">쿠폰이나 적립을 하시겠어요?</div>
      <p className="voice-affordance">"적립 안 할게요", "쿠폰", "적립할게요"라고 말씀하실 수 있어요.</p>
      <div className="adaptive-choice-grid">
        <button className={"choice-tile" + (state.orderState.loyalty === "scan" ? " selected" : "")} onClick={() => flow.setLoyalty("scan")}>
          <strong>앱 쿠폰</strong>
          <span>QR 코드 인식</span>
        </button>
        <button className={"choice-tile" + (state.orderState.loyalty === "phone" ? " selected" : "")} onClick={() => flow.setLoyalty("phone")}>
          <strong>포인트 적립</strong>
          <span>전화번호 사용</span>
        </button>
        <button className={"choice-tile" + (state.orderState.loyalty === "none" ? " selected" : "")} onClick={() => flow.setLoyalty("none")}>
          <strong>건너뛰기</strong>
          <span>쿠폰·적립 없이</span>
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

function PaymentStep({
  flow,
  state,
}: {
  flow: Orchestrator;
  state: FlowState;
  item: MenuItem;
}) {
  const methods: PaymentMethod[] = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"];
  return (
    <div>
      <div className="question">어떻게 결제하시겠어요?</div>
      <p className="voice-affordance">"카드", "카카오페이"라고 말씀하시거나 버튼을 눌러 주세요.</p>
      <div className="adaptive-choice-grid">
        {methods.map((method) => (
          <button
            key={method}
            className={"choice-tile" + (state.orderState.payment_method === method ? " selected" : "")}
            onClick={() => flow.setPaymentMethod(method)}
          >
            <strong>{PAYMENT_LABELS[method]}</strong>
            <span>{method === "Credit Card" ? "카드를 대거나 넣어 주세요" : "선택한 방법으로 결제해요"}</span>
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
      <div className="question">이대로 결제하시겠어요?</div>
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
          <span>합계</span>
          <span>{won(state.orderState.total || cur)}</span>
        </div>
        <div className="order-state-line">
          <span>{fulfillmentLabel(state.orderState.fulfillment)}</span>
          <span>{loyaltyLabel(state.orderState.loyalty)}</span>
          <span>{paymentLabel(state.orderState.payment_method)}</span>
        </div>
      </div>

      <div className="yesno">
        <button
          className="btn-no"
          onClick={() =>
            item.options.length ? flow.backToOptions() : flow.reset(false)
          }
        >
          아니요, 바꿀게요
        </button>
        <button className="btn-yes" onClick={() => flow.placeOrder()}>
          네, 결제할게요
        </button>
      </div>
      <MultiTurnBar flow={flow} />
    </div>
  );
}

// 멀티턴(재발화) 막대 — 음성 버튼 상시 + 처음으로 하단.
// 데모용 텍스트 입력은 OpenAI Realtime 2초 침묵 자동종료가 대체하므로 제거했다.
function MultiTurnBar({ flow }: { flow: Orchestrator }) {
  return (
    <div className="multi-turn">
      <button className="mic-btn" type="button" onClick={() => flow.respeak()}>
        🎤 다시 말하기
      </button>
      <button className="mic-btn secondary" type="button" onClick={() => flow.reset(true)}>
        처음으로
      </button>
    </div>
  );
}

// 진행/녹음 중 오버레이에서 노출하는 음성 제어 바(정지/취소).
function VoiceControlBar({ flow }: { flow: Orchestrator }) {
  return (
    <div className="voice-control-bar">
      <button className="mic-btn recording" type="button" onClick={() => flow.stopAndRun()}>
        ⏹ 말하기 끝
      </button>
      <button className="mic-btn secondary" type="button" onClick={() => flow.cancel()}>
        취소
      </button>
    </div>
  );
}

function fulfillmentLabel(value: "Dine In" | "Take Out" | null | undefined): string {
  if (value === "Dine In") return "매장";
  if (value === "Take Out") return "포장";
  return "장소 미선택";
}

function loyaltyLabel(value: "scan" | "phone" | "none" | null | undefined): string {
  if (value === "scan") return "앱 쿠폰";
  if (value === "phone") return "포인트 적립";
  if (value === "none") return "적립 안 함";
  return "적립 미선택";
}

function paymentLabel(value: PaymentMethod | null | undefined): string {
  if (!value) return "결제 방법 미선택";
  return PAYMENT_LABELS[value];
}

function carePanelCopy(state: FlowState): string {
  if (state.step === "recommend") return "말씀하신 주문에 가장 잘 맞는 메뉴를 찾았어요.";
  if (state.step === "options") return "필요한 옵션만 보여 드려요.";
  if (state.step === "fulfillment") return "매장에서 드실지 포장하실지 골라 주세요.";
  if (state.step === "loyalty") return "필요 없으시면 적립은 건너뛰셔도 돼요.";
  if (state.step === "payment") return "마지막 확인 전까지는 결제되지 않아요.";
  return "합계를 확인하고 결제 버튼을 눌러 주세요.";
}

function kioskScreenCopy(state: FlowState): string {
  if (state.step === "recommend") return "말씀하신 주문에 맞는 메뉴예요.";
  if (state.step === "options") return "원하시는 옵션을 골라 주세요.";
  if (state.step === "fulfillment") return "어디에서 드실지 골라 주세요.";
  if (state.step === "loyalty") return "쿠폰·적립을 고르거나 건너뛰세요.";
  if (state.step === "payment") return "결제 방법을 골라 주세요.";
  return "결제 전에 주문 내용을 확인해 주세요.";
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
