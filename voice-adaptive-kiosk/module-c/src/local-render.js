// src/local-render.js
//
// LOCAL_FALLBACK 경로: GGUI/OPENAI 미가동 시, 요청(transcript+menu_context)으로
// 적응형 HTML 을 직접 생성한다. 강도는 항상 고령자 최대(큰 글씨·넓은 여백·강한 음성안내·카드 2장)로 고정.
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
  const rank = index === 0 ? "가장 잘 맞아요" : index === 1 ? "두 번째 추천" : "다른 선택";
  const cardClass = index === 0 ? "card card-primary" : "card card-secondary";
  // 이미지가 상대경로(/img/..)면 깨질 수 있으니 플레이스홀더 폴백.
  const thumb = item.image_url
    ? `<div class="thumb" style="background-image:url('${esc(item.image_url)}')"></div>`
    : `<div class="thumb thumb--ph">메뉴</div>`;
  return `
    <button class="${cardClass}" data-action="selectMenu" data-item-id="${id}" aria-label="${name}, ${price}, 선택">
      <div class="rank">${rank}</div>
      <div class="media">${thumb}</div>
      <div class="card-body">
        <div class="card-name">${name}</div>
        <div class="card-price">${price}</div>
        ${desc}
      </div>
      <div class="card-cta">주문하기</div>
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
      <button class="btn btn-ghost" data-action="back">뒤로</button>
      <button class="btn btn-yes" data-action="confirmOptions">계속</button>
    </div>`;
}

function fulfillmentBody(item, orderState, total) {
  const current = orderState?.fulfillment;
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "선택한 메뉴")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">"포장"이라고 말씀하시거나 하나를 눌러주세요.</p>
      <div class="choice-grid two">
        <button class="tile ${current === "Dine In" ? "selected" : ""}" data-action="setFulfillment" data-value="Dine In">
          <strong>매장</strong><span>매장에서 드세요</span>
        </button>
        <button class="tile ${current === "Take Out" ? "selected" : ""}" data-action="setFulfillment" data-value="Take Out">
          <strong>포장</strong><span>포장해서 가져가세요</span>
        </button>
      </div>
      <button class="btn btn-ghost" data-action="back">뒤로</button>
    </div>`;
}

function loyaltyBody(item, orderState, total) {
  const current = orderState?.loyalty;
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "선택한 메뉴")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">"적립 안 함", "쿠폰", "포인트 적립"이라고 말씀하실 수 있어요.</p>
      <div class="choice-grid">
        <button class="tile ${current === "scan" ? "selected" : ""}" data-action="setLoyalty" data-value="scan">
          <strong>앱 쿠폰</strong><span>QR 코드 찍기</span>
        </button>
        <button class="tile ${current === "phone" ? "selected" : ""}" data-action="setLoyalty" data-value="phone">
          <strong>포인트 적립</strong><span>전화번호 사용</span>
        </button>
        <button class="tile ${current === "none" ? "selected" : ""}" data-action="setLoyalty" data-value="none">
          <strong>건너뛰기</strong><span>쿠폰·포인트 없이</span>
        </button>
      </div>
      <button class="btn btn-ghost" data-action="back">뒤로</button>
    </div>`;
}

function paymentBody(item, orderState, total) {
  const current = orderState?.payment_method;
  const methods = ["Credit Card", "Gift Card", "Kakao Pay", "Naver Pay", "Pay at Counter"];
  // 결제수단 코드 값(계약 enum) → 한국어 표시 라벨.
  const methodLabel = {
    "Credit Card": "신용카드",
    "Gift Card": "상품권",
    "Kakao Pay": "카카오페이",
    "Naver Pay": "네이버페이",
    "Pay at Counter": "카운터 결제",
  };
  return `<div class="choice-wrap">
      <div class="confirm-item">${esc(item?.name ?? "선택한 메뉴")} · ${won(total ?? item?.price)}</div>
      <p class="voice-hint">"카드", "카카오페이"라고 말씀하시거나 하나를 눌러주세요. 결제는 다음 화면에서 진행됩니다.</p>
      <div class="choice-grid">
        ${methods.map((method) => `<button class="tile ${current === method ? "selected" : ""}" data-action="setPayment" data-value="${esc(method)}">
          <strong>${esc(methodLabel[method] ?? method)}</strong><span>${method === "Credit Card" ? "카드를 대거나 넣으세요" : "선택한 결제수단 사용"}</span>
        </button>`).join("")}
      </div>
      <button class="btn btn-ghost" data-action="back">뒤로</button>
    </div>`;
}

