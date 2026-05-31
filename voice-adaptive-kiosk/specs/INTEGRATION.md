# INTEGRATION — 병합(merge) 절차서

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 언어 = **영어**
> 프로젝트 루트: `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk`

운영 방식: **세션별 별도 세션 독립 개발 → 계약(`contracts/types.ts`) 기반 mock → 마지막에 한 번에 일괄 병합.**
이 문서는 그 **마지막 병합 단계** 한 곳을 위한 절차서다. (per-session 격리 명세는 `specs/MODULE_*.md`, 계약은 `specs/CONTRACTS.md`.)

---

## 0. 포트맵 (병합 환경의 진실)

| 모듈 | 포트 | 기동 | 헬스 | 비고 |
|------|------|------|------|------|
| A — AI 추론 + ElevenLabs (FastAPI/uvicorn) | **8000** | `uvicorn app:app --port 8000` | `GET /health` | CORS `*`. `/demo/*` = 내부 데모용 ElevenLabs helper API. |
| B — 메뉴/주문 (Express) | **8001** | `node module-b/server.js` | `GET /health` | 외부 의존 0. mock 결제. |
| C — GGUI 래퍼 (Express) | **8002** | `GGUI_MODE=local node module-c/server.js` | `GET /health` | **D 가 호출하는 GGUI 엔드포인트는 8002(C 래퍼)** — 6781 아님. |
| GGUI MCP+뷰어 | **6781** | `npx @ggui-ai/cli serve` | (뷰어 `/r/<code>`) | **C 내부**가 `GGUI_MODE=ggui` 일 때만 호출. OpenAI raw 키 필요. |
| D — 웹UI 프론트 (Vite) | **5173** | `npm --prefix module-d run dev` | `GET /` (200 HTML, `/health` 없음) | `VITE_USE_MOCK` 로 mock/live 토글. 산출=open-design MCP. |

> ★ **병합 시 가장 헷갈리는 점:** D 의 `VITE_GGUI_URL` 은 **`http://localhost:8002`(C 래퍼)** 를 가리킨다. `:6781`(GGUI MCP)을 직접 가리키지 않는다. C 가 내부에서 6781 을 호출하고, LOCAL 폴백 시엔 6781 없이 C 자신이 `:8002/r/<id>` 로 HTML 을 서빙한다. (출처: `.env.example` `VITE_GGUI_URL=http://localhost:8002`, `MODULE_C.md` §10-2, `MODULE_D.md` §6.)

env 변수명(루트 `.env.example` + 코드 일치):
A: `MOCK_MODE`·`ANALYZE_PORT`(=8000)·`AGE_MODEL_PROVIDER`·`STT_MODEL`·`ELEVENLABS_API_KEY`.
B: `MENU_PORT`/`PORT`(=8001).
C: `GGUI_WRAPPER_PORT`/`PORT`(=8002)·`GGUI_MODE`·`OPENAI_API_KEY`·`GGUI_URL`(=6781)·`GGUI_MODEL`·`GGUI_BEARER`.
D: `VITE_PORT`(=5173)·`VITE_USE_MOCK`·`VITE_ANALYZE_URL`·`VITE_MENU_URL`·`VITE_GGUI_URL`·`VITE_ANALYZE_API_KEY`.
(`run.sh` 는 `ANALYZE_PORT/MENU_PORT/GGUI_WRAPPER_PORT/VITE_PORT` 로 포트를 읽고, B/C 는 `PORT` 로 주입한다.)

---

## 1. 골든 플로우 (마이크 → A → B → C(GGUI) → 렌더 → 주문)

