import test from "node:test";
import assert from "node:assert/strict";
import { resolveProfile } from "../src/adapt.js";
import { renderLocalHtml } from "../src/local-render.js";

const menu = [
  { id: "latte", name: "Caffe Latte", category: "Latte", price: 4500, image_url: "", desc: "Classic milk coffee", options: [] },
  { id: "vanilla", name: "Vanilla Latte", category: "Latte", price: 5000, image_url: "", desc: "Sweet vanilla", options: [] },
  { id: "matcha", name: "Matcha Latte", category: "Latte", price: 5200, image_url: "", desc: "Green tea latte", options: [] },
];

test("local render is always fixed at the senior-friendly mode with a coach panel and two choices", () => {
  const html = renderLocalHtml({
    step: "recommend",
    profile: resolveProfile(),
    candidates: menu,
    transcript: "라떼 한 잔 주세요",
  });

  assert.match(html, /age-mode-guided/);
  assert.match(html, /class="coach"/);
  assert.equal((html.match(/class="card /g) || []).length, 2);
  // 강도는 항상 고령자 최대 고정 — express/comfort 모드는 더 이상 없다.
  assert.doesNotMatch(html, /age-mode-express/);
  assert.doesNotMatch(html, /age-mode-comfort/);
});

test("local render uses Korean browser speech synthesis (no ElevenLabs proxy)", () => {
  const html = renderLocalHtml({
    step: "recommend",
    profile: resolveProfile(),
    candidates: menu,
    transcript: "라떼 한 잔 주세요",
  });

  assert.match(html, /u\.lang = "ko-KR"/);
  assert.doesNotMatch(html, /\/demo\/announcer-voice\/audio/);
  assert.doesNotMatch(html, /en-US/);
});

test("local render supports the full multi-turn kiosk steps", () => {
  const profile = resolveProfile();
  const item = {
    ...menu[1],
    options: [
      { type: "Temperature", choices: [{ label: "Hot", price_delta: 0 }, { label: "Iced", price_delta: 0 }] },
      { type: "Size", choices: [{ label: "Regular", price_delta: 0 }, { label: "Large", price_delta: 500 }] },
    ],
  };
  const orderState = {
    selected_item_id: item.id,
    selected_item_name: item.name,
    selected_options: { Temperature: "Iced", Size: "Large" },
    quantity: 1,
    fulfillment: "Take Out",
    loyalty: "none",
    payment_method: "Credit Card",
    total: 5500,
  };

  const fulfillment = renderLocalHtml({
    step: "fulfillment",
    profile,
    candidates: [item],
    item,
    orderState,
    transcript: "아이스 큰 사이즈",
    total: 5500,
  });
  const payment = renderLocalHtml({
    step: "payment",
    profile,
    candidates: [item],
    item,
    orderState,
    transcript: "적립 안 함",
    total: 5500,
  });
  const confirm = renderLocalHtml({
    step: "confirm",
    profile,
    candidates: [item],
    item,
    orderState,
    selectedOptions: orderState.selected_options,
    transcript: "카드",
    total: 5500,
  });

  assert.match(fulfillment, /3\. 장소/);
  assert.match(fulfillment, /data-action="setFulfillment"/);
  assert.match(payment, /5\. 결제/);
  assert.match(payment, /data-action="setPayment"/);
  // 확인 화면 요약은 한국어 라벨로 표시되지만 코드 값은 data-value 로 유지.
  assert.match(confirm, /포장/);
  assert.match(confirm, /포인트 없음/);
  assert.match(confirm, /신용카드/);
});

test("local render has step-specific fulfillment controls", () => {
  const html = renderLocalHtml({
    step: "fulfillment",
    profile: resolveProfile(),
    candidates: menu,
    item: menu[0],
    transcript: "take out",
    orderState: { selected_options: {}, quantity: 1, total: 4500 },
  });

  assert.match(html, /data-action="setFulfillment"/);
  assert.match(html, /data-value="Dine In"/);
  assert.match(html, /data-value="Take Out"/);
  assert.doesNotMatch(html, /data-action="selectMenu"/);
});

test("local render has step-specific loyalty controls", () => {
  const html = renderLocalHtml({
    step: "loyalty",
    profile: resolveProfile(),
    candidates: menu,
    item: menu[0],
    transcript: "skip points",
    orderState: { fulfillment: "Take Out", selected_options: {}, quantity: 1, total: 4500 },
  });

  assert.match(html, /data-action="setLoyalty"/);
  assert.match(html, /data-value="scan"/);
  assert.match(html, /data-value="phone"/);
  assert.match(html, /data-value="none"/);
  assert.doesNotMatch(html, /data-action="selectMenu"/);
});

test("local render has step-specific payment controls", () => {
  const html = renderLocalHtml({
    step: "payment",
    profile: resolveProfile(),
    candidates: menu,
    item: menu[0],
    transcript: "credit card",
    orderState: { fulfillment: "Take Out", loyalty: "none", selected_options: {}, quantity: 1, total: 4500 },
  });

  assert.match(html, /data-action="setPayment"/);
  assert.match(html, /data-value="Credit Card"/);
  assert.match(html, /data-value="Kakao Pay"/);
  assert.match(html, /data-value="Pay at Counter"/);
  assert.doesNotMatch(html, /data-action="selectMenu"/);
});
