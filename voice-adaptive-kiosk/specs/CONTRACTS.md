# CONTRACTS — 공유 데이터 계약 (병합 linchpin)

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 언어 = 영어
> **이 문서는 모듈 A·B·C·D 가 합의하는 단일 계약서(SSoT)다.**
> 정본 파일: `contracts/types.ts`. 미러: `contracts/schemas.py`(pydantic v2). 샘플: `contracts/mocks.json` + `contracts/mocks.ts`.
>
> ⚠️ **이 계약을 바꾸면 4개 모듈 전부에 영향이 간다. 변경은 반드시 4모듈 합의 후, `types.ts`·`schemas.py`·`mocks.json`·`mocks.ts` 를 함께 갱신한다. 어느 모듈도 단독으로 이 계약을 변경하지 않는다.**

이 문서는 모듈 명세 템플릿 중 **1(목적·책임)·3(입출력 계약)·8(변경 금지)·10(병합 체크포인트)** 에 집중한다. 각 모듈의 격리 실행/테스트는 해당 모듈 명세(`specs/MODULE_*.md`)에 있다.

---

## 1. 목적·책임 (이 계약 파일의 범위)

- **무엇:** 4모듈이 주고받는 모든 JSON 페이로드의 정확한 타입 + 예시 + 생산/소비 매핑.
- **왜:** 사용자는 모듈을 **각자 독립 세션에서 개발·검증한 뒤 마지막에 한 번에 병합**한다. 그 병합이 맞물리는 **유일한 근거가 이 계약**이다. 다른 모듈은 이 계약 기반 mock(`contracts/mocks.json`)으로 대체해 격리 개발한다.
- **범위 밖:** 모듈 내부 로직, 엔드포인트 구현 디테일, UI 스타일 — 계약은 **입출력 형태에만** 관여한다.

### 파일 구성 (contracts/)

| 파일 | 역할 | 직접 사용 모듈 |
|------|------|----------------|
| `contracts/types.ts` | **정본** TypeScript 타입 | C·D (import), 전체 (참조 기준) |
| `contracts/schemas.py` | `types.ts` 의 pydantic v2 미러 | A (FastAPI 요청/응답 검증·`response_model`) |
| `contracts/mocks.json` | mock 샘플 데이터 (언어 중립 JSON) | 전체 (mock 모드 데이터 원본) |
| `contracts/mocks.ts` | `mocks.json` 에 타입 입힌 typed export | C·D |
| `contracts/README.md` | 사용법 요약 | — |

> mock 데이터 위치 = **`contracts/mocks.json`(정본 샘플)** + **`contracts/mocks.ts`(typed export)**. (별도 `mocks/` 폴더는 없음.)

---

## 2. 데이터 흐름 & 생산/소비 매핑표

```
D --audio(wav 16kHz)----> A  POST /analyze     --> AnalyzeResult
D --GET----------------->  B  GET  /menu        --> Menu
D --GenerateUIRequest---> C  POST /generate-ui  --> GenerateUIResponse (embed_url)
D --OrderRequest-------->  B  POST /orders       --> OrderResponse (mock 결제 status:"paid")
```

| 계약 타입 | 생산(서버) | 소비(클라이언트) | 채널 / 엔드포인트 | 포트 |
|-----------|-----------|------------------|-------------------|------|
| `AnalyzeResult` | **A** (AI) | **D** (프론트) | `POST /analyze` (multipart wav 또는 base64) | A=8000 |
| `Menu` / `MenuItem` / `MenuOption` | **B** (메뉴) | **D** (프론트), **C** (`menu_context` 로 재사용) | `GET /menu`, `GET /menu/search` | B=8001 |
| `GenerateUIRequest` | **D** (프론트) | **C** (GGUI 생성) | `POST /generate-ui` 요청 본문 | C=8002 |
| `GenerateUIResponse` | **C** (GGUI 생성) | **D** (프론트, iframe 임베드) | `POST /generate-ui` 응답 | C=8002 |
| `OrderRequest` / `OrderLine` | **D** (프론트) | **B** (메뉴/주문) | `POST /orders` 요청 본문 | B=8001 |
| `OrderResponse` | **B** (메뉴/주문) | **D** (프론트) | `POST /orders` 응답 | B=8001 |

> 매핑 요약(과제 표기): **A→D**(AnalyzeResult), **B→D·C**(Menu), **D→C**(GenerateUIRequest)·**C→D**(GenerateUIResponse), **D→B**(OrderRequest)·**B→D**(OrderResponse).
> 포트맵: A=8000, B=8001, C=8002, D(Vite)=5173, GGUI MCP=6781.

---

