# SPEC — 음성 적응형 키오스크 구현 명세

> OBA Weekend-thon S1 · GGUI 트랙
> 모듈 A(AI)·B(메뉴/주문)·C(GGUI 생성)·D(웹 프론트) + 공유 계약
> 관련: `PLAN.md`(모듈 분리), `PIPELINE.md`(흐름도)

---

## 0. 핵심 아키텍처 결정

### 0.1 모델은 로컬 추론 (학습만 원격)
- 나이 모델(wav2vec2/HuBERT ~1.2GB)·STT(faster-whisper)는 **노트북 추론 가능**(단발 0.3~2초).
- **학습 = 원격 GPU(4060Ti×2)**, **추론 = 로컬 기본 / 원격 폴백**.
- 모델 이식 = `save_pretrained` 폴더를 `scp`로 복사 → 로컬 `from_pretrained(경로)`.

### 0.2 Module A는 "포터블 /analyze 서비스"
- 동일 FastAPI 코드가 로컬·원격 어디서든 실행. 프론트는 `ANALYZE_URL` 환경변수만 바꿈.
- → 로컬/원격 선택을 코드가 아니라 배포 설정으로 미룬다.

### 0.3 EXAONE 없음
- 추천+UI 생성은 GGUI의 BYOK LLM(**OpenAI GPT**)이 겸임. Module A는 STT+나이+행동신호만.

### 0.4 ⚠️ 사전 확보 필요
- **OpenAI API 키**(`OPENAI_API_KEY`): GGUI BYOK 생성용. GGUI는 OAuth 미지원 → **raw API 키 필요**.
  - 모델 = `openai:gpt-5.5-2026-04-23`(GGUI 기본 OpenAI 라우트), OpenAI Responses API 사용.
- AIHub 71320 다운로드(승인 완료) · 원격 서버 SSH 복구 · 시드 메뉴 데이터.

### 0.5 ⭐ 최신 결정 (이 세션 — 아래 산재된 audeering/한국어 언급보다 우선)
- **나이·성별 모델 교체**: audeering → **`tiantiaf/wavlm-large-age-sex`** (vox-profile `WavLMWrapper`).
  - 모델 코드는 `module-a/inference/vox_profile/`(wavlm_demographics.py + revgrad*.py) **vendoring**.
  - 입력 16kHz mono, 3~15초(초과 절단). 출력 = age 회귀(×100) + sex(Female/Male). child 클래스 없음 → 나이에서 근사.
  - 실모드 추가 의존성: **torch · transformers · speechbrain · loralib · huggingface_hub** (+ soundfile/librosa). `.env`: `AGE_HF_MODEL=tiantiaf/wavlm-large-age-sex`, `AGE_DEVICE=cpu`.
  - `age.classify()`/`AgeResult` 인터페이스·MOCK_MODE 폴백은 **그대로**(다른 모듈 무영향).
- **데모 언어 = 영어**: UI/메뉴/사진/주문 발화 전부 영어(서사·임팩트는 발표 슬라이드에서 한국 어르신으로). STT `STT_LANGUAGE=en` 권장. 행동신호 필러에 영어(uh/um/er…) 추가됨.
- **AIHub 한국어 fine-tuning은 행사 중 드롭** → "정확도 개선 로드맵"으로. 영어 데모는 WavLM age-sex zero-shot로 충분(영어 본토).
- 영어 합성 데이터(UI/DB/사진)는 **Codex로 생성**(menu.seed.json 영어화 + SVG placeholder + module-d 영어 문자열).

---

## 1. 공유 데이터 계약 (`contracts/`)

> 4모듈이 이 JSON 형태에만 합의 → 서로 mock하며 병렬 개발. (TS 타입 또는 JSON Schema로 1곳에 둠)

### AnalyzeResult  (A → D)
```jsonc
{
  "transcript": "라떼 하나 주세요",
  "language": "ko",
  "age": { "group": "50+" , "years_est": 67, "confidence": 0.72, "child_prob": 0.02 },
  "behavioral": { "speech_rate": 2.8, "silence_ratio": 0.46, "filler_count": 2, "assist_level": 2 },
  "duration_ms": 1850
}
```

### Menu / MenuItem  (B → D, C)
```jsonc
{
  "restaurant": "○○카페",
  "categories": ["커피","음료","디저트"],
  "items": [
    { "id":"latte-001", "name":"카페라떼", "category":"커피", "price":4500,
      "image_url":"/img/latte.png", "desc":"부드러운 라떼",
      "options":[
        { "type":"온도", "choices":[{"label":"HOT","price_delta":0},{"label":"ICE","price_delta":0}] },
        { "type":"사이즈","choices":[{"label":"R","price_delta":0},{"label":"L","price_delta":500}] }
      ] }
  ]
}
```

### GenerateUIRequest / Response  (D → C)
```jsonc
// request
{ "transcript":"라떼 하나 주세요", "age_group":"50+", "assist_level":2,
  "menu_context":[ /* 후보 또는 전체 menu items */ ], "step":"recommend" }
// response
{ "render_id":"abc123", "embed_url":"http://localhost:6781/r/sH9xK",
  "contract": { "actionSpec": { "selectMenu": {"label":"이거 주문","nextStep":"order"} } } }
```

