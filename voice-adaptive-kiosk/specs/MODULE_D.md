# Module D — React+Vite 웹 키오스크 UI

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙). 데모 언어 = **영어**.
> **운영방침:** module-d 의 웹 UI 는 **React 18 + TS 5 + Vite 5 로 직접 구현**한다. 실제 구현은 `module-d/src`
> 이며, 디스크에서 살아 활발히 개발 중이다. 이 문서는 그 구현의 **요구·계약 명세**다.
> open-design MCP 는 디자인을 다듬을 때 쓸 수 있는 **보조 도구**일 뿐, 최종 웹 UI 의 정본이 아니다(`module-d/src` 가 정본).
> 절대 경로: 모듈 루트 `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-d`, 프로젝트 루트 `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk`.

---

## 1. 목적·책임 (이 모듈 범위)

브라우저에서 도는 **웹 키오스크 UI**. 한 화면(=데모 무대)에서 **두 모드의 before/after 대조**를 보여주는 것이 핵심.

- **Standard (Before)** — 평범한 일반 키오스크(`StaticKiosk` 대응). 카테고리 탭 + 빽빽한 메뉴 그리드 + 작은 옵션 선택 → 주문. **의도적으로 작은 글씨/조밀.** GGUI/적응 실패 시 **폴백 화면**이기도 하다.
- **Adaptive (After)** — 음성 주문 → GGUI 적응 UI(`AdaptiveKiosk` 대응). Module C(`/generate-ui`)가 만든 화면을 보여준다. **GGUI 라이브 생성이 이 데모의 메인/목표**다: `embed_url` 이 있으면 그 URL 을 **임베드**(iframe/`@ggui-ai/react`)하는 것이 1차 경로다. **`embed_url` 이 빈 문자열이면 React UI 내장 적응 렌더러(LOCAL)로 폴백**하여 같은 구조(큰 카드 2~3 + 옵션 + Yes/No)를 직접 그린다 — 현재는 C 의 `codeReady=false` 블로커로 임시 LOCAL 폴백 상태이며, LOCAL 은 어디까지나 폴백이다.

이 UI 가 책임지는 것(`module-d/src` 구현의 **기능 요구사항**):
1. **마이크 캡처** — `MediaRecorder` 로 녹음, 가능하면 16kHz mono WAV 로 변환해 Module A `/analyze` 로 전송. 마이크 미지원/권한거부/`MOCK` 시 **가짜 발화로 폴백**(데모 무중단).
2. **적응 신호 반영** — `/analyze` 응답의 `behavioral.assist_level`(**주축 신호** 0~3) + `age.group`(보조)로 UI 강도(글자 크기·여백·버튼 크기·음성안내 속도/유무)를 조절.
3. **A/B/C 호출 오케스트레이션(멀티턴)** — `recommend → options → fulfillment → loyalty → payment → confirm` 6단계 적응 흐름 후 `order`. 재발화(speak again)로 같은 컨텍스트 위에서 새 `/analyze` 실행.
4. **TTS 음성 안내** — 브라우저 `speechSynthesis`(en-US), `assist_level` 비례로 읽기 속도↓·안내 유무 결정(assist 0 은 음성안내 생략).
5. **데모 가시화** — 진행 스텝퍼(voice→analyze→menu→generate→order→done) + 신호 스트립(transcript/age/speech_rate/assist_level)으로 "같은 발화라도 신호가 다르면 화면이 갈린다"를 시연.

**경계(이 모듈이 하지 않는 것):** STT·나이추론(A), 메뉴 데이터 생성/주문 영속화/결제(B), GGUI 실제 생성(C). 모두 **계약 기반 호출 또는 mock** 으로만 다룬다. 메뉴 데이터 **내용/이미지 자체**는 [MENU_DATA_SPEC.md](../MENU_DATA_SPEC.md) 소관(이 세션은 그 데이터를 UI 에 **바인딩/삽입**만).

---

## 2. 소유 세션 / 누가 개발

