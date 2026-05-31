# Giosk 공개 준비 — 구현 계획 (통합·패키지화·README)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development 또는 executing-plans. Steps는 checkbox(`- [ ]`)로 추적.

**Goal:** 리워크된 코드를 "낯선 사람이 GitHub만 보고 → 자기 OpenAI 키를 `.env`에 넣고 → 단일 명령으로 실행"할 수 있는 공개 상태로 만든다.

**Context:** 한국어화+음성주문 리워크(별도 계획 `2026-05-31-voice-kiosk-korean-rework.md`)가 **선행 완료**된 전제. 제품명은 **Giosk**. 배포 = 발표/데모링크가 아니라 **GitHub 링크 공개형 + BYOK(Bring Your Own Key)**. GGUI 라이브는 이미 복구 완료.

**제외 (확정):** 데모 링크 호스팅(BYOK라 불필요), 데모 리허설(발표 안 함), GGUI 복구(완료됨).

**Tech Stack:** 4모듈(A FastAPI/Python, B·C Express/Node, D React+Vite), OpenAI Realtime, GGUI MCP. 루트 `package.json`(install:all/dev:all/run:all/health/verify) + `run.sh`.

**진행 원칙:** 각 단계 작은 단위 커밋. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. A(실행검증)→B(패키지화)→C(README) 순서. A는 서버를 띄우고 관찰하는 상호작용 작업이라 **에이전트 위임보다 사람이 보면서 진행 권장**.

---

## Phase A: 통합 & 라이브 결선 검증

리워크 후 4모듈이 실제로 함께 도는지 확인. (코드 수정보다 "띄우고 관찰하고 고치는" 작업)

### Task A1: 새 구조에 맞춰 기동 스크립트·헬스 점검

**Files:** `run.sh`, `scripts/health.mjs`, 루트 `package.json`

- [ ] **Step 1: 제거된 라우트/추가된 라우트 반영 확인**

리워크로 module-a의 `/demo/*` 라우트가 사라지고 `/realtime/session`이 생겼다. `scripts/health.mjs`가 옛 엔드포인트(예: `/demo/voice-presets`)를 헬스체크하면 실패한다.
Run: `grep -nE "demo|analyze|realtime|health" voice-adaptive-kiosk/scripts/health.mjs`
→ 옛 엔드포인트 참조가 있으면 `/health`·`/realtime/session` 기준으로 수정.

- [ ] **Step 2: run.sh의 모드 기본값 점검**

run.sh 주석/기본값이 옛 `MOCK_MODE=1`(module-a)·`GGUI_MODE=local`을 가리킨다. 리워크 후 module-a는 MOCK_MODE가 없고 Realtime 중계로 바뀌었으니 주석/기본 env 정합. GGUI는 복구됐으니 `GGUI_MODE=ggui`를 데모 메인으로 둘지 결정(키 있을 때).
→ 수정 후 `bash run.sh` 1회 기동해 4포트(8000/8001/8002/5173) health 200 확인.

- [ ] **Step 3: 커밋**
```bash
git add run.sh scripts/health.mjs package.json && git commit -m "[fix] 리워크 후 구조에 맞춰 기동·헬스 스크립트 정합"
```

### Task A2: 라이브 골든 플로우 1회 완주

**Files:** (코드 수정 없음 — 실행 검증)

- [ ] **Step 1: 키 세팅 후 전체 기동**

`module-c/.env`(또는 루트)에 `OPENAI_API_KEY` 세팅, `module-d/.env`에 `VITE_USE_MOCK=false` + `VITE_REALTIME_URL`(또는 ANALYZE_URL) 세팅. `bash run.sh`로 A/B/C/D + GGUI 기동.

- [ ] **Step 2: 골든 플로우 수동 확인 (브라우저 :5173)**

일반 키오스크 → 음성 버튼 → 한국어 발화("따뜻한 라떼 하나") → 2초 침묵 자동 종료 → 한국어 transcript → GGUI가 큰글씨·큰카드 어댑티브 화면 생성(화면 전체 전환) → 추천→옵션→…→확인 → mock 결제 "결제 완료". 각 단계 스크린샷.

- [ ] **Step 3: 실패 지점 디버깅**

Realtime 연결(ephemeral client_secret, WebRTC SDP)·GGUI codeReady·계약 필드 정합(transcript→C→D) 중 막히는 곳을 로그로 추적해 수정. 막히면 `VITE_USE_MOCK=true`로 폴백해 UI/흐름만이라도 통과 확인.

- [ ] **Step 4: 검증 결과 커밋(수정 있었으면)**

---

## Phase B: 패키지화 — "한 번에 설치 + 실행"

낯선 사람이 `git clone` 후 명령 하나로 셋업·기동할 수 있게.

### Task B1: 단일 setup 명령

**Files:** 루트 `package.json`, (신규) `setup.sh` 또는 `scripts/setup.mjs`

- [ ] **Step 1: setup 스크립트 작성**

4모듈 node 의존성(`install:all`은 이미 있음) + **module-a Python venv 생성·의존성 설치**를 한 번에. 예: `npm run setup` = `install:all` + `module-a` venv 부트스트랩(`python -m venv .venv && .venv/bin/pip install -r requirements.txt`). module-a/run_local.sh 로직 참고.
```json
"setup": "npm run install:all && bash module-a/setup-venv.sh"
```
(setup-venv.sh 신규: venv 생성 + pip install. 이미 venv 있으면 skip.)

