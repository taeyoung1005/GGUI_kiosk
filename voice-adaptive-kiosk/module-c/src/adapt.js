// src/adapt.js
//
// 적응 규율(canonical) — assist_level(0~3) + age_group(Vox-Profile broad 버킷) → UI 강도.
// "구조 고정(큰 카드 2~3장 + 예/아니요 + 큰 글씨), 내용만 적응"이라는 SPEC §4 규칙을
// 한 곳에 둔다. GGUI 경로는 이 규율을 prompt 로, LOCAL 경로는 이 규율을 디자인 토큰으로 쓴다.
//
// 적응 신호 주축 = 행동신호(assist_level). 나이(age_group)는 보조(살짝만 가중).

/** assist_level 별 디자인 토큰. 높을수록 글자·여백·음성안내가 강해진다. */
const ASSIST_TOKENS = {
  0: {
    label: "일반",
    font_scale: 1.0,
    base_font_px: 18,
    title_font_px: 26,
    card_count: 3, // 압축: 카드 3장 한눈에
    card_pad_px: 16,
    gap_px: 14,
    voice_guide: false, // TTS 안내 약함
    show_desc: true,
    yesno_big: false,
    tone: "compact",
  },
  1: {
    label: "약간 보조",
    font_scale: 1.15,
    base_font_px: 21,
    title_font_px: 30,
    card_count: 3,
    card_pad_px: 20,
    gap_px: 18,
    voice_guide: true,
    show_desc: true,
    yesno_big: false,
    tone: "comfortable",
  },
  2: {
    label: "보조",
    font_scale: 1.35,
    base_font_px: 25,
    title_font_px: 36,
    card_count: 3,
    card_pad_px: 26,
    gap_px: 24,
    voice_guide: true,
    show_desc: false, // 잡정보 제거, 이름·가격만
    yesno_big: true,
    tone: "large",
  },
  3: {
    label: "최대 보조",
    font_scale: 1.6,
    base_font_px: 30,
    title_font_px: 44,
    card_count: 2, // 선택 부담 최소화: 카드 2장
    card_pad_px: 32,
    gap_px: 30,
    voice_guide: true, // 강한 음성안내
    show_desc: false,
    yesno_big: true,
    tone: "xlarge",
  },
};

/** assist_level 정규화 (0~3 범위 보정). */
export function normalizeAssistLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}

/** 시니어 버킷 — 보조로 적응 강도를 한 단계 올린다. Legacy decade labels도 허용한다. */
const SENIOR_GROUPS = new Set(["senior_adult", "fifties", "sixties", "seventies_plus"]);

/**
 * 적응 프로파일 계산.
 * 시니어 버킷이면 보조 강도를 한 단계만 부드럽게 올린다(보조 신호).
 */
export function resolveProfile({ assist_level, age_group }) {
  const lvl = normalizeAssistLevel(assist_level);
  // 나이 보조 가중: 시니어이고 아직 최대치가 아니면 effective 를 +1 (토큰만, 원래 level 유지)
  let effective = lvl;
  if (SENIOR_GROUPS.has(age_group) && effective < 3) effective += 1;
  const tokens = ASSIST_TOKENS[effective] ?? ASSIST_TOKENS[0];
  return {
    assist_level: lvl,
    effective_level: effective,
    age_group: age_group ?? "unknown",
    tokens,
  };
}

/** 후보 메뉴를 카드 수(card_count)만큼 추린다. transcript 키워드 우선 매칭. */
export function pickCandidates(menu_context, transcript, count) {
  const items = Array.isArray(menu_context) ? menu_context.filter(Boolean) : [];
  if (items.length === 0) return [];
  const q = String(transcript ?? "").trim();
  if (!q) return items.slice(0, count);

  // 간단 키워드 점수: 이름/카테고리/설명에 전사 토큰이 포함되면 가점.
  const tokens = q
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 1);
  const scored = items.map((it) => {
    const hay = `${it.name ?? ""} ${it.category ?? ""} ${it.desc ?? ""}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 2;
      // 부분 글자 매칭(한글 '라떼' 등)
      else if (t.length >= 2 && hay.includes(t.slice(0, 2))) score += 1;
    }
    return { it, score };
  });
  const anyHit = scored.some((s) => s.score > 0);
  const ordered = anyHit
    ? scored.sort((a, b) => b.score - a.score).map((s) => s.it)
    : items;
  return ordered.slice(0, count);
}

/** Per-step copy (English, senior-friendly tone). */
export function stepCopy(step, profile, candidates) {
  const big = profile.effective_level >= 2;
  switch (step) {
    case "options":
      return {
        title: big ? "How would you like it?" : "Choose your options",
        subtitle: "Pick what you'd like with the large buttons.",
        voice:
          "Please choose your options. You can pick hot or iced.",
      };
    case "confirm":
      return {
        title: big ? "Ready to pay?" : "Please confirm your order",
        subtitle: "Check the order, place, points, and payment method before paying.",
        voice: "Please check your order. Say yes or tap pay if everything is correct.",
      };
    case "fulfillment":
      return {
        title: big ? "Eat here or take out?" : "Choose dine in or take out",
        subtitle: "Pick where this order should be prepared.",
        voice: "Please say take out, dine in, or tap one of the large buttons.",
      };
    case "loyalty":
      return {
        title: big ? "Coupons or points?" : "Coupons and points",
        subtitle: "You can scan a coupon, earn points, or skip.",
        voice: "Please choose a coupon, points, or skip this step.",
      };
    case "payment":
      return {
        title: big ? "How will you pay?" : "Choose payment method",
        subtitle: "Payment is not charged until the final confirmation.",
        voice: "Please choose card, mobile pay, gift card, or pay at the counter.",
      };
    case "recommend":
    default: {
      const first = candidates?.[0]?.name ?? "our menu";
      return {
        title: big ? "How about this?" : "How about one of these?",
        subtitle: "Pick the one you like with the large cards.",
        voice: `We recommend something like ${first}. Please pick the one you like.`,
      };
    }
  }
}
