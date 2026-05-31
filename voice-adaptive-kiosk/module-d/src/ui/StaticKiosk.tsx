// src/ui/StaticKiosk.tsx
//
// 일반 키오스크 UI — 평소 키오스크(kiosk phase) + GGUI 실패 시 폴백.
// 평범하지만 동작하는 주문 UI: 카테고리 탭 + 메뉴 그리드 + 옵션 선택 → 주문.
// 매장/포장 선택 아래에 상시 음성 주문 버튼을 두고, 모든 화면 하단에도
// 음성 주문 버튼과 처음으로(Start Over) 버튼을 상시 노출한다.
//
// Module B 의 /menu 데이터를 그대로 그린다(mock 모드면 contracts/mocks 의 sampleMenu).

import { useEffect, useMemo, useState } from "react";
import type { Menu, MenuItem } from "@contracts/types";
import { USE_MOCK, createOrder, getMenu, menuAssetUrl } from "../api/client";
import { emojiFor, won } from "./emoji";

type Phase = "start" | "browse" | "options" | "review" | "loyalty" | "payment" | "paying" | "done";
type Fulfillment = "Dine In" | "Take Out";
type PaymentMethod = "Credit Card" | "Gift Card" | "Kakao Pay" | "Naver Pay" | "Pay at Counter";
type CartLine = {
  lineId: string;
  item: MenuItem;
  options: Record<string, string>;
  qty: number;
};

export interface StaticKioskProps {
  /** 상시 음성 주문 버튼을 눌렀을 때 호출(App 이 voice phase 로 전환). */
  onStartVoice: () => void;
}

const PAGE_SIZE = 8;
const PAYMENT_METHODS: PaymentMethod[] = [
  "Credit Card",
  "Gift Card",
  "Kakao Pay",
  "Naver Pay",
  "Pay at Counter",
];

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  "Credit Card": "신용카드",
  "Gift Card": "상품권",
  "Kakao Pay": "카카오페이",
  "Naver Pay": "네이버페이",
  "Pay at Counter": "카운터 결제",
};

const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  "Dine In": "매장",
  "Take Out": "포장",
};

const DECISION_STEPS = [
  "장소",
  "메뉴",
  "옵션",
  "확인",
  "적립",
  "결제",
] as const;

const OPTIONAL_UPGRADES = [
  { type: "Set Upgrade", label: "디저트 세트", priceDelta: 3000 },
  { type: "Combo Upgrade", label: "라지 사이즈 콤보", priceDelta: 1500 },
  { type: "Add-on", label: "샷 추가", priceDelta: 500 },
] as const;