```
[D 웹UI · Standard]
  │ ① 마이크 캡처(16kHz mono WAV)
  ▼
A  POST /analyze   (multipart file=wav  또는  JSON {audio_base64})
  │ → AnalyzeResult { transcript, language, age{group,…}, behavioral{assist_level,…}, duration_ms }
  ▼  (D 가 assist_level=주축, age.group=보조 로 UI 강도 결정)
B  GET /menu        → Menu { restaurant, categories, items: MenuItem[] }
  │  (또는 GET /menu/search?q=<transcript> → { query, count, items: MenuItem[] })
  ▼
C  POST /generate-ui  { transcript, age_group, assist_level, menu_context: MenuItem[], step:"recommend" }
  │ → GenerateUIResponse { render_id, embed_url, contract }
  │     · GGUI 경로(메인/목표): embed_url = GGUI 서버가 돌려준 url (예 http://localhost:6781/r/<shortCode>)  (X-GGUI-Path: ggui)
  │     · LOCAL 폴백:           embed_url = http://localhost:8002/r/<id>                                       (X-GGUI-Path: local-fallback)
  │     · D mock:     embed_url = ""  → D 내장 적응 렌더러
  ▼
[D · Adaptive]  embed_url 임베드(@ggui-ai/react / iframe / 내장 렌더러)
  │ ② 사용자 액션(큰 카드 선택) → postMessage / ggui_consume → action:"selectMenu" {item_id}
  ▼  (멀티턴: step 을 recommend → options → fulfillment → loyalty → payment → confirm 으로 /generate-ui 재호출)
  │   recommend: selectMenu{item_id} → options
  │   options: selectOption{type,label} → fulfillment(Dine In/Take Out) → loyalty(scan/phone/none) → payment(결제수단) → confirm
  │   confirm: confirmYes → 주문 / confirmNo → recommend
  ▼
B  POST /orders   { items:[{ item_id, options:{<MenuOption.type>:<choice.label>}, qty }] }
  │ → OrderResponse { order_id, total, status:"paid" }   (mock 결제, 1~2초 지연)
  ▼
[D] "Payment Complete" + TTS(en-US) → Start Over
```

**적응 증명(데모 핵심):** 같은 발화 `"Can I get a latte"` 라도 행동신호가 다르면 `assist_level` 이 갈린다 →
- **elder**: `age.group="senior_adult"`, `assist_level=2`(senior 보조 가산으로 한 단계 상향) → 큰 글자(30px)·카드 2장·음성안내바.
- **youth**: `age.group="young_adult"`, `assist_level=0` → 18px·카드 3장·음성안내 없음·압축.

전 구간 폴백(데모 무중단): A 무응답 → D 일반 UI / C·키·GGUI 미가동 → C LOCAL 폴백 또는 D 내장 렌더러 / C 오류 → D Standard 화면.

---

## 2. 모듈 간 계약 정합 체크리스트 (병합 glue)

정본 = `contracts/types.ts`. 각 엣지에서 **필드명·타입·라벨**이 1:1 이어야 한다.

### 2.1 A.AnalyzeResult → D (소비)
- [ ] `/analyze` 응답이 `AnalyzeResult` 와 자구 일치: `transcript`, `language`, `age{group,years_est,confidence,child_prob}`, `behavioral{speech_rate,silence_ratio,filler_count,assist_level}`, `duration_ms`.
- [ ] `behavioral.assist_level ∈ {0,1,2,3}`, `age.group ∈ AgeGroup`(broad taxonomy: `young_adult|adult|senior_adult|child|teens|twenties|thirties|forties|fifties|sixties|seventies_plus|unknown` 12값), 비율 필드 ∈ [0,1].
- [ ] **★ 나이 라벨 정합 확인:** A 실코드(`inference/age.py` `age_years_to_group()`)는 `age.group` 을 **`young_adult`(<30)/`adult`(≤60)/`senior_adult`(>60)** 세 값(미준비·실패 시 `"unknown"`)으로 반환 → 계약 `AgeGroup` taxonomy 와 그대로 정합. **별도 decade→이진 매핑 불필요.** (`behavioral.py` 는 `senior_adult` 일 때 `assist_level` 을 한 단계 가산하고, korean-senior-proxy 경로에서는 `max(assist_level,2)` 로 올린다.)
- [ ] D 가 **`assist_level`(주축)·`age.group`(보조)** 로 화면 분기. (A 의 mock 두 변형 elder/youth ↔ D 의 mock 두 변형 일치.)

