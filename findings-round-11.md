# GulfLedger Round 11 — Audit Findings

> **Audit pass date:** 2026-04-27
> **Scope:** Full codebase scan against `docs/compliance-checklist.md`
> **Deliverable type:** Audit only — no code changes in Round 11
> **Next steps:** User triages findings, decides priority order, fix-rounds (12, 13, 14...) scheduled per item

---

## How to read this document

Each finding has the same structure:

- **Severity** — Critical / High / Medium / Low / Info
- **Category** — which checklist section it falls under (1.x = ZATCA Phase 1, 2.x = Phase 2, etc.)
- **What's wrong** — observed behaviour
- **Why it matters** — concrete consequence (regulatory exposure, data integrity, etc.)
- **Where** — file + line number
- **Reference** — citation (Tier 1/2/3)
- **Proposed fix** — outline only; actual implementation deferred to fix-round
- **Confidence** — High / Medium / Low — Claude's certainty
- **Needs external verification** — yes/no, what kind

> **Honest caveats from Claude:**
> - This pass examined HTML/JS files. Database schema constraints, triggers, and live RLS policies were inferred from migration SQL files, not queried live. Some findings tagged ❓ may already be enforced at DB level — verify with `\d <table>` and `SELECT * FROM pg_policies`.
> - Some items are flagged where I'm uncertain. Read the **Confidence** field. Don't fix something just because it's listed.
> - I did not audit `dashboard.html` or `index.html` deeply — those are mostly read-only views. If they have hidden write paths, they're not covered.
> - Tier 3 references should ideally be traced to Tier 1 (ZATCA PDF article numbers) before relying on them.

---

## CRITICAL findings (4)

### C-1 — Invoice number race condition allows duplicates

- **Category:** 1.4 (Sequential numbering, no gaps)
- **What's wrong:** `fetchNextInvoiceNumber()` reads the latest invoice number from the database, parses the trailing digits, increments by 1. There is no DB-level UNIQUE constraint on `(business_id, invoice_number)` and no atomic sequence. Two clients (or two tabs on the same machine) can read the same "last" number simultaneously and both produce N+1.
- **Why it matters:** ZATCA Phase 2 hash chain (`previous_invoice_hash`) requires a strict sequence. Duplicate or non-monotonic numbers break the chain and the invoice will be rejected at clearance. Also a data integrity issue today — two invoices can share a number.
- **Where:** `invoices.html` lines 2007-2024 (`fetchNextInvoiceNumber`)
- **Reference:** ZATCA E-Invoicing Resolution Art. 53 (Tier 1); Detailed Technical Guidelines §7 (Tier 1)
- **Proposed fix:** Move number generation server-side: a Postgres function `next_invoice_number(biz_id uuid)` using a row-lock or a per-business sequence table; UNIQUE constraint `(business_id, invoice_number)` on the invoices table; client calls the function, never computes its own number.
- **Confidence:** High
- **Needs external verification:** No

### C-2 — Period close lock is UI-only, not enforced at write time

- **Category:** 9.4 (Period close locks)
- **What's wrong:** `accounting_periods` table exists. UI shows a "Period locked" banner. But the SAVE handlers in `invoices.html`, `expenses.html`, `inventory.html` do not check whether the entry's date falls inside a closed period. A user can refresh the form, change the date, and post into a locked period.
- **Why it matters:** Once you've filed VAT 201 for Q2 and locked the books, no entries should land back in Q2 (would invalidate the filed return). This is a basic accounting integrity requirement and a tax-audit red flag.
- **Where:** All save handlers across modules; `accounting.html` `closedPeriods` is read-only used for the banner
- **Reference:** SOCPA (Tier 2); VAT Implementing Regulations Art. 47 (Tier 1) — return amendment requires re-filing, not silent backdating
- **Proposed fix:** Postgres trigger on `journal_entries`, `invoices`, `expenses`, `stock_receipts`: if `entry_date / issue_date / expense_date / receipt_date` falls within a row in `accounting_periods` where `status='closed'`, raise exception. Client-side, also check before submit and show inline error.
- **Confidence:** High
- **Needs external verification:** No

### C-3 — Issue time missing from invoices (QR Tag 3 incorrect)

