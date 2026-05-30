from __future__ import annotations

import base64
import os
import tempfile
import time
from pathlib import Path

import librosa
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from inference.age import create_age_model
from inference.behavioral import score_behavioral
from inference.elevenlabs_voice import ElevenLabsClient, ElevenLabsError, choose_age_voice, load_age_voice_map
from inference.stt import NoopSTT, create_stt


load_dotenv()

API_KEY = os.getenv("API_KEY", "")
AGE_MODEL_PATH = Path(os.getenv("AGE_MODEL_PATH", "./models/age_model"))
AGE_MODEL_PROVIDER = os.getenv("AGE_MODEL_PROVIDER", "local")
AGE_DEVICE = os.getenv("AGE_DEVICE") or None
STT_MODEL = os.getenv("STT_MODEL", "small")
STT_DEVICE = os.getenv("STT_DEVICE", "cpu")
STT_COMPUTE_TYPE = os.getenv("STT_COMPUTE_TYPE", "int8")

app = FastAPI(title="Voice Adaptive Kiosk Analyze API")
STATIC_DIR = Path(__file__).resolve().parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_age_model = None
_stt = None
_elevenlabs = None


class DemoVoiceRequest(BaseModel):
    age_group: str | None = None
    language: str | None = None
    text: str | None = None
    seed: int | None = None


class AnalyzeDemoVoiceRequest(DemoVoiceRequest):
    target_decade: str | None = None


def require_auth(authorization: str | None) -> None:
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def get_age_model():
    global _age_model
    if _age_model is None:
        _age_model = create_age_model(AGE_MODEL_PROVIDER, AGE_MODEL_PATH, AGE_DEVICE)
    return _age_model


def get_stt():
    global _stt
    if _stt is None:
        try:
            _stt = create_stt(STT_MODEL, STT_DEVICE, STT_COMPUTE_TYPE)
        except Exception:
            _stt = NoopSTT()
    return _stt


def get_elevenlabs():
    global _elevenlabs
    if _elevenlabs is None:
        _elevenlabs = ElevenLabsClient()
    return _elevenlabs


@app.get("/health")
def health():
    return {
        "ok": True,
        "age_model": str(AGE_MODEL_PATH),
        "age_model_provider": AGE_MODEL_PROVIDER,
        "age_model_ready": (AGE_MODEL_PATH / "config.json").exists(),
        "stt_model": STT_MODEL,
        "elevenlabs_ready": bool(os.getenv("ELEVENLABS_API_KEY", "")),
    }


@app.get("/demo")
def demo_dashboard():
    return FileResponse(STATIC_DIR / "demo.html")


@app.get("/demo/voice-presets")
def voice_presets():
    mapping = load_age_voice_map()
    return {
        "age_groups": list(mapping.keys()),
        "voice_counts": {age_group: len(voices) for age_group, voices in mapping.items()},
    }


@app.post("/demo/random-age-voice")
def random_age_voice(request: DemoVoiceRequest):
    try:
        choice = choose_age_voice(request.age_group, seed=request.seed, language=request.language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    text = request.text or choice.default_text
    return {
        "age_group": choice.age_group,
        "language": choice.language,
        "voice_id": choice.voice_id,
        "text": text,
    }


@app.post("/demo/random-age-voice/audio")
def random_age_voice_audio(request: DemoVoiceRequest):
    try:
        choice = choose_age_voice(request.age_group, seed=request.seed, language=request.language)
        text = request.text or choice.default_text
        audio = get_elevenlabs().synthesize(text, choice.voice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ElevenLabsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "X-Age-Group": choice.age_group,
            "X-Language": choice.language,
            "X-Voice-Id": choice.voice_id,
            "X-Demo-Text": text.encode("utf-8").hex(),
        },
    )


@app.post("/demo/generate-and-analyze")
def generate_and_analyze(request: AnalyzeDemoVoiceRequest):
    try:
        choice = choose_age_voice(request.age_group or request.target_decade, seed=request.seed, language=request.language)
        text = request.text or choice.default_text
        audio = get_elevenlabs().synthesize(text, choice.voice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ElevenLabsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio)
        tmp_path = Path(tmp.name)

    started = time.perf_counter()
    try:
        waveform, _ = librosa.load(tmp_path, sr=16000, mono=True)
        duration_sec = len(waveform) / 16000.0
        age = get_age_model().predict(waveform, 16000)
        behavioral = score_behavioral(text, duration_sec, duration_sec, age.group)
        return {
            "target_decade": request.target_decade,
            "voice_bucket": choice.age_group,
            "language": choice.language,
            "voice_id": choice.voice_id,
            "text": text,
            "audio_base64": base64.b64encode(audio).decode("ascii"),
            "age": {
                "group": age.group,
                "years_est": age.years_est,
                "confidence": age.confidence,
                "child_prob": age.child_prob,
            },
            "behavioral": {
                "speech_rate": behavioral.speech_rate,
                "silence_ratio": behavioral.silence_ratio,
                "filler_count": behavioral.filler_count,
                "assist_level": behavioral.assist_level,
            },
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/analyze")
async def analyze(file: UploadFile = File(...), authorization: str | None = Header(default=None)):
    require_auth(authorization)
    started = time.perf_counter()

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        audio, sr = librosa.load(tmp_path, sr=16000, mono=True)
        duration_sec = len(audio) / 16000.0
        stt = get_stt().transcribe(str(tmp_path))
        age = get_age_model().predict(audio, 16000)
        behavioral = score_behavioral(stt.text, duration_sec, stt.speech_sec, age.group)
        return {
            "transcript": stt.text,
            "language": stt.language,
            "age": {
                "group": age.group,
                "years_est": age.years_est,
                "confidence": age.confidence,
                "child_prob": age.child_prob,
            },
            "behavioral": {
                "speech_rate": behavioral.speech_rate,
                "silence_ratio": behavioral.silence_ratio,
                "filler_count": behavioral.filler_count,
                "assist_level": behavioral.assist_level,
            },
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
    finally:
        tmp_path.unlink(missing_ok=True)
