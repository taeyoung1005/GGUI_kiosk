# 명세: Module C — GGUI 적응 UI 생성

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 영어.
> 이 문서는 **module-c 만 아는 새 세션(사람/Codex/Claude)이 혼자서 빌드·테스트할 수 있는 자립형 명세**다.
> 다른 모듈은 §5 의 mock 으로 대체해 독립 개발한다. 병합의 유일한 glue = 공유 계약 `contracts/types.ts`.
> 경로 기준: 프로젝트 루트 = `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk`, 모듈 루트 = `<루트>/module-c`.

---

## 1. 목적 · 책임 (한 모듈 범위)

`POST /generate-ui` 한 개를 책임진다: `GenerateUIRequest`(전사 + 나이대 + **행동신호 assist_level** + 메뉴)를 받아 **노인친화 적응 UI** 를 생성하고 `GenerateUIResponse`(`render_id`, `embed_url`, `contract`)를 돌려준다.

규율 = **구조 고정, 내용만 적응**: 큰 카드 2~3장 + 예/아니요 + 큰 글씨. `assist_level` 이 높을수록 글자·여백·음성안내가 강해진다(주축 신호는 행동신호 `assist_level`, 나이 `age_group=50+` 는 보조로 한 단계 가중).

두 경로:
- **(1) GGUI 경로(primary)** — `GGUI_MODE=ggui`. GGUI MCP 서버(`:6781`)를 호출해 OpenAI BYOK LLM 이 UI 를 생성. 임베드는 GGUI 뷰어가 서빙.
- **(2) LOCAL_FALLBACK 경로** — `GGUI_MODE=local`(기본) **또는** GGUI/키 호출 실패 시. 요청만으로 적응형 HTML 을 직접 만들어 이 서버 `/r/:id` 로 서빙. **키·외부 의존 없이 전 구간이 돈다.**

범위 밖: STT/나이추정(A), 메뉴/주문(B), 프론트 임베드·멀티턴 오케스트레이션(D). C 는 UI 를 **생성·서빙만** 한다.

---

## 2. 소유 세션 / 누가 개발

- 소유: **Claude** (module-c GGUI 실연결 + 통합).
- 포트: **C = 8002**. GGUI MCP+뷰어 서버는 별도 **:6781** (`npx @ggui-ai/cli serve`).

---

## 3. 입출력 계약 (= 병합 glue, `contracts/types.ts`)

### 소비: `GenerateUIRequest` (Module D → C, `POST /generate-ui` body)

```ts
interface GenerateUIRequest {
  transcript: string;                 // STT 전사. 예: "라떼 하나 주세요"
  age_group: "50+" | "under50";       // 보조 신호
  assist_level: 0 | 1 | 2 | 3;        // 주축 신호. 0=일반 … 3=최대 보조
  menu_context: MenuItem[];           // 후보/전체 메뉴 (B 의 MenuItem[])
  step: "recommend" | "options" | "confirm";  // 멀티턴 단계
}
```

`MenuItem`(B 산출, C 소비):
```ts
interface MenuItem {
  id: string; name: string; category: string; price: number;
  image_url: string; desc: string;
  options: { type: string; choices: { label: string; price_delta: number }[] }[];
}
```

**확장 필드(계약 외, 선택 — 멀티턴 맥락).** `contracts/types.ts` 에는 없지만 `server.js` 가 추가로 받는 옵션 필드(없어도 동작): `item`(대상 `MenuItem`), `selectedOptions`(예: `{"온도":"HOT"}`), `total`(원). `options`/`confirm` 단계에서 D 가 선택 맥락을 전달할 때 사용. → §8 참고(계약 변경 아님, C 내부 확장).

### 생산: `GenerateUIResponse` (C → Module D)

```ts
interface GenerateUIResponse {
  render_id: string;   // 생성 렌더 식별자
  embed_url: string;   // D 가 <iframe>/@ggui-ai/react 로 임베드할 URL
  contract: any;       // 사용자 액션 정의(actionSpec 등). C 는 { actionSpec, intent } 반환
}
```

