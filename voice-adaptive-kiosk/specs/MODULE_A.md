# 명세: Module A — AI 추론 서버 + ElevenLabs 실시간 보이스 생성/검증

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 영어
> 포트 **8000**. 이 한 모듈이 **AI 추론(/analyze)** 과 **ElevenLabs 연령대별 랜덤 보이스 생성·검증(/demo/\*)** 을 한 세션에서 함께 담당한다(= 구 VOICEGEN 흡수).
> 이 문서 하나로, module-a 만 아는 새 세션이 단독으로 빌드·실행·테스트할 수 있도록 자립형으로 작성됨.
> ★ 정본 코드 경로 = **리포 루트 `/Users/taeyoungpark/Desktop/OBA_Weekenthon/module-a`** (Codex 가동본). `voice-adaptive-kiosk/module-a` 는 이것을 가리키는 **심링크**(`module-a -> ../module-a`). 본 명세는 정본을 직접 Read 해서 사실만 반영함.

---

## 1. 목적 · 책임

A는 두 가지를 한다.

**(1) AI 추론 — `/analyze`**
음성(오디오 파일) 한 발화를 받아 `AnalyzeResult` 하나를 만든다.
- 입력: multipart `file` (오디오). librosa 로 16kHz mono 로드.
- 출력: `transcript`(STT) + `language` + `age`(나이대/보조 신호) + `behavioral`(행동신호 + `assist_level` 0~3, **적응 주축**) + `duration_ms`.
- 적응 신호 주축 = 행동신호(`assist_level`). 나이(`age`)는 보조 가산. 나이 모델이 틀려도 행동신호로 UI 강도가 결정되는 설계.
- 처리 흐름(`app.py::analyze`): `librosa.load(16k mono)` → `duration_sec` 산출 → `stt.transcribe(path)` → `age.predict(audio,16000)` → `behavioral.score_behavioral(transcript, duration_sec, speech_sec, age.group)` → `AnalyzeResult`.

**(2) ElevenLabs 실시간 랜덤 보이스 생성·검증 — `/demo/*`** (VOICEGEN 흡수)
연령대별(10대/20대/30대/40대/50+) 프리셋 보이스 ID 중 랜덤 선택 → ElevenLabs TTS 합성 → (옵션) 그 합성음을 그대로 `/analyze` 파이프라인에 넣어 나이 검증. 데모 대시보드(`/demo`, `static/demo.html`)와 100건 배치 평가 스크립트(`scripts/age_demo_batch.py`)를 포함.

**범위 밖**: 메뉴/추천(B), GGUI 생성(C), 프론트(D), 결제. A는 음성→신호 변환 + 데모용 보이스 생성만.

---

## 2. 소유 세션 / 누가 개발

- **owner = Codex** (module-a 전체 + ElevenLabs 데모 + 메뉴데이터 + 웹UI).
- 구 VOICEGEN(별도 standalone)은 더 이상 정본이 아니다 → **구버전, 정본 `/demo/*` 사용**.
- Claude 는 module-c(GGUI) · 통합 담당. A 코드는 수정하지 않는다(읽기·계약 합의만).

---

## 3. 입출력 계약 (contracts/types.ts 슬라이스 + 예시 JSON)

정본 계약 파일: `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/contracts/types.ts`.

### 3-1. `/analyze` → `AnalyzeResult` (Module A → Module D)

계약(types.ts 슬라이스):
```ts
export type AgeGroup = "50+" | "under50";

export interface AnalyzeResult {
  transcript: string;          // STT 전사. 예: "라떼 하나 주세요"
  language: string;            // "ko" | "en" ...
  age: {
    group: AgeGroup;           // 이진 그룹 (보조 신호)
    years_est: number;         // 추정 나이(년)
    confidence: number;        // 0~1
    child_prob: number;        // 아동 화자 확률 0~1
  };
  behavioral: {
    speech_rate: number;       // 음절/초 (실제 구현은 토큰/초)
    silence_ratio: number;     // 0~1
    filler_count: number;
    assist_level: 0 | 1 | 2 | 3;  // 적응 주축
  };
  duration_ms: number;
}
```

실제 응답 예시(정본 `app.py::analyze` 출력 구조 그대로):
```json
{
  "transcript": "I would like a latte, please.",
  "language": "en",
  "age": { "group": "50+", "years_est": 54.92, "confidence": 0.97, "child_prob": 0.0 },
  "behavioral": { "speech_rate": 2.5, "silence_ratio": 0.12, "filler_count": 0, "assist_level": 1 },
  "duration_ms": 1840
}
```

