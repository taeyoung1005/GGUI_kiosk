# 음성 키오스크 한국어화 + 음성주문 통합 리워크 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 나이 인식·proxy 번역·before/after 비교를 제거하고, 일반 키오스크 + 상시 음성 버튼 → 한국어 음성 주문 → 발화 내용 기반 GGUI 동적 어댑티브 UI(항상 고령자 친화)로 통합. STT는 OpenAI Realtime(백엔드 경유, 2초 VAD 자동종료). 전면 한국어화 + Pretendard.

**Architecture:** 계약(contracts) → 백엔드(Module A, C) → 프론트(Module D) → 문서 순서로 변경. 계약에서 `age`/`behavioral`/`age_group`/`assist_level`을 제거하면 하류 모듈이 그 필드를 안 쓰도록 따라 바뀐다. 어댑티브 "강도"는 계약 페이로드가 아니라 Module C 내부 상수(고령자 최대)로 고정. App은 `kiosk`↔`voice` 2-phase 전체 전환.

**Tech Stack:** TypeScript/React/Vite (Module D), Node/Express (Module B/C), Python/FastAPI (Module A), OpenAI Realtime API, GGUI MCP, Pretendard 글꼴.

**진행 원칙:** 작업트리에 이미 사용자 미커밋 변경이 많다. 각 Task는 **작은 단위로 커밋**한다. `npm run verify`(module-c test + module-d typecheck/build)와 `module-a` 테스트를 게이트로 쓴다. 계약 변경(Task 1) 직후 빌드가 일시적으로 깨질 수 있으므로, **계약→백엔드→프론트 순서를 지키고** 각 모듈 수정 후 해당 모듈 빌드를 통과시킨다.

---

## Task 0: 사전 안전 — 현재 상태 커밋 + 참조 추적

리워크 전 작업트리 상태를 보존하고, 제거 대상 심볼이 어디서 참조되는지 전수 확인한다.

**Files:** (없음 — git + grep)

- [ ] **Step 1: 현재 변경 커밋** (사용자 작업 보존)

```bash
cd /Users/taeyoungpark/Desktop/OBA_Weekenthon
git add -A && git commit -q -m "[chore] 리워크 착수 전 작업트리 스냅샷"
```

- [ ] **Step 2: 제거 대상 심볼 전역 참조 추적**

Run:
```bash
cd voice-adaptive-kiosk
grep -rn "age_group\|assist_level\|behavioral\|AgeGroup\|AgeInfo\|BehavioralInfo\|english_proxy\|korean_text\|KOREAN_PROXY\|analyzeKoreanSeniorProxy\|proxyAnalyzeToAnalyzeResult\|score_behavioral\|create_age_model\|elevenlabs_voice\|StandardComparisonKiosk\|mockVariant\|setMockVariant\|setProxyVoice" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.js" --include="*.json" . | grep -vE "node_modules|\.venv|dist|\.run-logs|audit-result" > /tmp/rework-refs.txt
wc -l /tmp/rework-refs.txt && cat /tmp/rework-refs.txt
```
Expected: 참조 목록이 출력됨. 이 목록이 Task 1~6의 제거 체크리스트가 된다. (계획의 줄번호는 작성 시점 기준 — 이 grep으로 실제 위치를 재확인하고 진행)

- [ ] **Step 3: 베이스라인 테스트 통과 확인**

Run: `npm run verify`
Expected: module-c 26 tests PASS, module-d typecheck+build OK. (실패하면 리워크 전에 원인 파악)

---

## Task 1: 공유 계약 정리 (contracts 4파일 동시)

`age`/`behavioral`/`age_group`/`assist_level`/proxy 필드를 4파일에서 한 번에 제거. AnalyzeResult는 `{transcript, language, duration_ms}`로, GenerateUIRequest는 `age_group`/`assist_level` 제거.

**Files:**
- Modify: `contracts/types.ts`
- Modify: `contracts/schemas.py`
- Modify: `contracts/mocks.json`
- Modify: `contracts/mocks.ts`