## 3. 입출력 계약 (타입 + 예시 JSON)

> 아래 타입·필드명은 `contracts/types.ts`(정본)와 **자구까지 일치**한다. 예시 JSON 은 `contracts/mocks.json` 의 실제 샘플이다(데모 언어 = 영어).

### 3.1 `AnalyzeResult` — A → D

음성(wav 16kHz mono) → 전사 + 나이대 + 행동신호.
**적응 주축 = `behavioral.assist_level` (0~3).** 나이(`age.group`)는 보조 신호 — 나이가 부정확해도 행동신호가 UI 강도를 결정한다.

```ts
type AgeGroup = "50+" | "under50";

interface AnalyzeResult {
  transcript: string;        // STT 전사. 예: "Can I get a latte"
  language: string;          // 언어 코드. 데모=영어 → "en" (정본 기본값 "ko")
  age: {
    group: AgeGroup;         // 이진 나이대 (보조 신호)
    years_est: number;       // 추정 나이(년)
    confidence: number;      // 분류 신뢰도 0~1
    child_prob: number;      // 아동 화자 확률 0~1 (안전·오탐 필터)
  };
  behavioral: {
    speech_rate: number;     // 발화 속도(음절/초). 낮을수록 느림
    silence_ratio: number;   // 침묵 비율 0~1. 높을수록 머뭇거림
    filler_count: number;    // 채움말(uh/um/er …) 횟수
    assist_level: 0 | 1 | 2 | 3;  // UI 적응 강도 (주축). 0=일반 … 3=최대 보조
  };
  duration_ms: number;       // 입력 오디오 길이(ms)
}
```

**예시 — 느린 어르신 (`50+`, assist_level 2):** `mocks.sampleAnalyzeResult` = `…Elder`
```json
{
  "transcript": "Can I get a latte",
  "language": "en",
  "age": { "group": "50+", "years_est": 67, "confidence": 0.72, "child_prob": 0.02 },
  "behavioral": { "speech_rate": 2.8, "silence_ratio": 0.46, "filler_count": 2, "assist_level": 2 },
  "duration_ms": 1850
}
```

**예시 — 빠른 청년 (`under50`, assist_level 0):** `mocks.sampleAnalyzeResultYouth`
```json
{
  "transcript": "Can I get a latte",
  "language": "en",
  "age": { "group": "under50", "years_est": 24, "confidence": 0.81, "child_prob": 0.01 },
  "behavioral": { "speech_rate": 5.6, "silence_ratio": 0.08, "filler_count": 0, "assist_level": 0 },
  "duration_ms": 920
}
```

> **적응 증명 포인트:** 두 샘플은 **같은 발화**("Can I get a latte")지만 행동신호가 달라 서로 다른 `assist_level` → 서로 다른 UI 강도를 만든다. (데모 핵심)

### 3.2 `Menu` / `MenuItem` / `MenuOption` — B → D·C

식당 1곳 시드 메뉴(영어 카페 "OBA Cafe"). `MenuItem.options[]` 에 온도·사이즈 등과 `price_delta`. 메뉴 데이터 산출물(`module-b/data/menu.seed.json` + SVG)은 `MENU_DATA_SPEC.md` 소관이며, 형태는 이 `MenuItem` 을 준수한다.

```ts
interface MenuOptionChoice { label: string; price_delta: number; }   // price_delta 기본 0
interface MenuOption       { type: string; choices: MenuOptionChoice[]; }  // type 예: "Temperature","Size"
interface MenuItem {
  id: string;          // 예: "caffe-latte-003"
  name: string;
  category: string;    // 예: "Latte"
  price: number;       // 기본 가격(원)
  image_url: string;   // 예: "/img/menu/caffe-latte-003.svg"
  desc: string;
  options: MenuOption[];
}
interface Menu { restaurant: string; categories: string[]; items: MenuItem[]; }
```

**예시 — `mocks.sampleMenu` (발췌):**
```json
{
  "restaurant": "OBA Cafe",
  "categories": ["Coffee", "Latte", "Tea", "Ade", "Beverage", "Dessert"],
  "items": [
    {
      "id": "caffe-latte-003", "name": "Caffe Latte", "category": "Latte",
      "price": 4500, "image_url": "/img/menu/caffe-latte-003.svg",
      "desc": "Classic espresso with silky steamed milk.",
      "options": [
        { "type": "Temperature", "choices": [{ "label": "Hot", "price_delta": 0 }, { "label": "Iced", "price_delta": 0 }] },
        { "type": "Size", "choices": [{ "label": "Regular", "price_delta": 0 }, { "label": "Large", "price_delta": 500 }] },
        { "type": "Milk", "choices": [{ "label": "Whole Milk", "price_delta": 0 }, { "label": "Low-Fat Milk", "price_delta": 0 }, { "label": "Oat Milk", "price_delta": 600 }] },
        { "type": "Sweetness", "choices": [{ "label": "Regular", "price_delta": 0 }, { "label": "Less Sweet", "price_delta": 0 }, { "label": "Extra Sweet", "price_delta": 300 }] }
      ]
    }
  ]
}
```

