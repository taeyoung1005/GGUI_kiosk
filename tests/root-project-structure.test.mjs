import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const readText = (relativePath) =>
  readFileSync(join(root, relativePath), "utf8");

test("repo root exposes the single-project command surface", () => {
  const packagePath = join(root, "package.json");
  assert.equal(existsSync(packagePath), true, "root package.json is required");

  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, "module");

  const expectedScripts = {
    setup: "npm --prefix voice-adaptive-kiosk run setup",
    dev: "npm --prefix voice-adaptive-kiosk run run:all",
    "run:all": "npm --prefix voice-adaptive-kiosk run run:all",
    stop: "bash voice-adaptive-kiosk/run.sh stop",
    health: "node scripts/root-env.mjs npm --prefix voice-adaptive-kiosk run health",
    "test:root": "node --test tests/*.test.mjs",
    "test:a":
      "cd voice-adaptive-kiosk/module-a && PYTHONPATH=. .venv/bin/python -m unittest discover -s tests -v",
    verify:
      "npm run test:root && npm --prefix voice-adaptive-kiosk run verify && npm run test:a",
  };

  for (const [scriptName, command] of Object.entries(expectedScripts)) {
    assert.equal(pkg.scripts?.[scriptName], command, `${scriptName} script`);
  }
});

test("root command helper loads repo-root env files", () => {
  const script = readText("scripts/root-env.mjs");

  assert.match(script, /\.env\.local/);
  assert.match(script, /\.env/);
  assert.match(script, /spawn/);
});

test("repo root has a thin run.sh wrapper for the whole project", () => {
  const script = readText("run.sh");

  assert.match(script, /voice-adaptive-kiosk\/run\.sh/);
  assert.match(script, /exec bash/);
});

test("app runner accepts repo-root env files", () => {
  const script = readText("voice-adaptive-kiosk/run.sh");

  assert.match(script, /PARENT_ROOT=/);
  assert.match(script, /load_env_file "\$\{PARENT_ROOT\}\/\.env\.local"/);
  assert.match(script, /load_env_file "\$\{PARENT_ROOT\}\/\.env"/);
});

test("README primary usage starts from the repo root", () => {
  const readme = readText("README.md");
  const usageMatch = readme.match(/## 사용 방법[\s\S]*?```bash\n([\s\S]*?)```/);

  assert.ok(usageMatch, "README usage bash block is required");
  assert.match(usageMatch[1], /npm run setup/);
  assert.match(usageMatch[1], /npm run run:all/);
  assert.doesNotMatch(usageMatch[1], /cd voice-adaptive-kiosk/);
});
