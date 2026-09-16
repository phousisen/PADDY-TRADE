// Signing in with a name instead of an email address.
//
// [2026-09-16] SISEN, looking at the Add User form with a phone number
// typed into the Email box:
//
//     "what if it can be username doesnt have to be email also can?"
//
// WHAT WAS ALREADY TRUE
//
// The database's login table only knows how to store an email address —
// that is not something the app can change. But it never checks that the
// address goes anywhere. PaddyTrade has been relying on that for months
// without anyone calling it that: `boss@paddytrade.local` is not a real
// address, and neither are `cnregister@paddytrade.com` or
// `baitang@paddytrade.com`. They are usernames with a domain stuck on the
// end so the database accepts them.
//
// WHAT THIS DOES
//
// Makes that official, so nobody at a station has to know about the `@`
// part. Type `boss`, or `012934050`, and this puts the rest on. Type a
// real address and it is left alone.
//
// THE ONE PLACE IT MUST NOT APPLY
//
// "Email them an invite" sends an actual email. An invite to
// `012934050@paddytrade.local` can never arrive — there is no such
// mailbox anywhere. isRealAddress() is what that form asks before it
// lets the invite go.
//
// Pure on purpose: no React, no database, so scripts-check-login.mjs can
// run every rule in this file directly in node.

// The domain put on the end of a bare name. Not a real domain — it is
// reserved by standard (RFC 6761) precisely so it can never be routed
// anywhere, which is the honest choice for an address that is not meant
// to receive mail.
export const LOGIN_DOMAIN = "paddytrade.local";

// Domains already in use for the same purpose before this file existed.
// Their accounts must keep working and must keep reading as names.
const HOUSE_DOMAINS = [LOGIN_DOMAIN, "paddytrade.com"];

/**
 * Is what someone typed a name, or an address?
 *
 * An address has an `@` in it. That is the whole rule, and it is the
 * rule on purpose — anything cleverer would eventually disagree with
 * what the person typing thought they were doing.
 */
export function looksLikeEmail(input) {
  return String(input || "").includes("@");
}

/**
 * Turn a typed name into something the login table will accept.
 *
 *   "boss"                -> "boss@paddytrade.local"
 *   "012934050"           -> "012934050@paddytrade.local"
 *   "  BOSS  "            -> "boss@paddytrade.local"
 *   "sisen@gmail.com"     -> "sisen@gmail.com"      (left alone)
 *   ""                    -> ""                     (the form's problem)
 */
export function toLoginEmail(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (looksLikeEmail(raw)) return raw.toLowerCase();
  return `${cleanName(raw)}@${LOGIN_DOMAIN}`;
}

/**
 * Strip a typed name down to what an address is allowed to contain.
 *
 * Khmer script, spaces and punctuation are NOT allowed in the local part
 * of an address, and a login that the database rejects is worse than one
 * that looks a little different from what was typed. Letters, digits and
 * `. _ -` survive; a space becomes `.`; everything else is dropped.
 */
export function cleanName(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    // A name that starts or ends with a dot is not a valid address.
    .replace(/^[.]+|[.]+$/g, "")
    .replace(/[.]{2,}/g, ".");
}

/**
 * Can a real email actually be delivered here?
 *
 * Deliberately strict in the "no" direction: anything this is unsure
 * about is treated as undeliverable, because the cost of a wrong "yes"
 * is an invite that silently never arrives and a person waiting for it.
 */
export function isRealAddress(input) {
  const v = String(input || "").trim().toLowerCase();
  if (!looksLikeEmail(v)) return false;
  const at = v.indexOf("@");
  const name = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!name || !domain) return false;
  if (v.indexOf("@", at + 1) !== -1) return false;   // two @ signs
  if (/\s/.test(v)) return false;
  if (HOUSE_DOMAINS.includes(domain)) return false;  // ours, not routable
  if (domain.endsWith(".local")) return false;       // reserved, never routes
  if (!domain.includes(".")) return false;           // no bare "gmail"
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  return true;
}

/**
 * How an account should be shown back to a person.
 *
 * `boss@paddytrade.local` is shown as `boss`, because the domain was
 * never anything the owner typed or should have to read. A genuine
 * address is shown in full — hiding half of `sisen@gmail.com` would be
 * a lie about what the account is.
 */
export function loginLabel(email) {
  const v = String(email || "").trim();
  if (!v) return "";
  const at = v.lastIndexOf("@");
  if (at <= 0) return v;
  const domain = v.slice(at + 1).toLowerCase();
  return HOUSE_DOMAINS.includes(domain) ? v.slice(0, at) : v;
}
