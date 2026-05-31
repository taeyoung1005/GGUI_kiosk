from __future__ import annotations

import os
import json
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_shared_dotenv(project_root: Path = PROJECT_ROOT) -> None:
    for path in [
        project_root / ".env.local",
        project_root / ".env",
    ]:
        load_dotenv(path, override=False)


load_shared_dotenv()

API_KEY = os.getenv("API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime")
OPENAI_REALTIME_LANGUAGE = os.getenv("OPENAI_REALTIME_LANGUAGE", "ko")
# GA Realtime 은 input audio transcription 에 model 을 필수로 요구한다.
# 예: gpt-4o-transcribe / gpt-4o-mini-transcribe
OPENAI_REALTIME_TRANSCRIBE_MODEL = os.getenv(
    "OPENAI_REALTIME_TRANSCRIBE_MODEL", "gpt-4o-transcribe"
)
OPENAI_REALTIME_SILENCE_MS = int(os.getenv("OPENAI_REALTIME_SILENCE_MS", "2000"))
OPENAI_REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "alloy")
MENU_BASE_URL = os.getenv(
    "MENU_BASE_URL",
    f"http://localhost:{os.getenv('MENU_PORT', '8001')}",
).rstrip("/")

FULFILLMENT_VALUES = ["Dine In", "Take Out"]
LOYALTY_VALUES = ["scan", "phone", "none"]
PAYMENT_VALUES = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"]

AGENT_TOOLS = [
    {
        "type": "function",
        "name": "select_item",
        "description": "손님이 고른 메뉴를 선택한다. 메뉴의 정확한 item_id만 사용한다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["item_id"],
            "properties": {
                "item_id": {"type": "string", "description": "메뉴 데이터의 정확한 id"},
            },
        },
    },
    {
        "type": "function",
        "name": "set_option",
        "description": "선택한 메뉴의 옵션 하나를 설정한다. 메뉴에 존재하는 option_type/choice_label만 사용한다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["option_type", "choice_label"],
            "properties": {
                "option_type": {"type": "string"},
                "choice_label": {"type": "string"},
            },
        },
    },
    {
        "type": "function",
        "name": "set_fulfillment",
        "description": "매장 이용 또는 포장을 설정한다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "string", "enum": FULFILLMENT_VALUES}},
        },
    },
    {
        "type": "function",
        "name": "set_loyalty",
        "description": "쿠폰/포인트 적립 또는 건너뛰기를 설정한다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "string", "enum": LOYALTY_VALUES}},
        },
    },
    {
        "type": "function",
        "name": "set_payment",
        "description": "결제수단을 설정한다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "required": ["value"],
            "properties": {"value": {"type": "string", "enum": PAYMENT_VALUES}},
        },
    },
    {
        "type": "function",
        "name": "confirm_order",
        "description": "손님이 최종 동의하면 결제를 확정한다. 주문번호와 합계를 돌려준다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
    },
    {
        "type": "function",
        "name": "cancel_order",
        "description": "현재 주문을 취소하고 처음 화면으로 되돌린다.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {},
        },
    },
]

app = FastAPI(title="Voice Adaptive Kiosk Analyze API")
cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "*").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_auth(authorization: str | None) -> None:
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _slim_menu(menu: dict) -> list[dict]:
    return [
        {
            "id": item.get("id", ""),
            "name": item.get("name", ""),
            "category": item.get("category", ""),
            "price": item.get("price", 0),
            "option_types": [
                option.get("type", "")
                for option in item.get("options", [])
                if option.get("type")
            ],
        }
        for item in menu.get("items", [])
    ]


def _build_agent_instructions(menu: dict) -> str:
    restaurant = menu.get("restaurant") or "OBA 카페"
    return "\n".join(
        [
            f"너는 '{restaurant}'의 친절한 음성 주문 도우미야.",
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
            json.dumps(_slim_menu(menu), ensure_ascii=False, separators=(",", ":")),
        ]
    )


def fetch_menu() -> dict:
    try:
        with urlopen(f"{MENU_BASE_URL}/menu", timeout=1.5) as response:
            payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, dict):
                return payload
    except (OSError, URLError, json.JSONDecodeError):
        pass
    return {"restaurant": "OBA 카페", "items": []}


def build_realtime_session_config(menu: dict | None = None) -> dict:
    menu = menu or fetch_menu()
    return {
        "type": "realtime",
        "model": OPENAI_REALTIME_MODEL,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "transcription": {
                    "model": OPENAI_REALTIME_TRANSCRIBE_MODEL,
                    "language": OPENAI_REALTIME_LANGUAGE,
                },
                "turn_detection": {
                    "type": "server_vad",
                    "silence_duration_ms": OPENAI_REALTIME_SILENCE_MS,
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                },
            },
            "output": {"voice": OPENAI_REALTIME_VOICE},
        },
        "instructions": _build_agent_instructions(menu),
        "tools": AGENT_TOOLS,
        "tool_choice": "auto",
    }


@app.get("/health")
def health():
    return {
        "ok": True,
        "realtime_ready": bool(OPENAI_API_KEY),
    }


@app.post("/realtime/session")
def realtime_session(authorization: str | None = Header(default=None)):
    """프론트가 WebRTC로 OpenAI Realtime에 직접 붙도록 1분짜리 ephemeral
    client_secret을 발급한다. 표준 OpenAI API 키는 백엔드에만 보관하고
    절대 브라우저로 내보내지 않는다. server VAD가 2초 침묵을 감지하면 turn을
    자동 종료하며, 최종 한국어 transcript는
    conversation.item.input_audio_transcription.completed 이벤트로 전달된다.
    """
    require_auth(authorization)

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY가 설정되지 않았습니다.")

    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)

    session_config = build_realtime_session_config()

    try:
        secret = client.realtime.client_secrets.create(
            expires_after={"anchor": "created_at", "seconds": 60},
            session=session_config,
        )
    except Exception as exc:  # noqa: BLE001 - 프론트에 한국어 오류 전달
        raise HTTPException(
            status_code=502,
            detail=f"Realtime 세션 발급 실패: {exc}",
        ) from exc

    return {
        "client_secret": secret.value,
        "model": OPENAI_REALTIME_MODEL,
        "expires_at": secret.expires_at,
    }
