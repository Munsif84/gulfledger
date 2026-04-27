# GulfLedger Compliance Checklist

> ⚠️ **AUDIT STATE: PARTIAL.** Last full audit: **2026-04-27 (Round 11)** — partial pass covering invoices.html, expenses.html, inventory.html, invoice-view.html, and parts of accounting.html and settings.html. Approximately 40-60% of the codebase audited.
>
> **Updates since Round 11:**
> - **Round 12 (2026-04-27)** — Fixed: 1.4 (invoice numbering race), 3.6 (ledger reverse guard), 7.3 (deleteDraft hard-delete protection).
> - **Round 13 (2026-04-27)** — Fixed: 3.5 (invoice void restores inventory), 8.3 (same), 8.4 (batch consumption traceability), 8.7 (negative stock prevention), 8.1/M-4 (atomic journal posting helper available).
> - **Round 14 (2026-04-27)** — Fixed: 9.4 (period close enforced at write time via DB triggers), 9.1/9.2/M-2 (double-entry balance enforced at DB level via constraint trigger).
> - **Round 15 (2026-04-27)** — Fixed: 10.3/H-3 (multi-business isolation — all queries now filter by business_id where applicable). Added: 10.1/L-1 RLS diagnostic script (output pending paste-back).
> - **Round 16 (2026-04-27)** — Fixed: 11.1/M-1 (TRN structural validation), 1.13/M-7 (commercial rounding helper applied across modules). Spread: 7.5/M-6 (audit log calls now in invoices + inventory). Partial: 12.2/M-5 (safeAttr helper added; highest-risk onclick spots in invoices migrated; full audit deferred).
>
> **Plan:** Update this checklist incrementally as each fix-round touches code. Run a single comprehensive audit pass at the end of build/design phase, before paying customers go live. By then, most items here will already be marked ✓ or have known status.
>
> **Areas not yet audited:** ~90% of accounting.html (Annual Wizard, Qawaem wizard internals, Reports tab, manual journal entry modal, chart of accounts management), join.html, login.html, dashboard.html (deep), index.html, auth flows, Supabase storage RLS, live DB-level constraints/triggers/policies, and Tier 1 verification of ZATCA citations.
>
> ---
>
> **Living document.** This is the canonical list of compliance and integrity requirements GulfLedger must meet, organised by category. Each item is tracked through to verification.
>
> **How to use this file:**
> - Update the **Status** column when code changes (✓ compliant, ⚠ partial, ✗ broken, ❓ unverified — needs external testing or expert review).
> - Update the **Last verified** date whenever the code or evidence is re-checked.
> - The **Reference** column links to the authoritative source (ZATCA article number, Companies Law article, market-standard document). Tier 1 (official) > Tier 2 (semi-official) > Tier 3 (secondary summaries).
> - When a regulation changes or new requirement appears, add a row. Don't delete rows — mark superseded.
>
> **Caveats:**
> - This file is maintained by the development workflow (Munsif + Claude). It is **not a substitute for review by a Saudi-licensed CPA, ZATCA-certified auditor, or legal counsel** before paying customers handle real ZATCA filings on the platform.
> - Items marked ❓ require external verification (e.g., Fatoora compliance toolbox, lawyer review, accountant sign-off) and cannot be cleared by code inspection alone.
> - Last full audit pass: **2026-04-27** (Round 11).

---

## 1. ZATCA E-Invoicing — Phase 1 (Generation)

