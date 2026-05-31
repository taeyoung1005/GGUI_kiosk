#!/usr/bin/env bash
# ============================================================
# Giosk — 음성 적응형 키오스크 · 전체 기동 스크립트 (A/B/C/D)
# ------------------------------------------------------------
#   A: uvicorn (Python · FastAPI · :8000)  ← OpenAI Realtime 세션 중계(/realtime/session) + STT 폴백(/analyze)
#   B: node    (Express     · :8001)        ← 메뉴/주문
#   C: node    (Express     · :8002)        ← GGUI 적응 UI 생성 (키 있으면 GGUI 라이브, 없으면 LOCAL 폴백)
#   D: vite    (React 프론트 · :5173)        ← VITE_USE_MOCK 은 module-d/.env 로 제어
#
# BYOK: OPENAI_API_KEY 가 있으면 GGUI 라이브(기본)로, 없으면 LOCAL 폴백으로 동작한다.
#   키는 루트 .env 또는 module-c/.env 에 둔다(.gitignore 로 보호 — 절대 git 에 올리지 않는다).
#   키가 있으면 GGUI MCP 서버(:6781)도 필요할 때 자동 기동한다(이미 떠 있으면 재사용).
#
# 4개 모듈을 백그라운드로 띄우고 헬스체크 후 안내를 출력한다.
# 종료: Ctrl-C (모든 자식 프로세스 정리) 또는  bash run.sh stop
#
# 사용:
#   bash run.sh               # 전체 기동 (키 있으면 GGUI 라이브 + GGUI 서버 자동기동, 없으면 LOCAL)
#   bash run.sh --no-a        # B/C/D 만 (A 없이; D 가 mock 이면 A 불필요)
#   GGUI_MODE=local bash run.sh   # 키가 있어도 강제 LOCAL 렌더(빠른 데모)
#   bash run.sh stop          # 포트(8000/8001/8002/5173/6781) 점유 프로세스 종료
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${ROOT}/.run-logs"
mkdir -p "${LOG_DIR}"

PORT_A="${ANALYZE_PORT:-8000}"
PORT_B="${MENU_PORT:-8001}"
PORT_C="${GGUI_WRAPPER_PORT:-8002}"
PORT_D="${VITE_PORT:-5173}"
PORT_GGUI="${GGUI_PORT:-6781}"

PIDS=()

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
log()   { echo "$(color '1;36' '[run]') $*"; }
warn()  { echo "$(color '1;33' '[run]') $*"; }

# ── stop 모드: 포트 점유 프로세스 종료 ───────────────────────
if [[ "${1:-}" == "stop" ]]; then
  for p in "${PORT_A}" "${PORT_B}" "${PORT_C}" "${PORT_D}" "${PORT_GGUI}"; do
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

# ── OPENAI_API_KEY 탐지 (env > 루트 .env(.local) > module-c .env(.local)) ──
#   GGUI_MODE 기본값 결정 + GGUI 서버/모듈에 키 전달용. 모듈도 각자 .env 를 읽지만,
#   GGUI MCP 서버(npx)는 레포 .env 를 모르므로 여기서 export 해 물려준다.
PLACEHOLDER_KEY="sk-your-openai-key-here"
read_env_key() { # $1=파일경로 → OPENAI_API_KEY 값(없으면 빈 문자열)
  [[ -f "$1" ]] || return 0
  grep -E '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=' "$1" 2>/dev/null \
    | tail -1 \
    | sed -E 's/^[^=]*=[[:space:]]*//; s/^"//; s/"$//; s/^'\''//; s/'\''$//' \
    || true
}
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  for f in "${ROOT}/.env.local" "${ROOT}/.env" "${ROOT}/module-c/.env.local" "${ROOT}/module-c/.env"; do
    k="$(read_env_key "$f")"
    if [[ -n "${k}" ]]; then OPENAI_API_KEY="${k}"; break; fi
  done
