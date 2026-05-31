// Module B — 메뉴/주문 백엔드 (Node ESM + Express)
//
// OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
// contracts/types.ts 의 Menu / MenuItem / OrderRequest / OrderResponse 형태를 그대로 따른다.
//
// 엔드포인트
//   GET  /menu                  → Menu
//   GET  /menu/search?q=라떼     → { query, count, items: MenuItem[] }
//   POST /orders                → OrderResponse (status:"paid" mock, 1~2초 결제 지연)
//   GET  /orders/:id            → OrderResponse (없으면 404)
//   GET  /health                → { status:"ok", ... }
//
// 데이터는 data/menu.seed.json 을 in-memory 로드(외부 DB·키 불필요 → 즉시 mock 기동).

import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 루트 .env.local / .env 경량 로더 (의존성 없이; 이미 set 된 process.env 우선) ──
//   우선순위: 셸 export > 루트 .env.local > 루트 .env
function loadDotEnv() {
  const rootDir = join(__dirname, "..");
  for (const name of [".env.local", ".env"]) {
    const p = join(rootDir, name);
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadDotEnv();

const PORT = process.env.PORT || process.env.MENU_PORT || 8001;
const OPTIONAL_UPGRADES = [
  { type: "Set Upgrade", label: "Set dessert", priceDelta: 3000 },
  { type: "Combo Upgrade", label: "Large size combo", priceDelta: 1500 },
  { type: "Add-on", label: "Extra shot", priceDelta: 500 },
];

// ────────────────────────────────────────────────────────────
// 데이터 로드 (JSON in-memory)
// ────────────────────────────────────────────────────────────

const MENU_PATH = join(__dirname, "data", "menu.seed.json");

/** @type {{restaurant:string, categories:string[], items:any[]}} */
let MENU;
try {
  MENU = JSON.parse(readFileSync(MENU_PATH, "utf-8"));
} catch (err) {
  console.error(`[module-b] 메뉴 시드 로드 실패: ${MENU_PATH}\n`, err);
  process.exit(1);
}

/** id → MenuItem 빠른 조회용 인덱스 */
const ITEM_BY_ID = new Map(MENU.items.map((it) => [it.id, it]));

/** 주문 in-memory 저장소. order_id → OrderResponse(+ items 사본) */
const ORDERS = new Map();
let orderSeq = 1000; // ord-1001 부터 시작

// ────────────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────────────

/** 결제 지연 시뮬레이션: 1000~2000ms */
function paymentDelayMs() {
  return 1000 + Math.floor(Math.random() * 1000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 주문 라인 합계 계산.
 * 기본가 + 선택된 옵션의 price_delta 합 × 수량.
 * 존재하지 않는 item_id / 옵션 라벨은 무시(0 가산)하여 데모 견고성 유지.
 * @returns {{ total:number, invalid:string[] }}
 */
function computeTotal(lines) {
  let total = 0;
  const invalid = [];
  for (const line of lines) {
    const item = ITEM_BY_ID.get(line.item_id);
    if (!item) {
      invalid.push(line.item_id);
      continue;
    }
    const qty = Number.isFinite(line.qty) && line.qty > 0 ? line.qty : 1;
    let unit = item.price;
    const chosen = line.options || {};
    for (const opt of item.options || []) {
      const pickedLabel = chosen[opt.type];
      if (pickedLabel == null) continue;
      const choice = (opt.choices || []).find((c) => c.label === pickedLabel);
      if (choice) unit += choice.price_delta || 0;
    }
    for (const [type, label] of Object.entries(chosen)) {
      if ((item.options || []).some((opt) => opt.type === type)) continue;
      unit += optionalUpgradeDelta(type, label);
    }
    total += unit * qty;
  }
  return { total, invalid };
}

function optionalUpgradeDelta(type, label) {
  const upgrade = OPTIONAL_UPGRADES.find(
    (item) => item.type === type && item.label === label,
  );
  return upgrade?.priceDelta || 0;
}

/** 한국어/영문 혼용 검색을 위한 정규화(소문자 + 공백 제거) */
function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

function queryTokens(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !["can", "get", "please", "want", "like"].includes(token));
}

// ────────────────────────────────────────────────────────────
// 앱 설정
// ────────────────────────────────────────────────────────────

const app = express();
app.use(cors()); // 데모: 모든 오리진 허용 (프론트 localhost:5173 등)
app.use(express.json());

// 요청 로깅(간단)
app.use((req, _res, next) => {
  console.log(`[module-b] ${req.method} ${req.originalUrl}`);
  next();
});

// 메뉴 이미지 placeholder 정적 제공 (선택) — /img/* 경로가 비어 있어도 404만 날 뿐 흐름엔 무관.
app.use("/img", express.static(join(__dirname, "public", "img")));

// ── GET /health ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    module: "B",
    restaurant: MENU.restaurant,
    items: MENU.items.length,
    orders: ORDERS.size,
  });
});

