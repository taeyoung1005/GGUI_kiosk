// src/local-render.js
//
// LOCAL_FALLBACK 경로: GGUI/OPENAI 미가동 시, 요청(transcript+menu_context+assist_level)으로
// 적응형 HTML 을 직접 생성한다. assist_level 높을수록 글자·여백·음성안내↑, 카드 2~3장.
// 생성 HTML 은 /r/:id 로 서빙되어 D 가 iframe 으로 임베드한다.
//
// D 와의 액션 계약: 카드/버튼 클릭 시 window.parent 로 postMessage 한다.
//   { source: "ggui-local", type: "action", action: <actionSpec key>, data: {...} }
// → D 는 GGUI 의 ggui_consume 대신 이 message 를 받아 동일하게 멀티턴을 진행한다.

import { stepCopy } from "./adapt.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function won(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("ko-KR") + "원";
}

/** 카드 한 장 HTML. */
function cardHtml(item, t, showDesc) {
  const id = esc(item.id);
  const name = esc(item.name);
  const price = won(item.price);
  const desc = showDesc && item.desc ? `<p class="desc">${esc(item.desc)}</p>` : "";
  // 이미지가 상대경로(/img/..)면 깨질 수 있으니 이모지 플레이스홀더 폴백.
  const thumb = item.image_url
    ? `<div class="thumb" style="background-image:url('${esc(item.image_url)}')"></div>`
    : `<div class="thumb thumb--ph">🍵</div>`;
  return `
    <button class="card" data-action="selectMenu" data-item-id="${id}" aria-label="${name}, ${price}, 선택">
      ${thumb}
      <div class="card-body">
        <div class="card-name">${name}</div>
        <div class="card-price">${price}</div>
        ${desc}
      </div>
      <div class="card-cta">이거 주문</div>
    </button>`;
}

/** 옵션 화면 본문. */
function optionsBody(item, options, t) {
  const groups = (options ?? [])
    .map((opt) => {
      const choices = (opt.choices ?? [])
        .map(
          (c) =>
            `<button class="opt" data-action="selectOption" data-type="${esc(
              opt.type
            )}" data-label="${esc(c.label)}">
               ${esc(c.label)}${
              c.price_delta ? `<span class="opt-delta">+${won(c.price_delta)}</span>` : ""
            }
             </button>`
        )
        .join("");
      return `<section class="opt-group"><h2 class="opt-title">${esc(
        opt.type
      )}</h2><div class="opt-row">${choices}</div></section>`;
    })
    .join("");
  return `<div class="opt-wrap">
      <div class="confirm-item">${esc(item.name)} · ${won(item.price)}</div>
      ${groups || '<p class="muted">선택할 옵션이 없습니다.</p>'}
      <button class="btn btn-ghost" data-action="back">이전으로</button>
    </div>`;
}

/** 확인(예/아니요) 화면 본문. */
function confirmBody(item, selectedOptions, total, t) {
  const opts = Object.entries(selectedOptions ?? {})
    .map(([k, v]) => `<li><b>${esc(k)}</b> · ${esc(v)}</li>`)
    .join("");
  return `<div class="confirm-wrap">
      <div class="confirm-item">${esc(item.name)}</div>
      <ul class="confirm-opts">${opts || "<li>옵션 없음</li>"}</ul>
      <div class="confirm-total">합계 <b>${won(total ?? item.price)}</b></div>
      <div class="yesno">
        <button class="btn btn-yes" data-action="confirmYes">예, 주문할게요</button>
        <button class="btn btn-no" data-action="confirmNo">아니요, 다시 고를게요</button>
      </div>
    </div>`;
}

/**
 * 적응형 HTML 문서 한 장을 만든다.
 * @param {object} args
 * @param {"recommend"|"options"|"confirm"} args.step
 * @param {object} args.profile  resolveProfile 결과 (tokens 포함)
 * @param {object[]} args.candidates  추천 카드 목록
 * @param {object} [args.item]  options/confirm 단계 대상 아이템
 * @param {object} [args.selectedOptions]
 * @param {number} [args.total]
 * @param {string} args.transcript
 */
