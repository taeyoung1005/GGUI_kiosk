#!/usr/bin/env bash
# ============================================================
# Module A — Python venv 부트스트랩 (idempotent)
#   .venv 없으면 생성 → requirements.txt 설치. 이미 있으면 재사용 후 동기화.
#   루트의 `npm run setup` 이 install:all 다음에 이 스크립트를 호출한다.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON:-python3}"
command -v "${PYTHON_BIN}" >/dev/null 2>&1 || PYTHON_BIN="python"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "[setup-venv] .venv 생성 (${PYTHON_BIN} -m venv .venv)"
  "${PYTHON_BIN}" -m venv .venv
else
  echo "[setup-venv] .venv 이미 존재 — 재사용"
fi

echo "[setup-venv] pip 업그레이드 + 의존성 설치 (requirements.txt)"
.venv/bin/python -m pip install --upgrade pip >/dev/null
.venv/bin/python -m pip install -r requirements.txt

echo "[setup-venv] 완료 — Module A(Realtime 중계/STT 폴백) 준비됨."
