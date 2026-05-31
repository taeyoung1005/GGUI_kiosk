# 음성 적응형 키오스크 (Voice-Adaptive Kiosk)

> **OBA Weekend-thon S1 · GGUI 트랙**
> 한국 디지털 취약층(50+)을 위한 **음성으로 화면이 적응하는** 키오스크.
> 같은 "라떼 하나 주세요"라도 **느린 어르신**에게는 큰 글씨·큰 카드·음성안내 화면을,
> **빠른 청년**에게는 압축된 일반 화면을 보여준다. (= 적응 증명)

설계 문서: [SPEC.md](./SPEC.md) · [PLAN.md](./PLAN.md) · [PIPELINE.md](./PIPELINE.md)
공유 데이터 계약(정본): [`contracts/types.ts`](./contracts/types.ts) (+ `schemas.py` 미러, `mocks.json`)

---

## 0. 한눈에

```
🎤 발화 ─► A(/analyze: STT+나이+행동신호) ─► B(/menu) ─► C(/generate-ui: GGUI 적응 UI)
        ─► D(웹 키오스크: 일반 UI ⇄ 적응 UI + TTS) ─► B(/orders: mock 결제) ─► ✅ 완료
```

- 실시간 데모 렌더는 **Module C LOCAL 적응 렌더러**가 메인이다. GGUI live generation은 느리거나 `codeReady=false`일 수 있어 **offline/prewarm 실험 경로**로 둔다.
- Module A 는 STT·나이·행동신호만 담당한다.
- **적응 신호 주축 = 행동신호 `assist_level`(0~3)**, 나이(`age`)는 보조.
- **나이 신호 = public pretrained WavLM(`tiantiaf/wavlm-large-age-sex`)**. 행사 데모에서는 직접 학습 경로를 제거했다.
- **mock 모드로 키·백엔드 없이 즉시 데모 가능** (이게 빠른 시작의 핵심).

---

## 1. 모듈 지도

| 모듈 | 디렉토리 | 역할 | 스택 | 포트 | 계약 |
|------|----------|------|------|------|------|
| **A** | [`module-a/`](./module-a) | 음성 → 전사 + 나이대 + 행동신호 | Python · FastAPI · faster-whisper · wav2vec2 | **8000** | `POST /analyze → AnalyzeResult` |
| **B** | [`module-b/`](./module-b) | 메뉴 제공 + 주문 + mock 결제 | Node · Express · 시드 JSON | **8001** | `GET /menu → Menu` · `POST /orders → OrderResponse` |
| **C** | [`module-c/`](./module-c) | 적응 UI 생성 (추천+렌더) | Node · Express · LOCAL renderer · GGUI MCP fallback/probe | **8002** | `POST /generate-ui → GenerateUIResponse` |
| **D** | [`module-d/`](./module-d) | 웹 키오스크(일반 ⇄ 적응) · 마이크 · 오케스트레이션 | React · Vite · @ggui-ai/react | **5173** | A·B·C 호출 + mock 토글 |
| — | [`contracts/`](./contracts) | 4모듈 공유 데이터 계약(정본) | TS 타입 + py 미러 + mock JSON | — | `types.ts` · `schemas.py` · `mocks.json` |

> **포트 주의**: GGUI **MCP 뷰어**는 `6781`(`npx @ggui-ai/cli serve` 기본), Module C **`/generate-ui` 래퍼**는 `8002`.
> D 는 **C(8002)** 를 호출하고, C 가 내부적으로 GGUI(6781) 를 호출한다. D 의 `VITE_GGUI_URL` 은 **8002**(C 래퍼)를 가리킨다.

---

## 2. 빠른 시작

### 2-A. 가장 빠른 데모 — D 만 mock 으로 (키·백엔드 0개)

`VITE_USE_MOCK=true` 면 D 가 A/B/C 호출을 `contracts/mocks` 고정 JSON 으로 대체한다.
**"발화 → 분석 → 메뉴 → 적응 UI → 결제 완료"** 전체 흐름이 화면에서 끊김 없이 돈다.

```bash
cd module-d
npm install
cp .env.example .env          # VITE_USE_MOCK=true 가 기본값
npm run dev                   # → http://localhost:5173
```

화면에서 **마이크 버튼**을 누르면(마이크 권한 없어도 OK — 데모 발화로 진행) 적응 UI 가 뜬다.
**어르신/청년 토글**로 같은 발화의 두 화면(assist_level 2 vs 0)을 비교 → **적응 증명**.

### 2-B. 전체 기동 — 실제 A·B·C·D 결선(빠른 LOCAL 적응 렌더)

