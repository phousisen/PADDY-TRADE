// Proves the paddy type list cannot drift apart again.
//
// [2026-09-15] Run:  node scripts-check-paddy-types.mjs
//
// WHY THIS EXISTS
//
// The same rice became a separate paddy type at each station, because the
// dropdown was built from a list written into the source code plus a list
// kept in each browser. 51 transactions and 52 tickets had to be merged back
// by hand, and two paddy types were showing a NEGATIVE stock balance.
//
// Every assertion below is a way that could happen again.

import fs from "node:fs";
import path from "node:path";
import {
  OTHER_PADDY_TYPE, isOtherPaddyType, paddyTypeNames, paddyTypeOptions,
} from "./src/paddyTypes.js";
import { productKey } from "./src/productName.js";

let failures = 0;
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n          ${detail}` : ""}`);
  }
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const FILES = sourceFiles("src");
const read = (f) => fs.readFileSync(f, "utf8");
// Comments describe history; only real code can cause it to repeat.
const codeOf = (f) =>
  read(f)
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

console.log("\n1. Nothing may hold a paddy type list of its own\n");

// The five real names. If any of these is sitting in a source file as a
// string literal outside paddyTypes.js's display-order list, something is
// hardcoding the list again.
const REAL_TYPES = ["សែន ក្រអូប", "ស្រង៉ែ", "ផ្កា ម្លីះ", "ផ្កា រំដួល"];
for (const file of FILES) {
  if (file.endsWith(path.join("src", "paddyTypes.js"))) continue;
  const code = codeOf(file);
  const found = REAL_TYPES.filter((n) => code.includes(n));
  check(
    `${file} holds no paddy type names`,
    found.length === 0,
    found.length ? `found: ${found.join(", ")}` : "",
  );
}

check(
  "no per-device paddy type list survives anywhere",
  !FILES.some((f) => /ptw_custom_paddy_types|getCustomPaddyTypes|addCustomPaddyType|PADDY_TYPE_SEED/.test(codeOf(f))),
  "a localStorage paddy type list is what made every station different",
);

console.log("\n2. Nothing but the Owner may create a paddy type\n");

