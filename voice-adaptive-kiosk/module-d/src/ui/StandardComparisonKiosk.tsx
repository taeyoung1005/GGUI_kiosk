import { useEffect, useMemo, useState } from "react";
import type { Menu, MenuItem } from "@contracts/types";
import type { FlowState } from "../flow/orchestrator";
import { USE_MOCK, getMenu, menuAssetUrl } from "../api/client";
import { won } from "./emoji";
import { KIOSK_PROGRESS_STEPS, progressIndexForStep } from "./kioskProgress";

export default function StandardComparisonKiosk({ state }: { state: FlowState }) {
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    getMenu().then(setMenu).catch(() => setMenu(null));
  }, []);

  const fallbackItem = useMemo(
    () => state.selectedItem ?? state.candidates[0] ?? menu?.items.find((item) => /latte/i.test(item.name)) ?? menu?.items[0] ?? null,
    [menu, state.candidates, state.selectedItem],
  );
  const stepIndex = progressIndexForStep(state.step);

  if (!menu) {
    return (
      <div className="standard-compare loading">
        <div className="spinner" />
        <strong>Loading the standard kiosk path...</strong>
      </div>
    );
  }

  return (
    <section className="standard-compare">
      <div className="standard-compare-top">
        <div>
          <strong>Standard path: {KIOSK_PROGRESS_STEPS[stepIndex]?.label ?? "Menu"}</strong>
          <span>Same order stage, with the original kiosk decisions still exposed.</span>
        </div>
        <span className="queue-pill">6-step checkout</span>
      </div>

      <div className="standard-mini-rail" aria-label="Standard kiosk comparison steps">
        {KIOSK_PROGRESS_STEPS.map((step, index) => (
          <span key={step.key} className={index === stepIndex ? "active" : index < stepIndex ? "done" : ""}>
            <b>{index + 1}</b>
            {step.label}
          </span>
        ))}
      </div>

      {state.step === "recommend" && <MenuBrowse menu={menu} candidates={state.candidates} />}
      {state.step === "options" && fallbackItem && <OptionsFriction item={fallbackItem} state={state} />}
      {state.step === "fulfillment" && <FulfillmentFriction />}
      {state.step === "loyalty" && <LoyaltyFriction />}
      {state.step === "payment" && <PaymentFriction total={state.orderState.total} />}
      {state.step === "confirm" && fallbackItem && <ReviewFriction item={fallbackItem} state={state} />}
    </section>
  );
}

function MenuBrowse({ menu, candidates }: { menu: Menu; candidates: MenuItem[] }) {
  const featured = candidates.length ? candidates : menu.items.slice(0, 8);
  return (
    <div className="standard-compare-body browse">
      <aside className="standard-compare-cats">
        {["All", ...menu.categories].slice(0, 7).map((category, index) => (
          <button key={category} className={index === 0 ? "active" : ""}>
            {category}
            <small>{category === "All" ? menu.items.length : menu.items.filter((item) => item.category === category).length}</small>
          </button>
        ))}
      </aside>
      <main className="standard-compare-grid">
        <div className="standard-compare-alert">Promotions, categories, cart, paging, and checkout compete for attention before the order is clear.</div>
        <div className="standard-menu-grid">
          {featured.slice(0, 8).map((item) => (
            <article key={item.id} className="standard-mini-card">
              <img src={USE_MOCK ? item.image_url : menuAssetUrl(item.image_url)} alt="" aria-hidden="true" />
              <strong>{item.name}</strong>
              <span>{won(item.price)}</span>
            </article>
          ))}
        </div>
      </main>
      <aside className="standard-compare-cart">
        <strong>My Order</strong>
        <p>No item selected yet.</p>
        <button disabled>Checkout</button>
        <small>Review {"->"} Points {"->"} Payment</small>
      </aside>
    </div>
  );
}

function OptionsFriction({ item, state }: { item: MenuItem; state: FlowState }) {
  return (
    <div className="standard-compare-body options">
      <section className="standard-product-card">
        <img src={USE_MOCK ? item.image_url : menuAssetUrl(item.image_url)} alt="" aria-hidden="true" />
        <h3>{item.name}</h3>
        <p>Required options are separated from upgrades and price changes.</p>
      </section>
      <section className="standard-option-stack">
        {item.options.map((option) => (
          <div key={option.type} className="standard-option-box">
            <div>
              <strong>{option.type}</strong>
              <small>Required</small>
            </div>
            <div className="standard-choice-row">
              {option.choices.map((choice) => (
                <span key={choice.label} className={state.selectedOptions[option.type] === choice.label ? "selected" : ""}>
                  {choice.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </section>
      <aside className="standard-upgrade-stack">
        <strong>Optional upgrades</strong>
        <span>Set dessert +₩3,000</span>
        <span>Large combo +₩1,500</span>
        <span>Extra shot +₩500</span>
      </aside>
    </div>
  );
}

function FulfillmentFriction() {
  return (
    <div className="standard-decision-wall">
      <h3>Choose where to receive the order</h3>
      <div className="standard-two-buttons">
        <button>Eat In</button>
        <button className="active">Take Out</button>
      </div>
      <p>Traditional kiosks often ask this as a separate checkpoint after item options.</p>
    </div>
  );
}

function LoyaltyFriction() {
  return (
    <div className="standard-decision-wall">
      <h3>Coupons and points</h3>
      <div className="standard-three-buttons">
        <button>App Coupon QR</button>
        <button>Earn Points</button>
        <button className="active">Skip</button>
      </div>
      <div className="scanner-note">Scanner, phone number keypad, and skip action are all shown before payment.</div>
    </div>
  );
}

function PaymentFriction({ total }: { total: number }) {
  return (
    <div className="standard-decision-wall">
      <h3>Select payment method</h3>
      <div className="standard-four-buttons">
        <button className="active">Credit Card</button>
        <button>Gift Card</button>
        <button>Kakao Pay</button>
        <button>Naver Pay</button>
      </div>
      <div className="reader-note">Total {won(total || 0)} · Card reader instructions appear after the method is selected.</div>
    </div>
  );
}

function ReviewFriction({ item, state }: { item: MenuItem; state: FlowState }) {
  return (
    <div className="standard-review-wall">
      <h3>Final review</h3>
      <div className="standard-review-line">
        <span>{item.name}</span>
        <strong>{won(state.orderState.total || item.price)}</strong>
      </div>
      <div className="standard-review-tags">
        <span>{state.orderState.fulfillment ?? "Place not selected"}</span>
        <span>{state.orderState.loyalty === "none" ? "No points" : state.orderState.loyalty ?? "Points not selected"}</span>
        <span>{state.orderState.payment_method ?? "Payment not selected"}</span>
      </div>
      <div className="standard-two-buttons">
        <button>Back</button>
        <button className="active">Pay</button>
      </div>
    </div>
  );
}
