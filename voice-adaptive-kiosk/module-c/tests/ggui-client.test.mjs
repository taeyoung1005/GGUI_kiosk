import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGguiProps,
  callGguiRenderTool,
  createGguiSessionIfAvailable,
  normalizeGguiPushResult,
} from "../src/ggui-client.js";

test("normalizeGguiPushResult rejects a render URL when GGUI code is not ready", () => {
  assert.throws(
    () =>
      normalizeGguiPushResult({
        structuredContent: {
          url: "http://localhost:6781/r/demo",
          stackItemId: "stack-1",
          codeReady: false,
        },
      }, "http://localhost:6781"),
    /codeReady=false/,
  );
});

test("normalizeGguiPushResult returns embed metadata when generated code is ready", () => {
  assert.deepEqual(
    normalizeGguiPushResult({
      structuredContent: {
        url: "http://localhost:6781/r/demo",
        stackItemId: "stack-1",
        codeReady: true,
      },
    }, "http://localhost:6781"),
    {
      render_id: "stack-1",
      embed_url: "http://localhost:6781/r/demo",
    },
  );
});

test("normalizeGguiPushResult supports latest ggui_render shortCode output", () => {
  assert.deepEqual(
    normalizeGguiPushResult({
      structuredContent: {
        renderId: "render-1",
        shortCode: "abc123",
        codeReady: true,
      },
    }, "http://localhost:6781"),
    {
      render_id: "render-1",
      embed_url: "http://localhost:6781/r/abc123",
    },
  );
});

test("normalizeGguiPushResult accepts alpha ggui_render MCP app metadata without codeReady", () => {
  assert.deepEqual(
    normalizeGguiPushResult({
      _meta: {
        "ai.ggui/render": {
          renderId: "render-alpha",
          appId: "builder",
          runtimeUrl: "http://localhost:6781/_ggui/iframe-runtime.js",
          codeUrl: "http://localhost:6781/code/hash.js",
          codeHash: "hash",
        },
        ui: {
          resourceUri: "ui://ggui/render/render-alpha/hash",
        },
        "ui/resourceUri": "ui://ggui/render/render-alpha/hash",
      },
      structuredContent: {
        renderId: "render-alpha",
        resourceUri: "ui://ggui/render/render-alpha/hash",
      },
    }, "http://localhost:6781"),
    {
      render_id: "render-alpha",
      embed_url: "",
      resource_uri: "ui://ggui/render/render-alpha/hash",
      meta: {
        "ai.ggui/render": {
          renderId: "render-alpha",
          appId: "builder",
          runtimeUrl: "http://localhost:6781/_ggui/iframe-runtime.js",
          codeUrl: "http://localhost:6781/code/hash.js",
          codeHash: "hash",
        },
        ui: {
          resourceUri: "ui://ggui/render/render-alpha/hash",
        },
        "ui/resourceUri": "ui://ggui/render/render-alpha/hash",
      },
    },
  );
});

test("callGguiRenderTool uses latest ggui_render tool before legacy ggui_push", async () => {
  const calls = [];
  const client = {
    async callTool(input) {
      calls.push(input.name);
      return {
        structuredContent: {
          renderId: "render-2",
          shortCode: "latest123",
          codeReady: true,
        },
      };
    },
  };

  const result = await callGguiRenderTool(client, {
    handshakeId: "hs-1",
    decision: { kind: "accept" },
    props: {},
  });

  assert.deepEqual(calls, ["ggui_render"]);
  assert.equal(result.structuredContent.shortCode, "latest123");
});

test("createGguiSessionIfAvailable treats missing latest session tool as optional", async () => {
  const client = {
    async callTool(input) {
      assert.equal(input.name, "ggui_new_session");
      return {
        content: [{ type: "text", text: "MCP error -32602: Tool ggui_new_session not found" }],
        isError: true,
      };
    },
  };

  assert.equal(await createGguiSessionIfAvailable(client), undefined);
});

test("buildGguiProps keeps the full recommend menu catalog for GGUI selection", () => {
  const items = [
    { id: "americano-001", name: "Americano", category: "Coffee", price: 3500, options: [] },
    { id: "yuzu-tea-032", name: "Yuzu Tea", category: "Tea", price: 4500, options: [] },
    { id: "salt-bread-041", name: "Salt Bread", category: "Dessert", price: 3800, options: [] },
  ];

  const props = buildGguiProps({
    step: "recommend",
    profile: { tokens: { voice_guide: true } },
    candidates: items,
    orderState: {},
    possibleActions: ["select_item"],
  });

  assert.equal(props.items.length, 3);
  assert.deepEqual(props.items.map((item) => item.id), [
    "americano-001",
    "yuzu-tea-032",
    "salt-bread-041",
  ]);
  // 적응 강도 입력(assistLevel/ageGroup)은 GGUI props 에서 제거됨.
  assert.equal(props.assistLevel, undefined);
  assert.equal(props.ageGroup, undefined);
});
