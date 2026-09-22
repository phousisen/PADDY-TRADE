import { useEffect, useMemo, useState, useRef } from "react";
import { api } from "../api.js";
import { rangeKey } from "../reportQuery.js";
import { TableCard, Table, Th, Td, Tr } from "../components/ReportUI.jsx";
import { dmyTime } from "../dateFormat.js";
import { useLanguage } from "../i18n.jsx";

function fmtRiel(n) { return `${new Intl.NumberFormat("en-US").format(Math.round(n || 0))} ៛`; }
// Every timestamp elsewhere in PaddyTrade is shown in Cambodia's own
// wall-clock time regardless of the viewing device's timezone (see e.g.
// cambodiaDateStr/cambodiaNow in the other pages) — this table was the one
// place still using the browser's default toLocaleString(), which shows a
// different time to anyone viewing from outside Cambodia's timezone.
function fmtCambodiaDateTime(iso) {
  if (!iso) return "—";
  return dmyTime(iso);
}

// [2026-09-19] Every action the app writes has a label and a filter group
// (twelve of them used to show as raw names like "void_payment" and could
// only be found under "All activity"), and every label is in both languages
// (audit F29).
const ACTION_META = {
  create_transaction: "transaction", edit_transaction: "transaction", cancel_transaction: "transaction",
  restore_transaction: "transaction", reopen_ticket: "transaction", restore_declined_ticket: "transaction",
  confirm_buyer_sale: "transaction",
  submit_change_request: "request", approve_change_request: "request", reject_change_request: "request",
  record_payment: "payment", edit_payment: "payment", void_payment: "payment", edit_expense: "payment",
  update_party_bank: "payment",
  change_role: "user", set_password: "user", list_emails: "user",
  add_partner: "capital", add_capital_entry: "capital", add_loan_entry: "capital",
  adjust_stock: "stock", request_stock_reset: "stock", approve_stock_reset: "stock", reverse_stock_adjustment: "stock",
  // [2026-09-21] The scale guard (scaleGuard.js): a station's scale going
  // below zero and back, and an Owner allowing one capture past the guard.
  scale_below_zero: "transaction", scale_back_to_zero: "transaction", scale_capture_override: "transaction",
  // [2026-09-21] Expense confirmation (expense_confirmation.sql).
  confirm_expense_day: "payment", send_back_expense_day: "payment",
  approve_expense_change: "payment", reject_expense_change: "payment",
};

const CATEGORIES = ["all", "payment", "transaction", "request", "stock", "user", "capital", "other"];

function actionMeta(action, t) {
  const category = ACTION_META[action] || "other";
  const key = `al_act_${action}`;
  const label = ACTION_META[action] ? t(key) : action;
  return { label, category };
}

function refLabel(log) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const code = after.code || before.code;
  const partyName = after.partyName || before.partyName;
  if (code && partyName) return `${code} · ${partyName}`;
  return code || partyName || "";
}

function describeChange(log, t) {
  const before = log.old_data || {};
  const after = log.new_data || {};
  const action = log.action;
  const ref = refLabel(log);
  const parts = [];

  switch (action) {
    case "create_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      if (after.stationName) parts.push(t("al_location", { v: after.stationName }));
      if (after.paymentStatus) parts.push(t("al_status", { v: after.paymentStatus }));
      break;

    case "record_payment":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      if (after.method) parts.push(t("al_method", { v: after.method }));
      if (after.memo) parts.push(after.memo);
      break;

    case "edit_payment":
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined) {
        parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
      }
      break;

    case "submit_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "approve_change_request":
    case "reject_change_request":
      if (ref) parts.push(ref);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      if (action === "approve_change_request") {
        if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
          parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
        }
        if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
          parts.push(t("al_price", { v: `${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}` }));
        }
      }
      break;

    case "scale_below_zero":
    case "scale_back_to_zero":
    case "scale_capture_override":
      if (after.weightKg !== undefined) parts.push(t("al_scale_weight", { v: new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(after.weightKg) }));
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "confirm_expense_day":
    case "send_back_expense_day":
      if (after.stationName) parts.push(after.stationName);
      if (after.day) parts.push(after.day);
      if (after.total !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.total) }));
      if (after.corrected) parts.push(t("xr_corrected"));
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "approve_expense_change":
    case "reject_expense_change":
      if (after.day) parts.push(after.day);
      if (after.category) parts.push(`${after.category}: ${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}`);
      if (after.reason) parts.push(t("al_reason", { v: after.reason }));
      break;

    case "cancel_transaction":
      if (ref) parts.push(ref);
      if (after.amount !== undefined) parts.push(t("al_amount", { v: fmtRiel(after.amount) }));
      break;

    case "change_role":
      if (after.fullName) parts.push(after.fullName);
      if (after.role) parts.push(t("al_new_role", { v: after.role }));
      break;

    case "add_partner":
      if (after.name) parts.push(t("al_partner", { v: after.name }));
      break;

    case "add_capital_entry":
      if (after.partnerName) parts.push(after.partnerName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "contribution" ? t("al_contribution") : t("al_withdrawal"));
      break;

    case "add_loan_entry":
      if (after.lenderName) parts.push(after.lenderName);
      if (after.amount !== undefined) parts.push(fmtRiel(after.amount));
      if (after.type) parts.push(after.type === "borrow" ? t("al_loan_drawn") : t("al_loan_repaid"));
      break;

    default:
      // Fallback for older or unrecognized log entries
      if (ref) parts.push(ref);
      if (before.amount !== undefined && after.amount !== undefined && before.amount !== after.amount) {
        parts.push(t("al_amount", { v: `${fmtRiel(before.amount)} → ${fmtRiel(after.amount)}` }));
      }
      if (before.price_per_kg !== undefined && after.price_per_kg !== undefined && before.price_per_kg !== after.price_per_kg) {
        parts.push(t("al_price", { v: `${fmtRiel(before.price_per_kg)} → ${fmtRiel(after.price_per_kg)}` }));
      }
      if (before.payment_status !== undefined && after.payment_status !== undefined && before.payment_status !== after.payment_status) {
        parts.push(t("al_status", { v: `${before.payment_status} → ${after.payment_status}` }));
      }
  }

  return parts.length ? parts.join(" · ") : "—";
}