- **Category:** 1.7 (Issue date AND time), 1.11 (QR), 1.12 (QR fields)
- **What's wrong:** Invoices store `issue_date` only (date column, no time). When the QR code is built (`invoice-view.html` line 1228), it concatenates `T00:00:00Z` as a placeholder. ZATCA's TLV spec for tag 3 requires the actual timestamp of issuance.
- **Why it matters:** Phase 2 clearance API will reject invoices where the QR-encoded timestamp doesn't match the canonical XML timestamp. Even in Phase 1, a regulator audit comparing two invoices issued same day would find the placeholder time and could question the integrity of all generated QR codes.
- **Where:** `invoices.html` schema `issue_date date`; `invoice-view.html` line 1228
- **Reference:** ZATCA QR specification Tag 3 — ISO 8601 datetime (Tier 1); E-Invoicing Detailed Guidelines §4 (Tier 1)
- **Proposed fix:** Add `issue_time time` or change `issue_date` to `issue_datetime timestamptz`. On invoice issuance, capture `now()` at server side. Use that exact timestamp for QR Tag 3 and Phase 2 XML.
- **Confidence:** High
- **Needs external verification:** Yes — submit a sample invoice through ZATCA's Compliance and Enablement Toolbox once Phase 2 work begins, verify the QR's timestamp passes validation

### C-4 — TLV length byte fails for fields > 255 bytes

