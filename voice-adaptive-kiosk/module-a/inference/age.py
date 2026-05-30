"""나이·성별 분류 — vox-profile WavLMWrapper (tiantiaf/wavlm-large-age-sex).

베이스: microsoft/wavlm-large + LoRA + age/sex 다운스트림 헤드 (Vox-Profile, arXiv:2505.14648).
모델 코드는 inference/vox_profile/ 에 vendoring(wavlm_demographics.py, revgrad*.py).

출력(AnalyzeResult.age 와 매핑):
- group:      "50+" (years_est>=50) | "under50"   ← 보조 신호
- years_est:  추정 나이(년). 회귀 출력 age*100.
- confidence: 50 경계로부터의 거리 + 성별 신뢰도 근사.
- child_prob: 아동 화자 확률(이 모델은 child 클래스가 없어 나이에서 근사).

모델 우선순위:
1) AGE_MODEL_PATH(로컬 fine-tuned/이식 모델) 우선.
2) 없으면 AGE_HF_MODEL(기본 tiantiaf/wavlm-large-age-sex) 허브 로드.

입력 요구(원저자): 16kHz mono, 3~15초 권장(짧으면 불안정, 긴 건 15초로 절단).

환경변수:
- MOCK_MODE      : "1"이면 mock (기본)
- AGE_MODEL_PATH : 로컬 모델 디렉토리(있으면 우선)
- AGE_HF_MODEL   : 허브 모델 id (기본 tiantiaf/wavlm-large-age-sex)
- AGE_DEVICE     : "cpu" | "cuda" | "mps" (기본 cuda>cpu; WavLM은 cpu가 안전)

의존성(실모드): torch, transformers, speechbrain, loralib, huggingface_hub, soundfile/librosa.
코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np

AGE_THRESHOLD = 50          # 이 나이 이상이면 "50+"
DEFAULT_HF_MODEL = "tiantiaf/wavlm-large-age-sex"
TARGET_SR = 16000           # 모델 입력 샘플레이트
MAX_SECONDS = 15            # 원저자 권장 상한 (그 이상은 절단)
SEX_LABELS = ("Female", "Male")

# vendoring 된 vox-profile 모델 코드 디렉토리 (flat import 용 sys.path 등록)
_VOX_DIR = str(Path(__file__).resolve().parent / "vox_profile")


@dataclass(frozen=True)
class AgeResult:
    """나이 분류 산출물. AnalyzeResult.age 로 매핑."""

    group: str          # "50+" | "under50"
    years_est: int
    confidence: float
    child_prob: float


def _is_mock() -> bool:
    return os.getenv("MOCK_MODE", "1") == "1"


def _group_for(years: int) -> str:
    return "50+" if years >= AGE_THRESHOLD else "under50"


# ──────────────────────────────────────────────────────────────
# MOCK 경로
# ──────────────────────────────────────────────────────────────


def _mock_classify() -> AgeResult:
    # 데모 기본값: 고령 화자(67세)로 고정 → assist 가산 시나리오와 일관.
    years = 67
    return AgeResult(
        group=_group_for(years),
        years_est=years,
        confidence=0.72,
        child_prob=0.02,
    )


# ──────────────────────────────────────────────────────────────
# 실모델 경로 (vox-profile WavLMWrapper)
# ──────────────────────────────────────────────────────────────


def _pick_device() -> str:
    forced = os.getenv("AGE_DEVICE")
    if forced:
        return forced
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    # WavLM-large + speechbrain 조합은 mps 미검증 → cpu 가 가장 안전.
    return "cpu"


@lru_cache(maxsize=1)
def _load_model():
    """WavLMWrapper(age-sex) 로드(1회 캐시).

    AGE_MODEL_PATH(로컬) 우선, 없으면 AGE_HF_MODEL 허브.
    실모드에서만 import → MOCK_MODE 에서는 torch/speechbrain 미설치여도 동작.
    """
    import torch  # noqa: F401

    if _VOX_DIR not in sys.path:
        sys.path.insert(0, _VOX_DIR)
    from wavlm_demographics import WavLMWrapper  # vendoring 된 모델

    model_path = os.getenv("AGE_MODEL_PATH", "").strip()
    source = model_path or os.getenv("AGE_HF_MODEL", DEFAULT_HF_MODEL)

    device = _pick_device()
    model = WavLMWrapper.from_pretrained(source).to(device)
    model.eval()
    return model, device


def _load_waveform(audio_path: str) -> np.ndarray:
    """16kHz mono float32 파형 로드. soundfile 우선, 실패 시 librosa 폴백. 15초로 절단."""
    try:
        import soundfile as sf

        wav, sr = sf.read(audio_path, dtype="float32", always_2d=False)
        if wav.ndim > 1:
            wav = wav.mean(axis=1)  # mono 다운믹스
        if sr != TARGET_SR:
            import librosa

            wav = librosa.resample(wav, orig_sr=sr, target_sr=TARGET_SR)
        wav = wav.astype(np.float32)
    except Exception:
        import librosa

        wav, _ = librosa.load(audio_path, sr=TARGET_SR, mono=True)
        wav = wav.astype(np.float32)

    max_len = MAX_SECONDS * TARGET_SR
    if wav.shape[0] > max_len:
        wav = wav[:max_len]
    return wav


# 7-class(apply_reg=False) 폴백용 연령대 대표값 근사. 회귀 모델이면 사용 안 함.
_AGE_BUCKET_MIDPOINTS = (8, 18, 28, 38, 48, 60, 75)


def _parse_age_years(age_out) -> int:
    """age 출력 → 나이(년). 회귀([B,1])면 *100, 7-class면 argmax 버킷 대표값."""
    import torch

    t = torch.as_tensor(age_out).detach().float().flatten()
    n = t.numel()
    if n == 1:
        years = float(t[0]) * 100.0           # 회귀(sigmoid) → 0~100
    elif n == len(_AGE_BUCKET_MIDPOINTS):
        idx = int(torch.argmax(t).item())     # 7-class 폴백
        years = float(_AGE_BUCKET_MIDPOINTS[idx])
    else:
        years = float(t[0]) * 100.0           # 알 수 없는 형태 → 회귀로 간주
    return max(0, min(120, int(round(years))))


def _real_classify(audio_path: str) -> AgeResult:
    import torch

    model, device = _load_model()
    wav = _load_waveform(audio_path)

    data = torch.from_numpy(wav).float().unsqueeze(0).to(device)  # [1, T]
    with torch.no_grad():
        age_out, sex_out = model(data)  # forward → (age, sex)

    years = _parse_age_years(age_out)

    sex_prob = torch.softmax(torch.as_tensor(sex_out).float().flatten(), dim=0)
    sex_conf = float(sex_prob.max().item())

    # 이 모델은 child 클래스가 없음 → 나이에서 아동 확률 근사(13세 미만일수록 ↑).
    child_prob = max(0.0, min(1.0, (13.0 - years) / 13.0))

    # confidence: 50 경계로부터의 거리 × 성별 신뢰도 (회귀라 직접 신뢰도 없음 → 근사).
    boundary_dist = min(1.0, abs(years - AGE_THRESHOLD) / 50.0)
    confidence = float(max(0.0, min(1.0, (0.5 + 0.5 * boundary_dist) * sex_conf)))

    return AgeResult(
        group=_group_for(years),
        years_est=years,
        confidence=round(confidence, 3),
        child_prob=round(child_prob, 3),
    )


# ──────────────────────────────────────────────────────────────
# 공개 API
# ──────────────────────────────────────────────────────────────


def classify(audio_path: Optional[str]) -> AgeResult:
    """오디오 파일 경로 → AgeResult.

    MOCK_MODE=1 이거나 audio_path 가 없으면 고정 mock 반환.
    실모드에서 추론 실패 시에도 안전하게 mock 으로 폴백(데모 무중단).
    """
    if _is_mock() or not audio_path:
        return _mock_classify()
    try:
        return _real_classify(audio_path)
    except Exception:
        # 모델/의존성 미비 시 폴백 — 행동신호가 스파인이라 무중단이 우선.
        return _mock_classify()