요청 예시 (recommend, 어르신 L2):
```json
{
  "transcript": "라떼 하나 주세요",
  "age_group": "50+",
  "assist_level": 2,
  "menu_context": [
    {"id":"latte-001","name":"카페라떼","category":"커피","price":4500,
     "image_url":"/img/latte.png","desc":"부드러운 라떼",
     "options":[{"type":"온도","choices":[{"label":"HOT","price_delta":0},{"label":"ICE","price_delta":0}]}]}
  ],
  "step": "recommend"
}
```

응답 예시 (LOCAL 경로):
```json
{
  "render_id": "sH9xK_",
  "embed_url": "http://localhost:8002/r/sH9xK_",
  "contract": {
    "intent": "노인친화 키오스크 추천 화면 — 큰 카드 2~3장으로 메뉴를 추천하고 한 번의 큰 터치로 선택받는다.",
    "actionSpec": {
      "selectMenu": {"label":"이거 주문","nextStep":"options","schema":{"type":"object","properties":{"item_id":{"type":"string"}},"required":["item_id"]}},
      "repeat": {"label":"다시 듣기"}
    }
  }
}
```

응답 예시 (GGUI 경로 — `embed_url` 은 GGUI 뷰어의 **서명·만료 포함 URL** 그대로):
```json
{
  "render_id": "5987300e-c330-47bd-94ef-3ff0e94c78d5",
  "embed_url": "http://127.0.0.1:6781/r/pwhuy5eu4e62yh85?sig=6b60...&exp=1780224569",
  "contract": { "intent": "...", "actionSpec": { "...": {} } }
}
```

### step 별 actionSpec (D 가 받는 사용자 액션 = 멀티턴 전이)
| step | actionSpec 키 | payload | nextStep |
|------|---------------|---------|----------|
| `recommend` | `selectMenu` | `{item_id}` | `options` |
| `recommend` | `repeat` | — | (음성 다시듣기) |
| `options` | `selectOption` | `{type,label}` | `confirm` |
| `options` | `back` | — | `recommend` |
| `confirm` | `confirmYes` | — | `order` (→ B `/orders`) |
| `confirm` | `confirmNo` | — | `recommend` |

### LOCAL 경로 액션 수신 계약 (iframe → 부모)
LOCAL HTML 은 클릭 시 부모로 `postMessage` 한다(GGUI 의 `ggui_consume` 대체):
```js
{ source: "ggui-local", type: "action", action: "selectMenu", data: { item_id: "latte-001" } }
```
D 는 이 메시지를 받아 다음 `step` 으로 `/generate-ui` 를 재호출(멀티턴). action 키는 위 actionSpec 와 동일.

---

## 4. 기술 스택 + 파일 트리 (현재 실제)

- **Node ≥20 (ESM) + Express 4** · `@modelcontextprotocol/sdk`(GGUI MCP 클라이언트). 외부 빌드 없음.
- GGUI 경로 두뇌+렌더 = **GGUI 의 BYOK LLM(OpenAI GPT, Responses API)**. EXAONE/자체 LLM 없음.
- `.env.local → .env` 자동 로드(의존성 없는 경량 로더, 셸 `export` 최우선).

```
module-c/
├── server.js              # Express: /generate-ui, /r/:id, /health + 모드 스위치/폴백 + .env 로더
├── src/
│   ├── adapt.js           # 적응 규율(정본): assist_level/age → 디자인 토큰·후보 선정·문구
│   ├── contract.js        # GGUI DataContract(propsSpec/actionSpec) 빌더(step별)
│   ├── local-render.js    # LOCAL_FALLBACK: 적응형 HTML 직접 생성(+TTS/postMessage)
│   └── ggui-client.js     # GGUI 경로: MCP Streamable HTTP 로 GGUI 호출  ← ★현재 버그(§9)
├── _inspect.mjs           # 진단용: 실행 중 GGUI MCP 서버의 tool 목록·스키마 덤프
├── package.json           # type:module, start=node server.js, dev=node --watch server.js
├── .env.example           # 기본 local 모드(키 불필요)
├── .env.local             # 실제 값(git 무시). ★실제 OPENAI_API_KEY 가 들어있음 — 절대 커밋·노출 금지
└── README.md
```

