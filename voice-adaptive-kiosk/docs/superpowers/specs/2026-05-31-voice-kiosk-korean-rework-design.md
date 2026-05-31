# 음성 적응형 키오스크 — 한국어화 + 음성주문 통합 리워크 (설계)

> 작성일: 2026-05-31 · OBA Weekend-thon · GGUI 트랙
> 상태: 설계 확정, 구현 계획 대기

## 0. 배경 — 평가 방식 변경

실제 현장 데모 시연이 아니라 **GitHub/README 문서를 보고 평가**한다는 것이 확인됨.
따라서 "현장에 노인이 없는 상황"을 우회하려고 만든 장치(나이 인식, 한→영 proxy 번역,
ElevenLabs 음성 변환, voice 선택)는 모두 불필요 → 제거한다.

대신 **누구나 한국어로 음성 주문하면, 발화 내용에 맞춘 고령자 친화 어댑티브 UI가 뜨는**
단순명료한 제품으로 정리한다. 음성 주문 = 고령자/디지털 취약층 배려 기능.

## 1. 핵심 컨셉 (변경 후)

일반 키오스크 화면에 **상시 음성 주문 버튼**이 있다. 누르고 한국어로 말하면
(말이 2초 멈추면 자동 종료) → **GGUI가 발화 내용에 맞춰 큰 글씨·큰 카드의
고령자 친화 어댑티브 UI를 동적 생성**해 화면을 통째로 전환 → 음성/터치로 주문 완료.

- 적응 "강도"는 항상 최대(큰 글씨·큰 카드 2장·음성안내)로 **고정**.
- GGUI가 매번 다르게 만드는 축 = **발화 내용**(transcript) + 메뉴 맥락.
  - "따뜻한 라떼 하나" → 라떼+따뜻함 반영된 화면
  - "안 단 걸로 추천해줘" → 당도 낮은 메뉴 큐레이션
  - "아메리카노 두 잔이랑 디저트" → 복수+디저트 부각
- "내가 말한 대로 화면이 나온다"가 GGUI 데모의 셀링 포인트.

## 2. 제거 대상 (스펙 + 코드 양쪽)

| 대상 | 이유 | 영향 위치 |
|---|---|---|
| 나이대 인식(WavLM) | GPU 학습 필요·평가에 불필요 → "향후 확장"으로만 기록 | `module-a/inference/age.py`, `module-c/src/adapt.js` senior 가중 |
| 행동신호(behavioral/assist_level) | 강도 고정이므로 신호 불필요 | `module-a/inference/behavioral.py`, 계약 필드 |
| 한→영 proxy 번역 | 영어 분석할 일 없음 | `elevenlabs_voice.py::translate_korean_order_to_english`, app.py `/demo/korean-senior-proxy` |
| ElevenLabs 음성 변환·voice 선택 | proxy 없으니 불필요 | `inference/elevenlabs_voice.py` 전체, `/demo/*` voice 라우트, D의 `KOREAN_PROXY_VOICES`/Voice 1·2 |
| before/after 비교 모드 | 통합 UI로 대체 | D `ui/StandardComparisonKiosk.tsx`, `adaptive-compare` 모드 |
| 상단 Start Over | 하단으로 이동 | `App.tsx` 상단 영역 |

제거한 기능은 README/스펙에 **"향후 확장 가능(GPU 학습 등 필요)"**로 한 줄 남긴다.

## 3. UI 구조 (Module D)

한 화면, 두 단계(phase) — 전체 화면 전환:

```
일반 키오스크(kiosk)          음성 버튼 → 말하기              어댑티브 UI(voice)
- 카테고리 탭·메뉴 그리드      (2초 침묵 자동 종료)            - 큰 글씨·큰 카드 2장
- 매장/포장 선택 버튼     ──────────────────────▶          - GGUI 동적 생성 / LOCAL 폴백
- [🎙️ 음성으로 주문하기] 상시        완료/처음으로            - 추천→옵션→…→확인 (음성/터치)
- 하단: 처음으로          ◀──────────────────────          - 상시 음성 버튼(다시 말하기)
```

- `App.tsx` 상태를 `kiosk`(일반) ↔ `voice`(어댑티브) **2-phase**로 단순화.
  `StandardComparisonKiosk.tsx` 삭제, `adaptive-compare` 모드 삭제.
- **음성 버튼 상시 노출**: 초기 화면 + 주문 진행 중에도 떠 있어 언제든 음성 진입.
  음성 버튼은 매장/포장 선택과 **독립**(매장/포장 안 골라도 음성 진입 가능).
- 음성 버튼 위치: 일반 키오스크의 매장/포장 선택 버튼 **아래**.
- **Start Over → 하단 이동**: 매장/포장 영역 근처 하단에 "처음으로".
- 모든 UI 텍스트 **한국어**, 글꼴 **Pretendard**(CDN), 고령자 가독성 우선.

