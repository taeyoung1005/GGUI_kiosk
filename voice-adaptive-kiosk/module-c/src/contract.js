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
      "고령자 친화 키오스크 추천 화면 — 메뉴를 큰 카드 2장으로 추천하고, 한 번의 큰 터치로 선택하게 한다.",
    options:
      "고령자 친화 키오스크 옵션 화면 — 온도/사이즈를 한 번에 하나씩 큰 버튼으로 선택하게 한다.",
    fulfillment:
      "고령자 친화 키오스크 매장/포장 화면 — 매장과 포장을 큰 버튼 두 개와 음성 안내로 선택하게 한다.",
    loyalty:
      "고령자 친화 키오스크 쿠폰/포인트 화면 — 쿠폰 찍기, 포인트 적립, 건너뛰기를 큰 버튼으로 명확히 선택하게 한다.",
    payment:
      "고령자 친화 키오스크 결제 화면 — 결제수단 하나를 선택하되, 마지막 확인 전까지는 결제하지 않는다.",
    confirm:
      "고령자 친화 키오스크 최종 확인 화면 — 결제 전에 메뉴, 옵션, 매장/포장, 쿠폰/포인트, 결제수단을 요약한다.",
  };

  // 공통 props: 화면 제목/안내와 음성 안내. (적응 강도는 Module C 내부 고정 상수)
  const baseProps = {
    title: { schema: { type: "string" }, required: true },
    subtitle: { schema: { type: "string" } },
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
          label: "이걸로 선택",
          description: "옵션 하나를 선택합니다. {type, label} 을 payload 로 보냅니다.",
          schema: {
            type: "object",
            properties: { type: { type: "string" }, label: { type: "string" } },
            required: ["type", "label"],
          },
          nextStep: "confirm",
        },
        back: { label: "뒤로", nextStep: "recommend" },
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
          label: "네, 결제할게요",
          icon: "✅",
          description: "주문을 확정합니다 → Module B /orders 로 진행(모의 결제).",
          nextStep: "order",
        },
        confirmNo: {
          label: "아니요, 다시 고를게요",
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
          label: "장소 선택",
          description: "매장 또는 포장을 선택합니다. {value} 를 보냅니다.",
          schema: {
            type: "object",
            properties: { value: { type: "string", enum: ["Dine In", "Take Out"] } },
            required: ["value"],
          },
          nextStep: "loyalty",
        },
        back: { label: "뒤로", nextStep: "options" },
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
          label: "쿠폰/포인트 선택",
          description: "쿠폰 찍기, 포인트 적립, 또는 건너뛰기를 선택합니다. {value} 를 보냅니다.",
          schema: {
            type: "object",
            properties: { value: { type: "string", enum: ["scan", "phone", "none"] } },
            required: ["value"],
          },
          nextStep: "payment",
        },
        back: { label: "뒤로", nextStep: "fulfillment" },
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
          label: "결제수단 선택",
          description: "결제수단을 선택합니다. {value} 를 보냅니다.",
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
        back: { label: "뒤로", nextStep: "loyalty" },
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
        label: "주문하기",
        description: "카드 하나를 선택합니다. {item_id} 를 payload 로 보냅니다.",
        schema: {
          type: "object",
          properties: { item_id: { type: "string" } },
          required: ["item_id"],
        },
        nextStep: "options",
      },
      repeat: {
        label: "다시 듣기",
        description: "음성 안내를 다시 재생합니다(멀티턴 보조).",
      },
    },
  };
}
