from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

import librosa
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from inference.stt import NoopSTT, create_stt


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def load_shared_dotenv(project_root: Path = PROJECT_ROOT) -> None:
    for path in [
        project_root / ".env.local",
        project_root / ".env",
        project_root / "module-c" / ".env.local",
        project_root / "module-c" / ".env",
        Path(__file__).resolve().parent / ".env.local",
        Path(__file__).resolve().parent / ".env",
    ]:
        load_dotenv(path, override=False)


load_shared_dotenv()

API_KEY = os.getenv("API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "ko")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime")
OPENAI_REALTIME_LANGUAGE = os.getenv("OPENAI_REALTIME_LANGUAGE", "ko")
OPENAI_REALTIME_SILENCE_MS = int(os.getenv("OPENAI_REALTIME_SILENCE_MS", "2000"))

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

_stt = None


def require_auth(authorization: str | None) -> None:
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def get_stt():
    global _stt
    if _stt is None:
        try:
            _stt = create_stt(STT_MODEL, STT_DEVICE, STT_COMPUTE_TYPE, STT_LANGUAGE)
        except Exception:
            _stt = NoopSTT()
    return _stt


@app.get("/health")
def health():
    return {
        "ok": True,
        "stt_model": STT_MODEL,
        "stt_language": STT_LANGUAGE,
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
        "audio": {
            "input": {
                "transcription": {
                    "language": OPENAI_REALTIME_LANGUAGE,
                },
                "turn_detection": {
                    "type": "server_vad",
                    "silence_duration_ms": OPENAI_REALTIME_SILENCE_MS,
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                },
            },
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


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    require_auth(authorization)
    started = time.perf_counter()

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        librosa.load(tmp_path, sr=16000, mono=True)
        stt = get_stt().transcribe(str(tmp_path))
        return {
            "transcript": stt.text,
            "language": stt.language,
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
    finally:
        tmp_path.unlink(missing_ok=True)