export default function StaticKiosk({ onStartVoice }: StaticKioskProps) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState<string>("전체");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("start");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("Dine In");
  const [page, setPage] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Credit Card");
  const [loyalty, setLoyalty] = useState<"none" | "scan" | "phone">("none");
  const [orderNo, setOrderNo] = useState<string>("");
  const [total, setTotal] = useState<number>(0);

  useEffect(() => {
    getMenu().then(setMenu).catch(() => setMenu(null));
  }, []);

  const items = useMemo(() => {
    if (!menu) return [];
    return cat === "전체"
      ? menu.items
      : menu.items.filter((i) => i.category === cat);
  }, [menu, cat]);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const visibleItems = useMemo(
    () => items.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [items, page],
  );
  const cartSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + unitTotal(line.item, line.options) * line.qty, 0),
    [cart],
  );
  const serviceFee = cart.length > 0 && fulfillment === "Dine In" ? 0 : 0;
  const payableTotal = cartSubtotal + serviceFee;

  function pick(item: MenuItem) {
    const defaults: Record<string, string> = {};
    for (const o of item.options) defaults[o.type] = o.choices[0]?.label ?? "";
    setSelected(item);
    setOptions(defaults);
    setPhase("options");
  }

  function unitTotal(item: MenuItem, opts: Record<string, string>): number {
    let p = item.price;
    for (const [type, label] of Object.entries(opts)) {
      const opt = item.options.find((o) => o.type === type);
      const ch = opt?.choices.find((c) => c.label === label);
      if (ch) {
        p += ch.price_delta;
      } else {
        p += optionalUpgradeDelta(type, label);
      }
    }
    return p;
  }

  async function pay() {
    if (cart.length === 0) return;
    setPhase("paying");
    const res = await createOrder({
      items: cart.map((line) => ({
        item_id: line.item.id,
        options: line.options,
        qty: line.qty,
      })),
    });
    setOrderNo(res.order_id);
    setTotal(res.total);
    setPhase("done");
  }

  function restart() {
    setSelected(null);
    setOptions({});
    setCart([]);
    setPage(0);
    setLoyalty("none");
    setPaymentMethod("Credit Card");
    setPhase("start");
  }

  function addSelectedToCart() {
    if (!selected) return;
    setCart((lines) => [
      ...lines,
      {
        lineId: `${selected.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        item: selected,
        options,
        qty: 1,
      },
    ]);
    setSelected(null);
    setOptions({});
    setPhase("browse");
  }

  function setCategory(next: string) {
    setCat(next);
    setPage(0);
  }

  function setQty(lineId: string, qty: number) {
    setCart((lines) =>
      lines
        .map((line) => (line.lineId === lineId ? { ...line, qty: Math.max(0, qty) } : line))
        .filter((line) => line.qty > 0),
    );
  }

  function toggleUpgrade(type: string, label: string) {
    setOptions((prev) => {
      const next = { ...prev };
      if (next[type] === label) {
        delete next[type];
      } else {
        next[type] = label;
      }
      return next;
    });
  }

  if (!menu) {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">메뉴를 불러오는 중...</div>
      </div>
    );
  }

  if (phase === "paying") {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">결제를 진행하고 있어요...</div>
        <p className="hint">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="overlay">
        <div className="done-check">✅</div>
        <div className="big">결제 완료</div>
        <p className="hint">
          주문번호 <b>{orderNo}</b> · 합계 {won(total)}
        </p>
        <button className="btn-primary" onClick={restart}>
          처음으로
        </button>
      </div>
    );
  }

  if (phase === "start") {
    return (
      <div className="static-start">
        <div className="kiosk-red-strip">여기서 주문하세요</div>
        <h2>어디에서 드시겠어요?</h2>
        <p>메뉴를 보기 전에 먼저 선택해 주세요.</p>
        <div className="fulfillment-cards">
          <button
            onClick={() => {
              setFulfillment("Dine In");
              setPhase("browse");
            }}
          >
            <span>매장</span>
            <small>나중에 테이블 번호를 사용해요</small>
          </button>
          <button
            onClick={() => {
              setFulfillment("Take Out");
              setPhase("browse");
            }}
          >
            <span>포장</span>
            <small>가져가실 수 있도록 포장해요</small>
          </button>
        </div>

        <VoiceOrderBanner onStartVoice={onStartVoice} />

        <div className="static-legal-row">
          <span>이 키오스크는 카드 결제만 가능해요</span>
          <span>결제 후 영수증이 출력돼요</span>
        </div>
      </div>
    );
  }

  if (phase === "options" && selected) {
    const cur = unitTotal(selected, options);
    return (
      <div className="static-options-screen">
        <DecisionRail phase={phase} />
        <div className="flow-friction-note">
          선택한 메뉴는 이 옵션 단계에 고정돼요. 장바구니에 담기 전에 가격이 바뀔 수 있어요.
        </div>
        <div className="option-progress">
          <span className="active">1 필수 옵션</span>
          <span>2 세트 변경</span>
          <span>3 추가 선택</span>
        </div>
        <div className="price-change-note">
          필수 옵션과 추가 선택은 가격이 따로 더해져요. 담기 전에 바뀐 합계를 확인해 주세요.
        </div>

        <div className="static-options-layout">
          <aside className="selected-product-panel">
            <img
              src={USE_MOCK ? selected.image_url : menuAssetUrl(selected.image_url)}
              alt=""
              aria-hidden="true"
            />
            <h2 className="static-title">
              {emojiFor(selected)} {selected.name}
            </h2>
            <p>{selected.desc}</p>
            <div className="mini-summary">
              <span>기본</span>
              <strong>{won(selected.price)}</strong>
            </div>
            <div className="mini-summary">
              <span>현재</span>
              <strong>{won(cur)}</strong>
            </div>
          </aside>

          <main className="option-main-panel">
            {selected.options.length === 0 && (
              <p className="hint">선택할 옵션이 없어요.</p>
            )}

            {selected.options.map((opt) => (
              <div className="option-group static-option-group" key={opt.type}>
                <div className="o-label static-label">
                  <span>{opt.type}</span>
                  <small>필수</small>
                </div>
                <div className="choices compact">
                  {opt.choices.map((c) => (
                    <button
                      key={c.label}
                      className={
                        "choice" + (options[opt.type] === c.label ? " selected" : "")
                      }
                      onClick={() =>
                        setOptions((s) => ({ ...s, [opt.type]: c.label }))
                      }
                    >
                      {c.label}
                      {c.price_delta > 0 && <small>+{won(c.price_delta)}</small>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </main>

          <aside className="option-upsell-panel">
            <h3>추가 선택</h3>
            {OPTIONAL_UPGRADES.map((upgrade) => (
              <button
                key={upgrade.type}
                className={
                  "upgrade-row" +
                  (options[upgrade.type] === upgrade.label ? " selected" : "")
                }
                type="button"
                aria-pressed={options[upgrade.type] === upgrade.label}
                onClick={() => toggleUpgrade(upgrade.type, upgrade.label)}
              >
                <span>{upgrade.label}</span>
                <strong>+{won(upgrade.priceDelta)}</strong>
              </button>
            ))}
            <div className="allergy-note">
              <strong>알레르기 정보</strong>
              <span>우유 · 카페인이 포함될 수 있어요.</span>
            </div>
          </aside>
        </div>

        <div className="confirm-box static-confirm">
          <div className="c-total static-total">
            <span>합계</span>
            <span>{won(cur)}</span>
          </div>
        </div>

        <div className="static-actions">
          <button
            className="mic-btn secondary"
            onClick={() => setPhase("browse")}
          >
            메뉴로 돌아가기
          </button>
          <button className="btn-primary" onClick={addSelectedToCart}>
            주문에 담기
          </button>
        </div>

        <StaticBottomBar onStartVoice={onStartVoice} onRestart={restart} />
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="static-checkout">
        <DecisionRail phase={phase} />
        <div className="checkout-title">
          <span>1</span>
          <div>
            <h2>주문 내용을 확인하세요</h2>
            <p>{FULFILLMENT_LABELS[fulfillment]} · 메뉴 {cart.length}종</p>
          </div>
        </div>
        <CartPanel
          cart={cart}
          total={payableTotal}
          onQty={setQty}
          dense={false}
        />
        <div className="static-actions">
          <button className="mic-btn secondary" onClick={() => setPhase("browse")}>
            더 담기
          </button>
          <button
            className="btn-primary"
            disabled={cart.length === 0}
            onClick={() => setPhase("loyalty")}
          >
            계속하기
          </button>
        </div>

        <StaticBottomBar onStartVoice={onStartVoice} onRestart={restart} />
      </div>
    );
  }

  if (phase === "loyalty") {
    return (
      <div className="static-checkout">
        <DecisionRail phase={phase} />
        <div className="checkout-title">
          <span>2</span>
          <div>
            <h2>쿠폰과 적립</h2>
            <p>적립 코드를 인식하거나 결제로 건너뛰세요.</p>
          </div>
        </div>
        <div className="loyalty-grid">
          {[
            ["scan", "앱 쿠폰", "앱의 QR 코드를 인식해요"],
            ["phone", "포인트 적립", "전화번호를 입력해요"],
            ["none", "건너뛰기", "쿠폰·적립 없이 진행"],
          ].map(([value, title, desc]) => (
            <button
              key={value}
              className={loyalty === value ? "selected" : ""}
              onClick={() => setLoyalty(value as typeof loyalty)}
            >
              <strong>{title}</strong>
              <small>{desc}</small>
            </button>
          ))}
        </div>
        {loyalty !== "none" && (
          <div className="scan-box">
            <div className="scan-target">QR</div>
            <p>{loyalty === "scan" ? "앱 쿠폰을 스캐너에 가까이 대 주세요." : "아래 키패드로 전화번호를 입력해 주세요."}</p>
            {loyalty === "phone" && <div className="fake-keypad">010 - ____ - ____</div>}
          </div>
        )}
        <div className="static-actions">
          <button className="mic-btn secondary" onClick={() => setPhase("review")}>
            뒤로
          </button>
          <button className="btn-primary" onClick={() => setPhase("payment")}>
            결제로 이동
          </button>
        </div>

        <StaticBottomBar onStartVoice={onStartVoice} onRestart={restart} />
      </div>
    );
  }

  if (phase === "payment") {
    return (
      <div className="static-checkout">
        <DecisionRail phase={phase} />
        <div className="checkout-title">
          <span>3</span>
          <div>
            <h2>결제 방법 선택</h2>
            <p>합계 {won(payableTotal)} · {FULFILLMENT_LABELS[fulfillment]}</p>
          </div>
        </div>
        <div className="payment-grid">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              className={paymentMethod === method ? "selected" : ""}
              onClick={() => setPaymentMethod(method)}
            >
              <span>{PAYMENT_LABELS[method]}</span>
              <small>{method === "Credit Card" ? "아래에 카드를 넣거나 대 주세요" : "선택 후 다음 안내를 따라 주세요"}</small>
            </button>
          ))}
        </div>
        <div className="reader-panel">
          <div className="reader-slot" />
          <div>
            <strong>{PAYMENT_LABELS[paymentMethod]}</strong>
            <p>{paymentMethod === "Credit Card" ? "리더기에 카드를 대거나 넣어 주세요." : "결제 전에 확인 화면이 나타날 수 있어요."}</p>
          </div>
        </div>
        <div className="static-actions">
          <button className="mic-btn secondary" onClick={() => setPhase("loyalty")}>
            뒤로
          </button>
          <button className="btn-primary" onClick={pay}>
            {won(payableTotal)} 결제하기
          </button>
        </div>

        <StaticBottomBar onStartVoice={onStartVoice} onRestart={restart} />
      </div>
    );
  }

  // browse
  return (
    <div className="standard-kiosk">
      <div className="standard-top">
        <div>
          <strong>{FULFILLMENT_LABELS[fulfillment]}</strong>
          <span>{menu.items.length}개 메뉴 중에서 고른 뒤 확인·적립·결제 순서로 진행해요.</span>
        </div>
        <button onClick={() => setPhase("start")}>변경</button>
      </div>

      <DecisionRail phase={phase} />

      <div className="flow-friction-note">
        일반 키오스크는 메뉴 보기, 옵션 선택, 주문 확인, 적립, 결제를 서로 다른 화면으로 나눠요.
      </div>

      <div className="standard-body">
        <aside className="category-rail">
          {["전체", ...menu.categories].map((c) => (
            <button
              key={c}
              className={c === cat ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
              <small>{c === "전체" ? menu.items.length : menu.items.filter((i) => i.category === c).length}</small>
            </button>
          ))}
        </aside>

        <main className="menu-browser">
          <div className="menu-step-note">
            <b>2단계 · 메뉴 보기</b>
            <span>{cat} · 메뉴 {items.length}개 · {pageCount}쪽 중 {page + 1}쪽</span>
          </div>

          <div className="grid">
            {visibleItems.map((it) => (
              <button className="menu-card" key={it.id} onClick={() => pick(it)}>
                <img
                  className="thumb"
                  src={USE_MOCK ? it.image_url : menuAssetUrl(it.image_url)}
                  alt=""
                  aria-hidden="true"
                />
                <div className="name">{it.name}</div>
                <div className="desc">{it.desc}</div>
                <div className="price">{won(it.price)}</div>
              </button>
            ))}
          </div>

          <div className="page-controls">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              이전
            </button>
            <span>
              {page + 1} / {pageCount} 쪽
            </span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
              다음
            </button>
          </div>
        </main>

        <aside className="order-sidebar">
          <CartPanel cart={cart} total={payableTotal} onQty={setQty} dense />
          <button
            className="checkout-button"
            disabled={cart.length === 0}
            onClick={() => setPhase("review")}
          >
            결제하기
          </button>
          <div className="side-help">
            <span>확인</span>
            <span>적립</span>
            <span>결제</span>
          </div>
        </aside>
      </div>

      <StaticBottomBar onStartVoice={onStartVoice} onRestart={restart} />
    </div>
  );
}

/** 매장/포장 선택 아래에 두는 큰 음성 주문 안내 버튼. */
function VoiceOrderBanner({ onStartVoice }: { onStartVoice: () => void }) {
  return (
    <button className="voice-order-banner" type="button" onClick={onStartVoice}>
      <span className="voice-order-icon" aria-hidden="true">🎤</span>
      <span className="voice-order-text">
        <strong>음성으로 주문하기</strong>
        <small>버튼을 누르고 메뉴를 말씀하시면 큰 화면으로 도와드려요</small>
      </span>
    </button>
  );
}

/** 모든 화면 하단에 상시 노출되는 음성 주문 + 처음으로 바. */
function StaticBottomBar({
  onStartVoice,
  onRestart,
}: {
  onStartVoice: () => void;
  onRestart: () => void;
}) {
  return (
    <div className="static-bottom-bar">
      <button className="mic-btn" type="button" onClick={onStartVoice}>
        🎤 음성으로 주문하기
      </button>
      <button className="mic-btn secondary" type="button" onClick={onRestart}>
        처음으로
      </button>
    </div>
  );
}

function DecisionRail({ phase }: { phase: Phase }) {
  const active = stepIndexForPhase(phase);
  return (
    <div className="decision-rail" aria-label="일반 키오스크 주문 단계">
      {DECISION_STEPS.map((step, index) => (
        <span
          key={step}
          className={
            index === active ? "active" : index < active ? "done" : ""
          }
        >
          <b>{index + 1}</b>
          {step}
        </span>
      ))}
    </div>
  );
}

function stepIndexForPhase(phase: Phase): number {
  if (phase === "start") return 0;
  if (phase === "browse") return 1;
  if (phase === "options") return 2;
  if (phase === "review") return 3;
  if (phase === "loyalty") return 4;
  return 5;
}

function CartPanel({
  cart,
  total,
  onQty,
  dense,
}: {
  cart: CartLine[];
  total: number;
  onQty: (lineId: string, qty: number) => void;
  dense: boolean;
}) {
  return (
    <div className={dense ? "cart-panel dense" : "cart-panel"}>
      <div className="cart-head">
        <strong>내 주문</strong>
        <span>{cart.reduce((sum, line) => sum + line.qty, 0)}개</span>
      </div>
      {cart.length === 0 ? (
        <p className="empty-cart">담은 메뉴가 없어요.</p>
      ) : (
        <div className="cart-lines">
          {cart.map((line) => (
            <div className="cart-line" key={line.lineId}>
              <div>
                <b>{line.item.name}</b>
                <small>{formatOptionSummary(line.options)}</small>
              </div>
              <div className="qty-control">
                <button onClick={() => onQty(line.lineId, line.qty - 1)}>-</button>
                <span>{line.qty}</span>
                <button onClick={() => onQty(line.lineId, line.qty + 1)}>+</button>
              </div>
              <strong>{won(unitTotal(line.item, line.options) * line.qty)}</strong>
            </div>
          ))}
        </div>
      )}
      <div className="cart-total">
        <span>합계</span>
        <strong>{won(total)}</strong>
      </div>
    </div>
  );
}

function formatOptionSummary(opts: Record<string, string>): string {
  const values = Object.values(opts).filter(Boolean);
  return values.length ? values.join(" · ") : "기본";
}

function unitTotal(item: MenuItem, opts: Record<string, string>): number {
  let p = item.price;
  for (const [type, label] of Object.entries(opts)) {
    const opt = item.options.find((o) => o.type === type);
    const ch = opt?.choices.find((c) => c.label === label);
    if (ch) {
      p += ch.price_delta;
    } else {
      p += optionalUpgradeDelta(type, label);
    }
  }
  return p;
}

function optionalUpgradeDelta(type: string, label: string): number {
  return OPTIONAL_UPGRADES.find(
    (upgrade) => upgrade.type === type && upgrade.label === label,
  )?.priceDelta ?? 0;
}
