# GulfLedger — Handover Document

**Purpose**: This document is the single source of truth for picking up GulfLedger work in a new chat session, after a break, or when handing off to another contributor. Reading this should give you everything needed to continue without losing context.

**Last updated**: 2026-04-28 (after Phase 2 — reports.html refocused to operational reports)

---

## How to use this document

If you're a fresh Claude in a new chat:
1. Read this entire document before doing any code or SQL
2. Read `PROGRESS.md` for chronological context if you need to understand WHY decisions were made
3. Ask the user what they want to work on next — don't assume from this doc alone
4. Follow the "Communication preferences" section religiously

If you're continuing the project:
- Use this as your map of "what exists, what doesn't, what's next"
- Update it at the end of each major session

---

## Project overview

**GulfLedger** — a Saudi-market accounting / invoicing SaaS targeting non-accountant SMEs.

- **Compliance**: ZATCA Phase 2, Fatoora, Saudi VAT
- **Live**: https://gulfledger.vercel.app
- **Repo**: github.com/Munsif84/gulfledger
- **Owner**: Munsif (works at Nestle, side project)
- **Stack**: vanilla HTML/CSS/JS + Supabase (DB + auth) + Vercel (hosting) + GitHub (source)
- **Languages**: Arabic-first (RTL primary), English secondary
- **Brand**: Saudi green palette `#006C35`, font: Tajawal/Cairo

**Phase**: pilot. Trusted accountants and small-business owners are testing manually. No public signup yet.

---

## Communication preferences (READ THIS — important)

Munsif prefers:

- **Informal English with Arabic terms** mixed in. He's bilingual.
- **Push back constructively** — if a request is risky, scoped wrong, or has hidden complexity, say so before coding. Suggest alternatives. Don't sycophantically agree.
- **Smaller rounds over mega-rounds** — many small deploys, not one big one. Each round should be testable.
- **Use `ask_user_input_v0` tool** for choices — Munsif uses mobile, so tap-buttons > typing.
- **Diagnostic-first for SQL/RLS issues** — ALWAYS ask Munsif to run an `information_schema` or `pg_policy` query FIRST so you write migrations based on real DB state, not assumptions. We had 6 SQL retries in one session because of guessing — don't repeat that.
- **No local filesystem on user side** — Munsif manually uploads HTML files to GitHub. Generate complete files, deliver via `present_files`. Don't assume git access.
- **Working directory**: `/home/claude/gulfledger/` for working files; `/mnt/user-data/outputs/` for delivery.
- **Compliance-conscious** — Munsif cares about ZATCA, VAT, audit trails. Don't shortcut compliance for convenience.

When in doubt: **clarify before coding**. Ship less, ship more carefully.

---

## Current architecture state

### Files in repo (as of last session)

**Production HTML files** (10 files, all deployed or about to deploy):
- `index.html` — landing page
- `login.html` — sign-in (token-based for pilot, no public signup yet)
- `join.html` — invitation-only signup with token (pilot users)
- `dashboard.html` — main app dashboard
- `purchasing.html` — **NEW (placeholder)**: suppliers + products procurement view + PO + imports/exports — currently a "coming soon" stub
- `invoices.html` — invoices list + create + edit + journal posting (Sales tab)
- `inventory.html` — suppliers + items + receiving (suppliers will move to Purchasing in next round)
- `finance.html` — **NEW (placeholder)**: expenses + bank accounts + reconciliation + cash flow — currently a "coming soon" stub
- `expenses.html` — expenses list + create + vendors (will become a redirect to finance.html in next round)
- `accounting.html` — chart of accounts + ledger + journal entries + VAT reports (will gain P&L + Balance Sheet in next round)
- `settings.html` — business profile, branding, layout, ZATCA, team management
- `reports.html` — reports (currently has 5 reports built but NOT YET DEPLOYED — will refocus to operational reports only)
- `invoice-view.html` — invoice preview / print
- (legacy: `invoices-original.html`, `invoice-view-original.html` — keep for reference, do not edit)

**SQL migrations** (in `migrations/` folder, applied in order):
- `d2-setup-popup.sql` — added setup_complete + vat_registered to businesses
- `2a-teams-ui.sql` → `2a-fix.sql` → `2a-fix-v2.sql` → `2a-fix-v3.sql` → `2a-add-missing-columns.sql` → `2a-fix-rls-and-admin-role.sql` → `2a-drop-legacy-policies.sql` — Teams table + RLS, took 7 attempts to get right
- `2-multitenant-b-rls.sql` — RLS rewrite for membership-based access on 17 tables + helper function + trigger
- `2-multitenant-b-hotfix-v2.sql` — backfilled missing owner membership rows
- `2c-fix-businesses-select.sql` — businesses table SELECT policy allows team members
- `2c-allow-removed-status.sql` — added 'removed' to status check constraint