## 4. 음성 입력 — OpenAI Realtime (백엔드 경유)

```
[D 마이크] ──audio──▶ [Module A: Realtime 중계] ◀──WS──▶ [OpenAI Realtime API]
                              │ server VAD: 2초 침묵 → 자동 종료
[D] ◀──transcript(한국어)──────┘   (정지 버튼은 보조로 유지)
```

- Module A가 OpenAI Realtime 세션을 열고 D와 중계한다. **API 키는 백엔드에만** 둔다(프론트 노출 X).
- server-side VAD(`turn_detection`, `silence_duration_ms ≈ 2000`)로 **2초 침묵 시 자동 종료**.
  사용자가 정지 버튼을 안 눌러도 됨(버튼은 보조 수단으로 유지).
- transcript(한국어 원문)는 B 메뉴 검색 + C GGUI 생성 입력으로 전달.

## 5. Module A 축소

- **삭제**: `inference/age.py`, `inference/behavioral.py`, `inference/elevenlabs_voice.py`,
  `/demo/*` 라우트 전부, `/analyze`의 나이/behavioral 산출 부분.
- **남김/신규**: `GET /health`, **Realtime 중계 엔드포인트**(WS 또는 세션 프록시),
  필요 시 `stt.py`는 Realtime 폴백/보조로만.
- 의존성 경량화: `torch`/`transformers`/`faster-whisper`/`librosa`(나이모델용) 제거 검토.

## 6. Module C (GGUI) 재포지셔닝

- `adapt.js`의 **senior 나이 가중 제거**. 어댑티브 강도는 항상 최대(큰 글씨·큰 카드 2장)로
  GGUI 프롬프트/LOCAL 템플릿에 **고정 내장**.
- 입력 = **transcript + menu_context + step**(+ 주문 상태). GGUI가 transcript에 맞춰 동적 생성.
- GGUI 라이브가 메인/목표, LOCAL 렌더러는 폴백(현재 `codeReady=false` 블로커는 별도 과제).
- 멀티턴 단계는 현행 6단계(recommend|options|fulfillment|loyalty|payment|confirm) 유지.

## 7. 공유 계약 변경 (contracts/types.ts 정본 — 4모듈 동시 갱신)

- `AnalyzeResult`: `age`, `behavioral` 필드 **제거** → `{ transcript, language, duration_ms }` 수준으로 축소
  (또는 Realtime 중계 결과 형태에 맞춰 재정의).
- `GenerateUIRequest`: `age_group`, `assist_level` **제거** → `{ transcript, menu_context, step, order_state?, possible_actions? }`.
- `schemas.py`, `mocks.json`, `mocks.ts` 동시 갱신. mock의 elder/youth 변형 제거(단일 시나리오).

## 8. 문서

- 전 스펙(specs/MODULE_A·B·C·D, CONTRACTS, INTEGRATION, PLAN, SPEC, PIPELINE, NEXT_TASKS)을 위 내용으로 갱신.
- **루트 README 재작성** — 평가자가 보는 핵심 문서. 컨셉/아키텍처/실행법/데모 흐름을 한국어로.
- 제거한 기능(나이 인식 등)은 "향후 확장 가능" 섹션에 간단히 기록.

## 9. 영향받는 파일 요약

- Module D: `App.tsx`(2-phase), `ui/StandardComparisonKiosk.tsx`(삭제), `ui/AdaptiveKiosk.tsx`/`StaticKiosk.tsx`(한국어화),
  `api/client.ts`(proxy/voice 제거, Realtime 연동), `flow/orchestrator.ts`(proxy 제거, Realtime), `audio/recorder.ts`(Realtime/VAD), `styles.css`(Pretendard·한국어).
- Module A: `app.py`(라우트 정리·Realtime), `inference/*`(age/behavioral/elevenlabs 삭제), `requirements.txt`.
- Module C: `src/adapt.js`(강도 고정), `src/contract.js`·`local-render.js`(한국어·강도 고정), `server.js`.
- contracts: `types.ts`/`schemas.py`/`mocks.json`/`mocks.ts`.
- 문서: 전체.

## 10. 리스크 / 열린 과제

- OpenAI Realtime 백엔드 중계(WebSocket 양방향)는 신규 구현 — 연결/세션/VAD 설정 검증 필요.
- 계약 변경이 4모듈에 전파 — 순서 있게 적용해야 빌드 깨짐 방지.
- GGUI `codeReady=false` 라이브 블로커는 이 리워크와 별개로 남아있는 과제(LOCAL 폴백으로 데모 가능).
- 한국어화 시 글자 길이 변화로 레이아웃 깨짐 점검 필요(특히 큰 글씨 모드).
