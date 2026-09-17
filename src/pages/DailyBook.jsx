// Reports → Daily Book. Read-only: every figure is computed from transactions,
// payments and stock counts already recorded, so nothing on this page can be
// typed or edited. Change a transaction and the day, its week, its month and
// the year all move together — see periodBook.js for why they cannot disagree.
//
// The four views are GRANULARITY, not a drill-down: "By day" is one row per
// trading day, "By week" one row per week, "By month" one row per month. A row
// at any grain opens what is inside it.

import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import LocationFilter from "../components/LocationFilter.jsx";
import Topbar from "../components/Topbar.jsx";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";
import { dayWithWeekday, range, my } from "../dateFormat.js";
import { buildDays, rollup, buildPeriods, isoWeek, cambodiaToday } from "../periodBook.js";
import { useRefetchSignal } from "../useRefetchSignal.js";

// [2026-09-16] These four were English labels sitting in a Khmer app —
// SISEN, on his phone: "so not clean and professional for the phone size".
// i18n keys now, like every other control.
const GRAINS = [
  ["days", "db_by_day"],
  ["weeks", "db_by_week"],
  ["months", "db_by_month"],
  ["year", "db_year_total"],
];

// [2026-09-16] The English month and weekday arrays that used to sit here are
// gone. Dates are digits now — 15/09/2026 — and the weekday is the only word,
// translated. See src/dateFormat.js.

// ---- formatting -----------------------------------------------------------
// Decimals sit in a lighter grey so the eye lands on the whole kilos.
function Kg({ v, dark }) {
  if (!v) return <span className={dark ? "text-brand-300" : "text-slate-200"}>—</span>;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const i = s.lastIndexOf(".");
  return <>{s.slice(0, i)}<span className={dark ? "text-brand-300" : "text-slate-300"}>{s.slice(i)}</span></>;
}
function Riel({ v, dark }) {
  if (!v) return <span className={dark ? "text-brand-300" : "text-slate-200"}>—</span>;
  return <>{Math.round(v).toLocaleString("en-US")}</>;
}
function Signed({ v, dark }) {
  if (!v) return <span className={dark ? "text-brand-300" : "text-slate-200"}>—</span>;
  return (
    <span className={dark ? "font-semibold text-white" : v >= 0 ? "font-semibold text-brand-700" : "font-semibold text-orange-700"}>
      {v >= 0 ? "+" : "−"} {Math.abs(Math.round(v)).toLocaleString("en-US")}
    </span>
  );
}

function labelFor(period, grain, t) {
  const days = `${period.days.length} ${t("db_trading_days")}`;
  if (grain === "days") {
    return { main: dayWithWeekday(period.key, t), sub: "" };
  }
  if (grain === "weeks") {
    const f = period.days[0], l = period.days[period.days.length - 1];
    return { main: range(f.date, l.date), sub: days };
  }
  if (grain === "months") return { main: my(period.key), sub: days };
  return { main: period.key, sub: days };
}

// ---- the row --------------------------------------------------------------
const TD = "border-b border-slate-50 px-3.5 py-3 text-right tabular-nums text-slate-600 whitespace-nowrap";
const BUY = "bg-brand-600/[0.03]";
const SELL = "bg-orange-600/[0.03]";
const STK = "bg-sky-700/[0.04]";

