import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(__dirname, "..");
const menu = JSON.parse(
  readFileSync(join(moduleDir, "..", "module-b", "data", "menu.seed.json"), "utf8"),
);

test("POST /ground-intent returns validated fallback grounding without OpenAI", async () => {
  const port = 8812;
  const server = spawn("node", ["server.js"], {
    cwd: moduleDir,
    env: {
      ...process.env,
      PORT: String(port),
      GGUI_MODE: "local",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await waitForHealth(port);
    const res = await fetch(`http://127.0.0.1:${port}/ground-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "recommend",
        transcript: "유자차 하나 주문해줘",
        menu_context: menu.items,
        order_state: {
          selected_options: {},
          quantity: 1,
          total: 0,
        },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.item_candidates[0].item_id, "yuzu-tea-032");
    assert.equal(body.needs_clarification, false);
  } finally {
    server.kill("SIGTERM");
  }
});

async function waitForHealth(port) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Module C test server did not become healthy.");
}
