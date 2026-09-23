import { useEffect, useState } from "react";
import Topbar from "../components/Topbar.jsx";
import LocationFilter from "../components/LocationFilter.jsx";
import DateRangeFilter from "../components/DateRangeFilter.jsx";
import ReportAuditLog from "./ReportAuditLog.jsx";
import { useLanguage } from "../i18n.jsx";
import { api } from "../api.js";
import { getAccurateNow } from "../supabaseClient.js";

// [2026-09-23] THE ACTIVITY LOG IS NOT A FINANCIAL REPORT.
//
// It lived as the last item under Finance → Setup, beside Tax and Capital.
// SISEN: "is it a good choice o put acitvities log in finance". It is not.
// Nothing in it is money. It answers "who did this, and when" — about
// tickets, weights, stock, roles, the scale, and money alike — which is a
// SYSTEM question, the same kind as Station Health or Users. Buried in
// Finance, the one person who needs it most (an admin checking a ticket
// nobody will own up to) had to go through the accounts section to find it.
//
// So it is its own page now, under SYSTEM, with the three filters the
// question actually needs: WHO, WHICH STATION, and WHEN. The table itself is
// unchanged — ReportAuditLog.jsx still draws it, and still draws it inside
// Finance for nobody, because that tab is gone.

function cambodiaToday() {
  const p = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Phnom_Penh", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(getAccurateNow()).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
// Opens on the last 7 days rather than the whole month: this page is read
// when something has just happened, and a week is small enough to scan.
function weekAgo() {
  const d = new Date(`${cambodiaToday()}T00:00:00+07:00`);
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

export default function ActivityLog() {
  const { t } = useLanguage();
  const [locations, setLocations] = useState([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [startDate, setStartDate] = useState(weekAgo);
  const [endDate, setEndDate] = useState(cambodiaToday);
  const [people, setPeople] = useState([]);
  const [personId, setPersonId] = useState("");

  useEffect(() => {
    api.getLocations().then(setLocations).catch(() => setLocations([]));
  }, []);

  // A person filtered on who then disappears from the new period would leave
  // the page showing nothing with no visible reason.
  useEffect(() => {
    if (personId && !people.some((p) => p.id === personId)) setPersonId("");
  }, [people, personId]);

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("nav_activity_log")} subtitle={t("al_page_subtitle")} />

      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-medium text-slate-700"
          >
            <option value="">{t("al_everyone")}</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {locations.length > 1 && (
            <LocationFilter locations={locations} selectedIds={selectedLocationIds} setSelectedIds={setSelectedLocationIds} />
          )}
          <DateRangeFilter startDate={startDate} endDate={endDate} onChange={(s, e) => { setStartDate(s); setEndDate(e); }} />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <ReportAuditLog
          selectedLocationIds={selectedLocationIds}
          startDate={startDate}
          endDate={endDate}
          personId={personId}
          onPeople={setPeople}
        />
      </main>
    </div>
  );
}
