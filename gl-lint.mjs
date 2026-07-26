#!/usr/bin/env node
/* ═══ GulfLedger Consistency Linter ═══════════════════════════════════════
   Run:  node gl-lint.mjs [folder]      (default: current folder)
   Fails loudly on drift. This is the definition of "consistent":
     R1  page loads gl-design-system.css + .v2.css + gl-command.js
     R2  no local body font-family (typography is the shell's)
     R3  no physical text-align:left/right in inline styles (logical only)
     R4  tables use a contract class (tbl/db-table/r-table/gl-table/…)
     R5  links point only at registry pages or self-anchors
     R6  no static Arabic-only text in leaf elements without data-ar/en
   Exit code 1 on any violation — wire into CI or run before any upload. */
import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const DIR = process.argv[2] || '.';
const REGISTRY = new Set([
  'dashboard.html','purchasing.html','inventory.html','invoices.html',
  'finance.html','accounting.html','reports.html','settings.html',
  'audit.html','statements.html','branch-report.html','locations.html',
  'customer-detail.html','vendor-detail.html','invoice-view.html',
  'credit-note-view.html','debit-note-view.html','login.html','signup.html',
  'join.html','plans.html','index.html','expenses.html','ledger.html','vat.html'
]);
const SKIP = new Set(['index.html','login.html','signup.html','join.html','plans.html',
  'expenses.html','ledger.html','vat.html',
  'payroll.html',        // retired orphan — delete-listed
  'invoice-view.html','credit-note-view.html','debit-note-view.html']); // customer-facing document page: self-managed lang + print typography // marketing/auth/stubs: chrome rules off
const TABLE_OK = /class="[^"]*\b(tbl|db-table|r-table|gl-table|drawer-table|receipt-items-table|slip-tbl|report-table|br-table)\b/;
const AR = /[\u0600-\u06FF]/, LAT = /[A-Za-z]/;

let violations = 0;
const flag = (f, rule, msg) => { console.log(`  ✗ ${rule} ${f}: ${msg}`); violations++; };

for (const f of readdirSync(DIR).filter(x => x.endsWith('.html'))) {
  const h = readFileSync(join(DIR, f), 'utf8');
  const app = !SKIP.has(f);

  if (app) {
    if (!h.includes('gl-design-system.v2.css')) flag(f, 'R1', 'missing v2 css');
    if (!h.includes('gl-command.js')) flag(f, 'R1', 'missing gl-command.js (shell)');
    const bodyFont = h.match(/body\s*{[^}]*font-family\s*:\s*(['"]?[A-Za-z][^;}]*)/);
    if (bodyFont && !bodyFont[1].includes('var(') && !bodyFont[1].includes('IBM Plex')) flag(f, 'R2', `local body font: ${bodyFont[1].slice(0,40)}`);
  }
  if (app) {
    for (const m of h.matchAll(/style="[^"]*text-align:\s*(left|right)\b[^"]*"/g))
      flag(f, 'R3', `physical alignment "${m[1]}" in inline style`);
    for (const m of h.matchAll(/<table(?![^>]*class=)[^>]*>/g))
      flag(f, 'R4', 'classless <table>');
    for (const m of h.matchAll(/<table[^>]*class="([^"]*)"/g))
      if (!TABLE_OK.test(m[0])) flag(f, 'R4', `table outside contract: "${m[1].slice(0,40)}"`);
  }
  for (const m of h.matchAll(/href="([a-z-]+\.html)"/g))
    if (!REGISTRY.has(m[1])) flag(f, 'R5', `link to unregistered page: ${m[1]}`);
  let arOnly = 0;
  for (const m of h.matchAll(/<(label|span|th|button|p|small|option)([^>]*)>([^<>{}$]{4,80})<\/\1>/g)) {
    const [ , , attrs, txt ] = m;
    if (attrs.includes('data-ar')) continue;
    const t = txt.trim();
    if (AR.test(t) && !LAT.test(t) && t !== 'عربي') arOnly++;
  }
  if (app && arOnly) flag(f, 'R6', `${arOnly} Arabic-only static leaf(s) without data-ar/en`);
}
console.log(violations ? `\n${violations} violation(s) — NOT consistent.` : '\n✓ All pages consistent.');
process.exit(violations ? 1 : 0);
