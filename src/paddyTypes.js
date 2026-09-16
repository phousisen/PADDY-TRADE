// The paddy type list — ONE list, shared by all five stations.
//
// [2026-09-15] WHAT WAS WRONG
//
// The New Ticket dropdown was built from a list written into the source code:
//
//   const PADDY_TYPE_SEED = ["សែន ក្រអូប", "ផ្កា ម្លីះ", "ស្រង៉ែ", "ផ្កា រំដួល", "5451"];
//
// plus whatever each station had typed into "+ Add new type…", remembered in
// THAT BROWSER's localStorage. Two consequences, both of which happened:
//
//   1. Every station had a different list. Jomnoum's additions were invisible
//      at Pong Ro, so the same rice was typed fresh at each station and became
//      a separate paddy type at each one. 51 transactions and 52 tickets had
//      to be merged back together by hand on 2026-09-15.
//
//   2. The hardcoded list could not follow the database. It still offered
//      "5451" after that type was merged away, so the first ticket after a
//      page refresh would have re-created it and started the drift again.
//
// WHAT THIS DOES INSTEAD
//
// The list IS the products table. Nothing here can invent a paddy type; the
// only names offered are names that already exist in the database, so all
// five stations see the same options and a merge stays merged.
//
// Offline is unaffected. offlineQueue already keeps a copy of the products
// table on each device (setCachedProducts, written every time a lookup
// succeeds), so a station with no internet opens the dropdown on the last
// list it saw. A station that has never once been online sees an empty list
// — which is correct: it has no way to know what the types are, and guessing
// is what caused this. It can still take the truck through "Other".

// Deliberately imports NOTHING but productName.js — no React, no api, no
// offlineQueue. That is what lets scripts-check-paddy-types.mjs import this
// file and actually run its logic in plain node, instead of eyeballing it.
// The React hook that loads the list lives in usePaddyTypes.js.
import { cleanProductName, productKey } from "./productName.js";

// The catch-all. A real row in the products table like any other, so a ticket
// saved against it has a genuine product_id, its kilos appear in Stock by
// Paddy Type, and nothing is silently dropped — but staff picking it can
// never create a NEW type, which is the whole point.
//
// [2026-09-15] SISEN to confirm the Khmer word; this is the only place it is
// written, so changing it is a one-line edit here plus the two i18n keys.
export const OTHER_PADDY_TYPE = "ផ្សេងៗ";

export function isOtherPaddyType(name) {
  return productKey(name) === productKey(OTHER_PADDY_TYPE);
}

// DISPLAY ORDER ONLY — this list can never decide which types exist.
//
// Staff reach a type by pressing its number, so the order has to stay put
// day to day or the muscle memory built at 6am stops working. A name that is
// not on this list still appears, after these, in the order the database
// returns (alphabetical). A name ON this list that no longer exists in the
// database simply does not appear at all.
const PREFERRED_ORDER = ["សែន ក្រអូប", "5451", "ស្រង៉ែ", "ផ្កា ម្លីះ", "ផ្កា រំដួល"];

function rank(name) {
  const key = productKey(name);
  // Other always sits last, after everything real.
  if (isOtherPaddyType(name)) return Number.MAX_SAFE_INTEGER;
  const i = PREFERRED_ORDER.findIndex((n) => productKey(n) === key);
  return i === -1 ? PREFERRED_ORDER.length : i;
}

// Product rows → the names to show, cleaned, de-duplicated by the same key
// the database's unique index uses, and ordered as above.
export function paddyTypeNames(rows) {
  const seen = new Set();
  const names = [];
  for (const row of rows || []) {
    const name = cleanProductName(row?.name);
    if (!name) continue;
    const key = productKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The options for one dropdown.
 *
 * @param {string[]} types    from usePaddyTypes
 * @param {string}   current  the value already on this ticket, if any — kept
 *                            on the list even if it is no longer a type, so
 *                            editing an old ticket does not silently blank
 *                            its paddy type
 */
export function paddyTypeOptions(types, current) {
  const list = [...(types || [])];
  const has = (name) => list.some((n) => productKey(n) === productKey(name));
  if (!has(OTHER_PADDY_TYPE)) list.push(OTHER_PADDY_TYPE);
  const cur = cleanProductName(current);
  if (cur && !has(cur)) list.unshift(cur);
  return list;
}
