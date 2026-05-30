// src/ggui-client.js
//
// GGUI 경로(primary) 어댑터.
// GGUI MCP 서버(npx @ggui-ai/cli serve, 기본 6781)의 ggui_render 를 호출한다.
//
// GGUI 호출 흐름(packages/mcp-server-handlers 기준):
//   1) ggui_handshake({ intent, blueprintDraft: { contract } })  → { handshakeId }
//   2) ggui_render({ handshakeId, decision:{kind:"accept"}, props }) → { renderId, shortCode, resourceUri }
//   임베드 뷰어: {GGUI_URL}/r/<shortCode>
//
// prompt(자연어 규율) 은 handshake intent + blueprintDraft.variance.seedPrompt 로 실어
// "assist_level/age_group 별 UI 규율(큰 카드 2~3장 + 예/아니요 + 큰 글씨, 구조 고정·내용만 적응)"
// 을 생성 LLM(OpenAI BYOK) 에 전달한다.
//
// 의존: @modelcontextprotocol/sdk (MCP Streamable HTTP 클라이언트).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildDataContract } from "./contract.js";
import { resolveProfile, pickCandidates, stepCopy } from "./adapt.js";

/** assist_level/age_group/step → 생성 LLM 용 자연어 UI 규율 프롬프트. */
export function buildPrompt({ step, profile, transcript, candidates }) {
  const t = profile.tokens;
  const copy = stepCopy(step, profile, candidates);
  const lines = [
    "You build a voice-adaptive kiosk UI for people who struggle with kiosks (mainly seniors aged 50+). Write ALL UI text in ENGLISH.",
    `User utterance (STT): "${transcript ?? ""}"`,
    `Adaptation intensity assist_level=${profile.assist_level} (effective=${profile.effective_level}), age group=${profile.age_group}.`,
    "",
    "[FIXED STRUCTURE — never change]",
    step === "recommend"
      ? `- ${t.card_count} large menu cards in a grid. Each card: photo (placeholder ok) + name + price + a large "Order this" button.`
      : step === "options"
      ? "- Choose options (temperature/size) one item at a time with large buttons. Include a Back button."
      : "- Selection summary + only two large 'Yes/No' buttons.",
    "- Title/guidance text at the top. No clutter.",
    "",
    "[ADAPT CONTENT ONLY — intensity rules]",
    `- Base font ${t.base_font_px}px, title ${t.title_font_px}px+. Generous spacing (padding≈${t.card_pad_px}px, gap≈${t.gap_px}px).`,
    t.show_desc ? "- A one-line short description is allowed." : "- Drop descriptions; show name and price only (minimize cognitive load).",
    t.yesno_big ? "- Buttons at least half the screen width." : "- Buttons normal size, tidy.",
    t.voice_guide
      ? `- Show the voice guidance text on screen and pass it via the voiceGuide prop: "${copy.voice}"`
      : "- Keep voice guidance minimal (only if needed).",
    "- High color contrast, large touch targets, ENGLISH only.",
    "",
    `Title: ${copy.title} / Guidance: ${copy.subtitle}`,
    "Use the actionSpec button labels/actions as-is, and let the user advance to the next step with one big touch.",
  ];
  return lines.join("\n");
}

/** GGUI render props(단계별). DataContract.propsSpec 과 키가 일치해야 한다. */
function buildProps({ step, profile, candidates, item, selectedOptions, total }) {
  const copy = stepCopy(step, profile, candidates);
  const base = {
    title: copy.title,
    subtitle: copy.subtitle,
    assistLevel: profile.assist_level,
    ageGroup: profile.age_group,
    voiceGuide: profile.tokens.voice_guide ? copy.voice : "",
  };
  if (step === "options") {
    return { ...base, item: item ?? candidates[0], options: (item ?? candidates[0])?.options ?? [] };
  }
  if (step === "confirm") {
    return {
      ...base,
      item: item ?? candidates[0],
      selectedOptions: selectedOptions ?? {},
      total: total ?? (item ?? candidates[0])?.price ?? 0,
    };
  }
  return { ...base, items: candidates };
}

/**
 * GGUI MCP 서버를 통해 적응 UI 를 생성한다.
 * @returns {Promise<{render_id:string, embed_url:string, contract:any}>}
 * @throws GGUI 미가동/키 없음/응답 이상 시 → server.js 가 LOCAL 폴백으로 잡는다.
 */
