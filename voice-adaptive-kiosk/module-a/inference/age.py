from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np


@dataclass
class AgePrediction:
    group: str
    confidence: float
    years_est: float | None = None
    child_prob: float = 0.0


def _to_float(value: Any) -> float:
    array = np.asarray(value, dtype=np.float32)
    return float(array.reshape(-1)[0])


def age_years_to_group(years: float) -> str:
    years = max(0.0, min(100.0, float(years)))
    if years < 30:
        return "young_adult"
    if years <= 60:
        return "adult"
    return "senior_adult"


def prediction_from_years(years: Any, confidence: float = 1.0) -> AgePrediction:
    years_float = max(0.0, min(100.0, _to_float(years)))
    confidence_float = max(0.0, min(1.0, float(confidence)))
    return AgePrediction(
        group=age_years_to_group(years_float),
        years_est=round(years_float, 2),
        confidence=confidence_float,
        child_prob=1.0 if years_float < 13 else 0.0,
    )


class VoxProfileWavLMAgeSexClassifier:
    model_id = "tiantiaf/wavlm-large-age-sex"

    def __init__(self, device: str | None = None) -> None:
        import torch

        self._ensure_vox_profile_import_path()
        try:
            from src.model.age_sex.wavlm_demographics import WavLMWrapper
        except Exception as exc:
            raise RuntimeError(
                "Vox-Profile source is not available. Clone it to "
                "`module-a/vendor/vox-profile-release` or set VOX_PROFILE_REPO."
            ) from exc

        self.torch = torch
        self.device = torch.device(device or ("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"))
        self.model = WavLMWrapper.from_pretrained(self.model_id).to(self.device)
        self.model.eval()

    @staticmethod
    def _ensure_vox_profile_import_path() -> None:
        default_repo = Path(__file__).resolve().parents[1] / "vendor" / "vox-profile-release"
        repo_path = Path(os.getenv("VOX_PROFILE_REPO", default_repo)).expanduser().resolve()
        candidates = [
            repo_path,
            repo_path / "src" / "model",
            repo_path / "src" / "model" / "age_sex",
        ]
        for candidate in candidates:
            if candidate.exists():
                candidate_str = str(candidate)
                if candidate_str not in sys.path:
                    sys.path.insert(0, candidate_str)

    @staticmethod
    def _prepare_audio(audio: np.ndarray, sampling_rate: int) -> np.ndarray:
        if sampling_rate != 16000:
            raise ValueError("VoxProfileWavLMAgeSexClassifier expects 16kHz audio.")
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)
        max_samples = 15 * 16000
        if len(audio) > max_samples:
            audio = audio[:max_samples]
        if len(audio) < 16000:
            audio = np.pad(audio, (0, 16000 - len(audio)))
        return audio

    def predict(self, audio: np.ndarray, sampling_rate: int) -> AgePrediction:
        torch = self.torch
        prepared = self._prepare_audio(audio, sampling_rate)
        tensor = torch.from_numpy(prepared).float().unsqueeze(0).to(self.device)
        with torch.inference_mode():
            age_output, sex_output = self.model(tensor)
            age_years = age_output.detach().cpu().numpy() * 100.0
            sex_prob = torch.softmax(sex_output, dim=1).detach().cpu().numpy()
        confidence = float(np.max(sex_prob))
        return prediction_from_years(age_years, confidence=confidence)


def create_age_model(provider: str, model_path: str | Path | None = None, device: str | None = None):
    normalized = provider.strip().lower()
    if normalized in {"wavlm_age_sex", "vox_profile", "tiantiaf"}:
        return VoxProfileWavLMAgeSexClassifier(device=device)
    raise ValueError(f"Unsupported AGE_MODEL_PROVIDER: {provider}")
