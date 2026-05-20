# GulfLedger SaaS — Handover Document

**Date:** May 20, 2026  
**Last completed:** Round 30 (Migration 37 + dashboard.html v2026.05.20-13 — dashboard correctness fixes)  
**Next:** Optional cleanup work — no P1/P2 critical items remain.

---

## 1. Project Positioning

**Product:** GulfLedger — ZATCA-compliant accounting SaaS for Saudi SMEs.

**Repository:** `Munsif84/gulfledger` → `gulfledger.vercel.app`  
**Supabase:** `https://ykzivnasjwtuhvjxfxzf.supabase.co`  
**Trial business_id:** `ebfa6b05-23fa-4d58-ac80-06798a13723c`

**Target users:** SME business owners and small accountants in Saudi Arabia. **Critically: non-accountants.** The system must be autonomous and 100% accurate. Users cannot be expected to know GAAP, debit/credit logic, or ZATCA Form 201 mechanics. The system makes the accounting decisions; the user just operates their business.

**Compliance bar:** ZATCA Phase 2 e-invoicing. Strict invoice numbering, audit trail, VAT reconciliation, retention requirements.

**Stack:** Vanilla HTML/JS (no framework), Supabase backend, Arabic-first RTL, deployed on Vercel.

**Founder (Munsif):** Solo founder. Code-reads at intermediate level. Pastes SQL diagnostics and CSV results back. Sometimes paste-bombs raw data when frustrated — that's a signal to be more careful with assumptions, not less.

---

## 2. User Mindset & Operating Rules

These came up repeatedly across the conversation. Internalize them — they override "default helpful" patterns.

### "No quick fixes. Long-term solutions only."
He has explicitly rejected patches when something deeper is wrong. Round 24 he caught me iterating 3 times before getting BS balanced; Round 25-26 took 7+ iterations on VAT. Each time the fundamental issue was patching without diagnosing root cause first.

### "Don't accept discrepancies. Fix and investigate until you find root cause."
When VAT Box 6 was 12% off, his response was "fix to the dot." Same when balance sheet showed 796K imbalance. He doesn't tolerate "good enough."

### "Do what's best practice in the industry and compliant with ZATCA."
When given options, default to industry-standard. He picked Option 1 on bank multi-account (full proper implementation), not the minimum viable path.

### "Works for various business types and shapes."
This is why we did the entire Round 18-20 role-based architecture. The system can't assume a specific chart of accounts. Every automated posting goes through `account_role_map`, never hardcoded codes.

### "Verify schema before writing functions."
Called this out twice. I committed to it in Round 19 audit. Still failed it occasionally:
- Round 22 needed hotfix 28a because I didn't check the old RPC signature
- Round 25 had a 400 error because I didn't verify `vat_pct` column existence

**Mandatory pattern:** before writing any SQL function or RPC, run a diagnostic to check column names. Before rewriting any function, pull the existing function body via `pg_get_functiondef()`. Don't recreate from memory.

### Test data philosophy
"Test data will be eventually all cleared and test will run again with clean data, so we need to follow industry standard not otherwise." Don't compromise architecture to fit current messy test data. Build the right system; messy data will be reset.

### Conversation style
Short replies. Direct. Sometimes one-word ("a", "1", "next round", "green", "success"). He has limited capacity to read long explanations — keep responses scoped to actual decisions and code changes. Avoid victory-lap summaries; ship the work and move on.

---

## 3. Architecture (as of Round 30)

### Core principle: Single Source of Truth = General Ledger

Everything derives from `journal_entries` + `journal_lines`. Sub-ledgers (bank accounts, customer balances, supplier balances, VAT reports) reconcile to GL by construction, not by separate maintenance.

### Multi-tenant chart of accounts

Each business has its own `chart_of_accounts`. Automated posting code uses **semantic roles** (e.g., `ar_primary`, `vat_output`, `inventory_primary`) that resolve to that business's specific account codes via `account_role_map`.

The role system has:
- **`role_catalog`** — 34 system-defined roles (Round 18 + Round 20a)
- **`account_role_map`** — per-business mapping (role → account_code)
- **`resolve_role(business_id, role)`** + **`resolve_roles_batch`** — RPCs to look up
- **Fallback chains** for non-sensitive roles (Round 19a)
- **`allow_silent_fallback` column** — sensitive roles (`vat_*`, `ap_primary`, `ar_primary`, etc.) refuse to fall back; they trigger the setup wizard if unmapped

### Atomic ledger (Round 17)

