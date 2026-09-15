// The printed Transaction Register.
//
// [2026-09-15] The register on the same 210 × 140 mm continuous form as the
// receipts, running to as many forms as the transactions need. Sampled and
// approved on 14/09; this is that sample built into the app.
//
// It is written into a NEW WINDOW rather than into the app's own document, on
// purpose. index.css carries a global `@page { size: 210mm 140mm; margin: 0 }`
// tuned for the dot-matrix printer, and every other print path in the app
// depends on it. A print window owns its own document and its own @page, so
// the register can set whatever it needs without a screen elsewhere quietly
// changing shape.
//
// ── The one rule this file exists to enforce ──────────────────────────────
//
// A ROW IS NEVER CUT ACROSS A TEAR, AND A ROW IS NEVER DROPPED TO MAKE SPACE.
//
// The paginator does not know how many rows fit on a form and never assumes.
// It appends one row, asks the browser whether the footer is still above the
// form's bottom edge, and if it is not, takes that row back off and starts the
// next form with it. Three bugs in the sample all came from measuring
// something other than what prints, and the fixes are kept here with the
// reasons attached:
//
//   1. `.rows { flex: 1 1 auto }` let the table overflow INSIDE its own box
//      and draw straight over the carried-forward line without ever changing
//      the pad's scrollHeight. The form looked full, measured empty, and
//      sliced row 45 in half. It is `flex: 0 0 auto` now, and the fit test
//      asks about the FOOTER's bottom edge, which nothing can overflow past
//      unnoticed.
//
//   2. The carried-forward text was written AFTER the fill was measured, then
//      grew when the real sentence went in and pushed the footer off the page.
//      It is written DURING the fill now — what is measured is what prints.
//
//   3. The page-number `<b>` was empty while measuring and filled with
//      "Form 1 of 14" afterwards, 0.8px taller. It carries a `Form 00 of 00`
//      placeholder now.
//
// And the totals: they are appended and measured like any other row. If they
// do not fit they are taken back off and given a form of their own. What must
// NEVER happen is deleting a data row to make space — a register that quietly
// prints 244 of 247 transactions and still says TOTAL is worse than one that
// runs to an extra form.

const KG = (n) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
const R = (n) => new Intl.NumberFormat("en-US").format(Math.round(Number(n) || 0));
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The 12 columns, by share of the printable width.
// [2026-09-15] Re-cut after the first real render: the date column was
// ellipsising to "2026…" and Owing to "1,41…". A money column that silently
// truncates is worse than a narrow one — the reader cannot tell 1,415,000 from
// 1,410,000. Amount, Paid and Owing are now sized for a nine-figure riel
// number, and the width comes out of Date (which prints DD/MM, not the full
// ISO date) and Party.
const COLS = `<colgroup>
  <col style="width:3.8%"><col style="width:8.6%"><col style="width:5.2%"><col style="width:5%">
  <col style="width:13.2%">
  <col style="width:9.3%"><col style="width:9.3%"><col style="width:9.3%">
  <col style="width:5.6%"><col style="width:10.8%"><col style="width:10.3%"><col style="width:9.6%">
</colgroup>`;

