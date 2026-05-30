# specs/ — 세션별 세션-레디 명세 인덱스

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 언어 = **영어**
> 프로젝트 루트: `/Users/taeyoungpark/Desktop/OBA_Weekenthon/voice-adaptive-kiosk`

이 폴더(`specs/`)의 각 문서는 **그 모듈만 아는 새 세션(사람/Codex/Claude)이 혼자서 빌드·실행·테스트할 수 있는 자립형(self-contained) 명세**다. 한 문서만 보고 다른 모듈 없이 격리 개발이 끝나도록 작성됐다.

`SPEC.md` / `PLAN.md` / `PIPELINE.md`(루트)는 **전체 개요·아키텍처 결정·흐름도**다. 반면 **`specs/*` 는 세션-레디**(격리 기동 명령 + 단독 테스트 합격선 포함)다. 작업을 시작할 땐 루트 개요가 아니라 **담당 세션의 `specs/MODULE_*.md` 하나**를 연다.

---

## 운영 방식 (왜 이렇게 쪼갰나)

```
세션별(모듈별) 별도 세션에서 독립 개발·검증
  →  공유 계약(CONTRACTS.md / contracts/types.ts) 기반 mock 으로 상대 모듈 대체
  →  마지막에 한 번에 일괄 병합
```

- 각 모듈/영역을 **서로 다른 세션에서 따로 개발·테스트**한 뒤, **마지막에 한 번에 병합**한다.
- 그래서 각 명세는 **다른 모듈 없이도 단독으로 빌드·검증**되도록 self-contained 여야 한다.
- 병합이 맞물리는 **유일한 근거 = 공유 계약 `contracts/types.ts`**(정본 SSoT). 모든 모듈은 이 계약대로 입출력하고, 다른 모듈은 이 계약 기반 **mock**(`contracts/mocks.json` / `contracts/mocks.ts`, 또는 명세에 박힌 고정 JSON / `*_MODE` env)으로 대체해 격리 개발한다.
- 병합 절차서는 **[INTEGRATION.md](./INTEGRATION.md)** 한 곳에 모았다(포트맵·골든 플로우·계약 정합 체크리스트·동시 기동·end-to-end 검증·알려진 이슈 해소).

---

## 세션 구조 & 명세 인덱스

각 행 = **하나의 독립 세션**. 한 세션이 하나의 명세를 들고 격리 개발한다.

| 세션 | 명세 / 범위 | 소유 | 한 줄 설명 |
|------|-------------|------|-----------|
| **공유 계약** | **[CONTRACTS.md](./CONTRACTS.md)** (병합 linchpin) | **공동(변경 금지)** | 4모듈이 합의하는 단일 계약서. 모든 JSON 타입 + 예시 + 생산/소비 매핑. 정본 = `contracts/types.ts`. **여기를 바꾸면 4모듈 전부 영향** → 4모듈 합의 없이 단독 수정 불가. |
| **module-a** | **[MODULE_A.md](./MODULE_A.md)** — AI 추론 + ElevenLabs (`:8000`) | **Codex** | 음성(wav 16kHz) → `AnalyzeResult`(전사 + 나이대 + **행동신호 `assist_level`**). **+ ElevenLabs 실시간 보이스 생성/검증(`/demo/*`) 흡수** — 구 VOICEGEN 은 이 세션에 통합됨(별도 VOICEGEN 세션 없음). `MOCK_MODE=1` 로 ML 의존성 없이 기동. |
| **module-b** | **[MODULE_B.md](./MODULE_B.md)** — 메뉴/주문 서버 (`:8001`) | **Codex** | `GET /menu`·`/menu/search`·`POST /orders`(mock 결제 항상 `paid`). 메뉴 **데이터 내용**은 별도(→ MENU_DATA_SPEC). 이 세션은 server.js 서빙 로직만. |
| **module-c** | **[MODULE_C.md](./MODULE_C.md)** — GGUI 적응 UI 생성 (`:8002`) | **Claude** | `POST /generate-ui` → 노인친화 적응 UI. GGUI(OpenAI BYOK, `:6781`) 경로 + 키 없는 LOCAL 폴백. **★ 현재 GGUI 실연결 미완 — 결선 핵심 경로.** (아래 ★ 참고) |
| **웹UI (module-d)** | **[MODULE_D.md](./MODULE_D.md)** — 웹 키오스크 프론트 (`:5173`) | **Codex (open-design MCP)** | 마이크→A→B→C 오케스트레이션 + 멀티턴, Standard/Adaptive 두 UI. **데이터 바인딩/삽입 포함**(메뉴 내용은 MENU_DATA_SPEC 소관, 여기선 삽입만). `VITE_USE_MOCK=true` 로 백엔드 없이 완주. |

