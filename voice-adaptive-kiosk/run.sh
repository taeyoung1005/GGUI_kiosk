#!/usr/bin/env bash
# ============================================================
# 음성 적응형 키오스크 — 전체 기동 스크립트 (A/B/C/D)
# ------------------------------------------------------------
#   A: uvicorn (Python · FastAPI · :8000)   ← MOCK_MODE=1 기본
#   B: node    (Express     · :8001)
#   C: node    (Express     · :8002)        ← GGUI_MODE=local 기본(실데모 메인)
#   D: vite    (React 프론트 · :5173)        ← VITE_USE_MOCK 은 D 의 .env 로 제어
#
# 4개 모듈을 백그라운드로 띄우고 헬스체크 후 안내를 출력한다.
# 종료: Ctrl-C (모든 자식 프로세스 정리) 또는  bash run.sh stop
#
# 사용:
#   bash run.sh            # 전체 기동 (A 포함, C는 빠른 LOCAL 렌더)
#   bash run.sh --no-a     # B/C/D 만 (A 없이; D 가 mock 이면 A 불필요)
#   GGUI_MODE=ggui bash run.sh  # GGUI 생성 실험. codeReady=false면 C가 LOCAL로 폴백.
#   bash run.sh stop       # 포트(8000/8001/8002/5173) 점유 프로세스 종료
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT}/.run-logs"
mkdir -p "${LOG_DIR}"

PORT_A="${ANALYZE_PORT:-8000}"
PORT_B="${MENU_PORT:-8001}"
PORT_C="${GGUI_WRAPPER_PORT:-8002}"
PORT_D="${VITE_PORT:-5173}"

PIDS=()

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
log()   { echo "$(color '1;36' '[run]') $*"; }
warn()  { echo "$(color '1;33' '[run]') $*"; }

# ── stop 모드: 포트 점유 프로세스 종료 ───────────────────────
if [[ "${1:-}" == "stop" ]]; then
  for p in "${PORT_A}" "${PORT_B}" "${PORT_C}" "${PORT_D}"; do
    pid="$(lsof -ti tcp:"${p}" 2>/dev/null || true)"
    if [[ -n "${pid}" ]]; then
      warn "포트 ${p} 점유 프로세스 종료 (pid ${pid})"
      kill ${pid} 2>/dev/null || true
    fi
  done
  log "정리 완료."
  exit 0
fi

WITH_A=1
[[ "${1:-}" == "--no-a" ]] && WITH_A=0

cleanup() {
  echo ""
  warn "종료 신호 수신 — 자식 프로세스 정리 중…"
  for pid in "${PIDS[@]:-}"; do
    [[ -n "${pid}" ]] && kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  log "모두 종료."
}
trap cleanup INT TERM EXIT

wait_health() { # $1=url  $2=label  $3=tries
  local url="$1" label="$2" tries="${3:-30}"
  for ((i=1; i<=tries; i++)); do
    if curl -sf "${url}" >/dev/null 2>&1; then
      log "$(color '1;32' '✓') ${label} 정상 (${url})"
      return 0
    fi
    sleep 0.5
  done
  warn "$(color '1;31' '✗') ${label} 헬스체크 실패 (${url}) — 로그: ${LOG_DIR}/$(basename "${label}").log"
  return 1
}

# ── A · uvicorn (Python) ─────────────────────────────────────
if [[ "${WITH_A}" == "1" ]]; then
  log "Module A (uvicorn :${PORT_A}) 기동 — MOCK_MODE=${MOCK_MODE:-1}"
  (
    cd "${ROOT}/module-a"
    PYTHON_BIN="${PYTHON:-python}"
    [[ -x ".venv/bin/python" ]] && PYTHON_BIN=".venv/bin/python"
    MOCK_MODE="${MOCK_MODE:-1}" exec "${PYTHON_BIN}" -m uvicorn app:app --port "${PORT_A}"
  ) >"${LOG_DIR}/A.log" 2>&1 &
  PIDS+=("$!")
else
  warn "Module A 생략(--no-a). D 가 mock 이면 불필요."
fi

# ── B · node (Express) ───────────────────────────────────────
log "Module B (node :${PORT_B}) 기동"
( cd "${ROOT}" && PORT="${PORT_B}" exec node module-b/server.js ) >"${LOG_DIR}/B.log" 2>&1 &
PIDS+=("$!")

# ── C · node (Express) ───────────────────────────────────────
log "Module C (node :${PORT_C}) 기동 — GGUI_MODE=${GGUI_MODE:-local} (local=fast demo main)"
( cd "${ROOT}" && PORT="${PORT_C}" GGUI_MODE="${GGUI_MODE:-local}" exec node module-c/server.js ) >"${LOG_DIR}/C.log" 2>&1 &
PIDS+=("$!")

# ── D · vite (React) ─────────────────────────────────────────
log "Module D (vite :${PORT_D}) 기동"
( cd "${ROOT}/module-d" && exec npm run dev ) >"${LOG_DIR}/D.log" 2>&1 &
PIDS+=("$!")

# ── 헬스체크 ─────────────────────────────────────────────────
echo ""
log "헬스체크 (최대 ~15초)…"
[[ "${WITH_A}" == "1" ]] && wait_health "http://localhost:${PORT_A}/health" "A" || true
wait_health "http://localhost:${PORT_B}/health" "B" || true
wait_health "http://localhost:${PORT_C}/health" "C" || true
# D(vite) 는 /health 가 없으므로 루트 200 으로 확인
wait_health "http://localhost:${PORT_D}/" "D" 40 || true

echo ""
log "$(color '1;32' '기동 완료.')  데모 → $(color '1;4;36' "http://localhost:${PORT_D}")"
echo "       A=/health:${PORT_A}  B=/menu:${PORT_B}  C=/generate-ui:${PORT_C}  D=:${PORT_D}"
echo "       로그: ${LOG_DIR}/{A,B,C,D}.log    종료: Ctrl-C  (또는  bash run.sh stop)"
echo ""

# 포그라운드 유지 (Ctrl-C 까지)
wait
