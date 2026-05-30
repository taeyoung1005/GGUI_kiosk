"""STT 래퍼 — faster-whisper(CPU int8) 기반 전사 + 단어 타임스탬프.

- MOCK_MODE=1: 모델 로드 없이 고정 전사 반환(외부 의존성/모델 다운로드 불필요).
- 실모드: faster-whisper 로 16kHz wav 전사. word_timestamps=True 로 단어별
  start/end 추출 → behavioral.py 의 speech_rate/filler 계산에 사용.

환경변수:
- MOCK_MODE      : "1"이면 mock (기본)
- STT_MODEL      : faster-whisper 모델 크기/경로 (기본 "small")
- STT_DEVICE     : "cpu" | "cuda" (기본 "cpu")
- STT_COMPUTE    : "int8" | "float16" 등 (기본 "int8")
- STT_LANGUAGE   : 강제 언어 (기본 "ko")

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import List, Optional, Tuple

from .behavioral import Word


@dataclass(frozen=True)
class STTResult:
    """STT 산출물. transcript + 단어 타임스탬프 + 감지 언어."""

    transcript: str
    words: List[Word]
    language: str


def _is_mock() -> bool:
    return os.getenv("MOCK_MODE", "1") == "1"


# ──────────────────────────────────────────────────────────────
# MOCK 경로
# ──────────────────────────────────────────────────────────────

# 데모 시나리오: 느리고 머뭇거리는 어르신 발화.
# 단어 타임스탬프를 일부러 느슨하게(느린 속도 + 채움말 포함) 구성한다.
_MOCK_WORDS: List[Tuple[str, float, float]] = [
    ("어", 0.20, 0.55),
    ("라떼", 0.90, 1.40),
    ("음", 1.90, 2.25),
    ("하나", 2.70, 3.20),
    ("주세요", 3.60, 4.30),
]


def _mock_transcribe() -> STTResult:
    words = [Word(text=t, start=s, end=e) for (t, s, e) in _MOCK_WORDS]
    transcript = "어 라떼 음 하나 주세요"
    return STTResult(transcript=transcript, words=words, language="ko")


# ──────────────────────────────────────────────────────────────
# 실모델 경로 (faster-whisper)
# ──────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _load_model():
    """faster-whisper 모델을 1회 로드(프로세스 수명 동안 캐시).

    실모드에서만 import → MOCK_MODE에서는 faster-whisper 미설치여도 동작.
    """
    from faster_whisper import WhisperModel  # 지연 import

    model_name = os.getenv("STT_MODEL", "small")
    device = os.getenv("STT_DEVICE", "cpu")
    compute_type = os.getenv("STT_COMPUTE", "int8")
    # TODO: Apple Silicon에서는 mlx-whisper 백엔드로 분기하면 더 빠름.
    return WhisperModel(model_name, device=device, compute_type=compute_type)


def _real_transcribe(audio_path: str) -> STTResult:
    model = _load_model()
    language = os.getenv("STT_LANGUAGE", "ko") or None
    segments, info = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        vad_filter=False,  # VAD는 별도 모듈(vad.py)에서 처리
    )
    words: List[Word] = []
    text_parts: List[str] = []
    for seg in segments:
        text_parts.append(seg.text)
        for w in getattr(seg, "words", None) or []:
            # faster-whisper word: .word, .start, .end
            token = (w.word or "").strip()
            if not token:
                continue
            words.append(Word(text=token, start=float(w.start), end=float(w.end)))
    transcript = "".join(text_parts).strip()
    detected_lang = getattr(info, "language", None) or "ko"
    return STTResult(transcript=transcript, words=words, language=detected_lang)


# ──────────────────────────────────────────────────────────────
# 공개 API
# ──────────────────────────────────────────────────────────────


def transcribe(audio_path: Optional[str]) -> STTResult:
    """오디오 파일 경로 → STTResult.

    MOCK_MODE=1 이거나 audio_path 가 없으면 고정 mock 반환.
    """
    if _is_mock() or not audio_path:
        return _mock_transcribe()
    return _real_transcribe(audio_path)