```bash
# (1) 루트에서 의존성 설치 (concurrency + B/C/D 노드 모듈)
npm run install:all

# (2-i) B·C·D 동시 기동 (A 는 Python 이라 별도 — 아래 run.sh 권장)
npm run dev:all

# (2-ii) A 포함 전 모듈 백그라운드 기동 + 헬스체크  ← 권장
bash run.sh                   # A:8000 · B:8001 · C:8002 · D:5173
#   bash run.sh --no-a        # D 가 mock 이면 A 없이
#   bash run.sh stop          # 포트 점유 프로세스 정리
npm run health                # 기동 후 A/B/C/D 헬스 한 번에 확인
```

**실서비스 결선 시** D 의 `.env` 에서 `VITE_USE_MOCK=false` 로 바꾼다(아래 §4 참고). C는 기본 `GGUI_MODE=local` 그대로 두는 것이 데모 메인 경로다.

### 기동 순서 (의존성)
```
A(8000)  ┐
B(8001)  ├─ 서로 독립 → 아무 순서나 OK
C(8002)  ┘   (C 는 GGUI 모드일 때만 6781 GGUI 뷰어 필요, local 모드는 단독)
D(5173)  ── 마지막. A/B/C 가 떠 있으면 실호출, mock 이면 단독
```

---

## 3. 포트 맵

| 포트 | 모듈 | 엔드포인트 | 비고 |
|------|------|-----------|------|
| **8000** | A | `POST /analyze` · `GET /health` | `MOCK_MODE=1` 이면 오디오 없이도 동작 |
| **8001** | B | `GET /menu` · `GET /menu/search` · `POST /orders` · `GET /orders/:id` | 시드 JSON in-memory |
| **8002** | C | `POST /generate-ui` · `GET /r/:id` · `GET /health` | `GGUI_MODE=local` 기본. 실데모 메인 |
| **6781** | GGUI 뷰어 | (MCP + 렌더 뷰어) | `GGUI_MODE=ggui` offline/prewarm 실험 때만 필요 |
| **5173** | D | (Vite dev) | 데모 진입점 |

---

## 4. .env 설정

루트 [`.env.example`](./.env.example) 에 **전 모듈 변수**가 모여 있다. 각 모듈은 자기 디렉토리에 `.env` 를 두거나 루트 값을 공유한다.

```bash
cp .env.example .env                  # 루트 (전 모듈 참고용)
cp module-d/.env.example module-d/.env # D (Vite — VITE_ 접두사만 브라우저 노출)
cp module-c/.env.example module-c/.env # C (OPENAI/GGUI 키)
cp module-a/.env.example module-a/.env # A (STT/ElevenLabs)
```

핵심 변수:

| 변수 | 모듈 | 의미 |
|------|------|------|
| `VITE_USE_MOCK` | D | `true`=mock(키·백엔드 불필요) / `false`=실호출 |
| `VITE_ANALYZE_URL` | D | A 주소. **원격 추론 시 이 값만 교체** |
| `VITE_MENU_URL` / `VITE_GGUI_URL` | D | B(8001) / C(**8002**) 주소 |
| `MOCK_MODE` | A | `1`=모델 없이 고정 시나리오 / `0`=실모델 |
| `AGE_MODEL_PROVIDER` | A | `wavlm_age_sex`=현재 데모의 pretrained WavLM provider |
| `GGUI_MODE` | C | `local`=키 없이 빠른 내장 렌더(데모 메인) / `ggui`=GGUI+OpenAI 실험 |
| `OPENAI_API_KEY` | A/C | A의 한국어 주문→영어 proxy 번역 + C의 GGUI 생성 LLM(BYOK). **OAuth 미지원 → raw 키 필요** |
| `ORDER_TRANSLATION_MODEL` | A | `gpt-4.1-mini` 기본. `build_english_order_proxy()` Responses API 번역 모델 |
| `GGUI_MODEL` | C | `openai:gpt-5.5-2026-04-23` (GGUI 기본 OpenAI 라우트) |

---

## 5. GGUI / OpenAI 연결 (offline/prewarm 실험)

기본 `GGUI_MODE=local` 은 **키 없이** C 가 적응 HTML 을 직접 렌더한다. 실시간 키오스크에서는 이 경로가 메인이다.

GGUI live generation은 `ggui_push`가 URL을 반환해도 `codeReady=false`면 viewer가 202 `Generating UI...`에 머물 수 있고, 정상 생성되어도 화면별 React component 생성 시간이 길다. 따라서 아래는 발표 메인 경로가 아니라 **오프라인 생성/캐시(prewarm) 가능성 확인용**이다.