// ── GET /menu → Menu ────────────────────────────────────────
app.get("/menu", (_req, res) => {
  res.json(MENU);
});

// ── GET /menu/search?q=라떼 → { query, count, items } ────────
// 이름·설명·카테고리에서 부분일치 검색. "라떼" → 카페라떼·바닐라라떼·녹차라떼·초코라떼·고구마라떼 다수 반환.
app.get("/menu/search", (req, res) => {
  const q = norm(req.query.q);
  const tokens = queryTokens(req.query.q);
  if (!q) {
    return res.json({ query: "", count: MENU.items.length, items: MENU.items });
  }
  const items = MENU.items.filter((it) => {
    const haystack = norm(`${it.name} ${it.desc} ${it.category}`);
    const tokenHit = tokens.some((token) => haystack.includes(norm(token)));
    return (
      norm(it.name).includes(q) ||
      norm(it.desc).includes(q) ||
      norm(it.category).includes(q) ||
      tokenHit
    );
  });
  res.json({ query: req.query.q, count: items.length, items });
});

// ── POST /orders → OrderResponse (mock 결제) ────────────────
app.post("/orders", async (req, res) => {
  const body = req.body || {};
  const lines = Array.isArray(body.items) ? body.items : [];
  if (lines.length === 0) {
    return res.status(400).json({ error: "items 배열이 비어 있습니다 (OrderRequest.items)" });
  }

  const { total, invalid } = computeTotal(lines);
  if (invalid.length === lines.length) {
    return res.status(400).json({ error: "유효한 메뉴 항목이 없습니다", invalid_item_ids: invalid });
  }

  // 결제 지연 애니메이션용 1~2초 지연.
  await sleep(paymentDelayMs());

  const order_id = `ord-${++orderSeq}`;
  /** @type {{order_id:string,total:number,status:"paid"}} */
  const order = { order_id, total, status: "paid" };

  // 조회용으로 라인·시각도 함께 저장(응답 계약에는 미포함)
  ORDERS.set(order_id, { ...order, items: lines, created_at: new Date().toISOString() });

  res.status(201).json(order);
});

// ── GET /orders/:id → OrderResponse ─────────────────────────
app.get("/orders/:id", (req, res) => {
  const found = ORDERS.get(req.params.id);
  if (!found) {
    return res.status(404).json({ error: "주문을 찾을 수 없습니다", order_id: req.params.id });
  }
  const { order_id, total, status } = found;
  res.json({ order_id, total, status });
});

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, () => {
  console.log(`[module-b] 메뉴/주문 백엔드 가동 → http://localhost:${PORT}`);
  console.log(`[module-b] 식당="${MENU.restaurant}", 메뉴 ${MENU.items.length}개, 카테고리=[${MENU.categories.join(", ")}]`);
  console.log(`[module-b] 엔드포인트: GET /menu · GET /menu/search?q= · POST /orders · GET /orders/:id · GET /health`);
});
