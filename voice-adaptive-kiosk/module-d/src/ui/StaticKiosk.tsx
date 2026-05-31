// src/ui/StaticKiosk.tsx
//
// 일반 키오스크 UI — 데모의 "before" + GGUI 실패 시 폴백.
// 평범하지만 동작하는 주문 UI: 카테고리 탭 + 빽빽한 메뉴 그리드 + 옵션 모달 없이
// 간단 선택 → 주문. assist 적응 없음(의도적으로 작은 글씨/조밀).
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

const PAGE_SIZE = 8;
const PAYMENT_METHODS: PaymentMethod[] = [
  "Credit Card",
  "Gift Card",
  "Kakao Pay",
  "Naver Pay",
  "Pay at Counter",
];

const DECISION_STEPS = [
  "Place",
  "Menu",
  "Options",
  "Review",
  "Points",
  "Pay",
] as const;

const OPTIONAL_UPGRADES = [
  { type: "Set Upgrade", label: "Set dessert", priceDelta: 3000 },
  { type: "Combo Upgrade", label: "Large size combo", priceDelta: 1500 },
  { type: "Add-on", label: "Extra shot", priceDelta: 500 },
] as const;

export default function StaticKiosk() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState<string>("All");
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
    return cat === "All"
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
        <div className="big">Loading menu...</div>
      </div>
    );
  }

  if (phase === "paying") {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">Processing payment...</div>
        <p className="hint">Please wait a moment.</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="overlay">
        <div className="done-check">✅</div>
        <div className="big">Payment Complete</div>
        <p className="hint">
          Order <b>{orderNo}</b> · Total {won(total)}
        </p>
        <button className="btn-primary" onClick={restart}>
          Start Over
        </button>
      </div>
    );
  }

  if (phase === "start") {
    return (
      <div className="static-start">
        <div className="kiosk-red-strip">ORDER HERE</div>
        <h2>Where will you enjoy your order?</h2>
        <p>Choose one before browsing the menu.</p>
        <div className="fulfillment-cards">
          <button
            onClick={() => {
              setFulfillment("Dine In");
              setPhase("browse");
            }}
          >
            <span>Eat In</span>
            <small>Use a table number later</small>
          </button>
          <button
            onClick={() => {
              setFulfillment("Take Out");
              setPhase("browse");
            }}
          >
            <span>Take Out</span>
            <small>Pack order to go</small>
          </button>
        </div>
        <div className="static-legal-row">
          <span>Card payment only at this kiosk</span>
          <span>Receipt prints after payment</span>
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
          Selected item is locked to this option step. Price can change before it is added to the cart.
        </div>
        <div className="option-progress">
          <span className="active">1 Required Options</span>
          <span>2 Set Upgrade</span>
          <span>3 Add-ons</span>
        </div>
        <div className="price-change-note">
          Required options and upgrades are priced separately. Check the updated total before adding.
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
              <span>Base</span>
              <strong>{won(selected.price)}</strong>
            </div>
            <div className="mini-summary">
              <span>Current</span>
              <strong>{won(cur)}</strong>
            </div>
          </aside>

          <main className="option-main-panel">
            {selected.options.length === 0 && (
              <p className="hint">No options to choose.</p>
            )}

            {selected.options.map((opt) => (
              <div className="option-group static-option-group" key={opt.type}>
                <div className="o-label static-label">
                  <span>{opt.type}</span>
                  <small>Required</small>
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
            <h3>Optional upgrades</h3>
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
              <strong>Allergy Info</strong>
              <span>Milk · Caffeine may be included.</span>
            </div>
          </aside>
        </div>

        <div className="confirm-box static-confirm">
          <div className="c-total static-total">
            <span>Total</span>
            <span>{won(cur)}</span>
          </div>
        </div>

        <div className="static-actions">
          <button
            className="mic-btn secondary"
            onClick={() => setPhase("browse")}
          >
            Back to Menu
          </button>
          <button className="btn-primary" onClick={addSelectedToCart}>
            Add to Order
          </button>
        </div>
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
            <h2>Review your order</h2>
            <p>{fulfillment} · {cart.length} item types</p>
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
            Add More
          </button>
          <button
            className="btn-primary"
            disabled={cart.length === 0}
            onClick={() => setPhase("loyalty")}
          >
            Continue
          </button>
        </div>
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
            <h2>Coupons and points</h2>
            <p>Scan a reward code or skip to payment.</p>
          </div>
        </div>
        <div className="loyalty-grid">
          {[
            ["scan", "App Coupon", "Scan QR code from the app"],
            ["phone", "Earn Points", "Enter phone number"],
            ["none", "Skip", "No coupon or points"],
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
            <p>{loyalty === "scan" ? "Hold the app coupon near the scanner." : "Enter phone number on the keypad below."}</p>
            {loyalty === "phone" && <div className="fake-keypad">010 - ____ - ____</div>}
          </div>
        )}
        <div className="static-actions">
          <button className="mic-btn secondary" onClick={() => setPhase("review")}>
            Back
          </button>
          <button className="btn-primary" onClick={() => setPhase("payment")}>
            Continue to Payment
          </button>
        </div>
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
            <h2>Select payment method</h2>
            <p>Total {won(payableTotal)} · {fulfillment}</p>
          </div>
        </div>
        <div className="payment-grid">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              className={paymentMethod === method ? "selected" : ""}
              onClick={() => setPaymentMethod(method)}
            >
              <span>{method}</span>
              <small>{method === "Credit Card" ? "Insert or tap card below" : "Select and follow the next instruction"}</small>
            </button>
          ))}
        </div>
        <div className="reader-panel">
          <div className="reader-slot" />
          <div>
            <strong>{paymentMethod}</strong>
            <p>{paymentMethod === "Credit Card" ? "Tap or insert your card at the reader." : "A confirmation screen may appear before payment."}</p>
          </div>
        </div>
        <div className="static-actions">
          <button className="mic-btn secondary" onClick={() => setPhase("loyalty")}>
            Back
          </button>
          <button className="btn-primary" onClick={pay}>
            Pay {won(payableTotal)}
          </button>
        </div>
      </div>
    );
  }

  // browse
  return (
    <div className="standard-kiosk">
      <div className="standard-top">
        <div>
          <strong>{fulfillment}</strong>
          <span>Choose from {menu.items.length} items, then move through review, points, and payment.</span>
        </div>
        <button onClick={() => setPhase("start")}>Change</button>
      </div>

      <DecisionRail phase={phase} />

      <div className="flow-friction-note">
        Standard kiosk flow separates menu browsing, option selection, order review, rewards, and payment into different screens.
      </div>

      <div className="standard-body">
        <aside className="category-rail">
          {["All", ...menu.categories].map((c) => (
            <button
              key={c}
              className={c === cat ? "active" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
              <small>{c === "All" ? menu.items.length : menu.items.filter((i) => i.category === c).length}</small>
            </button>
          ))}
        </aside>

        <main className="menu-browser">
          <div className="menu-step-note">
            <b>Step 2 · Browse menu</b>
            <span>{cat} · {items.length} items · page {page + 1} of {pageCount}</span>
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
              Previous
            </button>
            <span>
              Page {page + 1} / {pageCount}
            </span>
            <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}>
              Next
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
            Checkout
          </button>
          <div className="side-help">
            <span>Review</span>
            <span>Points</span>
            <span>Payment</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DecisionRail({ phase }: { phase: Phase }) {
  const active = stepIndexForPhase(phase);
  return (
    <div className="decision-rail" aria-label="Standard kiosk order steps">
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
        <strong>My Order</strong>
        <span>{cart.reduce((sum, line) => sum + line.qty, 0)} items</span>
      </div>
      {cart.length === 0 ? (
        <p className="empty-cart">No items selected.</p>
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
        <span>Total</span>
        <strong>{won(total)}</strong>
      </div>
    </div>
  );
}

function formatOptionSummary(opts: Record<string, string>): string {
  const values = Object.values(opts).filter(Boolean);
  return values.length ? values.join(" · ") : "Default";
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