- [ ] **Step 1: types.ts 수정**

`AgeGroup` union(L22-34)과 그 JSDoc(L17-21) 제거. `AnalyzeResult`(L36-63)에서 `age` 객체(L41-50)·`behavioral` 객체(L51-60) 제거 → `{ transcript: string; language: string; duration_ms: number }`만 남김. `GenerateUIRequest`(L134-146)에서 `age_group: AgeGroup`(L136)·`assist_level: 0|1|2|3`(L137) 제거. `GroundIntentRequest`에서 `korean_text?`(L165)·`english_proxy_text?`(L166) 제거. 머리 주석(L13-15)을 "음성 → 전사(transcript)"로 재서술.

- [ ] **Step 2: schemas.py 수정 (types.ts 미러)**

`AgeGroup`(L23-28)·`AssistLevel`(L30-31) Literal 제거. `class AgeInfo`(L54-60)·`class BehavioralInfo`(L63-73) 제거. `AnalyzeResult`(L76-83)에서 `age`(L81)·`behavioral`(L82) 필드 제거, docstring 수정. `GenerateUIRequest`(L133-142)에서 `age_group`(L135)·`assist_level`(L136) 제거. `GroundIntentRequest`에서 `korean_text`(L160)·`english_proxy_text`(L161) 제거. `__all__`(L208-232)에서 `AgeGroup`/`AssistLevel`/`AgeInfo`/`BehavioralInfo` 제거.

- [ ] **Step 3: mocks.json 수정**

`sampleAnalyzeResultElder`(L2-18)·`sampleAnalyzeResultYouth`(L19-35)를 **단일 `sampleAnalyzeResult`**로 통합: `{ "transcript": "라떼 한 잔 주세요", "language": "ko", "duration_ms": 1850 }`. `sampleGenerateUIRequest`에서 `age_group`(L2181)·`assist_level`(L2182) 제거, transcript를 한국어로. (sampleMenu 한국어화는 Task 7에서 별도)

- [ ] **Step 4: mocks.ts 수정**

elder/youth 변형 주석(L19-22)·alias(L24-34) 제거 → `export const sampleAnalyzeResult = raw.sampleAnalyzeResult` 단일 정의. `mocks` 묶음 export(L64-66)에서 elder/youth 키 제거.

- [ ] **Step 5: 타입 검증 (이 시점엔 하류 모듈이 깨질 수 있음 — contracts 자체 정합만 확인)**

Run: `cd module-d && npx tsc --noEmit 2>&1 | head -30`
Expected: contracts 자체 에러는 없고, **하류(client.ts/orchestrator 등)에서 제거된 필드 참조 에러만** 남아야 정상. (이 에러들은 Task 4~6에서 해소). 에러가 contracts 파일 내부면 수정.

- [ ] **Step 6: 커밋**

```bash
git add contracts/ && git commit -q -m "[refactor] 계약에서 age/behavioral/age_group/assist_level/proxy 필드 제거"
```

---

## Task 2: Module A 축소 (나이/proxy/ElevenLabs 제거)

`app.py`에서 demo 라우트와 age/behavioral를 제거하고, `inference/age.py`·`behavioral.py`·`elevenlabs_voice.py` 삭제. `/health`와 STT만 남김. (Realtime 중계는 Task 3에서 추가)

**Files:**
- Modify: `module-a/app.py`
- Delete: `module-a/inference/age.py`, `module-a/inference/behavioral.py`, `module-a/inference/elevenlabs_voice.py`
- Modify: `module-a/inference/stt.py`, `module-a/requirements.txt`, `module-a/.env.example`
- Delete (관련 테스트): `module-a/tests/test_age_public_model.py`, `test_behavioral.py`, `test_elevenlabs_voice.py`, `test_demo_routes.py`

- [ ] **Step 1: app.py에서 demo 라우트·age·behavioral·elevenlabs 제거**