- **owner = Codex.** 웹 UI 제작 = Codex 세션이 **`module-d/src` 의 React 를 직접 구현**하고, 메뉴/이미지 데이터 바인딩·삽입도 같은 세션이 한다. open-design MCP 는 디자인 다듬기용 보조 도구로만 쓴다.
- 통합·실연결(A/B/C live + GGUI 임베드) 단계에서 Claude(module-c · 통합)와 맞물린다.
- 포트: **D(웹 UI) = 5173**(미리보기/서빙). 호출 대상 A=8000, B=8001, C(래퍼)=8002, GGUI MCP 뷰어=6781.

---

## 3. 입출력 계약 (병합 glue = `contracts/types.ts`)

React UI 는 런타임에 아래 계약 형태에만 합의한다(정본 = `contracts/types.ts`, 슬라이스 그대로). **이 형태를 바꾸지 않는다.**

### 소비 (← A/B/C 가 생산)

**`AnalyzeResult`** (← Module A `/analyze`). `behavioral.assist_level` 이 적응 주축.
```ts
type AgeGroup = "young_adult"|"adult"|"senior_adult"|"child"|"teens"|"twenties"|"thirties"|"forties"|"fifties"|"sixties"|"seventies_plus"|"unknown";
interface AnalyzeResult {
  transcript: string; language: string;
  age: { group: AgeGroup; years_est: number; confidence: number; child_prob: number };
  behavioral: { speech_rate: number; silence_ratio: number; filler_count: number; assist_level: 0|1|2|3 };
  duration_ms: number;
}
```
예시 JSON(elder 변형):
```json
{
  "transcript": "Can I get a latte",
  "language": "en",
  "age": { "group": "sixties", "years_est": 67, "confidence": 0.82, "child_prob": 0.01 },
  "behavioral": { "speech_rate": 2.1, "silence_ratio": 0.34, "filler_count": 3, "assist_level": 2 },
  "duration_ms": 4200
}
```
> mock 변형: **elder** = `sixties` / assist `2`, **youth** = `twenties` / assist `0` (둘 다 `language:"en"`, transcript `"Can I get a latte"`).

**`Menu` / `MenuItem` / `MenuOption` / `MenuOptionChoice`** (← Module B `/menu`). UI 가 바인딩할 데이터.
```ts
interface MenuOptionChoice { label: string; price_delta: number }
interface MenuOption { type: string; choices: MenuOptionChoice[] }
interface MenuItem { id: string; name: string; category: string; price: number; image_url: string; desc: string; options: MenuOption[] }
interface Menu { restaurant: string; categories: string[]; items: MenuItem[] }
```
예시 JSON(실데이터 1개):
```json
{
  "restaurant": "OBA Cafe",
  "categories": ["Coffee","Latte","Tea","Ade","Beverage","Dessert"],
  "items": [{
    "id": "americano-001", "name": "Americano", "category": "Coffee",
    "price": 3500, "image_url": "/img/menu/americano-001.svg",
    "desc": "A clean espresso-forward coffee with a smooth finish.",
    "options": [
      { "type": "Temperature", "choices": [ { "label": "Hot", "price_delta": 0 }, { "label": "Iced", "price_delta": 0 } ] },
      { "type": "Size", "choices": [ { "label": "Regular", "price_delta": 0 }, { "label": "Large", "price_delta": 500 } ] }
    ]
  }]
}
```
> `/menu/search?q=` 응답은 래퍼 `{ "query", "count", "items": MenuItem[] }` — UI 는 `.items` 만 쓴다. 실데이터 항목 48개(Latte 카테고리 10개)·옵션 라벨 **영어**(Temperature/Size/Shot, Hot/Iced/Regular/Large…). `image_url` 은 B(`:8001`) 정적 서빙(`/img/menu/*.svg`).