// tx_date is stored as YYYY-MM-DD. Printed in full it does not fit the column
// and gets ellipsised, so it prints DD/MM — the period is already named in
// full on the letterhead and on every running header.
const shortDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}` : String(iso || "");
};

const STYLE = `
  @page { size: 210mm 140mm; margin: 0; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  body{
    background:#E7E9E5; color:#111;
    font:14px/1.55 "Noto Sans Khmer", "Khmer OS", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding-bottom:40px;
  }
  .bar{
    position:sticky; top:0; z-index:9; display:flex; align-items:center; gap:10px;
    background:#123B27; color:#fff; padding:10px 16px; font-size:13px; font-weight:600;
  }
  .bar button{
    font:inherit; font-size:13px; font-weight:700; padding:6px 16px; cursor:pointer;
    background:#fff; color:#123B27; border:0; border-radius:6px;
  }
  .bar .sp{ margin-left:auto; font-weight:500; opacity:.85; }

  .tear{ max-width:210mm; margin:0 auto; height:0; border-top:2px dashed #A9AFA9; position:relative; }
  .tear span{
    position:absolute; top:-9px; left:50%; transform:translateX(-50%);
    background:#E7E9E5; padding:0 10px; font-size:10.5px; font-weight:700;
    letter-spacing:.06em; text-transform:uppercase; color:#7A8079;
  }

  .form{
    position:relative; width:210mm; height:140mm; background:#fff; overflow:hidden;
    margin:0 auto; outline:1px solid #C9CCC9; box-shadow:0 8px 20px rgba(0,0,0,.10);
  }
  .pad{
    position:absolute; top:3mm; left:calc((210mm - var(--W)) / 2);
    width:var(--W); height:134mm; display:flex; flex-direction:column; color:#000; overflow:hidden;
  }

  .lh{ display:flex; align-items:center; gap:3mm; border-bottom:2px solid #000; padding-bottom:1mm; flex-shrink:0; }
  .lh-mid{ flex:1; min-width:0; }
  .lh-mid .co{ font-size:12.5px; font-weight:800; line-height:1.15; }
  .lh-mid .ad{ font-size:8.5px; font-weight:600; margin-top:.3mm; }
  .lh-right{ text-align:right; flex-shrink:0; font-size:8.5px; line-height:1.45; }
  .lh-right .doc{ font-size:9.5px; font-weight:800; letter-spacing:.5px; text-transform:uppercase;
    border:1.3px solid #000; border-radius:1mm; padding:.5mm 2mm; display:inline-block; margin-bottom:.6mm; }
  .meta{ display:flex; justify-content:space-between; gap:4mm; margin-top:1.2mm; font-size:9px; flex-shrink:0; }
  .meta b{ font-weight:800; }

  .run{ display:flex; justify-content:space-between; align-items:baseline;
    border-bottom:1.3px solid #000; padding-bottom:.8mm; font-size:9px; flex-shrink:0; }
  .run .t{ font-size:11px; font-weight:800; }
  .run b{ font-weight:800; }

  /* See note 1 at the top of this file — this must not grow. */
  .rows{ flex:0 0 auto; }
  table{ width:100%; border-collapse:collapse; table-layout:fixed; margin-top:1.4mm; }
  th{ font-size:var(--fsh); font-weight:800; text-transform:uppercase; letter-spacing:.35px;
    text-align:left; padding:.7mm .8mm; border-bottom:1.3px solid #000; }
  td{ font-size:var(--fs); padding:.62mm .8mm; border-bottom:.4px solid #9AA09A;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .n{ text-align:right; font-variant-numeric:tabular-nums; }
  .dash{ color:#6B7280; }
  tr.sub td{ border-top:1.3px solid #000; border-bottom:1.3px solid #000; font-weight:800; }
  /* [2026-09-15] Was 10.5px with 1.2mm padding and ellipsised the Owing
     total to "15,842,…". A truncated total is a wrong total. Same size as a
     data row now — the double rule is what marks it, not the type size. */
  tr.tot td{ border-top:2px solid #000; border-bottom:3px double #000; font-weight:800; font-size:var(--fs); padding:1.1mm .8mm; }

  .carry{ margin-top:1.4mm; border:1.3px solid #000; padding:.9mm 2mm; flex-shrink:0;
    display:flex; justify-content:space-between; align-items:center; font-size:9px; font-weight:800; }
  .carry.bf{ margin-top:1.2mm; margin-bottom:0; }
  .carry .v{ font-variant-numeric:tabular-nums; }

  /* Carry line and footer are ONE block pinned to the bottom, so the footer is
     always the last thing measured. See note 2. */
  .bottom{ margin-top:auto; flex-shrink:0; }
  .foot{ padding-top:1mm; border-top:.8px solid #000; flex-shrink:0;
    display:flex; justify-content:space-between; align-items:flex-end; font-size:8px; }
  .foot b{ font-weight:800; font-size:9px; }
  .sigs{ display:flex; gap:8mm; }
  .sig{ width:38mm; text-align:center; }
  .sig .line{ border-bottom:.8px solid #000; height:7mm; }
  .sig .who{ font-size:8px; margin-top:.6mm; }

  @media print{
    body{ background:#fff; padding:0; }
    .bar,.tear{ display:none !important; }
    .form{ outline:0; box-shadow:none; margin:0; break-after:page; page-break-after:always; }
    .form:last-of-type{ break-after:auto; page-break-after:auto; }
  }
`;

/**
 * Opens a print window and lays the register out on 210 × 140 mm forms.
 *
 * @param {object}   opts
 * @param {array}    opts.rows          the transactions to print, already filtered
 * @param {function} opts.t             the app's translate function
 * @param {object}   opts.meta          { company, address, phone, station, period, printedBy, printedAt }
 * @param {number}   opts.widthMm       printable width inside the 210 mm form
 * @param {number}   opts.rowsPerForm   0 = as many as fit; any other number is a CEILING
 * @returns {boolean} false if the browser blocked the window
 */
export function printRegister({ rows, t, meta, widthMm = 180, rowsPerForm = 0 }) {
  const win = window.open("", "_blank");
  if (!win) return false;

  // [2026-09-15] The table's type size SCALES with the printable width rather
  // than being fixed at 9.5px. At 160 mm the fixed size clipped the row number
  // past 99, the Type heading, and a ten-figure riel total — and a truncated
  // total is a wrong total. Scaling keeps all twelve columns legible at every
  // width the station's tractor-feed guides allow; the rows simply get a
  // little shorter or taller, and the paginator measures whatever results.
  const W = Number(widthMm) || 180;

  const TX = rows.map((r, idx) => {
    const isBuy = (r.type || "").toUpperCase() === "BUY";
    return {
      no: idx + 1,
      code: r.code || r.paper_ticket_no || "—",
      type: isBuy ? t("reg_buy") : t("reg_sell"),
      isBuy,
      date: shortDate(r.tx_date),
      party: r.partyName || "—",
      // The two readings off the scale, in the order they were taken. Which
      // one is the loaded truck depends on Buy or Sell, so both are shown
      // rather than one being assumed.
      weighIn: r.gross_kg,
      weighOut: r.tare_kg,
      kg: Number(r.quantity_kg) || 0,
      price: r.price_per_kg,
      amount: Number(r.total_with_tax ?? r.amount) || 0,
      paid: Number(r.paidAmount) || 0,
      owing: Number(r.owing) || 0,
    };
  });

  const HEAD = `<thead><tr>
    <th>${esc(t("reg_no"))}</th><th>${esc(t("reg_ticket"))}</th><th>${esc(t("reg_type"))}</th>
    <th>${esc(t("reg_date"))}</th><th>${esc(t("reg_party"))}</th>
    <th class="n">${esc(t("reg_weighin"))}</th><th class="n">${esc(t("reg_weighout"))}</th>
    <th class="n">${esc(t("reg_net"))}</th><th class="n">${esc(t("reg_price"))}</th>
    <th class="n">${esc(t("reg_amount"))} ៛</th><th class="n">${esc(t("reg_paid"))} ៛</th>
    <th class="n">${esc(t("reg_owing"))} ៛</th>
  </tr></thead>`;

  // A weight or a price nobody recorded prints as a dash, never as 0.00 —
  // the same rule the statements follow.
  const num = (v, f) => (v === null || v === undefined || v === "" ? `<span class="dash">—</span>` : f(v));

  const rowHTML = (x) => `<tr>
    <td>${x.no}</td><td>${esc(x.code)}</td><td>${esc(x.type)}</td><td>${esc(x.date)}</td><td>${esc(x.party)}</td>
    <td class="n">${num(x.weighIn, KG)}</td><td class="n">${num(x.weighOut, KG)}</td>
    <td class="n">${KG(x.kg)}</td><td class="n">${num(x.price, R)}</td>
    <td class="n">${R(x.amount)}</td>
    <td class="n${x.paid ? "" : " dash"}">${x.paid ? R(x.paid) : "—"}</td>
    <td class="n${x.owing ? "" : " dash"}">${x.owing ? R(x.owing) : "—"}</td>
  </tr>`;

  const M = meta || {};
  const letterhead = () => `
    <div class="lh">
      <div class="lh-mid">
        <div class="co">${esc(M.company || "PaddyTrade")}</div>
        <div class="ad">${esc([M.address, M.phone].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="lh-right">
        <div class="doc">${esc(t("reg_doc"))}</div><br>
        ${esc(t("reg_printed"))} <b>${esc(M.printedAt || "")}</b><br>${esc(t("reg_by"))} ${esc(M.printedBy || "")}
      </div>
    </div>
    <div class="meta">
      <span>${esc(t("st_station"))} <b>${esc(M.station || "")}</b></span>
      <span>${esc(t("reg_period"))} <b>${esc(M.period || "")}</b></span>
      <span>${esc(t("reg_alltypes"))}</span>
      <span><b>${TX.length}</b> ${esc(t("reg_txcount"))}</span>
    </div>`;

  // The row-range in the middle is written with a PLACEHOLDER of the same
  // shape, for the same reason the page number is (note 3 at the top): an
  // empty span here would be measured empty and then grow when the real
  // "rows 46 – 90" went in, pushing the footer off the bottom of the form.
  const running = () => `
    <div class="run">
      <span class="t">${esc(t("reg_doc"))} — ${esc(M.station || "")}</span>
      <span class="js-run">${esc(M.period || "")} · ${esc(t("reg_rows"))} <b>000 – 000</b></span>
      <span>${esc(t("reg_printed"))} <b>${esc(M.printedAt || "")}</b></span>
    </div>`;

  win.document.write(`<!doctype html><html lang="${document.documentElement.lang || "en"}"><head>
    <meta charset="utf-8">
    <title>${esc(t("reg_doc"))} — ${esc(M.station || "")}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;800&display=swap" rel="stylesheet">
    <style>${STYLE}</style></head>
    <body style="--W:${W}mm; --fs:${(9.5 * W / 180).toFixed(2)}px; --fsh:${(7.5 * W / 180).toFixed(2)}px">
      <div class="bar">
        <button onclick="window.print()">${esc(t("print_go"))}</button>
        <span class="sp js-status"></span>
      </div>
      <div id="forms"></div>
    </body></html>`);
  win.document.close();

  // The layout has to be measured in the new window's own document, with its
  // own fonts loaded — Khmer renders taller than Latin, and a form that fits 15
  // rows in English may only fit 14 in Khmer. Waiting on document.fonts is what
  // makes the measurement honest rather than optimistic.
  const start = () => {
    try {
      paginate(win, { TX, COLS, HEAD, rowHTML, letterhead, running, t, rowsPerForm, M });
    } catch (err) {
      win.document.querySelector(".js-status").textContent = String(err && err.message ? err.message : err);
    }
  };
  if (win.document.fonts && win.document.fonts.ready) {
    win.document.fonts.ready.then(start).catch(start);
  } else {
    win.setTimeout(start, 300);
  }
  return true;
}

function paginate(win, ctx) {
  const { TX, COLS, HEAD, rowHTML, letterhead, running, t, rowsPerForm, M } = ctx;
  const doc = win.document;
  const host = doc.getElementById("forms");
  host.innerHTML = "";

  if (TX.length === 0) {
    host.innerHTML = `<p style="text-align:center;padding:40px;font-size:13px;color:#5A6068">${t("print_nothing")}</p>`;
    return;
  }

  let i = 0, formNo = 0;
  let carriedKg = 0, carriedAmt = 0;
  const forms = [];

  while (i < TX.length) {
    formNo++;
    const first = formNo === 1;
    const startRow = i + 1;

    const form = doc.createElement("div");
    form.className = "form";
    form.innerHTML = `<div class="pad">
      ${first ? letterhead() : running()}
      ${first ? "" : `<div class="carry bf"><span>${t("reg_bf", { n: formNo - 1, c: i })}</span>
        <span class="v">${KG(carriedKg)} ${t("st_kg")} &nbsp;·&nbsp; ${R(carriedAmt)} ៛</span></div>`}
      <div class="rows"><table>${COLS}${HEAD}<tbody></tbody></table></div>
      <div class="bottom">
        <div class="carry js-carry"><span></span><span class="v"></span></div>
        <div class="foot"><div>${esc(M.company || "PaddyTrade")} · ${esc(t("reg_foot"))}</div><div><b>Form 00 of 00</b></div></div>
      </div>
    </div>`;
    host.appendChild(form);

    const pad = form.querySelector(".pad");
    const tbody = form.querySelector("tbody");
    const foot = form.querySelector(".foot");

    // The honest question: is the footer still above the form's bottom edge?
    // Nothing can overflow past it unnoticed. See note 1 at the top.
    const fits = () =>
      foot.getBoundingClientRect().bottom <= pad.getBoundingClientRect().bottom + 0.5;

    const carryEl = form.querySelector(".js-carry");
    const writeCarry = (n, kg, amt) => {
      carryEl.children[0].textContent = t("reg_cf", { n: formNo + 1, c: n });
      carryEl.children[1].textContent = `${KG(kg)} ${t("st_kg")}  ·  ${R(amt)} ៛`;
    };

    let placed = 0;
    while (i < TX.length) {
      // A fixed rows-per-form setting is a CEILING, never a promise: the
      // measurement below can still stop short of it when a long name wraps or
      // Khmer renders taller. Asking for 15 can give 14; it can never give 15
      // with the last one cut.
      if (rowsPerForm && placed >= rowsPerForm) break;

      const tr = doc.createElement("tr");
      tr.innerHTML = rowHTML(TX[i]).replace(/^<tr>|<\/tr>$/g, "");
      tbody.appendChild(tr);
      writeCarry(i + 1, carriedKg + TX[i].kg, carriedAmt + TX[i].amount);

      if (!fits()) {                    // it did not fit — put it back
        tbody.removeChild(tr);
        writeCarry(i, carriedKg, carriedAmt);
        break;
      }
      carriedKg += TX[i].kg; carriedAmt += TX[i].amount;
      placed++; i++;
    }

    // If not even one row fits, the layout is wrong — say so rather than loop
    // forever building empty forms.
    if (placed === 0) {
      carryEl.innerHTML = `<span style="color:#A33A1E">${t("reg_toonarrow")}</span><span></span>`;
      break;
    }

    forms.push({ form, pad, tbody, startRow, endRow: i, formNo, kg: carriedKg, amt: carriedAmt });
  }

  const total = forms.length;
  const setRun = (f, html) => {
    const run = f.form.querySelector(".js-run");
    if (run) run.innerHTML = html;
  };
  const renumber = (n) =>
    forms.forEach((x) => {
      const b = x.form.querySelector(".foot b");
      if (b) b.textContent = x.formNo === n ? t("reg_form_end", { n: x.formNo, t: n }) : t("reg_form", { n: x.formNo, t: n });
    });

  forms.forEach((f, idx) => {
    setRun(f, `${esc(M.period || "")} · ${esc(t("reg_rows"))} <b>${f.startRow} – ${f.endRow}</b>`);
    if (idx !== total - 1) return;

    // The last form carries the totals and the signatures instead of a carry.
    f.form.querySelector(".js-carry").remove();

    const agg = (a) => a.reduce((s, x) => ({ kg: s.kg + x.kg, amt: s.amt + x.amount, paid: s.paid + x.paid, ow: s.ow + x.owing }),
                                { kg: 0, amt: 0, paid: 0, ow: 0 });
    const buys = TX.filter((x) => x.isBuy), sells = TX.filter((x) => !x.isBuy);
    const b = agg(buys), s = agg(sells), all = agg(TX);

    // The label spans the five identifying columns; the two scale readings have
    // no meaningful sum and neither does a price, so those three print a dash.
    const sub = (label, g) => `<tr class="sub"><td colspan="5">${esc(label)}</td>
      <td class="n dash">—</td><td class="n dash">—</td><td class="n">${KG(g.kg)}</td><td class="n dash">—</td>
      <td class="n">${R(g.amt)}</td><td class="n">${R(g.paid)}</td><td class="n">${R(g.ow)}</td></tr>`;

    const extraHTML =
      sub(`${t("reg_buy")} · ${buys.length} ${t("reg_loads")}`, b) +
      sub(`${t("reg_sell")} · ${sells.length} ${t("reg_loads")}`, s) +
      `<tr class="tot"><td colspan="5">${esc(t("reg_total"))} · ${TX.length} ${esc(t("reg_txcount"))}</td>
         <td class="n dash">—</td><td class="n dash">—</td><td class="n">${KG(all.kg)}</td><td class="n dash">—</td>
         <td class="n">${R(all.amt)}</td><td class="n">${R(all.paid)}</td><td class="n">${R(all.ow)}</td></tr>`;

    const SIGS = `<div class="sigs">
      <div class="sig"><div class="line"></div><div class="who">${esc(t("reg_prepared"))}</div></div>
      <div class="sig"><div class="line"></div><div class="who">${esc(t("reg_checked"))}</div></div>
      <div class="sig"><div class="line"></div><div class="who">${esc(t("reg_approved"))}</div></div>
    </div>`;

    // Try the totals on this form, measured like any other row. If they do not
    // fit they come back off and get a form of their own — NEVER by deleting a
    // data row to make space.
    const tmp = doc.createElement("tbody");
    tmp.innerHTML = extraHTML;
    const totalRows = [...tmp.children];
    totalRows.forEach((tr) => f.tbody.appendChild(tr));

    const lastFoot = f.form.querySelector(".foot");
    const totalsFit = lastFoot.getBoundingClientRect().bottom <= f.pad.getBoundingClientRect().bottom + 0.5;

    if (!totalsFit) {
      totalRows.forEach((tr) => tr.remove());      // put them back, lose nothing

      const extraForm = doc.createElement("div");
      extraForm.className = "form";
      extraForm.innerHTML = `<div class="pad">
        ${running()}
        <div class="carry bf"><span>${t("reg_bf", { n: f.formNo, c: TX.length })}</span>
          <span class="v">${KG(all.kg)} ${t("st_kg")} &nbsp;·&nbsp; ${R(all.amt)} ៛</span></div>
        <div class="rows"><table>${COLS}${HEAD}<tbody></tbody></table></div>
        <div class="bottom"><div class="foot">${SIGS}<div><b>${t("reg_form_end", { n: total + 1, t: total + 1 })}</b></div></div></div>
      </div>`;
      extraForm.querySelector("tbody").innerHTML = extraHTML;
      extraForm.querySelector(".js-run").innerHTML = `${esc(M.period || "")} · <b>${esc(t("reg_totals_only"))}</b>`;

      const tear = doc.createElement("div");
      tear.className = "tear";
      tear.innerHTML = `<span>${esc(t("reg_tear"))}</span>`;
      f.form.after(tear);
      tear.after(extraForm);

      renumber(total + 1);
      f.form.querySelector(".foot b").textContent = t("reg_form", { n: f.formNo, t: total + 1 });
      return;
    }

    f.form.querySelector(".foot").innerHTML =
      `${SIGS}<div><b>${t("reg_form_end", { n: f.formNo, t: total })}</b></div>`;
  });

  // Page numbers last, once the form count is finally known.
  if (doc.querySelectorAll(".form").length === total) renumber(total);

  // Tear marks between the forms, so the screen preview matches the paper.
  [...doc.querySelectorAll(".form")].forEach((f, idx, a) => {
    if (idx === a.length - 1) return;
    if (f.nextElementSibling && f.nextElementSibling.classList.contains("tear")) return;
    const tear = doc.createElement("div");
    tear.className = "tear";
    tear.innerHTML = `<span>${esc(t("reg_tear"))}</span>`;
    f.after(tear);
  });

  const status = doc.querySelector(".js-status");
  if (status) status.textContent = `${TX.length} ${t("reg_txcount")} · ${doc.querySelectorAll(".form").length} ×  210 × 140 mm`;
}
