from __future__ import annotations

import unittest
from unittest import mock

import numpy as np
from fastapi.testclient import TestClient

import app as app_module
from inference.age import AgePrediction
from inference.elevenlabs_voice import ElevenLabsError


class DemoRoutesTest(unittest.TestCase):
    def test_demo_page_is_not_served(self) -> None:
        client = TestClient(app_module.app)

        response = client.get("/demo")

        self.assertEqual(response.status_code, 404)

    def test_demo_batch_summary_artifact_endpoint_is_not_served(self) -> None:
        client = TestClient(app_module.app)

        response = client.get("/demo/batch-summary")

        self.assertEqual(response.status_code, 404)

    def test_age_voice_api_remains_available_without_demo_page(self) -> None:
        client = TestClient(app_module.app)

        response = client.post(
            "/demo/random-age-voice",
            json={"age_group": "senior_adult", "gender": "female", "language": "ko", "seed": 1},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["age_group"], "50+")
        self.assertEqual(payload["language"], "ko")
        self.assertEqual(payload["gender"], "female")
        self.assertEqual(payload["voice_id"], "wGcFBfKz5yUQqhqr0mVy")

    def test_korean_senior_proxy_analyze_generates_audio_and_runs_age_model(self) -> None:
        class FakeElevenLabs:
            def synthesize(self, text: str, voice_id: str) -> bytes:
                self.text = text
                self.voice_id = voice_id
                return b"fake-mp3"

        class FakeAgeModel:
            def predict(self, audio, sampling_rate: int):
                self.audio_len = len(audio)
                self.sampling_rate = sampling_rate
                return AgePrediction(
                    group="senior_adult",
                    years_est=76.3,
                    confidence=0.91,
                    child_prob=0.0,
                )

        fake_tts = FakeElevenLabs()
        fake_age = FakeAgeModel()
        client = TestClient(app_module.app)

        with (
            mock.patch.object(app_module, "get_elevenlabs", return_value=fake_tts),
            mock.patch.object(app_module, "get_age_model", return_value=fake_age),
            mock.patch.object(
                app_module,
                "build_english_order_proxy",
                return_value="I would like an iced large vanilla latte to go, please.",
            ),
            mock.patch.object(app_module.librosa, "load", return_value=(np.zeros(32000, dtype=np.float32), 16000)),
        ):
            response = client.post(
                "/demo/korean-senior-proxy/analyze",
                json={"text": "아이스 바닐라 라떼 큰 사이즈로 포장해주세요", "gender": "female"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["korean_text"], "아이스 바닐라 라떼 큰 사이즈로 포장해주세요")
        self.assertIn("iced large vanilla latte to go", payload["english_proxy_text"])
        self.assertNotIn("large text", payload["english_proxy_text"].lower())
        self.assertNotIn("guide me", payload["english_proxy_text"].lower())
        self.assertEqual(payload["voice_id"], "wGcFBfKz5yUQqhqr0mVy")
        self.assertEqual(payload["age"]["group"], "senior_adult")
        self.assertEqual(payload["behavioral"]["assist_level"], 2)
        self.assertEqual(payload["audio_base64"], "ZmFrZS1tcDM=")
        self.assertNotIn("large text", fake_tts.text.lower())
        self.assertEqual(fake_tts.voice_id, "wGcFBfKz5yUQqhqr0mVy")
        self.assertEqual(fake_age.sampling_rate, 16000)

    def test_korean_senior_proxy_analyze_accepts_validated_voice_id_choice(self) -> None:
        class FakeElevenLabs:
            def synthesize(self, text: str, voice_id: str) -> bytes:
                self.voice_id = voice_id
                return b"fake-mp3"

        fake_tts = FakeElevenLabs()
        client = TestClient(app_module.app)

        with (
            mock.patch.object(app_module, "get_elevenlabs", return_value=fake_tts),
            mock.patch.object(
                app_module,
                "get_age_model",
                return_value=mock.Mock(
                    predict=mock.Mock(
                        return_value=AgePrediction(
                            group="senior_adult",
                            years_est=82,
                            confidence=0.9,
                            child_prob=0.0,
                        )
                    )
                ),
            ),
            mock.patch.object(
                app_module,
                "build_english_order_proxy",
                return_value="I would like a latte, please.",
            ),
            mock.patch.object(app_module.librosa, "load", return_value=(np.zeros(16000, dtype=np.float32), 16000)),
        ):
            response = client.post(
                "/demo/korean-senior-proxy/analyze",
                json={
                    "text": "라떼 한 잔 주세요",
                    "voice_id": "pqHfZKP75CvOlQylNhV4",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["voice_id"], "pqHfZKP75CvOlQylNhV4")
        self.assertEqual(fake_tts.voice_id, "pqHfZKP75CvOlQylNhV4")

    def test_korean_senior_proxy_analyze_rejects_unvalidated_voice_id(self) -> None:
        client = TestClient(app_module.app)

        response = client.post(
            "/demo/korean-senior-proxy/analyze",
            json={"text": "라떼 한 잔 주세요", "voice_id": "not-a-demo-voice"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Unsupported demo voice", response.json()["detail"])

    def test_korean_senior_proxy_analyze_returns_503_when_tts_is_not_configured(self) -> None:
        class MissingElevenLabs:
            def synthesize(self, text: str, voice_id: str) -> bytes:
                raise ElevenLabsError("ELEVENLABS_API_KEY is not set.")

        client = TestClient(app_module.app)

        with (
            mock.patch.object(app_module, "get_elevenlabs", return_value=MissingElevenLabs()),
            mock.patch.object(
                app_module,
                "build_english_order_proxy",
                return_value="I would like a latte, please.",
            ),
        ):
            response = client.post(
                "/demo/korean-senior-proxy/analyze",
                json={"text": "라떼 한 잔 주세요"},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("ELEVENLABS_API_KEY", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