### 적응 규율 토큰 (`src/adapt.js`, effective level 기준)
`age_group="50+"` 이고 아직 최대치가 아니면 effective 를 **+1** 가중(토큰만, 응답의 `assist_level` 원값은 유지).

| effective | 글자 base/title(px) | 카드 수 | 설명표시 | 예/아니요 | 음성안내(TTS) |
|---|---|---|---|---|---|
| 0 일반 | 18 / 26 | 3 | O | 보통 | 약함(off) |
| 1 약간보조 | 21 / 30 | 3 | O | 보통 | on |
| 2 보조 | 25 / 36 | 3 | X(이름·가격만) | 큼 | on |
| 3 최대보조 | 30 / 44 | 2 | X | 큼 | 강함 |

LOCAL HTML 은 `speechSynthesis`(ko-KR) 로 진입 시 1회 음성안내 + "다시 듣기" 버튼.

---

## 5. 독립 개발 (격리) — 다른 모듈 mock

C 는 다른 모듈을 **런타임 의존하지 않는다.** 입력은 전부 HTTP body 로 주입한다.

- **A(전사·나이·assist_level)**: 호출 안 함. `transcript`/`age_group`/`assist_level` 을 body 에 직접 넣으면 끝.
- **B(메뉴)**: 호출 안 함. `menu_context` 에 고정 `MenuItem[]` JSON 을 넣으면 끝. 비어 있어도(`[]`) 404 없이 동작(카드 0장).
- **D(프론트)**: 호출 안 함. `curl`/브라우저로 `/generate-ui` 후 `embed_url` 을 직접 열어 검증.
- **GGUI(:6781)**: **격리 시 띄울 필요 없음.** `GGUI_MODE=local`(기본)이면 GGUI 미접속 + 키 없이 적응형 HTML 을 직접 생성한다. `GGUI_MODE=ggui` 라도 GGUI/키 미가동이면 자동 LOCAL 폴백(`X-GGUI-Path: local-fallback`).

→ **키·외부의존 0 으로 전 기능(3단계 · 적응 대조)이 돈다.** 고정 입력 JSON 만 있으면 단독 빌드·테스트 완결.

격리용 고정 `menu_context` (복붙용):
```json
[
  {"id":"latte-001","name":"카페라떼","category":"커피","price":4500,"image_url":"/img/latte.png","desc":"부드러운 라떼",
   "options":[{"type":"온도","choices":[{"label":"HOT","price_delta":0},{"label":"ICE","price_delta":0}]},
              {"type":"사이즈","choices":[{"label":"R","price_delta":0},{"label":"L","price_delta":500}]}]},
  {"id":"amer-001","name":"아메리카노","category":"커피","price":4000,"image_url":"/img/americano.png","desc":"진한 아메리카노","options":[]},
  {"id":"tea-001","name":"녹차라떼","category":"차","price":4800,"image_url":"/img/greentea.png","desc":"고소한 녹차라떼","options":[]}
]
```

---

## 6. 실행 — 격리 기동 (env 포함)

### A. LOCAL 모드 (기본 · 키 없이 즉시 — 격리 개발용)
```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-c
npm install
GGUI_MODE=local PORT=8002 node server.js
# → [module-c] ... listening on http://localhost:8002  (mode=local)
```
> `.env.local` 이 `GGUI_MODE=ggui` 로 되어 있어도, 위처럼 셸 `export`/인라인 env 가 최우선이므로 LOCAL 로 강제된다. 깨끗한 격리 기동에는 인라인 `GGUI_MODE=local` 을 권장.

