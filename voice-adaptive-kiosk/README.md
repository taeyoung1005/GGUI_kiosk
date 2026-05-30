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

- **두뇌+렌더 = GGUI 의 OpenAI GPT** (EXAONE 없음). Module A 는 STT·나이·행동신호만.
- **적응 신호 주축 = 행동신호 `assist_level`(0~3)**, 나이(`age`)는 보조.
- **모델 추론 = 로컬 기본 / 원격 폴백** (학습만 원격 GPU 4060Ti×2).
- **mock 모드로 키·백엔드 없이 즉시 데모 가능** (이게 빠른 시작의 핵심).

---

## 1. 모듈 지도

| 모듈 | 디렉토리 | 역할 | 스택 | 포트 | 계약 |
|------|----------|------|------|------|------|
| **A** | [`module-a/`](./module-a) | 음성 → 전사 + 나이대 + 행동신호 | Python · FastAPI · faster-whisper · wav2vec2 | **8000** | `POST /analyze → AnalyzeResult` |
| **B** | [`module-b/`](./module-b) | 메뉴 제공 + 주문 + mock 결제 | Node · Express · 시드 JSON | **8001** | `GET /menu → Menu` · `POST /orders → OrderResponse` |
| **C** | [`module-c/`](./module-c) | 적응 UI 생성 (추천+렌더) | Node · Express · GGUI MCP · OpenAI BYOK | **8002** | `POST /generate-ui → GenerateUIResponse` |
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

### 2-B. 전체 기동 — 실제 A·B·C·D 결선

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

**실서비스 결선 시** D 의 `.env` 에서 `VITE_USE_MOCK=false` 로 바꾼다(아래 §4 참고).

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
| **8002** | C | `POST /generate-ui` · `GET /r/:id` · `GET /health` | `GGUI_MODE=local`(기본) 또는 `ggui` |
| **6781** | GGUI 뷰어 | (MCP + 렌더 뷰어) | `GGUI_MODE=ggui` 일 때만 필요. C 가 내부 호출 |
| **5173** | D | (Vite dev) | 데모 진입점 |

---

## 4. .env 설정

루트 [`.env.example`](./.env.example) 에 **전 모듈 변수**가 모여 있다. 각 모듈은 자기 디렉토리에 `.env` 를 두거나 루트 값을 공유한다.

```bash
cp .env.example .env                  # 루트 (전 모듈 참고용)
cp module-d/.env.example module-d/.env # D (Vite — VITE_ 접두사만 브라우저 노출)
cp module-c/.env.example module-c/.env # C (OPENAI/GGUI 키)
cp module-a/.env.example module-a/.env # A (모델 경로/STT)
```

핵심 변수:

| 변수 | 모듈 | 의미 |
|------|------|------|
| `VITE_USE_MOCK` | D | `true`=mock(키·백엔드 불필요) / `false`=실호출 |
| `VITE_ANALYZE_URL` | D | A 주소. **원격 추론 시 이 값만 교체** |
| `VITE_MENU_URL` / `VITE_GGUI_URL` | D | B(8001) / C(**8002**) 주소 |
| `MOCK_MODE` | A | `1`=모델 없이 고정 시나리오 / `0`=실모델 |
| `GGUI_MODE` | C | `local`=키 없이 내장 렌더 / `ggui`=GGUI+OpenAI |
| `OPENAI_API_KEY` | C | GGUI 생성 LLM(BYOK). **OAuth 미지원 → raw 키 필요** |
| `GGUI_MODEL` | C | `openai:gpt-5.5-2026-04-23` (GGUI 기본 OpenAI 라우트) |

---

## 5. GGUI / OpenAI 연결 (실 생성 모드)

기본 `GGUI_MODE=local` 은 **키 없이** C 가 적응 HTML 을 직접 렌더한다(폴백 경로). 실제 GGUI+OpenAI 로 생성하려면:

```bash
# 1) GGUI MCP 서버 기동 (클론본: ../ggui 의 README 기준, 기본 포트 6781)
export OPENAI_API_KEY=sk-...                 # ★ raw OpenAI 키 (OAuth 미지원)
cd ../ggui && npx @ggui-ai/cli serve         # MCP + 뷰어 :6781

# 2) Module C 를 GGUI 모드로 기동
cd ../voice-adaptive-kiosk/module-c
GGUI_MODE=ggui OPENAI_API_KEY=sk-... node server.js   # :8002
```

- C(`src/ggui-client.js`)가 GGUI 의 `ggui_handshake` → `ggui_render` 를 호출, `embed_url`(`6781/r/<shortCode>`)을 돌려준다.
- **GGUI/키 미가동 시 자동 LOCAL 폴백** → 데모가 끊기지 않음(`X-GGUI-Path: local-fallback` 헤더로 확인).
- 사용 API = OpenAI **Responses API**. `GGUI_MODEL` 모델 접근 권한이 있는 키여야 한다.

---

## 6. 원격 모델 이식 절차 (학습 → 로컬 추론)

추론은 로컬, **학습만 원격 GPU(4060Ti×2)**. 산출물 폴더를 `scp` 로 복사하면 같은 코드가 로컬에서 추론한다.

```bash
# (원격) 학습 → 내보내기
python module-a/training/05_train.py                     # 단일 GPU
torchrun --nproc_per_node=2 module-a/training/05_train.py # 2×4060Ti DDP
python module-a/training/06_eval_export.py               # → models/age_model/ (save_pretrained)

# (이식) 원격 → 로컬
scp -r oba-4060ti:~/module-a/models/age_model ./module-a/models/age_model

# (로컬) 동일 코드로 추론
#   module-a/.env:  MOCK_MODE=0  AGE_MODEL_PATH=./models/age_model
cd module-a && uvicorn app:app --port 8000
```

- 라벨 = `화자연령대` → **이진 "50+ vs under50"**. **화자 단위 split**(누수 방지) 필수.
- 모델 미완 시 폴백: `audeering` zero-shot + 행동신호(스파인)로 즉시 가동.
- **원격 추론 폴백**: A 를 원격에 띄우고 D 의 `VITE_ANALYZE_URL` 만 교체 + `VITE_ANALYZE_API_KEY`(Bearer) 설정.

---

## 7. 동작 검증 (E2E mock 스모크)

mock 흐름이 **"발화 → analyze → menu → generate-ui(local) → 결제완료"** 로 끊김 없이 이어짐을 확인:

```bash
# B·C 를 띄우고 체인 호출
PORT=8001 node module-b/server.js &
PORT=8002 GGUI_MODE=local node module-c/server.js &

curl -s http://localhost:8001/menu                                  # → Menu (20 items)
curl -s "http://localhost:8001/menu/search?q=라떼"                   # → 라떼 5종
curl -s -X POST http://localhost:8002/generate-ui \
  -H 'Content-Type: application/json' \
  -d '{"transcript":"라떼 하나 주세요","age_group":"50+","assist_level":2,"menu_context":[],"step":"recommend"}'
                                                                     # → {render_id, embed_url, contract}
curl -s -X POST http://localhost:8001/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"item_id":"cafelatte-003","options":{"온도":"HOT"},"qty":1}]}'   # → status:"paid"
```

D 단독(mock) 검증: `cd module-d && npm run typecheck` (계약 타입 정합) → `npm run dev` 후 마이크 버튼.

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
