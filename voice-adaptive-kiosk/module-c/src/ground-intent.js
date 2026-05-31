const VALID_STEPS = new Set(["recommend", "options", "fulfillment", "loyalty", "payment", "confirm"]);
const VALID_FULFILLMENT = new Set(["Dine In", "Take Out"]);
const VALID_LOYALTY = new Set(["scan", "phone", "none"]);
const VALID_PAYMENT = new Set(["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"]);
const VALID_CONFIRM = new Set(["yes", "no", "change"]);

const MENU_ALIASES = {
  "yuzu-tea-032": ["유자", "유자차", "yuzu", "yuza", "yuja", "citron"],
  "salt-bread-041": ["소금빵", "소금 빵", "salt bread", "saltbread"],
  "strawberry-shortcake-046": ["딸기", "딸기케이크", "딸기 케이크", "strawberry cake", "shortcake", "cake"],
  "caffe-latte-003": ["라떼", "카페라떼", "cafe latte", "caffe latte", "latte"],
  "vanilla-latte-004": ["바닐라라떼", "바닐라 라떼", "vanilla latte"],
  "matcha-latte-005": ["말차", "녹차라떼", "녹차 라떼", "matcha", "matcha latte"],
};

export async function groundIntent(request, env = {}, { fetchImpl = fetch } = {}) {
  if (!env.OPENAI_API_KEY) return fallbackGroundIntent(request);
  try {
    const raw = await callOpenAIGrounding(request, env, fetchImpl);
    return validateGroundIntent(raw, request);
  } catch {
    return fallbackGroundIntent(request);
  }
}

export function validateGroundIntent(raw, request) {
  const step = VALID_STEPS.has(raw?.step) ? raw.step : normalizeStep(request.step);
  const menuItems = Array.isArray(request.menu_context) ? request.menu_context.filter(Boolean) : [];
  const byId = new Map(menuItems.map((item) => [item.id, item]));
  const itemCandidates = Array.isArray(raw?.item_candidates)
    ? raw.item_candidates
        .map((candidate) => ({
          item_id: String(candidate?.item_id || ""),
          confidence: clamp01(candidate?.confidence),
        }))
        .filter((candidate) => byId.has(candidate.item_id))
        .slice(0, 5)
    : [];
  const selectedItem = request.selected_item || byId.get(request.order_state?.selected_item_id) || null;
  const selectedOptions = validateOptions(raw?.selected_options, selectedItem);
  const fulfillment = VALID_FULFILLMENT.has(raw?.fulfillment) ? raw.fulfillment : null;
  const loyalty = VALID_LOYALTY.has(raw?.loyalty) ? raw.loyalty : null;
  const paymentMethod = VALID_PAYMENT.has(raw?.payment_method) ? raw.payment_method : null;
  const confirm = VALID_CONFIRM.has(raw?.confirm) ? raw.confirm : null;
  const intent = normalizeIntent(raw?.intent, {
    step,
    itemCandidates,
    selectedOptions,
    fulfillment,
    loyalty,
    paymentMethod,
    confirm,
  });
  const needsClarification = Boolean(raw?.needs_clarification) || (step === "recommend" && itemCandidates.length === 0);
  return {
    step,
    intent,
    item_candidates: itemCandidates,
    selected_options: selectedOptions,
    fulfillment,
    loyalty,
    payment_method: paymentMethod,
    confirm,
    needs_clarification: needsClarification,
    clarification_reason:
      typeof raw?.clarification_reason === "string" && raw.clarification_reason.trim()
        ? raw.clarification_reason.trim()
        : needsClarification
          ? "Could not map the utterance to a menu or action."
          : null,
  };
}

export function fallbackGroundIntent(request) {
  const step = normalizeStep(request.step);
  const text = intentText(request);
  const response = baseResponse(step);
  if (step === "recommend") {
    const ranked = rankMenuItems(request.menu_context || [], text)
      .filter((entry) => entry.score >= 20)
      .slice(0, 5)
      .map((entry) => ({ item_id: entry.item.id, confidence: Math.min(0.95, 0.55 + entry.score / 100) }));
    return validateGroundIntent(
      {
        ...response,
        intent: ranked.length ? "select_item" : "unknown",
        item_candidates: ranked,
        needs_clarification: ranked.length === 0,
      },
      request,
    );
  }
  if (step === "options") {
    return validateGroundIntent(
      {
        ...response,
        intent: "set_options",
        selected_options: matchOptions(text, request.selected_item),
      },
      request,
    );
  }
  if (step === "fulfillment") {
    return validateGroundIntent({ ...response, intent: "set_fulfillment", fulfillment: matchFulfillment(text) }, request);
  }
  if (step === "loyalty") {
    return validateGroundIntent({ ...response, intent: "set_loyalty", loyalty: matchLoyalty(text) }, request);
  }
  if (step === "payment") {
    return validateGroundIntent({ ...response, intent: "set_payment", payment_method: matchPayment(text) }, request);
  }
  if (step === "confirm") {
    return validateGroundIntent({ ...response, intent: "confirm", confirm: matchConfirm(text) }, request);
  }
  return validateGroundIntent(response, request);
}

