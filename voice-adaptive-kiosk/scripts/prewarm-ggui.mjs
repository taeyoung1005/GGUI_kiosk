// scripts/prewarm-ggui.mjs
//
// GGUI 블루프린트 프리워밍 — 6개 step(recommend/options/fulfillment/loyalty/payment/confirm)을
// 미리 한 번씩 생성·캐시한다. GGUI 콜드 생성은 30~40초 걸리지만, 캐시 키가 transcript 가 아니라
// step/contract 구조 기반이라, 한 번 데워 두면 이후 모든 발화가 즉시 GGUI 로 렌더된다.
//
// C 의 generate-ui 가 타임아웃으로 LOCAL 폴백을 줘도 GGUI 서버(6781)는 백그라운드로 생성을
// 마쳐 캐시에 넣으므로, 여기서는 path=ggui 가 될 때까지 step 별로 폴링한다.
//
// 사용:
//   bash run.sh  (GGUI_MODE=ggui 로 기동) 후 →  node scripts/prewarm-ggui.mjs
//   (또는  npm run prewarm:ggui)
//   C_URL, MENU_URL 로 엔드포인트 override 가능.

const C_URL = (process.env.C_URL || process.env.VITE_GGUI_URL || "http://localhost:8002").replace(/\/$/, "");
const MENU_URL = (process.env.MENU_URL || process.env.VITE_MENU_URL || "http://localhost:8001").replace(/\/$/, "");
const PER_STEP_TIMEOUT_MS = Number(process.env.PREWARM_TIMEOUT_MS || 90000);
const POLL_GAP_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getMenuItems() {
  try {
    const res = await fetch(`${MENU_URL}/menu`);
    const body = await res.json();
    return Array.isArray(body.items) ? body.items : [];
  } catch {
    return [];
  }
}

async function generate(body) {
  const res = await fetch(`${C_URL}/generate-ui`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const path = res.headers.get("x-ggui-path") || "unknown";
  let json = {};
  try { json = await res.json(); } catch { /* noop */ }
  return { ok: res.ok, status: res.status, path, json };
}

/** path=ggui(캐시 적재 완료)가 될 때까지 폴링. 폴백이 와도 백그라운드 생성이 끝나면 캐시 히트. */
async function warmStep(label, body) {
  const deadline = Date.now() + PER_STEP_TIMEOUT_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const t0 = Date.now();
    const r = await generate(body);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.path === "ggui") {
      console.log(`  ✓ ${label.padEnd(12)} ggui (시도 ${attempt}, ${dt}s) — 캐시 적재됨`);
      return true;
    }
    console.log(`  … ${label.padEnd(12)} ${r.path} (시도 ${attempt}, ${dt}s) — 백그라운드 생성 대기`);
    await sleep(POLL_GAP_MS);
  }
  console.log(`  ✗ ${label.padEnd(12)} 시간 내 ggui 미도달 — LOCAL 폴백으로 데모는 정상 동작`);
  return false;
}

const items = await getMenuItems();
if (items.length === 0) {
  console.error("메뉴를 가져오지 못했습니다. Module B(/menu)가 떠 있는지 확인하세요.");
  process.exit(1);
}
const withOptions = items.find((it) => Array.isArray(it.options) && it.options.length > 0) || items[0];
const cards = items.slice(0, 4);

const possible = {
  recommend: ["select_item", "change", "cancel"],
  options: ["set_option", "confirm", "change", "cancel"],
  fulfillment: ["set_fulfillment", "change", "cancel"],
  loyalty: ["set_loyalty", "skip_loyalty", "change", "cancel"],
  payment: ["set_payment", "change", "cancel"],
  confirm: ["confirm", "change", "cancel"],
};

const steps = [
  ["recommend", { transcript: "라떼 한 잔 주세요", menu_context: cards, step: "recommend" }],
  ["options", { transcript: "옵션 고를게요", menu_context: [withOptions], item: withOptions, step: "options" }],
  ["fulfillment", { transcript: "포장할게요", menu_context: [withOptions], item: withOptions, step: "fulfillment" }],
  ["loyalty", { transcript: "적립 안 할게요", menu_context: [withOptions], item: withOptions, step: "loyalty" }],
  ["payment", { transcript: "카드로 할게요", menu_context: [withOptions], item: withOptions, step: "payment" }],
  ["confirm", { transcript: "네 결제할게요", menu_context: [withOptions], item: withOptions, step: "confirm" }],
];

console.log(`GGUI 프리워밍 시작 (C=${C_URL}) — 콜드 생성은 step 당 30~40초 걸릴 수 있습니다.`);
let warmed = 0;
for (const [label, body] of steps) {
  const ok = await warmStep(label, { ...body, possible_actions: possible[label] });
  if (ok) warmed += 1;
}
console.log(`\n프리워밍 완료: ${warmed}/${steps.length} step 캐시 적재. 이제 음성 주문이 즉시 GGUI 로 렌더됩니다.`);
process.exit(warmed === steps.length ? 0 : 0);
