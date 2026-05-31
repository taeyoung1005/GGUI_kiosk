import type { MenuItem } from "@contracts/types";
import type { AdaptiveStep, AdaptiveOrderState } from "@contracts/types";

export type VoiceIntent =
  | { type: "select_item"; item: MenuItem }
  | { type: "set_options"; options: Record<string, string> }
  | { type: "fulfillment"; value: "Dine In" | "Take Out" }
  | { type: "loyalty"; value: "scan" | "phone" | "none" }
  | { type: "payment"; value: "Credit Card" | "Gift Card" | "Kakao Pay" | "Naver Pay" | "Pay at Counter" }
  | { type: "confirm" }
  | { type: "change" }
  | { type: "cancel" }
  | { type: "unknown"; reason: string };

export function interpretVoiceTurn({
  step,
  transcript,
  candidates,
  selectedItem,
}: {
  step: AdaptiveStep;
  transcript: string;
  candidates: MenuItem[];
  selectedItem: MenuItem | null;
  orderState: AdaptiveOrderState;
}): VoiceIntent {
  const text = normalize(transcript);
  if (!text) return { type: "unknown", reason: "empty transcript" };
  if (hasAny(text, ["cancel", "start over", "처음", "취소"])) return { type: "cancel" };
  if (hasAny(text, ["change", "again", "back", "다시", "아니", "바꿀"])) return { type: "change" };

  if (step === "recommend") {
    const byOrdinal = matchOrdinal(text, candidates);
    if (byOrdinal) return { type: "select_item", item: byOrdinal };
    const item = matchMenuItem(text, candidates);
    if (item) return { type: "select_item", item };
    return { type: "unknown", reason: "no matching menu item" };
  }

  if (step === "options" && selectedItem) {
    const optionPatch = matchOptions(text, selectedItem);
    if (Object.keys(optionPatch).length > 0) return { type: "set_options", options: optionPatch };
    if (hasAny(text, ["yes", "ok", "okay", "done", "looks good", "맞", "네", "응", "좋", "완료"])) {
      return { type: "confirm" };
    }
    return { type: "unknown", reason: "no matching option" };
  }

  if (step === "fulfillment") {
    if (hasAny(text, ["take out", "to go", "carry out", "포장", "테이크아웃"])) {
      return { type: "fulfillment", value: "Take Out" };
    }
    if (hasAny(text, ["dine", "eat in", "here", "매장", "먹고", "먹을"])) {
      return { type: "fulfillment", value: "Dine In" };
    }
    return { type: "unknown", reason: "no fulfillment match" };
  }

  if (step === "loyalty") {
    if (hasAny(text, ["skip", "no", "none", "pass", "건너", "안 할", "안해", "없어"])) {
      return { type: "loyalty", value: "none" };
    }
    if (hasAny(text, ["coupon", "qr", "쿠폰"])) return { type: "loyalty", value: "scan" };
    if (hasAny(text, ["point", "phone", "earn", "적립", "번호"])) return { type: "loyalty", value: "phone" };
    return { type: "unknown", reason: "no loyalty match" };
  }

  if (step === "payment") {
    if (hasAny(text, ["kakao", "카카오"])) return { type: "payment", value: "Kakao Pay" };
    if (hasAny(text, ["naver", "네이버"])) return { type: "payment", value: "Naver Pay" };
    if (hasAny(text, ["gift", "voucher", "선불", "상품권"])) return { type: "payment", value: "Gift Card" };
    if (hasAny(text, ["counter", "cash", "현금", "카운터"])) return { type: "payment", value: "Pay at Counter" };
    if (hasAny(text, ["card", "credit", "카드"])) return { type: "payment", value: "Credit Card" };
    return { type: "unknown", reason: "no payment match" };
  }

  if (step === "confirm") {
    if (hasAny(text, ["yes", "pay", "confirm", "correct", "네", "맞", "결제", "응"])) return { type: "confirm" };
    if (hasAny(text, ["no", "change", "아니", "수정", "바꿀"])) return { type: "change" };
    return { type: "unknown", reason: "no confirmation match" };
  }

  return { type: "unknown", reason: "unsupported step" };
}

function matchMenuItem(text: string, candidates: MenuItem[]): MenuItem | null {
  const scored = candidates
    .map((item) => ({ item, score: scoreText(text, `${item.name} ${item.category} ${item.desc}`) }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].item : null;
}

function matchOrdinal(text: string, candidates: MenuItem[]): MenuItem | null {
  if (hasAny(text, ["first", "top", "one", "첫", "첫번째", "1번", "그거"])) return candidates[0] ?? null;
  if (hasAny(text, ["second", "two", "두번째", "2번"])) return candidates[1] ?? null;
  if (hasAny(text, ["third", "three", "세번째", "3번"])) return candidates[2] ?? null;
  return null;
}

function matchOptions(text: string, item: MenuItem): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const opt of item.options) {
    const choice = opt.choices.find((candidate) => {
      const label = normalize(candidate.label);
      return text.includes(label) || optionAliasHit(text, opt.type, candidate.label);
    });
    if (choice) patch[opt.type] = choice.label;
  }
  return patch;
}

function optionAliasHit(text: string, type: string, label: string): boolean {
  const normalizedType = normalize(type);
  const normalizedLabel = normalize(label);
  if (normalizedType.includes("temperature")) {
    if (normalizedLabel === "iced") return hasAny(text, ["ice", "iced", "cold", "아이스", "차갑"]);
    if (normalizedLabel === "hot") return hasAny(text, ["hot", "warm", "따뜻", "뜨거"]);
  }
  if (normalizedType.includes("size")) {
    if (normalizedLabel === "large" || normalizedLabel === "l") return hasAny(text, ["large", "big", "큰", "라지"]);
    if (normalizedLabel === "regular" || normalizedLabel === "r") return hasAny(text, ["regular", "normal", "보통"]);
  }
  if (normalizedType.includes("sweet")) {
    if (normalizedLabel.includes("less")) return hasAny(text, ["less", "덜", "not too sweet"]);
  }
  return false;
}

function scoreText(needle: string, haystack: string): number {
  const hay = normalize(haystack);
  const tokens = needle.split(" ").filter((token) => token.length >= 2);
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += token.length >= 5 ? 3 : 2;
  }
  if (hay.includes(needle.replace(/\s+/g, ""))) score += 5;
  return score;
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(normalize(needle)));
}

function normalize(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