import L17(`create_age_model`)·L18(`score_behavioral`)·L19-27(elevenlabs 블록) 제거. env L48-50(`AGE_MODEL_PROVIDER`/`AGE_DEVICE`) 제거. 전역 `_age_model`/`_elevenlabs`(L69/71) 제거. Pydantic 4모델(L74-93) 제거. `get_age_model()`(L104-108)·`get_elevenlabs()`(L121-125) 제거. demo 라우트 전부(L139-321) 제거. `/analyze`(L324-358)에서 age(L338)·behavioral(L339)·응답 age/behavioral 블록(L343-354) 제거 → `{transcript, language, duration_ms}` 반환. 미사용 import 정리(`base64` L3, `quote` L8). `/health`(L128-136)에서 `age_model_provider`/`elevenlabs_ready` 키 제거.

- [ ] **Step 2: inference 3파일 + 관련 테스트 삭제**

```bash
cd module-a
git rm inference/age.py inference/behavioral.py inference/elevenlabs_voice.py
git rm tests/test_age_public_model.py tests/test_behavioral.py tests/test_elevenlabs_voice.py tests/test_demo_routes.py
```

- [ ] **Step 3: stt.py 정리**

`FasterWhisperSTT`(L14-31) 제거, `create_stt()`(L88-99)의 `local:`/faster-whisper 분기 제거 → OpenAI 경로(`whisper-1` 등)와 `NoopSTT`만. `OpenAIWhisperSTT`·`NoopSTT`·`Transcription`·`create_stt` 유지.

- [ ] **Step 4: requirements.txt 경량화**

제거: `accelerate datasets evaluate faster-whisper huggingface-hub loralib pandas scikit-learn speechbrain torch torchaudio transformers`. 유지: `fastapi uvicorn[standard] python-dotenv python-multipart openai numpy`. (`librosa`/`soundfile`는 `/analyze` 파일 업로드 유지 시 남김 — Task 3에서 Realtime 결정 후 재정리)

- [ ] **Step 5: .env.example 정리**

제거: `AGE_MODEL_PROVIDER`, `AGE_DEVICE`, `ORDER_TRANSLATION_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`. 유지: `STT_MODEL`, `STT_LANGUAGE`, `API_KEY`, `OPENAI_API_KEY`.

- [ ] **Step 6: 컴파일 확인**

Run: `cd module-a && .venv/bin/python -m py_compile app.py inference/*.py`
Expected: 에러 없음. (age/behavioral/elevenlabs import가 모두 사라졌으므로)

- [ ] **Step 7: 남은 테스트 통과 확인**

Run: `cd module-a && PYTHONPATH=. .venv/bin/python -m unittest discover tests -v 2>&1 | tail -15`
Expected: 삭제한 테스트 외 나머지(test_stt_config 등) PASS. age/behavioral/elevenlabs 참조 테스트가 남아 에러나면 그 테스트도 정리.

- [ ] **Step 8: 커밋**

```bash
git add -A && git commit -q -m "[refactor] Module A에서 나이인식·behavioral·ElevenLabs·proxy·demo 라우트 제거"
```

---

## Task 3: Module A — OpenAI Realtime 중계 엔드포인트 추가

프론트가 안전하게 Realtime을 쓰도록 백엔드가 ephemeral client_secret을 발급한다. 키는 백엔드에만, 실시간 오디오 스트림은 브라우저↔OpenAI 직결(WebRTC). 2초 침묵 자동 종료는 server VAD 설정으로 지정.