### OrderRequest / Response  (D → B)
```jsonc
// request
{ "items":[ {"item_id":"latte-001","options":{"온도":"HOT","사이즈":"R"},"qty":1} ] }
// response
{ "order_id":"ord-1001", "total":4500, "status":"paid" }   // mock
```

---

## 2. Module A — AI 추론 서비스 (★)

### 2.1 책임
음성(wav) → 전사(STT) + 나이대(분류) + 행동신호(assist_level). 오프라인 나이모델 학습.

### 2.2 스택
- Python 3.11 · FastAPI · uvicorn
- STT: **faster-whisper**(CPU int8) 또는 Mac은 **mlx-whisper**(Apple Silicon 가속)
- 나이·성별: **vox-profile `WavLMWrapper`**(tiantiaf/wavlm-large-age-sex, vendored) + torch/transformers/speechbrain/loralib. 입력=raw 16kHz 파형, 출력=(age, sex)
- VAD: silero-vad · 행동신호: 단어 타임스탬프 기반 룰

### 2.3 파일 트리
```
module-a/
├── app.py                 # FastAPI, POST /analyze, GET /health
├── inference/
│   ├── stt.py             # faster-whisper/mlx-whisper 래퍼
│   ├── age.py             # from_pretrained(AGE_MODEL_PATH) 로드+추론
│   ├── vad.py             # silero-vad
│   └── behavioral.py      # 속도·침묵·채움말 → assist_level
├── models/age_model/      # ★이식된 학습 모델 (config+safetensors)
├── training/              # 원격 GPU 전용 (학습)
│   ├── 01_download.py     # AIHub 71320 다운로드·병합
│   ├── 02_index.py        # Speakers.Agegroup + Dialogs.Start/EndTime 인덱싱
│   ├── 03_clips.py        # 구간 클립 생성(16kHz wav)
│   ├── 04_split.py        # ★화자 단위 train/valid/test
│   ├── 05_train.py        # wav2vec2/HuBERT fine-tune (단일GPU→torchrun DDP)
│   └── 06_eval_export.py  # 평가 + save_pretrained(models/age_model)
├── requirements.txt
└── .env                   # AGE_MODEL_PATH, STT_MODEL, API_KEY
```

### 2.4 /analyze 처리 흐름
```
audio(wav 16kHz) → vad.split → [stt.transcribe → transcript+ts] + [age.classify → group]
                 → behavioral.score(ts, transcript) → assist_level
                 → AnalyzeResult 반환
```

### 2.5 모델 이식(원격→로컬)
```bash
# 원격(학습 후)
python training/06_eval_export.py   # → models/age_model/ 생성
# 로컬로 복사
scp -r oba-4060ti:~/module-a/models/age_model ./module-a/models/age_model
# 로컬 추론은 AGE_MODEL_PATH=./models/age_model 로 동일 코드 실행
```

### 2.6 실행
```bash
# 로컬(권장)
uvicorn app:app --port 8000
# 원격(폴백) — 동일 코드, 터널/HTTPS로 노출 + API_KEY
```

### 2.7 학습 메모 (원격, MEMORY 반영)
- 라벨 `화자연령대` → **이진 "50+ vs 이하"**.
- 단일 GPU 재현 루프 먼저 → `torchrun --nproc_per_node=2` DDP(4060Ti×2).
- 하위층 freeze + gradient accumulation으로 16GB VRAM 대응.
- 평가: audeering zero-shot 대비. 폴백: 학습 미완 시 audeering+행동신호.

---

## 3. Module B — 메뉴/주문 백엔드

### 3.1 스택 & 트리
- Node(Express) 또는 FastAPI · SQLite 또는 `menu.seed.json`
```
module-b/
├── server.js (or app.py)
├── data/menu.seed.json     # 실제 식당 1곳 메뉴 (수동 시드)
├── db.js                   # SQLite 로드 or JSON in-memory
└── routes: /menu, /menu/search, /orders, /orders/:id
```
### 3.2 엔드포인트
```
GET  /menu                 → Menu
GET  /menu/search?q=라떼    → { items:[...] }
POST /orders               → OrderResponse (status:"paid" mock)
GET  /orders/:id           → { status }
```
### 3.3 결제
- **mock**: 항상 `status:"paid"`, 1~2초 지연 애니메이션. 실 PG 연동 없음.

---

## 4. Module C — GGUI 적응 UI 생성

### 4.1 스택
- Node · `@ggui-ai/*`(클론본 `./ggui` 참고) · GGUI MCP 서버 · **OpenAI API(BYOK)**