- **Category:** 1.11 (QR generation correct)
- **What's wrong:** `tlvEncode(tag, value)` uses `[tag, v.length, ...v]` where `v.length` is the UTF-8 byte length. The TLV format reserves 1 byte for length, max value 255. Arabic text expands to 2-4 bytes per character in UTF-8. A long seller name in Arabic (e.g., 100 Arabic characters with diacritics) can exceed 255 bytes silently — JS will produce a malformed TLV.
- **Why it matters:** QR will be technically valid base64 but parse-fail when ZATCA reads it. The user sees their invoice "successfully created" but it's broken. May not surface until Phase 2 clearance runs.
- **Where:** `invoice-view.html` lines 1220-1223
- **Reference:** ZATCA QR TLV specification (Tier 1) — for fields ≥ 128 bytes use long-form length encoding (varint or multi-byte length prefix per the spec)
- **Proposed fix:** Either (a) cap seller name to safe length client-side, or (b) implement long-form length encoding per ZATCA spec. Option (a) is simpler; ZATCA's own examples truncate.
- **Confidence:** High (issue confirmed by code reading; ZATCA's exact long-form encoding requires re-reading the spec)
- **Needs external verification:** Yes — re-read ZATCA QR spec for length-encoding rules; sandbox-test with a long Arabic seller name

---

## HIGH findings (6)

### H-1 — Invoice void doesn't restore inventory batch quantities

- **Category:** 3.5, 8.3, 8.4
- **What's wrong:** Already documented in detail in earlier conversation. `voidInvoice()` posts a credit-note journal entry but does not increment `stock_batches.qty_remaining` for the batches consumed by that invoice. There is also no traceability — we don't know which batches an invoice consumed.
- **Why it matters:** Books and inventory go out of sync. Reports lie. FIFO breaks. User confidence in the system collapses on the first void.
- **Where:** `invoices.html` `voidInvoice()` ~line 2995; `consumeFIFOBatches()` ~line 2907
- **Reference:** Xero standard behaviour (Tier 3); SOCPA inventory accounting (Tier 2)
- **Proposed fix:** Add `stock_consumption` table linking `invoice_line_id → batch_id → qty_consumed`. Update `consumeFIFOBatches` to write rows. Update `voidInvoice` to read rows and increment `qty_remaining` back. Wrap both operations in a Postgres function for atomicity.
- **Confidence:** High
- **Needs external verification:** No

### H-2 — Generic Ledger "Reverse" allowed on source-linked entries

- **Category:** 3.6
- **What's wrong:** `reverseEntry()` in `accounting.html` allows reversing any journal entry, including ones with `source IN ('invoice', 'expense', 'stock_receipt', 'stock_adjustment')`. This bypasses the source module's void path entirely (e.g., reverses the journal but doesn't flip `invoices.status` or restore inventory).
- **Why it matters:** User accidentally clicks "Reverse" on the journal-side of an invoice; invoice still looks "posted" in the invoices list, books say it's reversed, inventory was decremented and never restored. Triple desync.
- **Where:** `accounting.html` `reverseEntry()` line 3040
- **Reference:** Xero, QBO standard behaviour (Tier 3)
- **Proposed fix:** Hide / disable the Reverse button when `entry.source !== 'manual'`. Replace with an inline message: "This entry was created by [Invoice INV-2026-011]. To reverse it, issue a credit note from the invoice." Add a deep link.
- **Confidence:** High
- **Needs external verification:** No

### H-3 — Multi-business data leakage potential

- **Category:** 10.3
- **What's wrong:** Many queries filter by `.eq('user_id', currentUser.id)` but not by `.eq('business_id', currentBiz.id)`. If a user has multiple businesses (which the data model supports), they will see data from all their businesses on whichever business is "currently selected."
- **Why it matters:** A user with Business A (a clothing shop) and Business B (a separate restaurant) selecting Business A will see invoices, expenses, and inventory from B mixed in. Not just confusing — could result in regulatory mis-filing if Business A's VAT 201 includes Business B's transactions.
- **Where:** `dashboard.html` line 724 (invoices), 844 (inventory_items); `invoices.html` payment lookups; many others — needs systematic grep
- **Reference:** Application logic — user reasonable expectation
- **Proposed fix:** Audit all `.from(*).select()` and `.from(*).eq('user_id', x)` calls and add `.eq('business_id', currentBiz.id)`. Eventually, RLS policies should also key on business_id (require a session-level "active business" claim).
- **Confidence:** High
- **Needs external verification:** No (but should be verified by querying actual data with a multi-business test user)

### H-4 — `deleteDraft` doesn't verify status='draft' server-side

- **Category:** 7.3
- **What's wrong:** `deleteDraft(id, num)` deletes both `invoice_items` and `invoices` rows for a given id. The function trusts the caller — there's no check that `status='draft'`. RLS allows DELETE on the user's own rows, so any invoice ID can be hard-deleted.
- **Why it matters:** A user (or someone via the browser console) could call `deleteDraft('<some posted invoice id>', 'foo')` and erase a posted, ZATCA-cleared invoice. Six-year retention is then violated. No audit trail of the deletion.
- **Where:** `invoices.html` `deleteDraft` line 2984
- **Reference:** VAT Implementing Regulations Art. 66 (Tier 1) — mandatory 6-year retention; ZATCA E-Invoicing Resolution (Tier 1) — cleared invoices cannot be deleted
- **Proposed fix:** (1) Client: add `status='draft'` filter to the delete query. (2) Server: RLS policy should restrict DELETE to rows WHERE `status = 'draft'`. (3) Postgres trigger blocks DELETE on `invoices` where `zatca_status='cleared'` regardless of policy.
- **Confidence:** High
- **Needs external verification:** No

### H-5 — Credit note is not a first-class document

- **Category:** 3.1, 3.2, 3.3, 3.4
- **What's wrong:** Today's "Reverse (Credit Note)" creates a journal entry with `source='credit_note'` and updates the invoice status, but: (a) no credit note number sequence, (b) no separate document the user/customer can view/print, (c) no QR code for the credit note, (d) Phase 2 won't accept this (credit notes need their own UUID, hash, clearance call).
- **Why it matters:** Mandatory for ZATCA. Credit notes "must be issued with a reference to the original invoice(s) to which they are issued. The credit/debit note types follow the type of invoice that they are issued against — a standard electronic note is issued for a Standard eInvoice, and a simplified eNote is issued for a Simplified eInvoice". Today's implementation is journal-only.
- **Where:** `invoices.html` `voidInvoice()`
- **Reference:** ZATCA E-Invoicing Detailed Guidelines (Tier 1); VAT IR Art. 54 (Tier 1)
- **Proposed fix:** Add `credit_notes` table with own number sequence, foreign key to original invoice, status flow, ZATCA fields (UUID, QR, hash, csid). Build a credit-note view/print module similar to `invoice-view.html`. Phase 2 clearance plumbing handles them as their own documents.
- **Confidence:** High
- **Needs external verification:** Yes — when Phase 2 work starts, verify XML structure for ZATCA-acceptable credit notes via Compliance Toolbox

### H-6 — VAT-rate hard-coded; no per-line rate; no zero-rated/exempt distinction

- **Category:** 1.14, 1.15, 1.16
- **What's wrong:** Invoice line items have a single VAT rate per invoice (effectively 15% always). No way to mark an individual line as zero-rated (export, qualifying medical/education) or exempt (residential rent, certain financial services). Code does flag any zero-VAT line as "zero-rated" by default but doesn't distinguish from exempt.
- **Why it matters:** A business selling a mix (e.g., grocery with some standard-rated items and some zero-rated medicines) cannot invoice correctly. VAT 201 return becomes wrong because zero-rated and exempt have different reporting boxes.
- **Where:** `invoices.html` `vat_amount = Math.round(net*0.15*100)/100` lines 2454, 2540; line item structure
- **Reference:** VAT Implementing Regulations Art. 32 (zero-rated), Art. 33 (exempt) (Tier 1); VAT 201 form (Tier 1)
- **Proposed fix:** Add `vat_rate` and `vat_treatment` ('standard' | 'zero_rated' | 'exempt' | 'out_of_scope') columns to `invoice_items`. UI: per-line rate dropdown. VAT calculation sums per-line. Wizard: pulls from these flags for return categorisation.
- **Confidence:** High
- **Needs external verification:** No (logic clear); but list of qualifying zero-rated/exempt categories should be verified against ZATCA's published list per industry

---

## MEDIUM findings (7)

### M-1 — TRN format validation is length-only

- **Category:** 11.1
- **What's wrong:** Code checks `trn.length === 15`. ZATCA TRN structure is more specific: starts with `3`, ends with `03`, internal digits have a checksum-like pattern.
- **Why it matters:** A user can enter "123456789012345" — 15 digits but invalid. Invoices with bad TRNs will be rejected at Phase 2 clearance.
- **Where:** `invoices.html` line 3498; `expenses.html` line 1785
- **Reference:** ZATCA TRN structure (Tier 2 — needs source confirmed)
- **Proposed fix:** Regex `/^3\d{12}03$/` plus optional checksum validation if ZATCA publishes one. Add helper `validateTRN(trn): { valid, reason }`.
- **Confidence:** Medium (structure is widely cited but exact spec needs Tier 1 confirmation)
- **Needs external verification:** Yes — confirm exact TRN structure in ZATCA Tier 1 docs

### M-2 — Journal-line balance not enforced at DB level

- **Category:** 9.1, 9.2
- **What's wrong:** App code sets `is_balanced=true` and trusts itself. No DB constraint or trigger verifies that for any given `entry_id`, sum of debits = sum of credits within tolerance.
- **Why it matters:** A future bug in any module's posting code can produce unbalanced entries. Today's "soft red banner on unbalanced entries" detects after the fact, after the books are already wrong.
- **Where:** All journal-posting code paths
- **Reference:** SOCPA (Tier 2); double-entry principle (universal)
- **Proposed fix:** Postgres deferred-constraint trigger on `journal_entries`: at end of transaction, verify sum(lines.debit) ≈ sum(lines.credit) where entry_id matches. Reject if not.
- **Confidence:** High
- **Needs external verification:** No

### M-3 — Negative stock not prevented at invoice save

- **Category:** 8.7
- **What's wrong:** `consumeFIFOBatches` consumes `Math.min(qtyLeft, batch.qty_remaining)` — when no batch has enough, it consumes whatever's left. There's no check that returns "insufficient stock — cannot save invoice."
- **Why it matters:** Sells stock you don't have. Inventory goes negative. Future receipts try to settle against negative remaining and break FIFO. Same root issue Method.me flagged with QBO.
- **Where:** `invoices.html` `consumeFIFOBatches()` line 2907; invoice save handlers
- **Reference:** Xero standard (Tier 3) — invoice approval blocked when item out of stock
- **Proposed fix:** Pre-check at save time: sum `qty_remaining` across active batches per item ≥ requested qty for that line. If not, block with inline error and link to receive stock. Optionally allow override with explicit "back-order" flag.
- **Confidence:** High
- **Needs external verification:** No

### M-4 — Stock receipt journal posting is not atomic

- **Category:** 8.1
- **What's wrong:** `postStockReceiptJournal()` does `INSERT journal_entries` then `INSERT journal_lines`. If the second call fails, the entries header exists with no lines (orphan, unbalanced).
- **Why it matters:** Hard to detect (the orphan entry is technically "balanced" with zero lines on both sides). Skews trial balance subtly.
- **Where:** `inventory.html` post-receipt block ~lines 2470-2520
- **Reference:** Database transactions best practice (Tier 2)
- **Proposed fix:** Wrap header + lines in a Postgres function (transactional). Same for invoices, expenses, stock adjustments.
- **Confidence:** High
- **Needs external verification:** No

### M-5 — `escHTML` coverage incomplete

- **Category:** 12.2
- **What's wrong:** Most rendering of user-supplied strings goes through `escHTML()`, but spot-checks reveal places where template literals interpolate `inv.buyer_name` directly into HTML without escaping (e.g., onclick="..."  attribute injection).
- **Why it matters:** XSS via crafted customer/supplier name. A B2B partner could insert `<script>` in their name on file and execute in your browser when you view the invoice list.
- **Where:** Multiple files — needs targeted grep for `${[^}]*name[^}]*}` inside HTML attributes
- **Reference:** OWASP XSS Prevention (Tier 1)
- **Proposed fix:** Audit every template literal that interpolates a string from a query result into a) HTML body content, b) HTML attribute values, c) JS strings inside onclick. Use `escHTML` for body; specialised escape for attributes; never embed user input in `onclick=` (use data-attributes + addEventListener instead).
- **Confidence:** Medium (audit not yet done thoroughly; spot-checks are concerning)
- **Needs external verification:** Helpful — automated scanner like ESLint with eslint-plugin-no-unsanitized or DOMPurify