### 2.2 B.Menu → C.menu_context / D (소비)
- [ ] `GET /menu` 응답이 `Menu`(`restaurant`, `categories[]`, `items: MenuItem[]`). 실데이터 = `OBA Cafe`, 항목 **48개**(latte 변형 10개), 라벨 영어, categories=[Coffee,Latte,Tea,Ade,Beverage,Dessert].
- [ ] `MenuItem` = `{id,name,category,price,image_url,desc,options[]}`, `options[].choices[]={label,price_delta}`.
- [ ] **C 의 `menu_context` 는 B 의 `MenuItem[]` 그대로** 재사용(추가 매핑 0). D 가 recommend 단계에 후보 배열을, options/confirm 단계에 선택 1개를 넣는다.
- [ ] `GET /menu/search?q=` 응답 wrapper = `{ query, count, items: MenuItem[] }` → D/C 는 `.items` 만 추출.

### 2.3 D → C.GenerateUIRequest → D.GenerateUIResponse
- [ ] D→C 요청이 `GenerateUIRequest { transcript, age_group, assist_level, menu_context, step }`, `step ∈ {recommend,options,fulfillment,loyalty,payment,confirm}`(6단계, `module-c/server.js` `allowedSteps` ↔ `contracts/types.ts` `AdaptiveStep` 일치).
- [ ] C→D 응답이 `GenerateUIResponse { render_id, embed_url, contract }`.
- [ ] **D 는 `embed_url` 을 있는 그대로 임베드**(host/port 비가정: 8002·6781·"" 모두 처리). `contract`(=`any`)의 구체 키에 강결합 금지.
- [ ] 멀티턴 action 키 동형성(LOCAL `postMessage` == GGUI `actionSpec`): `selectMenu`/`repeat`(recommend), `selectOption`/`back`(options), `confirmYes`/`confirmNo`(confirm).
- [ ] C 의 멀티턴 확장 필드(`item`/`selectedOptions`/`total`)는 **계약 외 선택 필드** — `contracts/types.ts` 에 추가하지 않는다(없어도 동작).

### 2.4 D → B.OrderRequest → B.OrderResponse
- [ ] D→B 요청이 `OrderRequest { items:[{item_id, options:Record<string,string>, qty}] }`.
- [ ] **`OrderLine.options` 키 = `MenuOption.type`, 값 = `MenuOptionChoice.label`** (예: `{"Temperature":"Hot","Size":"Large"}`) — 메뉴 데이터 라벨과 정확히 일치해야 `price_delta` 가산. (불일치 시 B 는 0 가산으로 견고하게 무시 → total 만 조용히 틀어짐. ★검증 대상.)
- [ ] B→D 응답이 `OrderResponse { order_id, total, status:"paid" }`. `total = Σ(price + Σ선택 price_delta)×qty`.

### 2.5 D 의 엔드포인트 환경변수 매칭
- [ ] `VITE_ANALYZE_URL=http://localhost:8000`(A), `VITE_MENU_URL=http://localhost:8001`(B), `VITE_GGUI_URL=http://localhost:8002`(**C 래퍼**).
- [ ] `VITE_USE_MOCK=false` 로 live 결선. (mock 유지면 A/B/C 미사용.)

### 2.6 계약 4파일 무변경
- [ ] `contracts/types.ts`·`schemas.py`·`mocks.json`·`mocks.ts` 가 병합 후에도 동일(변경 시 4모듈 합의·동시 갱신 기록).

---

## 3. 동시 기동 (병합 환경 띄우기)

