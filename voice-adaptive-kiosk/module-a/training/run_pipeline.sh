#!/usr/bin/env bash
set -euo pipefail

CLASS_MODE="${CLASS_MODE:-multiclass}"
DATA_ROOT="${DATA_ROOT:-./data/aihub/raw}"
BASE_MODEL="${BASE_MODEL:-facebook/wav2vec2-base}"
OUTPUT_DIR="${OUTPUT_DIR:-./runs/age-wav2vec2}"
EXPORT_DIR="${EXPORT_DIR:-./models/age_model}"

mkdir -p ./data/manifests ./data/clips "$OUTPUT_DIR" "$EXPORT_DIR"

python training/02_index.py \
  --data-root "$DATA_ROOT" \
  --out ./data/manifests/raw_segments.jsonl \
  --class-mode "$CLASS_MODE"

python training/03_clips.py \
  --manifest ./data/manifests/raw_segments.jsonl \
  --out-dir ./data/clips \
  --out-manifest ./data/manifests/clips.jsonl

python training/04_split.py \
  --manifest ./data/manifests/clips.jsonl \
  --out-dir ./data/manifests

python training/validate_manifest.py \
  --manifest-dir ./data/manifests \
  --require-clip

if [[ "${USE_DDP:-0}" == "1" ]]; then
  torchrun --nproc_per_node="${NPROC_PER_NODE:-2}" training/05_train.py \
    --train ./data/manifests/train.jsonl \
    --valid ./data/manifests/valid.jsonl \
    --output-dir "$OUTPUT_DIR" \
    --base-model "$BASE_MODEL" \
    --class-mode "$CLASS_MODE"
else
  python training/05_train.py \
    --train ./data/manifests/train.jsonl \
    --valid ./data/manifests/valid.jsonl \
    --output-dir "$OUTPUT_DIR" \
    --base-model "$BASE_MODEL" \
    --class-mode "$CLASS_MODE"
fi

python training/06_eval_export.py \
  --test ./data/manifests/test.jsonl \
  --checkpoint "$OUTPUT_DIR" \
  --export-dir "$EXPORT_DIR"
