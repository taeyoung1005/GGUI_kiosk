// src/adapt.js
//
// 적응 규율(canonical) — assist_level(0~3) + age_group(50+/under50) → UI 강도.
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

/**
 * 적응 프로파일 계산.
 * age_group 이 "50+" 면 보조 강도를 한 단계만 부드럽게 올린다(보조 신호).
 */
export function resolveProfile({ assist_level, age_group }) {
  const lvl = normalizeAssistLevel(assist_level);
  // 나이 보조 가중: 50+ 이고 아직 최대치가 아니면 effective 를 +1 (단, 토큰만, 원래 level 은 유지)
  let effective = lvl;
  if (age_group === "50+" && effective < 3) effective += 1;
  const tokens = ASSIST_TOKENS[effective] ?? ASSIST_TOKENS[0];
  return {
    assist_level: lvl,
    effective_level: effective,
    age_group: age_group === "50+" ? "50+" : "under50",
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
    const hay = `${it.name ?? ""} ${it.category ?? ""} ${it.desc ?? ""}`;
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

/** 단계(step) 별 한국어 안내 문구(노인친화 톤). */
export function stepCopy(step, profile, candidates) {
  const big = profile.effective_level >= 2;
  switch (step) {
    case "options":
      return {
        title: big ? "어떻게 드릴까요?" : "옵션을 선택해 주세요",
        subtitle: "원하시는 것을 큰 버튼으로 골라 주세요.",
        voice:
          "원하시는 옵션을 골라 주세요. 따뜻한 것과 차가운 것 중에서 선택하실 수 있어요.",
      };
    case "confirm":
      return {
        title: big ? "이대로 주문할까요?" : "주문을 확인해 주세요",
        subtitle: "맞으면 ‘예’, 다시 고르려면 ‘아니요’를 눌러 주세요.",
        voice: "이대로 주문하시겠어요? 맞으면 예, 다시 고르려면 아니요를 눌러 주세요.",
      };
    case "recommend":
    default: {
      const first = candidates?.[0]?.name ?? "추천 메뉴";
      return {
        title: big ? "이거 어떠세요?" : "이런 메뉴는 어떠세요?",
        subtitle: "마음에 드는 것을 큰 카드로 골라 주세요.",
        voice: `${first} 같은 메뉴를 추천드려요. 마음에 드시는 것을 골라 주세요.`,
      };
    }
  }
}
