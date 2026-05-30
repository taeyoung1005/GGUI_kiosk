"""Module A — AI 추론 서비스 (FastAPI).

책임: 음성(wav 16kHz mono) → AnalyzeResult(STT + 나이 + 행동신호).

엔드포인트:
- POST /analyze : multipart(file=audio) 또는 JSON({audio_base64}) → AnalyzeResult
- GET  /health  : 헬스체크 + 현재 모드(mock 여부)

처리 흐름(SPEC §2.4):
  audio → vad.split → [stt.transcribe → transcript+ts] + [age.classify → group]
        → behavioral.score(ts, transcript, segments) → assist_level
        → AnalyzeResult

MOCK_MODE=1(기본): 외부 모델 없이 즉시 기동, 유효한 AnalyzeResult 반환.

실행:
  uvicorn app:app --port 8000           # module-a/ 에서
  (또는)  python app.py

코드 식별자는 영어, 주석/문서는 한국어.
"""

from __future__ import annotations

import base64
import os
import sys
import tempfile
import time
import wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ──────────────────────────────────────────────────────────────
# contracts/schemas.py import 경로 설정
#   레이아웃: voice-adaptive-kiosk/{contracts, module-a}
#   module-a 에서 실행해도 contracts 를 import 할 수 있도록 루트를 sys.path 에 추가.
# ──────────────────────────────────────────────────────────────
_THIS_DIR = Path(__file__).resolve().parent          # .../module-a
_PROJECT_ROOT = _THIS_DIR.parent                     # .../voice-adaptive-kiosk
for _p in (str(_PROJECT_ROOT), str(_THIS_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ──────────────────────────────────────────────────────────────
# .env.local / .env 경량 로더 (의존성 없이)
#   우선순위: 실제 셸 export > .env.local > .env
#   (setdefault 라 이미 set 된 env 는 덮어쓰지 않음 → 셸 export 가 최우선)
# ──────────────────────────────────────────────────────────────
def _load_dotenv() -> None:
    for _name in (".env.local", ".env"):
        _path = _THIS_DIR / _name
        if not _path.exists():
            continue
        for _raw in _path.read_text(encoding="utf-8").splitlines():
            _line = _raw.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            _k, _v = _k.strip(), _v.strip()
            if (_v[:1] == '"' and _v[-1:] == '"') or (_v[:1] == "'" and _v[-1:] == "'"):
                _v = _v[1:-1]
            os.environ.setdefault(_k, _v)


_load_dotenv()

from contracts.schemas import (  # noqa: E402  (path 설정 후 import)
    AgeInfo,
    AnalyzeResult,
    BehavioralInfo,
)

from inference import age as age_mod  # noqa: E402
from inference import behavioral as beh_mod  # noqa: E402
from inference import stt as stt_mod  # noqa: E402
from inference import vad as vad_mod  # noqa: E402

# ──────────────────────────────────────────────────────────────
# 앱 설정
# ──────────────────────────────────────────────────────────────

API_KEY = os.getenv("API_KEY", "").strip()  # 비어 있으면 인증 비활성(로컬 개발)


def _is_mock() -> bool:
    return os.getenv("MOCK_MODE", "1") == "1"


app = FastAPI(
    title="Voice Adaptive Kiosk — Module A (AI Inference)",
    description="음성 → 전사 + 나이대 + 행동신호(assist_level). MOCK_MODE 지원.",
    version="0.1.0",
)

# CORS — 프론트(Module D)에서 직접 호출 허용. 데모는 전체 허용, 운영은 도메인 제한.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────
# 요청 모델
# ──────────────────────────────────────────────────────────────


class AnalyzeJSONRequest(BaseModel):
    """JSON 본문 요청 — base64 인코딩된 오디오."""

    audio_base64: Optional[str] = None


# ──────────────────────────────────────────────────────────────
# 유틸
# ──────────────────────────────────────────────────────────────


def _check_auth(request: Request) -> None:
    """API_KEY 가 설정된 경우에만 Bearer 토큰 검증(원격 노출 대비)."""
    if not API_KEY:
        return
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _probe_duration_ms(audio_path: Optional[str]) -> int:
    """wav 헤더로 길이(ms) 추정. 실패하면 mock 기본값."""
    if not audio_path:
        return 4600  # mock 시나리오 길이(~4.6s)
    try:
        with wave.open(audio_path, "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate() or 16000
            return int(round(frames / rate * 1000))
    except Exception:
        # wav 가 아니거나 헤더 파손 → soundfile 로 재시도
        try:
            import soundfile as sf

            info = sf.info(audio_path)
            return int(round(info.frames / info.samplerate * 1000))
        except Exception:
            return 4600


def _persist_upload(data: bytes, suffix: str = ".wav") -> str:
    """업로드 바이트를 임시 파일로 저장하고 경로 반환(호출자가 정리)."""
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return path


def _run_pipeline(audio_path: Optional[str]) -> AnalyzeResult:
    """SPEC §2.4 처리 흐름 — STT/VAD/나이/행동신호 → AnalyzeResult."""
    duration_ms = _probe_duration_ms(audio_path)

    # 1) STT (전사 + 단어 타임스탬프)
    stt_res = stt_mod.transcribe(audio_path)

    # 2) VAD (발화/무음 구간)
    segments = vad_mod.split(audio_path)

    # 3) 나이 분류 (보조 신호)
    age_res = age_mod.classify(audio_path)

    # 4) 행동신호 (주축) — 나이는 보조 가산으로만 전달
    beh = beh_mod.score(
        transcript=stt_res.transcript,
        words=stt_res.words,
        speech_segments=segments,
        duration_ms=duration_ms,
        age_group=age_res.group,
        child_prob=age_res.child_prob,
    )

    return AnalyzeResult(
        transcript=stt_res.transcript,
        language=stt_res.language or "ko",
        age=AgeInfo(
            group=age_res.group,
            years_est=age_res.years_est,
            confidence=age_res.confidence,
            child_prob=age_res.child_prob,
        ),
        behavioral=BehavioralInfo(
            speech_rate=beh.speech_rate,
            silence_ratio=beh.silence_ratio,
            filler_count=beh.filler_count,
            assist_level=beh.assist_level,  # type: ignore[arg-type]
        ),
        duration_ms=duration_ms,
    )


# ──────────────────────────────────────────────────────────────
# 엔드포인트
# ──────────────────────────────────────────────────────────────


@app.get("/health")
def health() -> dict:
    """헬스체크 — 기동 여부 + 현재 모드."""
    return {
        "status": "ok",
        "mock_mode": _is_mock(),
        "auth_required": bool(API_KEY),
        "version": app.version,
    }


@app.post("/analyze", response_model=AnalyzeResult)
async def analyze(
    request: Request,
    file: Optional[UploadFile] = File(default=None),
) -> AnalyzeResult:
    """음성 → AnalyzeResult.

    입력(둘 중 하나):
    - multipart/form-data: file=audio.wav (16kHz mono 권장)
    - application/json:     {"audio_base64": "..."}

    MOCK_MODE=1 이면 오디오 없이도 고정 시나리오로 유효 결과를 반환한다.
    """
    _check_auth(request)
    started = time.time()

    audio_path: Optional[str] = None
    tmp_to_cleanup: Optional[str] = None

    try:
        # 1) multipart 파일
        if file is not None:
            data = await file.read()
            if data:
                suffix = Path(file.filename or "audio.wav").suffix or ".wav"
                audio_path = _persist_upload(data, suffix=suffix)
                tmp_to_cleanup = audio_path

        # 2) JSON base64 (파일이 없을 때만 시도)
        if audio_path is None:
            ctype = request.headers.get("content-type", "")
            if "application/json" in ctype:
                try:
                    body = await request.json()
                except Exception:
                    body = {}
                b64 = (body or {}).get("audio_base64")
                if b64:
                    try:
                        raw = base64.b64decode(b64)
                    except Exception:
                        raise HTTPException(
                            status_code=400, detail="audio_base64 디코딩 실패"
                        )
                    audio_path = _persist_upload(raw, suffix=".wav")
                    tmp_to_cleanup = audio_path

        # 3) 비-mock 모드인데 오디오가 전혀 없으면 에러
        if audio_path is None and not _is_mock():
            raise HTTPException(
                status_code=400,
                detail="오디오 입력이 필요합니다 (multipart file 또는 audio_base64).",
            )

        result = _run_pipeline(audio_path)

        # 실제 처리 길이가 더 정확하면 mock 길이 대체(파일이 있었을 때만)
        # duration_ms 는 _run_pipeline 에서 이미 산출되므로 그대로 반환.
        return result
    finally:
        if tmp_to_cleanup and os.path.exists(tmp_to_cleanup):
            try:
                os.remove(tmp_to_cleanup)
            except OSError:
                pass
        _ = time.time() - started  # latency 측정 훅(필요시 로깅)


# 로컬 직접 실행 지원: python app.py
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=bool(os.getenv("RELOAD", "")),
    )
