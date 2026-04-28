# GulfLedger — Progress Log

Chronological record of major rounds, decisions, and rationale. Append-only — each round adds an entry, nothing is rewritten.

This is the **history**. For current state and what's next, see `HANDOVER.md`.

---

## Format

Each entry includes:
- **Round name** + date
- **What was built** — concrete changes
- **Decisions made** — choices with rationale
- **Files touched**
- **Outcome** — shipped / reverted / partial

---

## Round D1 — Canonical nav and profile menu (earlier session)

**What was built**
- Unified topnav + app-nav across all 7 pages
- Profile dropdown (avatar, email, sign-out)
- Active-tab highlighting based on `window.location.pathname`

**Decisions**
- Inline JS per page (no shared script file) — keeps each HTML file self-contained for the manual GitHub upload workflow.
- Profile menu uses `position:absolute; z-index:400` — must stay above all content but below modals.

**Files**: dashboard / invoices / expenses / inventory / accounting / settings / reports

**Outcome**: ✅ Deployed.

---

## Round QA — Quick Action menu unification (earlier session)

**What was built**
- Unified Quick Action button in topnav across pages
- Keyboard shortcut: `Q` opens menu
- Mobile-friendly, touch-friendly
- Different items per page (e.g. "New Invoice" on invoices.html)

**Files**: dashboard / invoices / expenses / inventory / accounting / settings / reports

**Outcome**: ✅ Deployed.

---

## Round Visual Polish (earlier session)

