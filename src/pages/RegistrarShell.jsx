import { useState } from "react";
import { UserPlus, Users, Languages } from "lucide-react";
import RegisterPartyStaff from "./RegisterPartyStaff.jsx";
import SimpleListPage from "./SimpleListPage.jsx";
import PartyDetail from "./PartyDetail.jsx";
import { useLanguage } from "../i18n.jsx";

// The full screen a "Registrar" account is dropped onto — see the
// isRegistrationOnly check in App.jsx (permissions === exactly
// ["manage_parties"]). Everywhere else in the app, no Sidebar means one
// single page and nothing else reachable; here it means a tiny nav of its
// own, since Registrar now has three things to move between: the
// search-first registration screen, and the Farmers/Buyers directories
// (view-only) it feeds into.
//
// Deliberately its own small tab strip instead of reusing the real
// Sidebar/MobileNav with everything else hidden — their nav lists are
// built around isAdmin/isStaff/hasPermission checks for a dozen+ other
// pages (Dashboard, Transactions, Stock, Reports, Settings, ...), none of
// which Registrar should ever reach. Keeping this as a separate,
// self-contained shell means there's no long list of exclusions to keep in
// sync elsewhere every time a new page gets added to the real nav —
// Registrar simply never sees that list at all.
//
// [2026-09-03] Expanded from a single fixed screen to this three-tab shell
// — Registrar can now also open a farmer/buyer's full profile (contact +
// bank info, transaction history) to look someone up without
// re-registering them. Still view-only: onBuyFor/onSellFor are left out
// below on purpose, so no "New Buy"/"New Sell" button or transaction-form
// route is ever reachable from here, on the list or on a profile page.
// `hideAmounts` is passed to both — registering and looking someone up
// needs their identity and how much has moved through them, not what's
// owed, so every money figure (bill amounts, paid/unpaid, the receipt
// itself) stays off — see SimpleListPage.jsx/PartyDetail.jsx's own
// comments on that prop.
//
// Two nav bars, same three destinations: a top tab strip on desktop
// (`hidden md:flex`), and a fixed bottom tab bar below `md` matching
// MobileNav.jsx's own dark, big-icon phone styling — sample-approved after
// the user flagged that registering mostly happens on a phone in the
// field, so this needs to be as easy to reach one-handed as every other
// phone screen in the app, not just usable.
export default function RegistrarShell() {
  const { t, lang, setLang } = useLanguage();
  const [page, setPage] = useState("register"); // "register" | "suppliers" | "buyers" | "party-detail"
  const [openParty, setOpenParty] = useState(null); // { id, kind } while viewing one profile

  function viewParty(party, kind) {
    setOpenParty({ id: party.id, kind });
    setPage("party-detail");
  }

  // Back-navigation from a party's profile (PartyDetail's own "Back to
  // Farmers/Buyers" button calls setPage(kind)) lands back on the right
  // list — "suppliers" or "buyers" are valid page values here too, so no
  // translation needed.
  const detailKind = openParty?.kind;

  const tabs = [
    { id: "register", label: t("nav_register"), icon: UserPlus },
    { id: "suppliers", label: t("nav_suppliers"), icon: Users },
    { id: "buyers", label: t("nav_buyers"), icon: Users },
  ];

  // [2026-09-03] Every other account gets this from Sidebar.jsx (desktop)
  // or MobileNav.jsx's "More" sheet (phone) — Registrar has neither, so
  // without its own copy here there was no way to switch to Khmer at all
  // from this shell. Same toggle, same behavior, just placed in this
  // shell's own bars instead.
  function LanguageToggle({ className = "" }) {
    return (
      <button
        onClick={() => setLang(lang === "en" ? "km" : "en")}
        title={lang === "en" ? "Switch to Khmer" : "Switch to English"}
        className={`flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 ${className}`}
      >
        <Languages size={12} /> {lang === "en" ? "EN" : "ខ្មែរ"}
      </button>
    );
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      {/* Phone: the language toggle needs somewhere to live even though the
          tab strip below is desktop-only — a slim bar of its own, above
          each page's own Topbar. */}
      <div className="flex shrink-0 items-center justify-end border-b border-slate-200 bg-white px-4 py-1.5 md:hidden">
        <LanguageToggle />
      </div>

      {/* Desktop: slim top tab strip, same row every real page's Topbar
          would sit in — hidden below `md`, where the bottom bar (plus the
          phone language bar above) takes over. */}
      <div className="hidden shrink-0 items-center justify-between gap-1 border-b border-slate-200 bg-white px-6 py-2 md:flex">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const active = page === tab.id || (page === "party-detail" && detailKind === tab.id);
            return (
              <button
                key={tab.id}
                onClick={() => setPage(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}
              >
                <tab.icon size={15} /> {tab.label}
              </button>
            );
          })}
        </div>
        <LanguageToggle />
      </div>

      {/*
        Every page below (RegisterPartyStaff, SimpleListPage, PartyDetail)
        is built the same way as every other real page in the app: a root
        div sized with `h-screen` (100vh, viewport-relative — see the print
        CSS note in index.css), not with a percentage that would defer to
        its parent. That's exactly right when the page is a direct sibling
        of Sidebar, but here it's sitting BELOW this shell's own tab strip,
        so its literal 100vh would overflow past the bottom of the screen
        by the tab strip's height, clipping a sliver of its content no
        amount of internal scrolling could ever reach.

        `[&>div]:!h-full` re-points that one page's root div at 100% of
        THIS wrapper (which is already sized to exactly "the viewport minus
        the tab strip" by the flex column below) instead of the viewport
        itself — without editing RegisterPartyStaff.jsx / SimpleListPage.jsx
        / PartyDetail.jsx, which are also used unmodified elsewhere in the
        app and should keep behaving normally there. On phone widths the
        top strip is `hidden` (0px), so this simply becomes 100% of the
        full viewport again — exactly right there too, since the bottom tab
        bar is `fixed`/`position:absolute`-style overlay, not part of this
        flex column's height.
      */}
      <div className="min-h-0 flex-1 [&>div]:!h-full">
        {page === "register" && <RegisterPartyStaff />}
        {page === "suppliers" && (
          <SimpleListPage
            title={t("nav_suppliers")}
            kind="suppliers"
            onOpenParty={(p) => viewParty(p, "suppliers")}
            onRegister={() => setPage("register")}
            onSwitchKind={setPage}
            hideAmounts
          />
        )}
        {page === "buyers" && (
          <SimpleListPage
            title={t("nav_buyers")}
            kind="buyers"
            onOpenParty={(p) => viewParty(p, "buyers")}
            onRegister={() => setPage("register")}
            onSwitchKind={setPage}
            hideAmounts
          />
        )}
        {page === "party-detail" && (
          <PartyDetail partyId={openParty?.id} kind={detailKind} setPage={setPage} hideAmounts />
        )}
      </div>

      {/* Phone: fixed bottom tab bar, same dark/big-icon language as
          MobileNav.jsx's own — the global `main.overflow-y-auto` bottom-
          padding rule in index.css already clears it for every page above
          (that rule isn't conditional on MobileNav actually being
          rendered), so nothing else needs to change for content to not
          sit underneath it. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1.5 border-t border-black/20 bg-brand-950 px-1.5 pt-2 md:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)" }}
      >
        {tabs.map((tab) => {
          const active = page === tab.id || (page === "party-detail" && detailKind === tab.id);
          return (
            <button
              key={tab.id}
              onClick={() => setPage(tab.id)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-bold ${active ? "bg-white/10 text-white" : "text-brand-300/70"}`}
            >
              <tab.icon size={22} className={active ? "text-brand-400" : ""} />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
