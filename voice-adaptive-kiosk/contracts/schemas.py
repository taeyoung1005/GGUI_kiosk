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

# 나이대 그룹 — 한국 디지털 취약층(50+) vs 그 이하 이진 분류
AgeGroup = Literal["50+", "under50"]

# UI 적응 강도 (주축 신호) 0~3
AssistLevel = Literal[0, 1, 2, 3]


# ──────────────────────────────────────────────────────────────
# AnalyzeResult  (Module A → Module D)
# ──────────────────────────────────────────────────────────────


class AgeInfo(BaseModel):
    """나이 분류 결과 (보조 신호)."""

    group: AgeGroup
    years_est: int = Field(..., description="추정 나이(년)")
    confidence: float = Field(..., ge=0.0, le=1.0, description="분류 신뢰도 0~1")
    child_prob: float = Field(..., ge=0.0, le=1.0, description="아동 화자 확률 0~1")


class BehavioralInfo(BaseModel):
    """행동신호 (적응 주축)."""

    speech_rate: float = Field(..., description="발화 속도(음절/초). 낮을수록 느림")
    silence_ratio: float = Field(
        ..., ge=0.0, le=1.0, description="침묵 비율 0~1. 높을수록 머뭇거림"
    )
    filler_count: int = Field(..., ge=0, description='채움말("음","어"…) 횟수')
    assist_level: AssistLevel = Field(
        ..., description="UI 적응 강도 0=일반 … 3=최대 보조"
    )


class AnalyzeResult(BaseModel):
    """음성 → 전사 + 나이대 + 행동신호. Module A /analyze 응답."""

    transcript: str = Field(..., description='STT 전사. 예: "라떼 하나 주세요"')
    language: str = Field(default="ko", description="언어 코드. 한국어 기본")
    age: AgeInfo
    behavioral: BehavioralInfo
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


# ──────────────────────────────────────────────────────────────
# GenerateUIRequest / Response  (Module D → Module C)
# ──────────────────────────────────────────────────────────────


class GenerateUIRequest(BaseModel):
    transcript: str
    age_group: AgeGroup
    assist_level: AssistLevel
    menu_context: List[MenuItem] = Field(
        default_factory=list, description="후보 또는 전체 메뉴 컨텍스트"
    )
    step: Literal["recommend", "options", "confirm"]


class GenerateUIResponse(BaseModel):
    render_id: str
    embed_url: str = Field(..., description="@ggui-ai/react 로 임베드할 URL")
    # GGUI 런타임이 정의하는 actionSpec 등 자유 형식 → dict(any)
    contract: dict = Field(default_factory=dict)


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
    "AgeGroup",
    "AssistLevel",
    "AgeInfo",
    "BehavioralInfo",
    "AnalyzeResult",
    "MenuOptionChoice",
    "MenuOption",
    "MenuItem",
    "Menu",
    "GenerateUIRequest",
    "GenerateUIResponse",
    "OrderLine",
    "OrderRequest",
    "OrderResponse",
]
