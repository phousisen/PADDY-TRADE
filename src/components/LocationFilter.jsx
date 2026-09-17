import { useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { useLanguage } from "../i18n.jsx";

// Choosing which station you are looking at.
//
// [2026-09-17] SISEN, on the version this replaces:
//
//     "i also have issue with this picking location. both on pc and devices.
//      it makes it really complicated when we are able to select so many like
//      that because personally my parents doesnt know, they might thought they
//      slected only 1 but they pressed 2 so the info will be wrong."
//
// WHY THAT WAS DANGEROUS, NOT JUST AWKWARD
//
// It was a multi-select with tick boxes, and the button read "2 Locations
// Selected". Tick a second station by accident and every figure on the page
// becomes two stations ADDED TOGETHER — a stock level, a day's buying, a
// month's expenses. None of it looks wrong. A shed reading 68,000 kg that is
// really two sheds of 27,000 and 41,000 is a number somebody makes a decision
// on, and the only warning was a sentence you had to read and understand.
//
// Nobody ever needed two. The real uses are "everything" or "this one place".
//
// WHAT CHANGED
//
//   · ONE at a time. Picking a station unpicks the last, so two can never be
//     on together. The bug is not made harder to hit; it is made impossible.
//   · ROUND buttons, not tick boxes. Everyone already knows a round button
//     means one — the shape carries the rule better than any label, and it
//     reads the same to someone who cannot read the label at all.
//   · The button says the STATION'S NAME, never a count. "2 Locations
//     Selected" is a sentence to decode; "JOMNOUM" is a fact.
//   · Green when one station is chosen, plain when it is everything — so the
//     page's own colour tells you that you are not looking at the whole
//     business.
//
// The prop is still an ARRAY, so nothing that uses this had to change: it is
// either empty (everything) or exactly one long.
export default function LocationFilter({ locations, selectedIds, setSelectedIds }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Defensive: an array arriving with two in it (a stale filter saved before
  // this change) collapses to the first rather than showing a count again.
  const current = selectedIds.length ? selectedIds[0] : null;
  const chosen = current ? locations.find((l) => l.id === current) : null;

  function choose(id) {
    setSelectedIds(id ? [id] : []);
    setOpen(false);          // one tap, no "Done" step to forget
  }

  const kg = (v) => (Number(v) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

  const Row = ({ id, name, sub }) => {
    const on = current === id;
    return (
      <button
        type="button"
        onClick={() => choose(id)}
        // 44px tall: a thumb target on a phone, not a mouse target.
        className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left text-sm last:border-0 ${
          on ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-700 hover:bg-slate-50"}`}
      >
        <span className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
          on ? "border-brand-600" : "border-slate-300"}`}>
          {on && <span className="h-[7px] w-[7px] rounded-full bg-brand-600" />}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {sub && <span className={`shrink-0 text-[11px] tabular-nums ${on ? "text-brand-600" : "text-slate-400"}`}>{sub}</span>}
      </button>
    );
  };

  const list = (
    <>
      <Row id={null} name={t("loc_all")} sub={t("loc_n_places", { n: locations.length })} />
      {locations.map((loc) => (
        <Row key={loc.id} id={loc.id} name={loc.name}
          sub={loc.current_stock_kg === undefined ? null : `${kg(loc.current_stock_kg)} ${t("db_weight_kg")}`} />
      ))}
    </>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
          chosen
            ? "border-brand-600 bg-brand-50 font-semibold text-brand-700"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
      >
        <MapPin size={14} className={chosen ? "text-brand-600" : "text-slate-400"} />
        <span className="max-w-[150px] truncate">{chosen ? chosen.name : t("loc_all")}</span>
        <ChevronDown size={14} className={chosen ? "text-brand-600" : "text-slate-400"} />
      </button>

      {open && (
        <>
          {/* PHONE — a sheet from the bottom. A 260px dropdown pinned to a
              button in a corner is a mouse control; this is the same list
              given the whole width and a thumb's worth of height. */}
          <div className="fixed inset-0 z-50 flex items-end bg-black/30 md:hidden" onClick={() => setOpen(false)}>
            <div className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-white pb-[env(safe-area-inset-bottom)]"
              onClick={(e) => e.stopPropagation()}>
              <div className="border-b border-slate-100 px-4 pb-2.5 pt-3.5">
                <p className="text-sm font-bold text-slate-800">{t("loc_pick_title")}</p>
                <p className="mt-0.5 text-[11.5px] text-slate-400">{t("loc_pick_one_only")}</p>
              </div>
              {list}
            </div>
          </div>

          {/* COMPUTER */}
          <div className="absolute right-0 z-20 mt-1 hidden w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg md:block">
            <p className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {t("loc_pick_title")}
            </p>
            {list}
          </div>
        </>
      )}
    </div>
  );
}
