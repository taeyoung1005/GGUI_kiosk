# 음성 적응형 키오스크 — 개발 플랜 (모듈 분리)

> OBA Weekend-thon S1 · GGUI 트랙 집중 (EXAONE/LG U+ 트랙 제외)
> 원칙: **4개 모듈을 API 계약으로 분리** → 각자 상대를 mock하며 병렬 개발 → 계약대로 통합

---

## 0. 모듈 구성도

```
┌─────────────────────── 원격 개인 서버 (GPU) ───────────────────────┐
│  Module A — AI 추론 서버 (FastAPI)                                   │
│   · STT (faster-whisper)                                            │
│   · 나이·성별 분류 (vox-profile WavLMWrapper: tiantiaf/wavlm-large-age-sex) │
│   · 행동신호 (VAD+타임스탬프 → assist_level)                        │
│   · [오프라인] 나이 probe 학습 파이프라인                           │
│   ▶ POST /analyze (audio → 분석결과 JSON)                           │
└────────────────────────────────────────────────────────────────────┘
            ▲ HTTPS + API Key (오디오 업로드)
            │
┌───────────┴───────────── 로컬 / 배포 ──────────────────────────────┐
│  Module D — 웹 키오스크 프론트 (React, @ggui-ai/react)              │
│   · 일반 키오스크 UI (static)  ← before / 폴백                      │
│   · GGUI 적응 UI (embed)       ← after                              │
│   · 마이크 캡처 · 흐름 제어                                          │
│        │ GET /menu        │ POST /generate-ui     │ POST /orders    │
│        ▼                  ▼                       ▼                 │
│  Module B — 메뉴/주문    Module C — GGUI 생성     (B에 포함)         │
│   백엔드(DB)             서비스(GGUI+Claude)                        │
└────────────────────────────────────────────────────────────────────┘
```

**데이터 흐름 (발화 1회):**
1. D가 마이크 오디오 → **A** `/analyze` → `{transcript, age, assist_level}`
2. D가 **B** `/menu`로 메뉴 확보
3. D가 `{transcript, age, assist_level, menu}` → **C** `/generate-ui` → 적응 UI(embed_url)
4. D가 GGUI iframe 임베드 + 렌더, 사용자 선택
5. 확정 → D가 **B** `/orders` (mock 결제) → "결제 완료"

---

## Module A — AI 추론 서버 (★ 원격 개인 서버)

| 항목 | 내용 |
|------|------|
| 책임 | 음성 → 텍스트(STT) + 나이대 분류 + 행동신호 |
| 스택 | Python · FastAPI · faster-whisper · vox-profile WavLM(age-sex) · torch/speechbrain/loralib · silero-vad |
| 실행 | 원격 GPU 서버. 외부 노출 = HTTPS 또는 cloudflared/ngrok 터널 |
| 인증 | `Authorization: Bearer <API_KEY>` |

### 인터페이스
```
POST /analyze
  Content-Type: multipart/form-data (file=audio.wav, 16kHz mono)
  또는 application/json { "audio_base64": "..." }

200 →
{
  "transcript": "라떼 하나 주세요",
  "language": "ko",
  "age": { "group": "50+", "years_est": 67, "confidence": 0.72, "child_prob": 0.02 },
  "behavioral": { "speech_rate": 2.8, "silence_ratio": 0.46, "filler_count": 2, "assist_level": 2 },
  "duration_ms": 1850
}
```
- (선택) `/stt`, `/age`로 분리 노출 가능. 기본은 `/analyze` 단일 호출.
- `assist_level` 0~3 = UI 강도. **나이 부정확해도 이 행동신호가 스파인.**

### 나이 신호

현재 데모는 AIHub 직접 학습을 제거하고 public pretrained
`tiantiaf/wavlm-large-age-sex`를 사용한다. 나이는 rough signal이고,
`assist_level`이 UI 적응의 주 신호다.

### 독립 개발 방법
- 통합 전: 고정 JSON 반환하는 mock `/analyze`부터 띄움 → D가 바로 붙음.
- `curl -F file=@test.wav .../analyze`로 단독 검증.

---

## Module B — 메뉴/주문 백엔드 (DB)

| 항목 | 내용 |
|------|------|
| 책임 | 메뉴 데이터 제공 + 주문 + mock 결제 |
| 스택 | Node(Express)/FastAPI · SQLite 또는 JSON 파일 |
| 데이터 | **시드 JSON**(실제 식당 메뉴 1곳 손입력) → 시간되면 API Fuse 요기요 |

### 스키마
```
menu_items: id, name, category, price, image_url, desc
options:    id, item_id, type(사이즈/온도/토핑), choices[{label, price_delta}]
orders:     id, items[{item_id, options, qty}], total, status
```

### 인터페이스
```
GET  /menu                 → { categories, items:[{...options}] }
GET  /menu/search?q=라떼    → { items:[...] }        (선택, 없으면 D/C가 필터)
POST /orders  { items:[...] } → { order_id, total, status:"paid" }   # mock
GET  /orders/:id           → { status }
```