export function renderLocalHtml(args) {
  const { step, profile, candidates = [], transcript } = args;
  const t = profile.tokens;
  const copy = stepCopy(step, profile, candidates);

  let body = "";
  if (step === "options" && args.item) {
    body = optionsBody(args.item, args.item.options ?? [], t);
  } else if (step === "confirm" && args.item) {
    body = confirmBody(args.item, args.selectedOptions, args.total, t);
  } else {
    const cards = candidates
      .slice(0, t.card_count)
      .map((it) => cardHtml(it, t, t.show_desc))
      .join("");
    body = `<div class="cards cards--${t.card_count}">${cards}</div>`;
  }

  const voice = t.voice_guide ? copy.voice : "";
  const gridCols =
    step === "recommend" ? (t.card_count >= 3 ? 3 : 2) : 1;

  // 인라인 CSS: assist_level 토큰을 CSS 변수로 주입 → 글자·여백 적응.
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>적응 UI · ${esc(step)} · L${profile.assist_level}</title>
<style>
  :root{
    --base:${t.base_font_px}px;
    --title:${t.title_font_px}px;
    --pad:${t.card_pad_px}px;
    --gap:${t.gap_px}px;
    --cols:${gridCols};
    --fg:#1b2430; --muted:#5b6573; --bg:#f7f9fc;
    --brand:#1d6fe0; --yes:#1b8a3a; --no:#c33; --card:#fff; --line:#e3e8f0;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
    font-family:"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",system-ui,sans-serif;
    font-size:var(--base);line-height:1.45;-webkit-text-size-adjust:100%;}
  .wrap{max-width:1000px;margin:0 auto;padding:var(--pad);}
  header.kiosk{padding:calc(var(--pad)) 0 var(--gap);}
  .badge{display:inline-block;font-size:.7em;color:var(--muted);
    border:1px solid var(--line);border-radius:999px;padding:.2em .8em;margin-bottom:.6em;}
  h1.title{font-size:var(--title);margin:.1em 0 .2em;font-weight:800;letter-spacing:-.01em;}
  p.subtitle{font-size:calc(var(--base) * 1.0);color:var(--muted);margin:.2em 0 0;}
  .cards{display:grid;gap:var(--gap);grid-template-columns:repeat(var(--cols),1fr);margin-top:var(--gap);}
  @media(max-width:640px){.cards{grid-template-columns:1fr;}}
  .card{appearance:none;text-align:left;cursor:pointer;background:var(--card);
    border:2px solid var(--line);border-radius:20px;padding:var(--pad);
    display:flex;flex-direction:column;gap:.5em;transition:.12s;min-height:120px;}
  .card:hover,.card:focus{border-color:var(--brand);box-shadow:0 6px 22px rgba(29,111,224,.16);outline:none;transform:translateY(-2px);}
  .thumb{width:100%;height:120px;border-radius:14px;background:#eef3fb center/cover no-repeat;
    display:flex;align-items:center;justify-content:center;font-size:2.4em;}
  .thumb--ph{color:#9bb4d6;}
  .card-name{font-size:calc(var(--base) * 1.15);font-weight:800;}
  .card-price{font-size:calc(var(--base) * 1.05);color:var(--brand);font-weight:800;}
  .desc{font-size:.9em;color:var(--muted);margin:.2em 0 0;}
  .card-cta{margin-top:auto;align-self:flex-start;background:var(--brand);color:#fff;
    border-radius:12px;padding:.5em 1em;font-weight:800;font-size:calc(var(--base) * .95);}
  .yesno{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap);margin-top:var(--gap);}
  @media(max-width:520px){.yesno{grid-template-columns:1fr;}}
  .btn{appearance:none;cursor:pointer;border:none;border-radius:18px;
    padding:calc(var(--pad) * .9) var(--pad);font-size:calc(var(--base) * 1.2);font-weight:800;color:#fff;}
  .btn-yes{background:var(--yes);} .btn-no{background:var(--no);}
  .btn-ghost{background:#eef1f6;color:var(--fg);margin-top:var(--gap);}
  .opt-wrap,.confirm-wrap{margin-top:var(--gap);display:flex;flex-direction:column;gap:var(--gap);}
  .opt-group{background:var(--card);border:2px solid var(--line);border-radius:18px;padding:var(--pad);}
  .opt-title{font-size:calc(var(--base) * 1.1);margin:0 0 .5em;}
  .opt-row{display:flex;flex-wrap:wrap;gap:var(--gap);}
  .opt{appearance:none;cursor:pointer;background:#fff;border:2px solid var(--line);border-radius:14px;
    padding:.7em 1.3em;font-size:calc(var(--base) * 1.05);font-weight:800;color:var(--fg);display:flex;gap:.5em;align-items:center;}
  .opt:hover,.opt:focus{border-color:var(--brand);outline:none;}
  .opt-delta{color:var(--muted);font-weight:600;font-size:.8em;}
  .confirm-item{font-size:calc(var(--base) * 1.25);font-weight:800;}
  .confirm-opts{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.3em;}
  .confirm-total{font-size:calc(var(--base) * 1.15);}
  .muted{color:var(--muted);}
  .voicebar{margin-top:var(--gap);display:flex;align-items:center;gap:.6em;
    background:#fff7e6;border:1px solid #f0d27a;border-radius:14px;padding:.7em 1em;font-size:.95em;}
  .voicebar button{appearance:none;cursor:pointer;border:1px solid #e0b94a;background:#fff;border-radius:10px;padding:.4em .9em;font-weight:700;}
</style>
</head>
<body>
  <div class="wrap">
    <header class="kiosk">
      <span class="badge">적응 강도 L${profile.assist_level}${
    profile.age_group === "50+" ? " · 50+" : ""
  } · ${esc(t.label)}</span>
      <h1 class="title">${esc(copy.title)}</h1>
      <p class="subtitle">${esc(copy.subtitle)}</p>
    </header>
    ${
      voice
        ? `<div class="voicebar">🔊 <span id="voiceText">${esc(
            voice
          )}</span> <button id="voiceReplay" data-action="repeat">다시 듣기</button></div>`
        : ""
    }
    <main>${body}</main>
  </div>
<script>
(function(){
  var VOICE = ${JSON.stringify(voice)};
  function speak(text){
    try{
      if(!text || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR"; u.rate = ${profile.effective_level >= 2 ? "0.9" : "1.0"};
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  // 적응 음성안내: 화면 진입 시 자동 1회(가능한 브라우저에서).
  if(VOICE){ setTimeout(function(){ speak(VOICE); }, 350); }

  function emit(action, data){
    var msg = { source:"ggui-local", type:"action", action:action, data:data||{} };
    try{ window.parent && window.parent.postMessage(msg, "*"); }catch(e){}
    // 부모 없이 단독으로 열렸을 때 디버그용
    console.log("[ggui-local action]", msg);
  }

  document.addEventListener("click", function(ev){
    var el = ev.target.closest("[data-action]");
    if(!el) return;
    var action = el.getAttribute("data-action");
    if(action === "repeat"){ speak(VOICE); return; }
    if(action === "selectMenu"){ emit("selectMenu", { item_id: el.getAttribute("data-item-id") }); return; }
    if(action === "selectOption"){ emit("selectOption", { type: el.getAttribute("data-type"), label: el.getAttribute("data-label") }); return; }
    if(action === "back"){ emit("back", {}); return; }
    if(action === "confirmYes"){ emit("confirmYes", {}); return; }
    if(action === "confirmNo"){ emit("confirmNo", {}); return; }
    emit(action, {});
  });
})();
</script>
</body>
</html>`;
}
