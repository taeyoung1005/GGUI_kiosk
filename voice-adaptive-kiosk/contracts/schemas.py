"""공유 데이터 계약 — pydantic v2 미러 (contracts/schemas.py).

contracts/types.ts(정본)를 파이썬으로 미러한 것. Module A(FastAPI)에서 import 하여
요청/응답 검증·직렬화에 사용한다. 정본이 바뀌면 이 파일도 함께 갱신한다.

사용 예 (Module A):
    from contracts.schemas import AnalyzeResult
    return AnalyzeResult(...)   # FastAPI response_model 로도 사용 가능

코드 식별자는 영어, 주석/문서는 한국어 OK.
"""

from __future__ import annotations

from typing import Dict, List, Literal

from pydantic import BaseModel, Field

# ──────────────────────────────────────────────────────────────
# 타입 별칭
# ──────────────────────────────────────────────────────────────

AdaptiveStep = Literal["recommend", "options", "fulfillment", "loyalty", "payment", "confirm"]
FulfillmentMode = Literal["Dine In", "Take Out"]
LoyaltyMode = Literal["scan", "phone", "none"]
PaymentMethod = Literal["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"]
GroundIntentName = Literal[
    "select_item",
    "set_options",
    "set_fulfillment",
    "set_loyalty",
    "set_payment",
    "confirm",
    "change",
    "cancel",
    "unknown",
]


# ──────────────────────────────────────────────────────────────
# AnalyzeResult  (Module A → Module D)
# ──────────────────────────────────────────────────────────────


class AnalyzeResult(BaseModel):
    """음성 → 전사(transcript). Module A /analyze 응답.

    적응 강도는 항상 고령자 최대로 고정되므로 나이/행동신호는 계약에 싣지 않는다.
    """

    transcript: str = Field(..., description='STT 전사. 예: "라떼 한 잔 주세요"')
    language: str = Field(default="ko", description="언어 코드. 한국어 기본")
    duration_ms: int = Field(..., ge=0, description="입력 오디오 길이(ms)")


# ──────────────────────────────────────────────────────────────
# Menu / MenuItem / MenuOption  (Module B → Module D, C)
# ──────────────────────────────────────────────────────────────


class MenuOptionChoice(BaseModel):
    label: str = Field(..., description='선택지 라벨. 예: "HOT", "L"')
    price_delta: int = Field(default=0, description="가산 가격(원). 기본 0")


class MenuOption(BaseModel):
    type: str = Field(..., description='옵션 종류. 예: "온도", "사이즈"')
    choices: List[MenuOptionChoice]


class MenuItem(BaseModel):
    id: str = Field(..., description='고유 식별자. 예: "latte-001"')
    name: str
    category: str = Field(..., description='카테고리. 예: "커피"')
    price: int = Field(..., ge=0, description="기본 가격(원)")
    image_url: str
    desc: str
    options: List[MenuOption] = Field(default_factory=list)


class Menu(BaseModel):
    restaurant: str
    categories: List[str]
    items: List[MenuItem]


class AdaptiveOrderState(BaseModel):
    selected_item_id: str | None = None
    selected_item_name: str | None = None
    selected_options: Dict[str, str] = Field(default_factory=dict)
    quantity: int = Field(default=1, ge=1)
    fulfillment: FulfillmentMode | None = None
    loyalty: LoyaltyMode | None = None
    payment_method: PaymentMethod | None = None
    total: int = Field(default=0, ge=0)


# ──────────────────────────────────────────────────────────────
# GenerateUIRequest / Response  (Module D → Module C)
# ──────────────────────────────────────────────────────────────


class GenerateUIRequest(BaseModel):
    transcript: str
    menu_context: List[MenuItem] = Field(
        default_factory=list, description="후보 또는 전체 메뉴 컨텍스트"
    )
    order_state: AdaptiveOrderState | None = None
    possible_actions: List[str] = Field(default_factory=list)
    step: AdaptiveStep


class GenerateUIResponse(BaseModel):
    render_id: str
    embed_url: str = Field(..., description="@ggui-ai/react 로 임베드할 URL")
    # GGUI 런타임이 정의하는 actionSpec 등 자유 형식 → dict(any)
    contract: dict = Field(default_factory=dict)


# ──────────────────────────────────────────────────────────────
# GroundIntentRequest / Response  (Module D → Module C)
# ──────────────────────────────────────────────────────────────


class GroundIntentRequest(BaseModel):
    step: AdaptiveStep
    transcript: str
    menu_context: List[MenuItem] = Field(default_factory=list)
    selected_item: MenuItem | None = None
    order_state: AdaptiveOrderState | None = None


class GroundItemCandidate(BaseModel):
    item_id: str
    confidence: float = Field(..., ge=0.0, le=1.0)


class GroundIntentResponse(BaseModel):
    step: AdaptiveStep
    intent: GroundIntentName
    item_candidates: List[GroundItemCandidate] = Field(default_factory=list)
    selected_options: Dict[str, str] = Field(default_factory=dict)
    fulfillment: FulfillmentMode | None = None
    loyalty: LoyaltyMode | None = None
    payment_method: PaymentMethod | None = None
    confirm: Literal["yes", "no", "change"] | None = None
    needs_clarification: bool = False
    clarification_reason: str | None = None


# ──────────────────────────────────────────────────────────────
# OrderRequest / Response / OrderLine  (Module D → Module B)
# ──────────────────────────────────────────────────────────────


class OrderLine(BaseModel):
    item_id: str
    options: Dict[str, str] = Field(
        default_factory=dict, description='예: {"온도": "HOT", "사이즈": "R"}'
    )
    qty: int = Field(default=1, ge=1)


class OrderRequest(BaseModel):
    items: List[OrderLine]


class OrderResponse(BaseModel):
    order_id: str
    total: int = Field(..., ge=0, description="합계 금액(원)")
    status: Literal["paid"] = Field(default="paid", description="mock 결제 — 항상 paid")


__all__ = [
    "AdaptiveStep",
    "FulfillmentMode",
    "LoyaltyMode",
    "PaymentMethod",
    "GroundIntentName",
    "AnalyzeResult",
    "MenuOptionChoice",
    "MenuOption",
    "MenuItem",
    "Menu",
    "AdaptiveOrderState",
    "GenerateUIRequest",
    "GenerateUIResponse",
    "GroundIntentRequest",
    "GroundItemCandidate",
    "GroundIntentResponse",
    "OrderLine",
    "OrderRequest",
    "OrderResponse",
]
