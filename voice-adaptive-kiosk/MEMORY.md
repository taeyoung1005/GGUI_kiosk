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

## 2026-05-30 — 대시보드 배치 실험 요약 표시 추가

- `/demo/batch-summary` 엔드포인트 추가: `artifacts/age-demo-balanced-en-v1/age_demo_batch_en_100_summary.json`과 CSV를 읽어 available, total, ok, match, target/gender/predicted distribution을 반환.
- `/demo` 대시보드에 `Balanced Batch` 섹션 추가: 영어 100개 균등 생성 결과, 성공 수, match rate, gender split, predicted decade 분포 막대를 표시.
- 대시보드 표기를 영어 발표용으로 정리: age option display는 `10s/20s/30s/40s/50+`, 내부 value는 기존 모델 bucket(`10대` 등) 유지.
- 검증: 신규 `tests/test_demo_batch_summary.py` 추가. `.venv/bin/python -m unittest discover -s tests -v` 21개 통과, `py_compile` 통과, `/demo/batch-summary` API 수동 확인, Playwright screenshot `artifacts/demo-dashboard-final.png`로 렌더 확인.

## 2026-05-30 — Fair-Speech 실제 녹음 기반 age model 검증 전환

- ElevenLabs 합성 음성이 실제 나이대 목소리처럼 들리지 않아, 모델 검증 기준을 Fair-Speech 실제 영어 녹음 데이터셋으로 전환. ElevenLabs 결과는 voice metadata proxy일 뿐 ground truth가 아니므로 검증 패널 우선순위에서 내림.
- Hugging Face `SALT-NLP/speech_fairness` 데이터셋 확인: `audio`, `transcription`, `age`, `gender`, `first_language` 컬럼. age label은 `18 - 22`, `23 - 30`, `31 - 45`, `46 - 65` 4개 구간, gender는 female/male.
- `scripts/fairspeech_eval.py` 추가: HF streaming + `Audio(decode=False)`로 audio bytes를 받고 `soundfile`로 디코딩, 16kHz로 리샘플 후 `tiantiaf/wavlm-large-age-sex` 모델을 한 번 로드해 균등 샘플 평가. `datasets` streaming 종료가 지연되어 CLI 종료 시 stdout/stderr flush 후 명시 종료하도록 처리.
- 신규 테스트 `tests/test_fairspeech_eval.py` 추가. Fair-Speech age label 정규화, model years→Fair-Speech age-bin 매핑, age×gender 균등 목표 생성을 검증.
- `/demo/batch-summary`는 `artifacts/fairspeech-eval-v1/fairspeech_eval_summary.json`/CSV가 있으면 이를 우선 반환하고, 없으면 기존 ElevenLabs synthetic batch summary로 fallback. 대시보드는 `Fair-Speech Validation` 제목과 real sample/match/gender/predicted distribution을 표시.
- 실제 검증 실행: `PYTHONPATH=. .venv/bin/python scripts/fairspeech_eval.py --out-dir ./artifacts/fairspeech-eval-v1 --per-cell 10 --max-scan 6000 --device cpu`.
- 결과: 80/80 ok, age-bin match=29/80(36.25%), target distribution은 4개 age-bin 각 20개, gender distribution은 female/male 각 40개. predicted distribution은 `18-22`=11, `23-30`=26, `31-45`=27, `46-65`=7, `outside`=9.
- 해석: 공개 WavLM age-sex 모델을 발표 데모의 보조 신호로는 쓸 수 있으나, 실제 나이대 분류 정확도가 낮아 “신뢰 가능한 나이대 분류기”로 주장하면 안 됨. 데모 문구는 적응형 UI 신호/프로토타입 중심으로 조정 필요.
- 검증: `PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v` 25개 통과, `py_compile` 통과, `/demo/batch-summary`가 Fair-Speech 결과를 반환함 확인, Playwright screenshot `module-a/artifacts/demo-dashboard-fairspeech-final.png`로 렌더 확인.
