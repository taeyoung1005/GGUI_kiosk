# Module C — GGUI 적응 UI 생성 서비스

> 음성 적응형 키오스크 (OBA Weekend-thon · GGUI 트랙) · `SPEC.md §4`
> Node(ESM) + Express. 실시간 데모 메인은 **LOCAL 적응 렌더러**이고, GGUI BYOK live generation은 offline/prewarm 실험 경로로 둔다. EXAONE 없음.

전사(transcript) + 나이대(age_group) + **행동신호(assist_level 0~3, 주축)** + 메뉴(menu_context)
를 받아 **노인친화 적응 UI** 를 생성한다. 규율은 *구조 고정(큰 카드 2~3장 + 예/아니요 + 큰 글씨),
내용만 적응* — assist_level 이 높을수록 글자·여백·음성안내가 강해진다.

## 두 경로

| 경로 | 트리거 | 동작 |
|------|--------|------|
| **(1) LOCAL (demo main)** | `GGUI_MODE=local`(기본) | 요청만으로 적응형 HTML 을 직접 생성해 이 서버의 `/r/:id` 로 서빙. **키 없이 전체 파이프라인이 빠르게 돈다.** |
| **(2) GGUI probe/prewarm** | `GGUI_MODE=ggui` | GGUI MCP 서버(`@ggui-ai/cli serve`, 기본 6781)의 `ggui_push` 호출. `codeReady=true`일 때만 GGUI `/r/<shortCode>`를 반환하고, 아니면 LOCAL로 폴백. |

`GGUI_MODE=ggui` 라도 GGUI/OPENAI 가 미가동이거나 `ggui_push`가 `codeReady=false`를 반환하면 자동으로 LOCAL 로 폴백한다(응답 헤더 `X-GGUI-Path: local-fallback`). 이 때문에 kiosk 데모가 202 `Generating UI...`에 멈추지 않는다.

## 실행 (즉시 — local 모드)

```bash
cd module-c
npm install
cp .env.example .env      # 그대로 두면 local 모드(키 불필요)
node server.js            # http://localhost:8002  (mode=local)
```

```bash
# 헬스체크
curl http://localhost:8002/health
# UI 생성 (예: 어르신 · assist_level 2)
curl -X POST http://localhost:8002/generate-ui -H 'Content-Type: application/json' -d '{
  "transcript":"라떼 하나 주세요","age_group":"senior_adult","assist_level":2,
  "menu_context":[{"id":"latte-001","name":"카페라떼","category":"커피","price":4500,"image_url":"/img/latte.png","desc":"부드러운 라떼","options":[{"type":"온도","choices":[{"label":"HOT","price_delta":0},{"label":"ICE","price_delta":0}]}]}],
  "step":"recommend"
}'
# → { "render_id":"...", "embed_url":"http://localhost:8002/r/...", "contract":{...} }
# embed_url 을 브라우저/아이프레임으로 열면 적응 UI 가 보인다.
```

## 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `POST` | `/generate-ui` | `GenerateUIRequest` → `GenerateUIResponse` (`contracts/types.ts`) |
| `GET`  | `/r/:id` | 생성된 UI HTML 반환 (Module D 가 iframe 임베드). **LOCAL 경로 렌더만 여기서 서빙**(GGUI 경로 렌더는 GGUI 서버의 `/r/<shortCode>`). |
| `GET`  | `/health` | 상태 + 현재 모드 |

### `GenerateUIRequest` 확장 필드(멀티턴)
공유 계약 필드(`transcript, age_group, assist_level, menu_context, step`)에 더해, `options`/`confirm`
단계에서 선택 맥락을 넘길 수 있다(선택): `item`(대상 MenuItem), `selectedOptions`(예: `{"온도":"HOT"}`), `total`.

### `step` 별 actionSpec (D 가 받는 사용자 액션)
- `recommend` → `selectMenu({item_id})`(nextStep: options), `repeat`(음성 다시듣기)
- `options` → `selectOption({type,label})`(nextStep: confirm), `back`
- `confirm` → `confirmYes`(nextStep: order → B `/orders`), `confirmNo`(다시 추천)

## 적응 규율 (assist_level + age 보조)

`src/adapt.js` 가 정본. `age_group`이 `senior_adult`이면 강도를 한 단계 부드럽게 가중(보조 신호).

| effective level | 글자(base/title) | 카드 수 | 설명 표시 | 예/아니요 | 음성안내 |
|---|---|---|---|---|---|
| 0 일반 | 18 / 26 px | 3 | O | 보통 | 약함 |
| 1 약간보조 | 21 / 30 px | 3 | O | 보통 | O |
| 2 보조 | 25 / 36 px | 3 | X(이름·가격만) | 큼 | O |
| 3 최대보조 | 30 / 44 px | 2 | X | 큼 | 강함 |

