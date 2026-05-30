from __future__ import annotations

import argparse
import csv
import io
import json
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import soundfile as sf

from inference.age import create_age_model


DATASET_ID = "SALT-NLP/speech_fairness"
AGE_BINS = ["18-22", "23-30", "31-45", "46-65"]
GENDERS = ["female", "male"]


@dataclass(frozen=True)
class FairSpeechTarget:
    age_bin: str
    gender: str


def normalize_age_label(value: str | None) -> str:
    if not value:
        return "unknown"
    numbers = re.findall(r"\d+", str(value))
    if len(numbers) >= 2:
        return f"{int(numbers[0])}-{int(numbers[1])}"
    return str(value).strip().lower().replace(" ", "-")


def years_to_age_bin(years: float | int | str | None) -> str:
    if years is None:
        return "unknown"
    try:
        value = float(years)
    except (TypeError, ValueError):
        return "unknown"
    if 18 <= value < 23:
        return "18-22"
    if 23 <= value < 31:
        return "23-30"
    if 31 <= value < 46:
        return "31-45"
    if 46 <= value < 66:
        return "46-65"
    return "outside"


def build_balanced_targets(age_bins: Iterable[str], genders: Iterable[str], per_cell: int) -> list[tuple[str, str]]:
    return [
        (age_bin, gender)
        for age_bin in age_bins
        for gender in genders
        for _ in range(per_cell)
    ]


def _decode_audio_bytes(audio_value: dict[str, Any]) -> tuple[np.ndarray, int]:
    audio_bytes = audio_value.get("bytes")
    if not audio_bytes:
        raise ValueError("Fair-Speech row does not contain audio bytes.")
    waveform, sampling_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if waveform.ndim == 2:
        waveform = waveform.mean(axis=1)
    return np.asarray(waveform, dtype=np.float32), int(sampling_rate)


def _resample_to_16k(waveform: np.ndarray, sampling_rate: int) -> np.ndarray:
    if sampling_rate == 16000:
        return waveform
    import librosa

    return librosa.resample(waveform, orig_sr=sampling_rate, target_sr=16000).astype(np.float32)


def _load_fairspeech_stream(dataset_id: str, split: str):
    from datasets import Audio, load_dataset

    dataset = load_dataset(dataset_id, split=split, streaming=True)
    return dataset.cast_column("audio", Audio(decode=False))


def _is_target_full(counts: dict[tuple[str, str], int], per_cell: int) -> bool:
    return all(counts[(age_bin, gender)] >= per_cell for age_bin in AGE_BINS for gender in GENDERS)


