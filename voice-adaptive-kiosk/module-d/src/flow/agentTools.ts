import type {
  FulfillmentMode,
  LoyaltyMode,
  Menu,
  MenuItem,
  PaymentMethod,
} from "@contracts/types";

export interface AgentTool {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export const FULFILLMENT_VALUES: readonly FulfillmentMode[] = ["Dine In", "Take Out"];
export const LOYALTY_VALUES: readonly LoyaltyMode[] = ["scan", "phone", "none"];
export const PAYMENT_VALUES: readonly PaymentMethod[] = [
  "Credit Card",
  "Gift Card",
  "Kakao Pay",
  "Naver Pay",
  "Pay at Counter",
];

export const AGENT_TOOLS: AgentTool[] = [
  {
    type: "function",
    name: "select_item",
    description: "손님이 고른 메뉴를 선택한다. 메뉴의 정확한 item_id만 사용한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["item_id"],
      properties: {
        item_id: { type: "string", description: "메뉴 데이터의 정확한 id" },
      },
    },
  },
  {
    type: "function",
    name: "set_option",
    description: "선택한 메뉴의 옵션 하나를 설정한다. 메뉴에 존재하는 option_type/choice_label만 사용한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["option_type", "choice_label"],
      properties: {
        option_type: { type: "string" },
        choice_label: { type: "string" },
      },
    },
  },
  {
    type: "function",
    name: "set_fulfillment",
    description: "매장 이용 또는 포장을 설정한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "string", enum: [...FULFILLMENT_VALUES] },
      },
    },
  },
  {
    type: "function",
    name: "set_loyalty",
    description: "쿠폰/포인트 적립 또는 건너뛰기를 설정한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "string", enum: [...LOYALTY_VALUES] },
      },
    },
  },
  {
    type: "function",
    name: "set_payment",
    description: "결제수단을 설정한다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: {
        value: { type: "string", enum: [...PAYMENT_VALUES] },
      },
    },
  },
  {
    type: "function",
    name: "confirm_order",
    description: "손님이 최종 동의하면 결제를 확정한다. 주문번호와 합계를 돌려준다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    type: "function",
    name: "cancel_order",
    description: "현재 주문을 취소하고 처음 화면으로 되돌린다.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
];

export interface SlimMenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  option_types: string[];
}

export function slimMenu(menu: Menu): SlimMenuItem[] {
  return menu.items.map((item: MenuItem) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    price: item.price,
    option_types: (item.options ?? []).map((option) => option.type),
  }));
}

export function buildAgentInstructions(menu: Menu): string {
  return [
    `너는 '${menu.restaurant || "OBA 카페"}'의 친절한 음성 주문 도우미야.`,
    "손님과 한국어로 자연스럽고 짧게 대화하며 주문을 받아.",
    "",
    "원칙:",
    "- 아래 [메뉴]에 있는 항목만 추천하거나 선택한다. 없는 메뉴는 정중히 안내하고 비슷한 메뉴를 권한다.",
    "- 한 번에 하나만 물어본다: 메뉴 -> 옵션 -> 매장/포장 -> 적립 -> 결제수단 -> 최종확인.",
    "- 손님의 결정은 반드시 해당 도구를 호출해서 화면과 주문 상태에 반영한다. 말로만 진행하지 않는다.",
    "- 손님이 메뉴를 말하면 select_item을 호출하고, 도구가 돌려준 옵션을 보고 다음 질문을 한다.",
    "- 옵션이 없으면 바로 매장/포장을 물어본다. 적립은 건너뛰기(none)도 자연스럽게 허용한다.",
    "- 최종확인에서 손님이 동의하면 confirm_order를 호출하고 주문번호와 합계를 안내한다.",
    "- 가격과 합계는 도구가 돌려주는 값을 그대로 말한다. 임의로 계산하지 않는다.",
    "- 처음에는 짧게 인사하고 무엇을 드릴지 물어본다.",
    "",
    "[메뉴] (JSON, 이 id들만 사용):",
    JSON.stringify(slimMenu(menu)),
  ].join("\n");
}
