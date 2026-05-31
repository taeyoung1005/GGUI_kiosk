from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Transcription:
    text: str
    language: str
    speech_sec: float | None = None


class OpenAIWhisperSTT:
    def __init__(self, model_name: str = "whisper-1", language: str | None = "ko", client: Any | None = None) -> None:
        self.model_name = model_name
        self.language = language or None
        self.client = client

    def _client(self):
        if self.client is None:
            from openai import OpenAI

            self.client = OpenAI()
        return self.client

    def transcribe(self, audio_path: str) -> Transcription:
        with open(audio_path, "rb") as audio_file:
            request: dict[str, Any] = {
                "model": self.model_name,
                "file": audio_file,
                "response_format": "verbose_json",
            }
            if self.language:
                request["language"] = self.language
            response = self._client().audio.transcriptions.create(**request)

        text = _read_attr(response, "text", "") or ""
        language = _read_attr(response, "language", self.language or "unknown") or self.language or "unknown"
        segments = _read_attr(response, "segments", []) or []
        speech_sec = 0.0
        for segment in segments:
            start = float(_read_attr(segment, "start", 0.0) or 0.0)
            end = float(_read_attr(segment, "end", 0.0) or 0.0)
            speech_sec += max(0.0, end - start)
        duration = _read_attr(response, "duration", None)
        if not speech_sec and duration is not None:
            speech_sec = max(0.0, float(duration))

        return Transcription(
            text=str(text).strip(),
            language=str(language),
            speech_sec=speech_sec or None,
        )


class NoopSTT:
    def transcribe(self, audio_path: str) -> Transcription:
        return Transcription(text="", language="unknown", speech_sec=None)


def _read_attr(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def create_stt(model_name: str, device: str, compute_type: str, language: str | None = "ko"):
    normalized = model_name.strip()
    lowered = normalized.lower()
    if lowered in {"", "none", "noop", "off", "disabled"}:
        return NoopSTT()
    if lowered.startswith("openai:"):
        return OpenAIWhisperSTT(normalized.split(":", 1)[1] or "whisper-1", language=language)
    return OpenAIWhisperSTT(normalized, language=language)
