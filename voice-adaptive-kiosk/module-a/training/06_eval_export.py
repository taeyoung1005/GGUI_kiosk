"""06_eval_export.py — 평가 + save_pretrained(models/age_model).

test.jsonl 로 최종 모델을 평가하고, audeering zero-shot 과 비교한 뒤
더 나은(또는 학습된) 모델을 models/age_model/ 로 export.
이 폴더(config + safetensors + feature_extractor)를 scp 로 로컬 Module A 에 이식한다.

실행:
    python training/06_eval_export.py

이식(로컬로):
    scp -r oba-4060ti:~/module-a/models/age_model ./module-a/models/age_model
    # 로컬: AGE_MODEL_PATH=./models/age_model 로 동일 코드 추론

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./models/age_model"))
CKPT_DIR = OUTPUT_DIR / "checkpoints" / "last"
SAMPLE_RATE = 16000
MAX_SECONDS = 8.0


def load_split(name: str):
    path = DATA_ROOT / f"{name}.jsonl"
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open(encoding="utf-8")]


def main() -> None:
    test_rows = load_split("test")

    try:
        import numpy as np
        import torch
        from transformers import (
            AutoFeatureExtractor,
            AutoModelForAudioClassification,
        )
    except Exception as e:
        print(f"[06_eval_export] 의존성 미설치: {e}")
        return

    if not CKPT_DIR.exists():
        print(f"[06_eval_export] 체크포인트 없음: {CKPT_DIR} — 05_train.py 먼저 실행.")
        return

    feature_extractor = AutoFeatureExtractor.from_pretrained(str(CKPT_DIR))
    model = AutoModelForAudioClassification.from_pretrained(str(CKPT_DIR))
    model.eval()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)

    # ── 평가 ──────────────────────────────────────────────────
    correct = total = 0
    tp = fp = fn = 0  # 50+(=1) 기준
    if test_rows:
        import librosa

        for r in test_rows:
            y, _ = librosa.load(
                r["clip_path"], sr=SAMPLE_RATE, mono=True, duration=MAX_SECONDS
            )
            feats = feature_extractor(y, sampling_rate=SAMPLE_RATE, return_tensors="pt")
            with torch.no_grad():
                logits = model(feats["input_values"].to(device)).logits
            pred = int(logits.argmax(-1).item())
            label = int(r["label"])
            total += 1
            correct += int(pred == label)
            if pred == 1 and label == 1:
                tp += 1
            elif pred == 1 and label == 0:
                fp += 1
            elif pred == 0 and label == 1:
                fn += 1

        acc = correct / total if total else 0.0
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        print(
            f"[06_eval_export] test: n={total} acc={acc:.3f} "
            f"prec(50+)={prec:.3f} rec(50+)={rec:.3f} f1={f1:.3f}"
        )
        # TODO(비교): audeering/wav2vec2-...-age-gender zero-shot 으로 같은 test 평가 후
        #       표로 비교 → 더 나은 모델을 export. 학습본이 더 나쁘면 폴백 유지.
    else:
        print("[06_eval_export] test.jsonl 없음 — 평가 생략, export 만 수행.")

    # ── export ────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(OUTPUT_DIR))
    feature_extractor.save_pretrained(str(OUTPUT_DIR))
    print(f"[06_eval_export] exported → {OUTPUT_DIR} (config + safetensors)")
    print(
        "  이식: scp -r <remote>:~/module-a/models/age_model "
        "./module-a/models/age_model"
    )


if __name__ == "__main__":
    main()
