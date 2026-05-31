// src/contract.js
//
// GGUI DataContract(propsSpec/actionSpec) 빌더.
// - GGUI 경로: ggui_render({ contract }) 에 그대로 넘긴다.
// - LOCAL 경로: 같은 contract 를 GenerateUIResponse.contract 로 되돌려 D 가
//   동일한 actionSpec(예: selectMenu/confirmYes/confirmNo) 으로 이벤트를 받게 한다.
//
// DataContract 구조(요약, packages/protocol/.../data-contract.ts 기준):
//   propsSpec: { description?, properties: Record<name, { schema, required?, ... }> }
//   actionSpec: Record<name, { label, schema?, nextStep?, icon?, confirm? }>   (flat)
//   ※ 모든 entry 는 schema 를 entry.schema 에 담는다(평탄화 금지).

/** 메뉴 아이템 한 개의 JSON Schema(카드 렌더 props). */
const menuItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    price: { type: "number" },
    image_url: { type: "string" },
    desc: { type: "string" },
    options: { type: "array" },
  },
  required: ["id", "name", "price"],
};

/**
 * step 별 DataContract 생성.
 * step: "recommend" | "options" | "fulfillment" | "loyalty" | "payment" | "confirm"
 */
export function buildDataContract(step, { candidates, profile }) {
  const intentByStep = {
    recommend:
      "Senior-friendly kiosk recommendation screen — recommend menu items as 2-3 large cards, selectable with a single big touch.",
    options:
      "Senior-friendly kiosk options screen — choose temperature/size one item at a time with large buttons.",
    fulfillment:
      "Senior-friendly kiosk fulfillment screen — choose dine in or take out with two large buttons and voice affordance.",
    loyalty:
      "Senior-friendly kiosk loyalty screen — choose coupon scan, earn points, or skip with clear large buttons.",
    payment:
      "Senior-friendly kiosk payment screen — choose one payment method, but do not charge until the final confirmation.",
    confirm:
      "Senior-friendly kiosk final confirmation screen — summarize item, options, fulfillment, loyalty, and payment before charging.",
  };

  // 공통 props: 화면 제목/안내와 적응 강도(글자·여백·음성).
  const baseProps = {
    title: { schema: { type: "string" }, required: true },
    subtitle: { schema: { type: "string" } },
    assistLevel: {
      schema: { type: "integer", minimum: 0, maximum: 3 },
      required: true,
      description: "UI 적응 강도(주축 신호). 높을수록 글자·여백·음성안내 강화.",
    },
    ageGroup: { schema: { type: "string" } },
    voiceGuide: {
      schema: { type: "string" },
      description: "speechSynthesis 로 읽어줄 음성 안내 문구(없으면 무음).",
    },
    orderState: {
      schema: { type: "object", additionalProperties: true },
      description: "현재 주문 상태. 선택 메뉴, 옵션, 매장/포장, 포인트, 결제수단을 포함.",
    },
    possibleActions: {
      schema: { type: "array", items: { type: "string" } },
      description: "현재 단계에서 허용된 intent/action 이름 목록.",
    },
  };

  if (step === "options") {
    return {
      intent: intentByStep.options,
      propsSpec: {
        description: "옵션 선택 화면 props.",
        properties: {
          ...baseProps,
          item: { schema: menuItemSchema, required: true },
          options: {
            schema: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string" },
                  choices: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        price_delta: { type: "number" },
                      },
                      required: ["label"],
                    },
                  },
                },
                required: ["type", "choices"],
              },
            },
            required: true,
          },
        },
      },
      actionSpec: {
        selectOption: {
          label: "Choose this",
          description: "Select one option. Sends {type, label} as payload.",
          schema: {
            type: "object",
            properties: { type: { type: "string" }, label: { type: "string" } },
            required: ["type", "label"],
          },
          nextStep: "confirm",
        },
        back: { label: "Back", nextStep: "recommend" },
      },
    };
  }

  if (step === "confirm") {
    return {
      intent: intentByStep.confirm,
      propsSpec: {
        description: "주문 확인 화면 props.",
        properties: {
          ...baseProps,
          item: { schema: menuItemSchema, required: true },
          selectedOptions: {
            schema: { type: "object", additionalProperties: { type: "string" } },
            description: "선택한 옵션 맵. 예: {\"온도\":\"HOT\"}",
          },
          total: { schema: { type: "number" }, description: "합계 금액(원)." },
        },
      },
      actionSpec: {
        confirmYes: {
          label: "Yes, order it",
          icon: "✅",
          description: "Confirm the order → proceed to Module B /orders (mock payment).",
          nextStep: "order",
        },
        confirmNo: {
          label: "No, choose again",
          icon: "↩️",
          nextStep: "recommend",
        },
      },
    };
  }

  if (step === "fulfillment") {
    return {
      intent: intentByStep.fulfillment,
      propsSpec: {
        description: "매장/포장 선택 화면 props.",
        properties: {
          ...baseProps,
          item: { schema: menuItemSchema, required: true },
          total: { schema: { type: "number" }, description: "현재 합계 금액(원)." },
        },
      },
      actionSpec: {
        setFulfillment: {
          label: "Choose place",
          description: "Select dine in or take out. Sends {value}.",
          schema: {
            type: "object",
            properties: { value: { type: "string", enum: ["Dine In", "Take Out"] } },
            required: ["value"],
          },
          nextStep: "loyalty",
        },
        back: { label: "Back", nextStep: "options" },
      },
    };
  }

  if (step === "loyalty") {
    return {
      intent: intentByStep.loyalty,
      propsSpec: {
        description: "쿠폰/포인트 선택 화면 props.",
        properties: {
          ...baseProps,
          item: { schema: menuItemSchema, required: true },
          total: { schema: { type: "number" }, description: "현재 합계 금액(원)." },
        },
      },
      actionSpec: {
        setLoyalty: {
          label: "Choose points option",
          description: "Select coupon scan, earn points, or skip. Sends {value}.",
          schema: {
            type: "object",
            properties: { value: { type: "string", enum: ["scan", "phone", "none"] } },
            required: ["value"],
          },
          nextStep: "payment",
        },
        back: { label: "Back", nextStep: "fulfillment" },
      },
    };
  }

  if (step === "payment") {
    return {
      intent: intentByStep.payment,
      propsSpec: {
        description: "결제수단 선택 화면 props.",
        properties: {
          ...baseProps,
          item: { schema: menuItemSchema, required: true },
          total: { schema: { type: "number" }, description: "현재 합계 금액(원)." },
        },
      },
      actionSpec: {
        setPayment: {
          label: "Choose payment",
          description: "Select payment method. Sends {value}.",
          schema: {
            type: "object",
            properties: {
              value: {
                type: "string",
                enum: ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"],
              },
            },
            required: ["value"],
          },
          nextStep: "confirm",
        },
        back: { label: "Back", nextStep: "loyalty" },
      },
    };
  }

  // recommend (기본)
  return {
    intent: intentByStep.recommend,
    propsSpec: {
      description: "추천 카드 화면 props.",
      properties: {
        ...baseProps,
        items: {
          schema: { type: "array", items: menuItemSchema },
          required: true,
          description: `추천 후보 메뉴 카드(${candidates?.length ?? 0}장).`,
        },
      },
    },
    actionSpec: {
      selectMenu: {
        label: "Order this",
        description: "Select one card. Sends {item_id} as payload.",
        schema: {
          type: "object",
          properties: { item_id: { type: "string" } },
          required: ["item_id"],
        },
        nextStep: "options",
      },
      repeat: {
        label: "Play again",
        description: "Replay the voice guidance (multi-turn helper).",
      },
    },
  };
}