// createProduct is the only way a paddy type is born. Two call sites are
// legitimate: api.js (the function itself) and offlineQueue.js's
// resolveProductIdOffline, which is reached ONLY from an Owner's
// "+ Add new type…" now that every field is a dropdown over existing names.
const creators = FILES.filter((f) => /\bcreateProduct\s*\(/.test(codeOf(f)));
const ALLOWED_CREATORS = [path.join("src", "api.js"), path.join("src", "offlineQueue.js")];
check(
  "createProduct is called from api.js and offlineQueue.js only",
  creators.every((f) => ALLOWED_CREATORS.some((a) => f.endsWith(a))),
  `also called from: ${creators.filter((f) => !ALLOWED_CREATORS.some((a) => f.endsWith(a))).join(", ")}`,
);

// A datalist suggests; it does not constrain. A free-text product field is
// how a typo became a paddy type.
for (const file of FILES) {
  const code = codeOf(file);
  check(
    `${path.basename(file)} has no free-text product field`,
    !/list=["']\S*product\S*-options["']/i.test(code),
    "an <input list=...> accepts anything typed into it",
  );
}

// Every "+ Add new type" OPTION must sit behind the Owner check. i18n.jsx
// merely defines the words, so it is not a gate and is not checked here.
for (const file of FILES) {
  if (file.endsWith(path.join("src", "i18n.jsx"))) continue;
  const code = codeOf(file);
  const adds = code.split("\n").filter((l) => l.includes("wt_add_new_type"));
  for (const line of adds) {
    check(
      `${path.basename(file)}: "add new type" is Owner-gated`,
      line.includes("canAddPaddyType"),
      line.trim(),
    );
  }
}

console.log("\n3. The list itself behaves\n");

const rows = [
  { id: "1", name: "ស្រង៉ែ" },
  { id: "2", name: "សែន ក្រអូប" },
  { id: "3", name: "5451" },
  // The same name again, carrying a zero-width space — exactly the
  // duplicate the database's unique index exists to stop.
  { id: "4", name: "សែន​ក្រអូប" },
  { id: "5", name: "   " },
  { id: "6", name: null },
];
const names = paddyTypeNames(rows);

check("blank and null names are dropped", !names.some((n) => !n || !n.trim()));
// Row 4 is row 2 with a zero-width space wedged in beside the real space —
// it draws identically and is what a Khmer keyboard actually produces.
check(
  "an invisible-character duplicate collapses into one entry",
  names.filter((n) => productKey(n) === productKey("សែន ក្រអូប")).length === 1,
  `got: ${JSON.stringify(names)}`,
);
// The opposite case: a name whose SPACING really differs is a different
// name, and must not be silently swallowed.
check(
  "a genuinely different spelling is NOT collapsed",
  paddyTypeNames([{ id: "a", name: "សែន ក្រអូប" }, { id: "b", name: "សែនក្រអូប" }]).length === 2,
);
check(
  "the preferred order is honoured — សែន ក្រអូប first, then 5451",
  names[0] === "សែន ក្រអូប" && names[1] === "5451",
  `got: ${JSON.stringify(names)}`,
);

const opts = paddyTypeOptions(names);
check("Other is always offered", opts.some(isOtherPaddyType));
check("Other is offered exactly once", opts.filter(isOtherPaddyType).length === 1);
check(
  "Other sits last, after every real type",
  isOtherPaddyType(opts[opts.length - 1]),
  `got: ${JSON.stringify(opts)}`,
);
check(
  "Other is not duplicated when it is already a real product row",
  paddyTypeOptions(paddyTypeNames([...rows, { id: "7", name: OTHER_PADDY_TYPE }]))
    .filter(isOtherPaddyType).length === 1,
);

// Editing an old ticket must not silently blank a type that has since been
// merged away — that would quietly move its kilos to whatever staff pick.
const withRetired = paddyTypeOptions(names, "OM5451");
check(
  "a retired type on an existing ticket stays on that ticket's list",
  withRetired.includes("OM5451"),
  `got: ${JSON.stringify(withRetired)}`,
);
check(
  "a type already on the list is not added twice by being the current one",
  paddyTypeOptions(names, "5451").filter((n) => n === "5451").length === 1,
);
check(
  "an invisibly-different current value is recognised, not re-added",
  paddyTypeOptions(names, "សែន​ ក្រអូប")
    .filter((n) => productKey(n) === productKey("សែន ក្រអូប")).length === 1,
);

console.log("\n4. Other is a real type, not a magic string\n");

check("Other has a name", !!OTHER_PADDY_TYPE.trim());
check("Other survives cleaning unchanged", productKey(OTHER_PADDY_TYPE) === productKey(OTHER_PADDY_TYPE.trim()));
check("Other is not mistaken for a real type", !isOtherPaddyType("សែន ក្រអូប") && !isOtherPaddyType("5451"));
check("Other is recognised through invisible characters", isOtherPaddyType(`${OTHER_PADDY_TYPE}​`));
check("an empty value is not Other", !isOtherPaddyType("") && !isOtherPaddyType(null));

console.log("\n5. Picking Other must say what the rice is\n");

const wt = read(path.join("src", "pages", "WeighingTickets.jsx"));
check(
  "saving with Other and no description is blocked",
  /isOtherPaddyType\(productName\)\s*&&\s*!otherNote\.trim\(\)/.test(wt),
);
check(
  "the description rides along on the ticket",
  /note:\s*isOtherPaddyType\(productName\)/.test(wt),
);
const apiSrc = read(path.join("src", "api.js"));
check(
  "createTicket sends note, and sends null when there isn't one",
  /note:\s*note\s*\|\|\s*null/.test(apiSrc),
);

console.log(
  failures === 0
    ? `\nAll checks passed. ${FILES.length} source files; one paddy type list, from the database, for all five stations.\n`
    : `\n${failures} FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