- [ ] **Step 2: 단일 start 명령 확인**

`npm run run:all`(=`bash run.sh`)이 이미 전체 기동. README에서 이걸 메인 기동 명령으로 안내. `dev:all`은 B/C/D만이니 A 포함 여부 문구 명확화.

- [ ] **Step 3: 검증 — 클린 클론 시뮬레이션**

가능하면 `node_modules`·`.venv` 지운 상태에서 `npm run setup && npm run run:all`이 끝까지 도는지 확인(시간 들면 단계별로).

- [ ] **Step 4: 커밋**
```bash
git add package.json module-a/setup-venv.sh && git commit -m "[feat] 단일 명령 셋업(setup) 패키지화"
```

### Task B2: BYOK .env 정리

**Files:** 각 모듈 `.env.example`, 루트 `.env.example`(신규 검토)

- [ ] **Step 1: 키가 필요한 곳 통합 정리**

OpenAI 키가 필요한 곳: module-c(GGUI 생성), module-a(Realtime). 사용자가 키를 **한 군데**(또는 명확히 안내된 두 곳)에 넣게 정리. `.env.example`에 `OPENAI_API_KEY=` + 주석으로 "platform.openai.com에서 발급" 안내.

- [ ] **Step 2: .gitignore 확인**

`.env`·`.env.local`이 전부 gitignore되는지 확인(키 유출 방지). `git check-ignore voice-adaptive-kiosk/module-c/.env` 등.

- [ ] **Step 3: 키 없을 때 graceful 동작 확인**

키 없으면 GGUI 라이브 대신 LOCAL 폴백으로라도 도는지(`GGUI_MODE=local`). README에 "키 없이도 LOCAL 모드로 체험 가능, 키 넣으면 GGUI 라이브" 안내 가능.

- [ ] **Step 4: 커밋**

---

## Phase C: 한국어 README (Giosk)

평가자/사용자가 보는 핵심 문서. 루트 `README.md` 재작성.

### Task C1: 루트 README.md 재작성

**Files:** `README.md`

- [ ] **Step 1: 본문 = Q1~Q4 (사용자 초안 그대로 살림)**

제품명 **Giosk**. 섹션 구성:
1. **제목 + 한 줄 소개** — "Giosk — 말하면 나에게 맞는 화면이 뜨는 음성 키오스크"
2. **어떤 문제를 해결하나요? (Q1)** — 키오스크의 보편적 불편, 어르신 자책, 초고령화로 모두의 문제.
3. **타깃 사용자 (Q2)** — 주 타깃 50대+, 단 음성주문은 누구에게나(줄 길 때/손 바쁠 때/메뉴 낯설 때), 매장 운영자 부담↓.
4. **핵심 기능·작동 방식 (Q3)** — 마이크→한국어 발화→2초 침묵 자동종료→GGUI가 발화 읽어 큰글씨·큰카드 화면 생성·전체전환→추천·옵션·결제·확인 음성/터치. 예시("따뜻한 라떼 하나"→라떼, "안 단 걸로"→당도 낮은 메뉴). 흐름: 누른다→말한다(자동종료)→GGUI 화면생성→예시→음성/터치 완료.
5. **기존 방식 대비 차별점 (Q4)** — 기존은 모두 같은 화면, Giosk는 발화 기반 동적 생성. '쉬운 모드'를 찾아 들어가는 게 아니라 말 한마디로 바로.

- [ ] **Step 2: 실행 가이드 섹션**

```markdown
## 시작하기
1. git clone
2. OpenAI API 키 발급 (platform.openai.com) → `.env`에 `OPENAI_API_KEY=...`
3. `npm run setup`  (4모듈 + Python venv 한 번에)
4. `npm run run:all`  (또는 `bash run.sh`)
5. 브라우저 http://localhost:5173
```
+ 키 없이 LOCAL 모드 체험 방법(있으면).

- [ ] **Step 3: 아키텍처 간단 소개**

4모듈 표(A 음성/Realtime STT, B 메뉴/주문, C GGUI 적응 UI 생성, D 키오스크 프론트) + 포트(8000/8001/8002/5173) + 한 줄씩. 기술 스택. "GGUI 라이브가 메인, LOCAL 폴백" 한 줄.

- [ ] **Step 4: 커밋**
```bash
git add README.md && git commit -m "[docs] Giosk 한국어 README 재작성 (Q1~Q4 + 설치/실행/아키텍처)"
```

### Task C2: 스펙 문서 정합 (선택)

**Files:** `specs/*.md`, `PLAN.md`, `SPEC.md`, 각 모듈 README

- [ ] **Step 1: 리워크 반영**

리워크로 바뀐 것(Realtime STT, 나이/proxy/before-after 제거, 강도 고정, 한국어, Giosk 네이밍)을 스펙에 반영. 이미 이전 정합 작업이 일부 했으나 Realtime·Giosk는 신규. 단 README가 메인이라 우선순위 낮음 — 시간 되면.

---

## 완료 기준 (Definition of Done)

- [ ] 클린 상태에서 `npm run setup && npm run run:all` → 4포트 health 200
- [ ] 브라우저에서 음성 주문 골든 플로우 완주(키 있을 때 GGUI 라이브, 없을 때 LOCAL)
- [ ] README만 보고 낯선 사람이 설치·키설정·실행 가능
- [ ] `.env`/키가 git에 안 올라감
- [ ] 제품명 Giosk로 통일
