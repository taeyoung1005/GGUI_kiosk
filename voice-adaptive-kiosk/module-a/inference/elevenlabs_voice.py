from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass
from typing import Any

import requests


AGE_GROUPS = ("10대", "20대", "30대", "40대", "50+")
GENDERS = ("female", "male")

# Common ElevenLabs premade voice IDs. These are only demo defaults; for a
# stronger age impression, override them with voices selected in your account.
DEFAULT_AGE_VOICE_MAP: dict[str, dict[str, list[str]]] = {
    "10대": {
        "female": ["cl7Lq9M5lHPrBM5kbtI6", "Bk8cLrXXi9WCZ4GQU4Ah"],
        "male": ["SMwXhvo7aw4gwuVT7K0Q", "jjXpgPAFnCKCpTvD2PTJ"],
    },
    "20대": {
        "female": ["FGY2WhTYpPnrIDTdsKH5", "cgSgspJ2msm6clMCkdW9"],
        "male": ["4hQGiNXzNgJFIkfUJCQT", "TX3LPaxmHKxFdv7VOQHJ"],
    },
    "30대": {
        "female": ["49S3tHf0uTVzQN5pADIu", "XrExE9yKIg1WjnnlVkGX"],
        "male": ["YYzMbXMx3hpg0mtzGZ89", "CwhRBWXzGAHq8TQ4Fs17"],
    },
    "40대": {
        "female": ["InBZ3nD3eaYhPkNfAsGL", "CZbe9WHlg5BTWN5QLdid"],
        "male": ["yoWCW4gEzLKzHZAcgCc8", "cjVigY5qzO86Huf0OWal"],
    },
    "50+": {
        "female": ["WaZvG31xdUW4gMSPq7Ud", "YHcCpa6SBWnKDaCPZJQR", "wGcFBfKz5yUQqhqr0mVy"],
        "male": ["U1nBX3lzKSM937PaYYfk", "sP6cqUGhZxuStGV0pn9o", "pqHfZKP75CvOlQylNhV4"],
    },
}

DEFAULT_TEXT_BY_AGE = {
    "ko": {
        "10대": "아이스티 하나랑 디저트 추천해 주세요.",
        "20대": "아이스 라떼 하나 빠르게 주문할게요.",
        "30대": "따뜻한 아메리카노 한 잔하고 샌드위치도 볼게요.",
        "40대": "라떼 한 잔에 너무 달지 않은 디저트로 추천해 주세요.",
        "50+": "라떼 하나 주문하려고 해요. 천천히 큰 글씨로 안내해 주세요.",
    },
    "en": {
        "10대": "Can I get an iced tea and something sweet, please?",
        "20대": "I will take an iced latte to go, please.",
        "30대": "I would like a hot americano and maybe a sandwich.",
        "40대": "Please recommend a latte and a dessert that is not too sweet.",
        "50+": "I would like to order a latte. Please guide me slowly with large text.",
    },
}


@dataclass(frozen=True)
class AgeVoiceChoice:
    age_group: str
    voice_id: str
    default_text: str
    language: str
    gender: str | None = None


class ElevenLabsError(RuntimeError):
    pass


def normalize_age_group(value: str | None) -> str:
    if not value:
        return random.choice(AGE_GROUPS)
    text = value.strip().lower().replace(" ", "")
    aliases = {
        "10": "10대",
        "0": "10대",
        "0s": "10대",
        "0대": "10대",
        "10s": "10대",
        "teen": "10대",
        "teens": "10대",
        "10대": "10대",
        "20": "20대",
        "20s": "20대",
        "20대": "20대",
        "30": "30대",
        "30s": "30대",
        "30대": "30대",
        "40": "40대",
        "40s": "40대",
        "40대": "40대",
        "50": "50+",
        "50s": "50+",
        "50+": "50+",
        "50대": "50+",
        "60": "50+",
        "60s": "50+",
        "60대": "50+",
        "70": "50+",
        "70s": "50+",
        "70대": "50+",
        "80": "50+",
        "80s": "50+",
        "80대": "50+",
        "90": "50+",
        "90s": "50+",
        "90대": "50+",
        "elder": "50+",
        "senior": "50+",
    }
    if text not in aliases:
        raise ValueError(f"Unsupported age_group: {value}")
    return aliases[text]


