from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import classification_report, confusion_matrix
from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

from common import iter_jsonl


@torch.inference_mode()
def predict(model, extractor, audio_path: str, device: str) -> tuple[int, float]:
    import librosa

    audio, _ = librosa.load(audio_path, sr=16000, mono=True)
    inputs = extractor(audio, sampling_rate=16000, return_tensors="pt", max_length=16000 * 12, truncation=True)
    inputs = {key: value.to(device) for key, value in inputs.items()}
    probs = torch.softmax(model(**inputs).logits[0], dim=-1).detach().cpu().numpy()
    idx = int(probs.argmax())
    return idx, float(probs[idx])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default="./data/manifests/test.jsonl")
    parser.add_argument("--checkpoint", default="./runs/age-wav2vec2")
    parser.add_argument("--export-dir", default="./models/age_model")
    args = parser.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    extractor = AutoFeatureExtractor.from_pretrained(args.checkpoint)
    model = AutoModelForAudioClassification.from_pretrained(args.checkpoint).to(device)
    model.eval()
    id2label = {int(k): v for k, v in model.config.id2label.items()}
    label2id = {v: k for k, v in id2label.items()}

    y_true = []
    y_pred = []
    rows = []
    for row in iter_jsonl(Path(args.test)):
        if row["age_group"] not in label2id:
            continue
        pred, conf = predict(model, extractor, row["clip_path"], device)
        y_true.append(label2id[row["age_group"]])
        y_pred.append(pred)
        rows.append({**row, "predicted": id2label[pred], "confidence": conf})

    labels = [id2label[idx] for idx in sorted(id2label)]
    report = classification_report(y_true, y_pred, target_names=labels, output_dict=True, zero_division=0)
    matrix = confusion_matrix(y_true, y_pred, labels=list(sorted(id2label))).tolist()
    metrics = {"classification_report": report, "confusion_matrix": matrix, "labels": labels}

    export_dir = Path(args.export_dir)
    if export_dir.exists():
        shutil.rmtree(export_dir)
    shutil.copytree(args.checkpoint, export_dir)
    (export_dir / "eval_metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    (export_dir / "predictions.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"exported model to {export_dir}")


if __name__ == "__main__":
    main()