/** 확인(예/아니요) 화면 본문. */
function confirmBody(item, selectedOptions, total, orderState, t) {
  const opts = Object.entries(selectedOptions ?? {})
    .map(([k, v]) => `<li><b>${esc(k)}</b> · ${esc(v)}</li>`)
    .join("");
  const loyalty =
    orderState?.loyalty === "none" ? "포인트 없음" : orderState?.loyalty === "scan" ? "앱 쿠폰" : orderState?.loyalty === "phone" ? "포인트 적립" : "포인트 미선택";
  const fulfillmentLabel =
    orderState?.fulfillment === "Dine In" ? "매장" : orderState?.fulfillment === "Take Out" ? "포장" : "장소 미선택";
  const paymentLabelMap = {
    "Credit Card": "신용카드",
    "Gift Card": "상품권",
    "Kakao Pay": "카카오페이",
    "Naver Pay": "네이버페이",
    "Pay at Counter": "카운터 결제",
  };
  const paymentLabel = orderState?.payment_method ? (paymentLabelMap[orderState.payment_method] ?? orderState.payment_method) : "결제수단 미선택";
  return `<div class="confirm-wrap">
      <div class="confirm-item">${esc(item.name)}</div>
      <ul class="confirm-opts">${opts || "<li>옵션 없음</li>"}</ul>
      <div class="state-pills">
        <span>${esc(fulfillmentLabel)}</span>
        <span>${esc(loyalty)}</span>
        <span>${esc(paymentLabel)}</span>
      </div>
      <div class="confirm-total">합계 <b>${won(total ?? item.price)}</b></div>
      <div class="yesno">
        <button class="btn btn-yes" data-action="confirmYes">네, 결제할게요</button>
        <button class="btn btn-no" data-action="confirmNo">아니요, 다시 고를게요</button>
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
  // 강도는 항상 고령자 친화 최대로 고정.
  const mode = "guided";
  const modeLabel = "고령자 친화 모드";

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
    ["recommend", "1. 선택"],
    ["options", "2. 옵션"],
    ["fulfillment", "3. 장소"],
    ["loyalty", "4. 포인트"],
    ["payment", "5. 결제"],
    ["confirm", "6. 확인"],
  ];

  // 인라인 CSS: 고정 강도 토큰을 CSS 변수로 주입 → 큰 글씨·넓은 여백.
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
<title>적응형 UI · ${esc(step)}</title>
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
      <span class="badge">${modeLabel}</span>
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
          )}</span> <button id="voiceReplay" data-action="repeat">다시 듣기</button></div>`
        : ""
    }
    <div class="stage">
      <main>${body}</main>
      <aside class="coach"><div class="coach-label">음성 도우미</div><div class="coach-main">${esc(
        copy.voice
      )}</div><div class="coach-sub">선택지는 적게, 버튼은 크게, 다음 행동은 하나만.</div></aside>
    </div>
  </div>
<script>
(function(){
  var VOICE = ${JSON.stringify(voice)};
  // 음성 안내: 브라우저 한국어 speechSynthesis 로 읽어준다(ko-KR).
  function speak(text){
    try{
      if(!text || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR"; u.rate = 1.0; u.pitch = 1.05;
      var voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      var korean = voices.filter(function(v){ return (v.lang || "").toLowerCase().indexOf("ko") === 0; });
      var picked = korean[0];
      if(picked) u.voice = picked;
      window.speechSynthesis.speak(u);
    }catch(e){}
  }
  // 적응형 음성 안내: 진입 시 브라우저가 허용하면 한 번 재생.
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