세 가지 방법(전부 루트에서). 처음이면 의존성부터:

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk
npm run install:all      # 루트 concurrently + module-b/c/d 각 npm install
# Module A(Python)는 별도: cd module-a && pip install -r requirements-public-age.txt (실모드) 또는 mock 최소 의존성
```

### (a) `bash run.sh` — A 포함 전체 + 헬스체크 (권장: 데모 환경)
```bash
bash run.sh             # A(MOCK_MODE=1)+B+C(GGUI_MODE=local)+D 백그라운드 기동 → 헬스체크 → 안내
bash run.sh --no-a      # A 없이 B/C/D 만 (D 가 mock 이면 A 불필요)
bash run.sh stop        # 포트 8000/8001/8002/5173 점유 프로세스 종료
```
- 기본값: A `MOCK_MODE=1`, C `GGUI_MODE=local`. live/GGUI 실연결은 아래 env 로 덮어쓴다.
- A 는 `${ROOT}/module-a` 에서 기동(`.venv` 있으면 자동 source). 로그: `.run-logs/{A,B,C,D}.log`. 종료: Ctrl-C(자식 정리) 또는 `bash run.sh stop`.

### (b) `npm run dev:all` — B/C/D 동시 (A 제외 — Python 이라 별도)
```bash
npm run dev:all         # concurrently 로 B(:8001)+C(:8002)+D(:5173). A 는 dev:a 또는 run.sh
npm run dev:a           # 별도 터미널: cd module-a && uvicorn app:app --port 8000
```

### (c) GGUI 실연결까지 (primary 경로 — OpenAI 키 필요)
```bash
# 1) GGUI MCP+뷰어
export OPENAI_API_KEY=sk-...
npx @ggui-ai/cli serve                          # :6781

# 2) C 를 ggui 모드로 (run.sh 의 GGUI_MODE 를 덮어씀)
GGUI_MODE=ggui OPENAI_API_KEY=sk-... GGUI_URL=http://localhost:6781 node module-c/server.js

# 3) D live 결선
VITE_USE_MOCK=false VITE_ANALYZE_URL=http://localhost:8000 \
VITE_MENU_URL=http://localhost:8001 VITE_GGUI_URL=http://localhost:8002 \
npm --prefix module-d run dev
```

### 헬스체크 (한 번에 A/B/C/D)
```bash
npm run health          # = node scripts/health.mjs
# ✓ A (analyze)     {"ok":true,...}
# ✓ B (menu)        {"status":"ok",...}
# ✓ C (generate-ui) {"status":"ok","module":"C","mode":"local",...}
# ✓ D (frontend)    200            ← D 는 /health 없음 → 루트 200 HTML 확인
# (전부 ✓ 면 exit 0, 하나라도 ✗ 면 exit 1)
```
> `scripts/health.mjs` 의 타깃 포트는 `ANALYZE_PORT/MENU_PORT/GGUI_WRAPPER_PORT/VITE_PORT` env 로 덮어쓸 수 있다(기본 8000/8001/8002/5173).

---

## 4. End-to-end 검증 단계 (병합 게이트)

순서대로. 앞 단계가 PASS 여야 다음으로.

**단계 0 — 정적/단독 게이트(각 모듈 명세 §7 재확인)**
```bash
# B: 문법 + 시드 파싱
node --check module-b/server.js
node -e "JSON.parse(require('fs').readFileSync('module-b/data/menu.seed.json','utf8'))"
# C: LOCAL 6단계(recommend|options|fulfillment|loyalty|payment|confirm) 200 (module-c §7)
# D: 빌드 게이트 (open-design 산출물 또는 참조 프로토타입)
npm --prefix module-d run build      # exit 0
# A: 유닛 테스트 (module-a §7 참조 — 일부 테스트가 error 상태일 수 있으니 게이트에서 인지)
cd module-a && PYTHONPATH=. .venv/bin/python -m unittest discover -s tests
```

**단계 1 — 전 모듈 기동 + 헬스 green**
```bash
bash run.sh          # 또는 dev:all + dev:a
npm run health       # A/B/C/D 전부 ✓
```

**단계 2 — 엣지별 계약 왕복(curl, §2 체크리스트 대조)**
```bash
# A: mock AnalyzeResult (MOCK_MODE=1 이면 multipart 없이도 mock 응답)
curl -s -X POST http://localhost:8000/analyze | python3 -m json.tool

# B: Menu(items 48) + 검색 + 주문(paid)
curl -s http://localhost:8001/menu | head -c 300
curl -s "http://localhost:8001/menu/search?q=latte"        # count=10 (latte 변형)
curl -s -X POST http://localhost:8001/orders -H 'Content-Type: application/json' \
  -d '{"items":[{"item_id":"caffe-latte-003","options":{"Size":"Large"},"qty":2}]}'  # status:"paid"