**`GenerateUIResponse`** (← Module C `/generate-ui`). before/after 의 after 화면 소스.
```ts
interface GenerateUIResponse { render_id: string; embed_url: string; contract: any }
```
예시 JSON:
```json
{ "render_id": "r-abc", "embed_url": "http://localhost:6781/r/sH9xK", "contract": { } }
```
> **GGUI 라이브 임베드가 메인/목표**다: `embed_url` 에 값이 있으면 그 URL 을 임베드한다. **`embed_url` 이 빈 문자열이면** React UI 가 **내장 적응 렌더러(LOCAL)로 폴백**한다. mock 클라이언트(`client.ts generateUI()`)는 런타임에 `embed_url` 을 빈 문자열로 강제하므로 mock 에선 항상 LOCAL 폴백이 된다 — 단 `sampleGenerateUIResponse` JSON 값 자체엔 예시 URL `http://localhost:6781/r/sH9xK` 가 들어있고, mock 클라이언트가 이를 빈 문자열로 덮어쓴다.

### 생산 (→ B/C 로 보냄)

**`GenerateUIRequest`** (→ Module C, step별 호출).
```ts
type AdaptiveStep = "recommend" | "options" | "fulfillment" | "loyalty" | "payment" | "confirm";  // 6단계
interface GenerateUIRequest {
  transcript: string; age_group: AgeGroup; assist_level: 0|1|2|3;
  menu_context: MenuItem[];               // recommend=후보들, options 이후=선택 1개
  order_state?: AdaptiveOrderState;       // 매 턴 같은 context로 화면을 재생성하기 위한 주문 상태
  possible_actions?: string[];            // 현재 단계에서 가능한 action 이름 목록
  step: AdaptiveStep;                     // 6단계 멀티턴
}
```
예시 JSON:
```json
{ "transcript": "Can I get a latte", "age_group": "sixties", "assist_level": 2, "menu_context": [ /* MenuItem[] */ ], "step": "recommend" }
```

**`OrderRequest` → `OrderResponse`** (→ Module B `/orders`, 결제 mock).
```ts
interface OrderLine { item_id: string; options: Record<string, string>; qty: number }
interface OrderRequest { items: OrderLine[] }
interface OrderResponse { order_id: string; total: number; status: "paid" }
```
예시 JSON:
```json
{ "items": [ { "item_id": "americano-001", "options": { "Temperature": "Iced", "Size": "Large" }, "qty": 1 } ] }
```
응답: `{ "order_id": "ord-1001", "total": 4000, "status": "paid" }`.
> 옵션 맵 **키 = `MenuOption.type`**(예 `"Temperature"`), **값 = `MenuOptionChoice.label`**(예 `"Iced"`). 화면 표기·주문 전송 모두 이 라벨 그대로.

---

## 4. 빌드 도구 = React 18 + TS 5 + Vite 5 (구현 정본 = `module-d/src`)

웹 UI 는 **`module-d/src` 의 React 18 + TS 5 + Vite 5 로 직접 구현**한다. 이것이 실제 동작하는 키오스크 UI 의 정본이다. 디자인 토큰/레이아웃을 다듬을 때만 보조적으로 **open-design MCP** 를 쓸 수 있다(정본 아님).

**open-design MCP 도구 표면(필요 시 디자인 보조용):**
- `mcp__open-design__list_projects` — 데몬 위 프로젝트 목록 확인.
- `mcp__open-design__get_active_context` — 사용자가 OD 에서 열어둔 활성 프로젝트/파일(없으면 `{active:false, hint}`; 활성 컨텍스트는 마지막 상호작용 후 ~5분 만료).
- `mcp__open-design__get_artifact` — 엔트리 파일 + 참조된 형제 파일(토큰 CSS·JSX 모듈·임포트 자산)을 **한 번에**. 디자인 이해/확장 시 우선 사용.
- `mcp__open-design__get_file(path)` — 단일 파일(최대 2000줄, 길면 `[od:file-window]` 마커 후 offset 페이지네이션).
- `mcp__open-design__search_files(query)` / `mcp__open-design__list_files` — 클래스/카피 문자열 검색 / 메타데이터.
- 참고자료는 MCP **리소스**로 노출: 브랜드 스펙 `od://design-systems/<id>/DESIGN.md`, 스킬 `od://skills/<id>/SKILL.md`.
- `project` 인자는 UUID 또는 이름 부분일치(서버가 `resolvedProject:{id,name}` 로 확인 반환). 활성 컨텍스트가 있으면 `project` 생략 가능.

