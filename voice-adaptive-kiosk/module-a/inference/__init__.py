"""Module A 추론 패키지 — STT · 나이 · VAD · 행동신호.

각 모듈은 MOCK_MODE=1 에서 외부 모델 없이 동작하며, 실모드에서는
faster-whisper / transformers / silero-vad 를 지연 import 한다.
"""

from . import age, behavioral, stt, vad  # noqa: F401

__all__ = ["age", "behavioral", "stt", "vad"]
