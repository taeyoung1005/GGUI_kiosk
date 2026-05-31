# Giosk 대화형 음성 에이전트 — 구현 계획

> **For agentic workers (Codex/Claude 등):** 이 계획은 다른 세션이 **이 대화 맥락 없이** 그대로 구현하도록 자립적으로 작성됨. Steps 는 checkbox(`- [ ]`)로 추적. TDD 가능한 부분은 테스트 먼저, 라이브(마이크 필요) 부분은 수동 검증 절차를 따른다. 작은 단위로 커밋(메시지 끝에 `Co-Authored-By: ...` 규칙은 레포 관례 따름).

**Goal:** 지금의 "버튼 누름 → 한 발화 STT → 고정 안내멘트 → 다음 화면" 키오스크를, **OpenAI Realtime 으로 손님과 계속 대화하며(듣고+말하고) function calling 으로 주문을 운전하는 음성 비서**로 바꾼다.

**Architecture:** 주문 동안 **Realtime WebRTC 세션 하나를 계속 열어둔다.** 모델은 (a) 마이크를 server VAD 로 계속 듣고, (b) 자기 목소리로 응대하며(WebRTC 오디오 트랙 재생), (c) **도구(function calling)**를 호출해 주문 상태를 바꾼다. 도구 핸들러는 기존 `Orchestrator` 메서드(`selectMenu`/`setOption`/…)를 그대로 호출하므로 **화면(AdaptiveKiosk 내장 적응 렌더러)과 주문 상태기계는 재사용**된다. 고정 `/tts` 안내는 제거(모델이 직접 말함).

**Tech Stack:** OpenAI Realtime API(WebRTC, function calling, audio output) · React/Vite(module-d) · FastAPI(module-a, ephemeral 토큰 발급) · Express(module-b 메뉴/주문). 기존 GGUI/module-c 는 이 계획에서 손대지 않음.

---

## 0. 먼저 읽기 — 이번 세션이 라이브로 검증해서 알아낸 Realtime 사실 (실수 방지용)

이 값들은 추측이 아니라 **실제 호출로 확인됨**. 그대로 쓸 것.

1. **WebRTC SDP 핸드셰이크 엔드포인트 = `POST https://api.openai.com/v1/realtime/calls?model=<model>`** (`Authorization: Bearer <ephemeral>`, `Content-Type: application/sdp`, body=offer SDP → **201** + answer SDP).
   - ❌ 구 베타 `POST /v1/realtime?model=` 은 **400 "The Realtime Beta API is no longer supported"** 로 폐기됨. 절대 쓰지 말 것.
   - 현재 `module-d/src/audio/realtime.ts` 의 `exchangeSdp` 가 이미 `/calls` 로 고쳐져 있음(참고 구현).
2. **Ephemeral 토큰** = `module-a` 의 `POST /realtime/session` 이 `client.realtime.client_secrets.create(expires_after={...}, session={...})` 로 발급. 표준 `OPENAI_API_KEY` 는 백엔드에만 둔다(브라우저로 절대 안 보냄).
3. **모델명 = `gpt-realtime`** (env `OPENAI_REALTIME_MODEL`). openai-python **2.x** 필요(설치본 2.38).
4. **입력 transcription 은 model 필수**: `audio.input.transcription = {model: "gpt-4o-transcribe", language: "ko"}` (없으면 400 "Missing required parameter ...transcription.model").
5. **server VAD**: `audio.input.turn_detection = {type:"server_vad", silence_duration_ms:2000, threshold:0.5, prefix_padding_ms:300}` — 손님 말이 끝나면 자동으로 턴 종료.
6. **출력 오디오(브라우저 WebRTC)**: 모델 목소리는 **RTP 오디오 트랙**으로 온다(데이터채널의 `response.output_audio.delta` 가 아님 — 그건 websocket 전송용). 브라우저에선 **`pc.ontrack` 으로 받은 스트림을 `<audio autoplay>` 에 붙이면 자동 재생**된다. 세션에 `output_modalities` 에 `"audio"` 포함 + `audio.output.voice` 설정 필요.
7. **이벤트는 데이터채널(`oai-events`)로 JSON** 으로 온다. 핵심 이벤트:
   - 손님 발화 확정: `conversation.item.input_audio_transcription.completed` (`.transcript`)
   - 비서 발화 자막: `response.output_audio_transcript.delta` / `...done`
   - **function call 확정: `response.function_call_arguments.done`** (`.call_id`, `.name`, `.arguments`(JSON 문자열)) — 또는 `response.output_item.done` 의 `item.type==="function_call"`.
   - 응답 종료: `response.done`
   - 오류: `error` (`.error.message`)
8. **세션 설정은 connect 후 데이터채널로 `session.update` 가능** — tools/instructions/voice/modalities 를 붙일 수 있다(메뉴를 프론트가 갖고 있으니 프론트에서 주입).
9. **function calling 회신 패턴**: 도구 실행 후 데이터채널로
   `{type:"conversation.item.create", item:{type:"function_call_output", call_id, output: JSON.stringify(result)}}`
   를 보낸 뒤 `{type:"response.create"}` 를 보내 모델이 이어서 말하게 한다.

