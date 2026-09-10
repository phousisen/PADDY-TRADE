// [2026-09-10] One definition of "the same paddy type", shared by the app and
// the database.
//
// WHY THIS EXISTS
//
// "សែន ក្រអូប" appeared seven times on Stock by Paddy Type as seven separate
// rows, and the Stock screen showed several types at a NEGATIVE balance —
// paddy sold under one row that had been bought under a different row that
// looked identical.
//
// They looked identical because they were. What differed was invisible:
//
//   * Khmer input methods insert zero-width characters (U+200B zero-width
//     space, U+200C non-joiner, U+200D joiner, U+FEFF byte-order mark). None
//     of them render. All of them make two strings unequal.
//   * The same Khmer word can be stored in more than one Unicode
//     normalisation — the same characters in a different order — and still
//     draw the same glyphs.
//   * Stray leading/trailing spaces, and doubled spaces inside the name.
//
// The app was comparing typed names with `.trim().toLowerCase()`, which sees
// through none of that. So every station's device eventually decided its own
// "សែន ក្រអូប" was a paddy type nobody had ever bought, and created it.
//
// productKey() below is the JavaScript twin of the `product_key(text)`
// function in the database (merge_products.sql). The two MUST stay in step:
// the database has a unique index on its version, so if this one is looser
// the app will offer a name the database then rejects, and if it is stricter
// the app will merge two types the database considers different.
//
//   SQL:  lower(btrim(collapse_spaces(strip_invisible(normalize(name, NFC)))))
//   JS:   the same four steps, in the same order.

const INVISIBLE = /[​‌‍﻿]/g;

// The name as it should be STORED and shown: cleaned, but with the person's
// own capitalisation left alone ("OM 5451" stays "OM 5451").
export function cleanProductName(name) {
  return String(name ?? "")
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The name as it should be COMPARED: cleaned, then case-folded. Two paddy
// types are the same type when their keys match.
export function productKey(name) {
  return cleanProductName(name).toLowerCase();
}

// Find a paddy type in a list by name, seeing through everything above.
// Returns the product row, or null.
export function findProductByName(products, name) {
  const key = productKey(name);
  if (!key) return null;
  return (products || []).find((p) => productKey(p?.name) === key) || null;
}