### B. GGUI 실연결 모드 (primary — 실제 OpenAI BYOK 생성)
```bash
# 1) (한 번) GGUI CLI
npm install -g @ggui-ai/cli       # 또는 npx @ggui-ai/cli serve

# 2) GGUI MCP+뷰어 서버 (기본 6781) — OpenAI raw 키 필요(OAuth 미지원, Responses API)
export OPENAI_API_KEY=sk-...
npx @ggui-ai/cli serve            # http://127.0.0.1:6781  (/mcp + /r/<code>)

# 3) Module C 를 ggui 모드로
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk/module-c
GGUI_MODE=ggui OPENAI_API_KEY=sk-... GGUI_URL=http://localhost:6781 node server.js
```

### 환경변수
| 키 | 기본값 | 설명 |
|----|--------|------|
| `PORT` | `8002` | 서버 포트 (D 의 `VITE_GGUI_URL=http://localhost:8002` 가 가리킴) |
| `GGUI_MODE` | `local` | `local`(즉시 동작) \| `ggui`(primary) |
| `OPENAI_API_KEY` | (빈값) | GGUI 생성 LLM(BYOK). `ggui` 모드에서만 필요 |
| `GGUI_URL` | `http://localhost:6781` | GGUI MCP+뷰어 서버 |
| `GGUI_BEARER` | `dev` | GGUI MCP 인증 베어러(dev 서버는 비어있지 않은 아무 값이나 통과) |
| `GGUI_MODEL` | `openai:gpt-5.5-2026-04-23` | `ggui.json#generation.model` 과 일치. generator id 로는 `:`→`-` 치환 |

> **보안**: `.env.local` 에 실제 OpenAI 키가 들어있다(git 무시 대상). 절대 커밋/로그/명세에 노출하지 말 것.

---

## 7. 테스트 · 검증 기준 (이 모듈 단독 통과)

기동 후(§6.A) 아래가 전부 통과해야 한다.

```bash
# 1) 헬스 — mode=local, has_openai_key 무관
curl -s http://localhost:8002/health
#    기대: {"status":"ok","module":"C","mode":"local",...}

# 2) recommend — 200 + render_id + embed_url(자기서빙 /r/) + contract.actionSpec.selectMenu
curl -s -X POST http://localhost:8002/generate-ui -H 'Content-Type: application/json' -d '{
  "transcript":"라떼 주세요","age_group":"50+","assist_level":2,
  "menu_context":[{"id":"latte-001","name":"카페라떼","category":"커피","price":4500,"image_url":"/img/latte.png","desc":"부드러운 라떼","options":[{"type":"온도","choices":[{"label":"HOT","price_delta":0},{"label":"ICE","price_delta":0}]}]}],
  "step":"recommend"}'

# 3) embed_url 열기 → 적응 HTML(큰 카드/큰 글씨/음성안내바) 확인
EMBED=$(curl -s -X POST http://localhost:8002/generate-ui -H 'Content-Type: application/json' -d '{"transcript":"","age_group":"50+","assist_level":3,"menu_context":[{"id":"a","name":"카페라떼","category":"커피","price":4500,"image_url":"","desc":"","options":[]},{"id":"b","name":"아메리카노","category":"커피","price":4000,"image_url":"","desc":"","options":[]}],"step":"recommend"}' | sed -n 's/.*"embed_url":"\([^"]*\)".*/\1/p')
curl -s "$EMBED" | grep -c 'class="card"'   # ≥1, L3 면 카드 2장
```