> ★ **module-c 결선 핵심 경로(현재 미완):** `module-c/src/ggui-client.js` 의 GGUI 호출 순서를
> **`ggui_new_session` → `ggui_handshake`(sessionId required) → `ggui_push`**(`ggui_render` 아님; `embed_url = result.url`) 로 수정해야 GGUI 실연결(`X-GGUI-Path: ggui`)이 된다. 미수정이어도 LOCAL 폴백으로 데모는 돈다. 상세 = `MODULE_C.md` §9, `INTEGRATION.md` §5 ③.

### 외부 분리 명세 (specs/ 밖, 별도 소유)

| 문서 | 범위 | 비고 |
|------|------|------|
| **[../MENU_DATA_SPEC.md](../MENU_DATA_SPEC.md)** | Module B 가 **서빙만** 하는 메뉴 데이터(`module-b/data/menu.seed.json` + `public/img/menu/*.svg`) | **소유 Codex.** `MODULE_B.md`(서빙 로직)와 분리됨 — 항목/가격/옵션/사진 질문은 전부 이 문서. 스키마는 `contracts/types.ts::MenuItem` 준수. |

### 루트 개요 문서 (참고)

| 문서 | 역할 |
|------|------|
| `../SPEC.md` | 구현 명세 **개요** + 핵심 아키텍처 결정(나이모델=`tiantiaf/wavlm-large-age-sex`, EXAONE 없음, 데모 영어 등). |
| `../PLAN.md` | 모듈 분리 **개요/플랜** + 병렬 트랙/통합 순서. |
| `../PIPELINE.md` | 데이터 흐름도. |
| `../README.md` | 루트 통합 README. |

> 정리: **SPEC.md / PLAN.md = 개요**, **specs/* = 세션-레디**(단독 기동·테스트 합격선 포함).

### 잔존 파일 안내

- `specs/VOICEGEN.md` 파일이 물리적으로 남아 있으나 **현 세션 구조에서는 폐지**됐다. ElevenLabs 보이스 생성/검증은 **module-a 세션에 흡수**(`MODULE_A.md` §1·§2 = 구 VOICEGEN). 신규 작업은 VOICEGEN.md 가 아니라 **MODULE_A.md** 를 본다.

---

## 소유표 (누가 어떤 세션을 개발하나)

| 영역 | 소유 세션 | 비고 |
|------|-----------|------|
| Module A (wavlm AI 추론) | **Codex** | `MOCK_MODE` 폴백 완비. 실모델은 vox-profile WavLM age-sex. |
| ElevenLabs 보이스 생성/검증 (`/demo/*`) | **Codex** | module-a 에 흡수(구 VOICEGEN). 별도 세션 아님. |
| Module B (메뉴/주문 서빙 로직) | **Codex** | server.js 만. |
| 메뉴 데이터 (`menu.seed.json` + SVG) | **Codex** | MENU_DATA_SPEC.md 범위. |
| 웹UI / Module D (웹 프론트) + 데이터 삽입 | **Codex (open-design MCP)** | 영어 데모 전환·메뉴 바인딩 담당. 통합 시 Claude(C·통합)와 맞물림. |
| Module C (GGUI 실연결) | **Claude** | GGUI MCP(`:6781`) 실연결 + LOCAL 폴백. **결선 핵심 경로.** |
| 통합 / 병합 | **Claude** | INTEGRATION.md 절차서로 일괄 병합. |
| 공유 계약 `contracts/*` | **공동(변경 금지)** | 4모듈 합의 없이는 누구도 단독 수정 불가. |

---

## 빠른 시작 (어느 세션이든)

1. 담당 세션의 `specs/MODULE_*.md` 한 개를 연다. (계약 의문은 `CONTRACTS.md`.)
2. §5(독립 개발/격리)대로 다른 모듈을 mock(고정 JSON / `*_MODE` env)으로 대체한다.
3. §6(격리 기동)·§7(단독 테스트 합격선)을 통과시킨다 — **다른 모듈 없이 PASS** 가 목표.
4. 병합 시점에는 [INTEGRATION.md](./INTEGRATION.md)의 정합 체크리스트 + 동시 기동(`bash run.sh` / `npm run dev:all` / `npm run health`)으로 end-to-end 를 맞춘다.

> **변경 금지(전 세션 공통):** `contracts/types.ts` 및 미러/샘플(`contracts/schemas.py`·`contracts/mocks.json`·`contracts/mocks.ts`), 그리고 자기 모듈 외 다른 모듈 코드. 격리는 mock 으로만.
</content>
</invoke>
