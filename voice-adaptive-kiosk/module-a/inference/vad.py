"""VAD — silero-vad 로 발화(음성)/무음 구간 분리.

출력은 SpeechSegment 리스트(초 단위). behavioral.py 의 silence_ratio 계산에 사용.

- MOCK_MODE=1: 모델 로드 없이 고정 발화 구간 반환.
- 실모드: silero-vad(torch.hub or pip 패키지)로 16kHz wav 분석.
  silero 미설치/실패 시에도 에너지 기반 간이 VAD 로 폴백(무중단).

환경변수:
- MOCK_MODE        : "1"이면 mock (기본)
- VAD_THRESHOLD    : silero speech prob 임계값 (기본 0.5)

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

import numpy as np

from .behavioral import SpeechSegment

TARGET_SR = 16000


def _is_mock() -> bool:
    return os.getenv("MOCK_MODE", "1") == "1"


# ──────────────────────────────────────────────────────────────
# MOCK 경로
# ──────────────────────────────────────────────────────────────

# stt.py 의 mock 단어 타임스탬프와 정합되는 발화 구간.
# 단어 사이에 무음이 끼어 silence_ratio 가 높게(머뭇거림) 나오도록 구성.
_MOCK_SEGMENTS = [
    (0.20, 0.55),
    (0.90, 1.40),
    (1.90, 2.25),
    (2.70, 3.20),
    (3.60, 4.30),
]
# 전체 길이는 ~4.6s 가정 → 발화 합 ~2.0s → silence_ratio ~0.57 (머뭇거림 강함)


def _mock_segments() -> List[SpeechSegment]:
    return [SpeechSegment(start=s, end=e) for (s, e) in _MOCK_SEGMENTS]


# ──────────────────────────────────────────────────────────────
# 실모델 경로 (silero-vad)
# ──────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def _load_silero():
    """silero-vad 모델 + 유틸 로드(1회 캐시).

    실모드에서만 import → MOCK_MODE 에서는 torch 미설치여도 동작.
    """
    import torch

    # pip 패키지 silero-vad 우선, 없으면 torch.hub.
    try:
        from silero_vad import get_speech_timestamps, load_silero_vad  # type: ignore

        model = load_silero_vad()
        return model, get_speech_timestamps, None
    except Exception:
        model, utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            trust_repo=True,
        )
        get_speech_timestamps = utils[0]
        return model, get_speech_timestamps, None


def _load_waveform(audio_path: str) -> np.ndarray:
    try:
        import soundfile as sf

        wav, sr = sf.read(audio_path, dtype="float32", always_2d=False)
        if wav.ndim > 1:
            wav = wav.mean(axis=1)
        if sr != TARGET_SR:
            import librosa

            wav = librosa.resample(wav, orig_sr=sr, target_sr=TARGET_SR)
        return wav.astype(np.float32)
    except Exception:
        import librosa

        wav, _ = librosa.load(audio_path, sr=TARGET_SR, mono=True)
        return wav.astype(np.float32)


def _real_segments(audio_path: str) -> List[SpeechSegment]:
    import torch

    model, get_speech_timestamps, _ = _load_silero()
    wav = _load_waveform(audio_path)
    threshold = float(os.getenv("VAD_THRESHOLD", "0.5"))

    ts = get_speech_timestamps(
        torch.from_numpy(wav),
        model,
        sampling_rate=TARGET_SR,
        threshold=threshold,
        return_seconds=True,
    )
    segments: List[SpeechSegment] = []
    for t in ts:
        start = float(t["start"])
        end = float(t["end"])
        if end > start:
            segments.append(SpeechSegment(start=start, end=end))
    return segments


# ──────────────────────────────────────────────────────────────
# 폴백: 에너지 기반 간이 VAD
# ──────────────────────────────────────────────────────────────


def _energy_segments(audio_path: str) -> List[SpeechSegment]:
    """silero 실패 시 RMS 에너지 임계로 발화 구간 근사(무중단 보장)."""
    wav = _load_waveform(audio_path)
    if wav.size == 0:
        return []
    frame = int(0.03 * TARGET_SR)  # 30ms
    hop = frame
    rms: List[float] = []
    for i in range(0, len(wav) - frame + 1, hop):
        chunk = wav[i : i + frame]
        rms.append(float(np.sqrt(np.mean(chunk ** 2) + 1e-12)))
    if not rms:
        return []
    rms_arr = np.array(rms)
    thr = max(0.01, float(np.mean(rms_arr) * 0.5))
    active = rms_arr > thr

    segments: List[SpeechSegment] = []
    start_idx: Optional[int] = None
    for idx, a in enumerate(active):
        if a and start_idx is None:
            start_idx = idx
        elif not a and start_idx is not None:
            segments.append(
                SpeechSegment(
                    start=start_idx * hop / TARGET_SR,
                    end=idx * hop / TARGET_SR,
                )
            )
            start_idx = None
    if start_idx is not None:
        segments.append(
            SpeechSegment(
                start=start_idx * hop / TARGET_SR,
                end=len(active) * hop / TARGET_SR,
            )
        )
    return segments


# ──────────────────────────────────────────────────────────────
# 공개 API
# ──────────────────────────────────────────────────────────────


def split(audio_path: Optional[str]) -> List[SpeechSegment]:
    """오디오 파일 경로 → 발화 구간 리스트(SpeechSegment).

    MOCK_MODE=1 이거나 audio_path 없으면 고정 mock. 실모드 실패 시 에너지 폴백.
    """
    if _is_mock() or not audio_path:
        return _mock_segments()
    try:
        segs = _real_segments(audio_path)
        if segs:
            return segs
        return _energy_segments(audio_path)
    except Exception:
        try:
            return _energy_segments(audio_path)
        except Exception:
            return _mock_segments()