export function normalizeGroundIntentRequest(body = {}) {
  return {
    step: normalizeStep(body.step),
    transcript: String(body.transcript ?? ""),
    menu_context: Array.isArray(body.menu_context) ? body.menu_context : [],
    selected_item: body.selected_item && typeof body.selected_item === "object" ? body.selected_item : null,
    order_state: body.order_state && typeof body.order_state === "object" ? body.order_state : {},
  };
}

async function callOpenAIGrounding(request, env, fetchImpl) {
  const res = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildOpenAIRequest(request, env)),
  });
  if (!res.ok) throw new Error(`OpenAI grounding failed: ${res.status}`);
  const payload = await res.json();
  return JSON.parse(extractOutputText(payload));
}

function buildOpenAIRequest(request, env) {
  return {
    model: env.GROUND_INTENT_MODEL || "gpt-4.1-mini",
    temperature: 0,
    max_output_tokens: 900,
    instructions:
      "You map a cafe kiosk voice utterance to existing menu and order actions. " +
      "Return only structured JSON. Use only item_id and option labels that exist in the provided menu data. " +
      "If uncertain, set needs_clarification true instead of inventing values.",
    input: JSON.stringify({
      step: request.step,
      transcript: request.transcript,
      selected_item: request.selected_item,
      order_state: request.order_state,
      menu_context: slimMenu(request.menu_context),
      allowed: {
        fulfillment: [...VALID_FULFILLMENT],
        loyalty: [...VALID_LOYALTY],
        payment_method: [...VALID_PAYMENT],
        confirm: [...VALID_CONFIRM],
      },
    }),
    text: {
      format: {
        type: "json_schema",
        name: "ground_intent",
        strict: true,
        schema: groundIntentSchema(),
      },
    },
  };
}

function groundIntentSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "step",
      "intent",
      "item_candidates",
      "selected_options",
      "fulfillment",
      "loyalty",
      "payment_method",
      "confirm",
      "needs_clarification",
      "clarification_reason",
    ],
    properties: {
      step: { type: "string", enum: [...VALID_STEPS] },
      intent: {
        type: "string",
        enum: [
          "select_item",
          "set_options",
          "set_fulfillment",
          "set_loyalty",
          "set_payment",
          "confirm",
          "change",
          "cancel",
          "unknown",
        ],
      },
      item_candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item_id", "confidence"],
          properties: {
            item_id: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      selected_options: { type: "object", additionalProperties: { type: "string" } },
      fulfillment: { type: ["string", "null"], enum: ["Dine In", "Take Out", null] },
      loyalty: { type: ["string", "null"], enum: ["scan", "phone", "none", null] },
      payment_method: {
        type: ["string", "null"],
        enum: ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter", null],
      },
      confirm: { type: ["string", "null"], enum: ["yes", "no", "change", null] },
      needs_clarification: { type: "boolean" },
      clarification_reason: { type: ["string", "null"] },
    },
  };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const out of payload?.output || []) {
    for (const content of out?.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) return content.text;
    }
  }
  throw new Error("OpenAI response did not include JSON text.");
}

function slimMenu(items = []) {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    desc: item.desc,
    price: item.price,
    options: (item.options || []).map((opt) => ({
      type: opt.type,
      choices: (opt.choices || []).map((choice) => choice.label),
    })),
  }));
}

function validateOptions(rawOptions, selectedItem) {
  if (!selectedItem || !rawOptions || typeof rawOptions !== "object") return {};
  const patch = {};
  for (const opt of selectedItem.options || []) {
    const rawValue = findCaseInsensitive(rawOptions, opt.type);
    if (rawValue == null) continue;
    const choice = (opt.choices || []).find((candidate) => normalize(candidate.label) === normalize(rawValue));
    if (choice) patch[opt.type] = choice.label;
  }
  return patch;
}

function matchOptions(text, selectedItem) {
  if (!selectedItem) return {};
  const patch = {};
  for (const opt of selectedItem.options || []) {
    for (const choice of opt.choices || []) {
      if (text.includes(normalize(choice.label)) || optionAliasHit(text, opt.type, choice.label)) {
        patch[opt.type] = choice.label;
        break;
      }
    }
  }
  return patch;
}