> **확정된 OpenAI Realtime 사실 (2026-05 문서 확인):**
> - ephemeral client_secret을 백엔드 REST로 생성(1분 만료) → 브라우저가 이걸로 WebRTC 연결. 표준 API 키는 절대 프론트 노출 금지.
> - **server VAD** = 세션 설정 `audio.input.turn_detection: {type:"server_vad", silence_duration_ms:2000, threshold:0.5, prefix_padding_ms:300}` → 2초 침묵 시 자동 turn 종료. (`silence_duration_ms` 기본 500 → 2000으로 올려 "2초")
> - 언어 = `audio.input.transcription.language: "ko"`
> - 최종 transcript 이벤트 = `conversation.item.input_audio_transcription.completed`
> - ⚠️ **모델 주의**: `gpt-realtime-whisper`(streaming transcription 전용)는 server VAD 미지원(수동 commit 필요)이라 2초 자동 종료가 안 됨. server VAD 자동 종료를 쓰려면 **server VAD를 지원하는 realtime 모델**(예: `gpt-realtime` 계열, transcription 포함)을 쓰고 `turn_detection`을 위 설정으로 지정해야 함. 실제 모델명은 착수 시 `client.realtime.client_secrets.create` 또는 REST 응답으로 최종 확인.
> - 정확한 OpenAI Python SDK 바인딩(`openai` 2.38 설치됨)은 착수 시 `openai` SDK의 realtime client_secrets 메서드를 직접 확인 후 작성.

**Files:**
- Modify: `module-a/app.py`
- Modify: `module-a/.env.example`

- [ ] **Step 1: .env.example에 Realtime env 추가**

`OPENAI_REALTIME_MODEL=gpt-realtime`(착수 시 server-VAD 지원 모델명 최종 확인), `OPENAI_REALTIME_LANGUAGE=ko`, `OPENAI_REALTIME_SILENCE_MS=2000`.

- [ ] **Step 2: /realtime/session 라우트 추가 (app.py, /health 직후)**

`require_auth`로 보호. OpenAI SDK로 ephemeral client_secret 발급, 세션 설정에 `audio.input.transcription.language="ko"` + `audio.input.turn_detection={type:"server_vad", silence_duration_ms:2000, threshold:0.5, prefix_padding_ms:300}` 포함. 프론트에 `{client_secret, model, expires_at}` 반환. (정확한 SDK 호출은 `openai` SDK realtime 바인딩 확인 후 작성)

- [ ] **Step 3: /health에 realtime 준비여부 추가**

응답에 `realtime_ready: bool(OPENAI_API_KEY)` 추가.

- [ ] **Step 4: 컴파일 + 수동 호출 확인**

Run: `cd module-a && .venv/bin/python -m py_compile app.py`
Expected: 에러 없음. (키 있으면 `curl -X POST localhost:8000/realtime/session -H "Authorization: Bearer $API_KEY"`로 client_secret 반환 확인)

- [ ] **Step 5: 커밋**

```bash
git add -A && git commit -q -m "[feat] Module A에 OpenAI Realtime ephemeral 세션 발급 라우트 추가"
```

---

## Task 4: Module C — 강도 고정 + 한국어화 (GGUI)

`adapt.js`에서 age 가중 제거, 항상 최대(고령자) 프로파일 고정. `contract.js`/`server.js`에서 `age_group`/`assist_level` 입력 제거. step 카피 전면 한국어화.

**Files:**
- Modify: `module-c/src/adapt.js`
- Modify: `module-c/src/contract.js`
- Modify: `module-c/server.js`
- Modify: `module-c/src/local-render.js` (profile/assistLevel/ageGroup 참조)
- Modify: `module-c/src/ggui-client.js` (normalized.age_group/assist_level 전달 제거 + GGUI 프롬프트에 고령자 강도 상수 주입)
- Test: `module-c/tests/*.test.mjs`

- [ ] **Step 1: adapt.js — 강도 고정**

`SENIOR_GROUPS`(L73) 제거. `resolveProfile({assist_level, age_group})`(L79-91) → 인자 무시하고 항상 최대 토큰 반환하는 `resolveProfile()`로. `ASSIST_TOKENS`(L10-63)는 레벨3 값만 남겨 단일 상수화. `stepCopy`(L122-167)의 `big` 분기(L124,128,...) 제거하고 카피 **전면 한국어화** (recommend "이 중에서 골라주세요" 등 — 정찰의 영어 문자열 목록을 한국어로). `pickCandidates`(transcript 매칭)는 유지.

- [ ] **Step 2: contract.js — age/assist 스키마 제거 + 한국어화**

