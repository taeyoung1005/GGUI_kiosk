import test from "node:test";
import assert from "node:assert/strict";
import { resolveProfile } from "../src/adapt.js";
import { renderLocalHtml } from "../src/local-render.js";

const menu = [
  { id: "latte", name: "Caffe Latte", category: "Latte", price: 4500, image_url: "", desc: "Classic milk coffee", options: [] },
  { id: "vanilla", name: "Vanilla Latte", category: "Latte", price: 5000, image_url: "", desc: "Sweet vanilla", options: [] },
  { id: "matcha", name: "Matcha Latte", category: "Latte", price: 5200, image_url: "", desc: "Green tea latte", options: [] },
];

test("senior high-assist local render has a guided mode, coach panel, and two choices", () => {
  const html = renderLocalHtml({
    step: "recommend",
    profile: resolveProfile({ age_group: "senior_adult", assist_level: 2 }),
    candidates: menu,
    transcript: "Can I get a latte",
  });

  assert.match(html, /age-mode-guided/);
  assert.match(html, /class="coach"/);
  assert.equal((html.match(/class="card /g) || []).length, 2);
});

test("young low-assist local render has an express mode and three choices", () => {
  const html = renderLocalHtml({
    step: "recommend",
    profile: resolveProfile({ age_group: "young_adult", assist_level: 0 }),
    candidates: menu,
    transcript: "Can I get a latte",
  });

  assert.match(html, /age-mode-express/);
  assert.equal((html.match(/class="card /g) || []).length, 3);
});

test("guided local render requests ElevenLabs announcer narration with browser fallback", () => {
  const html = renderLocalHtml({
    step: "recommend",
    profile: resolveProfile({ age_group: "senior_adult", assist_level: 2 }),
    candidates: menu,
    transcript: "Can I get a latte",
  });

  assert.match(html, /\/demo\/announcer-voice\/audio/);
  assert.match(html, /u\.rate = 1\.0/);
  assert.doesNotMatch(html, /u\.rate = 0\.9/);
});

test("local render supports the full multi-turn kiosk steps", () => {
  const profile = resolveProfile({ age_group: "senior_adult", assist_level: 2 });
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
    transcript: "iced large",
    total: 5500,
  });
  const payment = renderLocalHtml({
    step: "payment",
    profile,
    candidates: [item],
    item,
    orderState,
    transcript: "skip points",
    total: 5500,
  });
  const confirm = renderLocalHtml({
    step: "confirm",
    profile,
    candidates: [item],
    item,
    orderState,
    selectedOptions: orderState.selected_options,
    transcript: "card",
    total: 5500,
  });

  assert.match(fulfillment, /3\. Place/);
  assert.match(fulfillment, /data-action="setFulfillment"/);
  assert.match(payment, /5\. Pay/);
  assert.match(payment, /data-action="setPayment"/);
  assert.match(confirm, /Take Out/);
  assert.match(confirm, /No points/);
  assert.match(confirm, /Credit Card/);
});

test("local render has step-specific fulfillment controls", () => {
  const html = renderLocalHtml({
    step: "fulfillment",
    profile: resolveProfile({ age_group: "senior_adult", assist_level: 2 }),
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
    profile: resolveProfile({ age_group: "senior_adult", assist_level: 2 }),
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
    profile: resolveProfile({ age_group: "senior_adult", assist_level: 2 }),
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
