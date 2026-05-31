// 데모/mock 샘플 데이터 (typed) — contracts/mocks.ts
//
// 각 모듈은 이 형태에 합의하고 서로 mock 한다. VITE_USE_MOCK=true 일 때
// 이 고정 데이터로 UI·흐름을 단독 개발한다.
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
// AnalyzeResult 샘플 — 한국어 발화 전사 단일 변형.
//   적응 강도는 항상 고령자 최대로 고정되므로 변형이 필요 없다.
// ────────────────────────────────────────────────────────────

export const sampleAnalyzeResult: AnalyzeResult =
  raw.sampleAnalyzeResult as AnalyzeResult;

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
  sampleMenu,
  sampleGenerateUIRequest,
  sampleGenerateUIResponse,
  sampleOrderRequest,
  sampleOrderResponse,
};

export default mocks;
