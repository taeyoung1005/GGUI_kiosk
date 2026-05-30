// src/api/client.ts
//
// Module A(/analyze) · B(/menu,/orders) · C(/generate-ui) 호출 클라이언트.
// VITE_USE_MOCK=true 면 contracts/mocks 고정 데이터로 대체 → 백엔드/키 없이 흐름이 돈다.
//
// 정본 계약 타입은 루트 contracts/types.ts 를 직접 import (@contracts alias).

import type {
  AnalyzeResult,
  Menu,
  MenuItem,
  GenerateUIRequest,
  GenerateUIResponse,
  OrderRequest,
  OrderResponse,
} from "@contracts/types";
import {
  sampleAnalyzeResultElder,
  sampleAnalyzeResultYouth,
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
const MENU_URL = ENV.VITE_MENU_URL || "http://localhost:8001";
const GGUI_URL = ENV.VITE_GGUI_URL || "http://localhost:8002";
const ANALYZE_API_KEY = ENV.VITE_ANALYZE_API_KEY || "";

const DEFAULT_TIMEOUT_MS = 8000;

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
// Module A — POST /analyze  (audio → AnalyzeResult)
// ────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  /** mock 모드에서 어느 샘플을 쓸지: 어르신(느림) vs 청년(빠름). 적응 증명용. */
  mockVariant?: "elder" | "youth";
}

/**
 * 오디오 Blob 을 /analyze 로 보내 분석 결과를 받는다.
 * mock 모드면 고정 AnalyzeResult(어르신/청년 변형)를 반환한다.
 */
export async function analyze(
  audio: Blob | null,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  if (USE_MOCK) {
    await delay(700); // STT+나이 추론 체감
    return opts.mockVariant === "youth"
      ? sampleAnalyzeResultYouth
      : sampleAnalyzeResultElder;
  }

  if (!audio) throw new Error("analyze: audio is empty.");
  const form = new FormData();
  const filename = audio.type.includes("wav") ? "audio.wav" : "audio.webm";
  form.append("file", audio, filename);

  const headers: Record<string, string> = {};
  if (ANALYZE_API_KEY) headers["Authorization"] = `Bearer ${ANALYZE_API_KEY}`;

  const res = await fetchWithTimeout(`${ANALYZE_URL}/analyze`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!res.ok) throw new Error(`analyze failed: ${res.status}`);
  return (await res.json()) as AnalyzeResult;
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
      .filter((token) => token.length >= 3);
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
      if (choice) unit += choice.price_delta;
    }
    total += unit * (line.qty || 1);
  }
  return total;
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
        _assist_level: req.assist_level,
        _age_group: req.age_group,
        _transcript: req.transcript,
        _candidates: req.menu_context.map((m) => m.id),
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
  return (await res.json()) as GenerateUIResponse;
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