def collect_balanced_rows(
    dataset_id: str,
    split: str,
    per_cell: int,
    max_scan: int,
    first_language: str | None = None,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    counts: dict[tuple[str, str], int] = defaultdict(int)
    target_language = first_language.lower() if first_language else None

    for scanned, item in enumerate(_load_fairspeech_stream(dataset_id, split), start=1):
        if scanned > max_scan:
            break
        age_bin = normalize_age_label(item.get("age"))
        gender = str(item.get("gender", "")).strip().lower()
        if age_bin not in AGE_BINS or gender not in GENDERS:
            continue
        if target_language and str(item.get("first_language", "")).strip().lower() != target_language:
            continue
        key = (age_bin, gender)
        if counts[key] >= per_cell:
            continue
        counts[key] += 1
        rows.append(item)
        if _is_target_full(counts, per_cell):
            break

    return rows


def summarize_rows(rows: list[dict[str, Any]], dataset_id: str, split: str, per_cell: int) -> dict[str, Any]:
    ok_rows = [row for row in rows if row.get("status") == "ok"]
    match_count = sum(1 for row in ok_rows if row.get("match") is True)
    return {
        "dataset": dataset_id,
        "split": split,
        "evaluation_label": "real_recording_demographic_label",
        "note": "Fair-Speech age and gender labels come from dataset demographics; they are better validation labels than synthetic TTS voice metadata.",
        "per_cell": per_cell,
        "total": len(rows),
        "ok": len(ok_rows),
        "match": match_count,
        "match_rate": round(match_count / len(ok_rows), 4) if ok_rows else 0.0,
        "target_distribution": dict(Counter(row.get("target_age_bin", "") for row in rows)),
        "gender_distribution": dict(Counter(row.get("gender", "") for row in rows)),
        "predicted_distribution": dict(Counter(row.get("predicted_age_bin", "") for row in ok_rows)),
        "by_expected_age_bin": {
            age_bin: {
                "ok": sum(1 for row in ok_rows if row.get("target_age_bin") == age_bin),
                "match": sum(1 for row in ok_rows if row.get("target_age_bin") == age_bin and row.get("match") is True),
            }
            for age_bin in AGE_BINS
        },
        "by_gender": {
            gender: {
                "ok": sum(1 for row in ok_rows if row.get("gender") == gender),
                "match": sum(1 for row in ok_rows if row.get("gender") == gender and row.get("match") is True),
            }
            for gender in GENDERS
        },
    }


def run_eval(
    out_dir: Path,
    per_cell: int,
    max_scan: int,
    dataset_id: str = DATASET_ID,
    split: str = "train",
    first_language: str | None = None,
    provider: str = "wavlm_age_sex",
    model_path: str | Path = "./models/age_model",
    device: str | None = None,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    model = create_age_model(provider, model_path, device)
    source_rows = collect_balanced_rows(dataset_id, split, per_cell, max_scan, first_language)
    rows: list[dict[str, Any]] = []

    for idx, item in enumerate(source_rows, start=1):
        age_bin = normalize_age_label(item.get("age"))
        gender = str(item.get("gender", "")).strip().lower()
        row = {
            "sample_idx": idx,
            "dataset": dataset_id,
            "split": split,
            "target_age_bin": age_bin,
            "gender": gender,
            "first_language": item.get("first_language", ""),
            "transcription": item.get("transcription", ""),
            "status": "pending",
        }
        started = time.perf_counter()
        try:
            waveform, sampling_rate = _decode_audio_bytes(item["audio"])
            waveform_16k = _resample_to_16k(waveform, sampling_rate)
            prediction = model.predict(waveform_16k, 16000)
            predicted_age_bin = years_to_age_bin(prediction.years_est)
            row.update(
                {
                    "status": "ok",
                    "duration_sec": round(len(waveform_16k) / 16000, 3),
                    "predicted_group": prediction.group,
                    "years_est": prediction.years_est,
                    "confidence": prediction.confidence,
                    "predicted_age_bin": predicted_age_bin,
                    "match": predicted_age_bin == age_bin,
                    "duration_ms": int((time.perf_counter() - started) * 1000),
                }
            )
        except Exception as exc:
            row.update({"status": "error", "error": repr(exc)})
        rows.append(row)
        print(f"[{idx}/{len(source_rows)}] {row['status']} {age_bin} {gender} -> {row.get('predicted_age_bin', '-')}")

    csv_path = out_dir / "fairspeech_eval.csv"
    fieldnames = sorted({key for row in rows for key in row.keys()})
    with csv_path.open("w", encoding="utf-8", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    summary = summarize_rows(rows, dataset_id, split, per_cell)
    (out_dir / "fairspeech_eval_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return csv_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="./artifacts/fairspeech-eval-v1")
    parser.add_argument("--per-cell", type=int, default=10)
    parser.add_argument("--max-scan", type=int, default=4000)
    parser.add_argument("--dataset-id", default=DATASET_ID)
    parser.add_argument("--split", default="train")
    parser.add_argument("--first-language", default=None)
    parser.add_argument("--provider", default="wavlm_age_sex")
    parser.add_argument("--model-path", default="./models/age_model")
    parser.add_argument("--device", default=None)
    args = parser.parse_args()
    run_eval(
        out_dir=Path(args.out_dir),
        per_cell=args.per_cell,
        max_scan=args.max_scan,
        dataset_id=args.dataset_id,
        split=args.split,
        first_language=args.first_language,
        provider=args.provider,
        model_path=args.model_path,
        device=args.device,
    )


if __name__ == "__main__":
    main()
    import os
    import sys

    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
