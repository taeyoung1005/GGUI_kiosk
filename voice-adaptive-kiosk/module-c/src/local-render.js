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
  return "₩" + v.toLocaleString("en-US");
}

/** 카드 한 장 HTML. */
function cardHtml(item, t, showDesc, index) {
  const id = esc(item.id);
  const name = esc(item.name);
  const price = won(item.price);
  const desc = showDesc && item.desc ? `<p class="desc">${esc(item.desc)}</p>` : "";
  const rank = index === 0 ? "Best match" : index === 1 ? "Easy second choice" : "Quick option";
  const cardClass = index === 0 ? "card card-primary" : "card card-secondary";
  // 이미지가 상대경로(/img/..)면 깨질 수 있으니 이모지 플레이스홀더 폴백.
  const thumb = item.image_url
    ? `<div class="thumb" style="background-image:url('${esc(item.image_url)}')"></div>`
    : `<div class="thumb thumb--ph">LATTE</div>`;
  return `
    <button class="${cardClass}" data-action="selectMenu" data-item-id="${id}" aria-label="${name}, ${price}, select">
      <div class="rank">${rank}</div>
      <div class="media">${thumb}</div>
      <div class="card-body">
        <div class="card-name">${name}</div>
        <div class="card-price">${price}</div>
        ${desc}
      </div>
      <div class="card-cta">Order this</div>
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
      ${groups || '<p class="muted">No options available.</p>'}
      <button class="btn btn-ghost" data-action="back">Back</button>
      <button class="btn btn-yes" data-action="confirmOptions">Continue</button>
    </div>`;
}

function fulfillmentBody(item, orderState, total) {
  const current = orderState?.fulfillment;
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "Selected item")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">You can say "take out" or tap one.</p>
      <div class="choice-grid two">
        <button class="tile ${current === "Dine In" ? "selected" : ""}" data-action="setFulfillment" data-value="Dine In">
          <strong>Dine In</strong><span>Eat at the store</span>
        </button>
        <button class="tile ${current === "Take Out" ? "selected" : ""}" data-action="setFulfillment" data-value="Take Out">
          <strong>Take Out</strong><span>Pack to go</span>
        </button>
      </div>
      <button class="btn btn-ghost" data-action="back">Back</button>
    </div>`;
}

function loyaltyBody(item, orderState, total) {
  const current = orderState?.loyalty;
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "Selected item")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">You can say "skip points", "coupon", or "earn points".</p>
      <div class="choice-grid">
        <button class="tile ${current === "scan" ? "selected" : ""}" data-action="setLoyalty" data-value="scan">
          <strong>App Coupon</strong><span>Scan QR code</span>
        </button>
        <button class="tile ${current === "phone" ? "selected" : ""}" data-action="setLoyalty" data-value="phone">
          <strong>Earn Points</strong><span>Use phone number</span>
        </button>
        <button class="tile ${current === "none" ? "selected" : ""}" data-action="setLoyalty" data-value="none">
          <strong>Skip</strong><span>No coupon or points</span>
        </button>
      </div>
      <button class="btn btn-ghost" data-action="back">Back</button>
    </div>`;
}