`post_journal_entry_atomic(business_id, entry_date, reference, description, source, source_id, lines)` is the canonical entry-poster. Validates balance, refuses unbalanced entries. CHECK constraints on `journal_lines.debit/credit`. Period-close trigger on `journal_entries` (Round 21) blocks inserts into filed periods.

**But most JS modules INSERT journal_entries directly** rather than calling this RPC. The period-close trigger catches them all regardless. We haven't refactored JS to use the RPC universally — was discussed but not prioritized.

### Voids/reversals

`void_invoice_atomic`, `void_expense_atomic`, `void_receipt_atomic` exist as RPCs but are NOT called from JS (JS uses direct INSERTs for reversal journals). They're there for safety; the trigger covers the same enforcement.

### Period close

`filings` table tracks filed periods. Round 21 added a BEFORE INSERT trigger on `journal_entries` that blocks posting into any filed period. The user has Q1 2026 filed; reversals dated in that period are rejected.

### Invoice numbering

`invoice_sequences` table per (business, year). `next_invoice_number(business, date)` RPC uses INSERT ON CONFLICT DO UPDATE RETURNING for atomic race-proof claiming. UNIQUE constraint on `invoices(business_id, invoice_number)` as defense-in-depth.

### Bank/cash sub-ledger (LIVE as of Round 28)

`bank_accounts` table tracks user-facing bank/cash accounts. Each links to a specific GL account via `gl_account_code`. `bank_transactions` is a derived sub-ledger — populated by the `sync_bank_transactions_on_journal_line` trigger on `journal_lines AFTER INSERT`, never written to directly by JS.

**Architecture is fully live:**
- Trigger `_trg_sync_bank_transactions` is attached (Migration 36) and on every journal_line insert that hits a GL-linked bank_account: (a) inserts a matching bank_transactions row, (b) refreshes `bank_accounts.current_balance` via `bank_account_balance()`.
- JS modules no longer write to bank_transactions directly. All 6 historical insert sites in invoices.html and finance.html were refactored in Round 28 Part 2.
- The constraint `bank_tx_source_type_check` was widened (Migration 35a) to accept the full `je.source` taxonomy.
- Round 29 added UI: GL Account picker in the bank-account modal, conflict messages on UNIQUE violations, "⚠ Not linked" badge on cards where `gl_account_code IS NULL`.

If the trigger is ever dropped or detached, the bank module goes silent (new payments stop appearing). Always drop + reattach inside a single migration with explicit backfill if making changes.

### VAT report (Round 25-26)

Both `vat.html` and `accounting.html`'s VAT compliance report are GL-derived. Form 201 boxes computed entirely from `journal_lines` filtered by role-resolved VAT accounts. Sales returns segregated into Box 13 via dedicated `4190 Sales Returns` account (industry standard).

---

## 4. Critical Schema Facts (verified)

| Item | Detail |
|---|---|
| `chart_of_accounts` | `(business_id, code)` UNIQUE; has `type, is_header, parent_code, normal_balance`; `user_id` now nullable |
| `journal_entries` | `business_id, entry_date, status, source, source_id, is_balanced`; period-close trigger on INSERT |
| `journal_lines` | `entry_id, account_code, debit, credit, description`; balance CHECKs enforced |
| `invoices` | **NO `vat_pct` column** (only `vat_amount, subtotal, total`); UNIQUE on `(business_id, invoice_number)` |
| `expenses` | Has `vat_amount, vat_recoverable, subtotal`; `voided_at, voided_by_id, void_reason` columns |
| `stock_receipts` | Has `amount_paid, payment_method, payment_status`; NO `voided_at/by_id` (per Round 17 hotfix); now has `bank_account_id` (Round 27) |
| `filings` | `business_id, filing_type, period_from, period_to, status, filed_at`; status='filed' means closed |
| `bank_accounts` | Now has `gl_account_code` (Round 27); UNIQUE `(business_id, gl_account_code)` |
| `bank_transactions` | Existing parallel sub-ledger; has `account_id`, `source_type`, `source_id`, `transaction_type` (deposit/withdrawal) |

### Trial business CoA quirks

- `5100` and `5200` both named "Cost of Goods Sold" (duplicate name; 5100 is active for invoices)
- `4190 Sales Returns` added in Round 26 (Migration 33)
- VAT accounts: `2200` Output (liability), `2210` Input (asset, recoverable), `2220` Net Settlement (liability)
- Cash: `1100` (the only one); Bank: `1101` (defined but no transactions)
- `account_role_map` for trial business has 29 mappings as of Round 26 (added `sales_returns → 4190`)

