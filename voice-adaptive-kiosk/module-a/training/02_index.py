"""02_index.py — 라벨 메타데이터 인덱싱.

RAW 라벨(JSON)을 순회하여 (오디오파일, 화자ID, 연령대, 발화구간) 행으로 평탄화한 뒤
$DATA_ROOT/index.jsonl 로 저장. 03_clips.py 가 이 인덱스로 클립을 만든다.

핵심:
- Speakers[].Agegroup → 이진 라벨 label ∈ {0:under50, 1:50+}.
- Dialogs[].StartTime/EndTime → 클립 경계(초).
- speaker_id 보존 → 04_split.py 의 화자 단위 분리(누수 방지)에 필수.

실행:
    python training/02_index.py

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
RAW_DIR = DATA_ROOT / "raw"
INDEX_PATH = DATA_ROOT / "index.jsonl"

# AIHub 71320 의 연령대 라벨 문자열 → 이진 매핑.
# TODO: 실제 라벨 표기를 데이터로 확인 후 보정(예: "50대","60대","70대 이상" 등).
#       "데이터 최상단이 50+ 라 60+ 분리는 불가" → 타깃을 50+ 로 정의(SPEC/PIPELINE).
FIFTY_PLUS_TOKENS = ("50", "60", "70", "80", "오십", "육십", "칠십", "팔십")


def agegroup_to_binary(agegroup: str) -> Optional[int]:
    """연령대 문자열 → 1(50+) / 0(under50) / None(판단불가)."""
    if not agegroup:
        return None
    s = str(agegroup)
    for tok in FIFTY_PLUS_TOKENS:
        if tok in s:
            return 1
    # 10/20/30/40대 → under50
    for tok in ("10", "20", "30", "40", "십", "이십", "삼십", "사십"):
        if tok in s:
            return 0
    return None


def main() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    labels_dir = RAW_DIR / "labels"

    rows = []
    if labels_dir.exists():
        for label_file in labels_dir.glob("**/*.json"):
            # ──────────────────────────────────────────────────
            # TODO(파싱): 71320 라벨 JSON 실제 스키마에 맞게 키 경로 보정.
            #   가정 구조:
            #     {
            #       "Speakers": [{"SpeakerId": "...", "Agegroup": "60대"} , ...],
            #       "Dialogs":  [{"SpeakerId":"...","StartTime":..,"EndTime":..,
            #                     "WavPath":"...","Text":"..."} , ...]
            #     }
            # ──────────────────────────────────────────────────
            try:
                meta = json.loads(label_file.read_text(encoding="utf-8"))
            except Exception:
                continue

            speakers = {
                sp.get("SpeakerId"): sp.get("Agegroup")
                for sp in meta.get("Speakers", [])
            }
            for d in meta.get("Dialogs", []):
                spk = d.get("SpeakerId")
                label = agegroup_to_binary(speakers.get(spk, ""))
                if label is None:
                    continue
                rows.append(
                    {
                        "wav_path": d.get("WavPath") or d.get("AudioPath"),
                        "speaker_id": spk,
                        "label": label,             # 0/1
                        "start": float(d.get("StartTime", 0.0)),
                        "end": float(d.get("EndTime", 0.0)),
                        "text": d.get("Text", ""),
                    }
                )

    with INDEX_PATH.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    n_pos = sum(1 for r in rows if r["label"] == 1)
    print(
        f"[02_index] rows={len(rows)} (50+={n_pos}, under50={len(rows)-n_pos}) "
        f"→ {INDEX_PATH}"
    )
    if not rows:
        print("[02_index] (주의) 인덱스가 비었습니다. 01_download 결과/라벨 경로 확인.")


if __name__ == "__main__":
    main()
