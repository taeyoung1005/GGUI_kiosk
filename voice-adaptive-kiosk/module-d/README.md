# Module D — 웹 키오스크 프론트

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙)
> React + Vite + TypeScript. **두 UI 모드**(일반 ↔ 적응)로 *before/after* 를 대조한다.

음성으로 주문하면, 화자의 **행동신호(assist_level 0~3)** 와 **나이대(보조)** 에 맞춰
화면이 바뀐다. 느린 어르신에게는 큰 카드·큰 글씨·음성안내, 빠른 청년에게는 압축 UI.

---

## ⚡ 빠른 시작 (백엔드/키 없이 — mock 모드)

```bash
cd module-d
npm install
cp .env.example .env     # 기본값이 VITE_USE_MOCK=true → 그대로 둬도 됨
npm run dev              # http://localhost:5173
```

`VITE_USE_MOCK=true` 면 A(/analyze)·B(/menu,/orders)·C(/generate-ui) 호출을
루트 `contracts/mocks` 의 고정 JSON 으로 대체한다. **백엔드 없이 일반 UI + 전체 흐름**
(가짜 발화 → mock analyze → mock menu → mock 적응 UI → 결제 완료)이 화면에서 돈다.

> 마이크 권한이 없어도, mock 모드에선 "음성으로 주문 시작" 을 누르면 가짜 발화로 흐름이 진행된다.

### 데모 시나리오 (적응 증명)

1. 상단/마이크 바에서 **MOCK** 배지 확인.
2. 마이크 바의 재생 음성(**Voice 1 / Voice 2**, KOREAN_PROXY_VOICES)을 고르고 "음성으로 주문 시작".
   → 기본 어르신(느림) 시나리오가 고정되어(`flow.setMockVariant("elder")`) assist_level **2**,
     큰 카드·큰 글씨·음성안내(TTS) 화면이 나온다.
   → **같은 발화라도 행동신호가 달라 화면이 갈린다** = 적응 핵심.
     (한국어 proxy 입력 `라떼 한 잔 주세요` 는 영어 proxy `I would like a latte, please.` 로 번역되어 표시·재생된다.
      orchestrator 에 youth(빠름·assist_level 0·압축 UI) 분기도 있으나 현재 UI 토글로는 노출되지 않는다.)
3. 메뉴 선택 → 옵션(Temperature/Size) → 매장/포장 → 적립 → 결제수단 → "예, 결제할게요" → **결제 완료**.
4. 진행 중 "🎤 다시 말하기" 로 멀티턴(재발화) 가능.

음성 주문을 시작하면 자동으로 비교 화면(좌: 일반 동일단계 / 우: 적응)으로 전환된다
(`mode` 는 state.phase 에 따라 idle→standard-only, 흐름 시작→adaptive-compare 로 자동 전환).

---

## 🔌 실서비스 결선 (mock 제거)

`.env` 를 수정한다:

```bash
VITE_USE_MOCK=false
VITE_ANALYZE_URL=http://localhost:8000     # Module A (원격이면 이 URL만 교체)
VITE_MENU_URL=http://localhost:8001        # Module B
VITE_GGUI_URL=http://localhost:8002        # Module C (/generate-ui 래퍼)
VITE_ANALYZE_API_KEY=                       # A 원격 폴백 노출 시 Bearer 토큰
```

이후 `npm run dev`. 호출 매핑:

| 단계 | 호출 | 모듈 | 비고 |
|------|------|------|------|
| 분석 | `POST {ANALYZE_URL}/analyze` (multipart `file`) | A | 16kHz mono wav 우선 |
| 메뉴 | `GET {MENU_URL}/menu`, `GET /menu/search?q=` | B | |
| 적응 UI | `POST {GGUI_URL}/generate-ui` | C | `embed_url` 반환 |
| 주문 | `POST {MENU_URL}/orders` | B | mock 결제 `status:"paid"` |

C 가 `embed_url` 을 주면 **AdaptiveKiosk 가 그 URL 을 임베드**한다
(가능하면 `@ggui-ai/react`, 어려우면 `<iframe src=embed_url>`).
`embed_url` 이 비어 있으면(mock/폴백) **내장 적응 렌더러**로 동일 구조를 직접 그린다.

---

## 🗂 파일 구조

