// 데모/mock 샘플 데이터 (typed) — contracts/mocks.ts
//
// 각 모듈은 이 형태에 합의하고 서로 mock 한다. VITE_USE_MOCK=true 또는 MOCK_MODE=1
// 일 때, 백엔드/키 없이도 이 고정 데이터로 UI·흐름을 단독 개발한다.
//
// 정본 JSON = mocks.json. 이 .ts 는 타입을 입혀 import 편의를 준다.

import type {
  AnalyzeResult,
  Menu,
  GenerateUIRequest,
  GenerateUIResponse,
  OrderRequest,
  OrderResponse,
} from "./types";

import raw from "./mocks.json";

// ────────────────────────────────────────────────────────────
// AnalyzeResult 샘플 — 동일 발화("Can I get a latte")의 두 변형.
//   적응 증명: 같은 말이라도 화자에 따라 assist_level 이 갈린다.
// ────────────────────────────────────────────────────────────

/** 느린 어르신 변형 — 50+, assist_level 2 (보조 강화 UI). */
export const sampleAnalyzeResult: AnalyzeResult =
  raw.sampleAnalyzeResultElder as AnalyzeResult;

/** 위와 동일하나 이름으로 명확히: 어르신 변형. */
export const sampleAnalyzeResultElder: AnalyzeResult =
  raw.sampleAnalyzeResultElder as AnalyzeResult;

/** 빠른 청년 변형 — under50, assist_level 0 (압축된 일반 UI). */
export const sampleAnalyzeResultYouth: AnalyzeResult =
  raw.sampleAnalyzeResultYouth as AnalyzeResult;

// ────────────────────────────────────────────────────────────
// Menu 샘플 (Module B)
// ────────────────────────────────────────────────────────────

export const sampleMenu: Menu = raw.sampleMenu as Menu;

// ────────────────────────────────────────────────────────────
// GenerateUI 샘플 (Module C)
// ────────────────────────────────────────────────────────────

export const sampleGenerateUIRequest: GenerateUIRequest =
  raw.sampleGenerateUIRequest as GenerateUIRequest;

export const sampleGenerateUIResponse: GenerateUIResponse =
  raw.sampleGenerateUIResponse as GenerateUIResponse;

// ────────────────────────────────────────────────────────────
// Order 샘플 (Module B)
// ────────────────────────────────────────────────────────────

export const sampleOrderRequest: OrderRequest =
  raw.sampleOrderRequest as OrderRequest;

export const sampleOrderResponse: OrderResponse =
  raw.sampleOrderResponse as OrderResponse;

// 한 번에 가져오기 편하도록 묶음 export
export const mocks = {
  sampleAnalyzeResult,
  sampleAnalyzeResultElder,
  sampleAnalyzeResultYouth,
  sampleMenu,
  sampleGenerateUIRequest,
  sampleGenerateUIResponse,
  sampleOrderRequest,
  sampleOrderResponse,
};

export default mocks;
