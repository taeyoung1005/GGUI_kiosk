# MEMORY — 음성 적응형 키오스크 (진행 기록)

## Module A — AI 추론 서비스 (생성 완료)

- 위치: `module-a/` (Python · FastAPI · uvicorn). 다른 모듈 디렉토리는 건드리지 않음.
- 책임: 음성(wav 16kHz) → `AnalyzeResult` (STT 전사 + 나이대 + 행동신호 `assist_level`).
- 공유 계약은 `contracts/schemas.py`(canonical `contracts/types.ts`의 pydantic 미러)를 **import**해서 그대로 사용. 응답이 이 스키마로 검증됨(확인 완료).

### 핵심 결정/구현
- **행동신호가 스파인**: `inference/behavioral.py`는 순수 함수로 구성(테스트 가능).
  - `assist_level`(0~3) 룰 = 느림(speech_rate≤2.5 +2 / ≤3.5 +1) + 머뭇거림(silence_ratio≥0.6 +2 / ≥0.4 +1) + 채움말(≥2회 +1) + 고령 보조(50+ +1), 0~3 클램프.
  - 안전장치: `child_prob>0.8`이면 고령 가산 무시(아동 오탐 방지).
  - 한국어 음절 카운터 자체 구현(가-힣 1음절, 숫자 자릿수, 영문 모음군집 근사).
- **나이는 보조**: `inference/age.py` — `AGE_MODEL_PATH`(로컬 fine-tuned) 우선 → 없으면 `audeering/wav2vec2-large-robust-24-ft-age-gender` zero-shot. years_est≥50 → "50+". 추론 실패 시 mock 폴백(무중단).
- STT: `inference/stt.py` faster-whisper 래퍼(word_timestamps). VAD: `inference/vad.py` silero-vad + 에너지 기반 폴백.
- **MOCK_MODE=1 기본**: 외부 모델/키 없이 uvicorn 기동 + `/analyze`가 유효 `AnalyzeResult` 반환(고정 시나리오 = 느린 어르신 "어 라떼 음 하나 주세요", assist_level=3).
- 모델 추론 = 로컬 기본 / 원격 폴백. EXAONE 없음(추천+UI는 GGUI OpenAI GPT 담당).
- `app.py`는 프로젝트 루트를 sys.path에 추가해 `contracts` import. `API_KEY` 설정 시 Bearer 인증 강제(미설정 시 off). CORS 허용.
- 학습은 원격 GPU(4060Ti×2)에서만: `training/01~06` 골격 + 풍부한 TODO. AIHub `dataSetSn=71320`, 이진 "50+ vs under50", **화자 단위 split**(누수 방지), 하위층 freeze + grad accum, `save_pretrained → models/age_model`, scp 이식.

### 검증 결과 (모두 통과)
- `tests/test_behavioral.py` 13개 케이스 PASS (pytest 없이 직접 실행 가능).
- venv(`.venv`)에 core deps(fastapi/uvicorn/pydantic/python-multipart/numpy)만 설치해도 기동.
- `/health` → `{status:ok, mock_mode:true}`.
- `POST /analyze` 3경로 검증: 빈 호출 / multipart wav / base64 JSON → 모두 유효 `AnalyzeResult`. multipart wav는 wav 헤더로 `duration_ms` 정확히 반영(2000ms).
- 라이브 응답을 `contracts.schemas.AnalyzeResult.model_validate`로 검증 OK.
- API_KEY 설정 시 토큰 없으면 401, 있으면 200.

### 실행 (요약)
```bash
cd module-a
pip install fastapi "uvicorn[standard]" pydantic python-multipart numpy   # mock 최소
cp .env.example .env       # MOCK_MODE=1 기본
uvicorn app:app --port 8000
curl -s -X POST http://localhost:8000/analyze   # mock에선 오디오 없이도 동작
```
실모델: `pip install -r requirements.txt`, `.env`에서 `MOCK_MODE=0`(+옵션 `AGE_MODEL_PATH`).

### 미해결/후속
- 실모델 모드(torch/transformers/faster-whisper) 미설치 상태 — 무거워서 mock으로만 검증함. 실오디오 정확도/지연은 모델 설치 후 별도 검증 필요.
- audeering 모델 출력 형태(tuple vs ModelOutput.logits)는 변형 견고 처리했으나 실측 미확인.
- 시스템 Python 3.13에서 venv 검증함(SPEC 권장은 3.11; 코드는 버전 무관).

---

## [통합] 루트 정비 + 4모듈 교차검증 + E2E 스모크 (완료)

### 루트에 생성한 파일
- `README.md`(루트): 프로젝트 개요·모듈 지도·빠른 시작(2-A mock D 단독 / 2-B 전체 결선)·포트맵·.env·GGUI/OpenAI 연결·원격 모델 이식·E2E 스모크. SPEC/PLAN/PIPELINE 링크.
- `package.json`(루트): `dev:all`(concurrently 로 B/C/D 동시 기동, `-n B,C,D`) · `install:all` · `health` · `dev:a`(uvicorn) · workspaces[module-b/c/d]. concurrently@9.2.1 설치 검증.
- `run.sh`: A(uvicorn, venv 자동 source)+B/C(node)+D(vite) 백그라운드 기동 + 헬스체크 + 안내. `--no-a` / `stop` 모드. trap 으로 Ctrl-C 시 자식 정리.
- `scripts/health.mjs`: A/B/C/D 헬스 한 번에(`npm run health`).

### 교차검증 결과 (계약 정합 — 모두 일치, 코드 수정 0건)
- **A.`/analyze` → C.`/generate-ui`**: A 출력 `age.group`→C `age_group`, `behavioral.assist_level`→C `assist_level`. 필드명 일치 확인(실 HTTP 검증).
- **B.`/menu`(items) → C `menu_context`**: MenuItem 형태 그대로 전달. 일치.
- **D 오케스트레이션**: `client.ts`+`orchestrator.ts` 가 A/B/C 를 계약대로 호출. `@contracts` alias(vite.config + tsconfig)로 정본 `contracts/types.ts` import → `npm run typecheck` PASS.
- **포트 분리 정합**: GGUI 뷰어=6781, C 래퍼=8002. D 의 `VITE_GGUI_URL`=8002(C 래퍼) 올바름. C 가 내부에서 6781 호출.

### E2E mock/non-mock 스모크 (PASS)
- `run.sh` 전체 기동 → A/B/C/D 4개 헬스 OK(3 half-sec 내). `--no-a` 도 B/C/D OK.
- **비-mock 체인**: A `/analyze`(어르신, assist_level=3) → B `/menu/search?q=라떼`(5종) → C `/generate-ui`(local, embed HTML 200·"라떼" 포함) → B `/orders`(status:"paid", total 4500). **끊김 없음.**
- D mock 흐름: `VITE_USE_MOCK=true` 가 `contracts/mocks`(latte-001 자기완결) 사용 → 단독 동작. typecheck PASS.

### 발견한 통합 리스크 (경미 — 기능 영향 없음, 미수정)
- **id 불일치(cosmetic)**: mocks.json/SPEC/문서 예시는 `latte-001`, B 실제 시드는 `cafelatte-003`(20 items 확장됨). 단, 어떤 오케스트레이션 코드도 `latte-001` 을 실 B 에 하드코딩하지 않음(예시/mock 에만 존재) → mock 모드 자기완결, 실모드는 B 가 주는 id 흐름 → **무해**. 데모 일관성 위해 mocks.json 의 id 를 B 시드와 맞추면 더 깔끔.
- **assist_level 값 차이**: A mock 시나리오는 룰상 level 3, contracts/mocks.json 은 level 2. D mock 모드는 mocks.json 만 쓰므로 무관.

### 남은 사람 작업(다음 단계)
1. **OpenAI 키 + GGUI 모드 전환**: `OPENAI_API_KEY`(raw) 발급 → `../ggui` 에서 `npx @ggui-ai/cli serve`(6781) → C 를 `GGUI_MODE=ggui` 로 → `X-GGUI-Path:ggui` 확인. 실패 시 자동 local 폴백.
2. **원격 학습 → 모델 이식**: training 05/06 실행 → `scp models/age_model` → A `.env` `MOCK_MODE=0 AGE_MODEL_PATH=...`.
3. **시드 메뉴 확장/정합**: B 시드 ↔ mocks.json id 정합(특히 `latte-001` vs `cafelatte-003`), 이미지(`/img/menu/*`) 채우기.
4. **실모델 deps 설치**(A: requirements.txt) + 실오디오 지연/정확도 검증, 원격 노출(터널+API_KEY+CORS).

---

## English demo conversion + synthetic menu assets (완료)

- `contracts/types.ts`는 변경하지 않음. 기존 `Menu/MenuItem/MenuOption` shape 그대로 유지.
- `module-b/data/menu.seed.json`을 English cafe menu 20개로 교체. 카테고리: Coffee, Latte, Tea, Ade, Beverage, Dessert.
- "latte" 검색 데모가 다수 후보를 내도록 Caffe Latte, Vanilla Latte, Matcha Latte, Caramel Latte, Hazelnut Latte, Mocha Latte, Sweet Potato Latte 포함.
- 각 메뉴 `image_url`은 `/img/menu/<id>.svg`로 정합. `module-b/public/img/menu/`에 20개 synthetic SVG placeholder 생성.
- `module-b/server.js`의 기존 `/img` static serving은 유지하고, `/menu/search`가 `"Can I get a latte"` 같은 영어 문장에서도 token 기반으로 latte 후보를 찾도록 보강.
- `contracts/mocks.json`/`mocks.ts`는 영어 transcript(`Can I get a latte`)와 실제 seed id(`caffe-latte-003` 등)로 정렬.
- `module-d/src`의 user-facing 화면 문구, 진행 메시지, 에러 메시지, TTS 발화 언어를 영어로 전환. 한국어 코드 comments는 유지 가능 범위로 남김.

## Module D 명세 재작성 — open-design MCP 웹UI 빌드 (specs/MODULE_D.md 덮어쓰기)

