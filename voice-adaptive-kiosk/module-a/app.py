from __future__ import annotations

import os
from pathlib import Path

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

    session_config = {
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
    }

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