> ⚠ **계약 불일치(사실, §9에 상세)**: types.ts 는 `age.group ∈ {"50+","under50"}` 이진을 명세하지만, 정본 코드(`inference/age.py`)는 `age.group` 을 **한국어 10년 단위 라벨** `"10대"|"20대"|"30대"|"40대"|"50+"` 로 반환한다(`age_years_to_group`). `local` provider 가 체크포인트 없이 fallback 되면 `"unknown"` 도 나온다(`MissingAgeModel`). 따라서 현재 `/analyze` 응답의 `age.group` 은 `"50+"` 외에는 계약 문자열과 다르다. 통합 시 매핑 필요(예: `"50+"`→`"50+"`, 그 외 모두 `"under50"`).

### 3-2. ElevenLabs 데모 입출력 (A 내부 / 데모 전용 — 공유 계약 아님)

`POST /demo/random-age-voice` 요청 바디(`DemoVoiceRequest`):
```json
{ "age_group": "50+", "language": "en", "text": null, "seed": 1 }
```
응답:
```json
{ "age_group": "50+", "language": "en", "voice_id": "pNInz6obpgDQGcFmaJgB",
  "text": "I would like to order a latte. Please guide me slowly with large text." }
```

`POST /demo/generate-and-analyze` 요청 바디(`AnalyzeDemoVoiceRequest` = DemoVoiceRequest + `target_decade`):
```json
{ "age_group": "50+", "target_decade": "60대", "language": "en", "seed": 7 }
```
응답(생성→검증 한 번에):
```json
{
  "target_decade": "60대",
  "voice_bucket": "50+",
  "language": "en",
  "voice_id": "pNInz6obpgDQGcFmaJgB",
  "text": "I would like to order a latte. Please guide me slowly with large text.",
  "audio_base64": "<mp3 base64>",
  "age": { "group": "50+", "years_est": 50.86, "confidence": 0.94, "child_prob": 0.0 },
  "behavioral": { "speech_rate": 2.3, "silence_ratio": 0.0, "filler_count": 0, "assist_level": 1 },
  "duration_ms": 1320
}
```

> ⚠ generate-and-analyze 의 `behavioral` 은 **transcript 자리에 합성 입력 텍스트(`text`)** 를 넣어 계산한다(STT 거치지 않음). `speech_sec=duration_sec` 으로 `silence_ratio` 가 항상 0 에 가깝다. 데모 신호일 뿐 실측 행동신호 아님.

---

## 4. 스택 · 파일 트리 (실제)

스택: Python · FastAPI · uvicorn · librosa · numpy · PyTorch/transformers(나이 모델) · faster-whisper(STT) · requests(ElevenLabs) · python-dotenv.

```
module-a/                         # ← 정본(리포 루트). voice-adaptive-kiosk/module-a 는 심링크
├── app.py                        # FastAPI 앱. 엔드포인트 전부(§아래)
├── inference/
│   ├── age.py                    # create_age_model(provider): local | wavlm_age_sex
│   ├── stt.py                    # create_stt / FasterWhisperSTT / NoopSTT
│   ├── behavioral.py             # score_behavioral (필러·assist_level)
│   └── elevenlabs_voice.py       # ElevenLabsClient, choose_age_voice, load_age_voice_map
├── static/demo.html              # /demo 대시보드 (~15KB)
├── scripts/
│   ├── age_demo_batch.py         # 100건 생성→검증 배치 평가
│   └── test_elevenlabs_age_demo.sh   # ko/en 스모크
├── tests/                        # unittest (15 tests)
│   ├── test_age_public_model.py
│   ├── test_age_demo_batch.py
│   ├── test_elevenlabs_voice.py
│   ├── test_stt_config.py
│   └── test_manifest_pipeline.py
├── vendor/vox-profile-release/   # tiantiaf 소스(src.model.age_sex 임포트 경로용; clone 필요)
├── models/age_model/             # local provider용 학습 체크포인트 자리(현재 비어있음)
├── artifacts/                    # 배치 평가 산출물(mp3 + csv + summary.json)
├── training/                     # AIHub 71320 학습 파이프라인(원격 전용, 데모와 무관)
├── .env.example, README.md, run_local.sh
├── requirements.txt, requirements-public-age.txt
└── .venv/
```

**app.py 엔드포인트 전부(정본):**
- `POST /analyze` — multipart `file`, `Authorization` 헤더(옵션). → `AnalyzeResult`.
- `GET  /health` — `{ ok, age_model, age_model_provider, age_model_ready, stt_model, elevenlabs_ready }`.
- `GET  /demo` — `static/demo.html` 대시보드.
- `GET  /demo/voice-presets` — `{ age_groups, voice_counts }`.
- `POST /demo/random-age-voice` — 연령대별 보이스 ID + 텍스트 선택(JSON, 오디오 없음).
- `POST /demo/random-age-voice/audio` — 위 선택을 ElevenLabs 로 합성 → `audio/mpeg`(헤더에 X-Age-Group/X-Language/X-Voice-Id/X-Demo-Text).
- `POST /demo/generate-and-analyze` — 합성 → `/analyze` 파이프라인 검증을 한 응답에.
- 정적 마운트: `/static` (`static/` 존재 시).