### Filed periods on trial business
- FY 2023, 2024, 2025 — annual
- Qawaem 2025
- VAT Q4 2025
- VAT Q1 2026

Reversals/posts dated within these periods are blocked by the period-close trigger.

---

## 5. Rounds Completed (17 through 30)

### Round 17 — Accounting Integrity Hardening
- `post_journal_entry_atomic`, `void_*_atomic` RPCs
- CHECK constraints on journal_lines
- Idempotency triggers, prevent-delete triggers
- **Migrations:** 16, 17, 17a (voided_at columns), 17b (void_invoice columns), 18, 18b
- Final state: 482 entries, all balanced, sum_debits = sum_credits = 6,238,521.68

### Round 18 — Multi-tenant CoA via Semantic Role Mappings
- `role_catalog` (34 roles), `account_role_map`, `resolve_role`, `resolve_roles_batch`
- Auto-detect with confidence scoring
- Settings UI for review
- Inline wizard for unmapped roles
- **Migrations:** 19, 20, 20a (auth.uid null tolerance), 20b (coa.normal column fix), 20c, 21, 22, 22a (label_en ambiguity fix)
- **accounting.html v2026.05.18-30**

### Round 19 — Full P1/P2 audit
- Documented in `AUDIT-ROUND19-FULL-SYSTEM.md`
- 6 P1 items identified, 7 P2 items identified

### Round 19a — Controlled fallback + proper accounts
- **Migration 23:** `allow_silent_fallback` column on `role_catalog`; 21 sensitive roles marked `false`
- **Migration 24:** added 1410 Prepaid Rent, 1490 Accum Depreciation, 5950 Depreciation Expense, 6500 Bad Debt Expense, 9100 Interest Expense

### Round 20a — Catalog expansion
- **Migration 25:** 8 new roles (sales_zero_rated, sales_exempt, sales_export, sales_returns, service_revenue, vat_payable_net, inventory_writeoff_expense, inventory_adjustment_gain, grni)
- **Migration 26 + 26a:** auto-mapped trial business; manual override for vat_payable_net → 2220; hotfix for inventory_primary

### Round 20b-d — Refactor automated posting off hardcoded codes
- **invoices.html v2026.05.19-35:** `_useSocpa` removed, `_roleCodes` cache + `_initRoleCodes` + inline wizard. 13 required roles.
- **finance.html v2026.05.19-32:** same pattern. 10 roles incl CASH/BANK.
- **inventory.html v2026.05.19-33:** same pattern. 11 roles incl INV_WRITEOFF, INV_ADJ_GAIN, OWNER_CAPITAL.
- **KNOWN LIMITATION:** `finance.html EXPENSE_CATEGORIES` still hardcoded (13 categories like rent→5300). Deferred to "Round 21b."

### Round 21 — P1.3 Period close enforcement
- **Migration 27:** BEFORE INSERT trigger on journal_entries via `_is_date_in_closed_period` helper
- Single point of enforcement covers ALL paths (direct INSERTs + RPC calls)

### Round 22 — P1.4 Invoice number race condition
- **Migration 28 (failed) → 28a (working):** drops old `next_invoice_number(UUID)`, creates `invoice_sequences` table, new `next_invoice_number(UUID, DATE)` RPC using atomic INSERT ON CONFLICT DO UPDATE RETURNING, UNIQUE constraint on `(business_id, invoice_number)`
- **invoices.html v2026.05.19-34:** `fetchNextInvoiceNumber` now read-only preview, `claimNextInvoiceNumber` at save time

### Round 23 — P1.5 Dangerous user_id cascades
- **Migration 29:** changed 10 business-content tables (invoices, journal_entries, customers, suppliers, inventory_*, etc.) from CASCADE to SET NULL on user_id FK
- `businesses.user_id` → RESTRICT (block deletion of owner while business exists)
- `chart_of_accounts.user_id` → nullable
- Left 8 internal Supabase auth tables + business_users + subscriptions as CASCADE (correct)

### Round 24 — P1.6 Accounting equation validators
- **accounting.html v2026.05.19-37:** balance pill on BS + TB
- User reported 796K BS imbalance. Took 3 iterations to fix:
  - Bug 1: Filter `&& a.parent_code` excluded orphan accounts → replaced all 11 places with `&& !a.is_header`
  - Bug 2: BS summed only POSITIVE balances — negative-net assets (Bank overdrawn, AR overpaid) silently dropped. Fixed by signed-sum math.
  - **Migration 30:** assigned parent_code + normal_balance to 4 orphan accounts