> 옵션 없는 항목은 `"options": []`(예: `new-york-cheesecake-017`). latte 변형 ≥5종(모호 발화→추천 데모 핵심)은 `MENU_DATA_SPEC.md` 요구.

### 3.3 `GenerateUIRequest` / `GenerateUIResponse` — D → C → D

D 가 `{transcript, age_group, assist_level, menu_context, step}` 를 보내면 C(GGUI=OpenAI GPT BYOK, 또는 키 없는 LOCAL 폴백)가 추천+적응 UI 를 생성해 `{render_id, embed_url, contract}` 반환. D 는 `embed_url` 을 iframe 임베드한다.
**구조 고정(큰 카드 2~3 + 예/아니요), 내용만 적응.** `assist_level`↑ → 글자·여백·음성안내 강화.

```ts
interface GenerateUIRequest {
  transcript: string;
  age_group: AgeGroup;             // "50+" | "under50"
  assist_level: 0 | 1 | 2 | 3;
  menu_context: MenuItem[];        // 후보 또는 전체 메뉴 아이템 (B 의 MenuItem 재사용)
  step: "recommend" | "options" | "confirm";  // 멀티턴 단계
}

interface GenerateUIResponse {
  render_id: string;               // 생성된 렌더 식별자
  embed_url: string;               // @ggui-ai/react 로 임베드할 URL
  contract: any;                   // actionSpec 등 — 형태는 GGUI 런타임에 위임 (자유 형식)
}
```

**요청 예시 — `mocks.sampleGenerateUIRequest` (menu_context 발췌):**
```json
{
  "transcript": "Can I get a latte",
  "age_group": "50+",
  "assist_level": 2,
  "menu_context": [ { "id": "caffe-latte-003", "name": "Caffe Latte", "...": "MenuItem 들" } ],
  "step": "recommend"
}
```

**응답 예시 — `mocks.sampleGenerateUIResponse`:**
```json
{
  "render_id": "abc123",
  "embed_url": "http://localhost:6781/r/sH9xK",
  "contract": { "actionSpec": { "selectMenu": { "label": "Order This", "nextStep": "options" } } }
}
```

> **`contract` 은 의도적으로 `any`(자유 형식)** — GGUI 런타임/구현이 actionSpec 등을 자유롭게 채운다. **D 는 `contract` 의 구체 키에 강결합하지 말 것**(런타임 위임). 다음은 그 자유의 정당한 예시다:
> - **embed_url 출처는 모드에 따라 다르다.** GGUI 경로 = GGUI 서버(`http://localhost:6781/r/<shortCode>`). C 의 LOCAL 폴백(키·GGUI 미가동) 경로 = C 자기 자신(`http://localhost:8002/r/<id>`)이 HTML 서빙. **D 는 `embed_url` 을 있는 그대로 임베드**해야 하며 host/port 를 가정하지 않는다.
> - LOCAL 폴백 구현은 `contract` 를 `{ actionSpec, intent }` 형태로 채울 수 있다. 계약상 `any` 이므로 유효하다. (`mocks.json` 의 단순 `{ actionSpec }` 도 유효.)

### 3.4 `OrderRequest` / `OrderResponse` / `OrderLine` — D → B

선택 확정 → 주문. **결제는 mock — 항상 `status: "paid"`.** `OrderLine.options` 는 `{ 옵션type: 선택label }` 맵(키·값은 `MenuOption.type` / `MenuOptionChoice.label` 그대로).

```ts
interface OrderLine {
  item_id: string;
  options: Record<string, string>;  // 예: { "Temperature": "Hot", "Size": "Regular" }
  qty: number;                       // 기본 1, ≥1
}
interface OrderRequest  { items: OrderLine[]; }
interface OrderResponse { order_id: string; total: number; status: "paid"; }
```

**요청 예시 — `mocks.sampleOrderRequest`:**
```json
{
  "items": [
    { "item_id": "caffe-latte-003",
      "options": { "Temperature": "Hot", "Size": "Regular", "Milk": "Whole Milk", "Sweetness": "Regular" },
      "qty": 1 }
  ]
}
```