---

## 5. 독립 개발 (다른 모듈 mock)

A는 다른 모듈에 의존하지 않는다(소비자는 D). 단독 검증 방법:
- **오디오 입력 mock**: `/demo/random-age-voice/audio` 로 합성 mp3 받아서 그걸 `/analyze` 에 넣거나, 임의 wav 로 multipart 호출.
- **ElevenLabs 없이 추론만**: `ELEVENLABS_API_KEY` 미설정 → `/demo/*audio*` 계열은 503(`ELEVENLABS_API_KEY is not set`), `/analyze` 는 정상 동작.
- **나이 모델 없이**: `AGE_MODEL_PROVIDER=local` + 체크포인트 없음 → `MissingAgeModel`(group `"unknown"`, confidence 0)로 graceful fallback.
- **STT 없이**: `STT_MODEL=none` → `NoopSTT`(transcript `""`).
- D 쪽에서 A를 mock 하려면 §3-1 예시 JSON 을 그대로 사용.

---

## 6. 실행 (env 포함)

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/module-a
python3.11 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements-public-age.txt           # 공개 나이모델 모드
git clone https://github.com/tiantiaf0627/vox-profile-release.git vendor/vox-profile-release
export ELEVENLABS_API_KEY='...'                       # 데모 보이스 생성용(추론만이면 불필요)
AGE_MODEL_PROVIDER=wavlm_age_sex ./run_local.sh       # → http://127.0.0.1:8000
```

**환경변수(코드 근거 — app.py / elevenlabs_voice.py):**
| 변수 | 기본값 | 의미 |
|---|---|---|
| `AGE_MODEL_PROVIDER` | `local`(app.py 기본) / `wavlm_age_sex`(.env.example·run_local.sh) | `local`=학습 체크포인트, `wavlm_age_sex`=공개 vox-profile 모델 |
| `AGE_MODEL_PATH` | `./models/age_model` | local provider 체크포인트 경로 |
| `AGE_DEVICE` | (빈값→자동: mps/cuda/cpu) | 추론 디바이스 |
| `STT_MODEL` | `small` | faster-whisper 모델. `none/noop/off/disabled` → NoopSTT |
| `STT_DEVICE` / `STT_COMPUTE_TYPE` | `cpu` / `int8` | STT 실행 설정 |
| `API_KEY` | (빈값) | 설정 시 `/analyze` 에 `Authorization: Bearer <key>` 요구 |
| `ELEVENLABS_API_KEY` | (빈값) | 미설정 시 데모 합성 503 |
| `ELEVENLABS_MODEL_ID` | `eleven_multilingual_v2` | TTS 모델 |
| `ELEVENLABS_AGE_VOICE_MAP_JSON` | (빈값→DEFAULT_AGE_VOICE_MAP) | 연령대→voice_id 목록 override(JSON) |

예시 호출:
```bash
# 추론
curl -F file=@sample.wav http://127.0.0.1:8000/analyze
# (API_KEY 설정 시) -H "Authorization: Bearer $API_KEY"

# 보이스 생성
curl -X POST http://127.0.0.1:8000/demo/random-age-voice/audio \
  -H 'content-type: application/json' \
  -d '{"age_group":"50+","language":"en","seed":1}' -o sample.mp3

# 생성→검증 한 번에
curl -X POST http://127.0.0.1:8000/demo/generate-and-analyze \
  -H 'content-type: application/json' \
  -d '{"age_group":"50+","target_decade":"60대","language":"en","seed":7}'