LOCAL HTML 은 `speechSynthesis`(`en-US`)로 진입 시 1회 음성안내(가능 브라우저), "Replay" 버튼 제공.

## Module D 연동 (멀티턴)

- D 는 `embed_url` 을 `<iframe>` 으로 임베드.
- **GGUI 경로**: D 는 GGUI 의 `@ggui-ai/react` + `ggui_consume` 으로 사용자 액션 수신.
- **LOCAL 경로**: iframe 내부가 클릭 시 부모로 `postMessage` 한다 —
  `{ source:"ggui-local", type:"action", action:"selectMenu", data:{item_id} }`.
  D 는 이 메시지를 받아 다음 `step` 으로 `/generate-ui` 를 다시 호출(멀티턴).

## GGUI 실서버 연결 절차 (offline/prewarm 실험)

GGUI 가 실제로 OpenAI BYOK 로 UI 를 생성하게 하려면:

```bash
# 0) (한 번) GGUI CLI 설치
npm install -g @ggui-ai/cli      # 또는 npx @ggui-ai/cli ...

# 1) ggui.json — OpenAI 생성 모델 + 노인친화 테마
#    프로젝트 루트 또는 GGUI 작업 폴더에 둔다 (아래 "ggui.json 예시" 참고).

# 2) GGUI MCP+뷰어 서버 기동 (기본 포트 6781)
export OPENAI_API_KEY=sk-...          # GGUI 는 OAuth 미지원 → raw 키 필요(Responses API)
ggui serve --dev-allow-all            # http://127.0.0.1:6781  (/mcp + /r/<shortCode>)

# 3) Module C 를 ggui 모드로
#    .env: GGUI_MODE=ggui, OPENAI_API_KEY=sk-..., GGUI_URL=http://localhost:6781
GGUI_FORCE_CREATE=1 node server.js
```

호출 흐름(`src/ggui-client.js`): MCP Streamable HTTP 로
`ggui_new_session({})` →
`ggui_handshake({sessionId, intent, blueprintDraft:{contract, variance:{seedPrompt}}})` →
`ggui_push({handshakeId, decision:{kind:"accept"}, props})` →
응답의 `codeReady=true`일 때만 `url`을 `embed_url`로 사용.
`GGUI_FORCE_CREATE=1`이면 handshake에 `forceCreate:true`를 전달해 cache를 우회하고 cold generation을 강제한다.
적응 규율(큰 카드 2~3장·예/아니요·큰 글씨·음성안내)은 `intent` + `variance.seedPrompt`(prompt)로 전달한다.

현재 진단 기준: `ggui_push`가 success여도 `codeReady=false`면 viewer는 202 `Generating UI...`에 머문다. Module C는 이 값을 실패로 간주하고 LOCAL fallback을 반환한다.

### `ggui.json` 예시 (노인친화)

```json
{
  "schema": "1",
  "protocol": "draft-2026-05-23",
  "app": { "slug": "voice-adaptive-kiosk", "name": "음성 적응형 키오스크" },
  "generation": { "model": "openai:gpt-5.5-2026-04-23" },
  "theme": { "preset": "indigo", "mode": "light" }
}
```

> `generation.model` 은 `.env` 의 `GGUI_MODEL` 과 동일하게 맞춘다(기본 `openai:gpt-5.5-2026-04-23`).
> 모델은 OpenAI **Responses API** 로 호출되므로 해당 모델 접근 권한이 있는 키가 필요하다.

## 환경변수 (`.env.example`)

| 키 | 기본값 | 설명 |
|----|--------|------|
| `PORT` | `8002` | 서버 포트(D 의 `VITE_GGUI_URL` 가 가리킴) |
| `GGUI_MODE` | `local` | `local`(즉시 동작) \| `ggui`(primary) |
| `OPENAI_API_KEY` | (빈값) | GGUI 생성 LLM(BYOK). `ggui` 모드에서만 필요 |
| `GGUI_URL` | `http://localhost:6781` | GGUI MCP+뷰어 서버 |
| `GGUI_BEARER` | `dev` | GGUI MCP 인증 베어러(dev 서버는 아무 값이나 통과) |
| `GGUI_MODEL` | `openai:gpt-5.5-2026-04-23` | `ggui.json#generation.model` 과 일치 |

## 파일 구조

```
module-c/
├── server.js              # Express: /generate-ui, /r/:id, /health + 모드 스위치/폴백
├── src/
│   ├── adapt.js           # 적응 규율(정본): assist_level/age → 디자인 토큰·후보 선정·문구
│   ├── contract.js        # GGUI DataContract(propsSpec/actionSpec) 빌더(step별)
│   ├── local-render.js    # LOCAL_FALLBACK: 적응형 HTML 직접 생성(+TTS/postMessage)
│   └── ggui-client.js     # GGUI 경로: MCP Streamable HTTP 로 ggui_render 호출
├── package.json
├── .env.example
└── README.md
```
