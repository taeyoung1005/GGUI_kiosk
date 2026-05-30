// server.js
//
// Module C — GGUI 적응 UI 생성 서비스 (Node ESM + Express).
//
// 엔드포인트:
//   POST /generate-ui   GenerateUIRequest → GenerateUIResponse
//   GET  /r/:id         생성된 UI HTML 반환 (D 가 iframe 임베드)
//   GET  /health        헬스체크 + 현재 모드
//
// 두 경로:
//   (1) GGUI 경로(primary)   — GGUI_MODE=ggui. ggui-client.js 가 GGUI MCP 서버 호출.
//   (2) LOCAL_FALLBACK 경로  — GGUI_MODE=local(기본) 또는 GGUI 호출 실패 시.
//       local-render.js 가 적응형 HTML 을 직접 만들어 /r/:id 로 서빙.
//
// 기본 GGUI_MODE=local → 키/외부 의존성 없이 `node server.js` 로 즉시 동작.

import express from "express";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveProfile, pickCandidates, normalizeAssistLevel } from "./src/adapt.js";
import { buildDataContract } from "./src/contract.js";
import { renderLocalHtml } from "./src/local-render.js";
import { generateViaGgui } from "./src/ggui-client.js";

// ── .env.local / .env 경량 로더 (의존성 없이; 이미 set 된 process.env 는 덮어쓰지 않음) ──
//   우선순위: 셸 export > .env.local > .env
function loadDotEnv() {
  const dir = dirname(fileURLToPath(import.meta.url));
  for (const name of [".env.local", ".env"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
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

// ── 환경 (.env 로딩 후 process.env 반영) ───────────────────────────
const ENV = {
  PORT: Number(process.env.PORT || 8002),
  GGUI_MODE: (process.env.GGUI_MODE || "local").toLowerCase(),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  GGUI_URL: process.env.GGUI_URL || "http://localhost:6781",
  GGUI_BEARER: process.env.GGUI_BEARER || "dev",
  GGUI_MODEL: process.env.GGUI_MODEL || "openai:gpt-5.5-2026-04-23",
};

// ── LOCAL 렌더 인메모리 스토어 (renderId → 렌더 메타) ───────────────
/** @type {Map<string, {step:string, profile:object, candidates:object[], transcript:string, item?:object, selectedOptions?:object, total?:number, html:string}>} */
const renderStore = new Map();
const SELF_BASE = () => `http://localhost:${ENV.PORT}`;

function shortId() {
  return randomBytes(5).toString("base64url"); // 예: sH9xK_
}

/** LOCAL 경로: 요청 → 적응형 HTML 생성 + 저장 → GenerateUIResponse. */
function generateLocal(req) {
  const {
    transcript = "",
    age_group = "under50",
    assist_level = 0,
    menu_context = [],
    step = "recommend",
    item,
    selectedOptions,
    total,
  } = req;

  const profile = resolveProfile({ assist_level, age_group });
  const candidates = pickCandidates(menu_context, transcript, profile.tokens.card_count);
  const targetItem = item ?? candidates[0];
  const contract = buildDataContract(step, { candidates, profile });

  const html = renderLocalHtml({
    step,
    profile,
    candidates,
    transcript,
    item: targetItem,
    selectedOptions,
    total,
  });

  const id = shortId();
  renderStore.set(id, {
    step,
    profile,
    candidates,
    transcript,
    item: targetItem,
    selectedOptions,
    total,
    html,
  });

  return {
    render_id: id,
    embed_url: `${SELF_BASE()}/r/${id}`,
    contract: { actionSpec: contract.actionSpec, intent: contract.intent },
  };
}

// ── Express ────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS (D 프론트가 다른 origin 에서 호출 / iframe 임베드)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    module: "C",
    mode: ENV.GGUI_MODE,
    ggui_url: ENV.GGUI_URL,
    has_openai_key: Boolean(ENV.OPENAI_API_KEY),
    renders: renderStore.size,
  });
});

/**
 * POST /generate-ui  (GenerateUIRequest → GenerateUIResponse)
 * GGUI_MODE=ggui 면 GGUI 경로 시도 → 실패 시 LOCAL 폴백.
 * GGUI_MODE=local 이면 곧장 LOCAL.
 */
app.post("/generate-ui", async (req, res) => {
  const body = req.body || {};
  // 최소 유효성 + 정규화
  const normalized = {
    transcript: String(body.transcript ?? ""),
    age_group: body.age_group === "50+" ? "50+" : "under50",
    assist_level: normalizeAssistLevel(body.assist_level),
    menu_context: Array.isArray(body.menu_context) ? body.menu_context : [],
    step: ["recommend", "options", "confirm"].includes(body.step) ? body.step : "recommend",
    item: body.item,
    selectedOptions: body.selectedOptions,
    total: body.total,
  };

  const wantGgui = ENV.GGUI_MODE === "ggui";
  if (wantGgui) {
    try {
      const out = await generateViaGgui(normalized, ENV);
      res.setHeader("X-GGUI-Path", "ggui");
      return res.json(out);
    } catch (err) {
      // GGUI/OPENAI 미가동 → LOCAL_FALLBACK
      console.warn(
        `[module-c] GGUI 경로 실패 → LOCAL 폴백: ${err?.message ?? err}`
      );
      const out = generateLocal(normalized);
      res.setHeader("X-GGUI-Path", "local-fallback");
      return res.json(out);
    }
  }

  const out = generateLocal(normalized);
  res.setHeader("X-GGUI-Path", "local");
  return res.json(out);
});

/**
 * GET /r/:id  생성된 UI HTML 반환.
 * LOCAL 경로로 만든 렌더는 인메모리에서 서빙. (GGUI 경로 렌더는 GGUI 서버의 /r/<shortCode> 가 서빙)
 */
app.get("/r/:id", (req, res) => {
  const entry = renderStore.get(req.params.id);
  if (!entry) {
    res
      .status(404)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:2rem">` +
          `<h2>렌더를 찾을 수 없습니다 (${req.params.id})</h2>` +
          `<p>이 경로는 LOCAL 모드로 생성된 UI 만 서빙합니다. GGUI 모드 렌더는 GGUI 서버(${ENV.GGUI_URL}/r/...)가 서빙합니다.</p>`
      );
    return;
  }
  res.type("html").send(entry.html);
});

app.get("/", (_req, res) => {
  res.json({
    module: "C — GGUI 적응 UI 생성",
    mode: ENV.GGUI_MODE,
    endpoints: ["POST /generate-ui", "GET /r/:id", "GET /health"],
  });
});

app.listen(ENV.PORT, () => {
  console.log(
    `[module-c] GGUI 적응 UI 생성 서비스 listening on ${SELF_BASE()}  (mode=${ENV.GGUI_MODE})`
  );
  if (ENV.GGUI_MODE === "ggui" && !ENV.OPENAI_API_KEY) {
    console.warn(
      "[module-c] GGUI_MODE=ggui 인데 OPENAI_API_KEY 가 비어있음 — GGUI 생성 실패 시 LOCAL 폴백됩니다."
    );
  }
});
