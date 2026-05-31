from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from inference.stt import NoopSTT, OpenAIWhisperSTT, create_stt


class _FakeTranscriptions:
    def __init__(self) -> None:
        self.kwargs = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        return {
            "text": "아이스 바닐라 라떼 주세요",
            "language": "ko",
            "segments": [
                {"start": 0.1, "end": 1.0},
                {"start": 1.4, "end": 2.2},
            ],
        }


class _FakeOpenAIClient:
    def __init__(self) -> None:
        self.audio = type("Audio", (), {"transcriptions": _FakeTranscriptions()})()


class SttConfigTest(unittest.TestCase):
    def test_whisper_api_model_uses_openai_stt(self) -> None:
        with mock.patch("inference.stt.OpenAIWhisperSTT") as openai_stt:
            self.assertIs(create_stt("whisper-1", "cpu", "int8"), openai_stt.return_value)
            openai_stt.assert_called_once_with("whisper-1", language="ko")

    def test_openai_prefix_uses_openai_stt(self) -> None:
        with mock.patch("inference.stt.OpenAIWhisperSTT") as openai_stt:
            self.assertIs(create_stt("openai:whisper-1", "cpu", "int8"), openai_stt.return_value)
            openai_stt.assert_called_once_with("whisper-1", language="ko")

    def test_local_prefix_uses_faster_whisper_stt(self) -> None:
        with mock.patch("inference.stt.FasterWhisperSTT") as local_stt:
            self.assertIs(create_stt("local:small", "cpu", "int8"), local_stt.return_value)
            local_stt.assert_called_once_with("small", "cpu", "int8")

    def test_none_model_uses_noop_stt(self) -> None:
        self.assertIsInstance(create_stt("none", "cpu", "int8"), NoopSTT)
        self.assertIsInstance(create_stt("noop", "cpu", "int8"), NoopSTT)

    def test_noop_stt_reports_unknown_language(self) -> None:
        self.assertEqual(NoopSTT().transcribe("sample.mp3").language, "unknown")

    def test_openai_whisper_stt_transcribes_verbose_json_with_korean_hint(self) -> None:
        client = _FakeOpenAIClient()
        stt = OpenAIWhisperSTT("whisper-1", language="ko", client=client)
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as fp:
            fp.write(b"fake audio")
            path = Path(fp.name)

        try:
            result = stt.transcribe(str(path))
        finally:
            path.unlink(missing_ok=True)

        kwargs = client.audio.transcriptions.kwargs
        self.assertEqual(kwargs["model"], "whisper-1")
        self.assertEqual(kwargs["language"], "ko")
        self.assertEqual(kwargs["response_format"], "verbose_json")
        self.assertEqual(result.text, "아이스 바닐라 라떼 주세요")
        self.assertEqual(result.language, "ko")
        self.assertAlmostEqual(result.speech_sec or 0, 1.7)


if __name__ == "__main__":
    unittest.main()
