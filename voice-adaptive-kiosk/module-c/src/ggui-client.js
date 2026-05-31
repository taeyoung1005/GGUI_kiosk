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
export function buildPrompt({ step, profile, transcript, candidates, orderState, possibleActions }) {
  const t = profile.tokens;
  const copy = stepCopy(step, profile, candidates);
  const structureByStep = {
    recommend: `- ${t.card_count} large menu cards in a grid. Each card: photo (placeholder ok) + name + price + a large "Order this" button.`,
    options: "- Choose options (temperature/size) for the selected item with large buttons. Include a clear Continue button.",
    fulfillment: "- Two large choices: Dine In and Take Out. Show the selected item and current total.",
    loyalty: "- Three large choices: App Coupon, Earn Points, and Skip. Make Skip safe and visible.",
    payment: "- Payment method choices. Make clear that payment is not charged until final confirmation.",
    confirm: "- Final order summary + one large Pay/Yes button and one Change button.",
  };
  const lines = [
    "You build a voice-adaptive kiosk UI for people who struggle with kiosks (mainly seniors aged 50+). Write ALL UI text in ENGLISH.",
    `User utterance (STT): "${transcript ?? ""}"`,
    `Adaptation intensity assist_level=${profile.assist_level} (effective=${profile.effective_level}), age group=${profile.age_group}.`,
    `Current step: ${step}.`,
    `Order state JSON: ${JSON.stringify(orderState ?? {})}.`,
    `Possible actions: ${(possibleActions ?? []).join(", ") || "none"}.`,
    `Menu catalog JSON: ${JSON.stringify(candidates ?? [])}.`,
    "",
    "[FIXED STRUCTURE — never change]",
    structureByStep[step] ?? structureByStep.recommend,
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
    "Use only menu items from the provided Menu catalog JSON; do not invent menu names.",
    step === "recommend"
      ? `Pick the best ${t.card_count} matching menu items from the catalog and show only those cards.`
      : "Use the selected item/order state from props for this step.",
    "Use the actionSpec button labels/actions as-is, and let the user advance to the next step with one big touch.",
  ];
  return lines.join("\n");
}

