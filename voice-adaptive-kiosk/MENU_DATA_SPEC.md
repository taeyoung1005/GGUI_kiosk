# MENU_DATA_SPEC — 메뉴 데이터 생성 명세 (Codex 전용)

> 음성 적응형 키오스크(OBA, GGUI 트랙) — **메뉴에 들어가는 데이터**를 별도로 생성하기 위한 자립형 스펙.
> 이 문서는 **Codex 세션에 그대로 붙여넣어** 메뉴 데이터를 생성/갱신하는 데 쓴다.
> 다른 모듈(A/C/D)·계약은 이 데이터를 **소비**만 한다 → 이 파일을 계약대로만 만들면 전체가 맞물린다.

---

## 1. 소유권 / 범위
- **소유: Codex** (이 데이터의 생성·갱신 전담).
- **module-b 서버(server.js)는 이 데이터를 "서빙"만** 한다 — 로직·엔드포인트는 건드리지 않는다.
- 범위 = ① 메뉴 데이터 JSON, ② 각 메뉴 항목의 사진(SVG placeholder).

## 2. 산출물 (정확한 경로)
| 산출물 | 경로 | 비고 |
|--------|------|------|
| 메뉴 데이터 | `module-b/data/menu.seed.json` | 단일 JSON. 아래 스키마 준수 |
| 메뉴 사진 | `module-b/public/img/menu/<id>.svg` | 항목당 1장. `image_url` 가 가리키는 경로와 일치 |

> `module-b/server.js` 는 `data/menu.seed.json` 을 in-memory 로드하고 `/img` 를 `public/img` 로 정적 서빙한다. **이 두 위치/이름을 바꾸지 말 것.**

## 3. 스키마 (정본 — `contracts/types.ts`. 절대 변경 금지)
```ts
interface MenuOptionChoice { label: string; price_delta: number; }   // price_delta: 원 단위 정수, 가산액(0 가능)
interface MenuOption       { type: string; choices: MenuOptionChoice[]; }
interface MenuItem {
  id: string;          // kebab-case 고유. 예: "caffe-latte-003"
  name: string;        // 영문 표기. 예: "Caffe Latte"
  category: string;    // 영문. categories 배열의 값 중 하나
  price: number;       // 기본가, 원 단위 정수. 예: 4500
  image_url: string;   // "/img/menu/<id>.svg" (위 사진 경로와 정확히 일치)
  desc: string;        // 영문 한 줄 설명
  options: MenuOption[];
}
interface Menu {
  restaurant: string;       // 영문 카페명. 예: "OBA Cafe"
  categories: string[];     // 영문 카테고리 목록
  items: MenuItem[];
}
```

### 예시 항목 (이 형태를 그대로)
```json
{
  "id": "caffe-latte-003",
  "name": "Caffe Latte",
  "category": "Coffee",
  "price": 4500,
  "image_url": "/img/menu/caffe-latte-003.svg",
  "desc": "Smooth espresso with steamed milk",
  "options": [
    { "type": "Temperature", "choices": [ {"label":"Hot","price_delta":0}, {"label":"Iced","price_delta":0} ] },
    { "type": "Size",        "choices": [ {"label":"Regular","price_delta":0}, {"label":"Large","price_delta":500} ] }
  ]
}
```

## 4. 콘텐츠 요구사항
- **언어: 영어**(데모가 영어). name/category/desc 모두 영문. (한국어 금지)
- **카페 컨셉**, `restaurant` = 영문 카페명.
- **항목 수: 약 48개.** 카테고리: `Coffee`, `Latte`, `Tea`, `Ade`, `Beverage`, `Dessert`.
- ★★ **Latte 변형 ≥ 5종** — *모호 발화→추천 카드* 데모의 핵심. 예: Caffe Latte, Vanilla Latte, Caramel Latte, Hazelnut Latte, Matcha Latte, Mocha Latte, Sweet Potato Latte 등. (사용자가 "a latte" 라고만 말하면 후보가 여러 개 떠야 함.)
- **옵션**: 음료류는 최소 `Temperature`(Hot/Iced). 사이즈가 의미 있으면 `Size`(Regular/Large, +500). 디저트 등 옵션 불필요하면 `"options": []`.
- **가격: 원 단위 정수**(예 3500~6500). `price_delta` 도 정수.
- **id: kebab-case 고유**, 끝에 일련번호 권장(예 `vanilla-latte-004`). `image_url` 의 파일명과 동일한 id.
- **desc: 영문 한 줄**(간결, 메뉴판 톤).

## 5. 사진(SVG placeholder) 요구사항
- 항목당 `module-b/public/img/menu/<id>.svg` 1장. **외부 이미지 API 호출 금지(오프라인 동작).**
- 단순 placeholder면 충분: 배경 + 항목명 텍스트(영문) + (선택)카테고리 색상. 노인 친화 데모라 **대비 높게, 큰 텍스트**.
- 모든 `items[].image_url` 가 실제 존재하는 svg 를 가리켜야 한다(깨진 링크 0).

## 6. 검증 기준 (생성 후 반드시 확인)
- `python3 -c "import json,sys; d=json.load(open('module-b/data/menu.seed.json')); assert d['items']"` — JSON 유효.
- 모든 item 이 §3 `MenuItem` 형태(필드명·타입) 준수. id 전부 고유.
- `items` 길이 ≈ 48. **`name`/`desc`/`category` 에 'latte'(대소문자 무시) 포함 항목 ≥ 5 (현재 10개).**
- 모든 `image_url` 에 대응하는 `module-b/public/img/menu/<id>.svg` 파일 존재.
- `node --check module-b/server.js` 통과, (서버 가능 시) `GET /menu`·`GET /menu/search?q=latte`(후보 다수) 정상.

## 7. 변경 금지 (절대)
- `contracts/types.ts` (계약 정본).
- `module-b/server.js` 의 로직/엔드포인트(데이터만 교체).
- 다른 모듈(A/C/D), `contracts/mocks.*` 의 비-메뉴 부분.
- 단, `contracts/mocks.json` 의 메뉴 item id 예시는 **이 데이터의 실제 id 와 맞춰도 됨**(데모 일관성 ↑, 선택).

---

## 8. Codex 작업 지시 (paste-ready)
> module-b 의 메뉴 데이터를 위 명세대로 생성하라.
> 1) `module-b/data/menu.seed.json` — 영어 카페, 약 48개 항목, **latte 변형 ≥5종**, 카테고리 다양, 각 항목 `contracts/types.ts` 의 `MenuItem` 형태(id·name·category·price[원 정수]·image_url=`/img/menu/<id>.svg`·desc[영문]·options) 준수. 음료는 Temperature(Hot/Iced) 옵션, 사이즈 있으면 Size(Regular/Large +500).
> 2) `module-b/public/img/menu/<id>.svg` — 항목당 1장, 항목명 텍스트가 들어간 단순 SVG placeholder(외부 호출 금지, 대비 높게).
> 3) 검증: JSON 유효 + 전 항목 계약 준수 + id 고유 + image 파일 존재 + 'latte' 검색 ≥5 + `node --check module-b/server.js`.
> 4) 금지: contracts/types.ts·server.js 로직 변경.
> 끝나면 항목 수·latte 개수·생성 svg 수·검증 결과를 보고.
