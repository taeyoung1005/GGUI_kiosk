// src/api/client.ts
//
// Module A(/realtime/session) · B(/menu,/orders) · C(/generate-ui) 호출 클라이언트.
// VITE_USE_MOCK=true 면 contracts/mocks 고정 데이터로 대체해 UI 흐름을 확인한다.
//
// 정본 계약 타입은 루트 contracts/types.ts 를 직접 import (@contracts alias).

import type {
  AnalyzeResult,
  Menu,
  MenuItem,
  GenerateUIRequest,
  GenerateUIResponse,
  GroundIntentRequest,
  GroundIntentResponse,
  OrderRequest,
  OrderResponse,
} from "@contracts/types";
import {
  sampleAnalyzeResult,
  sampleMenu,
  sampleGenerateUIResponse,
} from "@contracts/mocks";

// ── 환경설정 ────────────────────────────────────────────────
const ENV = import.meta.env;

export const USE_MOCK =
  ENV.VITE_USE_MOCK === undefined
    ? true // .env 없을 때 안전 기본값 = mock
    : ENV.VITE_USE_MOCK === "true" || ENV.VITE_USE_MOCK === "1";

const ANALYZE_URL = ENV.VITE_ANALYZE_URL || "http://localhost:8000";
const REALTIME_URL = ENV.VITE_REALTIME_URL || ANALYZE_URL;
const MENU_URL = ENV.VITE_MENU_URL || "http://localhost:8001";
const GGUI_URL = ENV.VITE_GGUI_URL || "http://localhost:8002";
const ANALYZE_API_KEY = ENV.VITE_ANALYZE_API_KEY || "";

const DEFAULT_TIMEOUT_MS = 8000;
const OPTIONAL_UPGRADES = [
  { type: "Set Upgrade", label: "Set dessert", priceDelta: 3000 },
  { type: "Combo Upgrade", label: "Large size combo", priceDelta: 1500 },
  { type: "Add-on", label: "Extra shot", priceDelta: 500 },
] as const;

/** mock 흐름의 체감용 지연(ms). 실제 호출엔 영향 없음. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** AbortController 로 타임아웃을 건 fetch. */
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

// ────────────────────────────────────────────────────────────
// Module A — Realtime transcript → AnalyzeResult
// ────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /** 직접 전사를 넘기면 STT를 건너뛰고 그대로 AnalyzeResult로 감싼다. */
  transcript?: string;
}

/**
 * 음성 입력을 전사(transcript)로만 환원한다. 실시간 STT(Realtime)는 브라우저가
 * 직접 OpenAI에 붙어 최종 transcript를 받아오므로, 여기서는 그 transcript를
 * AnalyzeResult로 감싸 멀티턴 상태기계에 흘려보내는 역할만 한다.
 */
export async function analyze(
  _audio: Blob | null,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  if (opts.transcript !== undefined) {
    return { transcript: opts.transcript, language: "ko", duration_ms: 0 };
  }

  if (USE_MOCK) {
    await delay(300);
    return sampleAnalyzeResult;
  }

  throw new Error("analyze: Realtime transcript가 필요합니다.");
}

// ────────────────────────────────────────────────────────────
// Module A — POST /realtime/session  (ephemeral client_secret 발급)
// ────────────────────────────────────────────────────────────

export interface RealtimeSession {
  /** WebRTC 핸드셰이크에 Authorization: Bearer 로 쓸 1분짜리 임시 토큰 */
  client_secret: string;
  /** 사용할 realtime 모델명 */
  model: string;
  /** 만료 시각(Unix epoch seconds) */
  expires_at: number;
}

/**
 * 백엔드(Module A)에서 ephemeral client_secret을 발급받는다.
 * 표준 OpenAI API 키는 백엔드에만 있고, 브라우저는 이 임시 토큰으로만 연결한다.
 */
export async function createRealtimeSession(): Promise<RealtimeSession> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ANALYZE_API_KEY) headers["Authorization"] = `Bearer ${ANALYZE_API_KEY}`;

  const res = await fetchWithTimeout(
    `${REALTIME_URL}/realtime/session`,
    { method: "POST", headers },
    12000,
  );
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      /* 본문 없음 */
    }
    throw new Error(detail || `realtime/session 발급 실패: ${res.status}`);
  }
  return (await res.json()) as RealtimeSession;
}

// ────────────────────────────────────────────────────────────
// Module B — GET /menu, GET /menu/search, POST /orders
// ────────────────────────────────────────────────────────────

export async function getMenu(): Promise<Menu> {
  if (USE_MOCK) {
    await delay(200);
    return sampleMenu;
  }
  const res = await fetchWithTimeout(`${MENU_URL}/menu`);
  if (!res.ok) throw new Error(`menu failed: ${res.status}`);
  return (await res.json()) as Menu;
}

/** 키워드로 메뉴 후보 검색. mock 은 transcript 와 name/desc 부분일치로 필터. */
export async function searchMenu(q: string): Promise<MenuItem[]> {
  if (USE_MOCK) {
    await delay(150);
    const needle = norm(q);
    const tokens = q
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((token) => token.length >= 3 && !["can", "get", "please", "want", "like"].includes(token));
    const hit = sampleMenu.items.filter(
      (it) => {
        const haystack = norm(`${it.name} ${it.desc} ${it.category}`);
        return haystack.includes(needle) || tokens.some((token) => haystack.includes(norm(token)));
      },
    );
    return (hit.length ? hit : sampleMenu.items.filter((i) => i.category === "Latte")).slice(0, 3);
  }
  const res = await fetchWithTimeout(
    `${MENU_URL}/menu/search?q=${encodeURIComponent(q)}`,
  );
  if (!res.ok) throw new Error(`menu/search failed: ${res.status}`);
  const data = (await res.json()) as { items: MenuItem[] };
  return data.items ?? [];
}