**스택/형태(요구):** 브라우저에서 도는 **React 18 + TS 5 + Vite 5** 웹 UI. 외부 런타임 의존 최소화 — 브라우저 `MediaRecorder` / WebAudio / `speechSynthesis` 만 사용. GGUI 임베드는 `iframe`(또는 선택적 `@ggui-ai/react`) 로. **계약 타입은 `contracts/types.ts`(정본)** 에만 합의(로컬 타입 복제 금지, 형태만 일치).

**배치(요구):** `module-d` 가 **미리보기/서빙**할 수 있는 형태(Vite dev/build). 최종적으로 **포트 5173 에서 미리보기** 가능해야 한다(§6).

### 구현 정본 — `module-d/src` (실제 동작 중, 활발히 개발 중)

아래는 **실제 React 구현 파일 구조**다(디스크 정본). open-design 등 보조 도구는 이 구조의 동작/계약을 바꾸지 않는다.

```
module-d/src/
├── main.tsx                 # React 엔트리(렌더 부트스트랩)
├── App.tsx                  # 음성 흐름 시작 시 일반→비교(일반|적응 나란히) 자동 전환 + 마이크 바 + DemoStepper + 신호 푸터
├── styles.css               # 전역 스타일
├── flow/orchestrator.ts     # 순수 상태기계: analyze→menu→generate→order, 멀티턴, assist 분기, 6단계 generateForStep/possibleActionsForStep
├── flow/voiceIntent.ts      # 발화 transcript → 의도(select/options/fulfillment/…) 해석
├── api/client.ts            # A/B/C 호출 + USE_MOCK 분기 + 타임아웃(C=20s, 기타=8s) + apiConfig
├── audio/recorder.ts        # MicRecorder + webm/ogg → 16kHz mono WAV 변환
├── audio/tts.ts             # ElevenLabs 영어 안내(Module A /demo/announcer-voice/audio) 1차 + 실패 시 speechSynthesis(en-US) 폴백, assist_level→rate, assist0=안내생략
└── ui/
    ├── StaticKiosk.tsx              # before/폴백: 카테고리 탭 + 그리드 + 옵션 → 주문
    ├── StandardComparisonKiosk.tsx  # 비교모드 좌측 일반 키오스크(적응과 동일 단계 대조)
    ├── AdaptiveKiosk.tsx            # after: GGUI 라이브 embed_url 임베드(메인) / 빈값이면 내장 적응 렌더러(LOCAL 폴백) — 6단계
    ├── kioskProgress.ts            # 진행 단계(Menu/Options/Place/Points/Pay/Review) 라벨
    └── emoji.ts                     # 메뉴 이모지 + won(₩) 포맷
```

구현이 따르는 **상태/단계 모델**(`orchestrator.ts`):
`idle → recording → analyzing → matching → generating → adaptive(recommend|options|fulfillment|loyalty|payment|confirm) → ordering → done`, 오류 시 `error → Standard 폴백`.

구현이 따르는 **적응 강도 규율**(`tts.ts`/`AdaptiveKiosk` + Module C `adapt.js` 와 정합):

| assist_level | 글자(예시 base/title px) | 카드 수 | 설명 표시 | Yes/No 버튼 | TTS |
|---|---|---|---|---|---|
| 0 일반 | 18 / 26 | 3 | O | 보통 | 생략(off) |
| 1 약간보조 | 21 / 30 | 3 | O | 보통 | on(rate≈0.95) |
| 2 보조 | 25 / 36 | 3 | 이름·가격만 | 큼 | on(rate≈0.85) |
| 3 최대보조 | 30 / 44 | 2 | X | 큼 | 강함(rate≈0.78) |
> `age.group` 이 시니어 계열(`fifties`/`sixties`/`seventies_plus`/`senior_adult`)이면 한 단계 가중(보조). 응답의 `assist_level` 원값은 유지.

---

## 5. 독립 개발 (격리) — 다른 모듈 없이 만드는 법