- Final result: "green" — fully reconciled

### Round 25-26 — P2.6 VAT report GL reconciliation

This took multiple rounds due to compound data issues.

**Round 25 attempts:**
- vat.html refactor v2026.05.19-25 (GL-based queries)
- accounting.html `computeVatComplianceReport` v2026.05.19-38, -39, -40 (architectural rewrite)
- Discovered `vat_pct` column doesn't exist (400 errors)
- Discovered fallback-via-`resolve_roles_batch` causing last-role-wins misclassification of sales accounts → fixed by querying `account_role_map` directly

**Round 26 — data corruption discovery:**

Audit of `journal_lines` on 2210 revealed 5 categories of historical mis-routing:
1. Credit notes (CN-INV-*) debited 2210 instead of 2200
2. Debit notes (DN-*) credited 2210 instead of 2200; posted to 4000 not 4100
3. Pre-refactor invoices (INV-227-232) credited 2210 instead of 2200
4. Mis-routed GRN-017, GRN-018 to 2220 instead of 2210
5. REV-INV-2026-009 had every line DOUBLED (bug in old reversal code)

**Migrations 31, 32 cleanup:**
- 31: moved misposted VAT lines to correct accounts
- 32: deduped REV-INV-2026-009; moved remaining reversal VAT to 2200

**Final correctness issue: Box 1 went NEGATIVE** because 4100 had massive credit-note debits exceeding sales credits. Per industry best practice + ZATCA, **Migration 33** introduced separate `4190 Sales Returns` contra-revenue account:
- Added 4190 to CoA (DR-natural, parent 4000)
- Mapped role `sales_returns → 4190`
- Moved historical credit-note + reversal debits from 4100 → 4190
- Updated invoices.html v2026.05.19-35 to use `CODE.SALES_RETURNS` for credit notes
- Updated accounting.html v2026.05.19-41 to route returns to Box 13 (negative adjustment), not Box 1

**Final result CONFIRMED GREEN by user:**
- Box 1: 152,698.19 × 15% = 22,904.72 ✓
- Box 6: 2,097,526.47 × 15% = 314,628.98 ✓
- Box 13: -43,410.19 (returns)
- Net VAT due: -335,134.45 (refund)
- All boxes reconcile to GL to the cent

### Round 27 — P2.1 Bank account / GL linkage (schema only)

**Migration 34 shipped, schema only.** Trigger NOT attached in this round (intentional).

What it added:
- `bank_accounts.gl_account_code` (links to specific GL account, backfilled "Cash on hand" → '1100')
- `invoices.bank_account_id`, `expenses.bank_account_id`, `stock_receipts.bank_account_id`
- UNIQUE constraint `(business_id, gl_account_code)` on bank_accounts
- Trigger function `_trg_sync_bank_transactions` DEFINED but NOT ATTACHED
- Helper function `bank_account_balance(uuid)` for live GL-derived balance

Verified clean (Q1-Q4): Cash on hand → 1100, three target columns added on invoices/expenses/stock_receipts, function defined but 0 triggers attached, `gl_balance = 678,166.26 / stored = 12,859.30` (drift expected at this stage; resolved in Round 28).

### Round 28 — P2.1 Bank sub-ledger activation (3 parts)

**Part 1 — Migration 35 + Migration 35a (hotfix):** backfilled bank_transactions from GL. 45 rows regenerated for trial business; 14 legacy rows snapshotted to `bank_transactions_backup_r28` then deleted; `current_balance` reconciled to `bank_account_balance()`. Migration 35a hotfix widened the `bank_tx_source_type_check` CHECK constraint to mirror the `je.source` taxonomy (`invoice`, `payment`, `expense`, `expense_payment`, `expense_void`, `stock_receipt`, `receipt_payment`, `manual`, `transfer`, `opening`, `journal`, `gl_backfill`, `test`, etc.), and added the `journal → manual` rename at the trigger boundary.

**Part 2 — JS refactor:** 6 direct `bank_transactions` insert sites removed across `invoices.html` (v2026.05.20-36) and `finance.html` (v2026.05.20-33):
- I1 + I2 (invoices.html): B2C auto-payment + manual payment recording now use the picked bank_account's `gl_account_code` in the journal_line.
- F1 (finance.html, saveBankAccount): opening balance posts a journal entry (DR cash/bank, CR owner_capital); auto-resolves gl_account_code from account_type via `resolve_role`.
- F2 (finance.html, saveTransaction): manual-transaction modal redesigned as template picker — Owner Deposit / Owner Withdrawal / Bank Fee / Other. "Other" hands off to accounting.html's free-form JE modal. Posts a balanced journal entry.
- F3+F4 (finance.html, saveTransfer): bank-to-bank transfer posts a single journal entry (DR to.gl, CR from.gl) instead of two `bank_transactions` rows.
- F5 (finance.html, expense payment): passes the picked bank_account_id through to `postPaymentJournal`.

