from __future__ import annotations

import json
import unittest

from inference.elevenlabs_voice import (
    AGE_GROUPS,
    build_tts_payload,
    choose_age_voice,
    load_age_voice_map,
    normalize_age_group,
    normalize_gender,
    normalize_language,
)


class ElevenLabsVoiceTest(unittest.TestCase):
    def test_normalize_age_group_accepts_aliases(self) -> None:
        self.assertEqual(normalize_age_group("teen"), "10대")
        self.assertEqual(normalize_age_group("0대"), "10대")
        self.assertEqual(normalize_age_group("20s"), "20대")
        self.assertEqual(normalize_age_group("50"), "50+")
        self.assertEqual(normalize_age_group("70대"), "50+")
        self.assertEqual(normalize_age_group("50대"), "50+")
        self.assertIn(normalize_age_group(None), AGE_GROUPS)

    def test_normalize_language_accepts_ko_and_en(self) -> None:
        self.assertEqual(normalize_language("ko"), "ko")
        self.assertEqual(normalize_language("korean"), "ko")
        self.assertEqual(normalize_language("en"), "en")
        self.assertEqual(normalize_language("english"), "en")

    def test_normalize_gender_accepts_male_and_female(self) -> None:
        self.assertEqual(normalize_gender("male"), "male")
        self.assertEqual(normalize_gender("m"), "male")
        self.assertEqual(normalize_gender("female"), "female")
        self.assertEqual(normalize_gender("f"), "female")
        self.assertIsNone(normalize_gender(None))

    def test_load_age_voice_map_accepts_json_override(self) -> None:
        mapping = load_age_voice_map(json.dumps({"10대": ["voice-a"], "50+": ["voice-b"]}))
        self.assertEqual(mapping["10대"]["female"], ["voice-a"])
        self.assertEqual(mapping["10대"]["male"], ["voice-a"])
        self.assertEqual(mapping["50+"]["female"], ["voice-b"])
        self.assertEqual(mapping["50+"]["male"], ["voice-b"])

    def test_choose_age_voice_returns_voice_and_prompt(self) -> None:
        voice = choose_age_voice("50+", {"50+": ["voice-b"]}, seed=1, language="ko")
        self.assertEqual(voice.age_group, "50+")
        self.assertEqual(voice.voice_id, "voice-b")
        self.assertIn("천천히", voice.default_text)

        english_voice = choose_age_voice("50+", {"50+": ["voice-b"]}, seed=1, language="en")
        self.assertIn("large text", english_voice.default_text)

    def test_choose_age_voice_uses_gender_specific_pool_when_available(self) -> None:
        mapping = {
            "30대": {
                "male": ["male-voice"],
                "female": ["female-voice"],
            }
        }
        male_voice = choose_age_voice("30대", mapping, seed=1, language="en", gender="male")
        female_voice = choose_age_voice("30대", mapping, seed=1, language="en", gender="female")
        self.assertEqual(male_voice.voice_id, "male-voice")
        self.assertEqual(male_voice.gender, "male")
        self.assertEqual(female_voice.voice_id, "female-voice")
        self.assertEqual(female_voice.gender, "female")

    def test_build_tts_payload_uses_multilingual_model_and_voice_settings(self) -> None:
        payload = build_tts_payload("안녕하세요", "eleven_multilingual_v2")
        self.assertEqual(payload["text"], "안녕하세요")
        self.assertEqual(payload["model_id"], "eleven_multilingual_v2")
        self.assertIn("voice_settings", payload)


if __name__ == "__main__":
    unittest.main()