**핵심 스위치 = mock 격리.** React 구현은 `VITE_USE_MOCK`(미지정/`true`/`1` → mock 기본, `false`/`0` → live)로 A/B/C 를 `contracts/mocks` 고정 JSON 으로 대체한다(env 또는 빌드 플래그). 데이터/응답이 없어도 화면과 전체 흐름이 단독으로 돈다.

다른 모듈을 무엇으로 mock 하나(출처 `contracts/mocks.ts` + `contracts/mocks.json`):

| 호출 | mock 동작 | 출처 |
|---|---|---|
| `analyze(audio, {variant})` (A) | 지연 후 고정 `AnalyzeResult`. `variant:"youth"` → `sampleAnalyzeResultYouth`(twenties/assist0), 그 외 → `sampleAnalyzeResultElder`(sixties/assist2). 둘 다 `language:"en"` | `contracts/mocks` |
| `getMenu()` (B) | `sampleMenu`(OBA Cafe) 반환. **데이터 바인딩/삽입 시 이 형태에 맞춘다** | `contracts/mocks` |
| `searchMenu(q)` (B) | transcript 와 name/desc/category 부분일치 → 없으면 `Latte`/대표 카테고리, 최대 3개 | 로컬 계산 |
| `createOrder(req)` (B) | 지연 후 `{ order_id, total(옵션반영), status:"paid" }` | 로컬 합계 계산 |
| `generateUI(req)` (C) | 지연 후 `client.ts generateUI()` mock 분기가 **`embed_url` 을 강제로 `""`** 로 비우고(디버그 메타 채운 `contract` 는 `sampleGenerateUIResponse` 기반) → React UI 가 **LOCAL 내장 적응 렌더러로 폴백**해 그림 | `client.ts` mock 분기(contract 는 `sampleGenerateUIResponse`) |

추가 격리 보장(구현 요구):
- **마이크 권한 없이도** 흐름이 돈다(MOCK 또는 미지원/거부 → 가짜 발화로 즉시 파이프라인).
- **GGUI 미설치/미가동 OK** — GGUI 라이브 `embed_url` 이 있으면 iframe 임베드(메인), 없거나 `embed_url=""` 면 LOCAL 내장 렌더러로 폴백(`@ggui-ai/react` 는 선택적). mock 에선 `embed_url` 이 항상 비워져 LOCAL 폴백.
- **재생 음성 선택**(MOCK 전용): 마이크 바에서 `Voice 1` / `Voice 2`(`KOREAN_PROXY_VOICES`) 재생 음성을 고를 수 있다. mock 변형은 기본 `elder`(시니어) 시나리오로 고정되며, `youth` 분기는 orchestrator 에 있으나 현재 UI 토글로 노출되진 않는다.

**데이터 삽입(이 세션 담당):** 메뉴/이미지는 Module B(`:8001`)의 `/menu`·`/img/menu/*` 에서 받거나, B 미가동 시 `contracts/mocks` 의 `sampleMenu` 로 mock. 이 데이터를 React 의 **카드/그리드/옵션 UI 에 바인딩**한다(메뉴 데이터 **내용 생성은 MENU_DATA_SPEC 소관**, 여기선 바인딩만).

---

## 6. 실행 (React+Vite dev 서버, 포트 5173)

```bash
# React 키오스크 UI 미리보기 (module-d 디렉토리, 포트 5173)
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-d
npm install                    # @ggui-ai/react 는 optional — 실패해도 무방
cp .env.example .env           # MOCK 기본(VITE_USE_MOCK=true) — 백엔드/키 없이 동작
npm run dev                    # http://localhost:5173  (포트 = VITE_PORT, 기본 5173)
```

명시적 MOCK 강제 / live 결선:
```bash
VITE_USE_MOCK=true npm run dev
# live:
VITE_USE_MOCK=false \
VITE_ANALYZE_URL=http://localhost:8000 \
VITE_MENU_URL=http://localhost:8001 \
VITE_GGUI_URL=http://localhost:8002 \
npm run dev
```
> 원격 추론 전환 시 `VITE_ANALYZE_URL` 만 교체, A 원격 노출 시 `VITE_ANALYZE_API_KEY` → `Authorization: Bearer ...`.
> 핵심은 **5173 에서 before/after 가 보이는 것**.