Helper changes: added `resolveBankCashSide()` (used 6x); `postPaymentJournal`, `postExpenseJournal`, `postExpenseVoidJournal` all use it. Added roles `owner_capital`, `owner_drawings`, `bank_charges` to `_REQUIRED_ROLES_FOR_FINANCE` + matching CODE getters. All `current_balance ± amount` math removed.

**Part 3 — Migration 36:** extended `_trg_sync_bank_transactions` to also refresh `bank_accounts.current_balance` via `bank_account_balance()` on every relevant write. Attached the trigger to `journal_lines AFTER INSERT`.

Verified clean: `drift = 0.00` after several test transactions (manual Cash→Bank transfer template + Bank Fee template). 45 bank_transactions rows match 45 journal_lines on 1100. current_balance updates atomically on every write.

### Round 29 — multi-bank-account UX

**finance.html v2026.05.20-34:**
- Added `allEligibleGlLeaves` cache + `loadEligibleGlLeaves()` loader (queries asset-typed, active, non-header GL accounts).
- Added `_scoreGlLeafForBank()` — ranks cash/bank-named accounts higher for display ordering (no rows hidden).
- Added "Linked GL Account" picker to the bank-account modal. Shows all eligible GL accounts; recommended ones get a 💰 icon; accounts already linked to another bank_account are disabled with a "⚠ used by '<other>'" tag.
- `onAccountTypeChange()` auto-suggests a fresh GL code when user toggles account_type.
- `saveBankAccount` reads the picker; uses `resolve_role` only as fallback. Edit branch lets user re-link.
- Friendly error on UNIQUE constraint conflict (`23505` on gl_account_code).
- New "⚠ Not linked" warning chip on bank cards where `gl_account_code IS NULL`.
- Eligible-GL cache eager-loads on modal open if cache is empty (handles cold-deep-link cases).

**Migration 37:** idempotent safety net — backfills `gl_account_code` on any production bank_accounts with NULL (using `resolve_role` based on account_type), with anti-conflict guard against UNIQUE violations. Anything still NULL after this migration must be manually re-linked via the new UI chip. For trial business: no-op (already linked).

Verified clean.

### Round 30 — dashboard correctness sweep (P2.4)

**dashboard.html v2026.05.20-13** — three surgical fixes, no DB migration:

1. **Invoices query** (line 1719): added `status` to SELECT + `.neq('status','voided')`. Fixes 5 downstream stats simultaneously: monthly revenue, output VAT, recent invoices widget, monthRev2, AR Outstanding loop.

2. **Expenses query** (line 1725): extended `allExpenses` SELECT with `subtotal, category, description, expense_number` (was already filtering voided correctly). Single round-trip.

3. **Expense widget rewrite** (was around line 1899): removed broken `journal_entries` fetch with `.limit(4)` that capped monthly total at 4 random rows AND didn't net voids. `monthExp` is now derived from the same `allExpenses` dataset; Recent Expenses widget displays top 4 by date from same dataset.

**Pre-fix diagnostic on trial business showed bug magnitude:**
- Revenue tile: 116,024.25 (buggy) vs 83,416.75 (correct) — 39% inflation
- AR Outstanding: 468,215.25 (buggy) vs 448,847.91 (correct) — 19,367.34 inflated
- Expenses tile: capped at 4 random rows; arbitrary depending on which rows were most recent

Post-fix verified: Revenue 83,416.75 ✓, Expenses 3,043.48 ✓, AR Outstanding 448,847.91 ✓, Profit 80,373.27 ✓.

---

## 6. Audit Status — P1/P2 from Round 19

### P1 (Critical) — ALL CLOSED ✅
- P1.1 Silent fallback (Round 19a)
- P1.2 Round 18 only covered manual templates (Round 20)
- P1.3 Period close on reversals (Round 21)
- P1.4 Invoice number race condition (Round 22)
- P1.5 user_id cascade deletes (Round 23)
- P1.6 Accounting equation validators (Round 24)

