# MEMORY — Module C (GGUI 적응 UI 생성)

## 2026-05-30 · 초기 구현 (subagent)

### 결정
- **두 경로**: (1) GGUI primary(`GGUI_MODE=ggui`, MCP `ggui_handshake`+`ggui_render` 호출),
  (2) LOCAL_FALLBACK(`local` 기본, HTML 직접 생성). ggui 모드라도 호출 실패 시 자동 LOCAL 폴백.
- **포트 8002**(루트 `.env.example` 의 `VITE_GGUI_URL=:8002` 와 일치). GGUI MCP 서버는 별도 6781.
- **적응 정본 = `src/adapt.js`**. 주축=assist_level(0~3), 나이(50+)는 effective +1 보조 가중.
  L0:18px·3카드·음성약, L3:30px·2카드·강한 TTS. "구조 고정, 내용만 적응".
- **MCP 호출**: `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` 로 `{GGUI_URL}/mcp`.
  handshake intent + `blueprintDraft.variance.seedPrompt`(prompt)로 노인친화 규율 전달.
  결과 `shortCode` → `embed_url={GGUI_URL}/r/<shortCode>`.
- **LOCAL 멀티턴 계약**: iframe → 부모로 `postMessage({source:"ggui-local",type:"action",action,data})`.
  GGUI 경로의 `ggui_consume` 대체. action 키는 contract.actionSpec 와 동일(selectMenu/selectOption/confirmYes…).
- TTS: LOCAL HTML 이 `speechSynthesis`(ko-KR)로 진입 시 1회 + "다시 듣기".

### 검증 (로컬 mock, 키 없음)
- `node server.js` → mode=local 즉시 부팅. `/health` OK.
- recommend/options/confirm 3단계 모두 200, embed_url 자기서빙(`/r/:id`).
- 적응 대조 확인: 50+/L2→effective3(30px·2카드·voicebar), under50/L0(18px·3카드·voicebar 없음).
- ggui 모드 + GGUI 서버 부재 → `X-GGUI-Path: local-fallback` 으로 정상 폴백(200).
- 헤드리스 스크린샷으로 L3 화면 시각 확인(큰 카드 2장·큰 버튼·음성안내바).

### 이슈/주의
- GGUI 실서버 응답의 정확한 키명(renderId/shortCode/resourceUri)은 `pickFromResult` 가
  structuredContent·content[].text(JSON)·최상위 3곳을 모두 탐색하도록 방어적으로 작성.
  실서버 연결 시 응답 형태 1회 검증 필요.
- `GGUI_MODEL` → generator id 변환은 `:`→`-` 단순 치환(예 openai-gpt-5.5-...). 실서버에서 거부되면 생략 가능.

## 2026-05-30 · codeReady 기준 fallback 및 데모 경로 확정

### 결정
- 실시간 키오스크 데모는 `GGUI_MODE=local`을 메인으로 둔다. GGUI live generation은 offline/prewarm 실험 경로이며, `ggui_push`가 `codeReady=true`를 줄 때만 iframe URL을 신뢰한다.
- `codeReady=false`는 `ggui_push` 자체가 success여도 사용자 렌더가 202 `Generating UI...`에 머무는 상태이므로 실패로 간주해 LOCAL fallback한다.
- HTTP `age_group`은 `sixties`/`twenties` 같은 decade bucket을 그대로 통과한다. 시니어 보조 가중은 `adapt.js`의 `fifties`/`sixties`/`seventies_plus` 기준.

### 변경
- `src/ggui-client.js`: `normalizeGguiPushResult`를 추가해 `codeReady=false`를 throw하고, `codeReady=true`만 `render_id/embed_url`로 정규화.
- `src/ggui-client.js`: `GGUI_FORCE_CREATE=1`이면 handshake에 `forceCreate:true`를 전달해 cache를 우회하는 cold generation probe를 지원.
- `tests/ggui-client.test.mjs`: `codeReady=false` rejection 및 `codeReady=true` success 회귀 테스트 추가.
- `server.js`: LOCAL contract에 `_profile` metadata 포함.
- `src/local-render.js`: 영어 데모 UI(`lang=en`, English buttons/copy, `en-US` TTS)로 정리.
- 루트 `scripts/probe-ggui-generation.mjs`: Module C 응답 경로와 profile을 빠르게 확인하는 probe 추가.