**What was built**
- Logo refinements (Saudi green #006C35)
- Dashboard tab icon = inline SVG grid (replaced emoji)
- Sub-tab cleanup
- Loading state spinner pattern (gear emoji + pulse animation)
- ZATCA-compliance badge on invoice page

**Files**: index, dashboard, invoices

**Outcome**: ✅ Deployed.

---

## Round D2 — First-time setup popup (this session)

**What was built**
- First-time setup modal on dashboard.html
- Required: business name (Arabic), VAT-registered yes/no
- Conditional required: TRN if VAT-registered
- Optional: business name (English), CR number, fiscal year, VAT filing frequency
- Soft dismiss (close X, backdrop click, Esc) — popup returns next session until saved

**SQL migration**: `d2-setup-popup.sql`
- Added `setup_complete BOOLEAN NOT NULL DEFAULT FALSE`
- Added `vat_registered BOOLEAN`
- Backfilled existing pilot users with TRN to `setup_complete=true, vat_registered=true`

**Decisions**
- VAT-registered toggle handles freelancers (under SAR 375K revenue)
- Pre-fills existing data so partial users review + confirm rather than retype
- TRN validator inlined (15 digits, starts with 3, ends with 03)

**Files**: dashboard.html

**Outcome**: ✅ Deployed.

---

## Round 2a — Teams UI (this session)

**What was built**
- Settings → Team & Roles tab (replaced "Coming soon" placeholder)
- Owner-only gate (non-owners see "contact your owner")
- Add Member modal: email + password + name + role
- Team list with role pills, status, edit/remove actions
- 5 roles: owner / admin / accountant / sales / warehouse / viewer
  - **admin** added later in this round = full-access team member
- Hard-delete UX via `status='removed'` (hidden from list, allows re-add of same email)
- Re-add flow detects previous membership, offers to restore
- `checkRoleAccess()` dead code deleted from dashboard.html

**SQL migration journey** (took 6 attempts due to my guessing at table state — see lessons below):
1. `2a-teams-ui.sql` — failed, ON CONFLICT had no matching constraint
2. `2a-teams-ui-fix.sql` — failed, used array comparison `name[] = text[]` (type mismatch)
3. `2a-teams-ui-fix-v2.sql` — succeeded for constraint addition via DO $$ exception handler
4. `2a-teams-ui-fix-v3.sql` — full schema repair (added missing email/full_name/updated_at columns)
5. `2a-add-missing-columns.sql` — added `full_name` and `updated_at` after they were still missing
6. `2a-fix-rls-and-admin-role.sql` — fixed RLS recursion + added `admin` to role check
7. `2a-drop-legacy-policies.sql` — dropped 2 legacy policies that caused recursion (final fix)
8. `2c-allow-removed-status.sql` — added `'removed'` to status check constraint

**Final business_users schema** (after all migrations):
```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
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

**Final RLS policies** (4 on `business_users`):
- `bu_select_own_memberships`: `user_id = auth.uid() OR business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())`
- `bu_insert_owner`: `business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid())`
- `bu_update_owner`: same as insert
- `bu_delete_owner`: same as insert

**Decisions**
- **User creation flow**: 2nd Supabase client with `persistSession: false, autoRefreshToken: false` so signUp doesn't replace owner's session
- **FK race**: retry-with-backoff `[0, 400ms, 1s, 2s]` — auth.users propagation delay across connections
- **Duplicate email detection**: empty `signupData.user.identities[]` array (Supabase anti-enumeration design)
- **Soft delete preferred over hard delete** of auth.users — keeps audit trail, allows restore
- **Role storage is metadata only** — no enforcement yet (deferred to Round 2b)
- **Permission checkboxes (Pattern C)** rejected for MVP — too risky, deferred
- **Email confirmation handling**: emailRedirectTo set to `/login.html` so confirmation links land on signin page

**Files**: settings.html, dashboard.html, 8 SQL migrations

**Outcome**: ✅ Deployed after iteration. Working as of end of session.

---

## Round 2-MultiTenant — full multi-tenancy across all 7 pages (this session)

This was the biggest round. Had to be split into A → B → C after I tried "all 7 pages at once" and discovered mid-implementation that data filters by user_id meant team members would see empty pages even with proper biz lookup.

### Round 2-MultiTenant-A — Diagnostic

User ran 3 diagnostic queries (CSV export from Supabase) so I could see actual DB state:
- Which tables had RLS enabled (all 19)
- Which tables had business_id + user_id columns
- All current RLS policy definitions

**Outcome**: I had ground truth. Avoided more guessing.

### Round 2-MultiTenant-B — RLS migration

**SQL migration**: `2-multitenant-b-rls.sql`

- Created helper function `user_has_business_access(biz_id uuid) RETURNS boolean`
  - SECURITY DEFINER, STABLE
  - Checks `business_users` for active membership
  - Granted EXECUTE to `authenticated` role
- Rewrote 66 policies across 17 tables:
  - 14 tables with `business_id`: 4 policies each (SELECT/INSERT/UPDATE/DELETE) using helper
  - 3 child tables (`invoice_items`, `stock_receipt_items`, `journal_lines`): chain through parent's `business_id`
  - `audit_log`: 2 policies (SELECT + INSERT only — immutable)
- Created trigger `trg_businesses_ensure_owner_membership`:
  - AFTER INSERT ON businesses
  - Auto-creates owner row in `business_users`
  - Defends against any code path that creates a business without membership

**Then required hotfixes**:
- `2-multitenant-b-hotfix-v2.sql` — backfilled missing owner rows for all 4 existing pilot businesses (the original Round 2a backfill had silently failed during the migration retry chain)
- `2c-fix-businesses-select.sql` — businesses table SELECT policy needed updating so team members can read their owner's business row

**Decisions**
- **Helper function** vs inline policy expressions: helper chosen for clarity, performance (single function call vs subquery), single source of truth
- **businesses INSERT/UPDATE/DELETE** stay owner-only — only owner can change business profile
- **businesses SELECT** allows team members — needed for loadCurrentBusiness to read owner's biz row

### Round 2-MultiTenant-C — JS changes

**Helper function** `loadCurrentBusiness(sb, user)` added to all 7 pages. Returns `{biz, role, reason}`:

```js
async function loadCurrentBusiness(sb, user){
  // 1. Active membership (owner or team member) — prefer owner > admin > others
  // 2. Inactive-only membership → reason='revoked'
  // 3. Brand-new user → auto-create business + owner row
}
```

**Changes per page**:
- Replace `from('businesses').select('*').eq('user_id', user.id)` with `await loadCurrentBusiness(sb, user)`
- Drop `eq('user_id', user.id)` filter from data queries (47 filters total dropped)
- Keep `eq('business_id', biz.id)` filter (defense-in-depth alongside RLS)
- Keep `user_id` in INSERT payloads (records "who created this row" for audit trail)
- Add "Access revoked" UI screen for users whose membership was deactivated

**Files**: dashboard.html, settings.html, invoices.html, inventory.html, expenses.html, accounting.html, reports.html

**Counts of filters dropped per page**:
- accounting.html: 24 (was 25 incl. biz loading)
- invoices.html: 9
- expenses.html: 6
- inventory.html: 3
- dashboard.html: 3
- settings.html: 1 (just biz loading)
- reports.html: 1 (just biz loading)

**Decisions**
- **All team members see all business data** for now. Future round: restrict financial statements + partner details to owner+accountant.
- **business_id filter kept** even though RLS would block — defense in depth, plus performance (uses indexes)
- **user_id on INSERT preserved** — audit trail

**Outcome**: ✅ Deployed. Multi-tenancy working end-to-end. Both owner and team member workflows tested.

---

## Bug fixes shipped during this session

### Notify visibility bug
- All 4 pages with `notify()` toasts had z-index too low (200) and top too high (80px)
- Topnav z-index 300 + app-nav z-index 299 covered the toast
- Fixed: z-index 9999, top 96px, max-width: calc(100vw - 40px)
- Pages updated: settings, expenses, inventory, accounting

### RLS infinite recursion (Round 2a)
- Original `Members can read their business users` SELECT policy self-referenced `business_users` → recursion
- Diagnostic showed 3 SELECT policies coexisting — legacy ones never dropped
- Fixed by dropping all legacy policies + creating fresh `bu_*` set

### FK race on user creation
- `signUp()` from second client → `auth.users` row not visible to owner's session for ~hundreds of ms
- INSERT into `business_users` failed FK on first attempt
- Fixed: retry-with-backoff `[0, 400ms, 1s, 2s]`, only retry on FK code 23503

### Duplicate email handling
- Supabase anti-enumeration: signUp returns "success" with empty identities[] for existing emails
- Was showing generic FK error
- Fixed: detect empty identities, show clear "email already registered" message
- Plus: detect previous membership → offer restore instead

### Email confirmation redirect
- Default redirect went to `index.html` then "{"error":"requested path is invalid"}"
- Fixed: `emailRedirectTo: window.location.origin + '/login.html'` on signUp call
- (User option to disable email confirmation entirely in Supabase project settings)

### Data restore after multi-tenant migration
- After Round B RLS migration, owners couldn't see their data because they had no `business_users` membership rows
- Original Round 2a backfill had silently failed during migration retry chain
- Fixed: `2-multitenant-b-hotfix-v2.sql` — INSERT owner rows for all 4 businesses

---

## Round Phase-1 — Nav restructure + placeholders (2026-04-28)

After completing multi-tenancy, the user proposed a major architectural restructure to better match how SMEs actually think about business operations. The decision: split current functionality into clearer top-level concepts.

**What was built**

- New navigation order across all 9 pages:
  - Old: Dashboard → Inventory → Sales → Expenses → Accounting → Reports
  - New: Dashboard → Purchasing → Sales → Inventory → Finance → Accounting → Reports

- Two new HTML stub files:
  - `purchasing.html` — placeholder for suppliers + products procurement view + PO + imports/exports
  - `finance.html` — placeholder for expenses + bank accounts + reconciliation + cash flow

- Quick Action menu refactored across all 8 nav-having pages (dashboard, invoices, inventory, expenses, accounting, settings, reports + new files):
  - Old categories: Sales, Inventory, Expenses, Accounting
  - New categories: Sales, Purchasing, Inventory, Finance, Accounting

**Decisions**

- **All phases this round** (originally) → after pushback, scope reduced to Phase 1 only (placeholders) to avoid context window bloat in single chat
- **Products in two views**: stock-focused under Inventory, decision-focused under Purchasing (margin/markup/GMROI)
- **Cost basis**: last purchase cost (from `stock_receipt_items.unit_cost`)
- **Margin AND markup together** (best practice — different audiences)
- **Move expenses to Finance tab**: yes, but keep `expenses.html` URL as redirect
- **No pilot user communication**: deploy and let users notice
- **`reports.html` held back** — 1308-line build with 5 reports won't deploy until Phase 2 decides what stays in Reports vs moves to Accounting

**Files touched (8 nav updates + 2 new files)**

- dashboard.html — nav + QA menu updated
- invoices.html — nav + QA menu updated
- inventory.html — nav + QA menu updated
- expenses.html — nav + QA menu updated
- accounting.html — nav + QA menu updated
- settings.html — nav + QA menu updated
- reports.html — nav + QA menu updated (but file held from deploy)
- purchasing.html — NEW (22KB stub)
- finance.html — NEW (22KB stub)

**Lessons applied from prior rounds**

- Used Python regex to apply identical QA menu HTML to 7 files at once → consistent, mechanical, fewer typos than 7 manual edits
- Surveyed actual nav state before changing → discovered nav was already partially updated speculatively (saved a step)
- Validated JS in all 9 files after changes (acorn parse) → all clean ✓
- Pushed back hard on user's "all phases this round" choice → user accepted Phase 1 only after pushback

**Outcome**: ✅ Deployed. New nav structure visible to all pilot users. Both stubs render cleanly. No 404s. Phases 2-5 deferred to future sessions.

---

## Round Phase-2 — Reports refocus (2026-04-28)

After Phase 1 nav restructure, planned to migrate P&L + Balance Sheet from reports.html to accounting.html. Diagnostic survey discovered accounting.html ALREADY has P&L, Balance Sheet, AND Trial Balance built (with rich features: period comparison, period close/reopen, snapshots, CSV export, print). VAT also already exists in accounting.html as full ZATCA filing wizard (VAT/Zakat/Qawaem).

**Pivot**: Don't migrate anything. Strip duplicates from reports.html. Add operational reports.

**What was built**

- Stripped from reports.html: P&L, VAT Summary, Balance Sheet (3 sidebar links + 3 sections + 3 JS functions, ~270 lines deleted)
- Added 4 new operational reports:
  - **Sales by Customer** — period filter, ranked by total revenue, shows count + subtotal + VAT + total per customer
  - **Sales by Product** — period filter, groups by lowercase-trimmed description (handles "Sugar 1kg" vs "sugar 1kg"), avg price + qty + revenue
  - **Stock Valuation** — as-of date, qty × cost (prefer unit_cost, fallback cost_price), warns about items without cost set, notes historical-replay limitation
  - **Low Stock** — as-of date, qty ≤ reorder_point (or alert_level fallback), shows shortage + out-of-stock badge
- Reorganized sidebar into 3 groups: Customer Reports / Sales Reports / Stock Reports
- Added cross-link block to accounting.html for financial statements

**Schema diagnostics ran**

User ran 3 information_schema queries before code:
- `invoice_items`: has `description, description_ar, quantity, unit_price, subtotal, vat_amount, total` (no item_id FK to inventory_items)
- `inventory_items`: has `current_qty, unit_cost, cost_price, reorder_point, alert_level, supplier_id, preferred_supplier_id, is_active, sku, name, name_ar`
- `invoices`: confirmed `customer_id` (no `buyer_id`), `status`, `payment_status`, `subtotal, vat_amount, total`

**Bugs found and fixed**

1. **Orphan code block** — sub-step A's previous edit had lost the `runCurrentReport` function header, leaving a return statement outside any function. JS validation initially missed it. Fixed by reconstructing the function header.
2. **Non-existent buyer_id** — Aged Receivables query selected `buyer_id` which doesn't exist in `invoices` schema. Removed.

**Decisions**

- Don't duplicate financial reports in two places (reports.html + accounting.html) — strip duplicates
- Sales by Product groups by lowercase-trimmed description (best-effort fuzzy matching)
- Stock Valuation uses CURRENT qty (not historical replay at as-of date) — documented limitation
- Cost preference: `unit_cost` (set on stock receipts) over `cost_price` (default/standard cost)
- Low Stock threshold: prefer `reorder_point`, fall back to `alert_level`

**Files touched**

- reports.html (1308 → 1476 lines after strip + add)
- HANDOVER.md (Phase 2 marked complete, next-up list shifted)

**Outcome**: ✅ Ready to deploy. JS clean (3/3 blocks valid). 28/28 acceptance checks. No held files anymore.

---

## Lessons learned

1. **Schema migrations**: Ask user to run `information_schema` queries first, write SQL based on actual reality. Stop guessing. Diagnostic-first approach should be default.

2. **RLS issues**: List current policies BEFORE writing changes. Multiple policies can coexist and cause recursion / unexpected behavior.

3. **Error messages must be visible AND useful**:
   - Visible: notify z-index high enough (9999), positioned below all sticky bars
   - Useful: surface raw DB error message via `error.message`, not generic strings

4. **Smaller rounds = fewer bugs**: When I tried "all 7 pages at once" for multi-tenancy, discovered scope mid-implementation. Splitting into A (diagnostic) → B (SQL) → C (UI) made each step testable.

5. **Cross-cutting changes**: survey ALL touched code paths first. For 47 user_id filters across 7 pages, knowing the count up front would have shaped the plan.

6. **Auth changes are silent failures**: A user seeing wrong/no business is the worst outcome. Test thoroughly with multiple roles.

7. **Backfill verification**: After running data migrations, explicitly verify with a count query. Don't trust "Success" — check the actual rows.

8. **Long chats erode quality**: After ~6 substantial rounds in one chat, context bloat starts affecting later edits. Preventive measure: when a chat has done substantial work AND a major new direction is being introduced, ship clean foundation + handover, then start fresh chat for execution. HANDOVER.md was specifically designed to make this handoff seamless.

9. **Don't ship navigation that points to nonexistent files**: When introducing new tabs in the nav, the corresponding HTML files must exist (even as stubs) BEFORE deploy. Otherwise pilot users hit 404s.

10. **Always survey existing code before "migrating"**: Phase 2 was originally planned as "migrate P&L + Balance Sheet to accounting.html." A diagnostic showed accounting.html already had richer implementations of everything we'd planned to migrate. Saved hours of duplicate work. Survey first, plan second.

11. **Acorn JS validation can miss top-level orphan code with `return outside function`**: When a function's opening `async function name(){` line gets accidentally deleted, the body becomes orphan code. The validator may mark blocks as valid because each `<script>` block is parsed independently and certain orphan structures parse as valid expressions. After major edits, also do a sanity check: `grep -c "^async function"` and `grep -c "^function"` to confirm function counts match expectations.

---

## What's NOT been done

See `HANDOVER.md` for current TODO list and next-up priorities.
