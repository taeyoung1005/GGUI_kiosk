// scripts/screenshot-flow.mjs
//
// 음성 주문 골든 플로우 스크린샷 e2e (Playwright, 헤드리스).
// 마이크 없이 구동하기 위해 RTCPeerConnection 을 비활성화 → orchestrator 가
// isRealtimeSupported()=false 로 보고 "데모 발화" 경로로 실제 백엔드+GGUI 흐름을 돈다.
//   진입: .voice-order-banner 클릭 → "라떼 한 잔 주세요"(데모)
//   진행: 적응화면의 "🎤 다시 말하기"(.multi-turn .mic-btn) 클릭 → step별 데모 발화
// 결과: .run-logs/screenshots/*.png
//
// 사용: node scripts/screenshot-flow.mjs   (스택이 :5173 에 떠 있어야 함)

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.D_URL || "http://localhost:5173";
const OUT = process.env.SHOT_DIR || ".run-logs/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1024 },
  deviceScaleFactor: 1,
});

// 마이크/Realtime 비활성 + 헤드리스 TTS 스텁
await ctx.addInitScript(() => {
  try {
    Object.defineProperty(window, "RTCPeerConnection", { value: undefined, configurable: true });
  } catch (_) {}
  try {
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak() {}, cancel() {}, getVoices() { return []; }, addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });
    window.SpeechSynthesisUtterance = function () { return {}; };
  } catch (_) {}
});

const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));

const manifest = [];
async function shot(name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  const info = await page.evaluate(() => {
    const ggui = !!document.querySelector("iframe.embed-frame");
    const heading =
      document.querySelector(".adaptive-scene h2")?.textContent ||
      document.querySelector(".overlay .big")?.textContent ||
      document.querySelector(".static-start h2")?.textContent ||
      document.querySelector(".question")?.textContent ||
      "";
    const stepper = [...document.querySelectorAll(".stepper .chip.active")].map((e) => e.textContent).join("");
    const step = window.__giosk?.getState?.().step ?? "";
    return { ggui, heading: heading.trim().slice(0, 40), stepper: stepper.trim(), step };
  });
  // GGUI iframe 이 있으면 그 내부 UI(전체 높이)도 따로 캡처
  let gguiFile = null;
  if (info.ggui) {
    try {
      gguiFile = `${OUT}/${name}-ggui.png`;
      await page.frameLocator("iframe.embed-frame").locator("body").screenshot({ path: gguiFile });
    } catch (_) {
      gguiFile = null;
    }
  }
  manifest.push({ name, file, gguiFile, ...info });
  console.log(`  shot ${name}  step=${info.step}  render=${info.ggui ? "GGUI-iframe" : "built-in/overlay"}  「${info.heading}」 ${info.stepper}`);
}

async function advance() {
  await page.evaluate(() => window.__giosk && window.__giosk.respeak());
}

async function waitStable(timeout = 30000) {
  // 적응 화면 또는 결제완료가 뜨고 스피너가 사라질 때까지
  await page
    .waitForFunction(
      () => {
        const spinner = document.querySelector(".overlay .spinner");
        const adaptive = document.querySelector(".adaptive");
        const done = document.querySelector(".done-check");
        return !!done || (!!adaptive && !spinner);
      },
      { timeout },
    )
    .catch(() => {});
  await page.waitForTimeout(1600);
}

console.log(`스크린샷 플로우 시작 (${BASE})`);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("01-idle-kiosk");

// 음성 주문 시작 (데모 발화 "라떼 한 잔 주세요")
await page.click(".voice-order-banner", { timeout: 8000 }).catch(async () => {
  await page.click(".static-bottom-bar .mic-btn", { timeout: 8000 }).catch(() => {});
});
await waitStable();
let idx = 2;
await shot(`${String(idx).padStart(2, "0")}-recommend`);

// 단계 진행: orchestrator.respeak()(데모 발화) 로 결제완료까지 step 을 넘긴다.
for (let n = 0; n < 9; n++) {
  if ((await page.locator(".done-check").count()) > 0) break;
  await advance();
  await waitStable();
  idx += 1;
  const step = await page.evaluate(() => window.__giosk?.getState?.().phase === "done" ? "done" : window.__giosk?.getState?.().step ?? "step");
  await shot(`${String(idx).padStart(2, "0")}-${step}`);
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\n완료: ${manifest.length}장 → ${OUT}/`);
console.log(JSON.stringify(manifest.map((m) => ({ name: m.name, render: m.ggui ? "GGUI" : "built-in", heading: m.heading })), null, 2));

await browser.close();
