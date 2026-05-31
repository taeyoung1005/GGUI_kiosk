// scripts/health.mjs
//
// 전 모듈 헬스체크. 기동 후 `npm run health` 로 A/B/C/D 가 응답하는지 한 번에 확인한다.
// (D 는 vite — /health 가 없으므로 루트 200 으로 확인)

const TARGETS = [
  { name: "A (realtime/STT)", url: `http://localhost:${process.env.ANALYZE_PORT || 8000}/health` },
  { name: "B (menu)", url: `http://localhost:${process.env.MENU_PORT || 8001}/health` },
  { name: "C (generate-ui)", url: `http://localhost:${process.env.GGUI_WRAPPER_PORT || 8002}/health` },
  { name: "D (frontend)", url: `http://localhost:${process.env.VITE_PORT || 5173}/`, expectHtml: true },
];

async function ping({ name, url, expectHtml }) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { name, ok: false, detail: `HTTP ${res.status}` };
    const detail = expectHtml ? "200" : JSON.stringify(await res.json());
    return { name, ok: true, detail };
  } catch (e) {
    return { name, ok: false, detail: e.name === "AbortError" ? "timeout" : (e.message || String(e)) };
  }
}

const results = await Promise.all(TARGETS.map(ping));
let allOk = true;
for (const r of results) {
  const mark = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
  if (!r.ok) allOk = false;
  console.log(`${mark} ${r.name.padEnd(16)} ${r.detail}`);
}
process.exit(allOk ? 0 : 1);