### 4.2 셋업 (GGUI MCP 서버 띄우기)
```bash
# 클론된 ./ggui 의 README 기준 (정확 명령 확인)
export OPENAI_API_KEY=sk-...            # ★ GGUI 생성 LLM (OAuth 미지원, raw 키)
npx @ggui-ai/cli serve                  # MCP+뷰어 (기본 포트 6781)
# 또는 아젠틱 앱 스캐폴드(create-agentic-app)로 D까지 한 번에
```
- `ggui.json`: `"generation": { "model": "openai:gpt-5.5-2026-04-23" }`, 노인친화 theme 토큰(글자 크기↑).
- 사용 API = OpenAI **Responses API**(`responses.create`) → 해당 모델 접근 권한 있는 키 필요.

### 4.3 /generate-ui 처리
```
GenerateUIRequest 수신
 → 시스템 프롬프트 구성 (assist_level별 UI 규율: 큰 카드 2~3, 예/아니요, 큰 글씨)
 → ggui_render(prompt, data=menu_context, contract)
 → { render_id, embed_url, contract } 반환
```
- UI 규율: **구조 고정(카드+예/아니요), 내용만 적응.** assist_level↑ → 글자·여백·음성안내 강화.

---

## 5. Module D — 웹 키오스크 프론트

### 5.1 스택 & 트리
- React + Vite · `@ggui-ai/react` · Web Audio/MediaRecorder · `speechSynthesis`(TTS)
```
module-d/
├── src/
│   ├── App.tsx
│   ├── ui/StaticKiosk.tsx     # 일반 키오스크 UI (static, before/폴백)
│   ├── ui/AdaptiveKiosk.tsx   # GGUI embed (@ggui-ai/react)
│   ├── audio/recorder.ts      # 마이크 캡처 16kHz
│   ├── audio/tts.ts           # speechSynthesis
│   ├── api/client.ts          # A/B/C 호출 + mock 토글
│   └── flow/orchestrator.ts   # analyze→menu→generate-ui→render→order
└── .env                       # VITE_ANALYZE_URL, VITE_MENU_URL, VITE_GGUI_URL, VITE_USE_MOCK
```
### 5.2 두 UI 모드 (★)
- 기본 화면 = StaticKiosk(평소 키오스크). 음성 입력 시 → AdaptiveKiosk(GGUI) 전환.
- **before/after 대조 = 데모 핵심.** A/C 무응답 시 StaticKiosk로 폴백.
### 5.3 흐름
```
[StaticKiosk] --마이크--> A./analyze --> B./menu --> C./generate-ui
   --> [AdaptiveKiosk embed] + TTS --재발화/터치(멀티턴)--> (반복)
   --> 옵션 확정 --> B./orders(mock) --> "결제 완료"
```
### 5.4 Mock 모드
- `VITE_USE_MOCK=true`: A/B/C를 고정 JSON으로 대체 → 백엔드 없이 UI/흐름 단독 개발.

---

## 6. 메뉴 데이터 (★ 별도 Codex 산출물 — 분리됨)

메뉴에 들어가는 데이터(`module-b/data/menu.seed.json` + `public/img/menu/*.svg`)는 **이 SPEC에서 분리**해 별도 명세로 관리한다 → **`MENU_DATA_SPEC.md`** (Codex 세션에서 독립 생성).
- module-b 서버는 이 데이터를 **서빙만** 한다(로직 불변).
- 요구 요약: 영어 카페, ~20개 항목, **latte 변형 ≥5종**(모호 발화→추천 데모 핵심), 카테고리 다양, `contracts/types.ts`의 `MenuItem` 준수, 항목당 SVG placeholder.
- 상세·검증·Codex 작업지시는 `MENU_DATA_SPEC.md` 참조.

---

## 7. 로컬 통합 실행 (포트 맵)

| 모듈 | 포트 | 실행 |
|------|------|------|
| A `/analyze` | 8000 | `uvicorn app:app --port 8000` |
| B 메뉴/주문 | 8001 | `node server.js` |
| C GGUI(MCP+생성) | 6781 | `npx @ggui-ai/cli serve` + `/generate-ui` 래퍼 |
| D 프론트 | 5173 | `npm run dev` (Vite) |

`.env`(D): `VITE_ANALYZE_URL=http://localhost:8000` 등. 원격 추론 시 A의 URL만 교체.

---

## 8. 마일스톤 (좁고 끝까지)

1. **contracts/** 타입 확정 (4모듈 공유)
2. **D + mock** — StaticKiosk + 흐름(고정 JSON)으로 화면 관통
3. **C 단독** — ggui_render로 "프롬프트→적응 UI" 검증 (Claude 키)
4. **A 로컬** — faster-whisper STT + (초기) audeering 나이 → `/analyze`
5. **결선** — D가 mock 제거, A·B·C 실연결, end-to-end
6. **나이모델 교체** — 원격 학습 완료분 이식 → A의 age.py 모델 교체
7. **완결** — 옵션확정 + mock결제 + TTS + 멀티턴/복구 + 폴백
```
검증 기준: "느린 어르신 '라떼…' → 후보 3장 → '따뜻한 거로?' → 결제 완료" 완주
+ 같은 말을 빠르게 하면 다른(압축) 화면 (= 적응 증명)
```