### 독립 개발
- 시드 JSON만 있으면 즉시 완성. A·C 없이도 단독 동작.

---

## Module C — GGUI 적응 UI 생성 서비스

| 항목 | 내용 |
|------|------|
| 책임 | {전사+나이대+assist+메뉴} → 노인친화 적응 UI 생성 (두뇌+렌더 = Claude) |
| 스택 | Node · @ggui-ai/* · GGUI MCP 서버 · Claude API(BYOK) |
| 비고 | EXAONE 없음. Claude가 "라떼 매칭·추천 + UI 생성"을 한 번에 |

### 인터페이스
```
POST /generate-ui
{
  "transcript": "라떼 하나 주세요",
  "age_group": "50+",
  "assist_level": 2,
  "menu_context": [ ...후보 또는 전체 메뉴... ],
  "step": "recommend" | "options" | "confirm"
}
200 →
{
  "render_id": "abc123",
  "embed_url": "http://<ggui-host>/r/<shortCode>",   // @ggui-ai/react로 임베드
  "contract": { "actionSpec": {...} }                 // 사용자 액션 정의
}
```
- D는 `embed_url`을 iframe 임베드, `ggui_consume`으로 사용자 액션 수신.
- UI 규율: 큰 카드 2~3장 + 예/아니요, assist_level↑ → 글자·여백·음성안내 강화. **구조 고정, 내용만 적응.**

### 독립 개발
- GGUI 스캐폴드(`create-agentic-app`) + Claude만으로 "프롬프트→UI" 먼저 검증.
- A·B mock 데이터로 단독 테스트.

---

## Module D — 웹 키오스크 프론트

| 항목 | 내용 |
|------|------|
| 책임 | 화면 2종(일반/GGUI) · 마이크 캡처 · 전체 흐름 오케스트레이션 |
| 스택 | React · @ggui-ai/react · Web Audio API/MediaRecorder · 브라우저 speechSynthesis(TTS) |

### 두 UI 모드 (★ 핵심)
- **일반 키오스크 UI (static)**: 평소 빽빽한 메뉴 그리드. = 데모 "before" + GGUI 실패 폴백.
- **GGUI 적응 UI**: 음성 입력 시 C가 생성한 화면 임베드. = "after".
- → **before/after 대조가 메리트 증명.** 둘 다 구현 필수.

### 흐름
```
마이크 → A.analyze → (B.menu) → C.generate-ui → GGUI embed 렌더
       → 사용자 선택 → (옵션 확정) → B.orders(mock) → "결제 완료" + TTS
```

### 독립 개발
- A·B·C를 전부 mock(고정 JSON)으로 두고 화면/흐름 먼저 완성 → 실제 서비스로 교체.

---

## 모듈 간 데이터 계약 (병렬 개발의 핵심)

각 팀은 아래 JSON 형태에만 합의하면 **서로를 기다리지 않고** 개발 가능:
- `AnalyzeResult` (A→D): transcript, age, behavioral.assist_level
- `Menu` / `MenuItem` (B→D,C)
- `GenerateUIRequest` / `GenerateUIResponse` (D→C)
- `OrderRequest` / `OrderResponse` (D→B)

> 권장: 위 타입을 `contracts/` 공유 폴더(JSON Schema 또는 TS 타입) 하나로 두고 4모듈이 참조.

---

## 병렬 트랙 & 통합 순서

| 트랙 | 담당 모듈 | 선행 mock | 통합 시점 |
|------|----------|-----------|----------|
| T1 (★ 본인) | A — 원격 AI 서버 | — (curl로 단독) | D가 mock→실서버 전환 |
| T2 | B — 메뉴/주문 | 시드 JSON | 즉시 가능 |
| T3 | C — GGUI 생성 | A·B mock | GGUI 단독 검증 후 |
| T4 | D — 프론트 | A·B·C 전부 mock | 마지막에 실서비스 결선 |

### 빌드 우선순위 (좁고 끝까지)
1. **D + mock**: 일반 UI + "가짜 분석결과"로 화면 흐름 완성
2. **C 단독**: 프롬프트→GGUI UI 생성 검증
3. **A `/analyze`**: 실제 음성→transcript+나이 (원격)
4. **결선**: D가 mock 떼고 A·B·C 연결 → end-to-end
5. **완결**: 옵션확정 + mock결제 + TTS + 멀티턴/복구

---

## 원격 서버(Module A) 연결 체크리스트
- [ ] 외부 노출: HTTPS 도메인 또는 `cloudflared tunnel`/`ngrok`
- [ ] API Key 인증 + CORS(프론트 도메인 허용)
- [ ] 오디오 페이로드 최소화: 16kHz mono, opus/wav 압축
- [ ] latency 예산: 업로드+STT+나이 < ~2초 목표 (행사장 네트워크 변동 대비 타임아웃·폴백)
- [ ] 폴백: A 무응답 시 D는 일반 UI로 진행(음성 없이 터치 주문)
