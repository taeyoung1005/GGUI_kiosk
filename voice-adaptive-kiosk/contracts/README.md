# contracts/ — 공유 데이터 계약 (정본)

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
> 모듈 A(AI)·B(메뉴/주문)·C(GGUI 생성)·D(웹 프론트)의 **단일 진실 공급원(SSoT)**.

## 핵심 원칙

**각 모듈은 이 형태에 합의하고 서로 mock 한다.**
4개 팀이 아래 JSON 형태에만 합의하면, 상대 모듈이 없어도 고정 데이터(mock)로
**서로를 기다리지 않고 병렬 개발**할 수 있다. 통합 시점에 mock 을 실서비스로 교체한다.

`types.ts` 가 **정본(canonical)** 이다. `schemas.py`(파이썬 미러), `mocks.ts/mocks.json`
(샘플)은 항상 `types.ts` 를 따른다. 계약이 바뀌면 **반드시 4개 파일을 함께 갱신**한다.

## 파일 구성

| 파일 | 역할 | 사용 모듈 |
|------|------|-----------|
| `types.ts` | **정본** TypeScript 타입 정의 | C, D (직접 import), 전체 (참조 기준) |
| `schemas.py` | `types.ts` 의 pydantic v2 미러 | A (FastAPI 요청/응답 검증) |
| `mocks.json` | mock 샘플 데이터 (언어 중립 JSON) | 전체 (mock 모드 데이터 원본) |
| `mocks.ts` | `mocks.json` 에 타입을 입힌 typed export | C, D |
| `README.md` | 이 문서 | — |

## 계약 목록 & 데이터 흐름

```
D --audio(wav 16kHz)--> A  /analyze   --> AnalyzeResult
D --GET-------------->  B  /menu       --> Menu
D --GenerateUIRequest-> C  /generate-ui --> GenerateUIResponse  (embed_url)
D --OrderRequest----->  B  /orders     --> OrderResponse  (mock 결제)
```

### 1. `AnalyzeResult`  (A → D)
음성 → 전사(`transcript`) + 나이대(`age`) + 행동신호(`behavioral`).
- **적응 주축 = `behavioral.assist_level` (0~3)**. 나이(`age.group`: `"50+" | "under50"`)는 보조.
- 나이 분류가 부정확해도 행동신호가 스파인이라 UI 강도가 결정된다.

### 2. `Menu` / `MenuItem` / `MenuOption`  (B → D, C)
식당 1곳의 시드 메뉴. `MenuItem.options[]` 에 온도·사이즈 등 선택지와 `price_delta` 포함.

### 3. `GenerateUIRequest` / `GenerateUIResponse`  (D → C)
`{transcript, age_group, assist_level, menu_context, step}` → GGUI(OpenAI GPT)가
추천 + 노인친화 적응 UI 생성 → `{render_id, embed_url, contract}`.
- **구조 고정(큰 카드 2~3 + 예/아니요), 내용만 적응.** `assist_level`↑ → 글자·여백·음성안내 강화.
- `contract` 는 GGUI 런타임이 정의하는 자유 형식(actionSpec 등) → `any`/`dict`.

### 4. `OrderRequest` / `OrderResponse` / `OrderLine`  (D → B)
선택 확정 → 주문. 결제는 **mock — 항상 `status: "paid"`**.

## 사용법

### TypeScript (Module C, D)
```ts
import type { AnalyzeResult, Menu, GenerateUIRequest } from "../contracts/types";
import { sampleAnalyzeResult, sampleMenu } from "../contracts/mocks";

// mock 모드: 백엔드 없이 고정 데이터로 흐름 개발
const analyze: AnalyzeResult = sampleAnalyzeResult; // 어르신·assist_level 2
```
> `mocks.ts` 는 `mocks.json` 을 import 한다. `tsconfig.json` 에
> `"resolveJsonModule": true`, `"esModuleInterop": true` 를 켜라.

### Python (Module A)
```py
from contracts.schemas import AnalyzeResult, AgeInfo, BehavioralInfo

result = AnalyzeResult(
    transcript="라떼 하나 주세요",
    language="ko",
    age=AgeInfo(group="50+", years_est=67, confidence=0.72, child_prob=0.02),
    behavioral=BehavioralInfo(speech_rate=2.8, silence_ratio=0.46, filler_count=2, assist_level=2),
    duration_ms=1850,
)
# FastAPI: @app.post("/analyze", response_model=AnalyzeResult)
```
> `contracts/` 를 패키지로 import 하려면 sys.path 또는 PYTHONPATH 에 리포 루트를 추가하거나,
> Module A 에서 상대 경로로 `schemas.py` 를 참조한다.

## mock 샘플 (mocks.json / mocks.ts)

| 키 / export | 설명 |
|-------------|------|
| `sampleAnalyzeResult` / `…Elder` | 느린 어르신 "라떼 하나 주세요", `50+`, `assist_level 2` |
| `sampleAnalyzeResultYouth` | 빠른 청년 동일 발화, `under50`, `assist_level 0` |
| `sampleMenu` | OBA 카페 시드 메뉴 (커피/음료/디저트, 옵션 포함) |
| `sampleGenerateUIRequest` / `…Response` | C 입출력 예시 (`embed_url` 포함) |
| `sampleOrderRequest` / `…Response` | 주문/ mock 결제 예시 (`status: "paid"`) |

> **적응 증명 포인트:** `sampleAnalyzeResult`(어르신, assist 2)와 `sampleAnalyzeResultYouth`
> (청년, assist 0)는 **같은 발화**지만 행동신호가 달라 서로 다른 UI 강도를 만든다.
