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
