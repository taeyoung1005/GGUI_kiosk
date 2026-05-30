from __future__ import annotations

import argparse
import os
from pathlib import Path

import evaluate
import numpy as np
from datasets import Audio, Dataset
from transformers import (
    AutoFeatureExtractor,
    AutoModelForAudioClassification,
    Trainer,
    TrainingArguments,
)

from common import iter_jsonl, label_list


def load_manifest(path: Path, labels: list[str]) -> Dataset:
    label2id = {label: idx for idx, label in enumerate(labels)}
    rows = []
    for row in iter_jsonl(path):
        label = row["age_group"]
        if label not in label2id:
            continue
        rows.append({"audio": row["clip_path"], "label": label2id[label]})
    if not rows:
        raise SystemExit(f"No trainable rows found in {path}")
    return Dataset.from_list(rows).cast_column("audio", Audio(sampling_rate=16000))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="./data/manifests/train.jsonl")
    parser.add_argument("--valid", default="./data/manifests/valid.jsonl")
    parser.add_argument("--output-dir", default="./runs/age-wav2vec2")
    parser.add_argument("--base-model", default="facebook/wav2vec2-base")
    parser.add_argument("--class-mode", default=os.getenv("CLASS_MODE", "multiclass"), choices=["multiclass", "binary_50plus"])
    parser.add_argument("--epochs", type=float, default=3)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--freeze-feature-encoder", action="store_true", default=True)
    args = parser.parse_args()

    labels = label_list(args.class_mode)
    label2id = {label: idx for idx, label in enumerate(labels)}
    id2label = {idx: label for label, idx in label2id.items()}

    extractor = AutoFeatureExtractor.from_pretrained(args.base_model)
    train_ds = load_manifest(Path(args.train), labels)
    valid_ds = load_manifest(Path(args.valid), labels)

    def preprocess(batch):
        arrays = [item["array"] for item in batch["audio"]]
        inputs = extractor(arrays, sampling_rate=16000, max_length=16000 * 12, truncation=True)
        inputs["labels"] = batch["label"]
        return inputs

    train_ds = train_ds.map(preprocess, batched=True, remove_columns=["audio", "label"], num_proc=2)
    valid_ds = valid_ds.map(preprocess, batched=True, remove_columns=["audio", "label"], num_proc=2)

    model = AutoModelForAudioClassification.from_pretrained(
        args.base_model,
        num_labels=len(labels),
        label2id=label2id,
        id2label=id2label,
        ignore_mismatched_sizes=True,
    )
    if args.freeze_feature_encoder and hasattr(model, "freeze_feature_encoder"):
        model.freeze_feature_encoder()

    accuracy = evaluate.load("accuracy")
    f1 = evaluate.load("f1")

    def compute_metrics(eval_pred):
        predictions = np.argmax(eval_pred.predictions, axis=1)
        labels_np = eval_pred.label_ids
        return {
            "accuracy": accuracy.compute(predictions=predictions, references=labels_np)["accuracy"],
            "f1_macro": f1.compute(predictions=predictions, references=labels_np, average="macro")["f1"],
        }

    training_args = TrainingArguments(
        output_dir=args.output_dir,
        evaluation_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_macro",
        greater_is_better=True,
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        fp16=True,
        logging_steps=25,
        dataloader_num_workers=2,
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=valid_ds,
        tokenizer=extractor,
        compute_metrics=compute_metrics,
    )
    trainer.train()
    trainer.save_model(args.output_dir)
    extractor.save_pretrained(args.output_dir)


if __name__ == "__main__":
    main()