`baseProps.assistLevel`(L52-56)·`ageGroup`(L57) 제거. `intentByStep`(L33-46)·actionSpec label/description 전면 한국어화 (selectMenu "주문하기", confirmYes "네, 결제할게요" 등). nextStep 식별자·step 값은 유지.

- [ ] **Step 3: server.js — 입력 파싱 정리**

`generateLocal`(L87)의 `age_group`/`assist_level` 구조분해 제거. `resolveProfile({assist_level, age_group})`(L99) → `resolveProfile()`. `_profile` 반환(L142-148)에서 age/assist 필드 제거. `/generate-ui` normalized(L223-227)에서 age_group/assist_level 파싱 제거. `transcript`/`menu_context`/`order_state`/`step` 유지. `normalizeAssistLevel` import(L22) 미사용 시 제거.

- [ ] **Step 4: local-render.js + ggui-client.js 정합**

`local-render.js`에서 `profile.assistLevel`/`ageGroup`/data-assist 참조를 고정 프로파일에 맞게 정리, 사용자 노출 문자열 한국어 확인(이미 영어→한글 필요시 변환). `ggui-client.js`에서 normalized의 age_group/assist_level 전달 제거하고, GGUI 생성 프롬프트에 "고령자 친화 큰 글씨" 강도를 상수로 주입.

- [ ] **Step 5: 테스트 갱신 + 통과**

`tests/*.test.mjs`에서 age_group/assist_level 입력 케이스를 transcript 기반·고정강도로 갱신.
Run: `npm --prefix module-c test`
Expected: PASS (갱신된 케이스 포함).

- [ ] **Step 6: 커밋**

```bash
git add module-c/ && git commit -q -m "[refactor] Module C 강도 고령자 고정 + age/assist 입력 제거 + 한국어화"
```

---

## Task 5: Module D — 계약/proxy/recorder 정리 + Realtime 연동 (client·orchestrator·audio)

프론트 로직 레이어에서 proxy/voice/age/behavioral/recorder를 제거하고 Realtime STT로 교체. 어댑티브 강도는 상수 주입.

**Files:**
- Modify: `module-d/src/api/client.ts`
- Modify: `module-d/src/flow/orchestrator.ts`
- Modify: `module-d/src/audio/tts.ts`
- Create/Modify: `module-d/src/audio/realtime.ts` (신규 — Realtime 세션 클라이언트), `module-d/src/audio/recorder.ts` (Realtime 전환 후 정리)
- Modify: `module-d/.env.example`

- [ ] **Step 1: client.ts 정리**

제거: `DEFAULT_KOREAN_DEMO_TEXT`(L41), `KoreanProxyVoiceChoice`(L42), `KOREAN_PROXY_VOICES`(L43-61), `KoreanSeniorProxyAnalyzeResult`(L99-107), `analyzeKoreanSeniorProxy`(L149-188), `proxyAnalyzeToAnalyzeResult`(L190-200), `mockKoreanSeniorProxy`(L202-226), `mockEnglishOrderProxy`(L236-252), `sampleAnalyzeResultYouth` import. `analyze()`(L113-147)는 transcript-only로 축소(또는 Realtime로 대체되어 제거). `AnalyzeOptions`의 `mockVariant` 제거. `generateUI()`는 유지하되 `age_group`/`assist_level`을 더 이상 받지 않음(계약에서 제거됨). `getMenu`/`searchMenu`/`createOrder`/`groundIntent`/`consumeGguiEvents` 유지.

- [ ] **Step 2: realtime.ts 신규 작성**

`RealtimeVoiceSession` 클래스: (1) `/realtime/session`에서 client_secret 받음 → (2) WebRTC로 OpenAI Realtime 연결(마이크 트랙 추가, data channel 오픈) → (3) server VAD가 2초 침묵 감지 시 자동 turn 종료 → (4) `conversation.item.input_audio_transcription.completed` 이벤트에서 최종 한국어 transcript를 콜백으로 반환 → (5) 정지 버튼은 수동 `input_audio_buffer.commit`로 즉시 종료(보조). 연결 실패 시 명확한 한국어 에러로 폴백. (WebRTC SDP offer/answer 핸드셰이크는 OpenAI 문서 형식대로)

