#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Realtime 세션 중계(/realtime/session)는 OPENAI_API_KEY 가 필요하다(BYOK).
# 환경변수는 voice-adaptive-kiosk/.env 하나에서 읽는다.

exec "${PYTHON:-python}" -m uvicorn app:app --host "${HOST:-127.0.0.1}" --port "${PORT:-${ANALYZE_PORT:-8000}}"
