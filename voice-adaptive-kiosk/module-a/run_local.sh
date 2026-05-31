#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Realtime 세션 중계(/realtime/session)는 OPENAI_API_KEY 가 필요하다(BYOK).
# 루트 .env / module-c .env / module-a .env 중 어디에 둬도 app.py 가 읽는다.
# 아래 STT_* 는 /analyze STT 폴백 경로용 기본값.
export STT_MODEL="${STT_MODEL:-whisper-1}"
export STT_LANGUAGE="${STT_LANGUAGE:-ko}"
export STT_DEVICE="${STT_DEVICE:-cpu}"
export STT_COMPUTE_TYPE="${STT_COMPUTE_TYPE:-int8}"

exec "${PYTHON:-python}" -m uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-8000}"