환경변수(`module-d/src` 가 쓰는 키):

| 키 | 기본 | 설명 |
|----|------|------|
| `VITE_USE_MOCK` | `true` | `true/1`=mock(백엔드 없이 동작), `false/0`=live |
| `VITE_ANALYZE_URL` | `http://localhost:8000` | Module A `/analyze` |
| `VITE_MENU_URL` | `http://localhost:8001` | Module B `/menu`·`/menu/search`·`/orders`·`/img/*` |
| `VITE_GGUI_URL` | `http://localhost:8002` | Module C `/generate-ui`(래퍼; GGUI 뷰어는 6781) |
| `VITE_ANALYZE_API_KEY` | (빈값) | A 원격 노출 시 Bearer 토큰 |
| `VITE_PORT` | `5173` | 미리보기 포트 |

---

## 7. 테스트·검증 기준 (이 모듈 단독 통과)

**빌드/타입 검증(자동):**
- `npm run typecheck` / `npm run build`(`tsc -b && vite build`) 가 **0 에러**.
- dev 서버(`npm run dev`)에서 **콘솔 에러 없이** 렌더(브라우저).

**수동(브라우저) 검증 체크리스트 — 5173:**
1. 첫 화면 = **Standard (Before)**(작은 글씨·조밀 그리드, standard-only 모드), 배지 = `MOCK`.
2. `Start Voice Order` → **자동으로 비교 화면(adaptive-compare)으로 전환**(상단 수동 토글 없음), 스텝퍼가 voice→analyze→menu→generate 진행, **신호 스트립**에 transcript/age/speech_rate/assist_level 표시.
3. **before/after 대조(데모 핵심):** 좌측 `StandardComparisonKiosk`(일반/동일 단계, 작은 글씨·조밀) ↔ 우측 `AdaptiveKiosk`(큰 카드·큰 글씨·큰 버튼·음성안내) 가 한 화면에 **나란히 병치**된다.
4. **음성 선택:** 마이크 바에서 `Voice 1` / `Voice 2` 재생 음성을 고를 수 있다(MOCK 변형은 기본 시니어 시나리오 고정 = assist 2: 큰 글자+음성안내).
5. 멀티턴 6단계: recommend(큰 카드) → 선택 → options → fulfillment(매장/포장) → loyalty(적립) → payment(결제수단) → confirm(Yes/No) → `Yes, Pay` → "Processing payment…" → **Payment Complete**(order_id·total) → Start Over. `Speak Again` 으로 재발화.
6. **GGUI/폴백:** GGUI 라이브 `embed_url` 이 있으면 iframe 임베드(메인). 빈값이면 LOCAL 내장 적응 렌더러로 after 가 그려지고, A/C 오류 시 error 박스 → **Standard 화면 폴백**으로 데모가 멈추지 않음.
7. **노인친화 규율:** 큰 글씨·고대비·큰 버튼·음성안내(en-US)가 assist_level 에 비례해 강화됨.

**계약 mock 검증:** MOCK 모드에서 §3 의 모든 입출력(JSON) 형태가 그대로 흐른다(analyze→menu→generate→order). live 결선은 §10.

---

## 8. 변경 금지

- **`contracts/types.ts`**(정본 계약) — 수정 금지. 필드명/형태 변경은 별도 합의.
- **`contracts/mocks.ts` / `contracts/mocks.json` / `contracts/schemas.py`** — import/참조만, 수정 금지.
- **다른 모듈(module-a / module-b / module-c) 코드** — 수정 금지. 격리는 mock 으로만.
- **메뉴 데이터 내용/이미지 생성** — 이 세션 범위 아님(=MENU_DATA_SPEC 소관). 이 세션은 데이터를 **UI 에 바인딩/삽입**만.
- `module-d/src` 의 React 구현은 **owner=Codex** 세션이 직접 작성/유지한다(현재 활발히 개발 중). open-design 은 디자인 다듬기용 보조 도구로만 선택적으로 쓴다.

