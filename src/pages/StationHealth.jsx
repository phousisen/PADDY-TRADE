import Topbar from "../components/Topbar.jsx";
import StationVersions from "../components/StationVersions.jsx";
import { useLanguage } from "../i18n.jsx";

// Stations.
//
// [2026-09-01] This page began as "Station Health": a card per station saying
// Active / Quiet / No activity today, worked out from each station's most
// recent transaction. It was honest about its own limits — it could not tell
// a dead network from a slow morning, and said so on screen.
//
// [2026-09-16] Now that every machine reports in once a minute, it can. The
// version panel added this morning sat ABOVE those cards, so the page had two
// lists describing the same five places and disagreeing about which mattered.
// SISEN: "not professional and proper at all."
//
// So: one table. Connection, version, trading today, and the machines signed
// in — the trading figures carried across from the cards, which are gone.
// Nothing that page said has been lost; it is a column now instead of a
// second panel saying it again.

export default function StationHealth() {
  const { t } = useLanguage();
  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={t("st_title")} subtitle={t("st_sub")} />
      <main className="flex-1 overflow-y-auto bg-paper p-6">
        <StationVersions />
      </main>
    </div>
  );
}
