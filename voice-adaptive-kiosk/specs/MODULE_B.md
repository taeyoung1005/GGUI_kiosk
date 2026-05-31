# 명세: Module B — 메뉴/주문 백엔드

> OBA Weekend-thon · 음성 적응형 키오스크 (GGUI 트랙) · 데모 영어.
> **자립형 명세**: 이 모듈만 아는 새 세션(사람/Codex/Claude)이 다른 모듈 없이 혼자 빌드·테스트·검증할 수 있게 작성됨.
> 병합의 유일한 근거 = 공유 계약 `contracts/types.ts`. 다른 모듈은 이 계약 기반 mock 으로 대체한다.

---

## 1. 목적·책임 (이 모듈 범위)
- **메뉴 제공 + 주문/결제(mock) 백엔드.** Express(ESM) 단일 서버.
- 책임:
  - 전체 메뉴 서빙 (`GET /menu`)
  - 메뉴 검색 (`GET /menu/search`)
  - 주문 생성 = mock 결제, 항상 `status:"paid"` (`POST /orders`)
  - 주문 단건 조회 (`GET /orders/:id`)
  - 헬스체크 (`GET /health`)
  - 메뉴 이미지 정적 서빙 (`/img/*` → `public/img`)
- **범위 밖(중요): 메뉴 데이터 자체.** `data/menu.seed.json` 의 **내용/사진 생성은 이 명세가 아니라 별도 문서**가 담당한다 → **[MENU_DATA_SPEC.md](../MENU_DATA_SPEC.md)** (소유 Codex). 이 서버는 그 파일을 **읽어서 서빙만** 한다. 항목 추가/가격/옵션 라벨 등 데이터 질문은 전부 그 문서로.

---

## 2. 소유 세션 / 누가 개발
- **소유: Codex.**
- 데이터(JSON·SVG)도 Codex 소유지만 그건 MENU_DATA_SPEC.md 범위. **이 명세는 server.js(서빙 로직)만** 다룬다.
- 통합/병합은 Claude.

---

## 3. 입출력 계약 (병합 glue)
`contracts/types.ts` 중 **이 모듈이 생산/소비하는 타입**. 필드명은 코드와 1:1 일치한다.

### 생산 (B → D, C가 소비): `Menu` / `MenuItem` / `MenuOption` / `MenuOptionChoice`
`GET /menu` 응답은 그대로 `Menu`:
```json
{
  "restaurant": "OBA Cafe",
  "categories": ["Coffee", "Latte", "Tea", "Ade", "Beverage", "Dessert"],
  "items": [
    {
      "id": "americano-001",
      "name": "Americano",
      "category": "Coffee",
      "price": 3500,
      "image_url": "/img/menu/americano-001.svg",
      "desc": "A clean espresso-forward coffee with a smooth finish.",
      "options": [
        { "type": "Temperature", "choices": [
            { "label": "Hot",  "price_delta": 0 },
            { "label": "Iced", "price_delta": 0 } ] },
        { "type": "Size", "choices": [
            { "label": "Regular", "price_delta": 0 },
            { "label": "Large",   "price_delta": 500 } ] },
        { "type": "Shot", "choices": [
            { "label": "Single", "price_delta": 0 },
            { "label": "Double", "price_delta": 500 } ] }
      ]
    }
  ]
}
```
- `GET /menu/search?q=latte` 응답은 계약 타입이 아닌 래퍼: `{ "query": "latte", "count": 10, "items": MenuItem[] }`. (검색 결과 wrapper — `items`만 `MenuItem[]`)
- 실데이터: `restaurant="OBA Cafe"`, **항목 48개**, 옵션 라벨은 **영어**(Temperature/Size/Shot, Hot/Iced/Regular/Large…). `contracts/types.ts` 의 한국어 예시(온도/HOT)는 **타입 형태 예시일 뿐**, 실제 라벨은 영어 데이터를 따른다.

### 소비 (D → B): `OrderRequest` / `OrderLine`
`POST /orders` 요청 바디 = `OrderRequest`:
```json
{
  "items": [
    { "item_id": "americano-001", "options": { "Temperature": "Iced", "Size": "Large" }, "qty": 2 }
  ]
}
```
- `options` 는 `{ 옵션type: 선택label }` 맵. 키/값은 메뉴 데이터의 `option.type` / `choice.label` 과 일치해야 가격 가산이 반영됨(불일치 시 0 가산으로 견고하게 무시).

