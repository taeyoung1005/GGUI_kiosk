// Probe Module C's GGUI path without blocking the kiosk demo.
//
// Usage:
//   C_URL=http://localhost:8002 node scripts/probe-ggui-generation.mjs
//
// Expected demo-safe result when GGUI generation is unavailable:
//   path=local-fallback, profile.card_count/effective_level present.

const C_URL = (process.env.C_URL || process.env.VITE_GGUI_URL || "http://localhost:8002").replace(/\/$/, "");

const menu = [
  {
    id: "caffe-latte-003",
    name: "카페 라떼",
    category: "라떼",
    price: 4500,
    image_url: "",
    desc: "에스프레소에 스팀 우유를 더한 기본 라떼.",
    options: [
      { type: "온도", choices: [{ label: "뜨겁게", price_delta: 0 }, { label: "차갑게", price_delta: 0 }] },
      { type: "사이즈", choices: [{ label: "기본", price_delta: 0 }, { label: "크게", price_delta: 500 }] },
    ],
  },
  {
    id: "vanilla-latte-004",
    name: "바닐라 라떼",
    category: "라떼",
    price: 5000,
    image_url: "",
    desc: "달콤한 바닐라 라떼.",
    options: [],
  },
  {
    id: "matcha-latte-005",
    name: "말차 라떼",
    category: "라떼",
    price: 5200,
    image_url: "",
    desc: "녹차로 만든 라떼.",
    options: [],
  },
];

const req = {
  transcript: "라떼 한 잔 주세요",
  menu_context: menu,
  step: process.env.STEP || "recommend",
};

const res = await fetch(`${C_URL}/generate-ui`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(req),
});

const body = await res.json().catch(() => ({}));
const path = res.headers.get("x-ggui-path") || "unknown";
const profile = body.contract?._profile;

console.log(JSON.stringify({
  ok: res.ok,
  status: res.status,
  path,
  render_id: body.render_id,
  embed_url: body.embed_url,
  profile,
  mode: path === "ggui" ? "live-ggui" : "demo-safe-local",
}, null, 2));

if (!res.ok) process.exit(1);
