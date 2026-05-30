"""행동신호 추출 — 발화 속도·침묵·채움말 → assist_level(0~3).

적응 신호의 "스파인(주축)". 나이 모델이 부정확해도 이 행동신호가 UI 강도를 결정한다.

설계 원칙:
- 순수 함수(pure function)로 구성 → 외부 의존성(모델/IO) 없이 단위 테스트 가능.
- 입력은 STT 단어 타임스탬프 + VAD 무음 구간 + (보조) 나이 그룹.
- 출력 assist_level 룰: 느림 / 머뭇거림(침묵·채움말) / 고령(보조 가산).

코드 식별자는 영어, 주석/문서는 한국어.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

# ──────────────────────────────────────────────────────────────
# 입력 자료구조 (STT/VAD 결과의 최소 표현)
# ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Word:
    """STT 단어 타임스탬프 1개. start/end 는 초(sec) 단위."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class SpeechSegment:
    """VAD가 검출한 발화(음성) 구간. start/end 는 초(sec) 단위."""

    start: float
    end: float


# 채움말(필러) 사전 — 머뭇거림의 직접 증거 → assist_level 가산의 핵심 신호.
# 한국어 + 영어(데모 영어화) 혼용. 매칭은 소문자·정확일치(부분매칭 과탐 방지).
# 영어는 명백한 hesitation 토큰만 포함("like/well/so" 등 일반어 제외 → 오탐 방지).
FILLER_WORDS: tuple[str, ...] = (
    # 한국어
    "어",
    "음",
    "그",
    "저기",
    "그게",
    "그러니까",
    "뭐",
    "에",
    "아",
    # 영어 (Whisper 전사상 hesitation)
    "uh",
    "uhh",
    "um",
    "umm",
    "er",
    "erm",
    "hmm",
    "mm",
    "mmm",
    "eh",
)

# ──────────────────────────────────────────────────────────────
# 음절 수 추정 (한국어)
# ──────────────────────────────────────────────────────────────


def count_korean_syllables(text: str) -> int:
    """한국어 음절 수를 센다.

    한글 완성형 음절(가-힣)은 1글자=1음절. 그 외 한글 자모/숫자/영문은
    근사적으로 처리한다. speech_rate(음절/초)의 분자로 사용.

    - 가-힣(U+AC00~U+D7A3): 1음절
    - 숫자: 자릿수만큼 음절로 근사(예: "12" → 2)
    - 영문 단어: 모음 군집 수로 근사(최소 1)
    - 공백/구두점: 무시
    """
    syllables = 0
    latin_buffer: List[str] = []

    def flush_latin() -> int:
        if not latin_buffer:
            return 0
        word = "".join(latin_buffer).lower()
        latin_buffer.clear()
        # 영문 모음 군집 수 근사
        vowels = "aeiou"
        groups = 0
        prev_vowel = False
        for ch in word:
            is_vowel = ch in vowels
            if is_vowel and not prev_vowel:
                groups += 1
            prev_vowel = is_vowel
        return max(1, groups)

    for ch in text:
        if "가" <= ch <= "힣":  # 한글 완성형
            syllables += flush_latin()
            syllables += 1
        elif ch.isdigit():
            syllables += flush_latin()
            syllables += 1
        elif ch.isalpha():  # 영문 등
            latin_buffer.append(ch)
        else:
            syllables += flush_latin()
            # 공백/구두점 → 무시
    syllables += flush_latin()
    return syllables


# ──────────────────────────────────────────────────────────────
# 개별 신호 계산 (모두 순수 함수)
# ──────────────────────────────────────────────────────────────


def compute_speech_rate(
    transcript: str, words: Sequence[Word], duration_ms: int
) -> float:
    """발화 속도(음절/초). 낮을수록 느림.

    분모 = 실제 말한 시간(단어 타임스탬프 범위) 우선, 없으면 전체 길이.
    """
    syllables = count_korean_syllables(transcript)
    if words:
        speak_span = max(w.end for w in words) - min(w.start for w in words)
    else:
        speak_span = duration_ms / 1000.0
    if speak_span <= 0:
        return 0.0
    return round(syllables / speak_span, 3)


def compute_silence_ratio(
    speech_segments: Sequence[SpeechSegment], duration_ms: int
) -> float:
    """침묵 비율 0~1. (전체 길이 - 발화구간 합) / 전체 길이. 높을수록 머뭇거림."""
    total_s = duration_ms / 1000.0
    if total_s <= 0:
        return 0.0
    speech_s = 0.0
    for seg in speech_segments:
        speech_s += max(0.0, seg.end - seg.start)
    speech_s = min(speech_s, total_s)
    ratio = 1.0 - (speech_s / total_s)
    # 수치 안정화
    return round(min(1.0, max(0.0, ratio)), 3)