# C: recommend → render_id/embed_url/contract (menu_context 는 B 의 /menu items 일부를 그대로)
curl -s -X POST http://localhost:8002/generate-ui -H 'Content-Type: application/json' -d '{
  "transcript":"Can I get a latte","age_group":"senior_adult","assist_level":2,
  "menu_context":[{"id":"caffe-latte-003","name":"Caffe Latte","category":"Latte","price":4500,"image_url":"","desc":"","options":[{"type":"Temperature","choices":[{"label":"Hot","price_delta":0},{"label":"Iced","price_delta":0}]}]}],
  "step":"recommend"}' -i | grep -i 'X-GGUI-Path'    # local-fallback 또는 ggui
```
> 주의(§5 ④): B 실데이터 id 는 영어(`caffe-latte-003` 등). mock 명세의 `latte-001`/한글 라벨은 격리용 예시이므로 live 결선엔 쓰지 않는다.

**단계 3 — 브라우저 골든 플로우(D live)**
- `VITE_USE_MOCK=false` 로 `http://localhost:5173` 진입.
- `Start Voice Order` → analyze→menu→generate 스텝퍼 진행, 신호 스트립에 transcript/age/assist_level 표시.
- recommend(큰 카드) → 선택 → options → confirm → `Yes, Pay` → "Payment Complete"(order_id·total) → `Start Over`.
- **적응 대조**: elder(assist 2: 큰 글자·음성안내) vs youth(assist 0: 압축) 화면이 실제로 갈림.
- (GGUI 실연결 시) Adaptive 화면이 `:6781/r/...` 뷰어를 임베드, 액션이 멀티턴으로 이어짐.

**단계 4 — 폴백 회귀(데모 무중단)**
- A 끄고 D: 일반 UI 로 진행(터치). C 끄거나 키 없이: C LOCAL 폴백(`X-GGUI-Path: local-fallback`) 또는 D 내장 렌더러. C 오류: D `Back to Standard Screen`.

**(선택) 단계 5 — ElevenLabs 실음성 대조 (module-a `/demo/*`)**
```bash
# ElevenLabs 키 설정 후 — A 의 /demo/* 가 보이스 생성→analyze 검증을 한 응답에
curl -X POST http://localhost:8000/demo/generate-and-analyze \
  -H 'content-type: application/json' -d '{"age_group":"senior_adult","language":"en","seed":7}'
# ※ 합성음 나이 추정 정확도는 보장되지 않음(§5 ⑥) — "행동신호(assist_level)가 주축, 나이(age)는 보조" 메시지 유지.
```

---

## 5. 병합 시 알려진 이슈 & 해소

> ⚠ 본 절은 **실제 파일시스템·코드를 Read 해 사실 확인**한 결과로 정정됨. ①②는 과거에 "심링크/중복"으로 가정됐으나 현재 실제 상태는 다르다(아래 정정).