### M-6 — Audit log usage inconsistent

- **Category:** 7.5
- **What's wrong:** `expenses.html` calls `writeAuditLog()` on supplier delete/edit. Other modules don't have audit-log calls on equivalent operations. Inventory item deletion: no audit log. Invoice void: no audit log. Settings changes: no audit log.
- **Why it matters:** Compliance audits will want a trail of "who did what when." Currently partial.
- **Where:** All write handlers across modules; `writeAuditLog` defined in expenses.html only
- **Reference:** Best practice (Tier 2); Companies Law audit requirements (Tier 1)
- **Proposed fix:** Move `writeAuditLog` to a shared script. Apply consistently on: invoice void, item delete/deactivate, settings updates (especially TRN/CR changes), period close, journal reversals.
- **Confidence:** High
- **Needs external verification:** No

### M-7 — Rounding rule not formally specified

- **Category:** 1.13
- **What's wrong:** `Math.round(net * 0.15 * 100) / 100` is used. JavaScript's `Math.round` rounds half-away-from-zero for positives but has float-precision quirks (`Math.round(0.5)` = 1, but `Math.round(0.05 * 10)` ≠ what you expect). ZATCA's preferred rounding rule should be confirmed.
- **Why it matters:** Tiny per-line discrepancies that compound across an invoice and across a return period, then fail to match ZATCA's calculated totals at clearance.
- **Where:** Invoice and expense calculations
- **Reference:** ZATCA technical guidelines on monetary rounding (Tier 1 — needs lookup)
- **Proposed fix:** Use a fixed-decimal library (decimal.js) or implement explicit half-away-from-zero with `Math.sign(x) * Math.round(Math.abs(x) * 100) / 100`. Verify against ZATCA-published examples.
- **Confidence:** Medium — issue exists but the practical impact is small (sub-cent), needs ZATCA spec confirmation
- **Needs external verification:** Yes