```bash
# 1) GGUI MCP+뷰어 서버 기동 (기본 포트 6781)
export OPENAI_API_KEY=sk-...                 # ★ raw OpenAI 키 (OAuth 미지원)
npx -y @ggui-ai/cli@latest serve --dev-allow-all --port 6781

# 2) Module C 를 GGUI 모드로 기동
cd ../voice-adaptive-kiosk/module-c
GGUI_MODE=ggui GGUI_FORCE_CREATE=1 OPENAI_API_KEY=sk-... node server.js   # :8002

# 3) 생성 가능성 probe. codeReady=false면 local-fallback이 정상 안전망.
cd ..
npm run probe:ggui
```

- C(`src/ggui-client.js`)가 GGUI 의 `ggui_new_session` → `ggui_handshake` → `ggui_push`를 호출한다.
- `GGUI_FORCE_CREATE=1`은 handshake에 `forceCreate:true`를 실어 blueprint cache를 우회한다.
- `ggui_push` 결과가 `codeReady=true`일 때만 GGUI `embed_url`을 D에 넘긴다.
- `codeReady=false`, 키/서버 오류, 생성 실패는 모두 **LOCAL fallback**으로 전환한다(`X-GGUI-Path: local-fallback`).
- 사용 API = OpenAI **Responses API**. GGUI는 `GGUI_MODEL`, Module A 주문 번역은 `ORDER_TRANSLATION_MODEL` 모델 접근 권한이 있는 키여야 한다.

---

## 6. Module A 현재 모델 경로

행사 데모에서는 AIHub 직접 학습과 checkpoint 이식 경로를 제거했다. Module A는
`AGE_MODEL_PROVIDER=wavlm_age_sex`로 `tiantiaf/wavlm-large-age-sex` pretrained
model을 로드하고, 행동신호(`assist_level`)와 함께 rough age signal로만 사용한다.

```bash
cd module-a
PYTHON=.venv/bin/python ./run_local.sh
```

- local fine-tuned checkpoint directory(`models/age_model`)는 사용하지 않는다.
- `/demo/batch-summary` 같은 검증 artifact endpoint도 데모 표면에서 제거했다.
- 실제 제출 흐름은 Module D의 kiosk UI에서만 보여준다.

---

## 7. 동작 검증 (E2E mock 스모크)

mock 흐름이 **"발화 → analyze → menu → generate-ui(local) → 결제완료"** 로 끊김 없이 이어짐을 확인:

```bash
# B·C 를 띄우고 체인 호출
PORT=8001 node module-b/server.js &
PORT=8002 GGUI_MODE=local node module-c/server.js &

curl -s http://localhost:8001/menu                                  # → Menu (48 items)
curl -s "http://localhost:8001/menu/search?q=라떼"                   # → 라떼 후보
curl -s -X POST http://localhost:8002/generate-ui \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"라떼 하나 주세요","age_group":"50+","assist_level":2,"menu_context":[],"step":"recommend"}'
                                                                     # → {render_id, embed_url, contract}
curl -s -X POST http://localhost:8001/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"item_id":"cafelatte-003","options":{"온도":"HOT"},"qty":1}]}'   # → status:"paid"
```

D 단독(mock) 검증: `cd module-d && npm run typecheck` (계약 타입 정합) → `npm run dev` 후 마이크 버튼.

통합 코드 검증:

```bash
npm run verify       # Module C regression + Module D typecheck/build
npm run probe:ggui   # C가 ggui/local/local-fallback 중 무엇을 반환하는지 확인
```

---

## 8. 디렉토리

```
voice-adaptive-kiosk/
├── README.md            ← (이 파일) 루트 통합 가이드
├── package.json         ← dev:all (B/C/D concurrently) · install:all · health
├── run.sh               ← A(uvicorn)+B/C(node)+D(vite) 백그라운드 기동 + 헬스체크
├── scripts/health.mjs   ← 전 모듈 헬스체크
├── .env.example         ← 전 모듈 환경변수 모음
├── SPEC.md · PLAN.md · PIPELINE.md
├── contracts/           ← 공유 계약 (types.ts · schemas.py · mocks.json)
├── module-a/            ← AI 추론 (FastAPI)
├── module-b/            ← 메뉴/주문 (Express)
├── module-c/            ← GGUI 적응 UI 생성 (Express + GGUI MCP)
└── module-d/            ← 웹 키오스크 (React/Vite)
```