// [2026-09-16] The row's TOTALS object is `sums`.
//
// It was called `t`, which collided with the translator when this file
// was translated — a bulk pass put t("…") in here, which would have
// called the totals object as a function. I renamed it to `tot`, which
// was ALSO already taken: `const tot = variant === "total"` two lines
// below. That duplicate declaration failed the Vercel build, so nothing
// shipped that day until it was found. Hence `sums` — checked free.
function LedgerRow({ label, sub, sums, variant, onClick, onLoads, open, t }) {
  const tot = variant === "total";
  const D = tot;   // dark row — placeholders need a lighter grey to be seen
  const wk = variant === "week";
  const cls = (extra = "") =>
    `${TD} ${tot ? "!bg-brand-700 !text-white font-semibold !border-0" : wk ? "!bg-slate-50/70 font-semibold text-slate-900 border-t border-slate-200" : open ? "!bg-brand-50" : ""} ${tot ? "" : extra}`;

  const Loads = ({ n, title }) =>
    n ? (
      <span
        title={title}
        onClick={onLoads ? (e) => { e.stopPropagation(); onLoads(); } : undefined}
        className={tot || wk ? "font-semibold" :
          "inline-flex h-[22px] min-w-[24px] cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white px-1.5 text-[12.5px] font-semibold text-slate-900 hover:border-brand-300 hover:text-brand-700"}
      >{n}</span>
    ) : <span className="text-slate-200">—</span>;

  return (
    <tr onClick={onClick} className={onClick ? "cursor-pointer hover:[&>td]:bg-brand-50" : ""}>
      <td className={`${cls()} sticky left-0 z-[2] border-r border-slate-200 text-left ${tot ? "!border-r-brand-600" : wk ? "!bg-slate-50/70" : open ? "!bg-brand-50" : "bg-white"}`}>
        <span className="flex flex-col">
          <b className="text-[13px] font-semibold tracking-tight">{label}</b>
          {sub && <small className={`text-[10.5px] ${tot ? "text-brand-200" : "text-slate-400"}`}>{sub}</small>}
        </span>
      </td>

      <td className={`${cls(BUY)} text-center`}><Loads n={sums.buyLoads} title={`${sums.truck} ${t("db_truck")} · ${sums.koyun} ${t("db_koyun")} · ${sums.tractor} ${t("db_tractor")}${sums.otherVeh ? ` · ${sums.otherVeh} ${t("db_other_veh")}` : ""} — ${t("db_click_to_see")}`} /></td>
      <td className={cls(BUY)}><Kg v={sums.boughtKg} dark={D} /></td>
      <td className={cls(BUY)}>{sums.buyPricePerKg ? sums.buyPricePerKg.toFixed(2) : <span className={D ? "text-brand-300" : "text-slate-200"}>—</span>}</td>
      <td className={cls(BUY)}><Riel v={sums.spent} dark={D} /></td>

      <td className={`${cls(SELL)} text-center border-l border-slate-200`}><Loads n={sums.sellLoads} title={t("db_click_loads")} /></td>
      <td className={cls(SELL)}><Kg v={sums.soldKg} dark={D} /></td>
      <td className={cls(SELL)}><Riel v={sums.received} dark={D} /></td>

      <td className={`${cls()} border-l border-slate-200`}><Riel v={sums.commission} dark={D} /></td>
      <td className={cls()}><Riel v={sums.otherExp} dark={D} /></td>
      <td className={cls()}><Riel v={sums.expenses} dark={D} /></td>

      <td className={`${cls(STK)} border-l border-slate-200`}>{sums.lostKg ? <Signed v={sums.lostKg} /> : <span className={D ? "text-brand-300" : "text-slate-200"}>—</span>}</td>
      <td className={cls(STK)}>{sums.lostValue ? <Signed v={sums.lostValue} /> : <span className={D ? "text-brand-300" : "text-slate-200"}>—</span>}</td>
      <td className={cls(STK)}><Kg v={sums.closingKg} dark={D} /></td>
      <td className={cls(STK)}>{sums.costPerKg ? sums.costPerKg.toFixed(2) : <span className={D ? "text-brand-300" : "text-slate-200"}>—</span>}</td>
      <td className={cls(STK)}><Riel v={sums.closingValue} dark={D} /></td>

      <td className={`${cls()} border-l border-slate-200`}><Signed v={sums.profit} dark={D} /></td>
      <td className={cls()}><Signed v={sums.cash} dark={D} /></td>
    </tr>
  );
}