- [ ] **Step 3: orchestrator.ts 정리 + Realtime 연동**

제거: `proxyTrace` 필드(L58), `mockVariant`/`setMockVariant`(L102-104,120-126), `proxyVoice`/`setProxyVoice`, `runKoreanProxyPipeline`(L224-257), `playProxyAudioBase64`(L685-705), behavioral assist 분기·`assist()`·`announce()` assist 분기, proxy/voice import. `startVoiceOrder`/`stopAndRun`/`respeak`를 `RealtimeVoiceSession` 기반으로 재작성(2초 VAD 자동종료). 받은 transcript를 기존 `applyVoiceTranscript`/`submitVoiceTurn`(L265-330)에 주입(상태기계 골격 유지). `generateForStep`(L333-372)에서 generateUI 호출 시 age_group/assist_level 인자 제거. announce 안내문 한국어화.

- [ ] **Step 4: tts.ts 한국어화**

`speakWithElevenLabs`(L93-126)·`ELEVENLABS_NARRATION_ENABLED`(L34-38) 제거. `ensureAnnouncerVoice`(L40-66)를 한국어 음성('ko-KR') 선택으로, `speakWithBrowserTTS` lang(L135-137) `en-US`→`ko-KR`. client.ts import 의존 정리.

- [ ] **Step 5: .env.example 정리**

`VITE_ELEVENLABS_NARRATION`·`VITE_KOREAN_DEMO_TEXT`·proxy voiceId 제거. `VITE_REALTIME_URL`(또는 ANALYZE_URL 재사용) 추가.

- [ ] **Step 6: 타입체크**

Run: `cd module-d && npx tsc --noEmit 2>&1 | head -20`
Expected: 이 레이어 에러 0. (UI 컴포넌트 에러는 Task 6에서 해소될 수 있으나, client/orchestrator/audio 자체는 통과해야 함)

- [ ] **Step 7: 커밋**

```bash
git add module-d/src/api module-d/src/flow module-d/src/audio module-d/.env.example && git commit -q -m "[refactor] Module D 로직 레이어 proxy/voice/age 제거 + Realtime STT 연동"
```

---

## Task 6: Module D — UI 2-phase 전환 + 음성버튼 상시 + 한국어화 + Pretendard

App을 kiosk↔voice 2-phase로, before/after 비교 삭제, 음성버튼 상시노출, Start Over 하단 이동, 전 컴포넌트 한국어화, Pretendard 적용.

**Files:**
- Modify: `module-d/src/App.tsx`
- Delete: `module-d/src/ui/StandardComparisonKiosk.tsx`
- Modify: `module-d/src/ui/AdaptiveKiosk.tsx`, `StaticKiosk.tsx`, `kioskProgress.ts`, `emoji.ts`
- Modify: `module-d/src/styles.css`, `module-d/index.html`, `module-d/package.json`

- [ ] **Step 1: StandardComparisonKiosk 삭제 + App 2-phase**

```bash
git rm module-d/src/ui/StandardComparisonKiosk.tsx
```
App.tsx: `AppMode`를 `'kiosk'|'voice'`로. `mode`/`playbackVoice` state 정리(L33-35), 비교모드 자동전환(L40-43)을 `phase===idle→kiosk, else→voice`로. `startVoice`(L50-59)에서 mockVariant/proxyVoice 호출 제거. `choosePlaybackVoice`(L61-64)·voice-selector UI(L101-114) 제거. kiosk-stage(L124-169): `kiosk` phase는 `StaticKiosk`, `voice` phase는 `AdaptiveKiosk`만(comparison-grid 제거). header/footer/스텝퍼 라벨 한국어화.

- [ ] **Step 2: StaticKiosk에 상시 음성버튼 + onStartVoice prop**

`StaticKiosk`에 `onStartVoice: () => void` prop 신설. 매장/포장 선택 영역(start phase L207-239) **아래**에 큰 음성 주문 버튼 배치 + browse/checkout 화면에도 상시 노출(하단 sticky). Start Over(restart, L122-130)를 하단 영역에 상시 배치. 전 문자열 한국어화(정찰 englishStrings 목록 기준).

