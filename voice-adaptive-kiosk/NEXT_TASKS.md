# NEXT_TASKS — 다음 작업 (세션-레디)

> OBA Weekend-thon · 음성 적응형 키오스크. 데모=영어. 통합 루트 = `voice-adaptive-kiosk/`.
> 현재: A(module-a)·C(GGUI 생성) 마무리 단계. B·D·메뉴데이터·계약(영어 decade)·module-c 영어화/나이정규화 수정 완료.
> 각 묶음을 별도 세션(Codex/Claude)에 그대로 전달 가능. 공유 계약 `specs/CONTRACTS.md`는 누구도 변경 금지.

---

## Phase 1 — 결선 (Full Integration) ★ 지금 최우선

### T1. 라이브 전체 기동 + 헬스
- 동시 기동: A(`:8000` uvicorn, **STT는 기본 `STT_MODEL=whisper-1`(OpenAI Whisper API)로 이미 on**; 로컬 모델로 돌리려면 `STT_MODEL=local:small`), B(`:8001`), GGUI(`:6781`, OpenAI 키 주입), C(`:8002` GGUI_MODE=ggui), D(`:5173`, **VITE_USE_MOCK=false**).
- `run.sh`/`scripts/health.mjs`를 새 구조(module-a=VAK 내부)에 맞게 점검.
- **DoD**: `npm run health` 또는 4개 포트 health 200.

### T2. 골든 플로우 라이브 검증
- D에서: 발화 → **A `/analyze`** → **B `/menu`** → **C `/generate-ui`(GGUI)** → embed 렌더 → 옵션 → 확인 → **B `/orders`** → 결제 완료.
- ★계약 필드 실측 정합: A `age.group`(**영어 decade 버킷**) → C → D, A `assist_level` → C, B `menu` → C `menu_context`.
- **DoD**: 전체 흐름 끊김 없이 1회 완주 + 스크린샷.

---

## Phase 2 — GGUI 안정화 (live-gen 마무리 직후)

### T3. GGUI 라이브 생성 완료 확인  *(C 세션/사용자)*
- 생성이 실제 컴포넌트를 만들어 embed가 **200으로 렌더**되는지(현재 이슈: 202 "Generating UI…" 고정 → forceCreate/모드 조정 중).
- **DoD**: senior/youth embed_url을 Playwright로 열면 실제 UI(카드/버튼) 렌더(200).

### T4. GGUI 지연 대응 — blueprint 사전생성·캐시  *(C 세션)*
- LLM 생성이 느리면(>~10s) **키오스크엔 부적합** → blueprint를 **사전생성/캐시**해 데모 땐 candidates>0으로 즉시 재사용.
- 프로파일×step(예: eff0/eff3 × recommend/options/confirm)을 행사 전 1회 생성해 워밍.
- **DoD**: 데모 중 화면 전환 체감 **<~3초**.

### T5. GGUI iframe ↔ module-d 액션 배선  *(C+D)*
- GGUI 화면 버튼(Order this 등) 클릭 → **module-d로 이벤트 전달 → 다음 step 진행**. (GGUI ggui_consume / postMessage)
- 안 되면 설계 대안: **GGUI는 추천 화면만 생성**, options→confirm→결제는 module-d 내장(LOCAL) 렌더러.
- **DoD**: GGUI 화면에서 결제까지 진행되거나, 대안 경로로 완주.

### T6. 연령 적응 UI 재검증  *(Codex 검증 세션, 이전 FAIL 재시도)*
- senior(eff3: 30px/2카드/음성) vs youth(eff0: 18px/3카드/무음성)가 **유의미하게 다른지** + 전부 영어 + 전 step + 스크린샷 비주얼 분석. 틀리면 module-c 프롬프트 튜닝(→Claude).
- 참고 스펙: 기존 `tmp/ggui-age-validation/` 스크립트 재사용.
- **DoD**: 적응 차이 PASS(프로파일×지표 비교표 + 스크린샷).

---

## Phase 3 — 정리/일관성