// ---- the same row, as a card ---------------------------------------------
//
// [2026-09-16] SISEN: "customize to fit different phone size to make it
// readable. especially for daily book", then on widths: "make sure it fit
// based on any size of the screen", then, choosing between three densities
// drawn against his own figures: "i prefer C".
//
// The ledger is SEVENTEEN columns — about 1,100px. On a 390pt phone that is
// a sideways scroller, and nobody scrolls a table sideways, so every column
// past "Bought kg" was never read by anyone. Not hidden; never looked at,
// which is worse, because the figures were there the whole time.
//
// WHY EACH MOVEMENT TAKES TWO LINES
//
// His real days are 447,525 kg at 957.74 — 428,612,593 ៛. Ten digits. There
// is no honest way to fit a load count, a weight, a price AND that on one
// phone line, so the count and the money share the top line and the weight
// × price sits under it in grey. My first attempt put all four on one line
// and only looked right because I had filled it with invented small numbers.
//
// NOTHING IS SIZED TO A PHONE MODEL
//
//   · No fixed widths. The card fills what it is given — a 320pt iPhone SE,
//     a folded Galaxy, a 717pt open one, a browser being dragged. A phone
//     that does not exist yet works too, because no width is written down.
//   · Exactly one element per line may shrink: the grey weight × price.
//     min-w-0 + truncate allows it. The load badge and the riel amount are
//     shrink-0 + nowrap, because losing a digit off money is the one
//     failure that would make the row LIE. What the grey line loses can be
//     read back off the two numbers around it.
//   · The closing strip re-flows itself — auto-fit at a 98px minimum. Three
//     across on a normal phone, two on a very narrow one, three again on a
//     Fold. No breakpoint decides that; the content does.
//
// md: and up this is not rendered at all — the table is untouched.
function LedgerCard({ label, sub, sums, variant, onClick, open, t }) {
  const tot = variant === "total";
  const wk = variant === "week";
  const money = (v) => Math.abs(Math.round(v || 0)).toLocaleString("en-US");
  const kg = (v) => (Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const signed = (v) => `${(v || 0) < 0 ? "−" : "+"}${money(v)}`;

  const Cell = ({ label: l, value, tone }) => (
    <div className={`min-w-0 px-2.5 py-1.5 ${tot ? "bg-brand-700" : tone === "stk" ? "bg-sky-50" : "bg-white"}`}>
      <p className={`truncate text-[9.5px] ${tot ? "text-brand-200" : "text-slate-400"}`}>{l}</p>
      <p className={`whitespace-nowrap text-[12.5px] font-bold tabular-nums ${
        tot ? "text-white" : tone === "stk" ? "text-sky-800" : "text-slate-700"}`}>{value}</p>
    </div>
  );

  // `n` null means no loads at all — a dash, never a zero, which would read
  // as a real figure someone had recorded.
  const Move = ({ kind, n, weight, price, amount }) => (
    <div className={`px-3 py-1.5 ${kind === "buy" ? "bg-brand-600/[0.045]" : "bg-orange-600/[0.05]"}`}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] font-bold ${
          kind === "buy" ? "bg-brand-100 text-brand-700" : "bg-orange-100 text-orange-700"}`}>
          {kind === "buy" ? t("db_buy") : t("db_sell")}
        </span>
        <span className="shrink-0 rounded-md border border-slate-200 bg-white px-1.5 text-[11.5px] font-bold tabular-nums text-slate-900">
          {n || "—"}
        </span>
        <span className="flex-1" />
        <span className={`shrink-0 whitespace-nowrap text-[13.5px] font-bold tabular-nums ${
          !n ? "text-slate-300" : kind === "buy" ? "text-brand-700" : "text-orange-700"}`}>
          {n ? money(amount) : "—"}
        </span>
      </div>
      <p className={`mt-px truncate text-[11.5px] tabular-nums ${n ? "text-slate-500" : "text-slate-300"}`}>
        {n ? <><b className="font-semibold text-slate-700">{kg(weight)}</b> {t("db_weight_kg")}{price ? ` × ${Number(price).toFixed(2)}` : ""}</> : t("db_no_loads")}
      </p>
    </div>
  );

  return (
    <div className={`border-b border-slate-100 last:border-0 ${
      open ? "shadow-[inset_3px_0_0_theme(colors.brand.600)]" : ""} ${
      tot ? "bg-brand-700" : wk ? "bg-slate-50" : "bg-white"}`}>
      <div
        onClick={onClick}
        className={`flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5 ${onClick ? "cursor-pointer" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {onClick && (
            <span className={`shrink-0 text-[11px] transition-transform ${open ? "rotate-90 text-brand-600" : "text-slate-400"}`}>›</span>
          )}
          <span className="min-w-0">
            <b className={`block whitespace-nowrap text-[14px] font-bold tracking-tight tabular-nums ${
              tot ? "text-white" : wk ? "text-[12.5px] text-slate-500" : "text-slate-900"}`}>{label}</b>
            {sub && <small className={`block truncate text-[10.5px] ${tot ? "text-brand-200" : "text-slate-400"}`}>{sub}</small>}
          </span>
        </div>
        {/* Profit leads. It is what the row exists to say, and the only
            figure here whose colour tells you anything. */}
        <span className="shrink-0 text-right">
          <i className={`block text-[9.5px] not-italic ${tot ? "text-brand-200" : "text-slate-400"}`}>{t("db_profit")}</i>
          <b className={`block whitespace-nowrap text-[15px] font-extrabold tracking-tight tabular-nums ${
            tot ? "text-white" : (sums.profit || 0) < 0 ? "text-rose-600" : "text-brand-700"}`}>
            {signed(sums.profit)} ៛
          </b>
        </span>
      </div>

      {/* Week and month rows are summaries with no single price, so the
          movement lines would print a meaningless average. Strip only. */}
      {!tot && !wk && (
        <>
          <Move kind="buy" n={sums.buyLoads} weight={sums.boughtKg} price={sums.buyPricePerKg} amount={sums.spent} />
          <Move kind="sell" n={sums.sellLoads} weight={sums.soldKg} price={sums.soldKg ? (sums.received / sums.soldKg) : 0} amount={sums.received} />
        </>
      )}

      <div
        className="grid gap-px border-t border-slate-100 bg-slate-100"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(98px, 1fr))" }}
      >
        {tot || wk ? (
          <>
            <Cell label={t("db_buy")} value={`${kg(sums.boughtKg)} ${t("db_weight_kg")}`} />
            <Cell label={t("db_sell")} value={`${kg(sums.soldKg)} ${t("db_weight_kg")}`} />
            <Cell label={t("db_cash")} value={signed(sums.cash)} />
          </>
        ) : (
          <>
            <Cell label={t("db_expenses")} value={money(sums.expenses)} />
            <Cell label={t("db_closing_kg")} value={`${kg(sums.closingKg)} ${t("db_weight_kg")}`} tone="stk" />
            <Cell label={t("db_cash")} value={signed(sums.cash)} />
          </>
        )}
      </div>
    </div>
  );
}