### P2 (Important) — ALL CRITICAL CLOSED ✅
- P2.1 Auto-payment cash/bank routing — ✅ Done in Round 27–28 (Migrations 34, 35a, 35, 36 + invoices.html v2026.05.20-36, finance.html v2026.05.20-33)
- P2.2 Stock adjustment opening-balance hardcoded equity — ✅ Done in Round 20d
- P2.3 Stock adjustment recount-up hardcoded gain — ✅ Done in Round 20d
- P2.4 Dashboard counts include reversal entries — ✅ Done in Round 30 (dashboard.html v2026.05.20-13)
- P2.5 No `sales_returns` role — ✅ Done in Round 20a + Round 26 (Migration 33)
- P2.6 VAT report doesn't reconcile to GL — ✅ Done in Round 25–26
- P2.7 No deferred-revenue support — ⏳ DEFERRED (real feature, separate project)

### Other deferred work (low priority, none critical)
- **Round 21b:** EXPENSE_CATEGORIES refactor in finance.html (13 hardcoded expense categories → 13 roles). Hygiene; only matters when a tenant has a non-default CoA.
- **5200 vs 5100 duplicate COGS name** — deactivate 5200, but historical entries still reference it.
- **bank_accounts.user_id** — same CASCADE issue as Round 23 but for this table; not fixed yet (low priority).
- **Multi-bank-account UX edge cases:** Round 29 covers the basics (GL picker, conflict messages, unlinked badge). Future polish: cross-currency transfers with FX gain/loss line; credit_card sub-ledger (account_type='credit_card' currently has no automatic GL link).

---

## 7. Files Shipped

### Latest HTML versions (current production)

| File | Version | Last touched in |
|---|---|---|
| accounting.html | v2026.05.19-41 | Round 26 (VAT GL-based with returns→Box 13) |
| invoices.html | v2026.05.20-36 | Round 28 (bank_account_id-aware journal posting, no direct bank_transactions inserts) |
| vat.html | v2026.05.19-25 | Round 25 |
| finance.html | v2026.05.20-34 | Round 29 (GL Account picker, manual-tx template modal, transfer-as-journal, unlinked badge) |
| dashboard.html | v2026.05.20-13 | Round 30 (excludes voided invoices/expenses; expenses derived from expenses table not journal_entries) |
| inventory.html | v2026.05.19-33 | Round 20d |
| settings.html | v2026.05.18-29 | Round 18 |

### SQL migrations in deploy order

**Round 17 (atomic ledger):**
- 16-RLS-FIX-TEAM-ACCESS.sql
- 17-ACCOUNTING-INTEGRITY-HARDENING.sql
- 17a-HOTFIX-void-receipt-columns.sql
- 17b-HOTFIX-void-invoice-columns.sql
- 18-ACCOUNTING-CLEANUP-AND-FINALIZE.sql
- 18b-FINAL-CLEANUP-UNBALANCED.sql

**Round 18 (role system foundation):**
- 19-ACCOUNT-ROLE-MAP-FOUNDATION.sql
- 20-AUTO-DETECT-ACCOUNT-ROLES.sql
- 20a-HOTFIX-allow-null-auth.sql
- 20b-HOTFIX-normal-balance-column.sql
- 20c-TUNE-candidate-filter.sql
- 21-AUTO-APPLY-HIGH-CONFIDENCE.sql
- 22-RESOLVE-ROLES-BATCH.sql
- 22a-HOTFIX-ambiguous-columns.sql
- cleanup-bad-accum-dep-mapping.sql

**Round 19a (controlled fallback):**
- 23-CONTROLLED-FALLBACK.sql
- 24-ADD-PROPER-ACCOUNTS.sql

**Round 20a (catalog expansion):**
- 25-EXPAND-ROLE-CATALOG.sql
- 26-AUTO-MAP-NEW-ROLES.sql
- 26a-HOTFIX-inventory-primary.sql

**Round 21+:**
- 27-PERIOD-CLOSE-TRIGGER.sql (Round 21)
- ⚠ 28-INVOICE-NUMBER-RACE-FIX.sql (FAILED — superseded; do NOT run)
- 28a-HOTFIX-drop-old-rpc.sql (Round 22 — RUN THIS instead of 28)
- 29-FIX-DANGEROUS-USER-ID-CASCADES.sql (Round 23)
- 30-FIX-ORPHAN-ACCOUNTS.sql (Round 24)
- 31-REPAIR-VAT-MISROUTED-ENTRIES.sql (Round 26)
- 32-COMPLETE-VAT-CLEANUP.sql (Round 26)
- 33-SALES-RETURNS-SEPARATION.sql (Round 26)
- 34-BANK-ACCOUNT-GL-LINKAGE.sql (Round 27)