def normalize_language(value: str | None) -> str:
    if not value:
        return "ko"
    text = value.strip().lower()
    if text in {"ko", "kr", "kor", "korean", "한국어"}:
        return "ko"
    if text in {"en", "eng", "english", "영어"}:
        return "en"
    raise ValueError(f"Unsupported language: {value}")


def normalize_gender(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip().lower()
    if text in {"m", "man", "male"}:
        return "male"
    if text in {"f", "woman", "female"}:
        return "female"
    raise ValueError(f"Unsupported gender: {value}")


def _copy_default_voice_map() -> dict[str, dict[str, list[str]]]:
    return {
        age_group: {gender: list(voices) for gender, voices in gender_map.items()}
        for age_group, gender_map in DEFAULT_AGE_VOICE_MAP.items()
    }


def _flatten_gender_map(gender_map: dict[str, list[str]]) -> list[str]:
    voices: list[str] = []
    for gender in GENDERS:
        voices.extend(gender_map.get(gender, []))
    return voices


def load_age_voice_map(raw_json: str | None = None) -> dict[str, Any]:
    raw_json = raw_json if raw_json is not None else os.getenv("ELEVENLABS_AGE_VOICE_MAP_JSON", "")
    if not raw_json:
        return _copy_default_voice_map()
    parsed = json.loads(raw_json)
    mapping = _copy_default_voice_map()
    for key, voices in parsed.items():
        age_group = normalize_age_group(key)
        if isinstance(voices, str):
            mapping[age_group] = {"female": [voices], "male": [voices]}
        elif isinstance(voices, dict):
            mapping[age_group] = {
                normalize_gender(gender) or "female": [str(voice) for voice in values if str(voice).strip()]
                for gender, values in voices.items()
            }
        else:
            flat_voices = [str(voice) for voice in voices if str(voice).strip()]
            mapping[age_group] = {"female": flat_voices, "male": flat_voices}
    return mapping


def choose_age_voice(
    age_group: str | None,
    mapping: dict[str, Any] | None = None,
    seed: int | None = None,
    language: str | None = None,
    gender: str | None = None,
) -> AgeVoiceChoice:
    rng = random.Random(seed) if seed is not None else random
    normalized = normalize_age_group(age_group)
    normalized_language = normalize_language(language)
    normalized_gender = normalize_gender(gender)
    mapping = mapping or load_age_voice_map()
    voice_pool = mapping.get(normalized) or DEFAULT_AGE_VOICE_MAP[normalized]
    if isinstance(voice_pool, dict):
        voices = voice_pool.get(normalized_gender) if normalized_gender else _flatten_gender_map(voice_pool)
        if not voices:
            voices = _flatten_gender_map(voice_pool)
    else:
        voices = voice_pool
    voice_id = rng.choice(voices)
    return AgeVoiceChoice(
        age_group=normalized,
        voice_id=voice_id,
        default_text=DEFAULT_TEXT_BY_AGE[normalized_language][normalized],
        language=normalized_language,
        gender=normalized_gender,
    )


def build_tts_payload(text: str, model_id: str) -> dict[str, Any]:
    return {
        "text": text,
        "model_id": model_id,
        "voice_settings": {
            "stability": 0.55,
            "similarity_boost": 0.75,
            "style": 0.25,
            "use_speaker_boost": True,
        },
    }


class ElevenLabsClient:
    def __init__(
        self,
        api_key: str | None = None,
        model_id: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key or os.getenv("ELEVENLABS_API_KEY", "")
        self.model_id = model_id or os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2")
        self.timeout = timeout

    def synthesize(self, text: str, voice_id: str) -> bytes:
        if not self.api_key:
            raise ElevenLabsError("ELEVENLABS_API_KEY is not set.")
        response = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={
                "xi-api-key": self.api_key,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json=build_tts_payload(text, self.model_id),
            timeout=self.timeout,
        )
        if response.status_code >= 400:
            raise ElevenLabsError(f"ElevenLabs TTS failed: {response.status_code} {response.text[:500]}")
        return response.content
