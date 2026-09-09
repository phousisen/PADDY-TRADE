// [2026-09-09] One place that turns an Error into words the person reading
// it can actually read.
//
// The problem this solves: the messages that matter most at a weighbridge —
// a save that did not confirm, a queue that has stopped, a device out of
// storage — are thrown deep inside offlineQueue.js, which is plain
// JavaScript with no access to React context and therefore no access to the
// translator. So they were English-only, at exactly the moment when reading
// your own language matters most.
//
// Rather than thread the translator down into the queue (which would mean a
// language change never reaching an error already thrown, and a module that
// suddenly depends on React), a thrown Error carries a TAG:
//
//     err.i18n = { key: "err_storage_ticket", vars: { ... } }
//
// and whoever displays it calls errText(t, err). The English message stays
// on err.message exactly as before, so anything that has not been updated —
// a console log, a catch block somewhere else, an older screen — behaves
// identically. Nothing regresses; screens that opt in get Khmer.
//
// Errors from Supabase and the browser itself are not tagged and fall
// through to their own English text. That is honest: inventing a Khmer
// translation of a server message we did not write would be guessing at
// what it means.

export function tagError(err, key, vars, tailKey) {
  if (err && typeof err === "object") err.i18n = { key, vars: vars || {}, tailKey: tailKey || null };
  return err;
}

export function errText(t, err, fallbackKey) {
  const tag = err && typeof err === "object" ? err.i18n : null;
  if (tag && tag.key) {
    // A var named `<name>Key` holds a translation key rather than a value,
    // so a word inside the sentence ("ticket" / "entry") can be translated
    // too instead of arriving in English inside a Khmer message.
    const vars = { ...(tag.vars || {}) };
    for (const name of Object.keys(vars)) {
      if (name.endsWith("Key") && typeof vars[name] === "string") {
        vars[name.slice(0, -3)] = t(vars[name]);
        delete vars[name];
      }
    }
    const parts = [t(tag.key, vars)];
    // A message assembled from two sentences (the unconfirmed-save warning
    // is head + tail) keeps both halves in the tag rather than being
    // pre-joined, so each half can be translated on its own.
    if (tag.tailKey) parts.push(t(tag.tailKey, vars));
    return parts.join(" ");
  }
  const msg = err && err.message ? String(err.message) : "";
  if (msg) return msg;
  return fallbackKey ? t(fallbackKey) : t("err_generic");
}