> 빠른 PoC 로 6·7 확인됨(서버사이드 websocket 으로 한국어 음성 합성 성공). 브라우저 WebRTC 의 오디오 트랙 재생·function calling 은 이 계획에서 라이브 검증한다.

---

## 1. 현재 구조 (바꾸기 전 — 재사용할 것)

- `module-d/src/flow/orchestrator.ts` — `Orchestrator` 상태기계. **재사용**할 public 메서드(도구가 호출):
  - `selectMenu(item: MenuItem)` — 메뉴 선택 → options/fulfillment 로. (옵션 없으면 fulfillment 로 점프)
  - `setOption(type: string, label: string): void`
  - `confirmOptions()` — 옵션 확정 → fulfillment 로.
  - `setFulfillment(value: "Dine In"|"Take Out")`
  - `setLoyalty(value: "scan"|"phone"|"none")`
  - `setPaymentMethod(value: PaymentMethod)`
  - `placeOrder()` — module-b `/orders` 모의결제 → done.
  - `backToRecommendations()`, `reset(toIdle?)`, `cancel()`
  - 내부: `announce(text)` 는 `speak(text)`(고정 TTS) 호출 — **대화형에선 무음 처리**.
  - 상태: `FlowState { phase, step, candidates, selectedItem, selectedOptions, orderState, order, ... }`. 가드 주의: `selectMenu` 등은 `this.state.analyze` 가 있어야 동작.
- `module-d/src/audio/realtime.ts` — `RealtimeVoiceSession`(턴당 STT). **참고 구현**(WebRTC 셋업·SDP 교환). 대화형은 새 클래스로.
- `module-d/src/api/client.ts` — `createRealtimeSession()`(→ `/realtime/session`), `getMenu()`, `createOrder()`. `apiConfig.ANALYZE_URL`/`USE_MOCK`.
- `module-d/src/ui/AdaptiveKiosk.tsx` — `state.phase`/`state.step` 기반 내장 적응 렌더러. **그대로 화면으로 사용**(터치도 가능, 음성과 병행).
- `module-d/src/App.tsx` — `StaticKiosk`(idle) ↔ `AdaptiveKiosk`(voice). `startVoice()` 가 `flow.startVoiceOrder()` 호출.
- `module-a/app.py` — `/realtime/session`(ephemeral), `/tts`(이번에 추가됨; 대화형에선 제거 예정), `/health`.
- `contracts/types.ts` — `MenuItem {id,name,category,price,image_url,desc,options:[{type,choices:[{label,price_delta}]}]}`, `AdaptiveOrderState`, `PaymentMethod`, `OrderLine {item_id,options,qty}`, `OrderResponse {order_id,total,status}`.

---

## 2. 목표 인터랙션 (무엇을 만드는가)

```
[대화 시작] 누름(또는 화면 진입 시 자동) → Realtime 세션 1개 open + 모델이 먼저 인사
 비서🔊 "안녕하세요, 무엇을 도와드릴까요?"
 손님   "따뜻한 라떼 한 잔 주세요"
 비서🔊 "네, 따뜻한 카페라떼요. 사이즈는 기본, 크게 중에 어떻게 드릴까요?"   ← select_item 호출(화면=옵션)
 손님   "크게요"
 비서🔊 "크게로 5,000원입니다. 매장에서 드시나요, 포장이세요?"               ← set_option 호출
 …(set_fulfillment → set_loyalty → set_payment)…
 비서🔊 "카페라떼 라지, 포장, 카드결제, 5,000원 맞으실까요?"
 손님   "네"
 비서🔊 "결제 완료됐습니다. 주문번호 1003번이에요. 감사합니다!"               ← confirm_order 호출(화면=완료)
```
- 누를 필요 없이 **계속 듣고**, 화면은 비서의 도구호출에 따라 **자동 전환**. 손님은 **터치로도** 진행 가능(기존 버튼 유지).

---

## 3. File Structure (생성/수정)

- **Create** `module-d/src/audio/realtimeAgent.ts` — 대화형 세션 클래스 `RealtimeAgent`(persistent WebRTC + audio out + data channel + function-call 디스패치).
- **Create** `module-d/src/flow/agentTools.ts` — 도구 정의(JSON schema) + `dispatchToolCall()`(도구→Orchestrator 매핑) + `buildAgentInstructions(menu)`(역할+슬림메뉴) + `slimMenu(menu)`.
- **Create** `module-d/src/flow/agentTools.test.ts` — 도구 스키마/디스패치/슬림메뉴 유닛테스트.
- **Modify** `module-a/app.py` — `/realtime/session` 세션 config 에 출력 오디오/voice 추가. `/tts` 와 관련 env 제거.
- **Modify** `module-d/src/flow/orchestrator.ts` — 대화형 모드 플래그 + `startConversation()`/`endConversation()` + `announce` 무음화 + 도구가 부를 수 있게 상태 가드 완화.
- **Modify** `module-d/src/ui/AdaptiveKiosk.tsx` — 대화형 캡션(손님/비서 자막) + 듣는 중 표시. 단계별 "다시 말하기" 버튼은 대화형에선 숨김(계속 듣는 중).
- **Modify** `module-d/src/App.tsx` — idle 진입 버튼이 `startConversation()` 호출, "대화 종료" 노출.
- **Modify** `module-d/src/audio/tts.ts` — 대화형에선 안내 TTS 호출 안 함(모델이 말함). (파일 유지하되 호출부 정리)
- **Modify** `module-d/.env.example` / `.env.example` — 대화형 토글 `VITE_CONVERSATIONAL=true` 문서화.

