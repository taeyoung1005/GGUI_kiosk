"""05_train.py — wav2vec2/HuBERT fine-tuning (이진 "50+ vs under50").

단일 GPU 재현 루프를 먼저 돌린 뒤, torchrun DDP 로 2×4060Ti 확장.
16GB VRAM 대응을 위해 하위 인코더 층 freeze + gradient accumulation 사용.

데이터: 04_split.py 산출 {train,valid}.jsonl (clip_path, speaker_id, label).
베이스: $BASE_MODEL (기본 wav2vec2-large-xlsr-53; 한국어 사전학습 가중치 권장).

단일 GPU:
    python training/05_train.py

DDP (2×4060Ti):
    torchrun --nproc_per_node=2 training/05_train.py

코드 식별자는 영어, 주석은 한국어.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

DATA_ROOT = Path(os.getenv("DATA_ROOT", "./training/data"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./models/age_model"))
BASE_MODEL = os.getenv("BASE_MODEL", "facebook/wav2vec2-large-xlsr-53")

# 하이퍼파라미터(16GB VRAM × 2 기준 초기값) — TODO: 스윕으로 보정
NUM_LABELS = 2
SAMPLE_RATE = 16000
MAX_SECONDS = 8.0                 # 입력 최대 길이(메모리 상한)
PER_DEVICE_BATCH = int(os.getenv("PER_DEVICE_BATCH", "4"))
GRAD_ACCUM = int(os.getenv("GRAD_ACCUM", "8"))   # 유효 배치 = 4*8*GPU수
EPOCHS = int(os.getenv("EPOCHS", "5"))
LR = float(os.getenv("LR", "1e-4"))
FREEZE_FEATURE_ENCODER = True
FREEZE_FIRST_N_LAYERS = int(os.getenv("FREEZE_FIRST_N_LAYERS", "12"))


def load_split(name: str):
    path = DATA_ROOT / f"{name}.jsonl"
    if not path.exists():
        return []
    return [json.loads(l) for l in path.open(encoding="utf-8")]


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 실모드 의존성 — 학습 환경에서만 설치(requirements [training]).
    try:
        import numpy as np
        import torch
        from torch.utils.data import Dataset
        from transformers import (
            AutoFeatureExtractor,
            AutoModelForAudioClassification,
            Trainer,
            TrainingArguments,
        )
    except Exception as e:
        print(f"[05_train] 학습 의존성 미설치: {e}\n  pip install torch transformers datasets accelerate")
        return

    train_rows = load_split("train")
    valid_rows = load_split("valid")
    if not train_rows:
        print("[05_train] train.jsonl 비었음 — 04_split.py 먼저 실행.")
        return

    feature_extractor = AutoFeatureExtractor.from_pretrained(BASE_MODEL)

    class ClipDataset(Dataset):
        def __init__(self, rows):
            self.rows = rows

        def __len__(self):
            return len(self.rows)

        def __getitem__(self, idx):
            import librosa

            r = self.rows[idx]
            y, _ = librosa.load(
                r["clip_path"], sr=SAMPLE_RATE, mono=True, duration=MAX_SECONDS
            )
            feats = feature_extractor(
                y, sampling_rate=SAMPLE_RATE, return_tensors="pt",
                padding="max_length", truncation=True,
                max_length=int(SAMPLE_RATE * MAX_SECONDS),
            )
            return {
                "input_values": feats["input_values"][0],
                "labels": int(r["label"]),
            }

    model = AutoModelForAudioClassification.from_pretrained(
        BASE_MODEL, num_labels=NUM_LABELS
    )

    # ── 하위층 freeze (VRAM/안정성) ──────────────────────────
    if FREEZE_FEATURE_ENCODER and hasattr(model, "freeze_feature_encoder"):
        model.freeze_feature_encoder()
    # TODO(freeze): 인코더 transformer 하위 N층 동결.
    #   for i, layer in enumerate(model.wav2vec2.encoder.layers):
    #       if i < FREEZE_FIRST_N_LAYERS:
    #           for p in layer.parameters(): p.requires_grad = False

    def compute_metrics(eval_pred):
        logits, labels = eval_pred
        preds = np.argmax(logits, axis=-1)
        acc = float((preds == labels).mean())
        # TODO(지표): F1/recall(50+), 혼동행렬 추가. audeering zero-shot 대비 표.
        return {"accuracy": acc}

    args = TrainingArguments(
        output_dir=str(OUTPUT_DIR / "checkpoints"),
        per_device_train_batch_size=PER_DEVICE_BATCH,
        per_device_eval_batch_size=PER_DEVICE_BATCH,
        gradient_accumulation_steps=GRAD_ACCUM,
        num_train_epochs=EPOCHS,
        learning_rate=LR,
        warmup_ratio=0.1,
        fp16=torch.cuda.is_available(),     # 4060Ti 메모리 절약
        eval_strategy="epoch" if valid_rows else "no",
        save_strategy="epoch",
        logging_steps=50,
        report_to=[],
        # DDP: torchrun 실행 시 transformers 가 자동으로 분산 초기화.
        ddp_find_unused_parameters=False,
    )

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=ClipDataset(train_rows),
        eval_dataset=ClipDataset(valid_rows) if valid_rows else None,
        compute_metrics=compute_metrics if valid_rows else None,
    )

    trainer.train()
    # 중간 산출 저장(최종 export 는 06_eval_export.py)
    trainer.save_model(str(OUTPUT_DIR / "checkpoints" / "last"))
    feature_extractor.save_pretrained(str(OUTPUT_DIR / "checkpoints" / "last"))
    print(f"[05_train] done → {OUTPUT_DIR}/checkpoints/last")


if __name__ == "__main__":
    main()