---

## 9. 현재 상태 (사실)

- **React 구현 존재·동작(정본):** `module-d/src` 에 React 18 + TS 5 + Vite 5 구현이 살아 있고 **활발히 개발 중**이다(App.tsx/orchestrator.ts/client.ts 등 최근 수정). MOCK 모드로 전체 흐름(voice→analyze→menu→generate→order→done)이 백엔드/키/마이크 없이 완주한다. 두 모드(`StaticKiosk`/`StandardComparisonKiosk` before/폴백, `AdaptiveKiosk` after = GGUI 라이브 embed 임베드 + LOCAL 내장 적응 렌더러 폴백)와 A/B/C 호출 매핑·6단계 멀티턴·TTS(en-US)·assist 분기가 모두 구현돼 있다. → 이 React 구현이 **최종 웹 UI**다(대체 대상 아님).
- **GGUI 라이브 = 메인/목표, LOCAL = 폴백:** Adaptive 화면의 1차 경로는 Module C 가 반환하는 GGUI 라이브 `embed_url` 임베드다. 다만 현재 C 의 `ggui_push`/`ggui_render` 가 `codeReady=false` 블로커를 주는 상태라, C 가 자동으로 LOCAL fallback(`X-GGUI-Path: local-fallback`, `embed_url=""`)을 반환하므로 **현재 데모는 임시로 LOCAL 폴백 렌더러로 돈다**. `codeReady=true` 가 되면 GGUI 라이브 임베드가 메인 경로가 된다.
- **데이터:** Module B 실데이터(`module-b/data/menu.seed.json`, OBA Cafe 48개, 영어 라벨, `/img/menu/*.svg`)와 `contracts/mocks` 의 `sampleMenu` 가 바인딩 소스로 준비돼 있다.
- **남은 것:** (1) C 의 `codeReady=true` 확보로 GGUI 라이브 임베드를 메인 경로로 결선, (2) §3 계약·§5 mock 격리 유지하며 데이터 바인딩 보강, (3) 5173 미리보기에서 §7 체크리스트 통과, (4) live A/B/C 결선 검증(§10).

---

## 10. 병합 체크포인트 (합칠 때 만족해야 할 계약·검증)

1. **계약 import 유지:** React UI 가 `@contracts/types` 의 `AnalyzeResult / Menu / MenuItem / GenerateUIRequest / GenerateUIResponse / OrderRequest / OrderResponse / OrderLine` 형태에만 합의(로컬 타입 복제 금지). `npm run typecheck`·`npm run build` 0 에러.
2. **A 결선:** `VITE_USE_MOCK=false` + `VITE_ANALYZE_URL` → `/analyze` 가 multipart `file`(wav 우선) 수신, §3 `AnalyzeResult` JSON 반환. `behavioral.assist_level`·`age.group` 로 화면이 분기.
3. **B 결선:** `/menu` → `Menu`, `/menu/search?q=` → `{ items: MenuItem[] }`(`.items`), `/orders` → `OrderResponse(status:"paid")`. 옵션 맵 키=`MenuOption.type`, 값=`choice.label` 정합. `/img/menu/*` 이미지 표시.
4. **C 결선:** `/generate-ui` 가 6단계 `GenerateUIRequest`(`order_state`/`possible_actions` 포함) 수신 → `GenerateUIResponse` 반환. **GGUI 라이브 `embed_url`(유효 URL)이면 임베드/iframe 이 메인 경로**, 빈 문자열이면 LOCAL 내장 렌더러로 폴백 — 둘 다 안 깨짐. C 오류 시 Standard 폴백.
5. **미리보기 게이트:** React 산출이 5173 미리보기에서 §7 체크리스트(before/after 대조 포함)를 통과. `npm run build` exit 0.
6. **데모 무중단:** 어느 모듈이 죽어도(타임아웃/에러) error 박스 → Standard 화면 폴백으로 데모가 멈추지 않음.