---

## LOW findings (4)

### L-1 — RLS policies not verified for all tables

- **Category:** 10.1, 10.2
- **What's wrong:** Migration SQL files for `accounting_periods` and `chart_of_accounts` show RLS enabled with policies. Other tables (invoices, expenses, journal_lines, stock_batches, etc.) — migrations not in repo, RLS state unknown by code inspection.
- **Why it matters:** If any table has RLS off, the anon key would expose all rows.
- **Where:** All Supabase tables
- **Reference:** Supabase docs (Tier 1); defence-in-depth
- **Proposed fix:** Run `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` and `SELECT * FROM pg_policies` against the production DB. Document policy state in checklist. Add missing policies.
- **Confidence:** Medium
- **Needs external verification:** Yes — DB query

### L-2 — Phase 2 schema reserved but logic absent

- **Category:** 2.1, 2.2, 2.4, 2.5, 2.7
- **What's wrong:** Schema has `zatca_uuid`, `zatca_qr_tlv`, `zatca_invoice_hash`, `previous_invoice_hash`, `zatca_csid_*` columns. Code paths to populate them are TODO comments only.
- **Why it matters:** Not a critical issue today. Becomes critical when the business's VAT turnover crosses the next Phase 2 wave threshold.
- **Where:** invoices.html schema header + comments lines 100-220
- **Reference:** ZATCA Phase 2 wave schedule (Tier 1)
- **Proposed fix:** Round-by-round build: UUID generation, hash chain, XML canonicalisation, CSID flow, Fatoora API client, async clearance worker. Plan as separate epic.
- **Confidence:** High
- **Needs external verification:** Yes — ZATCA Compliance Toolbox runs at each step

### L-3 — Currency hard-coded SAR