| # | 이슈 | 현재 실제 상태 (Read 확인) | 해소 / 처리 |
|---|------|--------------------------|------------|
| **①** | **module-a 정본 경로 = 루트 심링크?** (가정) | **거짓.** 루트 `/OBA_Weekenthon/module-a` 는 **존재하지 않음.** `voice-adaptive-kiosk/module-a` 는 **실제 디렉토리**(git 추적 20파일, mode 100644 — 120000 심링크 아님). `MODULE_A.md` §6/§9 의 "심링크(`module-a -> ../module-a`)" 서술은 **현 트리와 불일치(stale)**. | **정정·플래그.** 정본 = `voice-adaptive-kiosk/module-a`(실 디렉토리) 하나뿐. 별도 루트 카피 없음 → **중복/심링크 이슈 자체가 부재**. `MODULE_A.md` 의 심링크 문구는 다음 갱신 때 정정 대상(이번 세션 Write 범위 밖이라 기록만). A 작업·기동은 `voice-adaptive-kiosk/module-a` 에서. |
| **②** | **contracts 중복 (루트 vs kiosk)?** (가정) | **거짓(현재).** `find` 결과 repo 내 contracts 디렉토리는 **`voice-adaptive-kiosk/contracts` 단 하나**. 루트 `/OBA_Weekenthon/contracts` 없음. 정본 4파일(`types.ts`/`schemas.py`/`mocks.json`/`mocks.ts`)도 이 한 곳에만. | **미해결 플래그 → 실제로는 중복 없음.** 단일 SSoT 유지됨. 만약 향후 루트에 사본이 생기면 즉시 제거하고 `voice-adaptive-kiosk/contracts` 만 정본으로 둔다(드리프트 방지). 현시점 조치 불필요. |
| **③** | **GGUI 라이브 경로 = 메인/목표, 현재 `codeReady=false` 블로커로 LOCAL 폴백 중** (★결선 핵심) | `module-c/src/ggui-client.js` 의 GGUI 호출 순서/툴명 3버그(`ggui_new_session` 누락 / 잘못된 render 호출 / 응답키 오독)는 **이미 수정됨.** 현재 코드는 ① `ggui_new_session({})`(구버전 전용·없으면 skip), ② `ggui_handshake(...)`→`handshakeId`, ③ **`ggui_render`(alpha) 우선 호출, tool-not-found 면 `ggui_push`(legacy) 폴백** → `normalizeGguiPushResult` 가 `embed_url = result.url`·`render_id = result.stackItemId` 로 정규화하는 순서다. 남은 단일 블로커는 GGUI 서버가 `codeReady=false` 를 돌려줘 정규화가 거부되는 것(line 314)뿐이다. | **GGUI 라이브가 데모 메인/목표 경로.** `codeReady=true` 가 되면 `X-GGUI-Path: ggui` 로 실연결 완주. 블로커 동안에는 C 가 자동으로 LOCAL 폴백(`X-GGUI-Path: local-fallback`)으로 데모를 무중단 보장한다(임시 폴백 — 설계 목표는 GGUI 라이브 복구). 멀티턴 수신은 `ggui_consume({stackItemId})`. (`MODULE_C.md` §9 매핑표.) |
| **④** | **나이 라벨(코드↔계약 정합) + 옵션 라벨 mock id 혼재** | A 코드(`age.py`)는 `age.group` 을 **`young_adult`/`adult`/`senior_adult`**(미준비·실패 시 `"unknown"`)로 반환하며 계약 `AgeGroup`(12값 broad taxonomy)와 **정합** — 한국어 decade도 `"50+"|"under50"` 이진 라벨도 코드/계약 어느 쪽에도 없다. C 격리 mock 명세는 한글 메뉴(`카페라떼`,`온도`,`latte-001`)인데 B 실데이터는 영어(`Caffe Latte`,`Temperature`,`caffe-latte-003`). | (a) **나이:** `age.py` 는 `young_adult`/`adult`/`senior_adult` 를 반환하여 계약 taxonomy 와 정합 → **decade/이진 매핑 불필요.** `behavioral.py` 는 `senior_adult`/`50대`/`60대 이상`/`elder` 등 여러 별칭을 모두 senior 로 처리해 `assist_level` 을 가산한다(견고). (b) **옵션/ id:** live 결선 후엔 **mock id·한글 라벨 금지** — 항상 B `/menu` 의 실제 영어 `items[].id`·`MenuOption.type`/`choice.label`(Temperature/Size, Hot/Iced/Regular/Large) 사용. 불일치 시 B 가 0 가산으로 조용히 무시 → total 만 틀어짐(★검증). |
| **⑤** | **STT off → 행동신호 무력화** | A 기본 `STT_MODEL=whisper-1`(OpenAI Whisper API, transcript 채움 — 루트·`module-a/.env.example` 모두 `whisper-1`) 이지만, `STT_MODEL ∈ {'','none','noop','off','disabled'}` 이면 `NoopSTT` → transcript 빈값 → `speech_rate`/`filler_count`(텍스트 기반)이 사실상 무의미, 나이 보조 가산만 남음. (`'small'`/`local:small` 은 명시 시의 faster-whisper 로컬 보조 경로일 뿐 런타임 기본 아님.) | 데모 시나리오별 env 고정: **행동신호 시연 = `STT_MODEL=whisper-1`(기본) 또는 로컬 검증 `STT_MODEL=local:small`**, STT 무력화 검증 = `STT_MODEL=none`. 통합 데모는 D 의 `VITE_USE_MOCK`(고정 elder/youth 신호)로 안정 시연 + "assist_level 이 주축" 메시지 유지. |
| **⑥** | **합성(TTS) 음성 나이 정확도 약함** | 과거 배치 평가는 합성음 연령 구분이 거의 안 됨을 보였으나, 그 산출 스크립트(`scripts/age_demo_batch.py`·`scripts/fairspeech_eval.py`)와 `/demo/batch-summary` 엔드포인트는 현재 제거됨(재현 불가). 또한 `age.py` 는 decade 가 아니라 `young_adult`/`adult`/`senior_adult` 를 산출하므로 옛 'decade match' 수치는 더 이상 코드로 재현되지 않는다. | 합성음 나이 추정은 **데모 시연용일 뿐 정확도 보장 안 함.** 발표/UI 에서 "**행동신호(assist_level)가 적응 주축, 나이(age)는 보조**" 메시지 일관 유지. 실연령 신뢰 지표로 쓰지 말 것. (계정 보이스로 `ELEVENLABS_AGE_VOICE_MAP_JSON` override 시 인상 개선 가능.) |

