// scripts-check-shell.mjs — the white screen of 20 September 2026.
// An old saved index.html asked for build files that no longer exist; the
// main file 404'd, nothing ran, the window stayed white. index.html now heals
// itself. This holds that in place. Run: node scripts-check-shell.mjs
import { readFileSync } from "node:fs";
let failed = 0;
const ok = (n, c) => { console.log(`  ${c ? "ok  " : "FAIL"}  ${n}`); if (!c) failed++; };
const html = readFileSync("index.html", "utf8");
const main = readFileSync("src/main.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const guardAt = html.indexOf('window.addEventListener("error"');
ok("index.html listens for a failed /assets/ file", guardAt > 0 && html.includes('url.indexOf("/assets/")'));
ok("the guard is a plain script before the app's module", guardAt > 0 && guardAt < html.indexOf('type="module"'));
ok("it heals only once per session and only online", html.includes("pt_shell_healed") && html.includes("if (!navigator.onLine) return;"));
ok("it never touches localStorage (unsent tickets live there)", !/localStorage/.test(html.replace(/<!--[\s\S]*?-->/g, "")));
ok("main.jsx clears the flag once the app is up", /__ptShellOk\?\.\(\)/.test(main));
ok("the QR registration page has a Suspense around its lazy screen", /<Suspense fallback=\{<PageLoading \/>\}><RegisterFarmer/.test(app));
console.log(failed ? `\n${failed} FAILED` : "\nThe app cannot go white from an old saved page.");
process.exit(failed ? 1 : 0);