---

## 4. Tasks

### Task 1: 백엔드 — `/realtime/session` 에 출력 오디오/voice 추가

**Files:** Modify `module-a/app.py` (함수 `realtime_session`, env)

- [ ] **Step 1: env 에 voice 추가**

`module-a/app.py` 의 env 블록(`OPENAI_REALTIME_SILENCE_MS` 정의 근처)에 추가:

```python
OPENAI_REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "alloy")
```

- [ ] **Step 2: 세션 config 에 출력 오디오 추가**

`realtime_session()` 안 `session_config` 의 `"audio"` 를 아래로 교체(입력은 그대로, 출력 추가 + `output_modalities`):

```python
    session_config = {
        "type": "realtime",
        "model": OPENAI_REALTIME_MODEL,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "transcription": {
                    "model": OPENAI_REALTIME_TRANSCRIBE_MODEL,
                    "language": OPENAI_REALTIME_LANGUAGE,
                },
                "turn_detection": {
                    "type": "server_vad",
                    "silence_duration_ms": OPENAI_REALTIME_SILENCE_MS,
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                },
            },
            "output": {"voice": OPENAI_REALTIME_VOICE},
        },
    }
```

- [ ] **Step 3: `/tts` 와 ElevenLabs/OpenAI-TTS env 제거**

대화형에선 모델이 직접 말하므로 `/tts` 엔드포인트, `_realtime_tts_wav()` 헬퍼, `OPENAI_TTS_VOICE`/`OPENAI_TTS_INSTRUCTIONS` env, `Response` import(다른 곳에서 안 쓰면)를 제거. `/health` 에서 `tts_ready` 줄 제거.

- [ ] **Step 4: 검증 + 커밋**

Run: `cd module-a && .venv/bin/python -m py_compile app.py` → 통과.
Run(서버 띄운 상태): `curl -s -XPOST localhost:8000/realtime/session -H 'content-type: application/json' -d '{}'` → 200 + `client_secret`(`ek_...`) 발급되면 OK(세션 config 가 수락됨).
```bash
git add module-a/app.py && git commit -m "[feat] realtime 세션에 출력 오디오/voice 추가 + 고정 /tts 제거"
```

---

### Task 2: 도구 정의·디스패치·슬림메뉴 (유닛테스트 먼저)

**Files:** Create `module-d/src/flow/agentTools.ts`, Test `module-d/src/flow/agentTools.test.ts`

도구는 **메뉴/enum 에 grounded** 되어야 한다(모델이 잘못된 값 못 넣게). 디스패치는 도구이름→`Orchestrator` 메서드.

