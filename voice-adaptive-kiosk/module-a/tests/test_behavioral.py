"""behavioral.py 순수 함수 단위 테스트.

실행:  cd module-a && pytest -q
또는:  cd module-a && python -m pytest tests/test_behavioral.py -q
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# module-a 를 import 경로에 추가
_MODULE_A = Path(__file__).resolve().parent.parent
if str(_MODULE_A) not in sys.path:
    sys.path.insert(0, str(_MODULE_A))

from inference.behavioral import (  # noqa: E402
    SpeechSegment,
    Word,
    compute_assist_level,
    compute_silence_ratio,
    compute_speech_rate,
    count_fillers,
    count_korean_syllables,
    score,
)


# ── 음절 수 ──────────────────────────────────────────────────


def test_count_korean_syllables_basic():
    assert count_korean_syllables("라떼") == 2
    assert count_korean_syllables("하나 주세요") == 5  # 하/나/주/세/요
    assert count_korean_syllables("") == 0


def test_count_korean_syllables_mixed():
    # 숫자 자릿수 + 한글
    assert count_korean_syllables("커피 2잔") == 4  # 커/피/2/잔


# ── speech_rate ──────────────────────────────────────────────


def test_speech_rate_uses_word_span():
    words = [Word("라떼", 0.0, 0.5), Word("주세요", 4.0, 4.5)]
    # 음절=5("라떼주세요"), span=4.5 → ~1.11 (느림)
    rate = compute_speech_rate("라떼 주세요", words, duration_ms=5000)
    assert 1.0 <= rate <= 1.3


def test_speech_rate_fallback_to_duration():
    rate = compute_speech_rate("라떼 주세요", [], duration_ms=1000)
    # 음절 5 / 1.0s = 5.0
    assert rate == 5.0


# ── silence_ratio ────────────────────────────────────────────


def test_silence_ratio_half():
    segs = [SpeechSegment(0.0, 1.0)]
    # 발화 1s / 전체 2s → 침묵 0.5
    assert compute_silence_ratio(segs, duration_ms=2000) == 0.5


def test_silence_ratio_clamped():
    segs = [SpeechSegment(0.0, 5.0)]  # 발화가 전체보다 길어도 0 으로 클램프
    assert compute_silence_ratio(segs, duration_ms=2000) == 0.0


# ── filler 카운트 ────────────────────────────────────────────


def test_count_fillers_with_words():
    words = [Word("어", 0, 0.3), Word("라떼", 1, 1.5), Word("음", 2, 2.3)]
    assert count_fillers(words, "어 라떼 음") == 2


def test_count_fillers_no_partial_match():
    # "어른" 은 "어" 의 부분이지만 채움말이 아님 → 카운트 안 됨
    words = [Word("어른", 0, 0.5)]
    assert count_fillers(words, "어른") == 0


# ── assist_level 룰 ──────────────────────────────────────────


def test_assist_level_fast_young_speaker():
    # 빠르고 침묵 적고 채움말 없음, under50 → 0
    level = compute_assist_level(
        speech_rate=5.0, silence_ratio=0.1, filler_count=0, age_group="under50"
    )
    assert level == 0


def test_assist_level_slow_hesitant_senior_maxes():
    # 매우 느림(+2) + 매우 높은 침묵(+2) + 채움말(+1) + 50+(+1) → 6 → 클램프 3
    level = compute_assist_level(
        speech_rate=2.0, silence_ratio=0.65, filler_count=3, age_group="50+"
    )
    assert level == 3


def test_assist_level_mid():
    # 느림(+1) + 높은 침묵(+1) → 2
    level = compute_assist_level(
        speech_rate=3.0, silence_ratio=0.45, filler_count=0, age_group="under50"
    )
    assert level == 2


def test_assist_level_child_suppresses_senior_bonus():
    # 50+ 로 분류됐지만 child_prob 매우 높음 → 고령 가산 무시
    base = compute_assist_level(
        speech_rate=5.0, silence_ratio=0.1, filler_count=0,
        age_group="50+", child_prob=0.95,
    )
    assert base == 0


# ── 통합 score() ─────────────────────────────────────────────


def test_score_senior_scenario_is_high_assist():
    # mock 시나리오와 유사: 느린 어르신 발화
    words = [
        Word("어", 0.2, 0.55),
        Word("라떼", 0.9, 1.4),
        Word("음", 1.9, 2.25),
        Word("하나", 2.7, 3.2),
        Word("주세요", 3.6, 4.3),
    ]
    segs = [SpeechSegment(s, e) for (s, e) in
            [(0.2, 0.55), (0.9, 1.4), (1.9, 2.25), (2.7, 3.2), (3.6, 4.3)]]
    out = score(
        transcript="어 라떼 음 하나 주세요",
        words=words,
        speech_segments=segs,
        duration_ms=4600,
        age_group="50+",
        child_prob=0.02,
    )
    assert out.filler_count == 2
    assert out.silence_ratio > 0.4   # 머뭇거림 큼
    assert out.assist_level >= 2     # 강한 보조


if __name__ == "__main__":
    # pytest 없이도 빠르게 검증 가능
    import traceback

    failures = 0
    g = dict(globals())
    for name, fn in g.items():
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except Exception:
                failures += 1
                print(f"FAIL {name}")
                traceback.print_exc()
    sys.exit(1 if failures else 0)