- [ ] **Step 3: AdaptiveKiosk 강도 고정 + 한국어화**

`effectiveAssistLevel`(L653-660)·`cardCountForState`(L662-664)·`adaptiveMode`(L666-673)·`adaptiveModeLabel`/`rankLabel`(L675-685) 제거 → 항상 고령자 강도(2카드·큰 글씨) 고정. `state.analyze.age`/`behavioral` 참조 제거. age-CSS 훅(L153,317) 제거. `MultiTurnBar`(L620-651) 재설계: 데모용 텍스트 input 제거(Realtime VAD가 대체), 음성버튼 상시 + Start Over 하단. 전 문자열 한국어화. GGUI 임베드(GGUIEmbedFrame L175-238)·routeAdaptiveAction(L240-269) 유지.

- [ ] **Step 4: kioskProgress.ts + emoji.ts**

`KIOSK_PROGRESS_STEPS` label(L4-9) 한국어화. StandardComparisonKiosk 삭제로 `progressIndexForStep`이 미사용이면 제거. `emoji.ts` artFor SVG font-family(L35) `Arial`→`Pretendard`, `won()`은 유지.

- [ ] **Step 5: Pretendard + index.html 한국어화**

`index.html`: `lang="en"`→`ko`(L3), title 한국어(L6), head에 Pretendard CDN `<link>` 추가. `styles.css`: body font-family(L31-33) 최상위에 `'Pretendard Variable', Pretendard,` 추가. 제거 스타일: `.voice-selector`(L262-288), `.proxy-trace`(L403-447), `.comparison-grid`/`.compare-pane` 계열(L310-356 + 산재), `.gen-banner`/`.signal-strip`(L1846-1871), `.age-express`(L1981-1983), data-assist 분기(L1814-1844 → 기본 토큰을 레벨3 값 30/26/18로 고정). `@media`(980/560/860) 내 비교/proxy 규칙 동반 제거. `package.json` description 2-phase 문구로.

- [ ] **Step 6: 빌드 + 한글 레이아웃 점검**

Run: `cd module-d && npm run typecheck && npm run build`
Expected: 0 에러, 빌드 성공. (한글이 영문보다 폭이 넓으므로 `.adaptive-head h2` line-height 0.95 등에서 잘림 없는지 빌드 후 확인 — 필요시 line-height 조정)

- [ ] **Step 7: 커밋**

```bash
git add module-d/ && git commit -q -m "[feat] Module D 2-phase 통합 UI + 상시 음성버튼 + 전면 한국어화 + Pretendard"
```

---

## Task 7: 메뉴 데이터 한국어화 (mocks.json + module-b)

sampleMenu 48개 항목의 name/desc/category/option label을 한국어로. id 슬러그·image_url은 유지.

**Files:**
- Modify: `contracts/mocks.json` (sampleMenu)
- Modify: `module-b/data/menu.seed.json`

- [ ] **Step 1: menu.seed.json 한국어화**

restaurant `OBA Cafe`→`OBA 카페`, categories `[Coffee,Latte,Tea,Ade,Beverage,Dessert]`→`[커피,라떼,티,에이드,음료,디저트]`, 48개 item의 name/desc 한국어, option type(`Temperature`→`온도`, `Size`→`사이즈` 등)·choice label(`Hot`→`뜨겁게`, `Iced`→`차갑게`, `Large`→`크게` 등) 한국어. **id·image_url 유지.** category 값과 categories 배열을 동일하게 맞춤.

- [ ] **Step 2: mocks.json sampleMenu 동기화**

`menu.seed.json`과 동일하게 sampleMenu(L36-2177) 한국어화. (두 파일의 메뉴가 일치해야 mock/실서버 정합)

- [ ] **Step 3: 검증**