```
module-d/
├── index.html
├── package.json            # react, react-dom, vite (+ @ggui-ai/react optional)
├── tsconfig.json           # resolveJsonModule, @contracts/* 경로
├── vite.config.ts          # 루트 contracts/ import 허용(alias + fs.allow)
├── .env.example            # VITE_USE_MOCK, VITE_*_URL ...
└── src/
    ├── main.tsx            # React 진입점
    ├── App.tsx             # 음성 흐름 시작 시 일반→비교(일반|적응 나란히) 자동 전환 + 진행 스텝퍼
    ├── styles.css          # assist_level 별 적응 스타일
    ├── api/client.ts       # A/B/C 호출 + VITE_USE_MOCK 토글(contracts/mocks)
    ├── flow/orchestrator.ts# 마이크→analyze→menu→generate-ui→render→order (멀티턴)
    ├── flow/voiceIntent.ts # 발화 transcript → 의도(select/options/fulfillment/...) 해석
    ├── audio/recorder.ts   # MediaRecorder 캡처 → 16kHz mono wav 변환
    ├── audio/tts.ts        # ElevenLabs 영어 안내(announcer-voice) + 실패 시 speechSynthesis(en-US) 폴백
    └── ui/
        ├── StaticKiosk.tsx # 일반 키오스크(메뉴 그리드) = before/폴백
        ├── StandardComparisonKiosk.tsx # 비교모드 좌측 일반 키오스크(동일 단계 대조)
        ├── AdaptiveKiosk.tsx# C embed_url iframe + 내장 적응 렌더러 = after
        ├── kioskProgress.ts # 진행 단계(Menu/Options/Place/Points/Pay/Review) 라벨
        └── emoji.ts        # 메뉴 썸네일 이모지/금액 포맷
```

공유 계약은 루트 `../contracts/types.ts`(정본) 와 `../contracts/mocks.ts` 를
`@contracts/*` alias 로 직접 import 한다.

---

## 🎛 두 UI 모드 (★ 데모 핵심)

- **StaticKiosk (일반 · before · 폴백)**: 평범한 메뉴 그리드 + 작은 글씨.
  A/C 무응답·오류 시 자동 폴백. 음성 없이 터치로도 주문 완결 가능.
- **AdaptiveKiosk (적응 · after)**: C 생성 화면 임베드. 단계 흐름 고정(추천 → 옵션 →
  매장/포장 → 적립 → 결제수단 → 확인), **assist_level 로 글자·여백·음성안내만 강화**.
  - `assist 0`: 압축 UI, 음성안내 생략
  - `assist 2~3`: 큰 카드·큰 글씨·천천히 또박또박 TTS

---

## 🧩 흐름 (orchestrator)

```
🎤 마이크
  └→ A.analyze   → {transcript, age, assist_level}
  └→ B.menu/search → 후보 2~3
  └→ C.generate-ui (step=recommend) → AdaptiveKiosk 렌더
       └ 메뉴 선택 → C(step=options) → 옵션 확정
            └ C(step=fulfillment) → 매장/포장
                 └ C(step=loyalty) → 적립
                      └ C(step=payment) → 결제수단
                           └ C(step=confirm) → "예, 결제할게요"
                                └→ B.orders(mock) → ✅ 결제 완료 + TTS
  멀티턴: 어느 단계에서든 "🎤 다시 말하기" → 새 analyze
  폴백:   A/C 오류 → 에러 화면 → 일반(Static) 화면으로
```

---

## 🛠 명령어

```bash
npm install        # 의존성 설치
npm run dev        # 개발 서버 (http://localhost:5173, VITE_USE_MOCK=true 기본)
npm run build      # 타입체크 + 프로덕션 번들(dist/)
npm run preview    # 빌드 결과 미리보기
npm run typecheck  # 타입만 검사
```

---

## 📝 메모

- **적응 주축 = 행동신호(`behavioral.assist_level`)**, 나이(`age.group`)는 보조.
  나이 분류가 부정확해도 행동신호로 UI 강도가 결정된다(SPEC §0.3, contracts/README).
- TTS 는 Module A 의 ElevenLabs 영어 내레이션(`/demo/announcer-voice/audio`)이 기본,
  실패 시 브라우저 `speechSynthesis`(en-US)로 폴백한다. 영어 announcer 보이스 미탑재 환경 주의.
- 마이크 캡처는 가능하면 16kHz mono **wav** 로 변환해 A 로 전송(WebAudio 디코드+다운샘플).
  변환 실패 시 원본 webm/ogg 로 전송한다.
- `@ggui-ai/react` 는 optionalDependency — 미설치여도 단순 iframe 으로 임베드한다.
```
검증 기준(SPEC §8): 느린 어르신 "라떼…" → 후보 3장 → "따뜻한 거로?" → 결제 완료 완주
+ 같은 말을 빠르게 하면 다른(압축) 화면 = 적응 증명
```
