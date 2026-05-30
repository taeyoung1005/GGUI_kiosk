// 공유 데이터 계약 (canonical) — contracts/types.ts
//
// OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
// 모듈 A(AI)·B(메뉴/주문)·C(GGUI 생성)·D(웹 프론트)가 이 형태에만 합의하고
// 서로를 mock 하며 병렬 개발한다. 이 파일이 "정본(canonical)"이며,
// schemas.py(파이썬 미러)와 mocks.ts/mocks.json 은 항상 이 정의를 따른다.
//
// 흐름: D --audio--> A(/analyze) --> B(/menu) --> C(/generate-ui) --> D(embed)
//       D --확정--> B(/orders, mock 결제)

// ────────────────────────────────────────────────────────────
// AnalyzeResult  (Module A → Module D)
//   음성(wav 16kHz) → 전사 + 나이대 + 행동신호(assist_level).
//   적응 신호 주축 = 행동신호(assist_level 0~3), 나이(age)는 보조.
// ────────────────────────────────────────────────────────────

/** 나이대 그룹. 타깃은 한국 디지털 취약층(50+) vs 그 이하의 이진 분류. */
export type AgeGroup = "50+" | "under50";

export interface AnalyzeResult {
  /** STT 전사 텍스트. 예: "라떼 하나 주세요" */
  transcript: string;
  /** 언어 코드. 한국어 기본 → "ko" */
  language: string;
  age: {
    /** 이진 나이대 그룹 (보조 신호) */
    group: AgeGroup;
    /** 추정 나이(년) */
    years_est: number;
    /** 나이 분류 신뢰도 0~1 */
    confidence: number;
    /** 아동 화자 확률 0~1 (안전·오탐 필터용) */
    child_prob: number;
  };
  behavioral: {
    /** 발화 속도 (음절/초). 낮을수록 느림 */
    speech_rate: number;
    /** 전체 대비 침묵 비율 0~1. 높을수록 머뭇거림 */
    silence_ratio: number;
    /** 채움말("음","어"…) 횟수 */
    filler_count: number;
    /** UI 적응 강도 (주축 신호) 0=일반 … 3=최대 보조 */
    assist_level: 0 | 1 | 2 | 3;
  };
  /** 입력 오디오 길이(ms) */
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

// ────────────────────────────────────────────────────────────
// GenerateUIRequest / Response  (Module D → Module C)
//   GGUI(OpenAI GPT)가 추천+적응 UI를 생성. 구조 고정, 내용만 적응.
// ────────────────────────────────────────────────────────────

export interface GenerateUIRequest {
  transcript: string;
  age_group: AgeGroup;
  assist_level: 0 | 1 | 2 | 3;
  /** 후보 또는 전체 메뉴 아이템 컨텍스트 */
  menu_context: MenuItem[];
  /** 멀티턴 단계 */
  step: "recommend" | "options" | "confirm";
}

export interface GenerateUIResponse {
  /** 생성된 렌더 식별자 */
  render_id: string;
  /** @ggui-ai/react 로 임베드할 URL. 예: "http://localhost:6781/r/sH9xK" */
  embed_url: string;
  /** 사용자 액션 정의(actionSpec 등). 형태는 GGUI 런타임에 위임 → any */
  contract: any;
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