### (참고) 그 밖의 잔여 정합 포인트
- **C URL 혼동(8002 vs 6781):** D 의 `VITE_GGUI_URL=http://localhost:8002`(C 래퍼) 고정. 6781 은 C 내부 전용. D 는 `embed_url` 을 있는 그대로 임베드(host/port 비가정).
- **계약 4파일 드리프트:** 계약 변경 금지. 부득이하면 4모듈 합의 후 `types.ts`/`schemas.py`/`mocks.json`/`mocks.ts` 동시 갱신. 받는 쪽은 모르는 필드 무시(forward-compatible).
- **포트/실행 디렉토리:** A 는 반드시 `voice-adaptive-kiosk/module-a` 에서 기동(부모에 `contracts/`). D 빌드는 module-d 로컬 바이너리(`npm --prefix module-d run ...`). 포트는 run.sh/health.mjs 의 8000/8001/8002/5173 고정.

---

## 6. 병합 완료 정의 (Definition of Done)

- [ ] `npm run health` — A/B/C/D 전부 ✓ (exit 0).
- [ ] §2 계약 정합 체크리스트 전 항목 ✓ (A→D, B→C·D, D→C→D, D→B). 특히 §2.1 나이 매핑(④)·§2.4 옵션 라벨 정합.
- [ ] §4 단계 3(브라우저 골든 플로우) live 완주 + **적응 대조**(elder vs youth) 시연.
- [ ] §4 단계 4 폴백 회귀(A/C 다운 시 데모 무중단).
- [ ] C **GGUI 실연결 1회**(데모 메인/목표 경로: `X-GGUI-Path: ggui`, `embed_url`=GGUI 서버가 돌려준 url 예 `:6781/r/...`). 호출 순서/툴명 버그는 이미 수정됐고 남은 블로커는 `codeReady=false`(③) — 블로커 동안에는 LOCAL 폴백으로 데모 무중단 보장하되 GGUI 라이브 복구를 잔여 목표로 명시.
- [ ] 계약 4파일 무변경(또는 4모듈 합의·동시 갱신 기록).
- [ ] 단일 정본 확인: module-a = `voice-adaptive-kiosk/module-a`(①), contracts = `voice-adaptive-kiosk/contracts`(②) 한 곳뿐 — 루트 사본 없음.
- [ ] 비밀키 무노출: `module-c/.env.local`(OPENAI), module-a `ELEVENLABS_API_KEY` 등 커밋·로그 금지.
</content>