- **Category:** 11.6
- **What's wrong:** No currency field on invoices/expenses; assumes SAR everywhere.
- **Why it matters:** Future GCC export scenarios may need multi-currency. Not a today problem.
- **Where:** Throughout
- **Reference:** None — design choice
- **Proposed fix:** Defer until needed.
- **Confidence:** High (intentional design)
- **Needs external verification:** No

### L-4 — Backup/retention policy undocumented

- **Category:** 7.1, 7.2
- **What's wrong:** Code does not delete old data, but no documented backup or retention policy at the platform layer. Six-year retention depends on Supabase's backup retention.
- **Why it matters:** ZATCA can audit any year in the past 6. If Supabase loses data and there's no documented policy, the business is liable.
- **Where:** Operations layer — not in code
- **Reference:** VAT IR Art. 66 (Tier 1)
- **Proposed fix:** Document Supabase backup tier (production tier should have point-in-time recovery + daily backups for 7+ years). Optionally implement periodic export of all data to long-term cold storage (S3 Glacier).
- **Confidence:** High
- **Needs external verification:** Yes — confirm Supabase tier

---

## INFO / Already-Done (2)

### I-1 — Round 10a fixes verified

- **Category:** 4.1, 4.2, 8.5
- **What:** VAT account-code bugs (invoices 2210→2200, inventory 2200→2210) and inventory journal column-name bugs were correctly fixed in Round 10a. Migration SQL is complete and correct.
- **Confidence:** High

### I-2 — Soft-delete + audit log pattern already exists

- **Category:** 7.4, 7.5
- **What:** `inventory.html` and `expenses.html` correctly soft-delete suppliers and items when usage history exists. expenses.html has `writeAuditLog`. Pattern is good — just needs to spread to other modules (see M-6).
- **Confidence:** High

---

## Summary Counts

| Severity | Count | Items |
|---|---:|---|
| Critical | 4 | C-1 invoice race, C-2 period lock, C-3 issue time, C-4 TLV length |
| High | 6 | H-1 invoice void inventory, H-2 ledger reverse guard, H-3 multi-biz isolation, H-4 deleteDraft guard, H-5 credit note as document, H-6 per-line VAT rate |
| Medium | 7 | M-1 TRN structure, M-2 balance trigger, M-3 negative stock, M-4 atomic posting, M-5 XSS audit, M-6 audit log spread, M-7 rounding rule |
| Low | 4 | L-1 RLS verify, L-2 Phase 2 plan, L-3 multi-currency, L-4 backup policy |
| Info | 2 | I-1 R10a verified, I-2 soft-delete pattern |
| **Total** | **23** | |

---

## Recommended fix sequencing

This is my suggestion for round ordering. You should push back on anything you disagree with — your context (pilot urgency, paying-customer timeline, accountant availability) matters more than mine.

**Round 12 — Critical immediate fixes (low risk, high impact)**
- C-1 (invoice number race) — DB function + UNIQUE constraint
- H-2 (block ledger reverse on source-linked entries) — UI-only
- H-4 (deleteDraft status guard) — server-side filter + RLS

**Round 13 — Inventory/invoice integrity (medium effort)**
- H-1 (invoice void restores inventory) — needs new table + write paths
- M-3 (negative stock prevention) — pre-check at save
- M-4 (atomic posting) — wrap in DB functions

**Round 14 — Period close & double-entry hardening**
- C-2 (period lock at write time) — DB triggers
- M-2 (balance constraint) — deferred trigger

**Round 15 — Multi-tenancy hardening**
- H-3 (multi-business isolation) — systematic query audit
- L-1 (RLS verification) — query DB, document state

**Round 16 — Validation & UX correctness**
- M-1 (TRN structure)
- M-7 (rounding rule confirm)
- M-5 (XSS audit)
- M-6 (audit log spread)

**Round 17+ — VAT rate per line + zero-rated/exempt**
- H-6 (per-line VAT) — schema + UI changes

**Round 18-25 (epic) — Phase 2 e-invoicing**
- C-3 (issue time)
- C-4 (TLV length)
- L-2 (UUID, hash chain, XML, CSID, Fatoora API)
- H-5 (credit note as first-class document) — folds in here

**Round 26+ — Cashflow Statement, WHT, reverse charge, bad-debt VAT relief**

This is ~14 rounds of work to reach genuine ZATCA Phase 2 readiness. Some can run in parallel. The first three rounds (12-14) are the must-do-soon items where current behaviour is genuinely incorrect.

Triage when you're ready and tell me which round to start.
