// src/ui/StaticKiosk.tsx
//
// 일반 키오스크 UI — 데모의 "before" + GGUI 실패 시 폴백.
// 평범하지만 동작하는 주문 UI: 카테고리 탭 + 빽빽한 메뉴 그리드 + 옵션 모달 없이
// 간단 선택 → 주문. assist 적응 없음(의도적으로 작은 글씨/조밀).
//
// Module B 의 /menu 데이터를 그대로 그린다(mock 모드면 contracts/mocks 의 sampleMenu).

import { useEffect, useMemo, useState } from "react";
import type { Menu, MenuItem } from "@contracts/types";
import { getMenu, createOrder } from "../api/client";
import { emojiFor, won } from "./emoji";

type Phase = "browse" | "options" | "paying" | "done";

export default function StaticKiosk() {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [cat, setCat] = useState<string>("All");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("browse");
  const [orderNo, setOrderNo] = useState<string>("");
  const [total, setTotal] = useState<number>(0);

  useEffect(() => {
    getMenu().then(setMenu).catch(() => setMenu(null));
  }, []);

  const items = useMemo(() => {
    if (!menu) return [];
    return cat === "All"
      ? menu.items
      : menu.items.filter((i) => i.category === cat);
  }, [menu, cat]);

  function pick(item: MenuItem) {
    const defaults: Record<string, string> = {};
    for (const o of item.options) defaults[o.type] = o.choices[0]?.label ?? "";
    setSelected(item);
    setOptions(defaults);
    setPhase("options");
  }

  function unitTotal(item: MenuItem, opts: Record<string, string>): number {
    let p = item.price;
    for (const [type, label] of Object.entries(opts)) {
      const opt = item.options.find((o) => o.type === type);
      const ch = opt?.choices.find((c) => c.label === label);
      if (ch) p += ch.price_delta;
    }
    return p;
  }

  async function pay() {
    if (!selected) return;
    setPhase("paying");
    const res = await createOrder({
      items: [{ item_id: selected.id, options, qty: 1 }],
    });
    setOrderNo(res.order_id);
    setTotal(res.total);
    setPhase("done");
  }

  function restart() {
    setSelected(null);
    setOptions({});
    setPhase("browse");
  }

  if (!menu) {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">Loading menu...</div>
      </div>
    );
  }

  if (phase === "paying") {
    return (
      <div className="overlay">
        <div className="spinner" />
        <div className="big">Processing payment...</div>
        <p className="hint">Please wait a moment.</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="overlay">
        <div className="done-check">✅</div>
        <div className="big">Payment Complete</div>
        <p className="hint">
          Order <b>{orderNo}</b> · Total {won(total)}
        </p>
        <button className="btn-primary" onClick={restart}>
          Start Over
        </button>
      </div>
    );
  }

  if (phase === "options" && selected) {
    const cur = unitTotal(selected, options);
    return (
      <div>
        <h2 style={{ marginTop: 0 }}>
          {emojiFor(selected)} {selected.name}
        </h2>
        <p className="hint">{selected.desc}</p>

        {selected.options.length === 0 && (
          <p className="hint">No options to choose.</p>
        )}

        {selected.options.map((opt) => (
          <div className="option-group" key={opt.type}>
            <div className="o-label" style={{ fontSize: 15 }}>
              {opt.type}
            </div>
            <div className="choices">
              {opt.choices.map((c) => (
                <button
                  key={c.label}
                  className={
                    "choice" + (options[opt.type] === c.label ? " selected" : "")
                  }
                  style={{ fontSize: 15, padding: 12 }}
                  onClick={() =>
                    setOptions((s) => ({ ...s, [opt.type]: c.label }))
                  }
                >
                  {c.label}
                  {c.price_delta > 0 && <small>+{won(c.price_delta)}</small>}
                </button>
              ))}
            </div>
          </div>
        ))}

        <div className="confirm-box" style={{ borderWidth: 1 }}>
          <div className="c-total" style={{ fontSize: 18 }}>
            <span>Total</span>
            <span>{won(cur)}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button
            className="mic-btn secondary"
            onClick={() => setPhase("browse")}
          >
            ← Back to Menu
          </button>
          <button className="btn-primary" onClick={pay}>
            Order and Pay
          </button>
        </div>
      </div>
    );
  }

  // browse
  return (
    <div>
      <div className="cats">
        {["All", ...menu.categories].map((c) => (
          <button
            key={c}
            className={c === cat ? "active" : ""}
            onClick={() => setCat(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid">
        {items.map((it) => (
          <button className="menu-card" key={it.id} onClick={() => pick(it)}>
            <div className="thumb">{emojiFor(it)}</div>
            <div className="name">{it.name}</div>
            <div className="desc">{it.desc}</div>
            <div className="price">{won(it.price)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
