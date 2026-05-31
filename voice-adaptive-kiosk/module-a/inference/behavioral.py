from __future__ import annotations

import re
from dataclasses import dataclass


FILLERS = ("음", "어", "저", "그", "아", "뭐지", "잠시")


@dataclass
class BehavioralSignals:
    speech_rate: float
    silence_ratio: float
    filler_count: int
    assist_level: int


def score_behavioral(
    transcript: str,
    duration_sec: float,
    speech_sec: float | None = None,
    age_group: str = "unknown",
) -> BehavioralSignals:
    duration_sec = max(duration_sec, 0.001)
    speech_sec = duration_sec if speech_sec is None else max(speech_sec, 0.001)
    tokens = re.findall(r"[가-힣A-Za-z0-9]+", transcript)
    speech_rate = len(tokens) / max(speech_sec, 0.001)
    silence_ratio = max(0.0, min(1.0, 1.0 - speech_sec / duration_sec))
    filler_count = sum(transcript.count(filler) for filler in FILLERS)

    assist_level = 0
    if age_group in {"senior_adult", "50+", "50대", "60대 이상", "elder"}:
        assist_level += 1
    if speech_rate < 1.8 or silence_ratio > 0.35:
        assist_level += 1
    if filler_count >= 2:
        assist_level += 1
    assist_level = max(0, min(3, assist_level))

    return BehavioralSignals(
        speech_rate=round(float(speech_rate), 3),
        silence_ratio=round(float(silence_ratio), 3),
        filler_count=int(filler_count),
        assist_level=assist_level,
    )