**Round 28 (bank sub-ledger activation):**
- 35a-HOTFIX-source-type-mapping.sql (CHECK constraint widening + trigger fn patch — RUN BEFORE 35)
- 35-BANK-TRANSACTIONS-BACKFILL.sql (data backfill from GL)
- 36-ATTACH-BANK-TRIGGER.sql (extends trigger to refresh current_balance + attaches it)

**Round 29 (multi-bank-account UX):**
- 37-REPAIR-NULL-GL-LINKS.sql (idempotent safety net; no-op for trial business)

---

## 8. Current State (as of Round 30)

System is in its cleanest state since the audit began. **All P1 and all critical P2 items are closed.**

### What's live and verified

**Database invariants:**
- Every journal entry is balanced; trial balance reconciles to the cent (Round 17/18b)
- Multi-tenant role mappings cover the entire automated posting surface (Round 18 / 20a-d)
- Sensitive roles refuse silent fallback (Round 19a)
- Period close enforced by trigger on all journal_entries INSERT paths (Round 21)
- Invoice numbering race-proof via atomic RPC (Round 22)
- User-deletion no longer cascades-wipes business data (Round 23)
- VAT report reconciles to GL to the cent across 4100/4190/2200/2210/2220 (Round 25-26)
- GL is single source of truth for bank/cash sub-ledger; bank_transactions auto-derived via trigger; current_balance auto-refreshes (Round 27-28)
- Bank-module UI lets users pick GL link per bank_account with conflict guard and unlinked badge (Round 29)
- Dashboard tiles exclude voided invoices/expenses; expenses sourced from expenses table not capped journal_entries (Round 30)

**Open trial-business state:**
- 34 active invoices (10 voided)
- 9 active expenses (4 voided)
- 45 journal_lines on Cash (1100), all reflected in 45 bank_transactions rows, drift = 0.00
- GL balance on 1100: SAR 677,366.26 (post-Round-28 smoke tests deducted 800 from the 678,166.26 starting figure)
- Filed periods: FY 2023/2024/2025 + Qawaem 2025 + VAT Q4 2025 + VAT Q1 2026 (any reversal/post into these dates is blocked by the trigger)

---

## 9. Suggested Next Steps (none critical)

The audit list is empty. Remaining work is hygiene / future features, not bug fixes:

### Hygiene (low-effort, low-risk)
- **Round 21b — EXPENSE_CATEGORIES refactor.** finance.html has 13 hardcoded category-to-account mappings (rent→5300, salaries→5400, etc.). Should become role-based for non-default CoAs. Doesn't matter until a tenant uses a custom chart of accounts.
- **5200/5100 duplicate COGS name.** Two accounts both named "Cost of Goods Sold" on trial business. Deactivate 5200; ensure no historical entries reference it; rename it to something audit-friendly like "COGS (deprecated)".
- **bank_accounts.user_id CASCADE.** Same class of bug as Round 23 fixed for 10 other tables. Low priority (orphaned bank_accounts are easier to recover than orphaned invoices).
- **Cross-currency transfers.** Round 28 saveTransfer rejects same/different currency mixes with a clear message. The fix needs an FX gain/loss role + journal line; small but requires CoA addition.
- **credit_card account_type.** Currently has no automatic gl_account_code resolution. Round 29 user can pick manually; future work could auto-resolve to a liability account.

### Features (real scope, separate projects)
- **P2.7 Deferred revenue.** Subscription/annual-contract scenarios where cash is received before service is delivered. Needs UI (deferred revenue schedule), recognition flow, monthly journal posting. Real feature.
- **Recurring invoices / expenses.** Common SME need.
- **Multi-currency revaluation.** If any business uses non-SAR bank accounts, period-end FX revaluation gain/loss is needed.
- **Bank statement reconciliation polish.** Round 4j-4q built the basics; matching algorithm could be smarter.

### Operational
- **Test data reset for pilot launch.** HANDOVER Section 2 notes test data will eventually be cleared. When that happens, re-verify all migrations are idempotent on empty data, and run smoke tests on a fresh tenant.
- **Real-customer onboarding playbook.** No documented flow yet for spinning up a new business beyond signup. Round 18 setup wizard handles role mapping; opening balances + CoA customization are still manual.

---

## 10. Discipline Lessons Hardened During This Project

These came from real failures during the conversation. Don't repeat them.

