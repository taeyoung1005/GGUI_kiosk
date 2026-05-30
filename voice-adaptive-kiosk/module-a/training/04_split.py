"""04_split.py — ★화자 단위 train/valid/test 분리(데이터 누수 방지).

같은 화자가 train/test 에 섞이면 정확도가 거품처럼 부풀려진다(화자 식별로 푸는 셈).
따라서 화자 ID 단위로 disjoint 하게 분할한다. 라벨 비율(50+ vs under50)도
가능한 한 split 간 균형을 맞춘다.

산출: $DATA_ROOT/{train,valid,test}.jsonl

실행:
    python training/04_split.py

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import json
import os
import random
from collections import defaultdict
from pathlib import Path

DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
CLIPS_INDEX = DATA_ROOT / "clips.jsonl"

TRAIN_RATIO = 0.8
VALID_RATIO = 0.1
# TEST = 1 - TRAIN - VALID
SEED = int(os.getenv("SPLIT_SEED", "42"))


def main() -> None:
    if not CLIPS_INDEX.exists():
        print("[04_split] clips.jsonl 없음 — 03_clips.py 먼저 실행.")
        return

    rows = [json.loads(l) for l in CLIPS_INDEX.open(encoding="utf-8")]
    if not rows:
        print("[04_split] 클립이 비었습니다.")
        return

    # 화자 → 대표 라벨(다수결) 로 화자 단위 라벨 구성
    spk_clips: dict[str, list] = defaultdict(list)
    spk_label_votes: dict[str, list] = defaultdict(list)
    for r in rows:
        spk = r["speaker_id"]
        spk_clips[spk].append(r)
        spk_label_votes[spk].append(int(r["label"]))

    speakers = list(spk_clips.keys())

    # ──────────────────────────────────────────────────────────
    # TODO(층화): 라벨별로 화자를 나눠 각 split 의 50+ 비율을 맞추는 stratified
    #       speaker split 로 개선. 지금은 라벨 묶음 내 셔플 후 비율 분할.
    # ──────────────────────────────────────────────────────────
    rng = random.Random(SEED)

    def majority(spk: str) -> int:
        votes = spk_label_votes[spk]
        return 1 if sum(votes) * 2 >= len(votes) else 0

    pos_spk = [s for s in speakers if majority(s) == 1]
    neg_spk = [s for s in speakers if majority(s) == 0]
    rng.shuffle(pos_spk)
    rng.shuffle(neg_spk)

    def split_list(items: list) -> tuple[list, list, list]:
        n = len(items)
        n_tr = int(n * TRAIN_RATIO)
        n_va = int(n * VALID_RATIO)
        return items[:n_tr], items[n_tr : n_tr + n_va], items[n_tr + n_va :]

    tr_p, va_p, te_p = split_list(pos_spk)
    tr_n, va_n, te_n = split_list(neg_spk)

    split_speakers = {
        "train": set(tr_p) | set(tr_n),
        "valid": set(va_p) | set(va_n),
        "test": set(te_p) | set(te_n),
    }

    counts = {}
    for split_name, spk_set in split_speakers.items():
        out = DATA_ROOT / f"{split_name}.jsonl"
        n = 0
        with out.open("w", encoding="utf-8") as f:
            for spk in spk_set:
                for clip in spk_clips[spk]:
                    f.write(json.dumps(clip, ensure_ascii=False) + "\n")
                    n += 1
        counts[split_name] = (len(spk_set), n)

    # 누수 검증: split 간 화자 교집합이 없어야 함
    assert not (split_speakers["train"] & split_speakers["test"]), "화자 누수!"
    assert not (split_speakers["train"] & split_speakers["valid"]), "화자 누수!"

    for k, (s, c) in counts.items():
        print(f"[04_split] {k}: speakers={s} clips={c}")


if __name__ == "__main__":
    main()
