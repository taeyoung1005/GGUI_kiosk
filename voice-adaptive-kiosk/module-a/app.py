from __future__ import annotations

import base64
import csv
import json
import os
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib.parse import quote

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
ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts" / "age-demo-balanced-en-v1"
BATCH_SUMMARY_PATH = ARTIFACTS_DIR / "age_demo_batch_en_100_summary.json"
BATCH_CSV_PATH = ARTIFACTS_DIR / "age_demo_batch_en_100.csv"
FAIRSPEECH_ARTIFACTS_DIR = Path(__file__).resolve().parent / "artifacts" / "fairspeech-eval-v1"
FAIRSPEECH_SUMMARY_PATH = FAIRSPEECH_ARTIFACTS_DIR / "fairspeech_eval_summary.json"
FAIRSPEECH_CSV_PATH = FAIRSPEECH_ARTIFACTS_DIR / "fairspeech_eval.csv"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

_age_model = None
_stt = None
_elevenlabs = None


class DemoVoiceRequest(BaseModel):
    age_group: str | None = None
    gender: str | None = None
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


def _first_present(row: dict[str, str], keys: list[str]) -> str:
    for key in keys:
        value = row.get(key)
        if value:
            return value
    return ""


def load_demo_batch_summary(summary_path: Path | None = None, csv_path: Path | None = None):
    if summary_path is None and csv_path is None:
        if FAIRSPEECH_SUMMARY_PATH.exists() and FAIRSPEECH_CSV_PATH.exists():
            summary_path = FAIRSPEECH_SUMMARY_PATH
            csv_path = FAIRSPEECH_CSV_PATH
        else:
            summary_path = BATCH_SUMMARY_PATH
            csv_path = BATCH_CSV_PATH
    elif summary_path is None or csv_path is None:
        return {"available": False}

    if not summary_path.exists() or not csv_path.exists():
        return {"available": False}

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    with csv_path.open(encoding="utf-8", newline="") as fp:
        rows = list(csv.DictReader(fp))

    evaluation_label = summary.get("evaluation_label", "metadata_proxy")
    note = summary.get(
        "note",
        "ElevenLabs voice metadata is a proxy label, not verified speaker age ground truth.",
    )
    return {
        "available": True,
        "evaluation_label": evaluation_label,
        "note": note,
        "total": summary.get("total", len(rows)),
        "ok": summary.get("ok", sum(1 for row in rows if row.get("status") == "ok")),
        "match": summary.get("match", 0),
        "by_expected_decade": summary.get("by_expected_decade", summary.get("by_expected_age_bin", {})),
        "by_gender": summary.get("by_gender", {}),
        "target_distribution": dict(Counter(_first_present(row, ["target_age_bin", "target_age_group", "expected_decade"]) for row in rows)),
        "gender_distribution": dict(Counter(_first_present(row, ["gender", "gender_prompt"]) for row in rows)),
        "predicted_distribution": dict(Counter(_first_present(row, ["predicted_age_bin", "predicted_decade"]) for row in rows)),
    }


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


@app.get("/demo/batch-summary")
def demo_batch_summary():
    return load_demo_batch_summary()


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