- 운영방침 변경: 웹 UI 를 손으로 React 짜는 대신 **open-design MCP** 로 Codex 세션이 제작, 데이터 바인딩/삽입도 같은 세션. owner=Codex.
- `specs/MODULE_D.md` 를 "어떤 UI 를 open-design MCP 로 만들지"의 요구·계약 명세로 전면 재작성(덮어쓰기). 기존 React 구현(`module-d/src`)은 **참조 프로토타입 = 요구사항 원천**으로 명시, 최종 웹 UI 는 open-design 산출로 대체/재작성됨을 적음.
- 추출한 기능 요구(참조 코드 Read): StaticKiosk(Standard/Before, 작은 글씨·폴백) ↔ AdaptiveKiosk(After, embed_url 임베드/빈값이면 내장 적응 렌더러), 마이크 캡처(16kHz mono WAV)→A, speechSynthesis(en-US) assist_level 비례 TTS, A/B/C 호출 흐름 recommend→options→confirm→order(멀티턴), VITE_USE_MOCK 격리.
- 계약 슬라이스(contracts/types.ts 정본): 소비 AnalyzeResult/Menu/GenerateUIResponse(embed_url 임베드, 빈값이면 내장렌더), 생산 GenerateUIRequest/OrderRequest→OrderResponse. 각 예시 JSON 포함. 옵션 맵 키=MenuOption.type, 값=choice.label.
- before/after 두 모드 대조가 데모 핵심 + 노인친화 규율(큰 글씨·고대비·큰 버튼·음성안내, 영어) 명시. 적응 강도 표(assist 0~3 → 글자/카드수/설명/Yes·No/TTS)는 module-c adapt.js 와 정합.
- 빌드 도구 = open-design MCP 도구 표면(list_projects/get_active_context/get_artifact/get_file/search_files/list_files, 리소스 od://design-systems·od://skills) 사실 반영.
- **사실 확인:** open-design 데몬(http://127.0.0.1:7456) 호출 시 미가동("Start it with `pnpm tools-dev`"). 명세에 "현재 미가동 → Codex 가 먼저 데몬 기동 + OD 프로젝트 열어 활성 컨텍스트 생성" 으로 명시.
- 데이터 삽입: 메뉴/이미지는 Module B(:8001) `/menu`·`/img/menu/*` 또는 contracts/mocks sampleMenu 로 mock(데이터 내용 생성은 MENU_DATA_SPEC 소관, 여기선 바인딩만).
- 실행/검증: 산출물 5173 미리보기(`module-d` npm run dev, VITE_USE_MOCK 기본 true) + open-design MCP 로 산출 파일 존재·페치 검증 + before/after·멀티턴·폴백 수동 체크리스트.
- Write 한 파일은 `specs/MODULE_D.md` 하나뿐. contracts·module 코드·다른 파일 미수정(규칙 준수).

## specs/README.md + specs/INTEGRATION.md 실구조 갱신 (2026-05-30)

- **대상 2파일만 Write** (지정 명세 외 무수정 규칙 준수). 먼저 specs/{CONTRACTS,MODULE_A,B,C,D}.md + MENU_DATA_SPEC.md + run.sh + contracts/types.ts + scripts/health.mjs + package.json 을 Read 해 사실 반영.
- **세션 구조 반영:** module-a(Codex, ElevenLabs `/demo/*` 흡수=구 VOICEGEN 폐지)·module-b(Codex)·module-c(Claude, GGUI 결선 핵심)·웹UI=module-d(Codex open-design MCP, 데이터 삽입 포함)·공유계약=CONTRACTS(공동·변경금지). README 에 세션·소유표 + 외부분리(MENU_DATA_SPEC) 링크 + "SPEC/PLAN=개요, specs/*=세션레디" 명시. 잔존 specs/VOICEGEN.md 는 폐지 안내만(Write 범위라 삭제 안 함).
- **★사실 정정(Read 확인):** 지시문이 가정한 ①"module-a 정본=루트 심링크" ②"contracts 중복(루트 vs kiosk)"는 **실제 파일시스템과 불일치**.
  - ① 루트 `/OBA_Weekenthon/module-a` **부재**. `voice-adaptive-kiosk/module-a` 는 git 추적 실디렉토리(20파일, mode 100644 — 심링크 아님). `MODULE_A.md` 의 심링크 문구는 stale(차기 갱신 대상, 이번 Write 범위 밖이라 기록만).
  - ② repo 내 contracts 디렉토리는 `voice-adaptive-kiosk/contracts` **단 하나**(find 확인). 루트 사본 없음 → 중복 이슈 실재하지 않음.
  - 추측 금지 규칙에 따라 INTEGRATION §5 표에 "가정 vs 실제 상태" 로 정정·플래그.
- **INTEGRATION 알려진 이슈 6종:** ①module-a 정본(정정: 실디렉토리 단일) ②contracts 중복(정정: 중복 없음·단일 SSoT) ③module-c GGUI 호출순서(new_session→handshake→push, 미수정·결선핵심) ④나이 한/영 혼재 + mock id/라벨 혼재(decade→이진 매핑·live는 영어 실데이터) ⑤STT off→행동신호 무력화(small vs none) ⑥합성음성 나이 정확도 약함(7/100, "행동신호 주축·나이 보조" 메시지). + 포트맵/골든플로우/계약 정합 체크리스트/동시기동(run.sh·dev:all·health)/end-to-end 4단계+ElevenLabs 대조/DoD.
- health.mjs 실제 출력 반영: A=`{"ok":true}`, B/C=`{"status":"ok"}`, D=루트 200. A 의존성은 requirements-public-age.txt.

## 2026-05-30 — Module A 영어 전용 ElevenLabs 균등 음성 생성/검증

- 작업 경로를 `voice-adaptive-kiosk/module-a`로 전환. 기존 top-level `module-a` 산출물은 이동된 경로 기준으로 이어서 사용.
- AIHub 한국어 학습 경로는 발표용에서 제외하고, 영어 public model `tiantiaf/wavlm-large-age-sex` + ElevenLabs 영어 TTS 검증으로 전환.
- ElevenLabs 기본 voice preset은 성별을 실제로 반영하지 않고 40~50대 예측 쏠림이 있어, `/v1/shared-voices`의 `age`/`gender` label 기반 영어 voice pool로 교체.
- 서버/대시보드 요청에 `gender`를 추가하고, `10대/20대/30대/40대/50+` 각각 female/male voice pool을 사용하도록 수정.
- 배치 기준을 `10대,20대,30대,40대,50+` × `female,male` × 10 = 총 100개로 변경. 기존 0대~90대 세분은 영어 모델/voice label과 맞지 않아 사용하지 않음.
- 새 산출물: `module-a/artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100.csv`, summary=`module-a/artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100_summary.json`, MP3 100개.
- 새 배치 결과: 100/100 ok, target age group은 5개 bucket 각 20개, gender는 female/male 각 50개. match=42/100. predicted_decade 분포는 10대=2, 20대=18, 30대=37, 40대=14, 50대=14, 60대=4, 70대=2, 80대=9.
- 대시보드는 영어 전용으로 정리: `/demo`, options=`10대/20대/30대/40대/50+`, gender select, English live order text, localStorage experiment log.
- 검증: `.venv/bin/python -m unittest discover -s tests -v` 18개 통과, `py_compile` 통과, `/health`, `/demo/voice-presets`, `/demo/generate-and-analyze` 수동 API 검증 통과. 이동된 venv의 `uvicorn` shebang은 예전 경로라 `.venv/bin/python -m uvicorn ...`으로 실행해야 함.

## 2026-05-30 — Module D 웹 키오스크 UI 구현/검증 (open-design MCP 기준)

- 범위는 `module-d` 웹 UI만 수정. `contracts/types.ts` 및 다른 모듈 코드는 변경하지 않음.
- open-design MCP 데몬은 응답 중이며 `list_projects`에서 `OBA_Weekenthon` 폴더 프로젝트를 확인. `ggui_kiosk` 프로젝트는 파일이 없어 산출물 소스로 쓰지 않고, 폴더-backed `OBA_Weekenthon` 프로젝트에서 `module-d/src` 파일을 OD 산출물처럼 조회함. `search_files("kiosk-stage")`, `get_file(module-d/src/App.tsx)`, `get_artifact(module-d/src/main.tsx)`로 접근 가능 확인.
- UI를 Compare 기본 화면으로 변경해 Standard/Before와 Adaptive/After가 같은 첫 화면에 병치되도록 함. Standard는 조밀한 메뉴 그리드/폴백 느낌, Adaptive는 큰 카드/큰 글자/큰 버튼/신호 스트립으로 before/after 대비를 강화.
- `VITE_USE_MOCK=true` 기본 흐름 유지. Senior(Slow)=`sixties`, assist 2 / Younger(Fast)=`twenties`, assist 0 mock 변형으로 같은 transcript `"Can I get a latte"`가 다른 UI 강도로 분기됨.
- 메뉴 이미지는 live 모드에서는 Module B `image_url`을 `VITE_MENU_URL` 기준으로 해석하고, mock 모드에서는 메뉴명·카테고리 기반 inline SVG artwork를 생성해 백엔드 없이도 카드 이미지가 보이게 함.
- Adaptive 경로는 Module C `embed_url`이 있으면 iframe/optional `@ggui-ai/react` 임베드, mock처럼 빈 문자열이면 내장 렌더러(recommend→options→confirm→order)를 사용.
- 검증:
  - `npm run typecheck` 통과.
  - `npm run build` 통과(`tsc -b && vite build`).
  - Vite preview `http://127.0.0.1:5173/`에서 Playwright mock flow 통과: Start Voice Order → Caffe Latte → options → confirm → Yes, Pay → Payment Complete.
  - Younger mock 재실행에서 `Assist Level assist 0`과 추천 카드 표시 확인.
  - mobile viewport 390×844에서 Standard/Adaptive 양쪽 heading 렌더 및 console error 없음 확인.
  - 스크린샷 임시 산출물: `/tmp/oba-module-d-desktop-initial.png`, `/tmp/oba-module-d-desktop-paid.png`, `/tmp/oba-module-d-desktop-youth.png`, `/tmp/oba-module-d-mobile-initial.png`.

## 2026-05-30 — Module B 명세 대비 검증

- 범위 준수: `module-b/server.js`, `module-b/data/menu.seed.json`, `module-b/public/img/menu/*`, `contracts/types.ts`, `specs/MODULE_B.md`, `specs/CONTRACTS.md`를 읽고 검증만 수행. `contracts/types.ts`, 다른 모듈, 메뉴 데이터/SVG는 수정하지 않음.
- 계약 정합: `GET /menu`는 `Menu`(`restaurant`, `categories`, `items`)를 반환하고 `MenuItem` 필드가 `id/name/category/price/image_url/desc/options`와 일치. `POST /orders`는 `OrderRequest.items[].item_id/options/qty`를 소비하고 `OrderResponse`(`order_id`, `total`, `status:"paid"`)만 반환. `GET /orders/:id`도 동일 `OrderResponse`만 반환.
- 데이터 읽기 전용 확인: 시드 `restaurant="OBA Cafe"`, categories=`Coffee/Latte/Tea/Ade/Beverage/Dessert`, items=20. `latte` 정적 후보 7개(`caffe-latte-003`, `vanilla-latte-004`, `matcha-latte-005`, `caramel-latte-006`, `hazelnut-latte-007`, `mocha-latte-008`, `sweet-potato-latte-009`). 누락 필드/누락 SVG 없음.
- 검증 명령: `npm install` 완료(0 vulnerabilities), `node --check server.js` 통과.
- 라이브 스모크(`PORT=8001 node server.js`): `/health` → `status:"ok"`, `items:20`; `/menu` → items 20; `/menu/search?q=latte` → count 7; `POST /orders` → HTTP 201, `ord-1002`, total 5000, `status:"paid"`, `time_total=1.53363s`; `GET /orders/ord-1002` → HTTP 200 + 동일 `OrderResponse`; `/img/menu/caffe-latte-003.svg` → HTTP 200.
- `.env.local` 로더 확인: `env -u PORT node server.js`로도 `.env.local`의 `PORT=8001`을 읽어 `http://localhost:8001`에서 기동, `/health`가 `items:20` 반환.
- 수정사항: 서버 로직 수정 없음. 남은 이슈 없음(메뉴 데이터 큐레이션은 `MENU_DATA_SPEC.md` 범위).

## 2026-05-30 — Module A 새 경로 실행성 정리

- `voice-adaptive-kiosk/module-a/run_local.sh`를 새 경로 이동 후에도 동작하도록 `python -m uvicorn` 실행 방식으로 변경. 이동된 venv의 `.venv/bin/uvicorn`은 이전 top-level `module-a` 경로 shebang을 참조할 수 있어 직접 실행하지 않는다.
- demo 기본 STT를 `none`으로 고정하고 `.env.example`에 `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID` 추가.
- 영어 데모 기준으로 `scripts/test_elevenlabs_age_demo.sh`를 한국어+영어 smoke에서 영어 1건 smoke로 정리. `AGE_GROUP`, `GENDER`, `BASE_URL`, `OUT_DIR` 환경변수로 제어.
- `NoopSTT`의 language를 `ko`에서 `unknown`으로 변경. STT를 끈 영어 데모에서 언어가 한국어로 보이는 오해를 제거.
- 검증: `bash -n run_local.sh scripts/test_elevenlabs_age_demo.sh`, `.venv/bin/python -m unittest discover -s tests -v` 19개 통과, `py_compile` 통과, `PYTHON=.venv/bin/python ./run_local.sh` 서버 실행 확인, smoke script로 50+ female English MP3 생성 및 `/analyze` 결과 `language=unknown`, age group `50+` 확인.

## 2026-05-31 — UI 요구 서버 기능 검토

- Module D live call surface 확인: A `/analyze`, A `/demo/announcer-voice/audio`(ElevenLabs TTS, 실패 시 browser TTS 폴백), B `/menu`, B `/menu/search?q=`, B `/orders`, C `/generate-ui`.
- 검증: `npm --prefix module-d run typecheck` 통과, `npm --prefix module-c test` 5개 통과, `node --check module-b/server.js && node --check module-c/server.js` 통과, `python3 -m py_compile module-a/app.py` 통과.
- B 런타임 확인: current seed items=48, latte search count=10, 누락 이미지 0. 일반 옵션 주문(`caffe-latte-003`, Large) → HTTP 201 total 5000 paid, optional upgrades 포함 주문(Set dessert+Large size combo+Extra shot) → HTTP 201 total 10000 paid. B 서버가 UI의 optional upgrade 가격까지 반영함.
- C 런타임 확인: `recommend`/`options`/`confirm`은 step별 contract/actionSpec 정상. 그러나 D가 새로 보내는 `fulfillment`/`loyalty`/`payment` step은 C `server.js`에서 `["recommend","options","confirm"]`만 허용해 전부 `recommend`로 normalize됨. 응답 contract도 `selectMenu/repeat`으로 돌아와 C/GGUI 경로 기준 step-specific 화면 생성이 미구현 상태.
- 해석: D는 local/built-in renderer를 우선 써서 화면 자체는 진행 가능하지만, "UI에서 제공하는 단계들을 서버 C가 생성한다"는 기준으로는 fulfillment/loyalty/payment가 남은 gap. A/B 기본 기능은 현재 코드 기준 충족.

## 2026-05-31 — Module C 잔여 step 서버 기능 구현/검증

- current worktree 기준으로 C는 이미 `contracts/types.ts`의 `AdaptiveStep` 확장(`recommend/options/fulfillment/loyalty/payment/confirm`)과 C `server.js` allowed step 확장을 갖고 있었음. 남은 검증 포인트는 LOCAL 렌더가 각 step에 맞는 action HTML을 실제로 내는지.
- 회귀 테스트 추가: `module-c/tests/local-render.test.mjs`에 fulfillment/loyalty/payment step별 local render 테스트를 추가. 각 step이 `setFulfillment`/`setLoyalty`/`setPayment` action과 value를 내고 `selectMenu` 추천 카드로 떨어지지 않는지 확인.
- 검증: `npm --prefix module-c test` → 13개 통과. `node --check module-c/server.js`, `node --check module-c/src/local-render.js`, `node --check module-c/src/contract.js`, `node --check module-c/src/ggui-client.js` 통과. `npm --prefix module-d run typecheck` 통과.
- 라이브 검증: `PORT=8012 GGUI_MODE=local node module-c/server.js` 후 `/generate-ui`를 6개 step으로 curl. 결과:
  - `recommend` → actionKeys `selectMenu, repeat`, HTML title `Adaptive UI · recommend · L2`
  - `options` → actionKeys `selectOption, back`, HTML title `Adaptive UI · options · L2`
  - `fulfillment` → actionKeys `setFulfillment, back`, HTML에 `data-action="setFulfillment"`
  - `loyalty` → actionKeys `setLoyalty, back`, HTML에 `data-action="setLoyalty"`
  - `payment` → actionKeys `setPayment, back`, HTML에 `data-action="setPayment"`
  - `confirm` → actionKeys `confirmYes, confirmNo`, HTML에 `data-action="confirmYes"`
- 결론: UI가 서버 C에 요구하는 expanded multi-turn step 생성 기능은 current state에서 충족. 8012 검증 서버는 종료함.

## 2026-05-30 — 대시보드 배치 실험 요약 표시 추가

- `/demo/batch-summary` 엔드포인트 추가: `artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100_summary.json`과 CSV를 읽어 available, total, ok, match, target/gender/predicted distribution을 반환.
- `/demo` 대시보드에 `Balanced Batch` 섹션 추가: 영어 100개 균등 생성 결과, 성공 수, match rate, gender split, predicted decade 분포 막대를 표시.
- 대시보드 표기를 영어 발표용으로 정리: age option display는 `10s/20s/30s/40s/50+`, 내부 value는 기존 모델 bucket(`10대` 등) 유지.
- 검증: 신규 `tests/test_demo_batch_summary.py` 추가. `.venv/bin/python -m unittest discover -s tests -v` 21개 통과, `py_compile` 통과, `/demo/batch-summary` API 수동 확인, Playwright screenshot `artifacts/demo-dashboard-final.png`로 렌더 확인.

## 2026-05-30 — Voice data 실제 녹음 기반 age model 검증 전환

- ElevenLabs 합성 음성이 실제 나이대 목소리처럼 들리지 않아, 모델 검증 기준을 Voice data 실제 영어 녹음 데이터셋으로 전환. ElevenLabs 결과는 voice metadata proxy일 뿐 ground truth가 아니므로 검증 패널 우선순위에서 내림.
- Hugging Face `voice-data-validation` 데이터셋 확인: `audio`, `transcription`, `age`, `gender`, `first_language` 컬럼. age label은 `18 - 22`, `23 - 30`, `31 - 45`, `46 - 65` 4개 구간, gender는 female/male.
- `scripts/voice_data_eval.py` 추가: HF streaming + `Audio(decode=False)`로 audio bytes를 받고 `soundfile`로 디코딩, 16kHz로 리샘플 후 `tiantiaf/wavlm-large-age-sex` 모델을 한 번 로드해 균등 샘플 평가. `datasets` streaming 종료가 지연되어 CLI 종료 시 stdout/stderr flush 후 명시 종료하도록 처리.
- 신규 테스트 `tests/test_voice_data_eval.py` 추가. Voice data age label 정규화, model years→Voice data age-bin 매핑, age×gender 균등 목표 생성을 검증.
- `/demo/batch-summary`는 `artifacts/voice-data-eval-v1/voice_data_eval_summary.json`/CSV가 있으면 이를 우선 반환하고, 없으면 기존 ElevenLabs synthetic batch summary로 fallback. 대시보드는 `Voice data Validation` 제목과 real sample/match/gender/predicted distribution을 표시.
- 실제 검증 실행: `PYTHONPATH=. .venv/bin/python scripts/voice_data_eval.py --out-dir ./artifacts/voice-data-eval-v1 --per-cell 10 --max-scan 6000 --device cpu`.
- 결과: 80/80 ok, age-bin match=29/80(36.25%), target distribution은 4개 age-bin 각 20개, gender distribution은 female/male 각 40개. predicted distribution은 `18-22`=11, `23-30`=26, `31-45`=27, `46-65`=7, `outside`=9.
- 해석: 공개 WavLM age-sex 모델을 발표 데모의 보조 신호로는 쓸 수 있으나, 실제 나이대 분류 정확도가 낮아 “신뢰 가능한 나이대 분류기”로 주장하면 안 됨. 데모 문구는 적응형 UI 신호/프로토타입 중심으로 조정 필요.
- 검증: `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 25개 통과, `py_compile` 통과, `/demo/batch-summary`가 Voice data 결과를 반환함 확인, Playwright screenshot `module-a/artifacts/demo-dashboard-voice-data-final.png`로 렌더 확인.

## 2026-05-30 — VoxCeleb age/gender 메타데이터 샘플 manifest 추출

- 모델 관련 공개 데이터 후보로 `hechmik/voxceleb_enrichment_age_gender`의 `final_dataframe_extended.csv`를 사용. 컬럼은 `VoxCeleb_ID`, `Name`, `gender`, `birth_year`, `recording_year`, `speaker_age`, `speaker_age_title_only`, `video_id`, `title` 등.
- `module-a/scripts/voxceleb_age_gender_sample.py` 추가: 원격 CSV를 스트리밍으로 읽고 decade×gender 셀당 1명씩, 동일 `VoxCeleb_ID` 중복 없이 선택. 오디오는 다운로드하지 않고 메타데이터 manifest만 생성.
- 생성 산출물: `module-a/artifacts/voxceleb-age-gender-sample-v1/voxceleb_age_gender_sample.csv`, `voxceleb_age_gender_sample_summary.json`.
- 결과: 목표 20셀(10s~100s × female/male) 중 17개 선택. 채워진 셀은 `10s`~`80s` 남녀 + `90s/male`; 누락은 `90s/female`, `100s/female`, `100s/male`.
- 안전 결정: 이 manifest는 검증 샘플 계획용이며, 공개 데이터셋 화자를 ElevenLabs 등으로 voice cloning 하는 입력으로 사용하지 않는다. 데모 음성 생성은 동의 받은 음성/라이선스 명확한 음성만 별도 사용해야 함.
- 검증: 신규 `tests/test_voxceleb_age_gender_sample.py` 3개 통과. 전체 `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 28개 통과, `.venv/bin/python -m py_compile app.py inference/*.py tests/*.py scripts/*.py` 통과.

## 2026-05-30 — Voice data 실제 wav 오디오 추출

- 사용자가 메타데이터가 아니라 실제 음성 파일 추출을 요구. VoxCeleb age/gender CSV는 clip timestamp가 없어 메타데이터만으로 정확한 화자 오디오를 바로 뽑기 어렵고, 유튜브 전체 오디오를 가져오면 화자/구간 오류가 생길 수 있음.
- 즉시 검증 가능한 라벨 포함 오디오로 Voice data 실제 녹음 샘플을 추출. `module-a/scripts/voice_data_export_audio.py` 추가: HF streaming row의 audio bytes를 `soundfile`로 디코딩하고 16kHz wav로 저장하며 manifest/summary를 생성.
- 산출물: `module-a/artifacts/voice-data-audio-sample-v1/audio/*.wav`, `voice_data_audio_manifest.csv`, `voice_data_audio_summary.json`.
- 최초 결과: wav 80개 생성. 이후 5초 미만 파일 27개를 삭제하고 manifest/summary도 갱신. 현재 남은 wav/manifest row는 53개, age distribution은 `18-22` 12, `23-30` 12, `31-45` 14, `46-65` 15, gender distribution은 female 26, male 27.
- 안전 결정: 실제 녹음은 모델 검증용으로만 사용하고 voice cloning에는 사용하지 않는다.

## 2026-05-30 — 5초 이상 Voice data wav 53개 모델 평가

- `module-a/scripts/evaluate_audio_manifest.py` 추가: 로컬 `voice_data_audio_manifest.csv`가 가리키는 wav만 읽어 `tiantiaf/wavlm-large-age-sex` 모델로 추론하고 `filtered_audio_eval.csv`/`filtered_audio_eval_summary.json`을 생성.
- 평가 대상: 5초 미만 삭제 후 남은 wav 53개. 모두 status ok.
- 결과: exact age-bin match 16/53 = 30.19%. target distribution은 `18-22` 12, `23-30` 12, `31-45` 14, `46-65` 15. predicted distribution은 `18-22` 6, `23-30` 17, `31-45` 21, `46-65` 5, `outside` 4.
- target별 match: `18-22` 2/12, `23-30` 4/12, `31-45` 7/14, `46-65` 3/15. 5초 미만 제거 후에도 모델은 `23-30`/`31-45` 쪽으로 몰려 정확한 나이대 분류 성능이 낮음.

## 2026-05-30 — Module C GGUI 연령대별 적응 UI 생성 검증

- 범위 준수: `specs/MODULE_C.md`, `module-c/src/adapt.js`, `module-c/src/contract.js`, `module-c/src/ggui-client.js`, `module-c/server.js`를 읽고 검증만 수행. `module-c`/contracts 코드는 수정하지 않음. 측정 스크립트와 스크린샷만 `tmp/ggui-age-validation/`에 생성.
- 사전 확인: `curl :6781/ggui/health` → `status:"ok"`, tools 28. `curl :8002/health` → `mode:"ggui"`, `has_openai_key:true`.
- 라이브 GGUI 매트릭스: latte 3종 메뉴로 `POST :8002/generate-ui`를 총 14회 실행. 대상은 `sixties/assist3/recommend` 3회, `twenties/assist0/recommend` 3회, `forties/assist1/recommend` 3회, `seventies_plus/assist0/recommend` 3회, `sixties/assist3/options` 1회, `sixties/assist3/confirm` 1회.
- 모든 호출은 `X-GGUI-Path: ggui`였고 local fallback은 없었음. 그러나 모든 `embed_url`이 Playwright headless 렌더에서 HTTP 202 `Generating UI...` placeholder에 머물렀고, 실제 카드/버튼/제목/음성안내 DOM이 생성되지 않음. 결과: rendered 0/14, menu card count 0, button count 0, measured median text 14px(placeholder), senior/youth 화면 동일.
- 판정: FAIL. 이유는 GGUI path 호출 성공과 별개로 실제 사용자 iframe이 렌더 가능한 적응 UI를 받지 못하기 때문. 따라서 시니어 eff3 vs 청년 eff0의 폰트 증가, 카드 2 vs 3, 음성안내 유/무 차이를 실측 증명할 수 없음.
- 추가 소스 리스크: `module-c/server.js`가 HTTP body의 decade bucket을 `body.age_group === "50+" ? "50+" : "under50"`로 정규화함. `adapt.js`의 senior bucket은 `fifties/sixties/seventies_plus`라서, 현재 HTTP 경로에서는 `seventies_plus/assist0`의 기대 eff1 나이 보조가 GGUI prompt까지 보존되지 않을 가능성이 큼.
- 현재 웹 UI(`http://127.0.0.1:5173/`)는 `MOCK` 모드로 확인됨. Playwright로 mock built-in adaptive flow는 recommend → options → confirm → payment까지 완료했고 스크린샷 저장함. 단, 이는 live GGUI iframe 검증이 아니라 React 내장 mock renderer 검증이다.
- 산출물: `tmp/ggui-age-validation/validate_ggui_age_ui.py`, `tmp/ggui-age-validation/results.json`, `tmp/ggui-age-validation/summary.md`, `tmp/ggui-age-validation/screenshots/*`.

## 2026-05-30 — GGUI pending 렌더 차단 및 LOCAL 적응 렌더러를 실데모 경로로 보강

- 사용자 요청: GGUI 서버 로그/렌더 결과상 실제 generation이 돌지 않아 iframe이 `Generating UI...`에 멈추는 문제를 최대한 해결.
- 원인 확인: `@ggui-ai/cli`의 `ggui_push`는 render URL을 먼저 반환할 수 있고, 실제 component code가 준비되지 않으면 `codeReady=false` 상태로 viewer가 placeholder에 머문다. 기존 Module C는 URL 존재만 성공으로 처리해 D에 stuck URL을 넘겼다.
- 조치:
  - `module-c/src/ggui-client.js`: `ggui_push` 응답의 `codeReady`가 `true`가 아니면 실패로 간주해 LOCAL fallback으로 전환.
  - `module-c/server.js`: LOCAL 응답 contract에 `_render_path`, `_profile`(assist/effective age/card_count/font/voice metadata)을 포함.
  - `module-c/src/local-render.js`: 직접 렌더 HTML을 영어 데모 기준으로 정리(`lang=en`, English CTA/confirm/copy, `en-US` TTS). direct C 검증에서 Korean UI text가 남지 않도록 함.
  - `module-d/src/api/client.ts`: `X-GGUI-Path`가 `local*`이면 `embed_url`을 비워 React built-in renderer를 사용. LOCAL iframe의 postMessage bridge에 기대지 않고 기존 orchestrator flow를 유지.
  - `module-d/src/ui/AdaptiveKiosk.tsx`: GGUI embed가 3.5초 넘게 준비되지 않으면 built-in renderer로 전환. built-in renderer도 Module C와 동일하게 senior bucket(`fifties/sixties/seventies_plus`)이면 effective assist를 +1 적용해 카드 수/폰트가 맞게 분기.
- 정정: 직전 검증 메모의 “HTTP body decade bucket이 under50로 정규화된다” 리스크는 현재 `server.js`에서 이미 해소됨. `sixties`, `twenties` 같은 decade bucket은 그대로 `adapt.js`로 전달된다.
- 검증:
  - `node --check module-c/server.js`, `node --check module-c/src/ggui-client.js`, `node --check module-c/src/local-render.js` 통과.
  - `npm --prefix module-d run typecheck` 통과.
  - `npm --prefix module-d run build` 통과.
  - `PORT=8012 GGUI_MODE=local node server.js` direct POST: `sixties/assist2` → `effective_level=3`, `card_count=2`, `base_font_px=30`, `voice_guide=true`, rendered cards=2, Korean visible text=false. `twenties/assist0` → `effective_level=0`, cards=3, `base_font_px=18`, `voice_guide=false`.
  - `PORT=8013 GGUI_MODE=ggui GGUI_URL=http://localhost:6781 node server.js` direct POST: `ggui_push: codeReady=false`를 감지해 `X-GGUI-Path: local-fallback` 반환. D에 stuck `:6781/r/...` URL을 넘기지 않음.
  - Module D dev `http://127.0.0.1:5174/` Playwright smoke: Senior mock flow에서 adaptive `.big-card` count=2, `Age Group sixties`, `assist 2`, payment complete, console error 0. 스크린샷 `tmp/ggui-age-validation/screenshots/module_d_after_fix_paid.png`.

## 2026-05-30 — LOCAL 메인 / GGUI offline-prewarm 경로 고정

- 현재 실행 상태 재확인: 기존 `:8002`에 떠 있던 stale Module C 프로세스는 `X-GGUI-Path: ggui`를 반환했지만 해당 `embed_url`은 HTTP 202 `Generating UI...`에 머물렀다. stale 프로세스를 종료하고 현재 코드의 `GGUI_MODE=local` Module C를 `:8002`에 재기동.
- GGUI 서버 로그/패키지 소스 확인:
  - `ggui serve --mcp-only`는 agent supervision은 끄지만 generation binding 자체는 `generation: openai / openai/gpt-5.5-2026-04-23 (env: OPENAI_API_KEY)`로 잡힌다.
  - `ggui serve --dev-allow-all --port 6791`처럼 `--mcp-only` 없이 띄워도 현재 repo에는 `ggui.json`이 없어 `agent disabled (no ggui.json)`로 동작한다. generation binding은 여전히 OpenAI로 잡히지만 push 결과는 `codeReady=false`.
  - 그럼에도 현재 live push 결과는 새 코드 기준 `codeReady=false`라서 즉시 LOCAL fallback 처리된다.
  - 따라서 문제를 “URL이 있으면 성공”으로 보지 않고 `codeReady`/DOM 렌더 상태를 ground truth로 본다.
- 회귀 테스트 추가:
  - `module-c/tests/ggui-client.test.mjs`: `codeReady=false` 응답은 throw, `codeReady=true` 응답만 `render_id/embed_url`로 정규화.
  - `module-c/package.json`에 `npm test`, 루트 `package.json`에 `test:c`, `verify`, `probe:ggui` 추가.
  - `GGUI_FORCE_CREATE=1` 지원: handshake에 `forceCreate:true`를 실어 blueprint cache를 우회하는 cold generation probe를 할 수 있게 함.
- 데모/문서 정리:
  - `run.sh`, `.env.example`, `module-c/.env.example`, 루트 `README.md`, `module-c/README.md`를 갱신해 `GGUI_MODE=local`을 실시간 데모 메인으로 명시.
  - `scripts/probe-ggui-generation.mjs` 추가: C의 현재 응답이 `ggui`/`local`/`local-fallback` 중 무엇인지 출력하고 `_profile`을 확인.
  - GGUI는 발표 메인 의존성이 아니라 offline/prewarm 실험 경로로 설명. `codeReady=true`일 때만 GGUI embed를 사용한다.
- 최종 검증:
  - `npm run verify` 통과: Module C node:test 2개 pass, Module D typecheck pass, Module D build pass.
  - `npm run probe:ggui` on `:8002` → `path:"local"`, `profile.effective_level=3`, `card_count=2`, `base_font_px=30`, `mode:"demo-safe-local"`.
  - `C_URL=http://localhost:8013 npm run probe:ggui` with `GGUI_MODE=ggui GGUI_FORCE_CREATE=1` → `path:"local-fallback"` and server log `ggui_push: codeReady=false`.
  - Full serve check: `npx -y @ggui-ai/cli@latest serve --dev-allow-all --port 6791` + `C_URL=http://localhost:8014 npm run probe:ggui` also returned `path:"local-fallback"` with `ggui_push: codeReady=false`.
  - Playwright: `http://localhost:8002/r/4P18uoA` renders 2 cards, English CTA, visible Korean text=false, body font 30px. `http://127.0.0.1:5174/` mock senior flow renders 2 adaptive cards and reaches Payment Complete with console error 0.

## 2026-05-30 — 연령대별 UI를 데모 설득력 기준으로 강화

- 사용자 피드백: 기존 적응 UI가 너무 간단해 “연령대별 UI가 실제로 생성된다”는 인상이 약함. 최소 기능형 카드 UI가 아니라 발표자가 바로 보여줄 수 있는 시각 차이가 필요.
- Module C LOCAL renderer:
  - `age-mode-guided`/`age-mode-comfort`/`age-mode-express` body class, 모드 badge, 3-step rail, coach panel, rank pill, primary/secondary card 스타일 추가.
  - senior/high assist는 2-card guided 화면, youth/low assist는 3-card express 화면으로 구조와 시각 밀도가 갈리도록 회귀 테스트 추가.
- Module D built-in renderer:
  - React fallback 화면도 `express`/`comfort`/`guided` 모드로 분기. header, step rail, rank pill, primary card, care panel, richer option/confirm UI를 추가.
  - compare 모드에서는 care panel을 카드 아래로 내려 카드/CTA가 눌리지 않도록 조정.
- 검증:
  - `npm --prefix module-c test` 통과: local render senior guided 2 cards, youth express 3 cards.
  - `npm --prefix module-d run build` 통과.
  - `npm run probe:ggui` on `:8002` → `path:"local"`, `effective_level=3`, `card_count=2`, `base_font_px=30`.
  - Playwright: `http://127.0.0.1:5174/` senior flow는 `Guided senior mode`, adaptive cards=2, care panel visible, options→confirm→Payment Complete 완료. youth flow는 `Express mode`, adaptive cards=3, care panel 없음.
  - Playwright: `http://localhost:8002/r/NIt9hak` Module C local HTML은 `body.age-mode-guided`, cards=2, coach visible.

## 2026-05-30 — 안내 음성은 연령대 목소리가 아니라 중립 아나운서 톤으로 분리

- 사용자 피드백: age-adaptive UI라고 해서 안내 음성이 나이든 사람 목소리처럼 들릴 필요가 없고, 깔끔한 아나운서 목소리가 맞음.
- 원인: Module D TTS는 browser `speechSynthesis`의 첫 `en-US` voice를 잡고 있었고, assist level이 높을수록 `rate`를 낮춰 노인 음성처럼 들릴 수 있었다. Module C local HTML도 guided mode에서 `u.rate=0.9`로 느리게 읽었다.
- 조치:
  - `module-d/src/audio/tts.ts`: assist level과 음색을 분리. preferred announcer-like English voice(`Samantha`, `Ava`, `Allison`, `Karen`, `Google US English`, `Microsoft Aria/Jenny`)를 우선 선택하고, rate는 항상 `1.0`, pitch 기본값은 `1.05`로 조정.
  - `module-c/src/local-render.js`: inline TTS도 같은 preferred voice 후보, `u.rate=1.0`, `u.pitch=1.05`로 변경.
  - `module-c/tests/local-render.test.mjs`: guided local render가 느린 `0.9` rate를 쓰지 않는 회귀 테스트 추가.
- 검증:
  - RED: 신규 테스트가 기존 `u.rate=0.9` 때문에 실패함 확인.
  - GREEN: `npm --prefix module-c test`, `npm run verify` 통과.
  - Playwright init-script로 `speechSynthesis`를 stub해 Module D senior flow의 실제 발화 파라미터가 `lang=en-US`, `rate=1`, `pitch=1.05`, `voice=Samantha`임을 확인.
  - Module C `:8002` 재기동 후 `npm run probe:ggui` → `path:"local"`, `render_id:"LVxje9s"`, `embed_url:"http://localhost:8002/r/LVxje9s"`.

## 2026-05-30 — 실제 키오스크형 before UI와 48개 메뉴 확장

- 사용자 피드백: before UI가 실제 키오스크 같지 않고, 메뉴가 많아 넘겨야 하며 결제수단/포인트/쿠폰 등 복잡한 McDonald's/KFC식 UX가 있어야 after의 노인 친화 적응 의미가 살아남.
- 레퍼런스:
  - 사용자가 KFC 키오스크 사진을 제공. 흐름은 메뉴 선택 → 주문 리스트 → 매장/포장 → 결제수단 선택.
  - 웹 검색으로 McDonald's/패스트푸드 키오스크의 매장/포장 선택, 쿠폰/포인트, 다양한 결제수단, 하단 checkout/좌측 카테고리 이동이 실제 UX 복잡도를 만든다는 점 확인.
- 메뉴/자산:
  - `imagegen` built-in으로 28개 추가 메뉴 contact sheet 생성.
  - `module-b/data/menu.seed.json` 및 `contracts/mocks.json`의 `sampleMenu`를 20개에서 48개로 확장.
  - 카테고리별 수: Coffee 6, Latte 10, Tea 5, Ade 4, Beverage 5, Dessert 18.
  - 새 SVG menu asset 28개 생성 및 `module-b/public/img/menu`, `module-d/public/img/menu`에 반영. Vite mock 화면에서도 실제 상품 사진이 보이도록 Static/Adaptive 이미지 src를 project public asset으로 전환.
- before UI:
  - `module-d/src/ui/StaticKiosk.tsx`: `start → browse → options → review → loyalty → payment → paying → done` 흐름으로 확장.
  - start: Eat In/Take Out 선택.
  - browse: 좌측 카테고리 rail, 6개씩 paging(`Page 1 / 8`), 프로모션/upsell strip, 우측 cart sidebar.
  - checkout: 주문 확인, 수량 조절, 쿠폰/포인트 스캔/전화번호 입력, 결제수단 5개(Credit Card/Gift Card/Kakao Pay/Naver Pay/Pay at Counter), card reader panel.
- after 대비:
  - Adaptive renderer도 mock mode에서 `module-d/public/img/menu` 자산을 사용.
  - `Can I get a latte` 검색이 `can` token 때문에 Americano를 먼저 반환하던 문제 수정. mock/live search에서 `can/get/please/want/like` stopword를 제외해 first recommendation이 Caffe Latte가 되도록 함.
  - mock age bucket을 계약에 맞게 `senior_adult/young_adult`에서 `sixties/twenties`로 정정.
- 검증:
  - `npm run verify` 통과.
  - Playwright before flow: Eat In → 6 visible menu cards, `Page 1 / 8`, real `/img/menu/americano-001.svg` asset, option add, cart, review, loyalty/points, payment screen, 5 payment methods 확인.
  - Playwright after flow: `Guided senior mode`, `Age Group sixties`, 2 cards, first recommendation `Caffe Latte`, real `/img/menu/...` asset 확인.

## 2026-05-30 — 반반 compare 제거 및 full-width 토글 전환

- 사용자 피드백: before/after를 반반으로 동시에 보여주면 실제 키오스크 느낌이 약하고 화면이 작아진다. 상단 토글로 `Standard Kiosk`와 `Adaptive Voice`를 전환하고, 선택된 UI가 전체 폭을 써야 함.
- TDD/검증:
  - Playwright RED: `Standard Kiosk`/`Adaptive Voice` 버튼, `Compare` 제거, `.demo-pane` 1개만 렌더되는 조건을 먼저 실행했고 기존 UI에서 실패 확인.
- 변경:
  - `module-d/src/App.tsx`: `compare` mode 제거. 기본은 `static`, 음성 주문 시작 시 `adaptive`로 전환. topbar toggle은 `Standard Kiosk`/`Adaptive Voice` 2개만 유지.
  - `module-d/src/ui/StaticKiosk.tsx`: full-width에 맞춰 browse page size를 6개에서 8개로 확대.
  - `module-d/src/styles.css`: content max width 확대, pane min-height 760px, pane padding/header 확대, standard body를 full-width 3-column(카테고리 rail / 메뉴 / cart)로 조정, menu grid 4 columns로 확대. responsive에서 3/1 columns로 축소.
- 검증:
  - Playwright single-pane toggle: `Compare` 없음, `.demo-pane` 1개, static→adaptive 전환 시 before pane 제거 확인.
  - Playwright screenshots: `tmp-ui-check/single-before-menu.png`, `tmp-ui-check/single-after-guided.png`.
  - before full-width: 8 menu cards, `Page 1 / 6`.
  - after full-width: `Guided senior mode`, 2 cards.
  - `npm run verify` 통과.

## 2026-05-30 — Standard Kiosk 복잡도 추가 보강

- 사용자 피드백: 키오스크 느낌은 생겼지만 실제 현장 키오스크처럼 사용하기 복잡한 느낌이 아직 부족함.
- TDD/검증:
  - Playwright RED: before browse 화면에서 `.promo-tabs button` 3개, `.filter-strip button` 6개, `.kiosk-utility-bar button` 5개, `.bottom-order-bar`, `.suggestion-lane button` 3개를 기대했고 기존 UI에서 실패 확인.
- 변경:
  - `module-d/src/ui/StaticKiosk.tsx`: browse 상태에 `promoTab`, `quickFilter` 상태 추가.
  - browse UI에 Language/Staff Help/Nutrition/Allergens/Receipt utility bar, Popular/Set Menu/Coupon promo tabs, All/Iced/Hot/New/Sweet/Food quick filters, Add dessert set/Show iced only/Use coupon first suggestion lane, sticky bottom order bar 추가.
  - option 화면도 단순 리스트에서 `Required Options / Set Upgrade / Add-ons` progress, 상품 이미지/가격 요약, 중앙 옵션 패널, 우측 upsell/allergy panel로 재구성.
  - `quickFilter`는 실제로 메뉴 목록을 필터링하고 페이지를 reset함.
- 검증:
  - `npm --prefix module-d run typecheck` 통과.
  - Playwright: complex controls count 통과, options screen progress/upsell/product image 확인.
  - 스크린샷 수동 확인 후 임시 `tmp-ui-check` 삭제.
  - `npm run verify` 통과.

## 2026-05-30 — 검증 데이터 명칭 generic voice data로 정리

- 프로젝트 전반에서 특정 공개 데이터셋 이름을 드러내지 않도록 `voice data` 계열 명칭으로 통일.
- 현재 남긴 산출물은 `module-a/artifacts/voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json` 2개뿐이며 summary dataset/source_manifest도 generic 값으로 변경.
- 관련 스크립트/테스트는 `voice_data_eval.py`, `voice_data_export_audio.py`, `test_voice_data_*.py`로 rename. 대시보드 제목은 `Voice Data Validation`.
- 검증: 프로젝트 검색에서 이전 데이터셋 실명 문자열 0건, Module A unittest 37개 통과, 루트 `npm run verify` 통과.

## 2026-05-30 — voice data 실제 wav 복구

- 사용자 정정: 삭제 요청은 unrelated audio 제거였고 검증용 voice data wav는 필요한 데이터였음.
- `module-a/artifacts/voice-data-audio-sample-v1/audio`에 평가용 실제 wav 53개를 재생성하고, manifest/summary를 53개 기준으로 복구.
- `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`의 `audio_path` 53개가 모두 복구된 wav와 일치함을 확인.
- 현재 보존 artifact: `voice-data-audio-sample-v1` 14M(53 wav + manifest/summary), `voice-data-voxprofile-broad-eval-v1` 16K(eval CSV/summary).

## 2026-05-31 — senior demo/test voice ID 고정

- 사용자 결정: 앞으로 테스트/데모에서 `CwU9JS9865QvUvq5PqPl` voice ID를 사용.
- `module-a/inference/elevenlabs_voice.py`의 기본 `50+` female/male voice pool을 `CwU9JS9865QvUvq5PqPl` 하나로 고정.
- 회귀 테스트 `test_default_senior_test_voice_uses_validated_voice_id` 추가. Module A unittest 38개 통과.

## 2026-05-31 — Standard Kiosk 복잡도 방향 전환

- 사용자 피드백: before UI가 단순한 것은 문제지만, utility/filter/promo/suggestion 버튼을 많이 넣는 방식의 복잡도는 과하고 쓸데없는 요소처럼 보임.
- 결정: before의 복잡도는 버튼 clutter가 아니라 실제 키오스크 사용 흐름의 결정 부담으로 표현한다. 즉 메뉴 탐색 → 옵션 → 주문 확인 → 포인트/쿠폰 → 결제수단으로 화면이 분리되고, 옵션 선택 중 가격이 바뀌는 구조를 강조.
- 변경:
  - `module-d/src/ui/StaticKiosk.tsx`에서 Language/Staff Help/Nutrition/Allergens/Receipt utility bar, Popular/Set/Coupon promo tabs, quick filter, suggestion lane, sticky bottom order bar 제거.
  - Standard browse/options/review/loyalty/payment 화면에 6단계 `decision-rail` 추가: Place, Menu, Options, Review, Points, Pay.
  - options 화면에 `price-change-note`를 추가하고 upsell을 랜덤 CTA 버튼이 아닌 가격 변동 항목으로 정리.
  - `module-d/src/styles.css`에서 decision rail, flow friction note, menu step note, price change note 및 responsive rail 스타일 추가.
- 검증:
  - Playwright RED: 기존 화면에서 `.decision-rail span` 0개로 실패 확인.
  - Playwright GREEN: decision rail 6개, clutter DOM(`.kiosk-utility-bar`, `.promo-tabs`, `.filter-strip`, `.suggestion-lane`, `.bottom-order-bar`) 0개, options progress 3개, price-change note 표시 확인.
  - `npm --prefix module-d run typecheck`, `npm run verify` 통과.

## 2026-05-31 — Optional upgrades 선택/가격 반영 복구

- 사용자 피드백: options 화면의 `Optional upgrades`가 선택되지 않음.
- 원인: 이전 복잡도 정리에서 upsell CTA를 가격 표시용 `.upgrade-row` div로 바꾸면서 click handler, selected state, price delta 계산이 사라짐.
- 변경:
  - `module-d/src/ui/StaticKiosk.tsx`: `Set dessert`, `Large size combo`, `Extra shot`을 button으로 렌더하고 선택/해제 토글 및 selected 스타일을 연결.
  - `unitTotal()`이 item 기본 option뿐 아니라 optional upgrade delta도 합산하도록 수정. 장바구니 option summary에도 선택 upgrade가 표시됨.
  - `module-d/src/api/client.ts` mock order total 및 `module-b/server.js` live order total도 같은 optional upgrade delta를 계산하도록 맞춤.
  - `module-d/src/styles.css`: `.upgrade-row.selected`/hover 스타일 추가.
- 검증:
  - Playwright RED: Extra shot 클릭 후 total이 `₩4,500 → ₩4,500`으로 그대로라 실패 확인.
  - Playwright GREEN: Extra shot 선택 시 total 변경, selected 표시, 재클릭 시 해제 및 원래 total 복귀 확인.
  - Playwright cart/payment flow: Add to Order 후 cart option summary에 Extra shot 표시, checkout/payment complete total이 option total과 일치.
  - `npm --prefix module-d run typecheck`, `npm run verify` 통과.

## 2026-05-31 — UI 기능 스모크 점검 + ElevenLabs 아나운서 나레이션 전환

- 사용자 요청: Optional upgrades 외에도 동작하지 않는 기능이 있는지 테스트/검토/수정. 추가로 현재 음성 나레이션이 AI 같으니 ElevenLabs의 자연스러운 아나운서 톤으로 나오게 변경.
- 기능 점검:
  - Playwright로 Standard browse/category/page, Back to Menu, cart qty +/-/remove, checkout disable, loyalty Earn Points, review/payment back navigation, Naver Pay 선택을 실제 클릭 검증.
  - Playwright로 Adaptive senior/youth flows, option price change, No Change It, Yes Pay, Start Over를 실제 클릭 검증.
- 발견 버그:
  - Adaptive options 단계의 `Choose Again`이 `flow.reset(false)`를 호출해 candidates/analyze를 잃고 빈 adaptive 화면으로 남음.
  - 수정: `Orchestrator.backToRecommendations()`를 추가하고 `Choose Again`이 기존 candidates/analyze를 보존한 채 recommend 단계로 돌아가도록 연결.
- ElevenLabs 나레이션:
  - `module-a/inference/elevenlabs_voice.py`: `DEFAULT_ANNOUNCER_VOICE_ID=21m00Tcm4TlvDq8ikWAM`, `build_announcer_tts_payload()`, `synthesize_announcer()` 추가. 안정적인 뉴스리더 톤을 위해 stability 0.68, similarity 0.82, style 0.12, speaker boost 사용.
  - `module-a/app.py`: `POST /demo/announcer-voice/audio` 추가. 브라우저에서 호출 가능하도록 CORS middleware 추가.
  - `module-d/src/audio/tts.ts`: browser `speechSynthesis` 직접 사용 대신 Module A ElevenLabs announcer mp3를 먼저 요청해 재생하고, 실패 시에만 browser TTS로 폴백.
  - `module-c/src/local-render.js`: standalone LOCAL HTML voicebar도 같은 ElevenLabs announcer endpoint를 먼저 호출하고 실패 시 browser TTS로 폴백.
  - `.env.example`: `ELEVENLABS_ANNOUNCER_*`, `VITE_ELEVENLABS_NARRATION`, `CORS_ORIGINS` 문서화.
- 검증:
  - Playwright RED: 기존 D 나레이션이 `/demo/announcer-voice/audio`를 호출하지 않아 실패 확인.
  - Playwright GREEN: Adaptive 시작 시 ElevenLabs announcer endpoint 호출 확인.
  - Playwright 전체 스모크: Standard 3개 플로우 + Adaptive 4개 플로우 모두 통과.
  - Module A 전체 unittest 40개 통과, Module C node:test 5개 통과, Module D typecheck/build 및 `npm run verify` 통과.
  - Module A 재기동 후 `/health`에서 `elevenlabs_ready:true` 확인. 실제 `POST /demo/announcer-voice/audio` 호출이 200으로 36,824 byte mp3 생성, CORS OPTIONS preflight도 200 통과.

## 2026-05-31 — GGUI 멀티턴 주문 플로우 확장

- 사용자 요구: GGUI가 최초 연령대 분석 후 추천 화면만 바꾸는 수준이 아니라, 발화가 이어질 때마다 `연령대 + 현재 주문 상태 + 현재 단계`를 바탕으로 UI를 다시 생성해야 함. 데모 고정 스크립트만이 아니라 라이브 데모에서도 "라떼 → 바닐라 라떼 → 아이스 큰 사이즈 → 포장 → 포인트 skip → 카드 → yes"처럼 단계별 partial utterance를 처리해야 함.
- 계약 확장:
  - `contracts/types.ts`, `contracts/schemas.py`에 `AdaptiveStep = recommend/options/fulfillment/loyalty/payment/confirm`, `AdaptiveOrderState`, `possible_actions` 추가.
  - Module D가 매 `generateUI` 호출마다 `order_state`, `possible_actions`, `step`, `menu_context`를 전달.
- Module D:
  - `module-d/src/flow/voiceIntent.ts` 추가. rule+fuzzy 기반 intent 분류로 `select_item`, `set_options`, `fulfillment`, `loyalty`, `payment`, `confirm`, `change`, `cancel` 처리.
  - `Orchestrator`를 `recommend → options → fulfillment → loyalty → payment → confirm → done`으로 확장. 옵션 발화(`iced large`) 후 바로 fulfillment 화면으로 이동하도록 조정.
  - `AdaptiveKiosk`에 fulfillment/loyalty/payment/review 단계 UI와 `.voice-turn-input` 텍스트 음성 시뮬레이터 추가. 최종 confirm 화면에도 mixed-mode 입력을 노출해 `yes` 발화로 결제 완료 가능.
  - local iframe `ggui-local` postMessage action도 `selectMenu/selectOption/setFulfillment/setLoyalty/setPayment/confirmYes`로 받아 touch path와 연결.
- Module C/GGUI:
  - `server.js`, `contract.js`, `ggui-client.js`, `local-render.js`, `adapt.js`를 6단계 플로우로 확장.
  - GGUI prompt/props에 `Current step`, `Order state JSON`, `Possible actions`를 포함하고, local fallback도 fulfillment/loyalty/payment/final review 화면을 렌더.
- 검증:
  - Module C node:test 13개 통과. 새 contract/local-render 테스트가 6단계 action과 order context props를 확인.
  - `npm --prefix module-d run typecheck` 통과.
  - Playwright 멀티턴 실사용 시나리오 통과: `vanilla latte → iced large → take out → skip points → credit card → yes`, 최종 summary `Take Out | No points | Credit Card`, `Payment Complete!` 확인.
  - 최종 `npm run verify` 통과.

## 2026-05-31 — Adaptive demo age selector 제거

- 사용자 피드백: Younger 사용자는 애초에 일반 키오스크를 쓸 가능성이 높고, 데모에서 Senior/Younger를 사용자가 직접 고르는 방식은 의미가 없음.
- 결정: user-facing demo에서 `Senior (Slow) / Younger (Fast)` mock selector를 제거. Adaptive 진입은 음성 주문 버튼 하나로 유지하고, mock 기본값은 senior_adult slower speech로 고정.
- 라이브/제품 논리: 사용자는 나이를 선택하지 않는다. Module A가 음성에서 age/assist signal을 분석하고, 필요할 때 adaptive UI를 보여주는 구조가 맞음.
- 개발 편의: hidden query `?variant=youth`로만 youth mock을 강제할 수 있게 유지.
- 변경: `module-d/src/App.tsx`, `module-d/src/styles.css`.
- 검증: `npm --prefix module-d run typecheck`, `npm --prefix module-d run build` 통과.

## 2026-05-31 — Module A 데모 한국어 전환 + 한국어 voice set validation 재생성

- 사용자 피드백: 데모 관객이 한국인이므로 Module A `/demo`는 영어 주문/영어 라벨보다 한국어 주문문과 한국어 UI copy가 적합함.
- 변경: `module-a/static/demo.html`의 title, stamp, field labels, buttons, status, validation panel, experiment log, dynamic gender/language/match 표시를 한국어로 정리. 기본 language는 `ko`, 기본 프롬프트는 한국어 주문문만 사용.
- validation artifact: `module-a/artifacts/elevenlabs-demo-voice-set-validation-v1/`를 선택된 6개 ElevenLabs demo voice로 재생성. 문장: `아이스 라떼 하나랑 쿠키 하나 주문할게요.`
- 결과: WavLM broad group 기준 `6/6 (100%)`; young_adult 2, adult 2, senior_adult 2 모두 target과 일치. 실제 음성 참고 지표는 `12/14 (86%)`.
- 검증: `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 45개 통과. live `/demo/batch-summary`도 한국어 note와 `6/6 (100%)` 반환.

## 2026-05-31 — Module A `/demo` 실시간 UI 제거 + 성능 이미지 생성

- 사용자 결정: Module A `/demo`는 음성 생성/성능 대시보드 화면으로 발표에 쓰지 않음. 연령대별 음성 생성은 계속 필요하므로 API/분석 코드는 삭제하지 않는다.
- 변경: `module-a/static/demo.html`을 실시간 UI가 없는 내부 안내 페이지로 축소. 라이브 컨트롤, audio player, experiment log, validation chart, `/demo/generate-and-analyze` fetch, `/demo/batch-summary` fetch를 HTML에서 제거.
- 한국어 글꼴: 안내 페이지는 `Pretendard`, `Apple SD Gothic Neo`, `Noto Sans KR`, `Malgun Gothic`, system sans-serif 순서로 사용.
- 성능 표시용 asset: imagegen built-in으로 `module-a/static/generated/voice-age-validation-performance.png` 생성. 포함 지표는 demo voice set `6/6 (100%)`, 실제 음성 참고 `86%`, WavLM broad age group 기준.
- 검증: `tests/test_demo_static.py`에 `/demo` decommission 회귀 테스트 추가. Module A unittest 46개 통과. live `/demo/random-age-voice` 호출로 연령대별 voice selection API 유지 확인.

## 2026-05-31 — Module A `/demo` 웹 페이지 서빙 중단

- 사용자 결정: `/demo`를 안내 페이지로도 서버에서 띄울 필요가 없음. Module A는 연령대별 음성 생성/분석 API만 담당.
- 변경: `GET /demo` route와 `module-a/static/demo.html` 삭제. `FileResponse` import 제거. README/NEXT_TASKS에서 `/demo` 웹 대시보드 안내를 API-only 설명으로 수정.
- 보존: `/demo/random-age-voice`, `/demo/random-age-voice/audio`, `/demo/generate-and-analyze`, `/demo/batch-summary`, `/demo/announcer-voice/audio`는 그대로 유지. 정적 성능 PNG는 `module-a/static/generated/voice-age-validation-performance.png`.
- 검증: `module-a/tests/test_demo_routes.py` 추가. `GET /demo` 404와 `/demo/random-age-voice` 정상 응답을 고정. Module A unittest 45개 통과. tmux `oba-module-a` 재기동 후 live `GET /demo` 404 및 voice API JSON 응답 확인.

## 2026-05-31 — Module A 정적 이미지/미사용 artifacts 최종 정리

- 사용자 요청: 성능 이미지와 폴더를 없애고 `module-a/artifacts`에서 현재 쓰지 않는 산출물 삭제.
- 삭제: `module-a/static/` 전체, `voice-age-validation-performance.png`, 정적 `/static` mount 코드. artifact에서는 후보 탐색/개별 테스트/원본 wav 보관 폴더(`elevenlabs-label-validation-v1`, `elevenlabs-low-age-validation-v1`, `voice-id-classification-v1`, `voice-data-audio-sample-v1`)와 demo validation audio subfolder를 삭제.
- 보존 artifact: `elevenlabs-demo-voice-set-validation-v1/results.csv`, `summary.json`, `voice-data-voxprofile-broad-eval-v1/filtered_audio_eval.csv`, `filtered_audio_eval_summary.json` 총 4개 파일만 남김.
- 코드 정리: `app.py`에서 `StaticFiles`, `STATIC_DIR`, old synthetic batch fallback path 제거. README는 cleaned local artifact set 기준으로 수정.
- 검증: Module A unittest 48개 통과. live 재기동 후 `/demo` 404, `/static/generated/voice-age-validation-performance.png` 404, `/demo/batch-summary` `available=True/evaluation_label=elevenlabs_validated_demo_voice_set/broad_match=6/ok=6`, `/demo/random-age-voice` senior female voice ID 정상 확인.

## 2026-05-31 — Korean senior proxy bridge + comparison demo resumed

- 목표: 기존 키오스크 결제 방식만 먼저 크게 보여준 뒤, 한국어 음성 주문을 영어 senior proxy voice로 bridge해 현재 영어 age model 데모 환경에 맞춰 분석하고, 이후 좌우 비교에서 기존 복잡 흐름과 adaptive UI를 함께 보여주는 해커톤 시연 흐름 완성.
- 시작 상태: 워크트리에 기존 변경이 많이 섞여 있어 되돌리지 않기로 함. `module-a/inference/elevenlabs_voice.py`의 `build_english_order_proxy()`와 해당 unit test는 이미 들어가 있었고, 지정된 `test_elevenlabs_voice.py`는 시작 시 통과.
- 다음 작업: proxy analyze route, Module D client/orchestrator 연결, proxy audio 재생/trace, standard-only/adaptive-compare 화면 구조, Playwright 시나리오 검증을 TDD로 추가.
- 구현:
  - Module A `POST /demo/korean-senior-proxy/analyze` 추가. 입력 한국어 주문을 `build_english_order_proxy()`로 영어 proxy 주문문으로 바꾸고, `choose_age_voice("50+", language="en", gender)`로 검증된 senior voice를 선택해 ElevenLabs mp3 생성 후 age model/behavioral 분석을 반환한다. ElevenLabs 키 없음은 503으로 명확히 반환.
  - `build_english_order_proxy("라떼 한 잔 주세요")`가 `I would like a latte, please...`로 자연스러운 관사를 쓰도록 수정.
  - Module D `analyzeKoreanSeniorProxy()` client 추가. mock mode에서는 실제/Playwright route가 있으면 먼저 호출하고 실패하면 로컬 mock 결과로 폴백해 브라우저 데모가 깨지지 않게 함.
  - Orchestrator 시작 흐름을 한국어 proxy bridge로 전환. proxy mp3 base64가 있으면 브라우저에서 재생하고, 결과 trace를 상태에 보존한다. 이후 기존 adaptive multi-turn 흐름은 그대로 `vanilla latte -> iced large -> take out -> skip points -> credit card -> yes`로 결제 완료까지 동작.
  - App 화면 구조를 `standard-only` 초기 화면과 `adaptive-compare` 비교 화면으로 정리. visible Senior/Younger selector는 노출하지 않음.
  - `StandardComparisonKiosk`를 추가해 adaptive 단계에 맞춘 기존 키오스크의 복잡한 같은 단계(메뉴/옵션/포장/포인트/결제/확인)를 왼쪽에서 보여준다.
  - proxy trace에는 Korean input, English proxy utterance, Senior demo voice, Age model result와 "현재 영어 age model 데모 환경용 bridge" 설명만 표시해 실제 한국어 화자 나이 추정처럼 과장하지 않게 함.
- 검증:
  - RED: 새 Module A route tests가 404로 실패, Playwright story가 proxy call 0으로 실패, 관사 regression이 `an latte`로 실패하는 것을 확인.
  - GREEN: Module A unittest discover 48개 통과, Module C node:test 13개 통과, Module D typecheck/build 통과, `npm run verify` 통과.
  - Playwright: 첫 화면 adaptive pane 없음, Start Voice Order 후 proxy route 호출/trace 표시/좌우 pane 표시/frame 크기 확인, multi-turn Payment Complete까지 통과.
  - 시각 확인: Playwright screenshot에서 왼쪽 기존 kiosk frame이 비교 화면에서도 작게 무너지지 않고, 오른쪽 adaptive senior UI가 clipping 없이 표시되는지 확인.

## 2026-05-31 — 데모 표면의 bridge/proxy/model 설명 제거

- 사용자 피드백: 데모에서 "한국어를 영어로 바꾸고..." 같은 기술 설명/나레이션은 필요 없고, 실제 키오스크 사용 중 나올 법한 문구만 보여야 함.
- 변경:
  - Module D 화면에서 proxy trace, `Korean order -> English senior proxy bridge`, `English proxy utterance`, `Senior demo voice`, `Age model result`, Module endpoint footer, MOCK badge, `Analyze (A)`, `Adaptive UI (C)`, generation/signal debug banner를 제거.
  - adaptive 화면의 내부 English proxy transcript 노출을 없애고, `I found menu items for your order.`, `Choose the options you want.` 같은 키오스크용 안내 문구로 대체.
  - bridge 설명 음성 안내를 제거하고, 시작/분석/추천 안내를 `Listening for your order...`, `Preparing your order screen...`, `Here are the best matches. Please choose one.`으로 변경.
  - `Guided senior mode` 같은 내부 모드명은 `Easy order mode`로 교체.
- 검증:
  - Playwright RED: bridge/proxy/model copy가 6개 노출되어 실패 확인.
  - Playwright GREEN: proxy route 호출은 유지하되 UI에 bridge/proxy/model/debug 문구가 보이지 않고 Payment Complete까지 통과.
  - `npm --prefix module-d run typecheck`, `npm run verify` 통과.

## 2026-05-31 — 학습/검증/생성 산출물 정리

- 사용자 결정: AIHub 직접 학습 경로와 `models/age_model`, `module-a/artifacts`는 현재 데모에서 쓰지 않으므로 삭제.
- 삭제 범위: `module-a/training`, `module-a/models`, `module-a/artifacts`, `remote/`, standalone `tools/voicegen`, `specs/VOICEGEN.md`, Module A batch/eval/voice-data/VoxCeleb scripts와 대응 테스트, menu imagegen contact sheet PNG, `dist`/`tmp`/`test-results`/`.run-logs`/`__pycache__`/`.DS_Store`.
- 코드 정리: `/demo/batch-summary` route와 artifact CSV/JSON loader 제거. `create_age_model("local")` fallback 제거. `AGE_MODEL_PATH` env 제거. 현재 provider는 `wavlm_age_sex`만 지원.
- 문서 정리: root README, Module A README, SPEC, PIPELINE, specs/MODULE_A, specs/README, specs/INTEGRATION을 현재 runtime-only 방향으로 갱신.
- 검증: Module A unittest 32개 통과, `py_compile` 통과, `npm run verify` 통과. 메뉴 seed 48개 image_url은 module-b/module-d public asset 모두 missing 0개 확인.

## 2026-05-31 — 실제 한국어 음성 STT + proxy 재생 voice 선택 + Whisper API 전환

- 사용자 피드백:
  - Start Voice Order가 고정 텍스트처럼 보여 실제 목소리를 인식하지 않는 것 같다고 지적. 데모는 사용자의 한국어 음성을 먼저 STT하고, 그 텍스트를 영어 senior proxy TTS로 만든 뒤 관객이 들을 수 있게 재생하고 age/adaptive 분석으로 넣어야 함.
  - 데모 표면에는 bridge/proxy/model 설명을 보이지 않게 유지하되, proxy TTS 재생 목소리는 여러 개 선택할 수 있어야 함.
  - 로컬 `faster-whisper` 대신 OpenAI Whisper API를 쓰기로 결정.
- 변경:
  - Module D `startVoiceOrder()`는 녹음 지원 브라우저에서 실제 `MicRecorder`를 시작하고, Stop 시 녹음 Blob을 `POST /analyze`로 보내 STT 결과를 얻는다. mock mode에서도 이 경로만 `forceLive`로 실제 `/analyze`를 먼저 호출한다.
  - STT 결과 한국어 transcript를 `POST /demo/korean-senior-proxy/analyze`에 전달하고, 선택된 proxy voice의 mp3 base64를 실제 브라우저 audio로 재생한 뒤 adaptive flow를 시작한다.
  - Module D에 `Voice 1`/`Voice 2` 선택 UI를 추가. 각각 검증된 senior female `wGcFBfKz5yUQqhqr0mVy`, senior male `pqHfZKP75CvOlQylNhV4` voice id로 매핑하고, Module A route는 허용된 validated voice id만 받는다.
  - Module A STT 기본값을 `STT_MODEL=whisper-1`, `STT_LANGUAGE=ko`로 변경하고 `OpenAIWhisperSTT` 어댑터를 추가. `STT_MODEL=local:small`처럼 명시할 때만 기존 faster-whisper 경로를 사용한다.
  - `.env.example`, `module-a/README.md`, `module-a/run_local.sh`, `module-a/requirements.txt`를 OpenAI Audio Transcriptions API 기준으로 갱신하고, 현재 `.venv`에는 `ensurepip` 후 `openai==2.38.0` 설치.
- 검증:
  - TDD RED: `OpenAIWhisperSTT` import 실패와 voice 선택 Playwright 실패를 먼저 확인.
  - GREEN: `PYTHONPATH=module-a module-a/.venv/bin/python -m unittest module-a/tests/test_stt_config.py -v` 6개 통과.
  - `PYTHONPATH=module-a module-a/.venv/bin/python -m py_compile module-a/inference/stt.py module-a/app.py` 통과.
  - `npm run verify` 통과: Module C node:test 13개, Module D typecheck/build.
  - Playwright `module-d/tests/korean-proxy-demo.spec.mjs` 통과: 초기 standard-only, Voice 2 선택, fake mic Stop 후 `/analyze` 호출, proxy body에 한국어 transcript와 male voice id 전달, Payment Complete까지 확인.
  - 참고: 기존 `module-a/tests/test_demo_routes.py`에는 `/demo/batch-summary`를 404로 기대하는 오래된 테스트가 남아 현재 앱의 실제 200 route와 충돌해 실패한다. 이번 STT 변경과 직접 관련 없음.

## 2026-05-31 — GGUI live generation 경로 점검

- 사용자 의심: adaptive UI가 실제 GGUI로 생성되는 느낌이 아니라 이미 있는 UI를 보여주는 느낌이라고 지적.
- 확인: 기존 실행 상태에서 Module C `/health`는 `mode=local`이었고 Module D는 mock 환경으로 떠 있어 실제 GGUI live generation이 아니었다.
- 조치: tmux로 A/B/C/D와 GGUI CLI 서버를 재기동. 현재 A는 `STT_MODEL=whisper-1`, B는 `items=48`, C는 `GGUI_MODE=ggui`, D는 `VITE_USE_MOCK=false`, GGUI CLI는 `127.0.0.1:6781`에서 실행 중.
- 추가 확인: C `/generate-ui` 직접 호출 시 GGUI MCP의 `ggui_new_session`, `ggui_handshake`, `ggui_push`는 success로 호출되지만 `ggui_push` 응답이 계속 `codeReady=false`라 Module C가 local fallback HTML을 반환한다. `GGUI_FORCE_CREATE=1`과 GGUI CLI에 `module-c/.env.local`의 `OPENAI_API_KEY` 주입까지 해도 동일.
- 결론: 현재 상태는 "GGUI 서버/MCP 호출은 성공하지만 렌더 가능한 GGUI 생성 코드가 준비되지 않아 fallback 표시"다. 화면에 보이는 adaptive UI는 여전히 local fallback이며, 실제 GGUI-generated UI 표시 성공 상태는 아니다.

## 2026-05-31 — 전체 계획 재확인 + 코드/문서 정합 점검 (실행 보류, 정리만)

- 목적: 여러 차례 계획 수정을 거친 뒤 "최종 목표 상태"를 사용자와 함께 재확인. 원칙은 **코드 = 기준 진실(최신)**, 일부 명세 문서는 옛 계획에 멈춰 있음.
- 사용자 검토로 확정된 방향(이전 정리에서 빗나갔던 부분 교정):
  1. **GGUI 라이브 = 데모 메인이자 목표**. LOCAL 적응 렌더러는 사고 대비 폴백일 뿐 메인이 아니다. 따라서 `ggui_push` `codeReady=false`는 "강등 사유"가 아니라 **반드시 풀어야 할 1순위 블로커**. (일부 문서/MEMORY의 "LOCAL이 메인, GGUI 강등" 서술은 현실 타협 기록이지 목표가 아님)
  2. **STT = `whisper-1`(OpenAI Whisper)** + **나이 = `wavlm_age_sex`(WavLM)**. faster-whisper·audeering 아님. (`.env: STT_MODEL=whisper-1`, `AGE_MODEL_PROVIDER=wavlm_age_sex`로 코드 확인)
  3. **Module C 두뇌 LLM = OpenAI** (`GGUI_MODEL=openai:gpt-5.5-2026-04-23`, Responses API). `PLAN.md`의 "Claude API" 표기는 무효.
  4. **Module D = open-design으로 UI/UX 이미 완성** — `module-d/src/App.tsx` 단일 구조 + `dist/` 빌드까지 완료. 추가 작업 없음. (specs/MODULE_D.md가 기술하는 잘게 쪼갠 React 구조 flow/·api/·audio/·ui/ 는 옛 프로토타입)
  5. **컨셉**: generative로 화면을 만들어 누구에게나 UI를 제공하되 **주 고객은 어르신**. before/after·세대 대비(어르신 vs 청년) 데모 유지 OK. 적응 주축 = 행동신호 `assist_level`, 나이는 보조.
- 코드는 최신이나 아래 문서/설정이 코드를 못 따라감(= 정합 대상, 기능 영향 없음):
  - `specs/MODULE_A.md`·`module-a/README.md`: audeering·`/api/stt·infer·tts` 3엔드포인트로 기술 → 실제는 단일 `/analyze` + whisper-1 + WavLM.
  - `specs/MODULE_D.md`·`module-d/README.md`: 옛 React 구조 + "open-design 미완"으로 기술 → 실제 완성.
  - `MENU_DATA_SPEC.md`: "약 20개" → 실제 seed 48개(latte 10).
  - `module-b/README.md`: 한국어 분식카페 → 실제 영어 OBA Cafe.
  - `specs/CONTRACTS.md` 등 여러 문서: `50+`/`under50` 이진 라벨 예시 → 정본 `contracts/types.ts AgeGroup`은 영어 decade taxonomy(이진 없음).
  - `PLAN.md`: "Claude API" → OpenAI.
  - `contracts/types.ts` 주석/예시가 옛 한국어(`"라떼 하나 주세요"`, `latte-001`, `온도/사이즈`) — 타입 자체는 최신, 주석만 cosmetic stale.
- **데모 핵심 메커니즘 (korean-senior-proxy 브리지)** — 해커톤 현장엔 실제 노인이 없고 나이분류 WavLM이 영어 기반이라 한국어 음성을 그대로 분석하면 안 됨. 그래서: 발표자가 **한국어로 발화 → STT(ko) → `build_english_order_proxy()`로 영어 주문 문구 변환 → ElevenLabs senior voice(female `wGcF…`/male `pqHf…`)로 영어 음성 합성 → 이 영어 음성을 WavLM이 인식(senior 판정 + assist_level, 영어 proxy 문구에 "large text" 포함 시 assist≥2 보장) → 결과(age·assist·transcript)를 GGUI에 넣어 적응 UI 생성**. "노인이 영어로 주문한 것"처럼 보여주는 브리지. (`/demo/korean-senior-proxy/analyze`, app.py:212-269)
  - 음성을 굳이 **영어로 합성하는 이유** = WavLM이 영어 모델이라 한국어 음성은 제대로 인식 못 함. 영어 음성이어야 나이 인식이 정확해짐.
  - 따라서 `module-a/.env` `STT_LANGUAGE=ko`는 **미스가 아니라 의도** — 입력 발화가 한국어이기 때문. (이전 정리의 "STT 영어 정합 필요" 지적은 철회)
  - `elevenlabs_voice.py`의 `50+`·senior voice id 매핑은 잔재가 아니라 이 proxy의 voice 선택용(의도). 실제 proxy 텍스트는 `build_english_order_proxy`로 영어 변환되므로 한국어 DEFAULT_TEXT는 fallback.
  - ⚠️ **`build_english_order_proxy`는 의도상 "진짜 번역기"여야 하는데 현재 코드는 키워드 룰 템플릿**(elevenlabs_voice.py:216). 라떼/아메리카노/바닐라/카푸치노 + 아이스/큰/포장만 if 매핑하고 미스 시 무조건 `latte`로 수렴 + 고정 문구 부착 → 자유 발화를 번역 못 함. **이건 코드가 최신 의도를 못 따라간 갭 = 고칠 대상**(한국어 발화를 그대로 영어로 번역하도록, 예: OpenAI 번역). (이전에 "매핑 안 음료로만 말하라"던 데모 팁은 철회)
- 정정된 사실: `ggui.json`은 부재가 아니라 **`servers/ggui/ggui.json`에 이미 존재**. GGUI 라이브 블로커는 파일 부재가 아니라 cold generation `codeReady=false` 하나로 좁혀짐.
- **STT는 OpenAI Whisper API(`whisper-1`)로 확정·운영 중 — torch/whisper 로컬 설치 불필요.** `stt.py`의 `from faster_whisper import WhisperModel`은 `STT_MODEL=local:...`로 명시할 때만 타는 죽은 경로, 운영 기본은 API. torch는 STT가 아니라 **오직 나이모델(WavLM, age.py:49)용**. (이전 정리에서 "torch/whisper 설치 필요"라 STT를 끌어들인 것은 오류, 철회)
- **실모델 의존성은 이미 `.venv`에 설치됨**(워크플로우 분석의 "미설치, mock만" 보고는 오류): torch **2.12.0** / transformers **5.9.0** / openai 2.38.0 / faster-whisper 1.2.1 / librosa 0.11.0 / huggingface-hub 설치 확인. (단 `peft` 미설치 — WavLM 실로드 시 필요할 수 있어 점검 대상)
- 남은 실작업(정합 아님, 별도 지시 시 진행): ① GGUI `codeReady=true` 만들기(**1순위 — proxy 흐름의 마지막 "GGUI 적응 UI 생성" 단계가 여기서 막힘**) ② **`build_english_order_proxy`를 키워드 룰 → 진짜 번역기로 교체** ③ 라이브 결선(`VITE_USE_MOCK=false`)으로 골든 플로우(한국어발화→STT→영어번역→senior voice 합성→WavLM→GGUI→결제) 1회 검증.
- 이번 세션은 사용자 지시로 **정리만, 실제 코드/문서 수정 없음**.

## 2026-05-31(이어서) — 코드=진실 기준 stale 문서 정합 + 3:30 컷오프 보호

- 배경: 코드가 제 기억보다 앞서 있었음(`build_english_order_proxy`는 이미 OpenAI 실번역 `translate_korean_order_to_english`로 교체됨, GGUI 3버그도 이미 수정, local-render 영어화 완료, contracts 옛 라벨 grep 0건, module-d는 App.tsx 단일이 아니라 React 구조 활발히 개발 중). → 디스크 코드를 유일 기준 진실로 재설정.
- 절차: (1) 17개 문서를 코드와 대조 감사(워크플로우) → `.run-logs/audit-result.json` 저장. (2) 수정 워크플로우 1차 실행 → **사용자 지시로 중단**. (3) 그 1차가 이미 12개 파일을 덮어쓴 것 확인 → transcript의 Edit 61건을 **역치환(new→old)으로 전부 복원**(실패 0).
- ★3:30 컷오프 규칙(사용자 지시 "2026-05-31 03:30 이후 수정된 파일은 놔둬라"):
  - 보호 대상(수정 금지, 사용자가 3:30 이후 직접 작업): `README.md`(mtime 03:33), `PLAN.md`, `specs/MODULE_A.md`, `module-a/README.md`, `module-c/README.md`, `contracts/README.md`. (git diff로 커밋 05-30 21:03 이후 사용자 작업 내용 확인됨 — 예: MODULE_A 전면 영어 재작성, module-a/README STT whisper-1 반영, module-c/README LOCAL 프레이밍, contracts/README 라벨 senior_adult화)
  - 수정 대상(안전, 11개): `NEXT_TASKS.md`,`SPEC.md`,`PIPELINE.md`,`specs/INTEGRATION.md`(3:30 이전 mtime) + `module-b/README.md`,`specs/CONTRACTS.md`,`specs/MODULE_C.md`,`specs/MODULE_D.md`,`MENU_DATA_SPEC.md`,`module-d/README.md`,`specs/MODULE_B.md`(커밋 후 사용자 변경 없음).
- 2차 수정 워크플로우(안전 11개 한정) 실행 → **84건 수정 적용**. 주요 정합: 메뉴 20→48개(latte 10), AgeGroup 이진(50+/under50)→12값 taxonomy(mock elder=sixties/youth=twenties/req=senior_adult), AdaptiveStep 3→6단계, GGUI/LOCAL 프레이밍 역전 교정(GGUI 라이브=메인/목표, LOCAL=폴백, 현재 codeReady=false 블로커로 임시 LOCAL), MODULE_C §9의 'GGUI 버그 미수정·실연결 0회'→'3버그 수정완료, ggui_render(alpha) 우선/ggui_push 폴백', MODULE_D의 'open-design 대체'→'React 정본 활발 개발', NEXT_TASKS T7/T8 완료 표기, STT 'small 기본'→'whisper-1(API) 기본'.
- 검증: 2차 워크플로우는 **코드 파일(.ts/.py/.js) Edit 0건(Read만)**, 금지 6개 Edit 0건, 수정 11개 옛 라벨/수치/Claude 잔존 grep 0건. `npm run verify` 통과(module-c 26 tests PASS, module-d typecheck+build OK).
- 백업: 1차 워크플로우 수정본 `.run-logs/wf-overwrite-backup/*.wf-modified`, 감사 결과 `.run-logs/audit-result.json`.
- 교훈: 사용자가 동시에 코드/문서를 작업 중일 때 mtime 컷오프를 먼저 확인하고 워크플로우 대상에서 제외해야 함. 워크플로우가 덮어써도 transcript Edit 역치환으로 복원 가능.

## 2026-05-31 — proxy 문장 UI 지시 제거 + adaptive 후속 음성 수리

- 사용자 피드백: 음성에 `large text` 같은 UI 지시가 들어가면 안 되며, UI 적응은 목소리 나이/assist 분석 결과가 GGUI input으로 들어가 결정되어야 한다. 첫 주문 뒤 후속 음성도 상단 마이크에서 이어져야 한다.
- 변경:
  - Module A `build_english_order_proxy()`에서 `Please guide me slowly with large text.`를 제거하고 주문 의미만 영어로 유지.
  - senior default text에서도 `large text`/`guide me` 제거.
  - `/demo/korean-senior-proxy/analyze`의 senior 보조 레벨 상승은 문구 매칭이 아니라 `age.group == "senior_adult"`로 판단.
  - Module D mock proxy 문장도 동일 정책으로 수정.
  - 상단 마이크는 adaptive 상태에서 `Speak Next`로 바뀌고 `flow.respeak()`를 호출.
  - Orchestrator는 `recordingTurn` 플래그로 최초 주문 녹음과 후속 녹음을 구분해 Stop 시 후속 녹음이 proxy pipeline을 다시 타지 않게 함.
- 검증:
  - Module A targeted unittest 19개 통과.
  - Module D build 통과.
  - Playwright `module-d/tests/korean-proxy-demo.spec.mjs` 통과.
  - live proxy: `라떼 주문해줘` -> `I would like a latte, please.`, `age_group=senior_adult`, `assist_level=2`.
  - live 브라우저: 첫 주문 proxy 1회, 후속 `Speak Next` 후 `/analyze` 총 2회/ proxy 1회 유지, GGUI iframe 1개, `large text` 노출 없음.

## 2026-05-31 — GGUI recommend 단계 전체 메뉴 catalog 전달

- 결정: 번역 결과가 메뉴 DB의 영어 표기와 어긋나 검색 누락이 생길 수 있으므로, 해커톤에서는 recommend 단계 GGUI 입력에 메뉴 전체를 전달한다.
- 변경:
  - Module D `generateForStep()`에서 recommend 단계 `menu_context`는 `this.menu.items` 전체로 전달.
  - Module C GGUI 경로는 recommend 단계에서 전체 `menu_context`를 props/prompt에 유지.
  - GGUI prompt에 `Menu catalog JSON`을 포함하고 catalog 내 메뉴만 사용, best N 카드만 표시하도록 명시.
  - `buildGguiProps()` export + 테스트 추가.
- 검증:
  - Module C test 18개 통과.
  - Module D typecheck/build 통과.
  - Playwright Korean proxy demo 통과, 첫 `/generate-ui` 요청 `menu_context.length > 40` 확인.
  - Module C live 서버 재시작 및 `/health` 확인.

## 2026-05-31 — `build_english_order_proxy`를 OpenAI 번역기로 교체

- 목표: 기존 키워드 룰(`라떼` fallback)이 한국어 자유 발화를 못 번역하므로, `build_english_order_proxy()`를 실제 한국어→영어 번역 경로로 교체.
- 변경:
  - Module A `inference/elevenlabs_voice.py`에서 라떼/아메리카노/바닐라/카푸치노 하드코딩 파서를 제거.
  - `translate_korean_order_to_english()` 추가: OpenAI Responses API를 호출해 한국어 카페 주문 발화를 자연스러운 영어 주문 1문장으로 번역. 기본 모델은 `ORDER_TRANSLATION_MODEL=gpt-4.1-mini`.
  - 번역 프롬프트는 메뉴명·수량·온도·사이즈·포장/매장 의도를 보존하고, `large text`/`guide me` 같은 UI 지시나 나이 단서를 추가하지 않도록 고정.
  - `OPENAI_API_KEY`가 없거나 번역 실패/빈 응답이면 `OrderTranslationError`(503 경로)로 명확히 실패.
  - `.env.example`, `module-a/.env.example`, README/spec에 `OPENAI_API_KEY`가 Module A 번역에도 필요하고 `ORDER_TRANSLATION_MODEL`을 쓴다는 점을 반영.
- 테스트/검증:
  - TDD RED: `유자차 하나랑 소금빵도 같이 부탁드려요`가 기존 코드에서 `I would like a latte, please.`로 실패하는 것을 확인.
  - Unit: fake OpenAI client로 자유 발화가 `yuzu tea`/`salt bread`를 포함하고 `latte` fallback이 사라지는지 검증.
  - Route tests는 번역을 mock 처리해 네트워크 없이 `/demo/korean-senior-proxy/analyze`의 TTS/age 흐름만 검증하도록 분리.
  - `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 35개 통과.
  - `.venv/bin/python -m py_compile app.py inference/*.py tests/*.py` 통과.
  - live smoke(현재 dotenv 로드 순서 기준): `유자차 하나랑 소금빵도 같이 부탁드려요` -> `One yuzu tea and one salt bread, please.` 확인.

## 2026-05-31 — step-aware menu grounding 레이어 도입

- 목표: GGUI는 UI 생성/표시만 담당하고, 메뉴 후보/옵션/포장/적립/결제/확인 의도는 GGUI 앞단에서 구조화해 검증된 값만 넘기도록 변경.
- 변경:
  - 공유 계약에 `GroundIntentRequest/Response`, `GroundIntentName`, `GroundItemCandidate` 추가(`contracts/types.ts`, `contracts/schemas.py`).
  - Module C `src/ground-intent.js`와 `POST /ground-intent` 추가. OpenAI structured output을 사용하되 반환값은 메뉴 DB와 선택 메뉴 options 기준으로 재검증한다. 실패 시 deterministic fallback으로 유자차/소금빵/케이크/라떼, 옵션, fulfillment/loyalty/payment/confirm을 처리한다.
  - Module D Orchestrator는 최초 recommend와 후속 음성 턴 모두 현재 step 기준으로 `/ground-intent`를 먼저 호출하고, 성공 시 state/order_state를 반영한 뒤 `/generate-ui`를 호출한다.
  - recommend grounding에는 전체 메뉴 48개를 넣고, GGUI `/generate-ui`에는 grounding된 top 후보 1~5개만 넣는다.
  - 후속 단계에는 최초 proxy 문장을 보내지 않는다. payment/confirm에서 오래된 recommend 문맥이 현재 발화를 오염시키는 문제를 차단.
  - GGUI event consume polling은 기본 off. live GGUI는 renderer로 쓰고, 음성 기반 state transition은 Orchestrator grounding이 소유한다.
  - fulfillment/loyalty/payment GGUI contract에 `total` prop을 선언해 최신 GGUI contract violation을 수정.
  - Module C GGUI render가 hang되면 8초 후 local fallback으로 내려가게 했다.
  - Module D optional `@ggui-ai/react` dynamic import 제거. `zod` peer dependency 누락으로 Vite overlay가 생기는 경로를 차단하고 `srcDoc`/iframe 렌더를 사용한다.
- 검증:
  - Module C 전체 node:test 26개 통과.
  - Module D typecheck/build 통과.
  - Playwright `module-d/tests/korean-proxy-demo.spec.mjs` 2개 통과.
  - live `/ground-intent`: `유자차 주문해줘` -> `yuzu-tea-032`, `오트밀크로 덜 달게` -> `Milk=Oat Milk`, `Sweetness=Less Sweet`, `카드로 결제` -> `Credit Card`.
  - live 데모 URL에서 유자차/소금빵/딸기 케이크/라떼 recommend 케이스 모두 `X-GGUI-Path=ggui`, grounding input 메뉴 48개, GGUI input 후보 1~5개.
  - live 전체 라떼 주문 플로우는 recommend/options/fulfillment/loyalty/payment/confirm 전부 통과하고 `Payment Complete!` 확인. 6번의 `/generate-ui` 모두 `X-GGUI-Path=ggui`, fallback 0회.

---

## 리워크 Task 1 — 공유 계약 정리 (검증 완료)

- 상태: 커밋 `4eda0a8` "[refactor] 계약에서 age/behavioral/age_group/assist_level/proxy 필드 제거"로 이미 완료·커밋됨. 4파일(types.ts/schemas.py/mocks.json/mocks.ts) 동시 수정 반영. 작업트리에 contracts 추가 변경 없음(clean).
- 결과 정합 확인:
  - `AnalyzeResult = {transcript, language, duration_ms}` (AgeGroup/age/behavioral 제거).
  - `GenerateUIRequest`: age_group/assist_level 제거, transcript/menu_context/order_state?/possible_actions?/step 유지.
  - `GroundIntentRequest`: korean_text/english_proxy_text 제거.
  - schemas.py `__all__`에서 AgeGroup/AssistLevel/AgeInfo/BehavioralInfo 제거.
  - mocks.json: elder/youth 2변형 → 단일 `sampleAnalyzeResult` {"라떼 한 잔 주세요","ko",1850}. mocks.ts: 단일 export + 묶음에서 elder/youth 키 제거.
  - sampleMenu 한국어화는 아직 미적용(Task 7 담당) — 의도대로 영어 유지.
- 검증(게이트): `cd module-d && npx tsc --noEmit` → contracts 소스 파일(types.ts/mocks.ts/schemas.py) 내부 에러 0건. 남은 17건은 전부 하류 소비자 3파일(src/api/client.ts, src/flow/orchestrator.ts, src/ui/AdaptiveKiosk.tsx)의 제거된 필드 참조 — 계획상 Task 4~6에서 해소 예정(정상).

---

## 리워크 Task 2 — Module A 축소 (검증 완료)

- 목적: 나이인식·behavioral·ElevenLabs·한→영proxy·demo 라우트 제거. Module A는 `/health` + `/analyze`(transcript-only) + OpenAI/Noop STT만 남김. Realtime 중계는 Task 3 담당(여기서는 추가 안 함).
- app.py 변경:
  - import 제거: `base64`, `urllib.parse.quote`, `inference.age`, `inference.behavioral`, `inference.elevenlabs_voice` 블록, `pydantic.BaseModel`(Pydantic 모델 전부 삭제로 미사용).
  - env 제거: `AGE_MODEL_PROVIDER`, `AGE_DEVICE`. 전역 `_age_model`/`_elevenlabs` 제거(`_stt`만 유지).
  - Pydantic 4모델(DemoVoiceRequest/AnnouncerVoiceRequest/KoreanSeniorProxyRequest/AnalyzeDemoVoiceRequest) 삭제. `get_age_model()`/`get_elevenlabs()` 팩토리 삭제.
  - demo 라우트 6개 전부 삭제(voice-presets/random-age-voice/random-age-voice/audio/announcer-voice/audio/korean-senior-proxy/analyze/generate-and-analyze).
  - `/health`: `age_model_provider`/`elevenlabs_ready` 키 제거 → `{ok, stt_model, stt_language}`.
  - `/analyze`: age/behavioral 제거 → `{transcript, language, duration_ms}` 반환. librosa.load는 입력 디코딩 검증 목적으로 유지(반환값 미사용).
- inference 3파일(age.py/behavioral.py/elevenlabs_voice.py) + 테스트 4개(test_age_public_model/test_behavioral/test_elevenlabs_voice/test_demo_routes) `git rm`.
- stt.py: `FasterWhisperSTT` 클래스 삭제, `create_stt()`의 `local:`/faster-whisper 분기 제거 → OpenAI 경로(openai:/whisper-1 등 임의 모델은 OpenAIWhisperSTT로 폴백) + NoopSTT만. `device`/`compute_type` 인자는 app.py 호출 호환 위해 시그니처 유지(미사용).
- test_stt_config.py: faster-whisper 테스트 케이스를 "임의 모델 → OpenAIWhisperSTT 폴백" 케이스로 교체.
- requirements.txt: accelerate/datasets/evaluate/faster-whisper/huggingface-hub/loralib/pandas/scikit-learn/speechbrain/torch/torchaudio/transformers 제거. 유지: fastapi/librosa/numpy/openai/python-dotenv/python-multipart/soundfile/uvicorn[standard].
- .env.example: AGE_MODEL_PROVIDER/AGE_DEVICE/ORDER_TRANSLATION_MODEL/ELEVENLABS_API_KEY/ELEVENLABS_MODEL_ID 제거. 유지: STT_MODEL/STT_LANGUAGE/STT_DEVICE/STT_COMPUTE_TYPE/API_KEY/OPENAI_API_KEY.
- 검증(게이트, PASS):
  - `cd module-a && .venv/bin/python -m py_compile app.py inference/*.py` → COMPILE_EXIT=0.
  - `PYTHONPATH=. .venv/bin/python -m unittest discover tests` → Ran 8 tests, OK (test_stt_config + test_env_loading).
  - 잔존 참조 grep(FasterWhisperSTT/create_age_model/score_behavioral/elevenlabs_voice/inference.age 등) → 0건.

## Task 7: 메뉴 데이터 한국어화 (완료)
- contracts/mocks.json sampleMenu + module-b/data/menu.seed.json 동일 한국어화. 변환 스크립트로 두 파일 동시 생성 → JSON 완전 동일 보장.
- restaurant: "OBA 카페". categories: [커피,라떼,티,에이드,음료,디저트]. 48개 name/desc 한국어.
- option type 한국어(온도/사이즈/샷/우유/당도/토핑/휘핑크림/맛/얼음/포장/제공 방식), label 한국어(뜨겁게/차갑게/기본/크게/싱글/더블/일반 우유/저지방 우유/오트 우유/덜 달게/더 달게 등).
- id 슬러그·image_url·price·price_delta·키순서 전부 보존(diff 1072/1072 대칭, id/image/price 변경 0줄).
- 검증(PASS): node -e 두 파일 items=48, restaurant="OBA 카페", 메뉴 JSON 동일=true, category∈categories=true, 사용자노출 필드 잔존영문=0. node --check module-b/server.js OK.
- 커밋: 9a5c2ce [feat] 메뉴 데이터 전면 한국어화 (48개 항목·옵션·카테고리)

## Task 4: Module C 강도 고정 + 한국어화 (완료)
- adapt.js: ASSIST_TOKENS(0~3)·normalizeAssistLevel·SENIOR_GROUPS 제거. resolveProfile() 인자 무시, 항상 고령자 최대 단일 상수 SENIOR_TOKENS({base_font_px:30,title:44,card_count:2,voice_guide:true,...}) 반환. stepCopy big 분기 제거 + 전면 한국어화. pickCandidates(transcript 매칭) 유지.
- contract.js: baseProps.assistLevel/ageGroup 스키마 제거. intentByStep 6개·actionSpec label/description(selectMenu "주문하기", confirmYes "네, 결제할게요", back "뒤로" 등) 한국어화. nextStep/step/enum 코드값 유지.
- server.js: generateLocal/normalized에서 age_group·assist_level 파싱 제거, resolveProfile() 호출, _profile에서 assist/effective/age 필드 제거. normalizeAssistLevel import 제거. transcript/menu_context/order_state/step 유지.
- local-render.js: profile.effective_level/assist_level/age_group 참조 제거(mode 항상 "guided" 고정, modeLabel "고령자 친화 모드"). 사용자 노출 전면 한국어화(카드 rank·CTA·옵션·매장/포장·쿠폰/포인트·결제·확인·스텝퍼·코치패널). 결제수단/매장포장/포인트는 코드값 data-value 유지+한국어 표시 라벨 매핑. TTS를 ko-KR 브라우저 speechSynthesis 단일 경로로(ElevenLabs /demo/announcer-voice/audio fetch + en-US 제거). dead .age-mode-express CSS 제거.
- ggui-client.js: generateViaGgui에서 age_group/assist_level 구조분해 제거 + resolveProfile(). buildPrompt 강도를 입력 대신 SENIOR_INTENSITY 상수 주입 + UI 텍스트 KOREAN 지시. buildGguiProps base에서 assistLevel/ageGroup 제거. handshake persona "kiosk-50plus-senior-max" 고정.
- 테스트 갱신: contract.test(resolveProfile() + /고령자 친화 키오스크/ + assistLevel/ageGroup undefined), local-render.test(고정강도 1케이스 + ko-KR speech + 한국어 step/요약 라벨), ggui-client.test(profile {tokens}만 + props.assistLevel/ageGroup undefined).
- 검증: `npm --prefix module-c test` → Task 4 소유 테스트(contract 4 + ggui-client 7 + local-render 5) 전부 PASS. node --check 5개 파일 OK.
- 사전존재 실패 2건(fallbackGroundIntent option labels, validateGroundIntent option labels)은 Task 7 menu.seed.json 한국어화로 인한 ground-intent.js(Task 4 범위 밖) 영문 라벨 미스매치 — 내 변경 stash 후 baseline에서도 동일 2건 실패 확인(내 작업과 무관).

## Task 3 — Module A OpenAI Realtime 중계 엔드포인트 (완료)
- SDK 시그니처 실측(.venv openai 2.38.0): `client.realtime.client_secrets.create(expires_after=, session=)` → 응답 `ClientSecretCreateResponse{value, expires_at(int), session}`. session.audio.input.{transcription.language, turn_detection(server_vad: silence_duration_ms/threshold/prefix_padding_ms)} 구조 확인. model Literal에 `gpt-realtime` 포함 확인. 페이로드를 RealtimeSessionCreateRequest.model_validate로 사전 검증(server_vad 2000/0.5/300, language ko) PASS — 추측 없이 SDK 경로 사용(REST 폴백 불필요).
- app.py: env 추가(OPENAI_API_KEY/OPENAI_REALTIME_MODEL=gpt-realtime/OPENAI_REALTIME_LANGUAGE=ko/OPENAI_REALTIME_SILENCE_MS=2000). `/health`에 `realtime_ready: bool(OPENAI_API_KEY)` 추가. `POST /realtime/session`(require_auth) 신설 — ephemeral client_secret(60초 만료) 발급, 키 없으면 503·발급 실패 시 502(한국어 detail), 프론트에 `{client_secret(value), model, expires_at}` 반환.
- .env.example: Realtime env 3종 추가.
- 검증: `.venv/bin/python -m py_compile app.py` PASS. 라우트 등록 확인(POST /realtime/session). unittest 8/8 PASS. 커밋 ce61406.

## Task 5 — Module D 로직 레이어 정리 + Realtime STT 연동 (완료)
- client.ts: KOREAN_PROXY_VOICES·KoreanProxyVoiceChoice·DEFAULT_KOREAN_DEMO_TEXT·KoreanSeniorProxyAnalyzeResult·analyzeKoreanSeniorProxy·proxyAnalyzeToAnalyzeResult·mockKoreanSeniorProxy·mockKoreanOrderAnalyze·mockEnglishOrderProxy·sampleAnalyzeResultElder/Youth import·AgeGroup import 제거. analyze()를 transcript-only로 축소(opts.transcript 주입 시 즉시 AnalyzeResult, mock이면 sampleAnalyzeResult, 라이브면 /analyze). AnalyzeOptions.mockVariant/forceLive→transcript. generateUI mock contract에서 _assist_level/_age_group 제거. 신설: RealtimeSession 타입 + createRealtimeSession()(REALTIME_URL=VITE_REALTIME_URL||ANALYZE_URL, /realtime/session POST, 한국어 detail 에러).
- realtime.ts(신규): RealtimeVoiceSession 클래스 — createRealtimeSession→getUserMedia 마이크 트랙→RTCPeerConnection(addTrack + recvonly transceiver) + data channel(oai-events)→SDP offer를 https://api.openai.com/v1/realtime?model= 에 client_secret Bearer로 POST→answer setRemoteDescription. 이벤트: input_audio_buffer.speech_started→onSpeechStarted, conversation.item.input_audio_transcription.completed→onTranscript(최종 한국어), error→onError. stop()=input_audio_buffer.commit(수동 보조), close()=정리, 실패 시 한국어 onError. isRealtimeSupported() export.
- orchestrator.ts: FlowState.proxyTrace 제거. recorder/mockVariant/proxyVoice 필드 제거→voice(RealtimeVoiceSession)/voiceTurn. setMockVariant/setProxyVoice/runPipeline/runKoreanProxyPipeline/runVoiceTurn/playProxyAudioBase64 제거. startVoiceOrder/stopAndRun/respeak를 openVoiceSession() 기반 재작성(2초 server VAD 자동종료, 정지=stop() commit, mock/미지원=데모 발화). onVoiceTranscript→runInitialTurn(첫 발화) 또는 handleTranscript(멀티턴)→applyVoiceTranscript 주입(상태기계 골격 유지). generateForStep에서 age_group/assist_level 인자 제거. assist() 제거, announce(text)는 항상 한국어 speak. 전 announce/message/fail 한국어화. wonForSpeech ko-KR 원 표기. nextDemoUtteranceForStep + DEMO_INITIAL_UTTERANCE 한국어. recommendCandidates/tryGroundIntent proxyTrace·korean_text·english_proxy_text 제거.
- tts.ts: speakWithElevenLabs·ELEVENLABS_NARRATION_ENABLED·apiConfig import·assistLevel/rateFor 제거. ensureAnnouncerVoice ko 음성 선택, SpeechSynthesisUtterance lang ko-KR. 한국어 주석.
- .env.example: VITE_REALTIME_URL 추가(=VITE_ANALYZE_URL 폴백). proxy/voice/ElevenLabs/KOREAN_DEMO env 없음(애초 부재).
- recorder.ts: App.tsx(L16 isRecordingSupported)가 여전히 참조 중 → Task 6 범위라 삭제 보류(orchestrator 의존은 제거됨, "미사용시 정리" 조건 미충족).
- 검증: `cd module-d && npx tsc --noEmit` → 목표 레이어(api/flow/audio) 0 에러(PASS). 잔존 에러 8건은 전부 App.tsx(KOREAN_PROXY_VOICES·setMockVariant·setProxyVoice 등)·AdaptiveKiosk.tsx(state.analyze.behavioral/age)로 Task 6에서 해소 예정(계획 명시). 제거 심볼 grep 0건.
- 커밋: 8356ee9 [refactor] Module D 로직 레이어 proxy/voice/age 제거 + Realtime STT 연동

## 공개 준비(Giosk publish-prep) — Phase A·B·C 완료 (라이브 검증 포함)
계획: docs/superpowers/plans/2026-05-31-giosk-publish-prep.md. BYOK 키는 `module-c/.env.local`(sk-proj…)에 기존 존재 — 사용자가 잠든 사이 자율 진행("전부 진행해줘"). **push 는 미실행(외부 공개라 사용자 확인 대기).**

### Phase A1 — 기동·헬스 정합 (커밋 730e75a)
- run.sh 전면 재작성: BYOK 키 자동탐지(env > 루트 .env(.local) > module-c .env(.local)) → 키 있으면 `GGUI_MODE=ggui`(라이브 메인) + GGUI MCP 서버(6781) 자동 기동/재사용, 없으면 LOCAL. `MOCK_MODE`(app.py 미사용) 제거. stop 모드에 6781 포함. 키탐지 로직 단위검증 PASS(키없음/placeholder→local, 실키→ggui).
- health.mjs A 라벨 realtime/STT 정정. run_local.sh의 제거된 AGE_MODEL_PROVIDER 삭제. mocks.ts 주석 MOCK_MODE 제거. stale 스크립트 module-a/scripts/test_elevenlabs_age_demo.sh 삭제. npm run verify PASS.

### Phase A2 — 라이브 결선 검증 (커밋 a144c40) ★실제 이슈 2건 발견·수정★
- 검증 환경: 떠있던 스택이 STALE(8000 module-a가 리워크 이전 코드, /realtime/session 404, /demo/* 잔존)이라 현재 코드로 재기동 후 검증. 프론트는 `module-d/.env.local`이 VITE_USE_MOCK=true라 mock에 묶여 있었음 → false + VITE_REALTIME_URL 추가로 라이브 전환.
- **[버그1·수정] /realtime/session 502** → OpenAI 400 `Missing required parameter: 'session.audio.input.transcription.model'`. GA Realtime은 input transcription에 **model 필수**. app.py에 `OPENAI_REALTIME_TRANSCRIBE_MODEL=gpt-4o-transcribe`(env override) 추가 → **재검증 200, ephemeral client_secret(ek_…) 발급 성공.** (정적감사에서 이미 리스크로 지목했던 항목)
- **[이슈2·대응] GGUI 라이브 = local-fallback** → 사유 "GGUI render timeout after 8000ms". **콜드 생성이 30~40초**(fulfillment 31.6s, confirm 39.6s 실측)라 8s 타임아웃이 항상 폴백. 단 **GGUI 캐시 키는 transcript가 아니라 step/contract 구조 기반** — 다른 발화도 같은 step이면 캐시 히트(0.0s). 폴백돼도 GGUI 서버가 백그라운드로 생성·캐시 적재함을 데이터로 확인. → module-c GGUI_TIMEOUT_MS 기본 12s로 조정 + `scripts/prewarm-ggui.mjs`(npm run prewarm:ggui) 신설(6개 step 폴링 워밍). **프리워밍 6/6 적재 후 재검증: X-GGUI-Path=ggui, 0.0s.**
- **[검증 통과] ground-intent 한국어 매칭(LLM, gpt-4.1-mini)**: 따뜻한 라떼→select_item(caffe-latte-003), 안 단 걸로 아이스로→{온도:차갑게}, 포장→Take Out, 적립 안 할게요→none, 카카오페이→Kakao Pay, 네→yes 전부 정확. **주문 total 4500=4500 정합.** AdaptiveKiosk가 GGUI `_ggui.html`을 iframe srcDoc로 렌더 확인(GGUI 화면은 음성진행, LOCAL 폴백은 터치도 가능).
- **남은 1건(사용자 몫): 브라우저 마이크 발화→WebRTC→2초 VAD→transcript** 의 실제 음성 부분. 백엔드(세션 발급)·이후 흐름은 전부 라이브 검증됨. 마이크는 사람만 가능.
- 최종 골든 상태: 4포트 health 200, realtime_ready=True, /realtime/session 200, GGUI ggui 0.0s, 주문 정합. 스택은 켜둔 채(프리워밍 유지) 사용자 브라우저 테스트 대기.

### Phase B — 패키지화 + BYOK .env (커밋 17ef3eb)
- `npm run setup` = install:all + module-a/setup-venv.sh(venv 멱등 부트스트랩, 검증 실행 OK). `npm run prewarm:ggui` 추가.
- .env.example 전면 정리: 나이/ElevenLabs/proxy/MOCK_MODE 제거, OPENAI_API_KEY 한 줄이 핵심인 BYOK 형태(키 없으면 LOCAL 폴백 안내). requirements.txt openai>=2.2.0(GA Realtime client_secrets 필요, 설치본 2.38.0). .gitignore `.env`/`.env.*` 보호 확인(git check-ignore OK).

### Phase C — Giosk 한국어 README (커밋 4841675)
- 루트 README 전면 교체: Giosk 통일, Q1~Q4(문제·타깃·작동방식·차별점) + 시작하기(clone→.env→setup→run:all→prewarm:ggui) + 아키텍처 4모듈 표/흐름도(GGUI 라이브 메인·LOCAL 폴백) + 기술스택. 참조 경로 전부 실재 확인.

### DoD 현황
- [x] setup/run:all 4포트 health 200 (구성요소 검증; 풀 클린클론은 미실행)
- [x] 라이브 Realtime e2e 백엔드(세션 200) — 마이크 음성부분만 사용자 몫
- [x] 라이브 GGUI 생성(ggui path, codeReady, 프리워밍 즉시) / [x] 한국어 ground-intent·주문 total 정합
- [x] README BYOK 설치·실행 가능 / [x] .env git 미추적 / [x] Giosk 통일
- 검증: module-a 8 tests, module-c 25 tests, module-d typecheck/build 전부 PASS.