### Tech decisions

- **No build step**: each HTML file is self-contained with inline `<script>` tags. No webpack, no React, no compilation. This is intentional for the pilot phase — Munsif uploads files directly to GitHub and Vercel deploys.
- **Supabase anon key is hardcoded** in every HTML file. Security relies entirely on RLS policies being correct. **Defense in depth still important**: JS keeps `business_id` filters even though RLS enforces it.
- **Mobile-first responsive** — Tajawal font, Saudi green, RTL primary.
- **Manual deployment workflow**: Claude generates files → Munsif uploads to GitHub → Vercel auto-deploys.

---

## Database schema

Supabase project ID: `ykzivnasjwtuhvjxfxzf`

### Core business tables

#### `businesses`
The tenant root. Each business is a separate workspace.

```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
user_id UUID — original owner (legacy field, not used for tenant routing anymore)
name TEXT
name_ar TEXT, name_en TEXT
trn TEXT (15 digits, ZATCA tax registration)
cr_number TEXT (10 digits, optional)
plan TEXT, plan_status TEXT
brand_color TEXT, logo_base64 TEXT
invoice_layout TEXT, invoice_footer TEXT
fiscal_year_start TEXT (e.g. '01-01')
vat_filing_frequency TEXT ('quarterly' or 'monthly')
vat_registered BOOLEAN — added in Round D2
setup_complete BOOLEAN NOT NULL DEFAULT FALSE — added in Round D2
phone, email, address, etc.
```

**RLS policies** (4):
- `biz_select`: `auth.uid() = user_id OR user_has_business_access(id)` — owners + team members can READ
- `biz_insert`: `auth.uid() = user_id` — only the creator
- `biz_update`: `auth.uid() = user_id` — owner only
- `biz_delete`: `auth.uid() = user_id` — owner only

Team members can READ (needed for `loadCurrentBusiness`) but cannot UPDATE the business profile.

#### `business_users` (the membership table)
Multi-tenant membership. Created in Round 2a.

```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE  -- nullable
email TEXT NOT NULL
full_name TEXT
role TEXT NOT NULL CHECK (role IN ('owner','admin','accountant','sales','warehouse','viewer'))
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','removed'))
invited_by UUID REFERENCES auth.users(id)
joined_at TIMESTAMPTZ DEFAULT NOW()
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
UNIQUE (business_id, user_id)
```

**Indexes**: `business_id`, `user_id`, `status`

**Triggers**:
- `trg_business_users_updated_at` BEFORE UPDATE — refreshes `updated_at`

**RLS policies** (4):
- `bu_select_own_memberships`: `user_id = auth.uid() OR business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())`
- `bu_insert_owner`: `business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())`
- `bu_update_owner`: same
- `bu_delete_owner`: same

**Status meanings**:
- `'active'` — current member, sees in team list, gains access
- `'inactive'` — legacy soft-delete (some old rows have this) — treated same as removed
- `'removed'` — hidden from team list, blocked at login (revoked screen), can be restored when re-adding same email

### Helper function (drives all data-table RLS)

```sql
CREATE OR REPLACE FUNCTION user_has_business_access(biz_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER  -- bypasses RLS on business_users to avoid recursion
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_users
    WHERE business_id = biz_id
      AND user_id = auth.uid()
      AND status = 'active'
  );
$$;
GRANT EXECUTE ON FUNCTION user_has_business_access(uuid) TO authenticated;
```

This is the single source of truth for "can this user access this business?" Every data-table policy uses it.

### Trigger for new business creation

```sql
CREATE OR REPLACE FUNCTION ensure_owner_membership() ...
-- AFTER INSERT ON businesses, auto-creates a row in business_users with role='owner'

CREATE TRIGGER trg_businesses_ensure_owner_membership
  AFTER INSERT ON businesses
  FOR EACH ROW EXECUTE FUNCTION ensure_owner_membership();
```

This ensures any code path that creates a `businesses` row also creates the corresponding owner membership — so the owner doesn't lock themselves out.

### Data tables (15 with `business_id`, 3 child tables)

All have RLS using `user_has_business_access(business_id)` for the 4 standard CRUD operations.

**Tables with business_id**:
`accounting_periods`, `audit_log`, `business_partners`, `chart_of_accounts`, `customers`, `expenses`, `inventory_batches`, `inventory_items`, `inventory_movements`, `invoices`, `journal_entries`, `stock_adjustments`, `stock_receipts`, `suppliers`