### 검증
- `npm --prefix module-c test` 통과(2 tests).
- 루트 `npm run verify` 통과(Module C tests + Module D typecheck/build).
- `GGUI_MODE=ggui GGUI_FORCE_CREATE=1` test server에서는 `ggui_push: codeReady=false`를 감지해 `X-GGUI-Path: local-fallback` 반환.
- `ggui serve --dev-allow-all --port 6791` full serve check도 현재 repo에 `ggui.json`이 없어 agent disabled 상태였고, generation binding은 OpenAI로 잡혔지만 `ggui_push: codeReady=false`라 LOCAL fallback 반환.
- `GGUI_MODE=local` `:8002`는 `sixties/assist2` 요청에 `effective_level=3`, `card_count=2`, `base_font_px=30`, visible Korean text=false 렌더 확인.

## 2026-05-30 · LOCAL renderer UI 강화

### 결정
- 사용자가 기존 UI가 너무 단순하다고 지적. LOCAL renderer는 GGUI pending 대비 실데모 메인이므로 최소 fallback이 아니라 연령대별 차이가 눈에 보이는 발표 화면이어야 한다.
- assist/age 결과를 `guided`/`comfort`/`express` 모드 class로 직접 드러내고, guided는 2-card + coach panel + 큰 CTA, express는 3-card + 빠른 선택 구조를 유지한다.

### 변경
- `src/local-render.js`: `age-mode-*` body class, 모드 badge, step rail, coach panel, rank pill, primary/secondary card class, richer green/gold kiosk styling 추가.
- `tests/local-render.test.mjs`: senior high-assist render가 guided mode/coach panel/2 cards를 갖는지, young low-assist render가 express mode/3 cards를 갖는지 회귀 테스트 추가.

### 검증
- `npm --prefix module-c test` 통과(4 tests).
- `npm run probe:ggui` on `:8002` → `path:"local"`, `effective_level=3`, `card_count=2`, `base_font_px=30`.
- Playwright direct render `http://localhost:8002/r/NIt9hak`: `body.age-mode-guided`, `.card` 2개, `.coach` visible.

## 2026-05-30 · 안내 음성 중립화

### 결정
- age-adaptive UI는 화면 구조/글자/선택지 수를 바꾸는 것이고, 안내 음성은 연령대 목소리를 흉내내지 않는다.
- guided mode에서도 깔끔한 아나운서형 English TTS를 사용한다.

### 변경
- `src/local-render.js`: inline `speechSynthesis`에서 `u.rate=0.9` slow voice를 제거하고 `u.rate=1.0`, `u.pitch=1.05`로 변경. `Samantha`/`Ava`/`Allison`/`Karen`/`Google US English`/`Microsoft Aria`/`Microsoft Jenny` 우선 선택.
- `tests/local-render.test.mjs`: guided local render가 neutral announcer rate를 쓰는지 테스트 추가.

### 검증
- 신규 테스트는 기존 `u.rate=0.9`에서 RED 실패 후, 수정 뒤 `npm --prefix module-c test` 통과.
- 루트 `npm run verify` 통과.
- `:8002` 재기동 후 `npm run probe:ggui` → `render_id=LVxje9s`, `path=local`.

## 2026-05-31 · GGUI alpha render/resource 경로

### 결정
- 최신 GGUI 기준은 `@ggui-ai/create-agentic-app@alpha` / `@ggui-ai/cli@alpha` (`0.2.0-alpha.4`)이다. npm `latest` dist-tag는 rc 계열이라 현재 데모 기준으로 쓰지 않는다.
- alpha는 `ggui_new_session` 없이 `ggui_handshake` -> `ggui_render`로 시작하고, `codeReady` 대신 MCP Apps `_meta["ai.ggui/render"]`와 `resourceUri`를 반환한다.
- Module C는 alpha 응답의 `codeUrl/codeHash/runtimeUrl + resourceUri`를 렌더 준비 신호로 인정한다. 기존 rc `codeReady=true` 경로도 유지한다.

### 변경
- `src/ggui-client.js`: `ggui_render` 우선 호출, missing tool일 때만 legacy `ggui_push` fallback. `ggui_new_session`은 missing tool이면 생략.
- `src/ggui-client.js`: alpha `resourceUri`를 `client.readResource()`로 읽어 `contract._ggui.html/meta/resource_uri`에 담아 반환.
- `src/ggui-client.js`: `consumeGguiEvents()` 추가. server `GET /consume/:renderId`가 `ggui_consume`을 프록시해 Module D가 사용자 action을 받을 수 있게 함.
- `server.js`: `/consume/:renderId?timeout=N` 추가.

### 검증
- `npm --prefix module-c test` 17개 통과.
- live `probe-ggui-generation.mjs` 결과: `path:"ggui"`, `mode:"live-ggui"`, local fallback 아님.
- 직접 `/generate-ui` 확인: `contract._ggui.resource_uri` 존재, `meta["ai.ggui/render"]` 존재, HTML length 약 2KB.
