from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class Transcription:
    text: str
    language: str
    speech_sec: float | None = None


class FasterWhisperSTT:
    def __init__(self, model_name: str = "small", device: str = "cpu", compute_type: str = "int8") -> None:
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)

    def transcribe(self, audio_path: str) -> Transcription:
        segments, info = self.model.transcribe(audio_path, language=None, word_timestamps=True)
        text_parts: list[str] = []
        speech_sec = 0.0
        for segment in segments:
            text_parts.append(segment.text.strip())
            speech_sec += max(0.0, float(segment.end) - float(segment.start))
        return Transcription(
            text=" ".join(part for part in text_parts if part).strip(),
            language=getattr(info, "language", "ko") or "ko",
            speech_sec=speech_sec or None,
        )


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
    if lowered in {"whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe"}:
        return OpenAIWhisperSTT(normalized, language=language)
    if lowered.startswith("local:"):
        normalized = normalized.split(":", 1)[1] or "small"
    return FasterWhisperSTT(normalized, device, compute_type)
