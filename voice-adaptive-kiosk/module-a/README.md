# Module A — AI 추론 서비스

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
> 책임: **음성(wav 16kHz) → `AnalyzeResult`** (STT 전사 + 나이대 + 행동신호 `assist_level`)

```
음성 ─► [VAD] ─► [STT(faster-whisper)] ─► transcript + 단어 타임스탬프
            └─► [나이 분류(wav2vec2)] ─► age.group("50+"/"under50")
            └─► [행동신호 룰] ─► speech_rate · silence_ratio · filler · assist_level(0~3)
                                                                 └─► AnalyzeResult
```

- **적응 신호 주축 = 행동신호(`assist_level` 0~3)**, 나이(`age`)는 보조.
- 응답 스키마는 공유 계약 `contracts/schemas.py`(= `contracts/types.ts` 미러)를 그대로 사용.
- **`MOCK_MODE=1`(기본): 외부 모델/키 없이 즉시 기동** → `/analyze` 가 유효한 `AnalyzeResult` 반환.

---

## 1. 빠른 시작 (mock, 외부 모델 불필요)

```bash
cd module-a
python -m venv .venv && source .venv/bin/activate     # 선택
pip install fastapi "uvicorn[standard]" pydantic python-multipart numpy
# (또는) pip install -r requirements.txt   # 실모델 포함 전체

cp .env.example .env        # MOCK_MODE=1 기본
uvicorn app:app --port 8000 # 또는: python app.py
```

헬스체크 / 분석 호출:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","mock_mode":true,...}

# mock 모드에서는 오디오 없이도 동작(고정 시나리오: 느린 어르신 발화)
curl -s -X POST http://localhost:8000/analyze
# → AnalyzeResult JSON (assist_level 높게 나옴)

# 실제 오디오(multipart)
curl -s -X POST http://localhost:8000/analyze -F "file=@test.wav"

# base64 JSON
curl -s -X POST http://localhost:8000/analyze \
  -H "Content-Type: application/json" \
  -d "{\"audio_base64\":\"$(base64 -i test.wav)\"}"
```

응답 예 (mock):

```json
{
  "transcript": "어 라떼 음 하나 주세요",
  "language": "ko",
  "age": { "group": "50+", "years_est": 67, "confidence": 0.72, "child_prob": 0.02 },
  "behavioral": { "speech_rate": 1.x, "silence_ratio": 0.5x, "filler_count": 2, "assist_level": 3 },
  "duration_ms": 4600
}
```

---

## 2. 엔드포인트

| 메서드 | 경로 | 입력 | 출력 |
|--------|------|------|------|
| `GET`  | `/health`  | — | `{status, mock_mode, auth_required, version}` |
| `POST` | `/analyze` | `multipart(file=audio.wav)` 또는 `JSON({audio_base64})` | `AnalyzeResult` |

- 16kHz mono wav 권장. 다른 샘플레이트는 실모드에서 자동 리샘플(librosa).
- `API_KEY` 환경변수가 설정되면 `Authorization: Bearer <API_KEY>` 강제(원격 노출 대비). 비우면 인증 off.

---

## 3. 실모델 모드 (`MOCK_MODE=0`)

```bash
pip install -r requirements.txt        # torch/transformers/faster-whisper/silero-vad/...
# .env 에서:
#   MOCK_MODE=0
#   STT_MODEL=small      (CPU int8)  또는 large-v3
#   AGE_MODEL_PATH=./models/age_model (있으면 우선) / 없으면 AGE_HF_MODEL(audeering) zero-shot
uvicorn app:app --port 8000
```

- 나이: `AGE_MODEL_PATH` 의 fine-tuned 모델 우선 → 없으면 `audeering/wav2vec2-large-robust-24-ft-age-gender`.
- 모델/추론 실패 시 안전 폴백(나이 mock / 에너지 VAD)으로 **무중단** — 행동신호가 스파인이라 데모가 끊기지 않음.
- Apple Silicon: `STT_DEVICE=cpu`(또는 mlx-whisper 백엔드), 나이 모델은 MPS 자동 선택.

---

## 4. 모듈 구조

```
module-a/
├── app.py                 # FastAPI: POST /analyze, GET /health  (contracts/schemas.py import)
├── inference/
│   ├── stt.py             # faster-whisper 래퍼 (+ mock)
│   ├── age.py             # audeering/fine-tuned wav2vec2 (+ mock, 폴백)
│   ├── vad.py             # silero-vad (+ 에너지 폴백, mock)
│   └── behavioral.py      # ★순수 함수: speech_rate/silence/filler → assist_level
├── models/age_model/      # 이식된 학습 모델 자리 (config + safetensors)
├── training/              # 원격 GPU 전용 학습 파이프라인 (01~06)
├── tests/test_behavioral.py
├── requirements.txt
├── .env.example
└── README.md
```

---

## 5. 테스트 (행동신호 룰)

```bash
cd module-a
pytest -q                              # pytest 설치 시
# 또는 pytest 없이:
python tests/test_behavioral.py
```

`behavioral.py` 의 모든 계산은 순수 함수 → 모델 없이 룰 검증 가능.

---

## 6. 학습 파이프라인 (원격 GPU, 4060Ti ×2)

> 추론은 로컬, **학습만 원격**. 산출물(`models/age_model`)을 scp 로 이식.

| 단계 | 스크립트 | 내용 |
|------|----------|------|
| 1 | `01_download.py` | AIHub `71320` "연령대별 특징적 발화" 다운로드·병합 |
| 2 | `02_index.py` | `Speakers[].Agegroup` + `Dialogs[].Start/EndTime` 인덱싱 → 이진 라벨 |
| 3 | `03_clips.py` | 구간 클립 생성(16kHz mono wav) |
| 4 | `04_split.py` | **★화자 단위** train/valid/test (누수 방지) |
| 5 | `05_train.py` | wav2vec2/HuBERT fine-tune (하위층 freeze + grad accum) |
| 6 | `06_eval_export.py` | 평가(vs audeering) + `save_pretrained(models/age_model)` |

```bash
# 원격 (단일 GPU 재현 → DDP 확장)
python training/01_download.py
python training/02_index.py
python training/03_clips.py
python training/04_split.py
python training/05_train.py                          # 단일 GPU
torchrun --nproc_per_node=2 training/05_train.py     # 2×4060Ti DDP
python training/06_eval_export.py                    # → models/age_model/
```

라벨: `화자연령대` → **이진 "50+ vs under50"**(데이터 최상단이 50+ 라 60+ 분리는 불가 → 타깃을 50+ 로 정의).

### 모델 이식 (원격 → 로컬)

```bash
# 원격 학습/내보내기 후
scp -r oba-4060ti:~/module-a/models/age_model ./module-a/models/age_model
# 로컬: .env 에서 AGE_MODEL_PATH=./models/age_model, MOCK_MODE=0 → 동일 코드 추론
```

---

## 7. 원격 노출 (폴백 추론 서버)

동일 `app.py` 를 원격 서버에서도 실행. 프론트(Module D)는 `VITE_ANALYZE_URL` 만 교체.

```bash
# 원격: API_KEY 설정 + 터널/HTTPS 노출
API_KEY=<secret> MOCK_MODE=0 uvicorn app:app --host 0.0.0.0 --port 8000
cloudflared tunnel --url http://localhost:8000      # 또는 ngrok http 8000
```

체크리스트: HTTPS/터널 · `Authorization: Bearer` · CORS(`CORS_ORIGINS`) · 16kHz mono 페이로드 최소화 · latency<~2s · A 무응답 시 D는 일반 UI 폴백.