**Child tables (chain through parent)**:
- `invoice_items` → chains via `invoice_id` → `invoices.business_id`
- `stock_receipt_items` → chains via `receipt_id` → `stock_receipts.business_id`
- `journal_lines` → chains via `entry_id` → `journal_entries.business_id`

**audit_log special case**: Only SELECT + INSERT policies (immutable — no UPDATE/DELETE).

### Naming conventions

- All policy names follow `<prefix>_<operation>` (e.g. `inv_select`, `inv_insert`)
- Trigger names: `trg_<table>_<purpose>`
- All migrations idempotent — can be re-run safely

---

## Application architecture

### loadCurrentBusiness helper

Every page has this exact function (~30 lines). Returns `{biz, role, reason}`:

```js
async function loadCurrentBusiness(sb, user){
  // 1. Active membership (owner > admin > others)
  // 2. Inactive-only → reason='revoked'
  // 3. Brand-new user → auto-create business + owner row
}
```

**Important**: Don't try to consolidate this into a shared file. Each HTML page is standalone — duplication is intentional for the pilot deployment workflow.

### Page init pattern

Every page follows:
```js
async function init(){
  const session = await sb.auth.getSession();
  if(!session) → login.html
  const {biz, role, reason} = await loadCurrentBusiness(sb, user);
  if(!biz){
    if(reason === 'revoked') → render "Access revoked" UI
    else → notify error
    return;
  }
  currentBiz = biz;
  currentBiz._myRole = role;  // for future role-based features
  // ... rest of init
}
```

### Data query pattern

Standard pattern for fetching data:
```js
sb.from('invoices').select('*').eq('business_id', currentBiz.id)
```

**Don't filter by user_id for data tables** — RLS handles "can this user see it." Filtering by user_id would prevent team members from seeing owner's data.

**INSERTs DO record user_id** — the `user_id` column on data rows is "who created this" for audit trail. Different role can create rows; the column tracks them.

### Notify pattern

Toast notifications across pages:
```css
.notify {
  position: fixed; top: 96px; left: 50%; transform: translateX(-50%);
  z-index: 9999;  /* MUST be > 300 (topnav) and > 400 (modals) */
  max-width: calc(100vw - 40px);  /* mobile-safe */
}
```

### Modal pattern

Setup modal CSS pattern reused across:
- `.setup-modal-overlay` (z-index: 600 — above notify)
- `.setup-modal` — centered box
- `.setup-field` with `.error` state
- `.setup-btn-skip` (cancel) and `.setup-btn-save` (primary action)

This pattern is in dashboard.html (setup popup) AND settings.html (Add Member modal). Both share styling.

---

## What's done ✅

- [x] D1 — Canonical nav, profile menu
- [x] QA — Quick Action menu unified
- [x] Visual polish — logo, icons, loading states, ZATCA badge
- [x] D2 — First-time setup popup
- [x] Round 2a — Teams UI
  - [x] Add team member with email/password/role
  - [x] Team list visible to owner only
  - [x] Edit role (uses prompt() — ugly but functional)
  - [x] Remove member (status='removed', hidden from list)
  - [x] Re-add same email offers restore
  - [x] 'admin' role = full-access team member
- [x] Round 2-MultiTenant — full multi-tenancy
  - [x] business_users table + RLS policies
  - [x] user_has_business_access() helper function
  - [x] trg_businesses_ensure_owner_membership trigger
  - [x] loadCurrentBusiness() helper on all 7 pages
  - [x] 47 user_id filters dropped from data queries
  - [x] businesses table SELECT allows team members
- [x] Bug fixes
  - [x] Notify visibility (z-index 9999, top 96px) on 4 pages
  - [x] RLS recursion on business_users
  - [x] FK race condition on user signup (retry-with-backoff)
  - [x] Duplicate email detection (empty identities[])
  - [x] Email confirmation redirect → /login.html
  - [x] Data restore (backfilled owner memberships)

---

## Architecture roadmap (decided 2026-04-28)

This is the planned new architecture. Some has shipped (nav + placeholders), most has not.

### New navigation structure

```
Dashboard
Purchasing      ← NEW (suppliers, products procurement view, PO, imports/exports)
Sales           ← invoices.html (renamed in nav from "Invoices" to "Sales")
Inventory       ← refocused: stock list, movements, receiving, valuation, stock take
Finance         ← NEW (expenses, banking, reconciliation, cash flow)
Accounting      ← expanded: CoA, ledger, journal, VAT, + P&L, + Balance Sheet, + Cash Flow, + Trial Balance, + Bank Rec
Reports         ← refocused: operational reports only (customer statement, aged receivables/payables, sales/inventory/purchase reports)
Settings
```

