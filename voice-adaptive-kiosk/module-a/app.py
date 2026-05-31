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
STT_MODEL = os.getenv("STT_MODEL", "whisper-1")
STT_LANGUAGE = os.getenv("STT_LANGUAGE", "ko")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")

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
