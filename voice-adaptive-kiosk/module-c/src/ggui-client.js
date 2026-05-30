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
    "당신은 한국 디지털 취약층(주로 50세 이상)을 위한 음성 적응형 키오스크 UI를 만든다.",
    `사용자 발화(STT): "${transcript ?? ""}"`,
    `적응 강도 assist_level=${profile.assist_level} (effective=${profile.effective_level}), 나이대=${profile.age_group}.`,
    "",
    "【고정 구조 — 절대 바꾸지 말 것】",
    step === "recommend"
      ? `- 큰 메뉴 카드 ${t.card_count}장을 그리드로. 각 카드는 사진(placeholder 허용)+이름+가격+"이거 주문" 큰 버튼.`
      : step === "options"
      ? "- 한 항목씩 큰 버튼으로 옵션(온도/사이즈)을 고르게. 이전으로 버튼 포함."
      : "- 선택 요약 + ‘예/아니요’ 두 개의 큰 버튼만.",
    "- 화면 상단에 제목/안내 문구. 군더더기 정보 금지.",
    "",
    "【내용만 적응 — 강도 규율】",
    `- 기본 글자 ${t.base_font_px}px, 제목 ${t.title_font_px}px 이상. 여백 넉넉히(padding≈${t.card_pad_px}px, gap≈${t.gap_px}px).`,
    t.show_desc ? "- 짧은 설명 1줄 허용." : "- 설명은 빼고 이름·가격만(인지부하 최소).",
    t.yesno_big ? "- 버튼은 화면 폭의 절반 이상으로 크게." : "- 버튼은 보통 크기로 단정하게.",
    t.voice_guide
      ? `- 음성안내 문구를 화면에 노출하고 voiceGuide prop 으로 전달: "${copy.voice}"`
      : "- 음성안내는 약하게(필요 시만).",
    "- 색 대비 높게, 터치 영역 크게, 한글로만.",
    "",
    `제목: ${copy.title} / 안내: ${copy.subtitle}`,
    "actionSpec 의 버튼 라벨/동작을 그대로 사용하고, 사용자가 한 번의 큰 터치로 다음 단계로 가게 하라.",
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

    // 1) handshake — intent + blueprintDraft(contract) + seedPrompt(prompt).
    const handshakeRes = await client.callTool({
      name: "ggui_handshake",
      arguments: {
        intent: contract.intent,
        blueprintDraft: {
          contract: { propsSpec: contract.propsSpec, actionSpec: contract.actionSpec },
          variance: { persona: `kiosk-50plus-L${profile.assist_level}`, seedPrompt: prompt },
          ...(env.GGUI_MODEL ? { generator: gguiModelToGenerator(env.GGUI_MODEL) } : {}),
        },
      },
    });
    const handshakeId = pickFromResult(handshakeRes, ["handshakeId", "handshake_id"]);
    if (!handshakeId) {
      throw new Error("ggui_handshake: handshakeId 없음 (응답: " + safe(handshakeRes) + ")");
    }

    // 2) render — accept + props.
    const renderRes = await client.callTool({
      name: "ggui_render",
      arguments: { handshakeId, decision: { kind: "accept" }, props },
    });
    const renderId = pickFromResult(renderRes, ["renderId", "render_id"]);
    const shortCode = pickFromResult(renderRes, ["shortCode", "short_code"]);
    const resourceUri = pickFromResult(renderRes, ["resourceUri", "resource_uri"]);

    if (!shortCode && !resourceUri && !renderId) {
      throw new Error("ggui_render: renderId/shortCode 없음 (응답: " + safe(renderRes) + ")");
    }

    const embed_url = shortCode
      ? `${gguiUrl}/r/${shortCode}`
      : resourceUri
      ? resourceUri
      : `${gguiUrl}/r/${renderId}`;

    return {
      render_id: String(renderId ?? shortCode ?? `r-${Date.now()}`),
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