### Build phases — what's shipped vs pending

**Phase 1 — Nav restructure + placeholders** ✅ SHIPPED
- New nav order across all pages: Dashboard → Purchasing → Sales → Inventory → Finance → Accounting → Reports
- `purchasing.html` and `finance.html` created as "coming soon" placeholders
- Quick Action menu refactored to match new structure (Sales/Purchasing/Inventory/Finance/Accounting categories)
- All 9 pages have consistent nav (dashboard, purchasing, invoices, inventory, finance, expenses, accounting, settings, reports)

**Phase 2 — Refocus reports.html to operational reports** ✅ SHIPPED
- Stripped P&L, VAT Summary, Balance Sheet from reports.html (already exist in accounting.html — `pane-reports` and `pane-vat`)
- Added 4 new operational reports: Sales by Customer, Sales by Product, Stock Valuation, Low Stock
- reports.html sidebar now organized into 3 groups: Customer Reports, Sales Reports, Stock Reports
- Cross-link to accounting.html for financial statements
- Operational reports total 6: Customer Statement, Aged Receivables, Sales by Customer, Sales by Product, Stock Valuation, Low Stock
- Bug fix: removed non-existent `buyer_id` reference from aged receivables query
- Bug fix: orphan `runCurrentReport` body restored after a previous edit had lost the function header

**Phase 3 — Build Purchasing tab** ⏳ PENDING
- Move suppliers from inventory.html → purchasing.html
- Build products-procurement view with margin% + markup% + GMROI + inventory turnover
- Cost basis = last purchase cost from `stock_receipt_items.unit_cost`
- PO module placeholder (deferred)
- Imports/exports placeholder (deferred)
- Refactor inventory.html to remove suppliers tab

**Phase 4 — Build Finance tab** ⏳ PENDING
- Move expenses content from expenses.html → finance.html
- Make expenses.html a redirect to finance.html
- Add bank accounts (table + UI)
- Add bank reconciliation (matching workflow)
- Add cash flow report (direct method)
- Add cash flow forecast (advanced, deferred)

**Phase 5 — Operational reports build-out** ⏳ PENDING
- Aged Payables (mirror of receivables)
- Sales reports (by customer, product, period)
- Inventory valuation report
- Purchase reports (by supplier, product)

### Decisions locked

- **Products in two views**: stock-focused under Inventory, decision-focused under Purchasing (with margin/markup auto-calculated)
- **Cost basis**: last purchase cost (from stock_receipt_items.unit_cost). Future enhancement: weighted-average via inventory_batches.
- **Margin AND markup shown together** (best practice — different audiences want different ones)
- **Other ratios for procurement view**: GMROI (gross margin return on investment), inventory turnover, days of stock — all computable from existing data
- **Move expenses to Finance tab**: yes, but keep `expenses.html` URL working as a redirect (no broken bookmarks)
- **No pilot user communication this round**: deploy and let users notice
- **Phase 1 only ships now**: placeholders + nav. Phases 2-5 to be built in future sessions using this HANDOVER.md as context.

### Files held back from deployment

- (None as of end of Phase 2 — reports.html is now ready for deployment with operational reports only)

---

## What's NOT done — TODO list

### High priority (next-up candidates)

1. **Round 2b — Role-based access enforcement**
   - Today, all team members see ALL data. Role is metadata only.
   - Need: nav visibility per role (warehouse user only sees inventory tab; accountant only sees accounting + reports; etc.)
   - Need: redirect from forbidden pages
   - Need: tighter RLS for sensitive tables (P&L, balance sheet, business_partners)
   - Roles already in DB. Just need JS gating + RLS refinements.

2. **Restrict sensitive data per Munsif's earlier flag**:
   - Financial statements (P&L, balance sheet, profit reports) → owner + accountant only
   - Business partners (suppliers/customers detail) → owner + accountant only (employees see invoices/expenses but not partner financials)
   - Currently: all team members see everything

3. **Language audit pass**:
   - Inconsistent Arabic/English coverage on some screens
   - Missing translations on some labels
   - Some hardcoded strings without `data-ar`/`data-en` attributes

4. **Reports tab build-out**:
   - reports.html is skeleton. Needs P&L, balance sheet, VAT summary, customer/supplier statements
   - Some logic exists in accounting.html (VAT period reports)

