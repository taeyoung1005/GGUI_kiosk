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
  },
  required: ["id", "name", "price"],
};

/**
 * step 별 DataContract 생성.
 * step: "recommend" | "options" | "confirm"
 */
export function buildDataContract(step, { candidates, profile }) {
  const intentByStep = {
    recommend:
      "노인친화 키오스크 추천 화면 — 큰 카드 2~3장으로 메뉴를 추천하고 한 번의 큰 터치로 선택받는다.",
    options:
      "노인친화 키오스크 옵션 화면 — 온도/사이즈 등을 큰 예/아니요·큰 버튼으로 한 항목씩 고르게 한다.",
    confirm:
      "노인친화 키오스크 확인 화면 — 선택을 요약하고 ‘예/아니요’ 큰 버튼으로 주문을 확정한다.",
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
    ageGroup: { schema: { type: "string", enum: ["50+", "under50"] } },
    voiceGuide: {
      schema: { type: "string" },
      description: "speechSynthesis 로 읽어줄 음성 안내 문구(없으면 무음).",
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
          description: "옵션 한 항목 선택. payload 로 {type, label} 전달.",
          schema: {
            type: "object",
            properties: { type: { type: "string" }, label: { type: "string" } },
            required: ["type", "label"],
          },
          nextStep: "confirm",
        },
        back: { label: "이전으로", nextStep: "recommend" },
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
          label: "예, 주문할게요",
          icon: "✅",
          description: "주문 확정 → Module B /orders(mock 결제)로 진행.",
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
        label: "이거 주문",
        description: "카드 한 장 선택. payload 로 {item_id} 전달.",
        schema: {
          type: "object",
          properties: { item_id: { type: "string" } },
          required: ["item_id"],
        },
        nextStep: "options",
      },
      repeat: {
        label: "다시 듣기",
        description: "음성 안내를 다시 재생(멀티턴 보조).",
      },
    },
  };
}
