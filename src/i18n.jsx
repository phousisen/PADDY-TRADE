import { createContext, useContext, useEffect, useState } from "react";

export const translations = {
  en: {
    appName: "PaddyTrade",
    login_title: "Sign in to PaddyTrade", login_subtitle: "Enter your email and password",
    email: "Email", password: "Password", sign_in: "Sign In", signing_in: "Signing in...",
    login_error: "Incorrect email or password.",
    nav_dashboard: "Dashboard", nav_stock: "Stock Inventory", nav_transactions: "Transactions",
    nav_suppliers: "Farmers", nav_buyers: "Buyers", nav_stations: "Locations",
    nav_reports: "Financial Reports", nav_settings: "Settings", nav_help: "Help", nav_requests: "Change Requests",
    logout: "Log out",
    search_placeholder: "Search transactions, stock, users...",
    stock_title: "Stock Inventory Overview", stock_subtitle: "Track total stock volume, breakdown by location, and the latest activity",
    refresh: "Refresh Data", total_stock: "Total Stock", est_value: "Estimated Value", location_count: "Location Count",
    last_week: "last week", of_capacity: "of capacity", locations: "Locations", stock_by_station: "Stock Breakdown by Location",
    station: "Location", quantity_kg: "Quantity (KG)", capacity: "Capacity", updated: "Last Updated", max: "Max",
    tx_title: "Transactions List", all: "All", buy: "Buy", sell: "Sell", filter: "Filter", export_csv: "Export CSV",
    new_buy: "New Buy", new_sell: "New Sell", col_id: "Transaction ID", col_date: "Date", col_station: "Location",
    col_party: "Party (Buyer/Seller)", col_qty: "Qty (KG)", col_amount: "Amount (Riel)", col_status: "Status", col_action: "Action",
    no_transactions: "No transactions yet", new_buy_title: "New BUY Transaction", new_sell_title: "New SELL Transaction",
    section1_seller: "1. Seller (Farmer) Information", section1_buyer: "1. Buyer Information",
    search_party_placeholder: "Search by name, phone, or ID...", phone: "Phone Number", id_number: "ID Number",
    product: "Product", section2_weighbridge: "2. Weighbridge Data", gross_weight: "Gross Weight (KG)",
    tare_weight: "Tare Weight (KG)", price_per_kg: "Price per KG", net_weight: "Net Weight", summary: "Summary",
    car_plate_number: "Car Plate Number",
    total_amount: "Total Amount", transaction_type: "Transaction Type", save_transaction: "Save Transaction",
    required_fields: "Please complete all required fields.", coming_soon_desc: "This screen hasn't been designed yet.",
    back: "Back to transactions",
    my_location: "My Location", all_locations: "All Locations",
    locked_field: "Locked — HQ approval required to change",
    cannot_edit: "You don't have permission to edit or delete transactions. Request a change instead.",
    request_change: "Request a change", reason_label: "What needs to change and why?",
    reason_placeholder: "e.g. Wrong weight entered — should be 4,180 kg not 4,250 kg",
    submit_request: "Send request to HQ", cancel: "Cancel",
    requests_title: "Change Requests", requests_subtitle: "Requests from locations to correct or update saved transactions",
    requested_by: "Requested by", requested_on: "Requested on", reason: "Reason", approve: "Approve", reject: "Reject",
    status_pending: "Pending", status_approved: "Approved", status_rejected: "Rejected", no_requests: "No change requests",
    reports_title: "Financial Reports", reports_subtitle: "Company-wide profit & loss and balance sheet, built from every recorded transaction",
    profit_loss: "Profit & Loss", balance_sheet: "Balance Sheet", total_buy: "Total Purchases (COGS)", total_sell: "Total Sales (Revenue)",
    gross_profit: "Gross Profit", assets: "Assets", liabilities: "Liabilities", equity: "Equity (net worth)",
    inventory_value: "Inventory on hand", accounts_receivable: "Accounts Receivable (owed by buyers)",
    cash_estimate: "Cash (paid sales − paid purchases)", accounts_payable: "Accounts Payable (owed to farmers)",
    total_assets: "Total Assets", total_liabilities: "Total Liabilities", payment_status: "Payment", paid: "Paid",
    pendingpay: "Pending", credit: "Credit", deposit: "Deposit",
    reports_caveat: "Simplified model: inventory is valued at average purchase cost, and cost of goods sold is approximated from total purchases rather than matched item-by-item.",
    permission_denied: "This page is only visible to HQ Admin.",
    role_admin: "HQ Admin", role_manager: "Location Manager", role_staff: "Location Staff",
    bank_name: "Bank Name", bank_account: "Bank Account Number", quality_grade: "Quality Grade",
    grade_a: "Grade A — Premium", grade_b: "Grade B — Standard", grade_c: "Grade C — Low Quality",
    company_name: "Company Name", destination: "Destination",
    dest_hq: "Battambang HQ", dest_factory: "Phnom Penh Factory", dest_border: "Vietnam Border", dest_other: "Other",
    hq_confirmation: "HQ Confirmation", hq_processing: "Processing", hq_paid: "Paid", hq_cancelled: "Cancelled",
  },
  km: {
    appName: "PADDYTRADE",
    login_title: "ចូលទៅកាន់ PaddyTrade", login_subtitle: "បញ្ចូលអុីមែល និងពាក្យសម្ងាត់របស់អ្នក",
    email: "អុីមែល", password: "ពាក្យសម្ងាត់", sign_in: "ចូល", signing_in: "កំពុងចូល...",
    login_error: "អុីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។",
    nav_dashboard: "ផ្ទាំងគ្រប់គ្រង", nav_stock: "ស្តុកទំនិញ", nav_transactions: "ប្រតិបត្តិការ",
    nav_suppliers: "កសិករ", nav_buyers: "អ្នកទិញ", nav_stations: "ទីតាំង", nav_reports: "របាយការណ៍ហិរញ្ញវត្ថុ",
    nav_settings: "ការកំណត់", nav_help: "ជំនួយ", nav_requests: "សំណើផ្លាស់ប្តូរ", logout: "ចាកចេញ",
    search_placeholder: "ស្វែងរកប្រតិបត្តិការ, ស្តុក, អ្នកប្រើប្រាស់...",
    stock_title: "មជ្ឈមណ្ឌលស្តុកទំនិញ", stock_subtitle: "តាមដានបរិមាណស្តុកសរុប, ការបែងចែកតាមទីតាំង, និងចលនាចុងក្រោយបំផុត",
    refresh: "សម្រួលទិន្នន័យ", total_stock: "បរិមាណស្តុកសរុប", est_value: "តម្លៃប៉ាន់ស្មាន", location_count: "ចំនួនទីតាំង",
    last_week: "សប្តាហ៍មុន", of_capacity: "នៃចំណុះ", locations: "ទីតាំង", stock_by_station: "ការបែងចែកស្តុកតាមទីតាំង",
    station: "ទីតាំង", quantity_kg: "បរិមាណ (KG)", capacity: "ចំណុះ", updated: "បច្ចុប្បន្នភាព", max: "អតិបរមា",
    tx_title: "បញ្ជីប្រតិបត្តិការ", all: "ទាំងអស់", buy: "ការទិញ", sell: "ការលក់", filter: "តម្រង", export_csv: "នាំចេញ CSV",
    new_buy: "ការទិញថ្មី", new_sell: "ការលក់ថ្មី", col_id: "លេខប្រតិបត្តិការ", col_date: "កាលបរិច្ឆេទ", col_station: "ទីតាំង",
    col_party: "ដៃគូ (អ្នកទិញ/លក់)", col_qty: "បរិមាណ (KG)", col_amount: "ទឹកប្រាក់ (Riel)", col_status: "ស្ថានភាព", col_action: "សកម្មភាព",
    no_transactions: "មិនមានប្រតិបត្តិការទេ", new_buy_title: "ប្រតិបត្តិការទិញថ្មី", new_sell_title: "ប្រតិបត្តិការលក់ថ្មី",
    section1_seller: "១. ព័ត៌មានអ្នកលក់ (កសិករ)", section1_buyer: "១. ព័ត៌មានអ្នកទិញ",
    search_party_placeholder: "ស្វែងរកតាមឈ្មោះ, លេខទូរស័ព្ទ, ឬ ID...", phone: "លេខទូរស័ព្ទ", id_number: "លេខសម្គាល់ (ID)",
    product: "ប្រភេទទំនិញ", section2_weighbridge: "២. ទិន្នន័យជញ្ជីង", gross_weight: "ទម្ងន់សរុប (Gross) KG",
    tare_weight: "ទម្ងន់រថយន្ត (Tare) KG", price_per_kg: "តម្លៃក្នុងមួយ KG", net_weight: "ទម្ងន់សុទ្ធ", summary: "សេចក្តីសង្ខេប",
    car_plate_number: "លេខផ្លាកយានយន្ត",
    total_amount: "ចំនួនទឹកប្រាក់សរុប", transaction_type: "ប្រភេទប្រតិបត្តិការ", save_transaction: "រក្សាទុក ប្រតិបត្តិការ",
    required_fields: "សូមបំពេញព័ត៌មានទាំងអស់។", coming_soon_desc: "អេក្រង់នេះមិនទាន់រចនានៅឡើយទេ។", back: "ត្រឡប់ទៅប្រតិបត្តិការ",
    my_location: "ទីតាំងរបស់ខ្ញុំ", all_locations: "ទីតាំងទាំងអស់",
    locked_field: "ជាប់សោ — ត្រូវការការអនុម័តពី HQ ដើម្បីផ្លាស់ប្តូរ",
    cannot_edit: "អ្នកមិនមានសិទ្ធិកែប្រែ ឬលុបប្រតិបត្តិការទេ។ សូមផ្ញើសំណើផ្លាស់ប្តូរជំនួសវិញ។",
    request_change: "ស្នើសុំផ្លាស់ប្តូរ", reason_label: "តើអ្វីត្រូវផ្លាស់ប្តូរ ហើយហេតុអ្វី?",
    reason_placeholder: "ឧ. ទម្ងន់មិនត្រឹមត្រូវ — គួរតែ 4,180 kg មិនមែន 4,250 kg",
    submit_request: "ផ្ញើសំណើទៅ HQ", cancel: "បោះបង់",
    requests_title: "សំណើផ្លាស់ប្តូរ", requests_subtitle: "សំណើពីទីតាំងនានា ដើម្បីកែតម្រូវ ឬកែប្រែប្រតិបត្តិការដែលបានរក្សាទុក",
    requested_by: "ស្នើដោយ", requested_on: "ថ្ងៃស្នើ", reason: "មូលហេតុ", approve: "អនុម័ត", reject: "បដិសេធ",
    status_pending: "កំពុងរង់ចាំ", status_approved: "បានអនុម័ត", status_rejected: "បានបដិសេធ", no_requests: "មិនមានសំណើទេ",
    reports_title: "របាយការណ៍ហិរញ្ញវត្ថុ", reports_subtitle: "ចំណេញ-ខាត និងតារាងតុល្យការទាំងក្រុមហ៊ុន គិតចេញពីរាល់ប្រតិបត្តិការ",
    profit_loss: "ចំណេញ-ខាត", balance_sheet: "តារាងតុល្យការ", total_buy: "ការទិញសរុប (ថ្លៃដើម)", total_sell: "ការលក់សរុប (ចំណូល)",
    gross_profit: "ប្រាក់ចំណេញដុល", assets: "ទ្រព្យសកម្ម", liabilities: "បំណុល", equity: "សមធម៌ (តម្លៃសុទ្ធ)",
    inventory_value: "តម្លៃស្តុកនៅសល់", accounts_receivable: "ត្រូវទារពីអ្នកទិញ", cash_estimate: "សាច់ប្រាក់ (លក់បានទទួល − ទិញបានបង់)",
    accounts_payable: "ត្រូវបង់ដល់កសិករ", total_assets: "ទ្រព្យសកម្មសរុប", total_liabilities: "បំណុលសរុប", payment_status: "ការទូទាត់",
    paid: "បានទូទាត់", pendingpay: "មិនទាន់", credit: "ឥណទាន", deposit: "កក់ប្រាក់",
    reports_caveat: "គំរូសាមញ្ញ៖ ស្តុកគិតតាមថ្លៃទិញជាមធ្យម ហើយថ្លៃដើមទំនិញលក់ត្រូវបានប៉ាន់ស្មានពីការទិញសរុប។",
    permission_denied: "ទំព័រនេះមើលឃើញសម្រាប់តែ HQ Admin ប៉ុណ្ណោះ។",
    role_admin: "HQ Admin", role_manager: "អ្នកគ្រប់គ្រងទីតាំង", role_staff: "បុគ្គលិកទីតាំង",
    bank_name: "ធនាគារ", bank_account: "លេខគណនីធនាគារ", quality_grade: "ថ្នាក់គុណភាព",
    grade_a: "ថ្នាក់ A — ល្អបំផុត", grade_b: "ថ្នាក់ B — ស្តង់ដារ", grade_c: "ថ្នាក់ C — គុណភាពទាប",
    company_name: "ឈ្មោះក្រុមហ៊ុន", destination: "គោលដៅ",
    dest_hq: "HQ បាត់ដំបង", dest_factory: "រោងចក្រ ភ្នំពេញ", dest_border: "ព្រំដែនវៀតណាម", dest_other: "ផ្សេងទៀត",
    hq_confirmation: "ការបញ្ជាក់ពី HQ", hq_processing: "កំពុងដំណើរការ", hq_paid: "បានទូទាត់", hq_cancelled: "បានលុបចោល",
  },
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem("paddytrade_lang") || "km");

  useEffect(() => {
    localStorage.setItem("paddytrade_lang", lang);
    document.documentElement.lang = lang;
  }, [lang]);

  function t(key, vars = {}) {
    let str = translations[lang]?.[key] ?? translations.en[key] ?? key;
    Object.entries(vars).forEach(([k, v]) => { str = str.replaceAll(`{${k}}`, v); });
    return str;
  }

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