### 생산 (B → D): `OrderResponse`
`POST /orders` (201) 와 `GET /orders/:id` (200) 응답 = `OrderResponse`:
```json
{ "order_id": "ord-1001", "total": 8000, "status": "paid" }
```
- `total` = Σ (기본가 + 선택 옵션 price_delta) × qty. `status` 는 **항상 `"paid"`** (mock).
- `order_id` 형식: `ord-<seq>`, 1001부터 증가.

---

## 4. 기술 스택 + 파일 트리 (현재 실제)
- **Node ESM**(`"type":"module"`) + **Express 4** + **cors**. dotenv 의존성 없음(자체 경량 `.env` 로더). `engines.node >= 18` (개발기 검증 Node 24).
- 외부 DB·API 키 **없음**. `data/menu.seed.json` 을 in-memory 로드.

```
module-b/
├── server.js              # 단일 서버 (엔드포인트 전부 여기)
├── package.json           # start: node server.js / dev: node --watch server.js
├── package-lock.json
├── .env.example           # PORT=8001 (가이드)
├── .env.local             # PORT=8001 (git 무시, server.js 가 자동 로드)
├── .gitignore             # node_modules/, .env, .DS_Store …
├── README.md
├── node_modules/          # 설치 완료 (express, cors)
├── data/
│   └── menu.seed.json     # ← MENU_DATA_SPEC.md 소유. 서버는 읽기만.
└── public/
    └── img/menu/          # 항목별 SVG 48개 (image_url 가 가리킴). MENU_DATA_SPEC.md 소유.
```
- `.env` 로딩 우선순위: **셸 export > `.env.local` > `.env`**. 서버가 읽는 유일 변수 = `PORT`(기본 8001).

---

## 5. 독립 개발 (격리) — 다른 모듈 mock 방법
이 모듈은 **그 자체로 완전 격리 동작한다.** 외부 의존(다른 모듈·키·DB) 0.
- **A(8000)/C(8002)/D(5173) 불필요**: B는 어떤 모듈도 호출하지 않는다. 데이터는 로컬 JSON.
- **메뉴 데이터 mock**: 이미 `data/menu.seed.json`(항목 48개)이 박혀 있어 그대로 기동된다. 데이터를 새로 만들 일이 있으면 이 명세가 아니라 **MENU_DATA_SPEC.md** 를 따른다(경로/스키마 고정).
- **소비자(D) 입장 검증**: B를 단독 기동 후 위 §3 JSON 으로 `curl` 만 하면, D/C가 없어도 계약 입출력 전체를 검증할 수 있다(§7).
- **키·외부의존 없이 도는 법**: `npm install` 후 `node server.js` 끝. 인터넷·시크릿 불필요.

---

## 6. 실행 — 격리 기동 명령
```bash
cd module-b
npm install                 # express, cors (최초 1회; node_modules 이미 있으면 생략 가능)

# 방법 A: 스크립트
npm start                   # = node server.js (PORT 는 .env.local/.env 로 8001)

# 방법 B: 포트 명시(셸 export 가 최우선)
PORT=8001 node server.js

# 개발(파일 변경 자동 재시작)
npm run dev                 # = node --watch server.js
```
기동 시 콘솔: `메뉴/주문 백엔드 가동 → http://localhost:8001`, 식당/항목수/카테고리/엔드포인트 로그 출력.

---

## 7. 테스트·검증 기준 (이 모듈 단독 통과)
> 다른 모듈 없이, 아래만으로 PASS 해야 한다.

**A. 정적 검증(서버 불필요)**
```bash
cd module-b
node --check server.js      # 문법 OK (현재 PASS)
node -e "JSON.parse(require('fs').readFileSync('data/menu.seed.json','utf8'))"  # 시드 파싱 OK
```

