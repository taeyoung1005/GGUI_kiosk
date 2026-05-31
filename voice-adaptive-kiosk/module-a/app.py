from __future__ import annotations

import base64
import os
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import librosa
from dotenv import load_dotenv
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from inference.age import create_age_model
from inference.behavioral import score_behavioral
from inference.elevenlabs_voice import (
    ElevenLabsClient,
    ElevenLabsError,
    VALIDATED_SENIOR_FEMALE_TEST_VOICE_ID,
    VALIDATED_SENIOR_MALE_TEST_VOICE_ID,
    build_english_order_proxy,
    choose_age_voice,
    load_age_voice_map,
)
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
AGE_MODEL_PROVIDER = os.getenv("AGE_MODEL_PROVIDER", "wavlm_age_sex")
AGE_DEVICE = os.getenv("AGE_DEVICE") or None
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

_age_model = None
_stt = None
_elevenlabs = None


class DemoVoiceRequest(BaseModel):
    age_group: str | None = None
    gender: str | None = None
    language: str | None = None
    text: str | None = None
    seed: int | None = None


class AnnouncerVoiceRequest(BaseModel):
    text: str


class KoreanSeniorProxyRequest(BaseModel):
    text: str
    gender: str | None = None
    voice_id: str | None = None


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
        _age_model = create_age_model(AGE_MODEL_PROVIDER, device=AGE_DEVICE)
    return _age_model


def get_stt():
    global _stt
    if _stt is None:
        try:
            _stt = create_stt(STT_MODEL, STT_DEVICE, STT_COMPUTE_TYPE, STT_LANGUAGE)
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
        "age_model_provider": AGE_MODEL_PROVIDER,
        "stt_model": STT_MODEL,
        "stt_language": STT_LANGUAGE,
        "elevenlabs_ready": bool(os.getenv("ELEVENLABS_API_KEY", "")),
    }


@app.get("/demo/voice-presets")
def voice_presets():
    mapping = load_age_voice_map()
    def count_voices(value):
        if isinstance(value, dict):
            return {gender: len(voices) for gender, voices in value.items()}
        return len(value)

    return {
        "age_groups": list(mapping.keys()),
        "voice_counts": {age_group: count_voices(voices) for age_group, voices in mapping.items()},
    }


@app.post("/demo/random-age-voice")
def random_age_voice(request: DemoVoiceRequest):
    try:
        choice = choose_age_voice(request.age_group, seed=request.seed, language=request.language, gender=request.gender)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    text = request.text or choice.default_text
    return {
        "age_group": choice.age_group,
        "language": choice.language,
        "gender": choice.gender,
        "voice_id": choice.voice_id,
        "text": text,
    }


@app.post("/demo/random-age-voice/audio")
def random_age_voice_audio(request: DemoVoiceRequest):
    try:
        choice = choose_age_voice(request.age_group, seed=request.seed, language=request.language, gender=request.gender)
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
            "X-Age-Group": quote(choice.age_group, safe="+"),
            "X-Language": choice.language,
            "X-Gender": choice.gender or "",
            "X-Voice-Id": choice.voice_id,
            "X-Demo-Text": text.encode("utf-8").hex(),
        },
    )


@app.post("/demo/announcer-voice/audio")
def announcer_voice_audio(request: AnnouncerVoiceRequest):
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        audio, voice_id = get_elevenlabs().synthesize_announcer(text)
    except ElevenLabsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "X-Voice-Role": "announcer",
            "X-Voice-Id": voice_id,
            "X-Demo-Text": text.encode("utf-8").hex(),
        },
    )


@app.post("/demo/korean-senior-proxy/analyze")
def korean_senior_proxy_analyze(request: KoreanSeniorProxyRequest):
    korean_text = request.text.strip()
    if not korean_text:
        raise HTTPException(status_code=400, detail="text is required")

    started = time.perf_counter()
    try:
        if request.voice_id:
            allowed_voice_ids = {
                VALIDATED_SENIOR_FEMALE_TEST_VOICE_ID,
                VALIDATED_SENIOR_MALE_TEST_VOICE_ID,
            }
            if request.voice_id not in allowed_voice_ids:
                raise ValueError("Unsupported demo voice.")
            voice_id = request.voice_id
        else:
            voice_id = choose_age_voice("50+", language="en", gender=request.gender).voice_id
        english_proxy_text = build_english_order_proxy(korean_text)
        audio = get_elevenlabs().synthesize(english_proxy_text, voice_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ElevenLabsError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio)
        tmp_path = Path(tmp.name)

    try:
        waveform, _ = librosa.load(tmp_path, sr=16000, mono=True)
        duration_sec = len(waveform) / 16000.0
        age = get_age_model().predict(waveform, 16000)
        behavioral = score_behavioral(english_proxy_text, duration_sec, duration_sec, age.group)
        assist_level = behavioral.assist_level
        if age.group == "senior_adult":
            assist_level = max(assist_level, 2)
        return {
            "korean_text": korean_text,
            "english_proxy_text": english_proxy_text,
            "voice_id": voice_id,
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
                "assist_level": assist_level,
            },
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "audio_base64": base64.b64encode(audio).decode("ascii"),
        }
    finally:
        tmp_path.unlink(missing_ok=True)


@app.post("/demo/generate-and-analyze")
def generate_and_analyze(request: AnalyzeDemoVoiceRequest):
    try:
        choice = choose_age_voice(
            request.age_group or request.target_decade,
            seed=request.seed,
            language=request.language,
            gender=request.gender,
        )
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
            "gender": choice.gender,
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