### Always run schema diagnostic BEFORE writing functions
The pattern of "ship → user catches column-doesn't-exist error → hotfix" repeated multiple times:
- Round 17 hotfixes 17a/17b (voided_at columns missing)
- Round 18 hotfix 20b (coa.normal column name wrong)
- Round 18 hotfix 22a (PL/pgSQL label_en ambiguity)
- Round 22 hotfix 28a (old function signature collision)
- Round 25 (vat_pct doesn't exist — caused 400)

**Mandatory:** before writing any SQL function that touches columns, run a diagnostic to verify column names. Before rewriting any RPC, use `pg_get_functiondef(oid)` to pull the existing body — don't recreate from memory.

### Walk the math on paper for the user's specific data BEFORE shipping report logic
Round 24 took 3 iterations because I patched display code without doing the arithmetic. Round 25-26 took even longer.

**Mandatory:** for any report that aggregates GL data, work through the user's actual numbers manually before declaring it correct. If you don't know the expected result, run the SQL yourself first.

### Architectural debt is not "for later"
Round 18 covered only ~10% of code paths initially (just manual journal templates). The user had to call this out before I expanded to invoices/finance/inventory. Same with Round 25 (vat.html) where I missed accounting.html had its own VAT report.

**Mandatory:** when refactoring a pattern, grep the entire codebase for similar patterns. Don't fix one site and call it done.

### Don't accept partial reconciliation
Several times I was tempted to say "Box 6 is 12% off, that's acceptable." User correctly rejected: "fix to the dot." Same with data drift — bank_accounts.current_balance vs GL 1100 are 647K apart. The right answer is GL is truth, not "they both agree by coincidence."

**Mandatory:** when something is off, find the root cause. "Within acceptable tolerance" is acceptable only for rounding (≤ 0.01 SAR), never for material amounts.

### Stop and re-diagnose if multiple patches don't fix it
Round 24 went 3 iterations. Round 25-26 went 7+. Each iteration I added another patch instead of stepping back. The right pattern is: after 2 failed fixes, **stop**, read the full data structure, walk the math, then rewrite the whole approach.

---

## 11. Critical "Don't Forget" Items

- **Migration 28 is dead.** Use 28a only.
- **Migration 34's trigger IS attached now** (Round 28 / Migration 36). Don't re-attach. Don't drop it without coordinating with JS — the entire bank module depends on it.
- **Migration 35a must run BEFORE 35** if a fresh tenant ever deploys these in order — 35a widens the source_type CHECK constraint.
- **`vat_pct` does not exist on invoices.** Derive zero-rated from `vat_amount = 0`.
- **`bank_accounts.current_balance` is now ALWAYS in sync with GL** via the trigger. If it drifts, the trigger is broken or some path is bypassing it (e.g., a SQL-level UPDATE on bank_transactions without a matching journal_line) — investigate, don't paper over.
- **Trial business has filed periods through Q1 2026 + FY 2025.** Any reversal/entry dated in those periods will be blocked by the trigger. Workaround: use a date in an open period.
- **5100 and 5200 both named "Cost of Goods Sold"** — confusing but works. 5100 is active.
- **`bank_accounts.gl_account_code` UNIQUE constraint** means one bank_account per GL leaf. Multiple bank_accounts of same type (e.g., two checking accounts) need distinct GL leaves (1101 Bank A, 1102 Bank B). Round 29 UI handles this via the picker.
- **The user reads short replies.** Don't recap rounds in long form unless asked. Ship work, summarize briefly.

---

## 12. How to Resume

When the next chat starts:

1. **Read this document fully.**
2. **Confirm system state.** The audit list is empty as of Round 30. Before starting new work, check whether anything has shifted: run the three "expected dashboard numbers" queries (Section 5 / Round 30) to confirm the tiles still match GL. If they don't, the dashboard fixes regressed and that's priority #1.
3. **Ask the user what they want to work on.** Don't assume a next round. The "Suggested Next Steps" in Section 9 are all optional. The user may have a new feature in mind, a bug they spotted, or pilot-prep work that supersedes anything in the list.
4. Follow the operating rules in Section 2. The user reads short replies; verify before refactoring; don't accept partial reconciliation; don't ship without walking the math on real data.
5. Follow the discipline lessons in Section 10.

Naming convention for new files:
- SQL migrations: `NN-DESCRIPTIVE-NAME.sql` (next number = 38)
- Diagnostics: `diag-RR-qN-description.sql` where RR = round number
- Verifications: `verify-NN-qN-description.sql` where NN = migration number
- Comment in code: `/* Round NN (NAME): ... */`
- Version badges: `v2026.MM.DD-NN`

---

End of handover.