export async function createOrder(req: OrderRequest): Promise<OrderResponse> {
  if (USE_MOCK) {
    await delay(1200); // 결제 진행 애니메이션 체감
    const total = computeMockTotal(req);
    return { order_id: `ord-${Date.now() % 100000}`, total, status: "paid" };
  }
  const res = await fetchWithTimeout(`${MENU_URL}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`orders failed: ${res.status}`);
  return (await res.json()) as OrderResponse;
}

/** mock 합계 계산: 기본가 + 옵션 price_delta * qty. */
function computeMockTotal(req: OrderRequest): number {
  const byId = new Map(sampleMenu.items.map((i) => [i.id, i]));
  let total = 0;
  for (const line of req.items) {
    const item = byId.get(line.item_id);
    if (!item) continue;
    let unit = item.price;
    for (const [type, label] of Object.entries(line.options)) {
      const opt = item.options.find((o) => o.type === type);
      const choice = opt?.choices.find((c) => c.label === label);
      if (choice) {
        unit += choice.price_delta;
      } else {
        unit += optionalUpgradeDelta(type, label);
      }
    }
    total += unit * (line.qty || 1);
  }
  return total;
}

function optionalUpgradeDelta(type: string, label: string): number {
  return OPTIONAL_UPGRADES.find(
    (upgrade) => upgrade.type === type && upgrade.label === label,
  )?.priceDelta ?? 0;
}

// ────────────────────────────────────────────────────────────
// Module C — POST /generate-ui  (적응 UI 생성)
// ────────────────────────────────────────────────────────────

/**
 * GenerateUIRequest → GGUI 적응 UI 생성. embed_url 을 받아 AdaptiveKiosk 가 임베드한다.
 * mock 모드면 embed_url 없이 contract 만 채운 응답을 돌려준다.
 *   → AdaptiveKiosk 가 embed_url 부재를 감지해 "내장 적응 렌더러(fallback)"로 그린다.
 */
export async function generateUI(
  req: GenerateUIRequest,
): Promise<GenerateUIResponse> {
  if (USE_MOCK) {
    await delay(900); // LLM 생성 체감
    return {
      render_id: `mock-${req.step}-${Date.now() % 100000}`,
      // mock 에선 외부 GGUI 뷰어가 없으므로 embed_url 을 비워 내장 렌더러를 쓰게 한다.
      embed_url: "",
      contract: {
        ...sampleGenerateUIResponse.contract,
        // 디버그/표시용 메타 — 어떤 신호로 생성됐는지 화면에서 확인 가능
        _mock: true,
        _step: req.step,
        _transcript: req.transcript,
        _candidates: req.menu_context.map((m) => m.id),
        _order_state: req.order_state,
        _possible_actions: req.possible_actions ?? [],
      },
    };
  }

  const res = await fetchWithTimeout(
    `${GGUI_URL}/generate-ui`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    20000, // LLM 생성은 더 긴 타임아웃
  );
  if (!res.ok) throw new Error(`generate-ui failed: ${res.status}`);
  const renderPath = res.headers.get("X-GGUI-Path") || "unknown";
  const data = (await res.json()) as GenerateUIResponse;
  const contract = {
    ...(data.contract || {}),
    _render_path: renderPath,
  };
  return {
    ...data,
    // LOCAL HTML posts iframe actions, but this React app already has a reliable
    // orchestrator. Use the built-in renderer for LOCAL paths so recommend →
    // options → confirm stays interactive.
    embed_url: renderPath.startsWith("local") ? "" : data.embed_url,
    contract,
  };
}

export async function groundIntent(
  req: GroundIntentRequest,
): Promise<GroundIntentResponse> {
  const res = await fetchWithTimeout(
    `${GGUI_URL}/ground-intent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    },
    12000,
  );
  if (!res.ok) throw new Error(`ground-intent failed: ${res.status}`);
  return (await res.json()) as GroundIntentResponse;
}

export interface GguiConsumedEvent {
  type?: string;
  renderId?: string;
  intent?: string;
  actionData?: any;
  uiContext?: Record<string, any>;
  actionId?: string;
  firedAt?: string;
}

export async function consumeGguiEvents(
  renderId: string,
  timeoutSeconds = 15,
): Promise<{ events: GguiConsumedEvent[]; status: string }> {
  const timeout = Math.max(0, Math.min(120, Math.round(timeoutSeconds)));
  const res = await fetchWithTimeout(
    `${GGUI_URL}/consume/${encodeURIComponent(renderId)}?timeout=${timeout}`,
    { method: "GET" },
    (timeout + 5) * 1000,
  );
  if (!res.ok) throw new Error(`consume failed: ${res.status}`);
  const data = (await res.json()) as { events?: GguiConsumedEvent[]; status?: string };
  return {
    events: Array.isArray(data.events) ? data.events : [],
    status: data.status || "unknown",
  };
}

// 진단/배지 표시용 현재 설정 노출
export const apiConfig = {
  USE_MOCK,
  ANALYZE_URL,
  MENU_URL,
  GGUI_URL,
};

export function menuAssetUrl(imageUrl: string): string {
  if (!imageUrl) return "";
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  const path = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${MENU_URL}${path}`;
}

function norm(s: string): string {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}