- [ ] **Step 1: 실패하는 테스트 작성** (`agentTools.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import type { Menu, MenuItem } from "@contracts/types";
import { AGENT_TOOLS, slimMenu, buildAgentInstructions } from "./agentTools";

const sampleItem: MenuItem = {
  id: "caffe-latte-003", name: "카페라떼", category: "라떼", price: 4500,
  image_url: "", desc: "기본 라떼",
  options: [{ type: "온도", choices: [{ label: "뜨겁게", price_delta: 0 }, { label: "차갑게", price_delta: 0 }] }],
};
const menu: Menu = { restaurant: "OBA 카페", categories: ["라떼"], items: [sampleItem] };

describe("agentTools", () => {
  it("도구 목록에 핵심 도구가 다 있다", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    for (const n of ["select_item", "set_option", "set_fulfillment", "set_loyalty", "set_payment", "confirm_order", "cancel_order"]) {
      expect(names).toContain(n);
    }
  });
  it("모든 도구가 function 타입 + name + parameters(JSON schema) 를 갖는다", () => {
    for (const t of AGENT_TOOLS) {
      expect(t.type).toBe("function");
      expect(typeof t.name).toBe("string");
      expect(t.parameters).toBeTruthy();
      expect(t.parameters.type).toBe("object");
    }
  });
  it("slimMenu 는 item_id/이름/가격/옵션타입만 남긴다", () => {
    const s = slimMenu(menu);
    expect(s[0]).toEqual({ id: "caffe-latte-003", name: "카페라떼", category: "라떼", price: 4500, option_types: ["온도"] });
  });
  it("buildAgentInstructions 는 역할 + 슬림메뉴 JSON 을 포함한다", () => {
    const ins = buildAgentInstructions(menu);
    expect(ins).toContain("카페라떼");
    expect(ins).toContain("caffe-latte-003");
    expect(ins.toLowerCase()).toContain("select_item");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `npm --prefix module-d run test -- agentTools` (vitest 가 없으면 module-c 처럼 `node --test` 패턴을 따르되, module-d 는 vite 라 vitest 권장; 없으면 `npm --prefix module-d i -D vitest` 후 `"test": "vitest run"` 추가)
Expected: FAIL("AGENT_TOOLS not defined" 등)

- [ ] **Step 3: `agentTools.ts` 구현**

```ts
// module-d/src/flow/agentTools.ts
import type { Menu, MenuItem } from "@contracts/types";

export interface AgentTool {
  type: "function";
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export const FULFILLMENT_VALUES = ["Dine In", "Take Out"] as const;
export const LOYALTY_VALUES = ["scan", "phone", "none"] as const;
export const PAYMENT_VALUES = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"] as const;

export const AGENT_TOOLS: AgentTool[] = [
  {
    type: "function", name: "select_item",
    description: "손님이 고른 메뉴를 선택한다. 메뉴의 정확한 item_id 만 사용. 호출 후 그 메뉴의 옵션 정보를 돌려준다.",
    parameters: { type: "object", additionalProperties: false, required: ["item_id"], properties: { item_id: { type: "string", description: "메뉴 데이터의 정확한 id" } } },
  },
  {
    type: "function", name: "set_option",
    description: "선택한 메뉴의 옵션 하나를 설정한다(예: 온도=뜨겁게). 메뉴에 존재하는 옵션 type/label 만.",
    parameters: { type: "object", additionalProperties: false, required: ["option_type", "choice_label"], properties: { option_type: { type: "string" }, choice_label: { type: "string" } } },
  },
  {
    type: "function", name: "set_fulfillment",
    description: "매장/포장을 설정한다.",
    parameters: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string", enum: [...FULFILLMENT_VALUES] } } },
  },
  {
    type: "function", name: "set_loyalty",
    description: "쿠폰(scan)/포인트(phone)/건너뛰기(none) 를 설정한다.",
    parameters: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string", enum: [...LOYALTY_VALUES] } } },
  },
  {
    type: "function", name: "set_payment",
    description: "결제수단을 설정한다.",
    parameters: { type: "object", additionalProperties: false, required: ["value"], properties: { value: { type: "string", enum: [...PAYMENT_VALUES] } } },
  },
  {
    type: "function", name: "confirm_order",
    description: "손님이 최종 동의하면 결제를 확정한다. 주문번호/합계를 돌려준다.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    type: "function", name: "cancel_order",
    description: "주문을 처음으로 되돌린다.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
  },
];

export interface SlimMenuItem { id: string; name: string; category: string; price: number; option_types: string[]; }

export function slimMenu(menu: Menu): SlimMenuItem[] {
  return menu.items.map((it: MenuItem) => ({
    id: it.id, name: it.name, category: it.category, price: it.price,
    option_types: (it.options ?? []).map((o) => o.type),
  }));
}

export function buildAgentInstructions(menu: Menu): string {
  return [
    "너는 'OBA 카페'의 친절한 음성 주문 도우미야. 손님과 한국어로 자연스럽고 짧게 대화하며 주문을 받아.",
    "원칙:",
    "- 아래 [메뉴]에 있는 항목만 추천/선택한다. 없는 메뉴는 정중히 안내하고 비슷한 걸 권한다.",
    "- 한 번에 하나만 물어본다: 메뉴 → (옵션 있으면)옵션 → 매장/포장 → 적립 → 결제수단 → 최종확인.",
    "- 각 결정은 반드시 해당 도구를 호출해서 반영한다(말만 하지 말 것).",
    "- 손님이 메뉴를 말하면 select_item 을 호출하고, 돌려받은 옵션을 보고 다음 옵션을 물어본다.",
    "- 옵션이 없으면 바로 매장/포장을 물어본다. 적립은 '안 하셔도 된다'고 가볍게 권하고 none 도 가능.",
    "- 최종확인에서 손님이 동의하면 confirm_order 를 호출하고 주문번호/합계를 안내한다.",
    "- 가격/합계는 도구가 돌려주는 값을 그대로 말한다(임의로 계산하지 말 것).",
    "- 처음엔 짧게 인사하고 무엇을 드릴지 물어본다.",
    "",
    "[메뉴] (JSON, 이 id 들만 사용):",
    JSON.stringify(slimMenu(menu)),
  ].join("\n");
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm --prefix module-d run test -- agentTools`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add module-d/src/flow/agentTools.ts module-d/src/flow/agentTools.test.ts module-d/package.json
git commit -m "[feat] 대화형 에이전트 도구 정의 + 슬림메뉴/지시문 (유닛테스트)"
```

---

### Task 3: Orchestrator 도구 디스패치 + 대화형 모드

**Files:** Modify `module-d/src/flow/orchestrator.ts`

`Orchestrator` 에 (1) 대화형 플래그, (2) 도구 디스패처(도구이름+인자 → 메서드 호출 → 결과 반환), (3) 시작/종료를 추가. 기존 메서드 재사용.

- [ ] **Step 1: 대화형 상태 + announce 무음화**

`Orchestrator` 클래스 상단 필드에 `private conversational = false;` 추가. `private announce(text: string)` 를 아래로:

```ts
  private announce(text: string) {
    if (this.conversational) return; // 대화형: 모델이 직접 말하므로 고정 TTS 무음
    speak(text);
  }
```

- [ ] **Step 2: 대화형 시작/종료 메서드 추가**

`startVoiceOrder()` 근처에 추가:

```ts
  /** 대화형 음성 주문 시작: 메뉴를 로드하고 recommend 화면으로 진입(에이전트가 대화를 운전). */
  async startConversation(): Promise<MenuItem[]> {
    this.conversational = true;
    cancelSpeech();
    this.reset(false);
    if (!this.menu) this.menu = await getMenu();
    // 도구 가드 통과용 합성 analyze + 메뉴 카탈로그를 후보로
    const result = { transcript: "", language: "ko", duration_ms: 0 };
    const candidates = this.menu.items.slice(0, 8);
    this.set({ analyze: result, candidates, phase: "adaptive", step: "recommend", message: "무엇을 도와드릴까요?" });
    return this.menu.items;
  }

  endConversation(): void {
    this.conversational = false;
    this.reset(true);
  }
```

- [ ] **Step 3: 도구 디스패처 추가**

`Orchestrator` 에 추가(도구 결과는 모델에게 돌려줄 JSON):

```ts
  /** 에이전트 function call 을 실제 주문 동작으로 실행하고 결과를 돌려준다. */
  async runAgentTool(name: string, args: Record<string, any>): Promise<Record<string, any>> {
    if (!this.menu) this.menu = await getMenu();
    const byId = new Map(this.menu.items.map((i) => [i.id, i]));
    switch (name) {
      case "select_item": {
        const item = byId.get(String(args.item_id));
        if (!item) return { ok: false, error: "해당 item_id 없음", valid_ids: [...byId.keys()].slice(0, 20) };
        await this.selectMenu(item);
        return {
          ok: true, name: item.name, price: item.price,
          options: item.options.map((o) => ({ type: o.type, choices: o.choices.map((c) => ({ label: c.label, price_delta: c.price_delta })) })),
          has_options: item.options.length > 0,
        };
      }
      case "set_option": {
        const item = this.state.selectedItem;
        if (!item) return { ok: false, error: "먼저 select_item 필요" };
        const opt = item.options.find((o) => o.type === String(args.option_type));
        const choice = opt?.choices.find((c) => c.label === String(args.choice_label));
        if (!opt || !choice) return { ok: false, error: "옵션 type/label 불일치", available: item.options.map((o) => ({ type: o.type, choices: o.choices.map((c) => c.label) })) };
        this.setOption(opt.type, choice.label);
        return { ok: true, selected_options: this.state.selectedOptions, total: this.state.orderState.total };
      }
      case "set_fulfillment": {
        const v = args.value === "Dine In" ? "Dine In" : "Take Out";
        await this.setFulfillment(v);
        return { ok: true, fulfillment: v, total: this.state.orderState.total };
      }
      case "set_loyalty": {
        const v = (["scan", "phone", "none"].includes(args.value) ? args.value : "none") as "scan" | "phone" | "none";
        await this.setLoyalty(v);
        return { ok: true, loyalty: v };
      }
      case "set_payment": {
        await this.setPaymentMethod(args.value);
        return { ok: true, payment_method: args.value, total: this.state.orderState.total };
      }
      case "confirm_order": {
        await this.placeOrder();
        return { ok: true, order_id: this.state.order?.order_id ?? null, total: this.state.order?.total ?? this.state.orderState.total, status: this.state.order?.status ?? "paid" };
      }
      case "cancel_order": {
        this.reset(true);
        return { ok: true };
      }
      default:
        return { ok: false, error: `알 수 없는 도구: ${name}` };
    }
  }
```

> 주의: `setPaymentMethod` 의 인자 유니온 타입 때문에 `args.value` 를 `as PaymentMethod` 캐스팅 필요할 수 있음(import `PaymentMethod`). `placeOrder` 후 `this.state.order` 가 채워짐.

- [ ] **Step 4: 타입체크 + 커밋**

Run: `npm --prefix module-d run typecheck` → 통과(필요시 `PaymentMethod` import, `as` 캐스팅 추가).
```bash
git add module-d/src/flow/orchestrator.ts
git commit -m "[feat] Orchestrator 대화형 모드 + 도구 디스패처(runAgentTool)"
```

---

### Task 4: `RealtimeAgent` — persistent WebRTC 세션 + 오디오 출력 + function call

**Files:** Create `module-d/src/audio/realtimeAgent.ts`

`module-d/src/audio/realtime.ts` 의 WebRTC/SDP 셋업을 참고하되, **세션을 계속 열어두고** 오디오 출력을 재생하고 function call 을 디스패치한다.

- [ ] **Step 1: 클래스 작성**

```ts
// module-d/src/audio/realtimeAgent.ts
import { createRealtimeSession } from "../api/client";
import { AGENT_TOOLS, buildAgentInstructions } from "../flow/agentTools";
import type { Menu } from "@contracts/types";

const OPENAI_REALTIME_BASE = "https://api.openai.com/v1/realtime";

export interface AgentCallbacks {
  /** 도구 호출 실행 → 결과(JSON) 반환. (Orchestrator.runAgentTool 연결) */
  onToolCall: (name: string, args: Record<string, any>) => Promise<Record<string, any>>;
  onUserTranscript?: (text: string) => void;   // 손님 발화 확정
  onAssistantText?: (textDelta: string, done: boolean) => void; // 비서 자막
  onOpen?: () => void;
  onError?: (message: string) => void;
}

export class RealtimeAgent {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  private cbs: AgentCallbacks;
  private menu: Menu;
  private assistantBuf = "";

  constructor(menu: Menu, cbs: AgentCallbacks) { this.menu = menu; this.cbs = cbs; }

  async start(): Promise<void> {
    try {
      const session = await createRealtimeSession(); // { client_secret, model }
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (this.closed) { this.teardown(); return; }

      const pc = new RTCPeerConnection();
      this.pc = pc;
      for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);

      // 비서 목소리(원격 오디오 트랙) 재생
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      pc.ontrack = (e) => { if (this.audioEl) this.audioEl.srcObject = e.streams[0]; };

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.addEventListener("open", () => { this.configureSession(); this.cbs.onOpen?.(); });
      dc.addEventListener("message", (ev) => this.handleEvent(ev.data));

      pc.addEventListener("connectionstatechange", () => {
        if (this.closed) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.cbs.onError?.("음성 연결이 끊어졌어요. 다시 시도해 주세요.");
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const answer = await this.exchangeSdp(session.client_secret, session.model, offer.sdp ?? "");
      if (this.closed) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (err: any) {
      this.cbs.onError?.(err?.message ? `대화를 시작하지 못했어요: ${err.message}` : "대화를 시작하지 못했어요.");
    }
  }

  /** connect 후: 도구/지시문(메뉴 주입)/오디오 출력 설정 + 첫 인사 요청. */
  private configureSession(): void {
    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions: buildAgentInstructions(this.menu),
        tools: AGENT_TOOLS,
        tool_choice: "auto",
      },
    });
    // 모델이 먼저 인사하도록 응답 요청
    this.send({ type: "response.create" });
  }

  close(): void {
    this.closed = true;
    try { this.dc?.close(); } catch {}
    try { this.pc?.close(); } catch {}
    this.teardown();
    this.dc = null; this.pc = null;
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.audioEl) { try { this.audioEl.srcObject = null; } catch {} this.audioEl = null; }
  }

  private send(obj: unknown): void { try { this.dc?.send(JSON.stringify(obj)); } catch {} }

  private async exchangeSdp(clientSecret: string, model: string, offerSdp: string): Promise<string> {
    const url = `${OPENAI_REALTIME_BASE}/calls?model=${encodeURIComponent(model)}`;
    const res = await fetch(url, { method: "POST", body: offerSdp, headers: { Authorization: `Bearer ${clientSecret}`, "Content-Type": "application/sdp" } });
    if (!res.ok) throw new Error(`Realtime 핸드셰이크 실패: ${res.status}`);
    return res.text();
  }

  private async handleEvent(raw: unknown): Promise<void> {
    if (this.closed || typeof raw !== "string") return;
    let evt: any; try { evt = JSON.parse(raw); } catch { return; }
    switch (evt.type) {
      case "conversation.item.input_audio_transcription.completed":
        this.cbs.onUserTranscript?.(String(evt.transcript ?? "").trim());
        break;
      case "response.output_audio_transcript.delta":
        this.assistantBuf += String(evt.delta ?? "");
        this.cbs.onAssistantText?.(this.assistantBuf, false);
        break;
      case "response.output_audio_transcript.done":
        this.cbs.onAssistantText?.(String(evt.transcript ?? this.assistantBuf), true);
        this.assistantBuf = "";
        break;
      case "response.function_call_arguments.done": {
        let args: Record<string, any> = {};
        try { args = JSON.parse(evt.arguments || "{}"); } catch {}
        let result: Record<string, any>;
        try { result = await this.cbs.onToolCall(String(evt.name), args); }
        catch (e: any) { result = { ok: false, error: e?.message ?? "tool error" }; }
        this.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: evt.call_id, output: JSON.stringify(result) } });
        this.send({ type: "response.create" }); // 모델이 결과 보고 이어서 말함
        break;
      }
      case "error":
        this.cbs.onError?.(evt?.error?.message ? `음성 오류: ${evt.error.message}` : "음성 처리 중 오류가 발생했어요.");
        break;
      default:
        break;
    }
  }
}

export function isRealtimeSupported(): boolean {
  return typeof window !== "undefined" && typeof RTCPeerConnection !== "undefined" && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
}
```

- [ ] **Step 2: 타입체크 + 커밋**

Run: `npm --prefix module-d run typecheck` → 통과.
```bash
git add module-d/src/audio/realtimeAgent.ts
git commit -m "[feat] RealtimeAgent: persistent 세션 + 오디오 출력 + function call 디스패치"
```

---

### Task 5: 오케스트레이션 연결 — 에이전트 ↔ Orchestrator ↔ UI

**Files:** Modify `module-d/src/flow/orchestrator.ts`(에이전트 보유), `module-d/src/App.tsx`, `module-d/src/ui/AdaptiveKiosk.tsx`

- [ ] **Step 1: Orchestrator 가 RealtimeAgent 를 보유/구동**

`orchestrator.ts` 에 필드 `private agent: RealtimeAgent | null = null;` + 캡션 상태(`userTranscript`, `assistantText`)를 `FlowState` 에 추가(옵션). `startConversation()` 끝에서 에이전트 생성:

```ts
    this.agent = new RealtimeAgent(this.menu, {
      onToolCall: (name, args) => this.runAgentTool(name, args),
      onUserTranscript: (t) => this.set({ userTranscript: t }),
      onAssistantText: (t, done) => this.set({ assistantText: t }),
      onOpen: () => this.set({ message: "말씀해 주세요. 듣고 있어요." }),
      onError: (m) => this.fail(m),
    });
    await this.agent.start();
```

`endConversation()`/`cancel()`/`reset(true)` 에서 `this.agent?.close(); this.agent = null;`. `FlowState` 에 `userTranscript?: string; assistantText?: string;` 추가하고 `initialFlowState()` 에 빈 문자열 기본값.

> import: `import { RealtimeAgent } from "../audio/realtimeAgent";`

- [ ] **Step 2: App.tsx — 진입/종료 버튼을 대화형으로**

`VITE_CONVERSATIONAL` 토글로 분기(기본 true). `startVoice()` 가 `flow.startConversation()` 호출(대화형), AdaptiveKiosk 화면에 "대화 종료" → `flow.endConversation()`.

```ts
const CONVERSATIONAL = import.meta.env.VITE_CONVERSATIONAL !== "false";
function startVoice() {
  if (state.phase === "adaptive" && !CONVERSATIONAL) { flow.respeak(); return; }
  if (CONVERSATIONAL) flow.startConversation(); else flow.startVoiceOrder();
}
```

- [ ] **Step 3: AdaptiveKiosk — 대화 캡션 + 듣는 중 표시, 단계 mic 숨김**

대화형일 때(상태에 `assistantText`/`userTranscript` 존재) 화면 상단/하단에 캡션 바를 띄우고, `MultiTurnBar` 의 "🎤 다시 말하기" 는 숨긴다(계속 듣는 중이라 불필요). 터치 버튼(메뉴/옵션 선택)은 유지 → 손님이 말 대신 눌러도 됨(그 경우 기존 메서드가 상태를 바꾸고, 다음 손님 발화를 모델이 받음). "대화 종료" 버튼 추가.

```tsx
// 예: adaptive 렌더 상단에 추가
{(state.assistantText || state.userTranscript) && (
  <div className="agent-captions">
    {state.userTranscript && <div className="cap-user">🗣️ {state.userTranscript}</div>}
    {state.assistantText && <div className="cap-assistant">🔊 {state.assistantText}</div>}
  </div>
)}
```

- [ ] **Step 4: 빌드/타입체크 + 커밋**

Run: `npm --prefix module-d run typecheck && npm --prefix module-d run build` → 통과.
```bash
git add module-d/src/flow/orchestrator.ts module-d/src/App.tsx module-d/src/ui/AdaptiveKiosk.tsx
git commit -m "[feat] 대화형 에이전트 연결(오케스트레이션 + 캡션 UI + 대화 종료)"
```

---

### Task 6: 라이브 골든 플로우 검증 (마이크 필요 — 사람이 직접)

**Files:** 코드 수정 없음(필요 시 디버깅)

- [ ] **Step 1: 기동**

`module-c/.env.local`(또는 루트 `.env`)에 `OPENAI_API_KEY` 있는 상태에서 `bash run.sh`. `module-d/.env.local` 에 `VITE_USE_MOCK=false`, `VITE_CONVERSATIONAL=true`. 브라우저 `http://localhost:5173`.

- [ ] **Step 2: 대화 골든 플로우**

[대화 시작] → 비서가 먼저 인사 → "따뜻한 라떼 주세요" → 비서가 사이즈 물음(화면=옵션) → "크게요" → 매장/포장 물음 → … → 최종확인 "네" → 결제완료 화면. 각 전환에서 **화면이 비서 말과 함께 바뀌는지** 확인.

- [ ] **Step 3: 디버깅 포인트 (막히면)**

- 비서 목소리 안 들림 → `pc.ontrack`/`<audio autoplay>` + 브라우저 오디오 자동재생 정책(사용자 제스처 후 시작이므로 보통 OK). `output_modalities:["audio"]` 확인.
- 도구 호출 안 됨 → 데이터채널에서 `response.function_call_arguments.done` 수신/`session.update` 의 `tools` 반영 확인(콘솔 로그). `tool_choice:"auto"`.
- 잘못된 item_id → `select_item` 결과의 `valid_ids` 로 모델이 교정하는지. 지시문에 "이 id 들만 사용" 강조.
- 화면 안 바뀜 → `runAgentTool` 이 `selectMenu`/`setOption` 등 호출 후 `state.phase/step` 갱신되는지(announce 무음이어도 `generateForStep` 은 돌아야 함).
- 연결 400/실패 → §0-1(엔드포인트 `/v1/realtime/calls`), §0-4(transcription.model) 재확인.

- [ ] **Step 4: 폴백 확인 + 커밋(수정 있었으면)**

마이크/연결 안 되면 `VITE_CONVERSATIONAL=false` 로 기존 단계형(터치+턴당 음성)으로 돌아가는지 확인(회귀 안전망 유지).

---

### Task 7: 정리 — 고정 TTS 경로 제거 + 문서

**Files:** Modify `module-d/src/audio/tts.ts`, `.env.example`, `module-d/.env.example`, `README.md`

- [ ] **Step 1: tts.ts 호출부 정리**

대화형이 기본이면 `announce` 가 무음이므로 `/tts` 는 호출되지 않음. `tts.ts` 의 OpenAI `/tts` 경로는 비대화형 폴백에서만 의미. `VITE_CONVERSATIONAL=true` 면 `speakWithOpenAITTS` 를 시도하지 않도록(이미 announce 무음이라 호출 자체가 없음) 확인만. 죽은 코드면 제거.

- [ ] **Step 2: .env.example 갱신**

`VITE_CONVERSATIONAL=true`(대화형) 추가. `OPENAI_REALTIME_VOICE=alloy` 추가. 제거된 `/tts` 관련(`OPENAI_TTS_VOICE`, `VITE_TTS_NARRATION`)은 삭제.

- [ ] **Step 3: README 한 줄 갱신**

"작동 방식"에 "손님과 대화하며 주문 받는 음성 비서(OpenAI Realtime, function calling)" 반영.

- [ ] **Step 4: 커밋**

```bash
git add -A && git commit -m "[chore] 대화형 전환 마무리: 고정 TTS 정리 + 토글/문서"
```

---

## 5. 완료 기준 (Definition of Done)

- [ ] 대화 시작 시 Realtime 세션 1개가 열리고 **비서가 먼저 한국어로 인사**(음성).
- [ ] 손님 발화 → 비서가 **음성으로 응대**하며 한 번에 하나씩 물어봄.
- [ ] 비서의 **도구 호출이 주문 상태/화면을 운전**(메뉴→옵션→매장/포장→적립→결제→확인 전환).
- [ ] 가격/합계는 도구 반환값과 일치(임의 계산 없음).
- [ ] `confirm_order` → module-b `/orders` 모의결제 → **결제완료 화면 + 주문번호**.
- [ ] 터치로도 각 단계 진행 가능(기존 버튼 유지).
- [ ] `VITE_CONVERSATIONAL=false` 로 기존 단계형 회귀 가능(안전망).
- [ ] `npm --prefix module-d run typecheck && build` 통과, `agentTools.test.ts` 통과.

## 6. 리스크 / 메모

- **지연/자연스러움**: Realtime 대화는 보통 빠르지만, 도구 호출 후 `response.create` 왕복이 한 박자 있을 수 있음. 지시문을 짧게/명확히.
- **모델이 도구 안 부르고 말로만 진행**: 지시문에 "각 결정은 반드시 도구 호출"을 강조 + `tool_choice:"auto"`. 그래도 새면 단계별로 `tool_choice` 강제 고려.
- **오디오 자동재생**: 첫 진입이 사용자 제스처(버튼) 뒤라 보통 허용. iOS 등은 추가 제스처 필요할 수 있음.
- **item_id 환각**: 슬림메뉴 주입 + `select_item` 결과의 `valid_ids` 로 자가교정 유도.
- **GGUI 화면**: 현재 기본은 내장 적응 렌더러(터치+표시). GGUI iframe 은 표시전용이라 대화형에서도 동일하게 내장 렌더러 사용 권장.
- **회귀 안전망**: 단계형(`RealtimeVoiceSession`)·`/tts` 코드를 토글 뒤에 남겨두면 마이크/연결 문제 시 폴백 가능.