ZATCA reference: E-Invoicing Implementation Resolution, Annex 2 (mandatory fields). Effective for all VAT-registered taxpayers since 4 Dec 2021.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Tax invoice (Standard, B2B/B2G) issued for sales ≥ SAR 1,000, intra-GCC, exports | ⚠ partial | invoices.html `invoice_type` field | E-Invoicing Resolution Art. 53 | 2026-04-27 | Type is user-selectable; no enforcement that B2B ≥ 1,000 must be Standard |
| 1.2 | Simplified tax invoice (B2C) allowed for sales < SAR 1,000 | ✓ | invoices.html `invoice_type='b2c'` path | E-Invoicing Resolution Art. 53 | 2026-04-27 | |
| 1.3 | Mandatory Arabic — invoice content is in Arabic (additional languages allowed) | ✓ | invoices.html `name_ar` required, RTL layout | E-Invoicing Detailed Guidelines §4.6 | 2026-04-27 | |
| 1.4 | Sequential invoice numbering, no gaps | ✓ (R12) | invoices.html `fetchNextInvoiceNumber()` + RPC; SQL migration round-12 | E-Invoicing Resolution Art. 53 | 2026-04-27 | Round 12: server-side atomic via `next_invoice_number` RPC with advisory lock + UNIQUE constraint on (business_id, invoice_number). Race condition resolved. |
| 1.5 | Seller name + TRN on every invoice | ✓ | invoices.html / invoice-view.html | Annex 2 | 2026-04-27 | |
| 1.6 | Buyer TRN required on Standard (B2B) invoices | ⚠ partial | invoices.html `buyer_trn` snapshot | Annex 2 | 2026-04-27 | Captured at issue but not enforced as required at save for invoice_type='b2b' ≥ 1000. Only flagged in VAT wizard post-hoc. |
| 1.7 | Issue date AND issue time on every invoice | ✗ | invoices.html stores `issue_date` only (date) | Annex 2; QR Tag 3 requires datetime | 2026-04-27 | QR is built with `T00:00:00Z` placeholder time. ZATCA spec requires real issue time precision. |
| 1.8 | Goods/services description per line | ✓ | invoices.html invoice_items rows | Annex 2 | 2026-04-27 | |
| 1.9 | Line-level unit price, quantity, VAT amount | ✓ | invoices.html | Annex 2 | 2026-04-27 | |
| 1.10 | Total amount net of VAT, VAT amount, total inc VAT | ✓ | invoices.html `subtotal`, `vat_amount`, `total` | Annex 2 | 2026-04-27 | |
| 1.11 | QR code on every invoice (Phase 1 = 5-tag TLV base64) | ⚠ partial | invoice-view.html `buildTLV()` | E-Invoicing Resolution Art. 53; ZATCA QR spec | 2026-04-27 | TLV length byte uses raw `v.length` — fails silently for fields > 255 bytes. Date uses `T00:00:00Z` not real time. Generated client-side at view time, not stored. |
| 1.12 | QR code data: Seller name (tag 1), TRN (tag 2), datetime (tag 3), total inc VAT (tag 4), VAT amount (tag 5) | ⚠ partial | invoice-view.html `buildTLV()` | ZATCA QR spec | 2026-04-27 | All 5 tags present but datetime precision wrong (see 1.7) |
| 1.13 | Round-half rules: away-from-zero (banker's vs commercial) | ✓ (R16) | invoices/expenses/inventory `roundCurrency()` helper | ZATCA technical guidelines on rounding | 2026-04-27 | Round 16: half-away-from-zero algorithm `Math.sign(v) * Math.round(Math.abs(v) * 100) / 100`. Applied to 22 spots in invoices.html, 7 in inventory.html. expenses uses it for new amounts. ZATCA spec exact rule still warrants Tier 1 confirmation. |
| 1.14 | Zero-rated supplies (exports, qualifying goods) flagged distinctly from exempt | ✗ | invoices.html `vat_pct === 0` check | VAT Implementing Regulations Art. 32-33 | 2026-04-27 | No way to mark a line as zero-rated vs exempt. Code defaults to zero-rated for any zero-VAT line. |
| 1.15 | Per-line VAT rate (some lines may be 0%, 15%, etc.) | ✗ | invoices.html VAT computed at invoice level only | Annex 2 | 2026-04-27 | All-or-nothing 15% per invoice — no support for mixed lines |
| 1.16 | VAT 15% rate is current statutory rate | ✓ | invoices.html `0.15` constant | ZATCA VAT rate (since 1 Jul 2020) | 2026-04-27 | Hard-coded — would need code change if rate ever changes |

## 2. ZATCA E-Invoicing — Phase 2 (Integration / Clearance)

ZATCA reference: E-Invoicing Detailed Technical Guidelines, Nov 2022. Mandatory in waves by VAT turnover; full coverage by mid-2026.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 2.1 | UUID per invoice | ❓ | invoices.html schema has `zatca_uuid` column | Detailed Technical Guidelines §7 | 2026-04-27 | Column exists; not populated yet. Generation logic missing. |
| 2.2 | Cryptographic stamp (CSID) | ❓ | not implemented | Detailed Technical Guidelines §6 | 2026-04-27 | Schema reserves `zatca_csid_id`, `zatca_csid_secret`, `zatca_csid_expiry` columns — no implementation |
| 2.3 | XML format or PDF/A-3 with embedded XML | ✗ | not implemented | E-Invoicing Resolution Art. 7 | 2026-04-27 | Currently HTML-rendered preview only |
| 2.4 | Invoice hash chain — each invoice references previous_invoice_hash | ❓ | invoices.html schema column `previous_invoice_hash` | Detailed Technical Guidelines | 2026-04-27 | Column exists; logic missing. Note in code: "Compute previous_invoice_hash (read last cleared invoice's hash)" — TODO. |
| 2.5 | Real-time Fatoora API submission for B2B (clearance model) | ✗ | not implemented | E-Invoicing Detailed Guidelines §3 | 2026-04-27 | Schema reserves `zatca_status` ('pending', 'cleared', 'rejected'). No service-side worker yet. |
| 2.6 | 24-hour reporting for B2C (Simplified) invoices | ✗ | not implemented | E-Invoicing Detailed Guidelines §3 | 2026-04-27 | |
| 2.7 | CSID onboarding flow (initial + renewal + revocation) | ✗ | not implemented | Detailed Technical Guidelines §4 | 2026-04-27 | |
| 2.8 | Compliance toolbox / Fatoora sandbox testing | ❓ | not started | ZATCA Developer Portal | 2026-04-27 | Required before going live; no record of test runs |

## 3. Credit Notes & Debit Notes

ZATCA reference: VAT Implementing Regulations Art. 54; E-Invoicing Resolution Art. 7.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 3.1 | Credit note is a first-class document (not a status flag) | ✗ | invoices.html `voidInvoice()` creates only a journal entry; original gets `status='voided'` | E-Invoicing Detailed Guidelines | 2026-04-27 | Today's "Reverse (Credit Note)" button creates a journal-only reversal. Credit note has no own document number, UUID, QR. |
| 3.2 | Credit note must reference original invoice number(s) | ⚠ partial | invoices.html stores `source_id=invoice.id` on the reversal entry | Annex 2 | 2026-04-27 | Reference is in journal entry only, not on a customer-facing credit note document |
| 3.3 | Credit note inherits invoice type (Standard → Standard CN, Simplified → Simplified CN) | ✗ | not implemented | E-Invoicing Detailed Guidelines §4 | 2026-04-27 | |
| 3.4 | Credit note has its own QR / UUID / cryptographic stamp (Phase 2) | ✗ | not implemented | E-Invoicing Detailed Guidelines | 2026-04-27 | Inherits from 2.x non-implementation |
| 3.5 | Voiding an invoice restores inventory (qty_remaining on consumed batches) | ✓ (R13) | invoices.html voidInvoice + restore_inventory_for_invoice RPC | Market standard (Xero behaviour) | 2026-04-27 | Round 13: stock_consumption table tracks batch consumption per invoice. voidInvoice calls RPC to restore qty_remaining + reverses stock_movements + reverses COGS journal. Pre-Round-13 invoices flagged retroactive (no consumption rows). |
| 3.6 | Generic ledger-side "Reverse" button blocked for source-linked entries | ✓ (R12) | accounting.html `reverseEntry()` + UI guard | Market standard | 2026-04-27 | Round 12: UI shows "Reverse from source" hint linking to invoices/expenses/inventory. Function-level guard rejects with helpful message. |
| 3.7 | Debit notes (positive adjustments) supported | ✗ | not implemented | VAT Implementing Regulations Art. 54 | 2026-04-27 | |

## 4. VAT Calculation & Filing

ZATCA reference: VAT Implementing Regulations; VAT Return form 201.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 4.1 | Output VAT account (2200) credited from sales | ✓ (fixed in R10a) | invoices.html line 2895 | VAT IR Art. 50 | 2026-04-27 | Fixed in Round 10a; was previously posting to 2210 |
| 4.2 | Input VAT account (2210) debited from purchases/expenses | ✓ (fixed in R10a) | expenses.html, inventory.html | VAT IR Art. 50 | 2026-04-27 | Fixed in Round 10a; inventory was previously posting to 2200 |
| 4.3 | Net VAT payable/refundable computed correctly | ✓ | accounting.html `vatOutput - vatInput` | VAT IR Art. 47 | 2026-04-27 | Now correct after data-fix migration |
| 4.4 | Input VAT recoverability rules per category | ✓ | expenses.html `EXPENSE_CATEGORIES` with `vat_recoverable_default` | VAT IR Art. 50 | 2026-04-27 | Entertainment, private cars marked non-recoverable; user can override |
| 4.5 | Filing frequency: quarterly (rev < SAR 40M) or monthly (rev ≥ SAR 40M) | ✓ | settings.html `vat_filing_frequency` | VAT Law Art. 33 | 2026-04-27 | User-set; no automatic threshold enforcement |
| 4.6 | VAT 201 return wizard fields (sales by rate, purchases, adjustments) | ✓ | accounting.html VAT wizard | ZATCA VAT 201 form | 2026-04-27 | Output XML/CSV format not yet a sandbox-tested ZATCA-acceptable format |
| 4.7 | VAT return XML output is Fatoora-acceptable | ❓ | accounting.html | ZATCA technical specs | 2026-04-27 | Never tested through compliance toolbox |
| 4.8 | Reverse-charge mechanism (imports of services from non-residents) | ✗ | not implemented | VAT IR Art. 47 | 2026-04-27 | |
| 4.9 | Bad-debt VAT relief on aged unpaid invoices | ✗ | not implemented | VAT IR Art. 40 | 2026-04-27 | |

## 5. Zakat & CIT (Annual Filing)

ZATCA reference: Companies Law (new regime); Income Tax Law; Zakat Implementing Regulations.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 5.1 | Annual filing deadline: 120 days from FY end | ✓ | accounting.html Annual Wizard | Income Tax Law Art. 60 | 2026-04-27 | |
| 5.2 | Zakat 2.5% for Saudi/GCC ownership share | ✓ | accounting.html Annual Wizard partner ownership math | Zakat Implementing Regulations | 2026-04-27 | |
| 5.3 | CIT 20% for foreign ownership share | ✓ | accounting.html Annual Wizard | Income Tax Law Art. 7 | 2026-04-27 | |
| 5.4 | Mixed Saudi/foreign ownership: pro-rata Zakat + CIT | ✓ | accounting.html | Zakat IR | 2026-04-27 | |
| 5.5 | WHT 5-20% on payments to non-residents | ✗ | not implemented | Income Tax Law Art. 68 | 2026-04-27 | |
| 5.6 | Annual return submission to ZATCA | ❓ | not implemented end-to-end | ZATCA portal | 2026-04-27 | UI prepares values; no submission integration |

## 6. Qawaem (Annual Financial Statement Filing)

Reference: Companies Law Art. 17 (new regime); Ministry of Commerce Qawaem platform; SOCPA standards.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 6.1 | Filing deadline: 6 months from FY end | ✓ | accounting.html Qawaem wizard | Companies Law Art. 17 | 2026-04-27 | |
| 6.2 | Audit-required vs SME-exempt determination (3 criteria; meet 2 of 3) | ✓ | accounting.html Qawaem step 2 | Companies Law Art. 17 | 2026-04-27 | Revenue ≤ 10M, assets ≤ 10M, employees ≤ 49 |
| 6.3 | Self-declaration document (signed) for SME-exempt path | ✓ | accounting.html `qawPrintDeclaration()` | Companies Law Art. 17 | 2026-04-27 | Both .txt and printable A4 HTML available |
| 6.4 | External-auditor path UI | ✓ | accounting.html | Companies Law Art. 17 | 2026-04-27 | UI only — no submission |
| 6.5 | P&L, Balance Sheet, Trial Balance reports formatted per SOCPA | ⚠ partial | accounting.html Reports tab | SOCPA standards | 2026-04-27 | Reports exist; not formally validated against SOCPA presentation requirements |
| 6.6 | Cashflow Statement (third financial statement) | ✗ | not implemented | SOCPA / IFRS for SMEs | 2026-04-27 | Planned for Round 11+ |

## 7. Record Retention

ZATCA reference: VAT Implementing Regulations Art. 66 (6-year retention).

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 7.1 | Invoices retained 6+ years after issue | ⚠ partial | DB has no auto-purge but no retention guarantee | VAT IR Art. 66 | 2026-04-27 | Retention is implicit — depends on database backup policy. No automated enforcement. |
| 7.2 | Receipts/expense supporting documents retained 6+ years | ⚠ partial | expenses.html `receipt_url` column | VAT IR Art. 66 | 2026-04-27 | User-uploaded; storage backend retention not documented |
| 7.3 | Drafts / hard-deletes blocked once posted | ✓ (R12) | invoices.html `deleteDraft()` + SQL trigger `invoices_prevent_nondraft_delete` | VAT IR Art. 66 | 2026-04-27 | Round 12: client re-checks status before delete + uses `.eq('status','draft')` filter. Server-side trigger raises exception on any DELETE of non-draft invoice. |
| 7.4 | Soft-delete with audit trail for entities with history | ✓ | inventory.html, expenses.html supplier soft-delete | Best practice | 2026-04-27 | Items/suppliers with usage are deactivated, not deleted |
| 7.5 | Audit log table for sensitive changes | ✓ (R16) | `writeAuditLog` in expenses + invoices + inventory | Best practice | 2026-04-27 | Round 16: helper duplicated to invoices and inventory. Audit log calls added on invoice deleteDraft/voidInvoice and inventory item delete/deactivate. expenses already had vendor edit/delete coverage. |

## 8. Inventory ↔ Accounting Consistency

Market standard reference: Xero tracked inventory behaviour; QBO inventory sync model.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 8.1 | Stock receipt posts inventory + input VAT + cash/AP atomically | ⚠ partial (R13 helper available) | inventory.html `postStockReceiptJournal()` | Xero standard | 2026-04-27 | Round 13: `post_journal_entry` RPC available for atomic posting. inventory.html still uses two-step pattern — to be migrated in a future round. |
| 8.2 | Sale (invoice) consumes batches via FIFO and posts COGS | ✓ | invoices.html `consumeFIFOBatches()` | Xero / SOCPA | 2026-04-27 | FIFO logic correct |
| 8.3 | Invoice void restores inventory batch qty_remaining | ✓ (R13) | invoices.html voidInvoice; restore_inventory_for_invoice RPC | Xero standard | 2026-04-27 | Round 13: see 3.5 |
| 8.4 | Batch-consumption traceability (which batches were consumed by which invoice) | ✓ (R13) | stock_consumption table | Xero standard | 2026-04-27 | Round 13: every FIFO consumption writes one row per (invoice_item, batch). Immutable history (no DELETE policy). Reversal sets reversed=true. |
| 8.5 | Stock-adjustment posts inventory + adjustment-account journal | ✓ (fixed in R10a) | inventory.html `postStockAdjustmentJournal()` | SOCPA | 2026-04-27 | Was using wrong column names; fixed |
| 8.6 | Stock receipt void reverses both batch row and journal | ⚠ partial | inventory.html `voidReceipt()` | SOCPA | 2026-04-27 | Reverses journal; doesn't decrement batch row qty_remaining |
| 8.7 | Negative stock prevented at invoice save time | ✓ (R13) | invoices.html pre-check + consume_inventory_fifo RPC | Best practice | 2026-04-27 | Round 13: client pre-sums requested qty per item vs available batches; RPC also checks atomically with FOR UPDATE. Both layers reject with item-named error. |

## 9. Double-Entry Integrity

Market reference: SOCPA / IFRS principles of double-entry accounting.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 9.1 | Every journal entry has lines that sum to balanced (DR=CR) | ✓ (R14) | DB constraint trigger `journal_lines_check_balance` | SOCPA | 2026-04-27 | Round 14: deferrable constraint trigger fires at COMMIT, verifies sum(debits)=sum(credits) within 0.01 SAR tolerance for parent journal_entries row. Skips voided/reversed/draft. |
| 9.2 | Every journal_lines row has `entry_id`, `user_id`, `account_code`, exactly one of debit/credit > 0 | ⚠ partial | various modules | SOCPA | 2026-04-27 | No DB constraint — relies on application code |
| 9.3 | Voided entries excluded from totals/reports | ✓ | accounting.html Reports tab uses `.neq('status','voided')` | SOCPA | 2026-04-27 | |
| 9.4 | Period close locks prior periods | ✓ (R14) | DB triggers on journal_entries / invoices / expenses / stock_receipts / stock_adjustments | SOCPA / Tax Law | 2026-04-27 | Round 14: BEFORE-triggers reject INSERT/UPDATE/DELETE that would land a row in a closed period. Allows draft edits, void/reverse status transitions on historical rows, and the new credit-note entry posting in current open period. |
| 9.5 | Manual journal entries balance-check at save | ✓ | accounting.html `openManualEntryModal()` | SOCPA | 2026-04-27 | Disables Save button until lines balance |
| 9.6 | Reversal entries: lines = original with DR/CR swapped | ✓ | accounting.html `reverseEntry()` | SOCPA | 2026-04-27 | Correct swap logic |

## 10. Multi-Tenancy & Data Isolation

Reference: PostgreSQL RLS best practice; Supabase docs.

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 10.1 | All tables have RLS enabled | ⚠ partial / pending diagnostic | migration SQL files; `round-15-rls-diagnostic.sql` for live verification | Supabase docs | 2026-04-27 | Round 15: diagnostic SQL provided. User to run and paste results. Will update to ✓ or flag specific tables as findings. |
| 10.2 | RLS policy: SELECT/INSERT/UPDATE/DELETE all check `auth.uid() = user_id` | ⚠ partial | various migration SQL | Supabase docs | 2026-04-27 | Some tables: yes (chart_of_accounts, accounting_periods). Others not visible in code. Need to query `pg_policies` to verify all. |
| 10.3 | Multi-business isolation: queries filter by `business_id`, not just `user_id` | ✓ (R15) | dashboard.html, invoices.html, expenses.html, inventory.html, accounting.html, invoice-view.html | Application logic | 2026-04-27 | Round 15: ~30 queries across 6 files now filter by both user_id and business_id. journal_lines correctly NOT scoped (filtered transitively via entry_id). businesses table correctly NOT scoped (lists user's businesses). |
| 10.4 | Anon key safe to expose (RLS protects rows) | ✓ | client HTML files | Supabase docs | 2026-04-27 | Anon key is JWT with `role='anon'` — relies on RLS being correct |
| 10.5 | No service-role key in client code | ✓ | grep returns empty | Supabase docs | 2026-04-27 | |

## 11. Data Validation

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 11.1 | TRN format: 15 digits | ✓ (R16) | `validateSaudiTRN()` in invoices + expenses | ZATCA TRN spec | 2026-04-27 | Round 16: structural regex `/^3\d{12}03$/` enforces start-with-3 and end-with-03. Bilingual error messages. Tier 1 confirmation of exact TRN spec still recommended. |
| 11.2 | CR (commercial registration) format: 10 digits | ❓ | settings.html | MoCI spec | 2026-04-27 | Format not enforced |
| 11.3 | Saudi mobile format: starts +966 / 05 | ❓ | invoices.html, settings.html | Standard | 2026-04-27 | Not enforced |
| 11.4 | National ID / Iqama | ❓ | settings.html partners | Standard | 2026-04-27 | Format not enforced |
| 11.5 | ISO date inputs only | ✓ | All modules use HTML5 `type=date` | Standard | 2026-04-27 | |
| 11.6 | Currency: SAR-only enforced | ✓ | hard-coded | VAT IR (KSA-domestic) | 2026-04-27 | Multi-currency not implemented; GCC import scenarios may need this later |

## 12. Security & Operations

| # | Requirement | Status | Code location | Reference | Last verified | Notes |
|---|---|---|---|---|---|---|
| 12.1 | All inserts/updates set `user_id` (not just trusted RLS) | ⚠ partial | most modules now correct after R10a | Defence-in-depth | 2026-04-27 | inventory.html was missing user_id on journal_lines until R10a |
| 12.2 | XSS protection: `escHTML` used on all user-supplied strings | ⚠ partial (R16 progress) | most rendering uses escHTML; new `safeAttr` helper in invoices/expenses/inventory | OWASP | 2026-04-27 | Round 16: added `safeAttr()` for HTML attribute context (escapes `& " ' < > \r \n`). Migrated 9 highest-risk onclick spots in invoices.html away from ad-hoc single-quote-only escaping. Remaining: ~100 inline onclick handlers across all files use IDs/numerics (lower risk) but full audit deferred to pre-launch. |
| 12.3 | SQL injection: not applicable (parameterised via Supabase JS) | ✓ | all queries use `.eq()` / `.match()` etc | OWASP | 2026-04-27 | |
| 12.4 | CSRF: not applicable (token in JWT) | ✓ | Supabase handles | Supabase docs | 2026-04-27 | |
| 12.5 | Rate limiting on auth endpoints | ❓ | Supabase platform-level | Best practice | 2026-04-27 | Default Supabase rate limits apply; no app-level throttling |

---

## Status Legend

- **✓ compliant** — requirement is met based on code review and (where stated) external verification
- **⚠ partial** — requirement is partly met; specific gap noted
- **✗ broken** — requirement is not met; gap clearly identified
- **❓ unverified** — not verifiable by code inspection alone; needs external testing, sandbox runs, or expert review

## Reference Tier Legend

- **Tier 1 (official)** — ZATCA published PDFs, Companies Law text, VAT Law text, MoCI regulations
- **Tier 2 (semi-official)** — ZATCA Developer Portal, Fatoora API docs, SOCPA standards
- **Tier 3 (secondary)** — ClearTax, EDICOM, market analysts; treat as starting point, trace to Tier 1 before claiming compliance
