# Module B — 메뉴/주문 백엔드

> OBA Weekend-thon S1 · GGUI 트랙 · **음성 적응형 키오스크**
> Node(ESM) + Express. 메뉴 데이터 제공 + 주문 + **mock 결제**(항상 `status:"paid"`).
> 공유 계약: 루트 `contracts/types.ts` 의 `Menu` / `MenuItem` / `OrderRequest` / `OrderResponse` 를 그대로 따름.

이 모듈은 **외부 의존성·API 키 없이 즉시 기동**된다. 메뉴는 `data/menu.seed.json` 을
in-memory 로 로드하고, 주문은 in-memory 로 보관한다(서버 재시작 시 초기화).

---

## 빠른 실행

```bash
cd module-b
npm install          # express, cors 설치
node server.js       # → http://localhost:8001
```

포트를 바꾸려면 (기본 8001, SPEC §7 포트맵):

```bash
PORT=8001 node server.js
# 또는 .env.example 을 .env 로 복사 후 PORT 수정
cp .env.example .env
```

개발 중 자동 재시작이 필요하면(Node 18+):

```bash
npm run dev          # node --watch server.js
```

---

## 엔드포인트 (SPEC §3.2)

| 메서드 | 경로 | 설명 | 응답 |
|--------|------|------|------|
| GET | `/menu` | 전체 메뉴 | `Menu` |
| GET | `/menu/search?q=라떼` | 이름·설명·카테고리 부분일치 검색 | `{ query, count, items: MenuItem[] }` |
| POST | `/orders` | 주문 생성 (1~2초 결제 지연) | `OrderResponse` (`status:"paid"`) |
| GET | `/orders/:id` | 주문 조회 | `OrderResponse` / 404 |
| GET | `/health` | 헬스체크 | `{ status:"ok", ... }` |

- CORS 는 모든 오리진 허용(데모용) → 프론트(`localhost:5173`)에서 바로 호출 가능.
- `/menu/search` 에서 **"라떼"** 로 검색하면 카페라떼·바닐라라떼·녹차라떼·초코라떼·고구마라떼 등
  **라떼류 다수가 반환**된다 (추천/모호성 데모의 핵심).

---

## 데이터 (`data/menu.seed.json`)

실제같은 한국 **카페 + 분식** 1곳(`OBA 한끼카페`)의 메뉴 **20개**.
카테고리: `커피 · 라떼 · 음료 · 분식 · 디저트`.

각 항목은 `contracts` 의 `MenuItem` 형태:
`{ id, name, category, price, image_url, desc, options[] }`.
옵션은 `{ type, choices:[{ label, price_delta }] }` — 예: 온도(HOT/ICE), 사이즈(R/L, L은 +500),
샷/우유/당도/맵기/토핑 등.

> 라떼류(라떼 카테고리) 5종 + "라떼"가 이름/설명에 들어가는 항목이 충분히 들어 있어,
> 음성 "라떼…" 입력 시 후보 다수가 잡히도록 설계되어 있다.

`image_url` 은 placeholder 경로(`/img/menu/*.png`). `public/img/menu/` 에 실제 이미지를 두면
서버가 정적으로 서빙하며, 없어도 흐름에는 영향 없다(이미지 404 만 발생).

---

## 가격 계산 규칙 (`POST /orders`)

각 주문 라인의 **합계 = (기본가 + 선택 옵션들의 `price_delta` 합) × 수량**.
선택한 옵션 라벨이 메뉴 정의에 없으면 0 으로 간주(데모 견고성). 존재하지 않는 `item_id` 는 무시하되,
모든 라인이 무효면 400.

---

## curl 예시

```bash
# 전체 메뉴
curl -s http://localhost:8001/menu | head

# "라떼" 검색 → 라떼류 다수
curl -s "http://localhost:8001/menu/search?q=라떼"

# 주문 (mock 결제, 1~2초 후 응답)
curl -s -X POST http://localhost:8001/orders \
  -H "Content-Type: application/json" \
  -d '{ "items": [ { "item_id": "cafelatte-003", "options": { "온도": "HOT", "사이즈": "L" }, "qty": 1 } ] }'
# → { "order_id": "ord-1001", "total": 5000, "status": "paid" }

# 주문 조회
curl -s http://localhost:8001/orders/ord-1001
```

---

## 다른 모듈과의 관계

```
Module D (프론트) ──GET /menu────────► Module B
Module D / C      ──GET /menu/search─► Module B   (라떼 후보 검색)
Module D          ──POST /orders─────► Module B   (옵션 확정 → mock 결제)
```

이 모듈은 A·C 없이도 단독 동작한다(병렬 개발용).
