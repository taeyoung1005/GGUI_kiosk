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
    name: "Caffe Latte",
    category: "Latte",
    price: 4500,
    image_url: "",
    desc: "Classic espresso with steamed milk.",
    options: [
      { type: "Temperature", choices: [{ label: "Hot", price_delta: 0 }, { label: "Iced", price_delta: 0 }] },
      { type: "Size", choices: [{ label: "Regular", price_delta: 0 }, { label: "Large", price_delta: 500 }] },
    ],
  },
  {
    id: "vanilla-latte-004",
    name: "Vanilla Latte",
    category: "Latte",
    price: 5000,
    image_url: "",
    desc: "Sweet vanilla latte.",
    options: [],
  },
  {
    id: "matcha-latte-005",
    name: "Matcha Latte",
    category: "Latte",
    price: 5200,
    image_url: "",
    desc: "Green tea latte.",
    options: [],
  },
];

const req = {
  transcript: "Can I get a latte",
  age_group: process.env.AGE_GROUP || "sixties",
  assist_level: Number(process.env.ASSIST_LEVEL || 2),
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