export async function generateViaGgui(req, env) {
  const {
    transcript,
    age_group,
    assist_level,
    menu_context,
    step = "recommend",
    item,
    selectedOptions,
    total,
  } = req;

  const profile = resolveProfile({ assist_level, age_group });
  const candidates = pickCandidates(menu_context, transcript, profile.tokens.card_count);
  const contract = buildDataContract(step, { candidates, profile });
  const prompt = buildPrompt({ step, profile, transcript, candidates });
  const props = buildProps({ step, profile, candidates, item, selectedOptions, total });

  const gguiUrl = (env.GGUI_URL || "http://localhost:6781").replace(/\/$/, "");
  const bearer = env.GGUI_BEARER || "dev";

  const transport = new StreamableHTTPClientTransport(new URL(`${gguiUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client(
    { name: "voice-adaptive-kiosk-module-c", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    // 0) new session — 실서버는 chat당 sessionId 를 먼저 요구한다(ggui_new_session).
    //    그 sessionId 를 handshake 에 전달해야 함(미전달 시 -32602 검증 거부 → LOCAL 폴백).
    const sessionRes = await client.callTool({ name: "ggui_new_session", arguments: {} });
    const sessionId = pickFromResult(sessionRes, ["sessionId", "session_id"]);
    if (!sessionId) {
      throw new Error("ggui_new_session: sessionId 없음 (응답: " + safe(sessionRes) + ")");
    }

    // GGUI 계약 불변식: actionSpec[*].nextStep 은 agentCapabilities.tools 에 선언된 것만 허용.
    // 멀티턴은 module-d 가 /generate-ui 재호출로 처리하므로 GGUI 전송 시 nextStep 제거(검증 통과).
    const gguiActionSpec = {};
    for (const [k, v] of Object.entries(contract.actionSpec || {})) {
      const { nextStep, ...rest } = v;
      gguiActionSpec[k] = rest;
    }

    // 1) handshake — sessionId + intent + blueprintDraft(contract) + seedPrompt(prompt).
    const handshakeRes = await client.callTool({
      name: "ggui_handshake",
      arguments: {
        sessionId,
        intent: contract.intent,
        blueprintDraft: {
          contract: { propsSpec: contract.propsSpec, actionSpec: gguiActionSpec },
          variance: { persona: `kiosk-50plus-L${profile.assist_level}`, seedPrompt: prompt },
          // generator 는 생략 → 서버 기본 생성기 사용. (provider:model 문자열은 등록된 generator id가 아님)
        },
      },
    });
    const handshakeId = pickFromResult(handshakeRes, ["handshakeId", "handshake_id"]);
    if (!handshakeId) {
      throw new Error("ggui_handshake: handshakeId 없음 (응답: " + safe(handshakeRes) + ")");
    }

    // 2) push — accept + props. (실서버 툴은 ggui_render 가 아니라 ggui_push)
    const pushRes = await client.callTool({
      name: "ggui_push",
      arguments: { handshakeId, decision: { kind: "accept" }, props },
    });
    // 실서버 출력: { stackItemId, url, ... } → embed_url = url, render_id = stackItemId
    const url = pickFromResult(pushRes, ["url", "embedUrl", "embed_url"]);
    const stackItemId = pickFromResult(pushRes, ["stackItemId", "stack_item_id", "renderId"]);

    if (!url && !stackItemId) {
      throw new Error("ggui_push: url/stackItemId 없음 (응답: " + safe(pushRes) + ")");
    }

    const embed_url = url ? url : `${gguiUrl}/r/${stackItemId}`;

    return {
      render_id: String(stackItemId ?? `r-${Date.now()}`),
      embed_url,
      contract: { actionSpec: contract.actionSpec, intent: contract.intent },
    };
  } finally {
    try {
      await client.close();
    } catch {
      /* noop */
    }
  }
}

// ── helpers ─────────────────────────────────────────────────

/** "openai:gpt-5.5-2026-04-23" → "openai-gpt-5.5-2026-04-23" (generator id 규칙: [a-z0-9_:.-]). */
function gguiModelToGenerator(model) {
  return String(model).replace(/:/g, "-");
}

function safe(v) {
  try {
    return JSON.stringify(v).slice(0, 400);
  } catch {
    return String(v);
  }
}

/**
 * MCP callTool 결과에서 키를 찾는다. ggui 는 structuredContent 또는
 * content[].text(JSON) 양쪽으로 줄 수 있어 둘 다 본다.
 */
function pickFromResult(res, keys) {
  if (!res || typeof res !== "object") return undefined;
  const sc = res.structuredContent;
  if (sc && typeof sc === "object") {
    for (const k of keys) if (sc[k] != null) return sc[k];
  }
  // content[].text 가 JSON 일 수 있음
  const content = res.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string") {
        try {
          const parsed = JSON.parse(block.text);
          for (const k of keys) if (parsed && parsed[k] != null) return parsed[k];
        } catch {
          /* 텍스트가 JSON 아님 — 무시 */
        }
      }
    }
  }
  // 최상위 직접 키
  for (const k of keys) if (res[k] != null) return res[k];
  return undefined;
}