**응답 예시 — `mocks.sampleOrderResponse`:**
```json
{ "order_id": "ord-1001", "total": 4500, "status": "paid" }
```

> `total` 은 B 가 계산: `Σ (item.price + Σ 선택된 choice.price_delta) × qty`. `status` 는 항상 리터럴 `"paid"`(타입상 다른 값 불가).

---

## 4. 격리 개발에서 이 계약 쓰는 법 (mock)

각 모듈은 상대 모듈 없이 `contracts/mocks.json` 의 고정 데이터로 격리 개발한다.

| mock 키 (mocks.json) / export (mocks.ts) | 내용 | 누가 소비 |
|------------------------------------------|------|-----------|
| `sampleAnalyzeResult` = `…Elder` | "Can I get a latte", `50+`, assist 2 | D (A mock) |
| `sampleAnalyzeResultYouth` | 동일 발화, `under50`, assist 0 | D (A mock, 적응 대조) |
| `sampleMenu` | OBA Cafe 시드 메뉴 | D·C (B mock) |
| `sampleGenerateUIRequest` / `…Response` | C 입출력 예시 | C(입력), D(출력) |
| `sampleOrderRequest` / `…Response` | 주문 / mock 결제 | B(입력), D(출력) |

- **TS (C·D):** `import { sampleMenu, sampleAnalyzeResult } from "../contracts/mocks";` — `tsconfig` 에 `resolveJsonModule:true`, `esModuleInterop:true`.
- **Python (A):** `from contracts.schemas import AnalyzeResult` (PYTHONPATH 에 리포 루트). `response_model=AnalyzeResult` 로 응답 검증.
- **env 토글:** D=`VITE_USE_MOCK=true`, A=`MOCK_MODE=1`, C=`GGUI_MODE=local`(기본; 키 없이 LOCAL 렌더). 토글 시 위 mock 으로 흐름이 끝까지 돈다.

---

## 8. 변경 금지

- **`contracts/types.ts`(정본)** 및 그 미러/샘플(`schemas.py`·`mocks.json`·`mocks.ts`)은 **단일 모듈이 임의로 수정 금지.**
- 필드 추가/이름 변경/타입 변경/리터럴 변경(`status:"paid"`, `assist_level` 범위, `age.group` 값 등)은 **4모듈 합의 → 4개 파일 동시 갱신** 후에만.
- 모듈 코드는 이 계약을 **소비/생산만** 한다. 계약 외 필드를 추가로 주고받아야 하면, 받는 쪽은 모르는 필드를 무시(forward-compatible)하되 **계약에 의존하지 않는다.** (예: C LOCAL 폴백이 `contract` 안에 `intent` 를 추가로 채우는 것 → `contract:any` 의 허용 범위.)

---

## 10. 병합 체크포인트 (합칠 때 만족해야 할 계약)

병합 시 아래가 전부 참이어야 end-to-end 가 맞물린다.

- [ ] **A `/analyze` 응답이 `AnalyzeResult` 스키마와 정확히 일치** (필드·타입·`assist_level∈{0,1,2,3}`·`age.group∈{"50+","under50"}`). `schemas.py` 로 검증되면 OK.
- [ ] **B `/menu` 응답이 `Menu`** 형, 모든 item 이 `MenuItem`(특히 `options[].choices[].price_delta`).
- [ ] **D→C 요청이 `GenerateUIRequest`**(특히 `menu_context` 는 B 의 `MenuItem` 배열, `step∈{recommend,options,confirm}`).
- [ ] **C `/generate-ui` 응답이 `GenerateUIResponse`** (`render_id`·`embed_url`·`contract`). **D 는 `embed_url` 을 그대로 iframe 임베드**(host/port 비가정), `contract` 의 구체 키에 강결합하지 않음.
- [ ] **D→B `/orders` 요청이 `OrderRequest`**, `OrderLine.options` 키/값이 메뉴의 `MenuOption.type`/`choice.label` 과 일치 → B 가 `total` 계산.
- [ ] **B `/orders` 응답이 `OrderResponse`**(`status:"paid"`).
- [ ] **포트 합의:** A=8000·B=8001·C=8002·D=5173, GGUI MCP=6781. D 의 `VITE_ANALYZE_URL`/`VITE_MENU_URL`/`VITE_GGUI_URL` 가 이에 매칭.
- [ ] **시나리오 관통:** 어르신 느린 "latte…" → 후보 카드(assist 2 강조 UI) → 옵션 → mock 결제 완료. 같은 말 빠르게 하면 assist 0(압축 UI) → **적응 증명**.
- [ ] **계약 4파일 무변경**(또는 변경 시 4모듈 합의·동시 갱신 기록).
</content>
</invoke>