/** GGUI render props(단계별). DataContract.propsSpec 과 키가 일치해야 한다. */
export function buildGguiProps({ step, profile, candidates, item, selectedOptions, total, orderState, possibleActions }) {
  const copy = stepCopy(step, profile, candidates);
  const base = {
    title: copy.title,
    subtitle: copy.subtitle,
    assistLevel: profile.assist_level,
    ageGroup: profile.age_group,
    voiceGuide: profile.tokens.voice_guide ? copy.voice : "",
    orderState: orderState ?? {},
    possibleActions: possibleActions ?? [],
  };
  const targetItem = item ?? candidates[0];
  if (step === "options") {
    return { ...base, item: targetItem, options: targetItem?.options ?? [] };
  }
  if (step === "confirm") {
    return {
      ...base,
      item: targetItem,
      selectedOptions: selectedOptions ?? {},
      total: total ?? orderState?.total ?? targetItem?.price ?? 0,
    };
  }
  if (step === "fulfillment" || step === "loyalty" || step === "payment") {
    return { ...base, item: targetItem, total: total ?? orderState?.total ?? targetItem?.price ?? 0 };
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
    order_state,
    possible_actions,
  } = req;

  const profile = resolveProfile({ assist_level, age_group });
  const candidates =
    step === "recommend"
      ? (Array.isArray(menu_context) ? menu_context.filter(Boolean) : [])
      : pickCandidates(menu_context, transcript, profile.tokens.card_count);
  const visibleCandidates = pickCandidates(candidates, transcript, profile.tokens.card_count);
  const contract = buildDataContract(step, { candidates, profile });
  const targetItem = item ?? menu_context?.[0] ?? visibleCandidates[0] ?? candidates[0];
  const selected = selectedOptions ?? order_state?.selected_options ?? {};
  const resolvedTotal = total ?? order_state?.total;
  const prompt = buildPrompt({
    step,
    profile,
    transcript,
    candidates,
    orderState: order_state,
    possibleActions: possible_actions,
  });
  const props = buildGguiProps({
    step,
    profile,
    candidates,
    item: targetItem,
    selectedOptions: selected,
    total: resolvedTotal,
    orderState: order_state,
    possibleActions: possible_actions,
  });

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

    // 0) Optional new session. Older rc builds required ggui_new_session; latest GGUI
    // starts from ggui_handshake and no longer registers the session tool.
    const sessionId = await createGguiSessionIfAvailable(client);

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
        ...(sessionId ? { sessionId } : {}),
        ...(env.GGUI_FORCE_CREATE === "1" || env.GGUI_FORCE_CREATE === "true"
          ? { forceCreate: true }
          : {}),
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

    // 2) render — accept + props. Latest GGUI uses ggui_render; older rc builds used ggui_push.
    const pushRes = await callGguiRenderTool(client, {
      handshakeId,
      decision: { kind: "accept" },
      props,
    });
    const normalizedPush = normalizeGguiPushResult(pushRes, gguiUrl);
    const resource = normalizedPush.resource_uri
      ? await readGguiResource(client, normalizedPush.resource_uri)
      : null;

    return {
      render_id: normalizedPush.render_id,
      embed_url: normalizedPush.embed_url,
      contract: {
        actionSpec: contract.actionSpec,
        intent: contract.intent,
        ...(normalizedPush.resource_uri
          ? {
              _ggui: {
                resource_uri: normalizedPush.resource_uri,
                meta: normalizedPush.meta,
                html: resource?.html ?? "",
                csp: resource?.csp ?? null,
              },
            }
          : {}),
      },
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

/** 최신 GGUI(`ggui_render`)를 우선 호출하고, 구버전 서버면 `ggui_push`로 폴백한다. */
export async function callGguiRenderTool(client, args) {
  const latest = await client
    .callTool({ name: "ggui_render", arguments: args })
    .catch((err) => ({ __toolError: err }));
  if (!isToolNotFound(latest, "ggui_render")) return latest;
  return client.callTool({ name: "ggui_push", arguments: args });
}

/** 구버전 GGUI session tool이 있으면 sessionId를 만들고, 최신 GGUI면 생략한다. */
export async function createGguiSessionIfAvailable(client) {
  const sessionRes = await client
    .callTool({ name: "ggui_new_session", arguments: {} })
    .catch((err) => ({ __toolError: err }));
  if (isToolNotFound(sessionRes, "ggui_new_session")) return undefined;
  const sessionId = pickFromResult(sessionRes, ["sessionId", "session_id"]);
  if (!sessionId) {
    throw new Error("ggui_new_session: sessionId 없음 (응답: " + safe(sessionRes) + ")");
  }
  return sessionId;
}

export async function consumeGguiEvents(renderId, env, timeout = 0) {
  const gguiUrl = (env.GGUI_URL || "http://localhost:6781").replace(/\/$/, "");
  const bearer = env.GGUI_BEARER || "dev";
  const transport = new StreamableHTTPClientTransport(new URL(`${gguiUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const client = new Client(
    { name: "voice-adaptive-kiosk-module-c-consume", version: "0.1.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const res = await client.callTool({
      name: "ggui_consume",
      arguments: { renderId, timeout },
    });
    return {
      events: pickFromResult(res, ["events"]) ?? [],
      status: pickFromResult(res, ["status"]) ?? "unknown",
    };
  } finally {
    try {
      await client.close();
    } catch {
      /* noop */
    }
  }
}

export async function readGguiResource(client, resourceUri) {
  const res = await client.readResource({ uri: resourceUri });
  const first = Array.isArray(res.contents) ? res.contents[0] : null;
  return {
    html: typeof first?.text === "string" ? first.text : "",
    csp: first?._meta?.ui?.csp ?? null,
  };
}

/** 실서버 `ggui_push`/최신 `ggui_render` 응답을 렌더 가능한 결과로 정규화한다. */
export function normalizeGguiPushResult(pushRes, gguiUrl) {
  // 실서버 출력: { stackItemId, url, codeReady, ... } → embed_url = url, render_id = stackItemId
  const url = pickFromResult(pushRes, ["url", "embedUrl", "embed_url"]);
  const stackItemId = pickFromResult(pushRes, ["stackItemId", "stack_item_id", "renderId"]);
  const shortCode = pickFromResult(pushRes, ["shortCode", "short_code"]);
  const codeReady = pickFromResult(pushRes, ["codeReady", "code_ready"]);
  const meta = buildMcpAppMeta(pushRes);
  const resourceUri =
    pickFromResult(pushRes, ["resourceUri", "resource_uri"]) ??
    meta?.["ui/resourceUri"] ??
    meta?.ui?.resourceUri;
  const renderMeta = meta?.["ai.ggui/render"];
  const latestCodeReady = Boolean(
    resourceUri &&
      renderMeta?.renderId &&
      (renderMeta?.codeUrl || renderMeta?.codeHash || renderMeta?.runtimeUrl)
  );

  if (!url && !stackItemId) {
    throw new Error("ggui_push: url/stackItemId 없음 (응답: " + safe(pushRes) + ")");
  }
  if (codeReady !== true && !latestCodeReady) {
    throw new Error("ggui_push: codeReady=false (응답: " + safe(pushRes) + ")");
  }

  return {
    render_id: String(stackItemId ?? `r-${Date.now()}`),
    embed_url: url ? url : shortCode ? `${gguiUrl}/r/${shortCode}` : "",
    ...(resourceUri ? { resource_uri: resourceUri } : {}),
    ...(meta ? { meta } : {}),
  };
}

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

function buildMcpAppMeta(res) {
  const existing = res?._meta;
  if (existing?.["ai.ggui/render"]) return existing;
  return undefined;
}

function isToolNotFound(res, toolName) {
  const message =
    res?.__toolError?.message ??
    res?.message ??
    res?.content?.map((block) => block?.text ?? "").join("\n") ??
    "";
  return (
    typeof message === "string" &&
    message.includes(toolName) &&
    /not found|unknown tool|Tool .* not found/i.test(message)
  );
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
