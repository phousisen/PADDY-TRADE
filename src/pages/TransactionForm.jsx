import { useEffect, useMemo, useState } from "react";
import { Search, Save, ScanLine } from "lucide-react";
import Topbar from "../components/Topbar.jsx";
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
  const [products, setProducts] = useState([]);
  const [parties, setParties] = useState([]);
  const [stationId, setStationId] = useState("");
  const [productId, setProductId] = useState("");
  const [partyQuery, setPartyQuery] = useState("");
  const [selectedParty, setSelectedParty] = useState(null);
  const [partyPhone, setPartyPhone] = useState("");
  const [partyIdNumber, setPartyIdNumber] = useState("");
  const [grossKg, setGrossKg] = useState("");
  const [tareKg, setTareKg] = useState("");
  const [pricePerKg, setPricePerKg] = useState(isBuy ? "6.00" : "");
  const [paymentStatus, setPaymentStatus] = useState(isBuy ? "pending" : "paid");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getLocations().then((st) => {
      setStations(st);
      if (!isAdmin && profile?.location_id) setStationId(profile.location_id);
      else if (st[0]) setStationId(st[0].id);
    });
    api.getProducts().then((p) => { setProducts(p); if (p[0]) setProductId(p[0].id); });
  }, []);

  useEffect(() => {
    api.getParties({ type: isBuy ? "supplier" : "buyer", q: partyQuery }).then(setParties);
  }, [partyQuery]);

  const netKg = Math.max(0, (parseFloat(grossKg) || 0) - (parseFloat(tareKg) || 0));
  const total = netKg * (parseFloat(pricePerKg) || 0);

  function selectParty(p) {
    setSelectedParty(p); setPartyQuery(p.name); setPartyPhone(p.phone || ""); setPartyIdNumber(p.id_number || "");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!partyQuery.trim() || !stationId || !productId || netKg <= 0 || !pricePerKg) { setError(t("required_fields")); return; }
    setSaving(true);
    try {
      let party = selectedParty;
      if (!party) {
        party = await api.createParty({ name: partyQuery.trim(), type: isBuy ? "supplier" : "buyer", phone: partyPhone, idNumber: partyIdNumber });
      }
      await api.createTransaction({
        type, locationId: stationId, partyId: party.id, productId,
        quantityKg: netKg, pricePerKg: parseFloat(pricePerKg), paymentStatus, userId: session.user.id,
      });
      setPage("transactions");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
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
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("phone")}</label><input value={partyPhone} onChange={(e) => setPartyPhone(e.target.value)} placeholder="+855 XX XXX XXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div><label className="mb-1 block text-xs text-slate-500">{t("id_number")}</label><input value={partyIdNumber} onChange={(e) => setPartyIdNumber(e.target.value)} placeholder="F-XXX" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("station")}</label>
                  <select value={stationId} onChange={(e) => setStationId(e.target.value)} disabled={!isAdmin} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50">
                    {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">{t("product")}</label>
                  <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-slate-700"><ScanLine size={16} /> {t("section2_weighbridge")}</h3>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="mb-1 block text-xs text-slate-500">{t("gross_weight")}</label><input type="number" min="0" step="0.01" value={grossKg} onChange={(e) => setGrossKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div><label className="mb-1 block text-xs text-slate-500">{t("tare_weight")}</label><input type="number" min="0" step="0.01" value={tareKg} onChange={(e) => setTareKg(e.target.value)} placeholder="0" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
                <div><label className="mb-1 block text-xs text-slate-500">{t("price_per_kg")}</label><input type="number" min="0" step="0.01" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} placeholder="0.00" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs text-slate-500">{t("payment_status")}</label>
                <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  {isBuy ? (<><option value="pending">{t("pendingpay")}</option><option value="paid">{t("paid")}</option></>) : (<><option value="paid">{t("paid")}</option><option value="credit">{t("credit")}</option><option value="deposit">{t("deposit")}</option></>)}
                </select>
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