```

---

## 7. 테스트 · 검증

**유닛 테스트(읽기전용 실행 결과 — 본 명세 작성 중 정본에서 실제 실행):**
```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/module-a
PYTHONPATH=. .venv/bin/python -m unittest discover -s tests
# → Ran 15 tests in 0.069s — OK ✅
```
커버: 나이 라벨 매핑·child_prob·numpy 스칼라·provider 팩토리 분기(`test_age_public_model`), STT none→NoopSTT(`test_stt_config`), ElevenLabs 별칭/언어/voice-map/payload(`test_elevenlabs_voice`), 배치 프롬프트/decade 매핑(`test_age_demo_batch`), 매니페스트 파이프라인(`test_manifest_pipeline`).

**배치 평가(합성음성 정확도 — `artifacts/age-demo-batch-en-v2/age_demo_batch_en_100_summary.json` 인용):**
en 100건(decade별 10건) 생성→검증 결과 **exact decade match = 7/100**.
- decade별 `avg_years_est`: 0대 44.7 / 10대 40.2 / 20대 51.2 / 30대 44.0 / 40대 54.9 / 50대 46.1 / 60대 50.9 / 70대 50.0 / 80대 48.6 / 90대 49.3 → **전 구간이 ~40~55세 부근에 수렴** → 모델이 합성음의 실제 연령대를 거의 구분 못 함.
- 최고는 40대(4/10), 30대(2/10), 50대(1/10), 나머지 decade 0. **합성(TTS) 음성에 대한 나이 추정은 신뢰 불가** — 데모 시 실연령 신뢰 지표로 쓰지 말 것. (주원인: TTS 보이스가 연령대를 음향적으로 충분히 분리하지 못함 + 모델이 합성음 분포 밖.)

---

## 8. 변경 금지

- 이 세션(명세 작성자)은 **이 파일(`specs/MODULE_A.md`)만 Write** 한다.
- `module-a/` 의 코드, `contracts/types.ts`, 다른 모듈/스펙 파일은 **수정 금지**(읽기·합의만).
- 계약 불일치(§9)는 *기록*만 하고, 실제 수정(매핑 추가 등)은 owner(Codex) 또는 통합 단계에서 결정.

---

## 9. 현재 상태 (사실 그대로 — 코드/실행 근거)

1. **나이 라벨 언어 = 한국어 decade.** `inference/age.py::age_years_to_group` → `"10대"|"20대"|"30대"|"40대"|"50+"`. `behavioral.py::score_behavioral` 의 50+ 보조 가산 분기도 `{"50+","50대","60대 이상","elder"}` 한국어/혼합 라벨을 인식. ↔ `contracts/types.ts` 의 `AgeGroup="50+"|"under50"` 와 **불일치**(§3-1 ⚠). 통합 시 decade→이진 매핑 필요.
2. **STT 활성 여부 = 모드 의존.** 기본 `STT_MODEL=small`(faster-whisper 동작, transcript 채움). 그러나 README 의 ElevenLabs 데모 권장 실행은 `STT_MODEL=none` → `NoopSTT` → **transcript 빈값** → `behavioral`(speech_rate/filler_count)이 텍스트 기반이라 사실상 무의미해짐(나이 보조 가산만 남음). 데모 구성에 따라 행동신호 유효성이 달라짐을 명시.
3. **합성음성 나이 정확도 한계.** 배치 100건 exact match 7/100, 전 구간 ~40~55세 수렴(§7 인용). 합성음 기반 연령 검증은 데모 시연용일 뿐 정확도 보장 못 함.
4. **나이 모델 = `tiantiaf/wavlm-large-age-sex`** (vox-profile vendored, `VoxProfileWavLMAgeSexClassifier`). `vendor/vox-profile-release` 가 있어야 임포트 성공(없으면 RuntimeError). `models/age_model/` 은 비어 있어 `local` provider 는 현재 `MissingAgeModel` 로 fallback → 데모는 `wavlm_age_sex` 권장. 입력은 16kHz, 내부에서 15초로 절단(`_prepare_audio`).
5. **ElevenLabs 데모 = 정상 코드 경로.** API 키 있으면 `/demo/*` 동작, 없으면 503. DEFAULT_AGE_VOICE_MAP 는 ElevenLabs premade voice ID(연령 인상 약함) — 계정 보이스로 `ELEVENLABS_AGE_VOICE_MAP_JSON` override 권장.
6. **정본 경로 = 리포 루트(심링크).** `voice-adaptive-kiosk/module-a -> ../module-a`. 작업·실행은 리포 루트 `module-a` 에서.
7. **구 VOICEGEN(standalone) → 폐기, 정본 `/demo/*` 사용.**
8. **유닛 테스트 15개 통과**(§7).

---

## 10. 병합 체크포인트

- [ ] **계약 정합**: `/analyze` 의 `age.group` decade → `AgeGroup("50+"|"under50")` 매핑을 A 응답 또는 D 소비측에서 확정(누가 매핑할지 owner와 합의). `"unknown"` fallback 케이스 처리도 포함.
- [ ] **데모 STT 모드 결정**: 행동신호를 시연하려면 `STT_MODEL=small`(transcript 채움), 보이스 생성 위주면 `none`. 데모 시나리오별 env 고정.
- [ ] **나이 정확도 디스클레이머**: 합성음 검증은 정확도 보장 못 함(7/100). UI/발표에서 "행동신호가 적응 주축, 나이는 보조" 메시지 유지.
- [ ] **포트 8000** 고정, D(5173)에서 호출. CORS/네트워크 통합 시 확인.
- [ ] **의존 준비**: `vendor/vox-profile-release` clone + `ELEVENLABS_API_KEY` + (선택)계정 voice-map. `/health` 로 `age_model_ready`·`elevenlabs_ready` 점검.
- [ ] **계약 변경 시** `contracts/types.ts` 정본만 수정 후 전 모듈 동기화(이 명세 단독 수정 아님).