fi
KEY_PRESENT=0
if [[ -n "${OPENAI_API_KEY:-}" && "${OPENAI_API_KEY}" != "${PLACEHOLDER_KEY}" ]]; then
  KEY_PRESENT=1
  export OPENAI_API_KEY
fi

# ── GGUI_MODE 기본값: 키 있으면 ggui(라이브 메인), 없으면 local(즉시·무키) ──
if [[ -z "${GGUI_MODE:-}" ]]; then
  if [[ "${KEY_PRESENT}" == "1" ]]; then GGUI_MODE="ggui"; else GGUI_MODE="local"; fi
fi
export GGUI_MODE

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

# ── GGUI MCP 서버 (C 가 ggui 모드일 때만; 이미 떠 있으면 재사용) ──
if [[ "${GGUI_MODE}" == "ggui" ]]; then
  if lsof -ti tcp:"${PORT_GGUI}" >/dev/null 2>&1; then
    log "GGUI MCP 서버 재사용 (:${PORT_GGUI} 이미 가동 중)"
  elif [[ "${KEY_PRESENT}" == "1" ]] && command -v npx >/dev/null 2>&1; then
    # 버전 핀 필수: latest(0.1.0-rc.1)는 codeReady=false 라 module-c 와 비호환.
    # 0.2.0-alpha.4 가 codeReady 호환 버전. GGUI_CLI_VERSION 로 override 가능.
    GGUI_CLI="@ggui-ai/cli@${GGUI_CLI_VERSION:-0.2.0-alpha.4}"
    log "GGUI MCP 서버 기동 (npx ${GGUI_CLI} serve :${PORT_GGUI})"
    ( exec npx -y "${GGUI_CLI}" serve --mcp-only --dev-allow-all --port "${PORT_GGUI}" \
        --public-base-url "http://127.0.0.1:${PORT_GGUI}" --no-open ) \
      >"${LOG_DIR}/GGUI.log" 2>&1 &
    PIDS+=("$!")
  else
    warn "GGUI MCP 서버를 띄울 수 없음(키/npx 없음) — C 는 LOCAL 폴백으로 동작합니다."
  fi
fi

# ── A · uvicorn (Python) ─────────────────────────────────────
if [[ "${WITH_A}" == "1" ]]; then
  log "Module A (uvicorn :${PORT_A}) 기동 — Realtime 중계 (realtime_ready=$([[ "${KEY_PRESENT}" == "1" ]] && echo yes || echo no))"
  (
    cd "${ROOT}/module-a"
    PYTHON_BIN="${PYTHON:-python}"
    [[ -x ".venv/bin/python" ]] && PYTHON_BIN=".venv/bin/python"
    exec "${PYTHON_BIN}" -m uvicorn app:app --port "${PORT_A}"
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
log "Module C (node :${PORT_C}) 기동 — GGUI_MODE=${GGUI_MODE} ($([[ "${GGUI_MODE}" == "ggui" ]] && echo 'GGUI 라이브, 실패 시 LOCAL 폴백' || echo 'LOCAL 렌더'))"
( cd "${ROOT}" && PORT="${PORT_C}" GGUI_MODE="${GGUI_MODE}" exec node module-c/server.js ) >"${LOG_DIR}/C.log" 2>&1 &
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
echo "       A=/health:${PORT_A}  B=/menu:${PORT_B}  C=/generate-ui:${PORT_C}  D=:${PORT_D}  (GGUI_MODE=${GGUI_MODE})"
echo "       로그: ${LOG_DIR}/{A,B,C,D,GGUI}.log    종료: Ctrl-C  (또는  bash run.sh stop)"
if [[ "${KEY_PRESENT}" != "1" ]]; then
  echo "       $(color '1;33' '키 없음') — LOCAL 모드로 체험 중. GGUI 라이브는 .env 에 OPENAI_API_KEY 를 넣고 다시 실행."
fi
echo ""

# 포그라운드 유지 (Ctrl-C 까지)
wait