통과 기준(체크리스트):
- [ ] `/health` 200, `mode` 표시.
- [ ] `recommend`/`options`/`confirm` 3단계 모두 200 + `render_id`/`embed_url`/`contract` 반환.
- [ ] **적응 대조**: `under50`+`assist_level:0` → 글자 18px·카드 3장·음성안내바 없음 / `50+`+`assist_level:2`(effective 3) → 30px·카드 2장·음성안내바 있음. (HTML 의 `--base`, `.cards--N`, `.voicebar` 유무로 확인)
- [ ] `menu_context:[]` 빈 입력에도 500 없이 응답.
- [ ] `step` 별 actionSpec 키 일치: recommend→`selectMenu`/`repeat`, options→`selectOption`/`back`, confirm→`confirmYes`/`confirmNo`.
- [ ] (GGUI 모드) GGUI 서버 미가동 시 자동 LOCAL 폴백 + 응답 헤더 `X-GGUI-Path: local-fallback`.
- [ ] (GGUI 실연결, §9 수정 후) `X-GGUI-Path: ggui` 로 200, `embed_url` 이 `:6781/r/...` 뷰어 URL.

진단 도구: `GGUI_URL=http://localhost:6781 node _inspect.mjs` → 실행 중 GGUI MCP 의 tool 목록·스키마 덤프(GGUI 응답 형태 1회 검증용).

---

## 8. 변경 금지

- **`contracts/types.ts` 수정 금지.** `GenerateUIRequest`/`GenerateUIResponse`/`MenuItem` 등 공유 타입은 정본이며 C 는 이 형태대로만 입출력한다.
- **다른 모듈(A/B/D) 코드·`module-a|b|d/**` 수정 금지.** 격리 개발은 §5 mock(고정 JSON/모드 env)으로만.
- 멀티턴 확장 필드(`item`/`selectedOptions`/`total`)는 **계약 외 C 내부 선택 필드**다. `contracts/types.ts` 의 `GenerateUIRequest` 에 추가하지 말 것(없어도 동작해야 함).
- 이 작업에서 **수정 대상 파일은 `module-c/src/ggui-client.js` 한 곳뿐**(§9 버그 수정). 다른 C 파일·서버 라우팅은 건드리지 않아도 GGUI 실연결이 된다.

---

## 9. 현재 상태 (코드 읽은 사실 — ★중요)

- **LOCAL 경로: 동작함.** `GGUI_MODE=local` 로 `node server.js` → `/health` OK, 3단계 200, `/r/:id` 자기서빙, 적응 대조(L0 18px·3카드 vs effective3 30px·2카드·음성안내바) 확인됨. 키·외부의존 0 으로 전 구간 동작.
- **GGUI 경로: 미완 — 호출 순서/툴명 버그로 항상 LOCAL 폴백.** `src/ggui-client.js` 가 실제 GGUI MCP 서버(:6781, 가동 확인)의 tool 표면과 어긋난다. 라이브 MCP 덤프(`_inspect.mjs` + 직접 호출)로 확인한 3가지 버그:
  1. **`ggui_new_session` 누락** → `ggui_handshake` 가 `sessionId`(required) 없이 호출돼 거부됨.
  2. **존재하지 않는 `ggui_render` 호출** → 실제 렌더 툴은 **`ggui_push`**. (서버 tool 목록에 `ggui_render` 없음.)
  3. **응답 키 오독** → `renderId/shortCode/resourceUri` 를 찾지만 실제 `ggui_push` 출력은 `{ stackItemId, url, action, nextStep }`. 임베드 URL 은 **`url`** 필드(서명·만료 쿼리 포함).
  → 결과적으로 `GGUI_MODE=ggui` 라도 매번 예외 → **LOCAL 폴백**(`X-GGUI-Path: local-fallback`). 즉 GGUI 실연결은 **아직 한 번도 성공한 적 없음.**
- 남은 것: §10 의 **올바른 GGUI 호출 순서로 `ggui-client.js` 수정** → `X-GGUI-Path: ggui` 200 + GGUI 뷰어 URL 임베드 확인.

### ★ 올바른 GGUI 호출 순서 (라이브 :6781 검증 완료 — 이대로 못박는다)

> 아래는 실행 중인 GGUI MCP 서버에 직접 `new_session→handshake→push` 를 돌려 **실제 응답으로 확인**한 계약이다.

