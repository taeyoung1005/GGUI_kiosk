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
