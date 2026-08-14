import { useEffect, useMemo, useState } from "react";
import { Search, Save, ScanLine } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
import Receipt from "./Receipt.jsx";
import { api } from "../api.js";
import { useLanguage } from "../i18n.jsx";
import { useAuth } from "../AuthContext.jsx";

function fmt2(n) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }

export default function TransactionForm({ type, setPage }) {
  const isBuy = type === "BUY";
  const { t } = useLanguage();
  const { profile, session } = useAuth();
  const isAdmin = profile?.role === "admin";

  const [stations, setStations] = useState([]);
  const [stationsLoaded, setStationsLoaded] = useState(false);
  const [products, setProducts] = useState([]);
  const [parties, setParties] = useState([]);
  const [settings, setSettings] = useState({});
  const [stationId, setStationId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [partyQuery, setPartyQuery] = useState("");
  const [selectedParty, setSelectedParty] = useState(null);
  const [partyPhone, setPartyPhone] = useState("");
  const [partyIdNumber, setPartyIdNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [company, setCompany] = useState("");
  const [destination, setDestination] = useState("dest_hq");
  const [qualityGrade, setQualityGrade] = useState("A");
  const [grossKg, setGrossKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState("");
  const [priceOverridden, setPriceOverridden] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(isBuy ? "pending" : "paid");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTx, setSavedTx] = useState(null);

  useEffect(() => {
    api.getLocations()
      .then((st) => {
        setStations(st);
        if (!isAdmin && profile?.location_id) {
          setStationId(profile.location_id);
        } else if (isAdmin && st[0]) {
          setStationId(st[0].id);
        }
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setStationsLoaded(true));

    api.getProducts().then((p) => { setProducts(p); if (p[0]) setProductQuery(p[0].name); }).catch(() => {});
    if (isBuy) api.getSettings().then(setSettings).catch(() => {});
  }, []);

  useEffect(() => {
    api.getParties({ type: isBuy ? "supplier" : "buyer", q: partyQuery }).then(setParties).catch(() => {});
  }, [partyQuery]);

  useEffect(() => {
    if (isBuy && !priceOverridden && settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]) {
      setPricePerKg(settings[`price_grade_${qualityGrade.toLowerCase()}_per_kg`]);
    }
  }, [qualityGrade, settings, isBuy, priceOverridden]);

  const netKg = Math.max(0, (parseFloat(grossKg) || 0) - (parseFloat(tareKg) || 0));
  const total = netKg * (parseFloat(pricePerKg) || 0);
  const myStation = stations.find((s) => s.id === (isAdmin ? stationId : profile?.location_id));

  function selectParty(p) {
    setSelectedParty(p);
    setPartyQuery(p.name);
    setPartyPhone(p.phone || "");
    setPartyIdNumber(p.id_number || "");
    setBankName(p.bank_name || "");
    setBankAccount(p.bank_account || "");
    setCompany(p.company || "");
    setDestination(p.destination || "dest_hq");
  }

  async function resolveProductId() {
    const name = productQuery.trim();
    const existing = products.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing.id;
    const created = await api.createProduct(name);
    return created.id;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const effectiveStationId = isAdmin ? stationId : profile?.location_id;
    if (!isAdmin && !effectiveStationId) { setError("Your account has no location assigned yet. Ask HQ to assign one to your login."); return; }
    if (!partyQuery.trim() || !effectiveStationId || !productQuery.trim() || netKg <= 0 || !pricePerKg) { setError(t("required_fields")); return; }
    setSaving(true);
    try {
      let party = selectedParty;
      if (!party) {
        party = await api.createParty({
          name: partyQuery.trim(),
          type: isBuy ? "supplier" : "buyer",
          phone: partyPhone,
          idNumber: partyIdNumber,
          bankName: isBuy ? bankName : undefined,
          bankAccount: isBuy ? bankAccount : undefined,
          company: !isBuy ? company : undefined,
          destination: !isBuy ? destination : undefined,
          locationId: effectiveStationId,
        });
      }
      const productId = await resolveProductId();
      const tx = await api.createTransaction({
        type, locationId: effectiveStationId, partyId: party.id, productId,
        quantityKg: netKg, pricePerKg: parseFloat(pricePerKg), paymentStatus, userId: session.user.id,
        qualityGrade: isBuy ? (qualityGrade.trim() || null) : null,
      });
      setSavedTx({ ...tx, partyName: party.name, partyIdNumber: party.phone || party.id_number || "" });
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  if (savedTx) {
    return <Receipt tx={savedTx} onDone={() => setPage("transactions")} />;
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <Topbar title={isBuy ? t("new_buy_title") : t("new_sell_title")} />
      <main className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSubmit} className="grid grid-cols-3 gap-5">
          <div className="col-span-2 space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-700">{isBuy ? t("section1_seller") : t("section1_buyer")}</h3>
              <div className="relative mb-3">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={partyQuery} onChange={(e) => { setPartyQuery(e.target.value); setSelectedParty(null); }} placeholder={t("search_party_placeholder")}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                {partyQuery && !selectedParty && parties.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
                    {parties.map((p) => (
                      <button type="button" key={p.id} onClick={() => selectParty(p)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                        <span>{p.name}</span><span className="text-xs text-slate-400">{p.id_number}</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">Type a name to search, or a new name to add them.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("phone")}</label><input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} placeholder="+855 XX XXX XXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>

                {isBuy ? (
                  <>
                    <div><label className="mb-1 block text-xs text-slate-500">{t("bank_name")}</label><input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="ABA / ACLEDA / ..." className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                    <div><label className="mb-1 block text-xs text-slate-500">{t("bank_account")}</label><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                  </>
                ) : (
                  <>
                    <div><label className="mb-1 block text-xs text-slate-500">{t("company_name")}</label><input value={company} onChange={(e) => setCompany(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{t("destination")}</label>
                      <input list="destination-options" value={destination} onChange={(e) => setDestination(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                      <datalist id="destination-options">
                        <option value="dest_hq">{t("dest_hq")}</option>
                        <option value="dest_factory">{t("dest_factory")}</option>
                        <option value="dest_border">{t("dest_border")}</option>
                        <option value="dest_other">{t("dest_other")}</option>
                      </datalist>
                    </div>
                  </>
                )}

                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("product")}</label>
                  <input list="product-options" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Type or pick a product"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  <datalist id="product-options">
                    {products.map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
                {isAdmin && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{t("station")}</label>
                    <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                      {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}

                {isBuy && (
                  <div>
                    <label className="mb-1 block text-xs text-slate-500">{t("quality_grade")}</label>
                    <input list="grade-options" value={qualityGrade} onChange={(e) => { setQualityGrade(e.target.value); setPriceOverridden(false); }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                    <datalist id="grade-options">
                      <option value="A">{t("grade_a")}</option>
                      <option value="B">{t("grade_b")}</option>
                      <option value="C">{t("grade_c")}</option>
                    </datalist>
                    <p className="mt-1 text-[11px] text-slate-400">A/B/C auto-fills the price — type anything else to set your own.</p>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-700"><ScanLine size={16} /> {t("section2_weighbridge")}</h3>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("gross_weight")}</label><input type="number" min="0" step="0.01" value={grossKg} onChange={(e) => setGrossKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div><label className="mb-1 block text-xs text-slate-500">{t("tare_weight")}</label><input type="number" min="0" step="0.01" value={tareKg} onChange={(e) => setTareKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("price_per_kg")}</label>
                  <input type="number" min="0" step="0.01" value={pricePerKg}
                    onChange={(e) => { setPricePerKg(e.target.value); setPriceOverridden(true); }}
                    placeholder="0.00" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                  {isBuy && <p className="mt-1 text-[11px] text-slate-400">Auto-filled from grade — edit to override</p>}
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs text-slate-500">{t("payment_status")}</label>
                <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  {isBuy ? (<><option value="pending">{t("pendingpay")}</option><option value="paid">{t("paid")}</option></>) : (<><option value="paid">{t("paid")}</option><option value="credit">{t("credit")}</option><option value="deposit">{t("deposit")}</option></>)}
                </select>
                <p className="mt-1 text-[11px] text-slate-400">Fixed choices — these exact values feed your Financial Reports.</p>
              </div>
              <div className="mt-4 rounded-lg bg-brand-50 p-4 text-center">
                <p className="text-xs text-brand-700/70">{t("net_weight")}</p>
                <p className="text-4xl font-bold text-brand-800">{fmt2(netKg)} <span className="text-lg font-medium text-brand-600">KG</span></p>
              </div>
            </section>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          <div className="col-span-1">
            <div className="sticky top-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-semibold text-slate-700">{t("summary")}</h3>
              <div className="mb-4 rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 p-4 text-white">
                <p className="text-xs text-brand-100/80">{t("total_amount")}</p>
                <p className="mt-1 text-3xl font-bold">${fmt2(total)}</p>
                <p className="mt-2 text-xs text-brand-100/70">{fmt2(netKg)} kg × ${fmt2(parseFloat(pricePerKg) || 0)}/kg</p>
              </div>
              <button type="submit" disabled={saving} className="mt-1 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                <Save size={16} /> {saving ? "..." : t("save_transaction")}
              </button>
              <button type="button" onClick={() => setPage("transactions")} className="mt-2 w-full rounded-lg py-2 text-xs text-slate-400 hover:text-slate-600">← {t("back")}</button>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
}