5. **Dashboard onboarding checklist**:
   - Munsif chose "checklist banner" over "guided tour"
   - Should show role-appropriate items (owner: full setup; warehouse: receiving items; etc.)
   - Items: Set up business → Add supplier → Add product → Issue first invoice → Add expense → File first VAT

### Medium priority

6. **Replace prompt() in Edit Role with proper modal** — currently functional but ugly
7. **Add VAT-registered toggle in settings.html** — D2 popup adds it on signup but no way to change later
8. **Audit log views** — table exists, no UI to view it
9. **Public signup + 15-day trial + payment integration** — depends on payment gateway readiness
10. **Affiliate program** — ?ref=CODE on signup, affiliate dashboard with commission tracking
11. **Permission checkboxes (Pattern C)** — owner can override role defaults per user. Deferred from Round 2a.
12. **Orphan auth.users cleanup tool** — Saas-admin page (not per-business) for Munsif to clean up old test users

### Low priority / future

- Phase 2 ZATCA epic (Rounds 18-25) — clearance, integration with Fatoora API, etc.
- Multi-business support — same user owning multiple businesses with switcher
- Mobile native apps — currently responsive web only
- AI Insights re-enable via Supabase Edge Function (currently disabled — CORS issue)

### Known minor issues

- `accounting.html` link in nav exists but file may not be in production repo (verify before launch)
- `gl_accountant_mode` localStorage flag has no UI toggle (advanced accounting view hidden behind manual setting)
- `invoice-view-original.html` and `invoices-original.html` — old files, kept for reference
- Some pages (reports.html mainly) are early skeletons, not fully built

---

## Known users (pilot)

As of 2026-04-28, 4 auth users exist with these owner businesses:

| Email | Role | Business |
|---|---|---|
| `monsef84@hotmail.com` | owner | Gulfledger |
| `monsefalsaada@gmail.com` | owner | شركة محاسبة الخليج للحلول المحاسبيه |
| `abdallah.ali@hotmail.com` | owner | Sweet Manafiz |
| `munsif.alsaadeh@sa.nestle.com` | owner | My Business |

Plus team members added via Settings → Team & Roles (variable).

`munsif.alsaadeh@sa.nestle.com` is also an `accountant` team member of `monsefalsaada@gmail.com`'s business (testing setup).

---

## Important Supabase project settings

- **Site URL**: should be `https://gulfledger.vercel.app`
- **Redirect URLs allowlist**: `https://gulfledger.vercel.app/**`
- **Email confirmation**: status unclear — needs verification. If on, signup flow includes email confirmation step. emailRedirectTo in our code points to `/login.html`. For pilot simplicity, can be turned OFF at: Authentication → Providers → Email → "Confirm email" toggle.

---

## How to deploy

Munsif's manual workflow:

1. Claude generates files in chat (`/mnt/user-data/outputs/`)
2. Munsif downloads via `present_files`
3. Munsif uploads to GitHub via web UI (drag-drop or commit via web editor)
4. Vercel auto-deploys on commit
5. Hard reload to test (Ctrl+Shift+R or Cmd+Shift+R)

For SQL: paste into Supabase SQL editor → Run → verify with diagnostic query.

---

## Pre-flight checklist for new chat

When starting a new chat session, copy-paste this into the first message to give the new Claude full context:

```
I'm continuing work on GulfLedger. Please read these files first before doing anything:
1. HANDOVER.md — current state, communication preferences, DB schema, architecture roadmap
2. PROGRESS.md — chronological log of past rounds (only if you need historical context)

Today I want to work on: [DESCRIBE NEXT TASK — likely Phase 2, 3, 4, or 5 from the architecture roadmap]
```

Then upload `HANDOVER.md` (and optionally `PROGRESS.md`) to the new chat.

**Suggested next sessions** (in order):
1. ~~Phase 2 — Migrate financial statements to Accounting~~ ✅ done
2. **Phase 3** — Build Purchasing tab (suppliers move + products procurement view with margin/markup/GMROI). Refactor inventory.html.
3. **Phase 4** — Build Finance tab (expenses move + bank accounts + reconciliation). expenses.html becomes redirect.
4. **Phase 5** — More operational reports (aged payables, supplier statement, purchase reports).

---

## Contact & links

- **Live site**: https://gulfledger.vercel.app
- **Repo**: github.com/Munsif84/gulfledger
- **Supabase project ID**: `ykzivnasjwtuhvjxfxzf`
- **Owner**: Munsif Alsaadeh — `monsef84@hotmail.com`

---

*Last full update: 2026-04-28, end of session that completed Phase 1 nav restructure.*