def count_fillers(words: Sequence[Word], transcript: str) -> int:
    """채움말("어/음/그/저기"…) 횟수.

    단어 타임스탬프가 있으면 토큰 단위로, 없으면 transcript 공백 분할로 센다.
    구두점은 제거 후 정확히 일치하는 토큰만 카운트(부분 매칭 과탐 방지).
    """
    if words:
        tokens = [w.text for w in words]
    else:
        tokens = transcript.split()
    count = 0
    for tok in tokens:
        clean = tok.strip().strip(".,!?…~- ").lower()  # 영어 대소문자 무시
        if clean in FILLER_WORDS:
            count += 1
    return count


# ──────────────────────────────────────────────────────────────
# assist_level 결정 룰 (0~3)
# ──────────────────────────────────────────────────────────────

# 임계값(휴리스틱). 데모/현장에서 조정 가능하도록 상수로 분리.
SLOW_RATE = 3.5          # 음절/초. 보통 한국어 ~4~6. 이하면 "느림" 가산
VERY_SLOW_RATE = 2.5     # 매우 느림(강한 가산)
HIGH_SILENCE = 0.40      # 침묵 비율 이상이면 "머뭇거림" 가산
VERY_HIGH_SILENCE = 0.60
FILLER_THRESHOLD = 2     # 채움말 이 횟수 이상이면 가산


def compute_assist_level(
    speech_rate: float,
    silence_ratio: float,
    filler_count: int,
    age_group: Optional[str] = None,
    child_prob: float = 0.0,
) -> int:
    """행동신호 + (보조) 나이로 assist_level(0~3)을 산출.

    점수 가산 방식:
      - 느림:      speech_rate ≤ VERY_SLOW → +2, ≤ SLOW → +1
      - 머뭇거림:  silence_ratio ≥ VERY_HIGH → +2, ≥ HIGH → +1
      - 채움말:    filler_count ≥ FILLER_THRESHOLD → +1
      - 고령 보조: age_group == "50+" → +1 (보조 신호, 주축 아님)
    최종 점수를 0~3 으로 클램프.

    안전장치: 아동 화자 확률이 매우 높으면(child_prob>0.8) 고령 가산을 무시.
    """
    score = 0

    # 느림 가산
    if speech_rate > 0 and speech_rate <= VERY_SLOW_RATE:
        score += 2
    elif speech_rate > 0 and speech_rate <= SLOW_RATE:
        score += 1

    # 머뭇거림(침묵) 가산
    if silence_ratio >= VERY_HIGH_SILENCE:
        score += 2
    elif silence_ratio >= HIGH_SILENCE:
        score += 1

    # 채움말 가산
    if filler_count >= FILLER_THRESHOLD:
        score += 1

    # 고령 보조 가산 (아동 오탐이 아닐 때만)
    if age_group == "50+" and child_prob <= 0.8:
        score += 1

    return max(0, min(3, score))


# ──────────────────────────────────────────────────────────────
# 통합 진입점
# ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class BehavioralScore:
    """behavioral.py 의 산출물. AnalyzeResult.behavioral 로 매핑된다."""

    speech_rate: float
    silence_ratio: float
    filler_count: int
    assist_level: int


def score(
    transcript: str,
    words: Sequence[Word],
    speech_segments: Sequence[SpeechSegment],
    duration_ms: int,
    age_group: Optional[str] = None,
    child_prob: float = 0.0,
) -> BehavioralScore:
    """STT/VAD 결과 → 행동신호 4종(BehavioralScore).

    /analyze 흐름에서 호출되는 단일 진입점. 모든 하위 계산은 순수 함수라
    테스트에서 부분만 검증할 수도 있다.
    """
    speech_rate = compute_speech_rate(transcript, words, duration_ms)
    silence_ratio = compute_silence_ratio(speech_segments, duration_ms)
    filler_count = count_fillers(words, transcript)
    assist_level = compute_assist_level(
        speech_rate=speech_rate,
        silence_ratio=silence_ratio,
        filler_count=filler_count,
        age_group=age_group,
        child_prob=child_prob,
    )
    return BehavioralScore(
        speech_rate=speech_rate,
        silence_ratio=silence_ratio,
        filler_count=filler_count,
        assist_level=assist_level,
    )
