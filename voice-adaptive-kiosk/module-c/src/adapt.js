// src/adapt.js
//
// 적응 규율(canonical) — 고령자 친화 최대 강도로 고정한다.
// "구조 고정(큰 카드 2장 + 예/아니요 + 큰 글씨), 내용만 적응"이라는 데모 규칙을
// 한 곳에 둔다. GGUI 경로는 이 규율을 prompt 로, LOCAL 경로는 이 규율을 디자인 토큰으로 쓴다.
//
// 나이/행동신호 입력은 제거됐다. 적응 강도는 항상 고령자 최대(SENIOR_TOKENS)로 고정하고,
// 발화 transcript 만 콘텐츠(추천 후보·옵션 매칭)에 반영한다.

/** 고령자 친화 최대 강도 디자인 토큰(고정). 큰 글씨·넓은 여백·강한 음성안내. */
const SENIOR_TOKENS = {
  label: "고령자 친화 최대",
  font_scale: 1.6,
  base_font_px: 30,
  title_font_px: 44,
  card_count: 2, // 선택 부담 최소화: 카드 2장
  card_pad_px: 32,
  gap_px: 30,
  voice_guide: true, // 강한 음성안내
  show_desc: false, // 잡정보 제거, 이름·가격만
  yesno_big: true,
  tone: "xlarge",
};

/**
 * 적응 프로파일 계산.
 * 강도는 항상 고령자 최대로 고정한다(인자는 받지 않으며 무시한다).
 */
export function resolveProfile() {
  return {
    tokens: SENIOR_TOKENS,
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

/** 단계별 카피(한국어, 고령자 친화 톤 고정). */
export function stepCopy(step, profile, candidates) {
  switch (step) {
    case "options":
      return {
        title: "어떻게 드릴까요?",
        subtitle: "큰 버튼으로 원하시는 것을 선택하세요.",
        voice: "옵션을 골라주세요. 뜨겁게 또는 차갑게 선택하실 수 있어요.",
      };
    case "confirm":
      return {
        title: "결제하시겠어요?",
        subtitle: "결제 전에 메뉴, 매장/포장, 포인트, 결제수단을 확인하세요.",
        voice: "주문 내용을 확인해주세요. 맞으면 '네'라고 말씀하시거나 결제를 눌러주세요.",
      };
    case "fulfillment":
      return {
        title: "매장에서 드시나요, 포장하시나요?",
        subtitle: "주문을 어디서 준비할지 선택하세요.",
        voice: "'포장', '매장'이라고 말씀하시거나 큰 버튼을 눌러주세요.",
      };
    case "loyalty":
      return {
        title: "쿠폰이나 포인트 사용하시나요?",
        subtitle: "쿠폰을 찍거나 포인트를 적립하거나 건너뛸 수 있어요.",
        voice: "쿠폰, 포인트 적립, 또는 건너뛰기 중에서 선택해주세요.",
      };
    case "payment":
      return {
        title: "어떻게 결제하시나요?",
        subtitle: "결제는 마지막 확인 화면에서 진행됩니다.",
        voice: "카드, 간편결제, 상품권, 또는 카운터 결제 중에서 골라주세요.",
      };
    case "recommend":
    default: {
      const first = candidates?.[0]?.name ?? "메뉴";
      return {
        title: "이 중에서 골라주세요",
        subtitle: "큰 카드로 원하시는 것을 선택하세요.",
        voice: `${first} 같은 메뉴를 추천드려요. 원하시는 것을 골라주세요.`,
      };
    }
  }
}