### ~~T7. LOCAL 렌더러 영어화~~ + 적응 검증  *(Claude, 안전망)* — **[영어화 완료]**
- ~~`module-c/src/local-render.js` 한국어 → 영어.~~ **[완료]** 사용자 노출 문자열은 이미 전부 영어(버튼 `Order this`/`Back`/`Continue`/`Yes, Pay`/`No, choose again`, 결제수단 `Credit Card`/`Gift Card`/`Kakao Pay`/`Naver Pay`/`Pay at Counter`, voice-hint 등). 화면 카피(stepCopy)도 adapt.js에서 전부 영어. 한국어는 코드 주석 일부에만 잔존(렌더 출력 아님, 선택 정리).
- LOCAL은 GGUI 라이브가 메인/목표인 상황의 **폴백**(현재 GGUI codeReady=false 블로커로 임시 LOCAL 폴백 중)이라, 빠르고 적응형인 안전망으로서 적응 차이·전 흐름 영어 완주만 재확인하면 됨.
- **DoD(잔여)**: LOCAL 경로로 senior/youth 다른 UI + 전 흐름 영어 완주 재확인.

### T8. 잔여 라벨/문서 정합  *(Claude)* — **[일부 완료]**
- ~~`contracts/README.md`·`contracts/mocks.ts` 주석의 옛 라벨(`50+`/`under50`) → decade.~~ **[완료]** contracts/ 전체에 `50+`/`under50`/`50plus` 옛 이진 라벨 grep 0건(이미 decade 라벨만; types.ts AgeGroup도 `young_adult…seventies_plus`).
- ~~`specs/MODULE_A.md` 경로(구 루트 → `voice-adaptive-kiosk/module-a`)~~ **[완료]** — 이미 `voice-adaptive-kiosk/module-a` 정경로로 갱신됨.
- **잔여**: `specs/INTEGRATION.md`·`README.md` 최신화.
- **DoD**: 옛 라벨 grep 0건(충족), specs 경로 정확(충족), INTEGRATION/README 최신.

### T9. STT 동작 확인  *(A 세션)*
- 기본 `STT_MODEL=whisper-1`(OpenAI API) 또는 로컬 검증 시 `STT_MODEL=local:small`로 transcript 채워지고 behavioral(speech_rate·filler·silence)이 의미 있게 산출되는지. (STT off는 `STT_MODEL`이 빈값/`none`/`off`/`disabled`일 때만 NoopSTT로 transcript 빈값 — 기본 경로는 이미 transcript가 채워짐.)
- **DoD**: 실제 영어 발화 → transcript + assist_level 변동 확인.

---

## Phase 4 — 데모 마감

### T10. 골든 데모 시나리오 리허설 + 스크린샷
- "느린 어르신 → 'Uh… a latte…' → 적응 UI(큰글씨·2카드·음성) → 옵션 → 결제완료" + "빠른 청년 대조". 발표용 캡처.
- **DoD**: before/after 대조 + 완주 영상/캡처.

### T11. 폴백/견고성 (데모 보험)
- GGUI 실패→LOCAL, A 실패→정적/터치, 네트워크 변동 대비. **리플레이 모드**(녹음/합성 발화 재생)로 마이크·소음 사고 대비.
- **DoD**: 마이크 없이도 데모 완주 가능.

### T12. 병합/git 정리  *(Claude)*
- 세션별 누적 변경(contracts·module-a 이동·module-c·module-d·specs) **통합 커밋 + 충돌 점검**, 통합 repo `build`+`run` 재확인.
- **DoD**: 클린 트리에서 `run.sh`로 전체 기동 성공.

---

## 알려진 이슈/결정 (참고)
- **GGUI 라이브 생성 지연/미작동**: 화면마다 LLM 생성은 키오스크엔 느림 → **사전생성·캐시(T4)** 또는 **LOCAL 적응 렌더러(T7)**가 현실적 메인. GGUI는 "blueprint 생성 엔진"으로 포지셔닝.
- **나이 라벨**: 계약=영어 decade 버킷(`child…seventies_plus`,`unknown`). adapt.js 시니어셋=`fifties/sixties/seventies_plus`. server.js 정규화 버그 수정 완료(통과).
- **적응 주축**: `assist_level`(0~3, 행동신호). 나이는 보조(시니어면 effective +1).
- **module-a 정본**: `voice-adaptive-kiosk/module-a`(루트에서 이동 완료). ElevenLabs 연령대별 음성 생성은 module-a `/demo/*` API로 유지하되 `/demo` 웹 페이지는 서빙하지 않음.

## 추천 진행 순서
**Phase 1(결선) → T3·T4(GGUI 안정화) → T6(재검증) → Phase 3(정리) → Phase 4(데모 마감).**
GGUI 지연이 안 풀리면 **T7(LOCAL)을 데모 메인**으로 즉시 승격 — 이게 안전망.
