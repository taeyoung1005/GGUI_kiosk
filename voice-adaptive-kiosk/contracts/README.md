# contracts/ — 공유 데이터 계약

`types.ts` 가 정본(canonical)이고, `schemas.py` 는 Python 미러입니다.

## 현재 데이터 흐름

```text
D --OpenAI Realtime transcript--> AnalyzeResult
D --GET-------------------------> B /menu        --> Menu
D --GenerateUIRequest-----------> C /generate-ui --> GenerateUIResponse
D --OrderRequest----------------> B /orders      --> OrderResponse
```

Module A는 더 이상 오디오 업로드 STT(`/analyze`)를 제공하지 않습니다. A의 역할은
`/realtime/session`에서 OpenAI Realtime ephemeral token을 발급하는 것입니다.
비서 음성은 브라우저 WebRTC 오디오 트랙으로 직접 재생됩니다.

## 계약 목록

| 계약 | 방향 | 설명 |
|------|------|------|
| `AnalyzeResult` | D 내부 | Realtime transcript를 상태기계에 전달하는 얇은 wrapper |
| `Menu` / `MenuItem` / `MenuOption` | B → D/C | 메뉴와 옵션 데이터 |
| `GroundIntentRequest` / `GroundIntentResponse` | D → C | step-aware menu grounding |
| `GenerateUIRequest` / `GenerateUIResponse` | D → C | GGUI 적응 UI 생성 |
| `OrderRequest` / `OrderResponse` | D → B | mock 결제 주문 |

계약이 바뀌면 `types.ts`, `schemas.py`, `mocks.json`, `mocks.ts`를 함께 확인합니다.
