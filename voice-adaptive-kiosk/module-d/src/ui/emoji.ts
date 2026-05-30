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

export function won(n: number): string {
  return `₩${n.toLocaleString("en-US")}`;
}