// ---- what opens when a date is pressed, on a phone ------------------------
//
// [2026-09-16] SISEN, on the full drawer: "pressing on each date, show too
// many data ... it doesnt need to show all transaction or anything."
//
// WHAT WAS REMOVED
//
// Every ticket. The buying list and the selling list, one row per load with
// the farmer's or buyer's name, the plate, the weight and the price. On a
// 154-load day that is 154 rows behind one date — and it is the most
// personal data in the system, travelling to a phone whose whole purpose is
// watching. Transactions was taken off this account's menu in September for
// exactly that reason; leaving the same names inside the Daily Book drawer
// put them back through a side door.
//
// WHAT IS LEFT, AND WHY
//
// Eleven lines answering the only two questions a day raises:
//
//   ឃ្លាំង            does the shed balance — what was there this morning,
//                     in, out, counted, what is there tonight. The five
//                     lines ADD UP, and when they do not, the warning above
//                     says so. This is the only place that can be checked.
//   ចំណេញមកពីណា     where the profit came from — sales, minus what that
//                     paddy cost, minus ថ្លៃកូនដៃ, minus other spending.
//                     Same figure as the card, with its working shown.
//   សាច់ប្រាក់        one line, because profit and cash are not the same
//                     thing and a day can be good at one, bad at the other.
function SimpleDay({ day, t }) {
  const money = (v) => Math.abs(Math.round(v || 0)).toLocaleString("en-US");
  const kg = (v) => (Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

  // min-w-0 + truncate on the label, shrink-0 + nowrap on the figure: a
  // label may lose its tail, a number never may.
  const Line = ({ label, value, tone, strong }) => (
    <div className={`flex items-baseline gap-2 border-t border-slate-50 px-3 py-1.5 text-[12.5px] first:border-t-0 ${
      strong === "sum" ? "!border-t-slate-200 bg-slate-50" : strong === "win" ? "bg-brand-700" : ""}`}>
      <span className={`min-w-0 flex-1 truncate ${
        strong === "win" ? "font-bold text-white" : strong === "sum" ? "font-bold text-slate-900" : "text-slate-500"}`}>{label}</span>
      <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${
        strong === "win" ? "font-extrabold text-white"
        : strong === "sum" ? "font-extrabold text-slate-900"
        : tone === "g" ? "text-brand-700" : tone === "r" ? "text-orange-700"
        : tone === "n" ? "font-medium text-slate-300" : "text-slate-700"}`}>{value}</span>
    </div>
  );

  const Block = ({ title, children }) => (
    <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white last:mb-0">
      <p className="border-b border-slate-100 px-3 pb-1 pt-1.5 text-[10px] font-extrabold tracking-wide text-brand-700">{title}</p>
      {children}
    </div>
  );

  return (
    <div className="border-t border-brand-100 bg-brand-50 px-2.5 pb-3 pt-2.5">
      {day.shortfallKg > 0 && (
        <div className="mb-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11.5px] leading-relaxed text-orange-900">
          <b className="block text-orange-800">{t("db_short_title", { kg: kg(day.shortfallKg) })}</b>
          {t("db_short_body", { rate: day.costPerKg ? day.costPerKg.toFixed(2) : "—" })}
        </div>
      )}

      <Block title={t("db_shed")}>
        <Line label={t("db_open_short")} value={`${kg(day.openingKg)} ${t("db_weight_kg")}`} />
        <Line label={`+ ${t("db_buy")}`} value={`+${kg(day.boughtKg)}`} tone="g" />
        <Line label={`− ${t("db_sell")}`} value={`−${kg(day.soldKg)}`} tone="r" />
        <Line label={t("db_counted_short")} value={day.lostKg ? `${day.lostKg < 0 ? "−" : "+"}${kg(Math.abs(day.lostKg))}` : "—"} tone={day.lostKg ? (day.lostKg < 0 ? "r" : "g") : "n"} />
        <Line label={t("db_tonight")} value={`${kg(day.closingKg)} ${t("db_weight_kg")}`} strong="sum" />
      </Block>

      <Block title={t("db_profit_from")}>
        <Line label={t("db_sales")} value={`+${money(day.received)}`} tone="g" />
        <Line label={t("db_cogs_short")} value={`−${money(day.cogs)}`} tone="r" />
        <Line label="ថ្លៃកូនដៃ" value={day.commission ? `−${money(day.commission)}` : "—"} tone={day.commission ? "r" : "n"} />
        <Line label={t("db_other_expenses")} value={day.otherExp ? `−${money(day.otherExp)}` : "—"} tone={day.otherExp ? "r" : "n"} />
        <Line label={t("db_stock_lost")} value={day.lostValue < 0 ? `−${money(-day.lostValue)}` : "—"} tone={day.lostValue < 0 ? "r" : "n"} />
        <Line label={t("db_profit")} value={`${day.profit >= 0 ? "+" : "−"}${money(day.profit)} ៛`} strong="win" />
        <Line label={t("db_cash_short")} value={`${day.cash >= 0 ? "+" : "−"}${money(day.cash)} ៛`} />
      </Block>
    </div>
  );
}

// ---- the day drawer -------------------------------------------------------
function DayDrawer({ day, txs, payments }) {
  const { t } = useLanguage();
  const dayTxs = txs.filter((tx) => tx.tx_date === day.date && (tx.hq_status || "processing") !== "cancelled");
  const buys = dayTxs.filter((t) => t.type === "BUY");
  const sells = dayTxs.filter((t) => t.type === "SELL");
  const exps = payments.filter((p) => p.type === "expense" && p.pay_date === day.date);
  const mix = [day.truck && `${day.truck} truck`, day.koyun && `${day.koyun} koyun`,
    day.tractor && `${day.tractor} tractor`, day.otherVeh && `${day.otherVeh} other`].filter(Boolean).join(" · ");

  // [2026-09-16] `w-40` on the money column was 160px of fixed width, which
  // on a 320pt phone left the label about 90px and pushed the row off the
  // side. Now min-w-0 + truncate on the label (the part you can afford to
  // lose — you know what line you are on) and shrink-0 + nowrap on both
  // figures, which you cannot. The money column only reserves its width
  // from sm: up, where there is room for the columns to line up.
  const Line = ({ label, a, b, tone }) => (
    <div className="flex items-center gap-2.5 border-b border-slate-50 px-4 py-2.5 text-[13px] last:border-0">
      <span className="min-w-0 flex-1 truncate text-slate-600">{label}</span>
      <span className={`shrink-0 whitespace-nowrap tabular-nums font-semibold ${tone === "g" ? "text-brand-700" : tone === "r" ? "text-orange-700" : "text-slate-900"}`}>{a}</span>
      {b !== undefined && <span className="shrink-0 whitespace-nowrap text-right tabular-nums font-semibold text-slate-900 sm:w-40">{b}</span>}
    </div>
  );
  const Mini = ({ title, children }) => (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <h5 className="border-b border-slate-100 bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-brand-700">{title}</h5>
      {children}
    </div>
  );
  const TicketTable = ({ rows, who }) => (
    <>
    {/* ---- tickets, on a phone ----
        Six columns — ticket, vehicle, name, kg, price, amount — do not fit
        on a phone, and the two that matter are the name and the amount. So
        those take the top line and the rest drops to a quieter second one.
        Nothing is dropped; it is reordered by what gets read first. */}
    <div className="md:hidden">
      {rows.map((tx) => (
        <div key={tx.id} className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-2.5 last:border-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-semibold text-slate-800">{tx.parties?.name || "—"}</span>
              <span className="shrink-0 whitespace-nowrap text-[13.5px] font-bold tabular-nums text-slate-900"><Riel v={Number(tx.amount) || 0} /></span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate tabular-nums text-slate-400">
                {tx.paper_ticket_no || tx.code || "—"}{tx.car_plate ? ` · ${tx.car_plate}` : ""}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums text-slate-500">
                <b className="font-semibold text-slate-700"><Kg v={Number(tx.quantity_kg) || 0} /></b> kg
                {Number(tx.price_per_kg) ? ` × ${Number(tx.price_per_kg).toFixed(2)}` : ""}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>

    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-[13px]">
        <thead><tr className="bg-slate-50/60">
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("db_ticket")}</th>
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("db_vehicle")}</th>
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">{who}</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("db_net_kg")}</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("db_price")}</th>
          <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">{t("db_amount_r")}</th>
        </tr></thead>
        <tbody>
          {rows.map((tx) => (
            <tr key={tx.id} className="hover:bg-slate-50/60">
              <td className="border-b border-slate-50 px-4 py-2.5 font-semibold text-slate-900">{tx.paper_ticket_no || tx.code || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{tx.car_plate || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-slate-600">{tx.parties?.name || "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums text-slate-600"><Kg v={Number(tx.quantity_kg) || 0} /></td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums text-slate-600">{Number(tx.price_per_kg) ? Number(tx.price_per_kg).toFixed(2) : "—"}</td>
              <td className="border-b border-slate-50 px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900"><Riel v={Number(tx.amount) || 0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );

  return (
    <div className="bg-brand-50 px-5 pb-5 pt-4">
      {day.shortfallKg > 0 && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-[13px] text-orange-900">
          <b>{day.shortfallKg.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg shipped that the books say was not in the shed.</b>{" "}
          It has been costed at {day.costPerKg ? day.costPerKg.toFixed(2) : "the prevailing rate"} so the profit is not overstated — but something is missing:
          a purchase not recorded, a weight mistyped, or a ticket entered at the wrong station.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Mini title={t("db_shed_moved")}>
          <Line label={t("db_opening")} a={<Kg v={day.openingKg} />} b={<><Riel v={day.openingValue} /> ៛</>} />
          <Line label={`+ Bought · ${day.buyLoads} loads`} a={<>+ <Kg v={day.boughtKg} /></>} b={<>+ <Riel v={day.spent} /> ៛</>} tone="g" />
          <Line label={`− Sold · ${day.sellLoads} loads at ${day.costPerKg ? day.costPerKg.toFixed(2) : "—"} cost`} a={<>− <Kg v={day.soldKg} /></>} b={<>− <Riel v={day.cogs} /> ៛</>} tone="r" />
          <Line label={`± Counted difference · ${day.counted ? "count taken" : "no count taken"}`}
            a={day.lostKg ? <Signed v={day.lostKg} /> : <span className="text-slate-300">—</span>}
            b={day.lostValue ? <Signed v={day.lostValue} /> : <span className="text-slate-300">—</span>} />
          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2.5 text-[13px]">
            <span className="flex-1 font-semibold text-slate-900">{t("db_overnight")}</span>
            <span className="tabular-nums font-semibold text-slate-900"><Kg v={day.closingKg} /> kg</span>
            <span className="w-40 text-right tabular-nums font-semibold text-slate-900"><Riel v={day.closingValue} /> ៛</span>
          </div>
        </Mini>

        <Mini title={t("db_profit_and_cash")}>
          <Line label={t("db_sales")} a={<>+ <Riel v={day.received} /> ៛</>} tone="g" />
          <Line label={t("db_cogs")} a={<>− <Riel v={day.cogs} /> ៛</>} tone="r" />
          <Line label="ថ្លៃកូនដៃ" a={day.commission ? <>− <Riel v={day.commission} /> ៛</> : "—"} tone={day.commission ? "r" : ""} />
          <Line label={t("db_other_expenses")} a={day.otherExp ? <>− <Riel v={day.otherExp} /> ៛</> : "—"} tone={day.otherExp ? "r" : ""} />
          <Line label={t("db_stock_lost")} a={day.lostValue < 0 ? <>− <Riel v={-day.lostValue} /> ៛</> : "—"} tone={day.lostValue < 0 ? "r" : ""} />
          <div className="flex items-center gap-3 bg-brand-700 px-4 py-2.5 text-[13px] text-white">
            <span className="flex-1 font-semibold">{t("db_profit")}</span>
            <span className="tabular-nums font-semibold">{day.profit >= 0 ? "+" : "−"} {Math.abs(Math.round(day.profit)).toLocaleString("en-US")} ៛</span>
          </div>
          <Line label={t("db_cash_line")} a={<>{day.cash >= 0 ? "+" : "−"} <Riel v={Math.abs(day.cash)} /> ៛</>} />
          <Line label={t("db_cash_diff")} a={<>{day.profit - day.cash >= 0 ? "+" : "−"} <Riel v={Math.abs(day.profit - day.cash)} /> ៛</>} />
        </Mini>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Mini title={`Buy — ${day.buyLoads} loads${mix ? ` · ${mix}` : ""}`}>
          {buys.length ? <TicketTable rows={buys} who="Seller" /> : <p className="px-4 py-5 text-[13px] text-slate-400">{t("db_nothing_bought")}</p>}
        </Mini>
        <Mini title={`Sell — ${day.sellLoads} loads`}>
          {sells.length ? <TicketTable rows={sells} who="Buyer" /> : <p className="px-4 py-5 text-[13px] text-slate-400">{t("db_nothing_sold")}</p>}
        </Mini>
      </div>

      {exps.length > 0 && (
        <div className="mt-4">
          <Mini title={`Expenses — ${exps.length} ${exps.length === 1 ? "entry" : "entries"}`}>
            {exps.map((p, i) => (
              <Line key={p.id || i} label={<><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{p.category || "Other"}</span>{p.memo || "—"}</>}
                a={<><Riel v={Number(p.amount) || 0} /> ៛</>} />
            ))}
          </Mini>
        </div>
      )}
    </div>
  );
}

// ---- the page -------------------------------------------------------------
export default function DailyBook() {
  const { t } = useLanguage();
  const { isViewOnly } = useAuth();
  const today = cambodiaToday();
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [grain, setGrain] = useState("days");
  const [month, setMonth] = useState(today.slice(0, 7));   // "" = whole year
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [raw, setRaw] = useState({ txs: [], payments: [], adjustments: [] });

  const year = today.slice(0, 4);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const locKey = selectedLocationIds.join(",");

  // [2026-09-16] `refetch` goes up when the app comes back to the foreground
  // after being away, or after the login had to be renewed. On a phone the
  // page is still the same page when it is reopened — nothing reloads and
  // nothing re-asks — which is how SISEN's parents ended up looking at
  // figures from hours earlier, or at zeros. See src/sessionWatch.js.
  const refetch = useRefetchSignal();
  useEffect(() => { api.getLocations().then(setLocations).catch(() => {}); }, [refetch]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    // One station is pushed into the query; several are filtered in the
    // browser, exactly as reportQuery.js does for every other report.
    const one = selectedLocationIds.length === 1 ? selectedLocationIds[0] : undefined;
    Promise.all([
      api.getTransactions({ locationId: one, from, to }),
      api.getPayments({ locationId: one, type: "expense", from, to }),
      api.getStockAdjustments({ locationId: one, startDate: from, endDate: to }),
    ])
      .then(([txs, payments, adjustments]) => { if (alive) setRaw({ txs, payments, adjustments }); })
      .catch((e) => { if (alive) setError(e.message || "Could not load the Daily Book."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [locKey, from, to, refetch]);

  const days = useMemo(
    () => buildDays({ ...raw, locationIds: selectedLocationIds }),
    [raw, locKey] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const scoped = useMemo(
    () => (month ? days.filter((d) => d.date.startsWith(month)) : days),
    [days, month]
  );
  // [2026-09-17] NEWEST FIRST. SISEN: "make the lastest date up instead" —
  // "for all devices not just pc".
  //
  // This page is opened to answer "how did today go", and today was at the
  // bottom of a month that is 30 rows and, on a phone, 30 cards deep. Every
  // single visit began with a scroll to the end.
  //
  // Reversing here rather than in buildPeriods() keeps that function pure and
  // ascending for everything else that reasons about it, and it is the ONE
  // array both layouts render — the phone's cards and the computer's table
  // both map over `periods`, so they cannot disagree about the order.
  //
  // The week subtotal still lands under its own days: the break is detected by
  // comparing each row with the NEXT one in display order, and in reversed
  // order the next row is the older day, so the boundary falls in exactly the
  // same place. Guarded in scripts-check-periodbook.mjs.
  const periods = useMemo(() => buildPeriods(scoped, grain).slice().reverse(), [scoped, grain]);
  const totals = useMemo(() => rollup(scoped), [scoped]);

  const months = useMemo(() => [...new Set(days.map((d) => d.date.slice(0, 7)))].sort(), [days]);

  const TH = "px-3.5 pb-2.5 text-right text-[10px] font-semibold text-slate-400 whitespace-nowrap";
  const GH = "px-3.5 pb-1.5 pt-2.5 text-center text-[9.5px] font-bold uppercase tracking-[0.14em]";

  // [2026-09-14] The page is a FIXED-HEIGHT column, not a tall document.
  //
  // It was `<main className="flex-1 overflow-y-auto …">` sitting directly
  // inside App.jsx's `<div className="flex bg-paper">` — which has no height
  // of its own. `overflow-y-auto` on a box with no bounded height does
  // nothing: the box simply grows to fit the table, so the whole window
  // scrolled instead, dragging the sidebar's bottom (Settings, Log out) off
  // the screen with it.
  //
  // Every other page in the app already does it this way — see Reports.jsx
  // and StockInventory.jsx: `h-screen … flex-col overflow-hidden` wrapper,
  // a Topbar and toolbar that stay put, and ONE scrolling `<main>` beneath
  // them. That is also what makes the table's own sticky header work, and
  // `main.overflow-y-auto` is the selector index.css uses to keep content
  // clear of the phone bottom nav, so the class has to stay on the <main>.
  return (
    <div className="flex h-screen min-w-0 flex-1 flex-col overflow-hidden">
      <Topbar
        title={t("db_title")}
        subtitle={t("db_subtitle")}
      />

      {/* [2026-09-16] On a phone this row was four things fighting for one
          line: a label, four grain buttons, another label, a month picker, a
          gold "read only" badge and the location filter. It wrapped into an
          untidy stack about a third of the screen tall before a single
          figure appeared.

          Below md the two small uppercase labels are dropped — the buttons
          say "By day / By week" and read perfectly well without a caption
          over them — the grain buttons take the full width as one bar of
          equal quarters, and the read-only badge moves out of the flow. On a
          computer the row is exactly as it was. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 md:px-6">
        <span className="hidden text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 md:inline">{t("db_show")}</span>
        <div className="flex w-full overflow-hidden rounded-lg border border-slate-200 bg-white md:w-auto">
          {GRAINS.map(([g, label]) => (
            <button key={g} onClick={() => { setGrain(g); setOpen(null); }}
              className={`flex-1 truncate border-r border-slate-200 px-2 py-1.5 text-[12.5px] last:border-r-0 md:flex-none md:px-3.5 md:text-[13px] ${
                grain === g ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-500 hover:bg-slate-50"}`}>
              {t(label)}
            </button>
          ))}
        </div>
        <span className="hidden text-[10.5px] font-semibold uppercase tracking-wide text-slate-400 md:ml-2 md:inline">{t("db_period")}</span>
        <select value={month} onChange={(e) => { setMonth(e.target.value); setOpen(null); }}
          disabled={grain === "year"}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] text-slate-700 disabled:opacity-50">
          <option value="">{t("db_whole_year", { year })}</option>
          {months.map((m) => <option key={m} value={m}>{my(m)}</option>)}
        </select>
        {/* Worth saying once, not worth a third of a phone screen. It stays
            on the row on a computer and drops below the controls on a
            phone, where it reads as a footnote rather than a control. */}
        <span className="order-last w-full rounded-md text-[10.5px] font-semibold text-gold-700 md:order-none md:w-auto md:bg-gold-50 md:px-2 md:py-0.5 md:ring-1 md:ring-gold-300">
          {t("db_auto_readonly")}
        </span>
        <div className="ml-auto">
          <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
        </div>
      </div>

      <main className="min-w-0 flex-1 overflow-y-auto bg-paper p-4 md:p-6">
        {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">{error}</div>}
        {loading && <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">{t("db_loading")}</div>}

        {!loading && !periods.length && (
          <div className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-[13px] text-slate-400">
            Nothing recorded for this period.
          </div>
        )}

        {!loading && periods.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* ---- the same ledger, on a phone ----
                Seventeen columns is about 1,100px. Below md every period is
                a card instead — see LedgerCard. The table is untouched. */}
            <div className="md:hidden">
              {periods.map((p, i) => {
                const { main, sub } = labelFor(p, grain, t);
                const isDay = grain === "days";
                const day = isDay ? p.days[0] : null;
                const isOpen = isDay && open === p.key;
                const nextP = periods[i + 1];
                const endsWeek = isDay && nextP && isoWeek(p.key).key !== isoWeek(nextP.key).key;
                const lastOfAll = isDay && !nextP;
                const weekDays = (endsWeek || lastOfAll)
                  ? scoped.filter((d) => isoWeek(d.date).key === isoWeek(p.key).key) : null;
                return (
                  <Fragment key={p.key}>
                    <LedgerCard
                      label={main} sub={sub} sums={p.totals} t={t} open={isOpen}
                      onClick={isDay ? () => setOpen(isOpen ? null : p.key)
                        : () => { setGrain("days"); setMonth(p.days[0].date.slice(0, 7)); }}
                    />
                    {isOpen && <SimpleDay day={day} t={t} />}
                    {weekDays && weekDays.length > 1 && (
                      <LedgerCard variant="week"
                        label={`${t("db_week")} ${isoWeek(p.key).week}`} sub={`${weekDays.length} ${t("db_trading_days")}`}
                        sums={rollup(weekDays)} t={t} />
                    )}
                  </Fragment>
                );
              })}
              <LedgerCard variant="total"
                label={month ? `${my(month)} ${t("db_total")}` : `${year} ${t("db_total")}`}
                sub={`${totals.days} ${t("db_trading_days")}`} sums={totals} t={t} />
            </div>

            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-separate border-spacing-0 text-[12.5px] tabular-nums">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-[3] border-r border-slate-200 bg-white" />
                    <th className={`${GH} ${BUY} text-brand-700`} colSpan={4}>{t("db_buy")}</th>
                    <th className={`${GH} ${SELL} border-l border-slate-200 text-orange-700`} colSpan={3}>{t("db_sell")}</th>
                    <th className={`${GH} border-l border-slate-200`} colSpan={3}>{t("db_expenses")}</th>
                    <th className={`${GH} ${STK} border-l border-slate-200 text-sky-800`} colSpan={5}>{t("db_stock")}</th>
                    <th className={`${GH} border-l border-slate-200`} colSpan={2}>{t("db_result")}</th>
                  </tr>
                  <tr>
                    <th className="sticky left-0 z-[3] border-b border-r border-slate-200 bg-white px-3.5 pb-2.5 text-left text-[10px] font-semibold text-slate-400">{t("db_period")}</th>
                    <th className={`${TH} ${BUY} border-b border-slate-200 text-center`}>{t("db_loads")}</th>
                    <th className={`${TH} ${BUY} border-b border-slate-200`}>{t("db_weight_kg")}</th>
                    <th className={`${TH} ${BUY} border-b border-slate-200`}>{t("db_price_r")}</th>
                    <th className={`${TH} ${BUY} border-b border-slate-200`}>{t("db_spent_r")}</th>
                    <th className={`${TH} ${SELL} border-b border-slate-200 border-l text-center`}>{t("db_loads")}</th>
                    <th className={`${TH} ${SELL} border-b border-slate-200`}>{t("db_weight_kg")}</th>
                    <th className={`${TH} ${SELL} border-b border-slate-200`}>{t("db_received_r")}</th>
                    <th className={`${TH} border-b border-l border-slate-200`}>ថ្លៃកូនដៃ ៛</th>
                    <th className={`${TH} border-b border-slate-200`}>{t("db_other_r")}</th>
                    <th className={`${TH} border-b border-slate-200`}>{t("db_total_r")}</th>
                    <th className={`${TH} ${STK} border-b border-l border-slate-200`}>{t("db_lost_kg")}</th>
                    <th className={`${TH} ${STK} border-b border-slate-200`}>{t("db_value_r")}</th>
                    <th className={`${TH} ${STK} border-b border-slate-200`}>{t("db_closing_kg")}</th>
                    <th className={`${TH} ${STK} border-b border-slate-200`}>{t("db_cost_per_kg")}</th>
                    <th className={`${TH} ${STK} border-b border-slate-200`}>{t("db_value_r")}</th>
                    <th className={`${TH} border-b border-l border-slate-200`}>{t("db_profit_r")}</th>
                    <th className={`${TH} border-b border-slate-200`}>{t("db_cash_r")}</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map((p, i) => {
                    const { main, sub } = labelFor(p, grain, t);
                    const isDay = grain === "days";
                    const day = isDay ? p.days[0] : null;
                    const isOpen = isDay && open === p.key;
                    // A week subtotal after each week, so a long month still
                    // reads in chunks. Weeks only — a month view is already short.
                    const nextP = periods[i + 1];
                    const endsWeek = isDay && nextP && isoWeek(p.key).key !== isoWeek(nextP.key).key;
                    const lastOfAll = isDay && !nextP;
                    const weekDays = (endsWeek || lastOfAll)
                      ? scoped.filter((d) => isoWeek(d.date).key === isoWeek(p.key).key) : null;

                    return (
                      <Fragment key={p.key}>
                        <LedgerRow
                          label={main} sub={sub} sums={p.totals} t={t}
                          open={isOpen}
                          onClick={isDay ? () => setOpen(isOpen ? null : p.key)
                            : () => { setGrain("days"); setMonth(p.days[0].date.slice(0, 7)); }}
                          onLoads={isDay ? () => setOpen(isOpen ? null : p.key) : undefined}
                        />
                        {isOpen && (
                          <tr>
                            <td colSpan={18} className="border-b border-slate-200 p-0">
                              {/* [2026-09-16] A view-only account gets the short
                                  drawer on a computer as well. Transactions was
                                  taken off its menu in September because every
                                  ticket carries a farmer's name and phone number
                                  — leaving the same list inside this drawer put
                                  them straight back through a side door. */}
                              {isViewOnly
                                ? <div className="bg-brand-50 px-4 py-3"><SimpleDay day={day} t={t} /></div>
                                : <DayDrawer day={day} txs={raw.txs} payments={raw.payments} />}
                            </td>
                          </tr>
                        )}
                        {weekDays && weekDays.length > 1 && (
                          <LedgerRow variant="week"
                            label={`${t("db_week")} ${isoWeek(p.key).week}`} sub={`${weekDays.length} ${t("db_trading_days")}`}
                            sums={rollup(weekDays)} t={t} />
                        )}
                      </Fragment>
                    );
                  })}
                  <LedgerRow variant="total"
                    label={month ? `${my(month)} ${t("db_total")}` : `${year} ${t("db_total")}`}
                    sub={`${totals.days} ${t("db_trading_days")}`} sums={totals} t={t} />
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t border-slate-100 bg-slate-50/50 px-5 py-3 text-[11.5px] text-slate-400">
              <span><b className="font-semibold text-slate-600">{t("db_loads")}</b>{t("db_hint_loads")}</span>
              <span><b className="font-semibold text-slate-600">{t("db_price")}</b>{t("db_hint_spent")}<b className="font-semibold text-slate-600">{t("db_cost_per_kg")}</b>{t("db_hint_cost")}</span>
              <span><b className="font-semibold text-slate-600">{t("db_profit")}</b> = sales − cost of the paddy sold − expenses · <b className="font-semibold text-slate-600">{t("db_cash")}</b> = received − paid − expenses</span>
              <span><b className="font-semibold text-slate-600">{t("db_closing_kg")}</b>{t("db_hint_closing")}</span>
            </div>
          </div>
        )}

        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
          Every figure is read from transactions, payments, expense entries and stock counts already recorded.
          Nothing here can be typed or edited — change a transaction and this row, its week, its month and the
          year all recalculate.
        </p>
      </main>
    </div>
  );
}
