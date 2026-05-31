from __future__ import annotations

import json
import unittest
from unittest import mock

from inference.elevenlabs_voice import (
    AGE_GROUPS,
    DEFAULT_ANNOUNCER_VOICE_ID,
    build_announcer_tts_payload,
    build_english_order_proxy,
    build_tts_payload,
    choose_age_voice,
    load_age_voice_map,
    normalize_age_group,
    normalize_gender,
    normalize_language,
)


class ElevenLabsVoiceTest(unittest.TestCase):
    def _proxy_with_fake_translation(self, korean_text: str, english_text: str) -> str:
        class FakeResponses:
            def create(self, **request):
                self.request = request
                return mock.Mock(output_text=english_text)

        class FakeOpenAIClient:
            def __init__(self) -> None:
                self.responses = FakeResponses()

        with (
            mock.patch.dict(
                "os.environ",
                {"OPENAI_API_KEY": "test-key", "ORDER_TRANSLATION_MODEL": "gpt-4.1-mini"},
            ),
            mock.patch("inference.elevenlabs_voice.OpenAI", return_value=FakeOpenAIClient()),
        ):
            return build_english_order_proxy(korean_text)

    def test_normalize_age_group_accepts_aliases(self) -> None:
        self.assertEqual(normalize_age_group("teen"), "10대")
        self.assertEqual(normalize_age_group("0대"), "10대")
        self.assertEqual(normalize_age_group("20s"), "20대")
        self.assertEqual(normalize_age_group("young_adult"), "20대")
        self.assertEqual(normalize_age_group("adult"), "40대")
        self.assertEqual(normalize_age_group("50"), "50+")
        self.assertEqual(normalize_age_group("senior_adult"), "50+")
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
        self.assertNotIn("large text", english_voice.default_text.lower())
        self.assertNotIn("guide me", english_voice.default_text.lower())

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

    def test_default_senior_test_voices_use_validated_gender_specific_voice_ids(self) -> None:
        female_voice = choose_age_voice("50+", seed=1, language="en", gender="female")
        male_voice = choose_age_voice("50+", seed=1, language="en", gender="male")

        self.assertEqual(female_voice.voice_id, "wGcFBfKz5yUQqhqr0mVy")
        self.assertEqual(male_voice.voice_id, "pqHfZKP75CvOlQylNhV4")

    def test_default_broad_age_test_voices_use_validated_gender_specific_voice_ids(self) -> None:
        young_female = choose_age_voice("young_adult", seed=1, language="en", gender="female")
        young_male = choose_age_voice("young_adult", seed=1, language="en", gender="male")
        adult_female = choose_age_voice("adult", seed=1, language="en", gender="female")
        adult_male = choose_age_voice("adult", seed=1, language="en", gender="male")

        self.assertEqual(young_female.voice_id, "cl7Lq9M5lHPrBM5kbtI6")
        self.assertEqual(young_male.voice_id, "hbD9jyvjaK5U03Bx24wj")
        self.assertEqual(adult_female.voice_id, "InBZ3nD3eaYhPkNfAsGL")
        self.assertEqual(adult_male.voice_id, "cjVigY5qzO86Huf0OWal")

    def test_build_tts_payload_uses_multilingual_model_and_voice_settings(self) -> None:
        payload = build_tts_payload("안녕하세요", "eleven_multilingual_v2")
        self.assertEqual(payload["text"], "안녕하세요")
        self.assertEqual(payload["model_id"], "eleven_multilingual_v2")
        self.assertIn("voice_settings", payload)

    def test_build_announcer_tts_payload_uses_natural_newsreader_settings(self) -> None:
        payload = build_announcer_tts_payload("Please choose one.", "eleven_multilingual_v2")
        settings = payload["voice_settings"]

        self.assertEqual(payload["text"], "Please choose one.")
        self.assertEqual(payload["model_id"], "eleven_multilingual_v2")
        self.assertGreaterEqual(settings["stability"], 0.65)
        self.assertLessEqual(settings["style"], 0.2)
        self.assertTrue(settings["use_speaker_boost"])
        self.assertEqual(DEFAULT_ANNOUNCER_VOICE_ID, "21m00Tcm4TlvDq8ikWAM")

    def test_build_english_order_proxy_translates_korean_kiosk_order_for_senior_demo(self) -> None:
        proxy = self._proxy_with_fake_translation(
            "아이스 바닐라 라떼 큰 사이즈로 포장해주세요",
            "I would like an iced large vanilla latte to go, please.",
        )

        self.assertIn("iced large vanilla latte to go", proxy)
        self.assertNotIn("large text", proxy.lower())
        self.assertNotIn("guide me", proxy.lower())
        self.assertNotIn("slowly", proxy.lower())

    def test_build_english_order_proxy_uses_natural_article_for_latte(self) -> None:
        proxy = self._proxy_with_fake_translation(
            "라떼 한 잔 주세요",
            "I would like a latte, please.",
        )

        self.assertEqual(proxy, "I would like a latte, please.")

    def test_build_english_order_proxy_handles_free_form_korean_items(self) -> None:
        class FakeResponses:
            def create(self, **request):
                self.request = request
                return mock.Mock(output_text="I would like a yuzu tea and a salt bread, please.")

        class FakeOpenAIClient:
            def __init__(self) -> None:
                self.responses = FakeResponses()

        fake_client = FakeOpenAIClient()

        with (
            mock.patch.dict(
                "os.environ",
                {"OPENAI_API_KEY": "test-key", "ORDER_TRANSLATION_MODEL": "gpt-4.1-mini"},
            ),
            mock.patch("inference.elevenlabs_voice.OpenAI", return_value=fake_client, create=True),
        ):
            proxy = build_english_order_proxy("유자차 하나랑 소금빵도 같이 부탁드려요")

        self.assertIn("yuzu tea", proxy.lower())
        self.assertIn("salt bread", proxy.lower())
        self.assertNotIn("latte", proxy.lower())
        self.assertEqual(fake_client.responses.request["model"], "gpt-4.1-mini")
        self.assertIn("유자차 하나랑 소금빵도 같이 부탁드려요", fake_client.responses.request["input"])


if __name__ == "__main__":
    unittest.main()
