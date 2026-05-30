"""03_clips.py — 구간 클립 생성(16kHz mono wav).

index.jsonl 의 (wav_path, start, end) → 잘라낸 클립을 $DATA_ROOT/clips/ 에 저장하고
clips.jsonl(클립경로, speaker_id, label) 을 갱신.

핵심:
- 16kHz mono 로 통일(나이/STT 모델 입력 규격).
- 너무 짧은(<0.5s) / 너무 긴(>15s) 구간은 스킵 또는 분할.
- 화자/라벨 메타 보존(04_split.py 가 사용).

실행:
    python training/03_clips.py

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
INDEX_PATH = DATA_ROOT / "index.jsonl"
CLIPS_DIR = DATA_ROOT / "clips"
CLIPS_INDEX = DATA_ROOT / "clips.jsonl"

TARGET_SR = 16000
MIN_DUR = 0.5      # 초. 이보다 짧으면 스킵
MAX_DUR = 15.0     # 초. 이보다 길면 분할 또는 절단


def main() -> None:
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_PATH.exists():
        print("[03_clips] index.jsonl 없음 — 02_index.py 먼저 실행.")
        return

    # 실모드에서만 무거운 의존성 import
    try:
        import librosa
        import soundfile as sf
    except Exception:
        print("[03_clips] librosa/soundfile 미설치 — requirements [inference] 설치 필요.")
        return

    written = 0
    with INDEX_PATH.open(encoding="utf-8") as fin, CLIPS_INDEX.open(
        "w", encoding="utf-8"
    ) as fout:
        for line in fin:
            r = json.loads(line)
            wav_path = r.get("wav_path")
            start = float(r.get("start", 0.0))
            end = float(r.get("end", 0.0))
            dur = end - start
            if not wav_path or dur < MIN_DUR:
                continue

            # ──────────────────────────────────────────────────
            # TODO(절단): 긴 구간(dur>MAX_DUR)은 MAX_DUR 윈도우로 슬라이딩 분할.
            #       지금은 단순 절단(앞 MAX_DUR 초만).
            # TODO(품질): 무음/잡음 구간 제외(silero-vad 재적용 가능).
            # ──────────────────────────────────────────────────
            seg_end = min(end, start + MAX_DUR)

            try:
                # offset/duration 으로 부분만 로드(메모리 절약)
                y, _ = librosa.load(
                    wav_path, sr=TARGET_SR, mono=True,
                    offset=start, duration=(seg_end - start),
                )
            except Exception:
                continue

            spk = r.get("speaker_id", "unknown")
            label = int(r.get("label", 0))
            clip_name = f"{spk}_{written:06d}_{label}.wav"
            clip_path = CLIPS_DIR / clip_name
            sf.write(str(clip_path), y, TARGET_SR)

            fout.write(
                json.dumps(
                    {
                        "clip_path": str(clip_path),
                        "speaker_id": spk,
                        "label": label,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            written += 1

    print(f"[03_clips] clips written={written} → {CLIPS_DIR}  index={CLIPS_INDEX}")


if __name__ == "__main__":
    main()