function rankMenuItems(items, text) {
  const tokens = text.split(" ").filter((token) => token.length >= 2);
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({ item, index, score: scoreMenuItem(item, text, tokens) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function scoreMenuItem(item, text, tokens) {
  const haystack = normalize(`${item.id} ${item.name} ${item.category} ${item.desc || ""}`);
  let score = 0;
  for (const alias of MENU_ALIASES[item.id] || []) {
    if (text.includes(normalize(alias))) score += 100;
  }
  const itemName = normalize(item.name);
  if (itemName && text.includes(itemName)) score += 90;
  for (const token of tokens) {
    if (["would", "like", "please", "order", "하나", "주문", "줘", "해주세요"].includes(token)) continue;
    if (haystack.includes(token)) score += token.length >= 5 ? 10 : 6;
  }
  return score;
}

function matchFulfillment(text) {
  if (hasAny(text, ["take out", "to go", "carry out", "포장", "테이크아웃"])) return "Take Out";
  if (hasAny(text, ["dine", "eat in", "here", "매장", "먹고", "먹을"])) return "Dine In";
  return null;
}

function matchLoyalty(text) {
  if (hasAny(text, ["skip", "no", "none", "pass", "건너", "안 할", "안해", "없어"])) return "none";
  if (hasAny(text, ["coupon", "qr", "쿠폰"])) return "scan";
  if (hasAny(text, ["point", "phone", "earn", "적립", "번호"])) return "phone";
  return null;
}

function matchPayment(text) {
  if (hasAny(text, ["kakao", "카카오"])) return "Kakao Pay";
  if (hasAny(text, ["naver", "네이버"])) return "Naver Pay";
  if (hasAny(text, ["gift", "voucher", "선불", "상품권"])) return "Gift Card";
  if (hasAny(text, ["counter", "cash", "현금", "카운터"])) return "Pay at Counter";
  if (hasAny(text, ["card", "credit", "카드"])) return "Credit Card";
  return null;
}

function matchConfirm(text) {
  if (hasAny(text, ["yes", "pay", "confirm", "correct", "네", "맞", "결제", "응"])) return "yes";
  if (hasAny(text, ["no", "change", "아니", "수정", "바꿀"])) return "change";
  return null;
}

function optionAliasHit(text, type, label) {
  const normalizedType = normalize(type);
  const normalizedLabel = normalize(label);
  // 온도(temperature)
  if (normalizedType.includes("온도") || normalizedType.includes("temperature")) {
    if (normalizedLabel.includes("차갑") || normalizedLabel === "iced")
      return hasAny(text, ["ice", "iced", "cold", "아이스", "차갑", "차가운"]);
    if (normalizedLabel.includes("뜨겁") || normalizedLabel === "hot")
      return hasAny(text, ["hot", "warm", "따뜻", "뜨거"]);
  }
  // 사이즈(size)
  if (normalizedType.includes("사이즈") || normalizedType.includes("size")) {
    if (normalizedLabel.includes("크게") || normalizedLabel === "large")
      return hasAny(text, ["large", "big", "큰", "크게", "라지"]);
    if (normalizedLabel.includes("기본") || normalizedLabel === "regular")
      return hasAny(text, ["regular", "normal", "보통", "기본"]);
  }
  // 우유(milk)
  if (normalizedType.includes("우유") || normalizedType.includes("milk")) {
    if (normalizedLabel.includes("오트") || normalizedLabel.includes("oat"))
      return hasAny(text, ["oat", "oat milk", "오트", "오트밀크", "오트 우유"]);
    if (normalizedLabel.includes("저지방"))
      return hasAny(text, ["저지방", "low fat", "skim"]);
  }
  // 당도(sweetness)
  if (normalizedType.includes("당도") || normalizedType.includes("sweet")) {
    if (normalizedLabel.includes("덜") || normalizedLabel.includes("less"))
      return hasAny(text, ["less", "덜", "덜 달", "not too sweet"]);
    if (normalizedLabel.includes("더") || normalizedLabel.includes("extra"))
      return hasAny(text, ["extra sweet", "더 달게", "더 달", "달게"]);
  }
  return false;
}

function normalizeIntent(intent, values) {
  if (["change", "cancel", "unknown"].includes(intent)) return intent;
  if (values.step === "recommend" && values.itemCandidates.length) return "select_item";
  if (values.step === "options" && Object.keys(values.selectedOptions).length) return "set_options";
  if (values.step === "fulfillment" && values.fulfillment) return "set_fulfillment";
  if (values.step === "loyalty" && values.loyalty) return "set_loyalty";
  if (values.step === "payment" && values.paymentMethod) return "set_payment";
  if (values.step === "confirm" && values.confirm) return "confirm";
  return intent || "unknown";
}

function baseResponse(step) {
  return {
    step,
    intent: "unknown",
    item_candidates: [],
    selected_options: {},
    fulfillment: null,
    loyalty: null,
    payment_method: null,
    confirm: null,
    needs_clarification: false,
    clarification_reason: null,
  };
}

function intentText(request) {
  return normalize([request.transcript].filter(Boolean).join(" "));
}

function normalizeStep(step) {
  return VALID_STEPS.has(step) ? step : "recommend";
}

function findCaseInsensitive(obj, key) {
  const target = normalize(key);
  for (const [k, v] of Object.entries(obj || {})) {
    if (normalize(k) === target) return v;
  }
  return undefined;
}

function hasAny(text, values) {
  return values.some((value) => text.includes(normalize(value)));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
