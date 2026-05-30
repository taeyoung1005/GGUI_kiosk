from __future__ import annotations

from dataclasses import dataclass


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


class NoopSTT:
    def transcribe(self, audio_path: str) -> Transcription:
        return Transcription(text="", language="unknown", speech_sec=None)


def create_stt(model_name: str, device: str, compute_type: str):
    if model_name.strip().lower() in {"", "none", "noop", "off", "disabled"}:
        return NoopSTT()
    return FasterWhisperSTT(model_name, device, compute_type)
