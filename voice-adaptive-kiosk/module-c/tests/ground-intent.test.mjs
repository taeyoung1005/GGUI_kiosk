import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fallbackGroundIntent,
  validateGroundIntent,
} from "../src/ground-intent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const menu = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "module-b", "data", "menu.seed.json"), "utf8"),
);

function baseRequest(overrides = {}) {
  return {
    step: "recommend",
    transcript: "",
    korean_text: "",
    english_proxy_text: "",
    menu_context: menu.items,
    selected_item: null,
    order_state: {
      selected_item_id: null,
      selected_item_name: null,
      selected_options: {},
      quantity: 1,
      fulfillment: null,
      loyalty: null,
      payment_method: null,
      total: 0,
    },
    ...overrides,
  };
}

test("validateGroundIntent removes hallucinated item ids and keeps DB-backed candidates", () => {
  const result = validateGroundIntent(
    {
      step: "recommend",
      intent: "select_item",
      item_candidates: [
        { item_id: "not-in-db", confidence: 0.99 },
        { item_id: "yuzu-tea-032", confidence: 0.88 },
      ],
      selected_options: {},
      fulfillment: null,
      loyalty: null,
      payment_method: null,
      confirm: null,
      needs_clarification: false,
      clarification_reason: null,
    },
    baseRequest(),
  );

  assert.deepEqual(result.item_candidates, [
    { item_id: "yuzu-tea-032", confidence: 0.88 },
  ]);
  assert.equal(result.needs_clarification, false);
});

test("fallbackGroundIntent maps Korean and romanized yuzu utterances to Yuzu Tea", () => {
  const result = fallbackGroundIntent(
    baseRequest({
      korean_text: "유자차 하나 주문해줘",
      english_proxy_text: "I would like a yuza tea, please.",
    }),
  );

  assert.equal(result.intent, "select_item");
  assert.equal(result.item_candidates[0].item_id, "yuzu-tea-032");
  assert.equal(result.needs_clarification, false);
});

test("fallbackGroundIntent maps cake utterances to dessert candidates", () => {
  const result = fallbackGroundIntent(
    baseRequest({
      korean_text: "딸기 케이크 하나 주문해줘",
      english_proxy_text: "I would like a strawberry cake, please.",
    }),
  );

  assert.equal(result.item_candidates[0].item_id, "strawberry-shortcake-046");
});

test("fallbackGroundIntent asks for clarification when the menu item does not exist", () => {
  const result = fallbackGroundIntent(
    baseRequest({
      korean_text: "없는 메뉴 주문해줘",
      english_proxy_text: "I would like a dragon fruit pizza, please.",
    }),
  );

  assert.equal(result.needs_clarification, true);
  assert.deepEqual(result.item_candidates, []);
});

test("fallbackGroundIntent maps option utterances to real option labels only", () => {
  const selected = menu.items.find((item) => item.id === "vanilla-latte-004");
  const icedLarge = fallbackGroundIntent(
    baseRequest({
      step: "options",
      transcript: "아이스 큰 사이즈",
      selected_item: selected,
      order_state: {
        selected_item_id: selected.id,
        selected_item_name: selected.name,
        selected_options: {},
        quantity: 1,
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        total: selected.price,
      },
    }),
  );
  const oatLessSweet = fallbackGroundIntent(
    baseRequest({
      step: "options",
      transcript: "오트밀크로 덜 달게",
      selected_item: selected,
      order_state: {
        selected_item_id: selected.id,
        selected_item_name: selected.name,
        selected_options: {},
        quantity: 1,
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        total: selected.price,
      },
    }),
  );

  assert.deepEqual(icedLarge.selected_options, { Temperature: "Iced", Size: "Large" });
  assert.deepEqual(oatLessSweet.selected_options, { Milk: "Oat Milk", Sweetness: "Less Sweet" });
});

test("validateGroundIntent keeps only option labels available on the selected item", () => {
  const selected = menu.items.find((item) => item.id === "vanilla-latte-004");
  const result = validateGroundIntent(
    {
      step: "options",
      intent: "set_options",
      item_candidates: [],
      selected_options: {
        Temperature: "Iced",
        Size: "Large",
        Milk: "Oat Milk",
        Sweetness: "Impossible Sweet",
      },
      fulfillment: null,
      loyalty: null,
      payment_method: null,
      confirm: null,
      needs_clarification: false,
      clarification_reason: null,
    },
    baseRequest({
      step: "options",
      selected_item: selected,
      order_state: {
        selected_item_id: selected.id,
        selected_item_name: selected.name,
        selected_options: {},
        quantity: 1,
        fulfillment: null,
        loyalty: null,
        payment_method: null,
        total: selected.price,
      },
    }),
  );

  assert.deepEqual(result.selected_options, {
    Temperature: "Iced",
    Size: "Large",
    Milk: "Oat Milk",
  });
});

test("fallbackGroundIntent maps fulfillment, loyalty, payment, and confirm by step", () => {
  assert.equal(
    fallbackGroundIntent(baseRequest({ step: "fulfillment", transcript: "포장할게요" })).fulfillment,
    "Take Out",
  );
  assert.equal(
    fallbackGroundIntent(baseRequest({ step: "loyalty", transcript: "적립 안 할게요" })).loyalty,
    "none",
  );
  assert.equal(
    fallbackGroundIntent(baseRequest({ step: "payment", transcript: "카드로 결제할게요" })).payment_method,
    "Credit Card",
  );
  assert.equal(
    fallbackGroundIntent(baseRequest({ step: "confirm", transcript: "네 결제해줘" })).confirm,
    "yes",
  );
});
