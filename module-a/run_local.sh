#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export AGE_MODEL_PROVIDER="${AGE_MODEL_PROVIDER:-wavlm_age_sex}"
export STT_MODEL="${STT_MODEL:-small}"
export STT_DEVICE="${STT_DEVICE:-cpu}"
export STT_COMPUTE_TYPE="${STT_COMPUTE_TYPE:-int8}"

exec uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