function paymentBody(item, orderState, total) {
  const current = orderState?.payment_method;
  const methods = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"];
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "Selected item")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">You can say "card", "Kakao Pay", or tap one. Payment happens on the next screen.</p>
      <div class="choice-grid">
        ${methods.map((method) => `<button class="tile ${current === method ? "selected" : ""}" data-action="setPayment" data-value="${esc(method)}">
          <strong>${esc(method)}</strong><span>${method === "Credit Card" ? "Tap or insert card" : "Use selected payment"}</span>
        </button>`).join("")}
      </div>
      <button class="btn btn-ghost" data-action="back">Back</button>
    </div>`;
}

/** 확인(예/아니요) 화면 본문. */
function confirmBody(item, selectedOptions, total, orderState, t) {
  const opts = Object.entries(selectedOptions ?? {})
    .map(([k, v]) => `<li><b>${esc(k)}</b> · ${esc(v)}</li>`)
    .join("");
  const loyalty =
    orderState?.loyalty === "none" ? "No points" : orderState?.loyalty === "scan" ? "App coupon" : orderState?.loyalty === "phone" ? "Earn points" : "Points not selected";
  return `<div class="confirm-wrap">
      <div class="confirm-item">${esc(item.name)}</div>
      <ul class="confirm-opts">${opts || "<li>No options</li>"}</ul>
      <div class="state-pills">
        <span>${esc(orderState?.fulfillment ?? "Place not selected")}</span>
        <span>${esc(loyalty)}</span>
        <span>${esc(orderState?.payment_method ?? "Payment not selected")}</span>
      </div>
      <div class="confirm-total">Total <b>${won(total ?? item.price)}</b></div>
      <div class="yesno">
        <button class="btn btn-yes" data-action="confirmYes">Yes, Pay</button>
        <button class="btn btn-no" data-action="confirmNo">No, choose again</button>
      </div>
    </div>`;
}

/**
 * 적응형 HTML 문서 한 장을 만든다.
 * @param {object} args
 * @param {"recommend"|"options"|"fulfillment"|"loyalty"|"payment"|"confirm"} args.step
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
  const mode =
    profile.effective_level >= 2
      ? "guided"
      : profile.effective_level === 1
      ? "comfort"
      : "express";
  const modeLabel =
    mode === "guided"
      ? "Guided senior mode"
      : mode === "comfort"
      ? "Comfort mode"
      : "Express mode";

  let body = "";
  if (step === "options" && args.item) {
    body = optionsBody(args.item, args.item.options ?? [], t);
  } else if (step === "fulfillment" && args.item) {
    body = fulfillmentBody(args.item, args.orderState, args.total);
  } else if (step === "loyalty" && args.item) {
    body = loyaltyBody(args.item, args.orderState, args.total);
  } else if (step === "payment" && args.item) {
    body = paymentBody(args.item, args.orderState, args.total);
  } else if (step === "confirm" && args.item) {
    body = confirmBody(args.item, args.selectedOptions, args.total, args.orderState, t);
  } else {
    const cards = candidates
      .slice(0, t.card_count)
      .map((it, index) => cardHtml(it, t, t.show_desc, index))
      .join("");
    body = `<div class="cards cards--${t.card_count}">${cards}</div>`;
  }

  const voice = t.voice_guide ? copy.voice : "";
  const gridCols = step === "recommend" ? (t.card_count >= 3 ? 3 : 2) : 1;
  const steps = [
    ["recommend", "1. Pick"],
    ["options", "2. Options"],
    ["fulfillment", "3. Place"],
    ["loyalty", "4. Points"],
    ["payment", "5. Pay"],
    ["confirm", "6. Review"],
  ];

  // 인라인 CSS: assist_level 토큰을 CSS 변수로 주입 → 글자·여백 적응.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>Adaptive UI · ${esc(step)} · L${profile.assist_level}</title>
<style>
  :root{
    --base:${t.base_font_px}px;
    --title:${t.title_font_px}px;
    --pad:${t.card_pad_px}px;
    --gap:${t.gap_px}px;
    --cols:${gridCols};
    --fg:#17201d; --muted:#66706c; --bg:#f3f6f0;
    --brand:#096b4f; --accent:#d7b46a; --yes:#138a4a; --no:#be3830; --card:#fffef8; --line:#d9e0d5;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);
    font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    font-size:var(--base);line-height:1.45;-webkit-text-size-adjust:100%;}
  body{background:
    linear-gradient(135deg, rgba(9,107,79,.10), transparent 32%),
    linear-gradient(0deg, rgba(215,180,106,.12) 0 1px, transparent 1px 100%),
    var(--bg);}
  .wrap{max-width:1120px;margin:0 auto;padding:var(--pad);}
  .stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(220px,320px);gap:var(--gap);align-items:start;}
  .age-mode-express .stage{grid-template-columns:1fr;}
  @media(max-width:780px){.stage{grid-template-columns:1fr;}}
  header.kiosk{padding:calc(var(--pad) * .7) 0 var(--gap);}
  .badge{display:inline-block;font-size:.68em;color:#f8fff9;background:#17352b;
    border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:.28em .85em;margin-bottom:.7em;font-weight:900;}
  h1.title{font-size:var(--title);margin:.08em 0 .18em;font-weight:950;letter-spacing:0;line-height:1;}
  p.subtitle{font-size:calc(var(--base) * 1.02);color:var(--muted);margin:.2em 0 0;max-width:760px;}
  .steps{display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin:0 0 var(--gap);}
  @media(max-width:760px){.steps{grid-template-columns:repeat(3,1fr);}}
  .step{border:1px solid var(--line);background:rgba(255,255,255,.7);padding:.55em .7em;border-radius:12px;font-size:.72em;font-weight:900;color:var(--muted);}
  .step.active{background:#17352b;color:white;border-color:#17352b;}
  .coach{position:sticky;top:var(--gap);background:#17352b;color:white;border-radius:18px;padding:calc(var(--pad) * .8);box-shadow:0 18px 40px rgba(23,53,43,.18);}
  .coach-label{font-size:.65em;text-transform:uppercase;font-weight:950;color:#f3d891;margin-bottom:.55em;}
  .coach-main{font-size:calc(var(--base) * .95);font-weight:900;line-height:1.25;}
  .coach-sub{margin-top:.75em;color:#dce9e2;font-size:.72em;line-height:1.35;}
  .cards{display:grid;gap:var(--gap);grid-template-columns:repeat(var(--cols),1fr);margin-top:var(--gap);}
  @media(max-width:640px){.cards{grid-template-columns:1fr;}}
  .card{appearance:none;text-align:left;cursor:pointer;background:var(--card);
    border:2px solid var(--line);border-radius:18px;padding:var(--pad);
    display:flex;flex-direction:column;gap:.65em;transition:.12s;min-height:220px;box-shadow:0 8px 0 rgba(23,32,29,.08);}
  .age-mode-guided .card-primary{border-color:#17352b;box-shadow:0 0 0 5px rgba(9,107,79,.10),0 14px 0 rgba(23,32,29,.10);}
  .card:hover,.card:focus{border-color:var(--brand);box-shadow:0 12px 28px rgba(9,107,79,.18);outline:none;transform:translateY(-2px);}
  .rank{align-self:flex-start;border:1px solid var(--accent);background:#fff5d8;color:#5c4300;border-radius:999px;padding:.25em .65em;font-size:.65em;font-weight:950;}
  .media{display:grid;}
  .thumb{width:100%;height:clamp(112px,18vw,180px);border-radius:12px;background:#e9efe7 center/cover no-repeat;
    display:flex;align-items:center;justify-content:center;font-size:.75em;letter-spacing:.12em;font-weight:950;color:#617269;}
  .card-name{font-size:calc(var(--base) * 1.18);font-weight:950;line-height:1.08;}
  .card-price{font-size:calc(var(--base) * 1.05);color:var(--brand);font-weight:800;}
  .desc{font-size:.9em;color:var(--muted);margin:.2em 0 0;}
  .card-cta{margin-top:auto;align-self:stretch;text-align:center;background:var(--brand);color:#fff;
    border-radius:12px;padding:.62em 1em;font-weight:950;font-size:calc(var(--base) * .95);}
  .yesno{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap);margin-top:var(--gap);}
  @media(max-width:520px){.yesno{grid-template-columns:1fr;}}
  .btn{appearance:none;cursor:pointer;border:none;border-radius:18px;
    padding:calc(var(--pad) * .9) var(--pad);font-size:calc(var(--base) * 1.2);font-weight:800;color:#fff;}
  .btn-yes{background:var(--yes);} .btn-no{background:var(--no);}
  .btn-ghost{background:#eef1f6;color:var(--fg);margin-top:var(--gap);}
  .opt-wrap,.confirm-wrap,.choice-wrap{margin-top:var(--gap);display:flex;flex-direction:column;gap:var(--gap);}
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
  .choice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:var(--gap);}
  .choice-grid.two{grid-template-columns:repeat(2,minmax(0,1fr));}
  @media(max-width:620px){.choice-grid.two{grid-template-columns:1fr;}}
  .tile{appearance:none;cursor:pointer;text-align:left;background:var(--card);border:2px solid var(--line);border-radius:18px;
    padding:var(--pad);min-height:130px;display:grid;align-content:center;gap:.45em;color:var(--fg);}
  .tile strong{font-size:calc(var(--base) * 1.15);line-height:1.05;}
  .tile span{color:var(--muted);font-weight:800;font-size:.82em;}
  .tile:hover,.tile:focus,.tile.selected{border-color:var(--brand);background:#e3f7f0;outline:none;}
  .voice-hint{color:var(--muted);font-weight:850;margin:0;}
  .state-pills{display:flex;flex-wrap:wrap;gap:.45em;}
  .state-pills span{border:1px solid var(--line);border-radius:999px;background:#fff;padding:.38em .75em;color:var(--muted);font-weight:850;font-size:.78em;}
  .muted{color:var(--muted);}
  .voicebar{margin:0 0 var(--gap);display:flex;align-items:center;gap:.6em;
    background:#fff7e6;border:1px solid #f0d27a;border-radius:14px;padding:.7em 1em;font-size:.9em;}
  .voicebar button{appearance:none;cursor:pointer;border:1px solid #e0b94a;background:#fff;border-radius:10px;padding:.4em .9em;font-weight:800;}
</style>
</head>
<body class="age-mode-${mode}">
  <div class="wrap">
    <header class="kiosk">
      <span class="badge">${modeLabel} · L${profile.assist_level} · age ${esc(
    profile.age_group
  )}</span>
      <h1 class="title">${esc(copy.title)}</h1>
      <p class="subtitle">${esc(copy.subtitle)}</p>
    </header>
    <div class="steps">
      ${steps.map(([key, label]) => `<div class="step ${step === key ? "active" : ""}">${label}</div>`).join("")}
    </div>
    ${
      voice
        ? `<div class="voicebar"><span id="voiceText">${esc(
            voice
          )}</span> <button id="voiceReplay" data-action="repeat">Replay</button></div>`
        : ""
    }
    <div class="stage">
      <main>${body}</main>
      ${
        mode !== "express"
          ? `<aside class="coach"><div class="coach-label">Voice assistant</div><div class="coach-main">${esc(
              copy.voice
            )}</div><div class="coach-sub">Fewer choices, larger touch targets, and one clear next action.</div></aside>`
          : ""
      }
    </div>
  </div>
<script>
(function(){
  var VOICE = ${JSON.stringify(voice)};
  var ANALYZE_URL = ${JSON.stringify(process.env.VITE_ANALYZE_URL || process.env.ANALYZE_URL || "http://localhost:8000")};
  var currentAudio = null;
  var currentUrl = null;
  function cleanupAudio(){
    try{ if(currentAudio) currentAudio.pause(); }catch(e){}
    try{ if(currentUrl) URL.revokeObjectURL(currentUrl); }catch(e){}
    currentAudio = null;
    currentUrl = null;
  }
  function browserSpeak(text){
    try{
      if(!text || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US"; u.rate = 1.0; u.pitch = 1.05;
      var voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      var preferred = ["samantha","ava","allison","karen","google us english","microsoft aria","microsoft jenny"];
      var english = voices.filter(function(v){ return (v.lang || "").toLowerCase().indexOf("en") === 0; });
      var picked = english.find(function(v){
        var n = (v.name || "").toLowerCase();
        return preferred.some(function(p){ return n.indexOf(p) >= 0; });
      }) || english.find(function(v){ return (v.lang || "").toLowerCase().indexOf("en-us") === 0; }) || english[0];
      if(picked) u.voice = picked;
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  function speak(text){
    try{
      if(!text) return;
      cleanupAudio();
      if("speechSynthesis" in window) window.speechSynthesis.cancel();
      fetch(ANALYZE_URL + "/demo/announcer-voice/audio", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ text:text })
      })
        .then(function(res){ if(!res.ok) throw new Error("tts"); return res.blob(); })
        .then(function(blob){
          if(!blob || !blob.size) throw new Error("empty");
          currentUrl = URL.createObjectURL(blob);
          currentAudio = new Audio(currentUrl);
          currentAudio.onended = cleanupAudio;
          currentAudio.onerror = cleanupAudio;
          return currentAudio.play();
        })
        .catch(function(){ browserSpeak(text); });
    }catch(e){ browserSpeak(text); }
  }
  // Adaptive voice guidance: play once on entry when the browser allows it.
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
    if(action === "setFulfillment"){ emit("setFulfillment", { value: el.getAttribute("data-value") }); return; }
    if(action === "setLoyalty"){ emit("setLoyalty", { value: el.getAttribute("data-value") }); return; }
    if(action === "setPayment"){ emit("setPayment", { value: el.getAttribute("data-value") }); return; }
    if(action === "back"){ emit("back", {}); return; }
    if(action === "confirmOptions"){ emit("confirmOptions", {}); return; }
    if(action === "confirmYes"){ emit("confirmYes", {}); return; }
    if(action === "confirmNo"){ emit("confirmNo", {}); return; }
    emit(action, {});
  });
})();
</script>
</body>
</html>`;
}