export default function ReportAuditLog({ selectedLocationIds = [], startDate = null, endDate = null }) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);
  const [loadError, setLoadError] = useState("");
  const [category, setCategory] = useState("all");

  function load() {
    // [2026-09-19] Only the newest request may fill the page: changing the
    // station or dates quickly let an older, slower answer land last (audit F12).
    const my = ++loadSeq.current;
    const live = () => my === loadSeq.current;
    setLoading(true);
    setLoadError("");
    // [2026-09-12] Asks the database for the chosen period instead of
    // downloading every entry ever recorded — see api.getAuditLogs.
    api.getAuditLogs({ from: startDate, to: endDate })
      .then((data) => { if (live()) setLogs(data); })
      .catch((err) => {
        if (!live()) return;
        // Without this, a failed/dropped request left this page stuck
        // showing nothing, with no error and no way to retry.
        setLoadError(err.message || t("al_err_load"));
      })
      .finally(() => { if (live()) setLoading(false); });
  }
  // Refetch when the period changes — rangeKey gives a stable string so an
  // array prop does not retrigger this on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [rangeKey({ selectedLocationIds, startDate, endDate })]);

  // [2026-09-19] The station filter at the top of Reports used to do nothing
  // here (audit F29). A log entry has no station of its own, so it follows
  // the station of the person who did it; head-office accounts (no station)
  // show only under "All locations".
  const locKey = [...selectedLocationIds].sort().join(",");
  const filteredLogs = useMemo(() => {
    const wanted = selectedLocationIds.length ? new Set(selectedLocationIds) : null;
    return logs.filter((l) =>
      (!wanted || wanted.has(l.userLocationId)) &&
      (category === "all" || actionMeta(l.action, t).category === category));
  }, [logs, category, locKey, t]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11.5px] text-slate-400">
        {t("al_intro")}
        {selectedLocationIds.length > 0 && <span className="mt-1 block">{t("al_station_note")}</span>}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          <span>{loadError}</span>
          <button onClick={load} className="shrink-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100">{t("retry_label")}</button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-lg border px-3 py-1.5 text-[13.5px] ${
              category === c
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t(`al_cat_${c}`)}
          </button>
        ))}
      </div>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>{t("al_when")}</Th>
              <Th>{t("al_who")}</Th>
              <Th>{t("al_action")}</Th>
              <Th>{t("al_details")}</Th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((l) => {
              const meta = actionMeta(l.action, t);
              return (
                <Tr key={l.id}>
                  <Td className="whitespace-nowrap">{fmtCambodiaDateTime(l.created_at)}</Td>
                  <Td name className="whitespace-nowrap">{l.userName}</Td>
                  <Td className="whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        meta.category === "payment" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {meta.label}
                    </span>
                  </Td>
                  <Td>{describeChange(l, t)}</Td>
                </Tr>
              );
            })}
            {loading && filteredLogs.length === 0 && (
              <Tr><td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">{t("loading_label")}</td></Tr>
            )}
            {filteredLogs.length === 0 && !loading && !loadError && (
              <Tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[13.5px] text-slate-400">
                  {t("al_empty")}
                </td>
              </Tr>
            )}
          </tbody>
        </Table>
      </TableCard>
    </div>
  );
}