Run:
```bash
node -e "const a=require('./contracts/mocks.json').sampleMenu, b=require('./module-b/data/menu.seed.json'); console.log('mocks items', a.items.length, '| seed items', b.items.length, '| restaurant', b.restaurant)"
npm --prefix module-b run start &  sleep 1; curl -s localhost:8001/menu/search?q=라떼 | head -c 300; kill %1 2>/dev/null
```
Expected: 48/48, `OBA 카페`, 라떼 검색 결과 한국어 항목 반환. (검색이 한국어 'q=라떼'로 동작하는지 — 안 되면 server.js 검색 정규화 점검)

- [ ] **Step 4: 커밋**

```bash
git add contracts/mocks.json module-b/data/menu.seed.json && git commit -q -m "[feat] 메뉴 데이터 전면 한국어화 (48개 항목·옵션·카테고리)"
```

---

## Task 8: 통합 검증 + 문서 갱신 + README 재작성

전체 빌드/테스트 통과 확인, 스펙·README를 새 아키텍처로 갱신.

**Files:**
- Modify: 전 스펙(`specs/*.md`, `PLAN.md`, `SPEC.md`, `PIPELINE.md`, `NEXT_TASKS.md`, `contracts/README.md`, 각 모듈 README), 루트 `README.md` 재작성

- [ ] **Step 1: 전체 검증**

Run: `npm run verify && cd module-a && .venv/bin/python -m py_compile app.py inference/*.py`
Expected: module-c test PASS, module-d typecheck+build OK, module-a 컴파일 OK.

- [ ] **Step 2: 잔존 참조 0 확인**

Run: `cd voice-adaptive-kiosk && grep -rn "age_group\|assist_level\|KOREAN_PROXY\|StandardComparison\|elevenlabs\|behavioral" --include="*.ts" --include="*.tsx" --include="*.py" --include="*.js" . | grep -vE "node_modules|\.venv|dist|\.run-logs|docs/superpowers" | head -30`
Expected: 0건 (또는 의도적으로 남긴 것만). 남으면 추적해 제거.

- [ ] **Step 3: 루트 README 재작성**

평가자 대상 핵심 문서. 한국어로 컨셉(음성주문=고령자 배려 + 발화기반 GGUI 동적 UI), 아키텍처(A=Realtime STT 중계, B=메뉴/주문, C=GGUI 생성, D=2-phase UI), 실행법, 데모 흐름, "향후 확장(나이 인식 등 GPU 필요)" 섹션.

- [ ] **Step 4: 스펙 갱신**

`specs/MODULE_A/B/C/D.md`, `CONTRACTS.md`, `INTEGRATION.md`, `PLAN.md`, `SPEC.md`, `PIPELINE.md`, `NEXT_TASKS.md`, `contracts/README.md`, 각 모듈 README를 새 아키텍처로. 제거된 기능 서술 삭제, Realtime/2-phase/한국어화/강도고정 반영. (이 작업은 워크플로우 병렬 가능)

- [ ] **Step 5: 최종 커밋**

```bash
git add -A && git commit -q -m "[docs] 리워크 후 스펙·README 전면 갱신"
```

---

## Self-Review 메모

- **spec 커버리지**: 제거(나이/proxy/ElevenLabs/voice/before-after)=Task 1,2,4,5,6 / Realtime=Task 3,5 / 한국어화=Task 4,6,7,8 / Pretendard=Task 6 / 2-phase=Task 6 / 음성버튼 상시=Task 6 / Start Over 하단=Task 6 / 강도 고정=Task 1,4,5,6 / 문서=Task 8. 전 항목 커버.
- **순서 의존**: Task 1(계약)→2,4(백엔드)→5,6(프론트)→7(데이터)→8(검증/문서). Task 3(Realtime)은 OpenAI 확인 선행 필요.
- **줄번호 주의**: 정찰 시점 기준. 각 Task Step 1에서 실제 파일을 Read로 재확인 후 Edit.
- **미확정**: OpenAI Realtime의 정확한 모델명·세션 API·VAD 파라미터는 Task 3 착수 전 claude-api/공식문서로 확인(계획에 ⚠️ 표시).