**B. 런타임 스모크(서버 기동 후, 별 터미널)**
```bash
# 헬스: status ok, items 48
curl -s localhost:8001/health

# 메뉴 전체: restaurant="OBA Cafe", items 길이 48, 각 item 에 id/name/price/options
curl -s localhost:8001/menu | head -c 400

# 검색: latte 다건 반환 (count>0, items 가 MenuItem[])
curl -s "localhost:8001/menu/search?q=latte"

# 주문 생성: 201, status:"paid", total>0, order_id="ord-100x"
curl -s -X POST localhost:8001/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"item_id":"americano-001","options":{"Size":"Large"},"qty":2}]}'

# 주문 조회: 위 order_id 로 200 + 동일 OrderResponse
curl -s localhost:8001/orders/ord-1001

# 정적 이미지: /img/menu/americano-001.svg → 200 (SVG)
curl -s -o /dev/null -w "%{http_code}\n" localhost:8001/img/menu/americano-001.svg

# 에러 경로: 빈 items → 400, 없는 주문 → 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8001/orders -H 'Content-Type: application/json' -d '{"items":[]}'
curl -s -o /dev/null -w "%{http_code}\n" localhost:8001/orders/ord-9999
```

**합격선**
- `node --check` 통과(현재 PASS).
- `/health` → `status:"ok"`, `items:48`.
- `/menu` → `Menu` 형태(restaurant + categories + items 48).
- `/menu/search?q=latte` → `count>0`, `items` 가 `MenuItem[]`.
- `POST /orders`(유효) → 201 + `{order_id, total>0, status:"paid"}` (응답까지 1~2초: mock 결제 지연 정상).
- `GET /orders/:id` → 동일 `OrderResponse`. 없는 id → 404. 빈 `items` → 400.
- `/img/menu/<id>.svg` → 200.

---

## 8. 변경 금지
- **`contracts/types.ts`** — 절대 수정 금지(정본 계약).
- **다른 모듈**(module-a / module-c / frontend / contracts/schemas.py 등) — 수정 금지.
- **메뉴 데이터/사진**(`data/menu.seed.json`, `public/img/menu/*`) — 이 명세 범위 밖. 변경은 **MENU_DATA_SPEC.md** 절차로만(경로·파일명 `menu.seed.json` / `public/img` 고정 — server.js 가 이 위치를 하드코딩 로드).
- 엔드포인트 경로·필드명을 바꾸면 D/C 와의 병합이 깨진다 → 계약대로만.

---

## 9. 현재 상태 (코드 읽고 사실)
- **동작함.** `node --check server.js` PASS, `menu.seed.json` 파싱 OK, 항목 48개(`OBA Cafe`, 카테고리 Coffee/Latte/Tea/Ade/Beverage/Dessert), `public/img/menu/` 에 SVG 48개 존재. `node_modules` 설치 완료.
- 엔드포인트 5종 + `/img` 정적 서빙 모두 구현됨. mock 결제 지연 1~2초, 주문 in-memory(`ord-1001`+). CORS 전체 허용(데모용).
- 견고성: 없는 `item_id`/옵션 라벨은 0 가산 무시, 전부 무효면 400. 데이터 영어, 검색은 한/영 정규화(소문자+공백제거) + 3글자 이상 토큰 부분일치.
- 깨진 곳 없음. 남은 것: 데이터 큐레이션은 MENU_DATA_SPEC.md 소관(서버 변경 불필요).

---

## 10. 병합 체크포인트 (합칠 때 만족해야 할 것)
- B는 **8001** 에서 단독 기동되어야 한다(포트맵: A=8000, B=8001, C=8002, D=5173, GGUI MCP=6781).
- `GET /menu` 가 `contracts/types.ts` 의 `Menu` 와 정확히 일치(필드명·중첩). C(GGUI 생성)는 `menu_context: MenuItem[]` 로 이 항목들을 그대로 받는다.
- `POST /orders` 가 `OrderRequest`(`items:[{item_id, options, qty}]`) 를 받아 `OrderResponse`(`{order_id, total, status:"paid"}`) 를 돌려준다 — D의 주문 확정 흐름과 맞물림.
- CORS 가 프론트 오리진(localhost:5173 등)을 허용(현재 전체 허용 → OK).
- §7 스모크 전체 PASS. 데이터 계약(48개 항목·image_url 경로↔실제 SVG) 은 MENU_DATA_SPEC.md 검증과 합치되어야 함(이 명세는 서빙만 보장).
