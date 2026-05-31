// 공유 데이터 계약 (canonical) — contracts/types.ts
//
// OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
// 모듈 A(Realtime token)·B(메뉴/주문)·C(GGUI 생성)·D(웹 프론트)가 이 형태에만 합의하고
// 서로를 mock 하며 병렬 개발한다. 이 파일이 "정본(canonical)"이며,
// schemas.py(파이썬 미러)와 mocks.ts/mocks.json 은 항상 이 정의를 따른다.
//
// 흐름: D --Realtime transcript--> B(/menu) --> C(/generate-ui) --> D(embed)
//       D --확정--> B(/orders, mock 결제)

// ────────────────────────────────────────────────────────────
// AnalyzeResult  (Realtime transcript wrapper)
//   OpenAI Realtime 최종 전사. 적응 강도는 항상 고령자 최대로 고정되므로
//   나이/행동신호는 더 이상 계약에 싣지 않는다.
// ────────────────────────────────────────────────────────────

export interface AnalyzeResult {
  /** 전사 텍스트. 예: "라떼 한 잔 주세요" */
  transcript: string;
  /** 언어 코드. 한국어 기본 → "ko" */
  language: string;
  /** 전사 처리 길이(ms). Realtime 주입 경로는 0. */
  duration_ms: number;
}

// ────────────────────────────────────────────────────────────
// Menu / MenuItem / MenuOption  (Module B → Module D, C)
// ────────────────────────────────────────────────────────────

export interface MenuOptionChoice {
  /** 선택지 라벨. 예: "HOT", "L" */
  label: string;
  /** 이 선택 시 가산 가격(원). 기본 0 */
  price_delta: number;
}

export interface MenuOption {
  /** 옵션 종류. 예: "온도", "사이즈", "토핑" */
  type: string;
  choices: MenuOptionChoice[];
}

export interface MenuItem {
  /** 고유 식별자. 예: "latte-001" */
  id: string;
  name: string;
  /** 카테고리. 예: "커피" */
  category: string;
  /** 기본 가격(원) */
  price: number;
  image_url: string;
  desc: string;
  options: MenuOption[];
}

export interface Menu {
  restaurant: string;
  categories: string[];
  items: MenuItem[];
}

export type AdaptiveStep =
  | "recommend"
  | "options"
  | "fulfillment"
  | "loyalty"
  | "payment"
  | "confirm";

export type FulfillmentMode = "Dine In" | "Take Out";
export type LoyaltyMode = "scan" | "phone" | "none";
export type PaymentMethod =
  | "Credit Card"
  | "Gift Card"
  | "Kakao Pay"
  | "Naver Pay"
  | "Pay at Counter";

export interface AdaptiveOrderState {
  selected_item_id?: string | null;
  selected_item_name?: string | null;
  selected_options: Record<string, string>;
  quantity: number;
  fulfillment?: FulfillmentMode | null;
  loyalty?: LoyaltyMode | null;
  payment_method?: PaymentMethod | null;
  total: number;
}

// ────────────────────────────────────────────────────────────
// GenerateUIRequest / Response  (Module D → Module C)
//   GGUI(OpenAI GPT)가 추천+적응 UI를 생성. 구조 고정, 내용만 적응.
// ────────────────────────────────────────────────────────────

export interface GenerateUIRequest {
  transcript: string;
  /** 후보 또는 전체 메뉴 아이템 컨텍스트 */
  menu_context: MenuItem[];
  /** 현재 주문 상태. GGUI가 매 턴 같은 context로 화면을 재생성하기 위한 값. */
  order_state?: AdaptiveOrderState;
  /** 현재 단계에서 사용자가 할 수 있는 action 이름 목록. */
  possible_actions?: string[];
  /** 멀티턴 단계 */
  step: AdaptiveStep;
}

export interface GenerateUIResponse {
  /** 생성된 렌더 식별자 */
  render_id: string;
  /** iframe 으로 임베드할 URL. 예: "http://localhost:6781/r/sH9xK" */
  embed_url: string;
  /** 사용자 액션 정의(actionSpec 등). 형태는 GGUI 런타임에 위임 → any */
  contract: any;
}

// ────────────────────────────────────────────────────────────
// GroundIntentRequest / Response  (Module D → Module C)
//   GGUI 생성 전 단계. 발화 + 메뉴/옵션 DB를 구조화해 검증된 후보와
//   order_state patch만 GGUI에 넘기기 위한 grounding 계약.
// ────────────────────────────────────────────────────────────

export interface GroundIntentRequest {
  step: AdaptiveStep;
  transcript: string;
  menu_context: MenuItem[];
  selected_item?: MenuItem | null;
  order_state?: AdaptiveOrderState;
}

export type GroundIntentName =
  | "select_item"
  | "set_options"
  | "set_fulfillment"
  | "set_loyalty"
  | "set_payment"
  | "confirm"
  | "change"
  | "cancel"
  | "unknown";

export interface GroundItemCandidate {
  item_id: string;
  confidence: number;
}

export interface GroundIntentResponse {
  step: AdaptiveStep;
  intent: GroundIntentName;
  item_candidates: GroundItemCandidate[];
  selected_options: Record<string, string>;
  fulfillment: FulfillmentMode | null;
  loyalty: LoyaltyMode | null;
  payment_method: PaymentMethod | null;
  confirm: "yes" | "no" | "change" | null;
  needs_clarification: boolean;
  clarification_reason: string | null;
}

// ────────────────────────────────────────────────────────────
// OrderRequest / Response / OrderLine  (Module D → Module B)
//   결제는 mock — 항상 status:"paid".
// ────────────────────────────────────────────────────────────

export interface OrderLine {
  item_id: string;
  /** 선택한 옵션 맵. 예: { "온도": "HOT", "사이즈": "R" } */
  options: Record<string, string>;
  qty: number;
}

export interface OrderRequest {
  items: OrderLine[];
}

export interface OrderResponse {
  order_id: string;
  /** 합계 금액(원) */
  total: number;
  /** mock 결제 결과 — 항상 "paid" */
  status: "paid";
}