```
1) ggui_new_session({})
     → { sessionId, nextStep:{ tool:"ggui_handshake" } }
     ※ chat 당 1회, 가장 먼저. sessionId 를 이후 모든 호출에 thread.

2) ggui_handshake({ sessionId, intent, blueprintDraft:{ contract:{propsSpec,actionSpec}, variance:{persona,seedPrompt}, generator? } })
     → { handshakeId, action, suggestion }
     ※ sessionId 는 REQUIRED(현재 코드 누락). intent + seedPrompt 에 노인친화 UI 규율을 싣는다.

3) ggui_push({ handshakeId, decision:{ kind:"accept" }, props })   ← 'ggui_render' 아님!
     → { stackItemId, url, action, nextStep:{ tool:"ggui_consume", args:{ stackItemId } } }
     ※ embed_url = result.url  (예: http://127.0.0.1:6781/r/<code>?sig=...&exp=...)
     ※ render_id = result.stackItemId
     ※ 멀티턴 액션 수신은 ggui_consume({ stackItemId }) 로 이어진다(D 측).
```

수정 매핑(현재 → 올바름):
| 현재 코드(`ggui-client.js`) | 올바름 |
|---|---|
| (없음) | **선행** `ggui_new_session({})` → `sessionId` |
| `ggui_handshake({ intent, blueprintDraft })` | `ggui_handshake({ **sessionId**, intent, blueprintDraft })` |
| `ggui_render({ handshakeId, decision, props })` | **`ggui_push`**`({ handshakeId, decision:{kind:"accept"}, props })` |
| 응답에서 `renderId/shortCode/resourceUri` 추출 | 응답에서 **`url`**(=embed_url) / **`stackItemId`**(=render_id) 추출 |
| `embed_url = {GGUI_URL}/r/<shortCode>` 재조립 | `embed_url = result.url` (서명·만료 URL 그대로 사용) |

`blueprintDraft.contract`/`variance.seedPrompt`/`generator`(`GGUI_MODEL` 의 `:`→`-`) 구성 로직은 현재 코드 그대로 재사용 가능. 출력 추출 헬퍼 `pickFromResult` 도 키만 `["url"]`, `["stackItemId"]` 로 바꿔 재사용.

---

## 10. 병합 체크포인트 (합칠 때 C 가 만족해야 할 계약·검증)

1. **계약 일치**: `/generate-ui` 가 `contracts/types.ts` 의 `GenerateUIRequest` 를 소비하고 `GenerateUIResponse`(`render_id`/`embed_url`/`contract`)를 생산한다. 확장 필드는 계약에 추가하지 않았다.
2. **포트·URL**: C 는 `:8002` 에서 뜨고, D 의 `VITE_GGUI_URL=http://localhost:8002` 가 이를 가리킨다(GGUI 6781 이 아니라 **C 래퍼**를 가리킴).
3. **LOCAL 보증**: 키/GGUI 없이도 D→C 전 구간(3단계 + 적응 대조 + iframe `postMessage` 액션)이 동작한다 → 데모 폴백 보장.
4. **GGUI 실연결(§9 수정 후)**: `GGUI_MODE=ggui` + `OPENAI_API_KEY` + `:6781` 가동에서 `X-GGUI-Path: ggui` 로 200, `embed_url` 이 GGUI 뷰어 URL(`:6781/r/...?sig=...`), D 가 `@ggui-ai/react`+`ggui_consume`(또는 iframe)로 임베드·멀티턴 가능.
5. **D 연동 액션 키 동형성**: LOCAL `postMessage` 의 `action` 키 = GGUI `actionSpec` 키(`selectMenu`/`selectOption`/`confirmYes`/`confirmNo`/`back`/`repeat`) → 두 경로에서 D 의 멀티턴 핸들러가 동일하게 동작.
6. **회귀**: 병합 후 §7 체크리스트 전 항목 + GGUI 실연결 1회 성공(`X-GGUI-Path: ggui`)을 재확인.
