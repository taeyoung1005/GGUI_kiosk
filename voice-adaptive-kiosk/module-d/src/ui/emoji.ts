// src/ui/emoji.ts
// 메뉴 썸네일용 간단 이모지 매핑(이미지 자산 없이도 데모가 보기 좋게).
import type { MenuItem } from "@contracts/types";

export function emojiFor(item: MenuItem): string {
  const n = item.name.toLowerCase();
  if (n.includes("vanilla")) return "🍦";
  if (n.includes("mocha") || n.includes("chocolate")) return "🍫";
  if (n.includes("americano") || n.includes("espresso")) return "☕";
  if (n.includes("latte") || item.category === "Latte") return "🥛";
  if (item.category === "Dessert" || n.includes("cake")) return "🍰";
  if (item.category === "Tea") return "🍵";
  if (item.category === "Ade" || item.category === "Beverage") return "🧋";
  return "☕";
}

export function artFor(item: MenuItem): string {
  const category = item.category.toLowerCase();
  const [bg, fg] =
    category === "latte"
      ? ["#f4efe2", "#7c4a26"]
      : category === "coffee"
        ? ["#ede3d2", "#3b2417"]
        : category === "tea"
          ? ["#e6f2df", "#315f38"]
          : category === "dessert"
            ? ["#f7e5ee", "#8f3157"]
            : ["#e4f3f4", "#205f68"];
  const label = item.name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220" role="img" aria-label="${escapeXml(item.name)}"><rect width="320" height="220" rx="18" fill="${bg}"/><circle cx="160" cy="92" r="58" fill="#fff" opacity=".8"/><text x="160" y="111" text-anchor="middle" font-size="46" font-family="Pretendard, sans-serif">${emojiFor(item)}</text><text x="160" y="172" text-anchor="middle" font-size="28" font-weight="800" fill="${fg}" font-family="Pretendard, sans-serif">${escapeXml(label)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function won(n: number): string {
  return `₩${n.toLocaleString("en-US")}`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => {
    switch (ch) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}
