# GulfLedger

Saudi-market accounting & invoicing SaaS for non-accountant SMEs. ZATCA Phase 2 + Fatoora + VAT compliant. Arabic-first.

**Live**: https://gulfledger.vercel.app

---

## For developers / contributors

**Start here**: [HANDOVER.md](./HANDOVER.md)

That document is the single source of truth for the project's current state, architecture, database schema, and what needs to be done next. Read it first before touching any code or SQL.

For chronological history of past work, see [PROGRESS.md](./PROGRESS.md).

---

## Quick stack reference

- **Frontend**: vanilla HTML/CSS/JS (no build step)
- **Backend**: Supabase (Postgres + auth + RLS)
- **Hosting**: Vercel (auto-deploys on commit to `main`)
- **Source**: this repo

---

## Repository structure

```
.
├── HANDOVER.md           ← READ THIS FIRST
├── PROGRESS.md           ← Project history
├── README.md             ← You are here
├── index.html            ← Landing page
├── login.html            ← Sign-in
├── join.html             ← Invite-only signup (pilot)
├── dashboard.html        ← Main app
├── invoices.html         ← Sales / invoices
├── inventory.html        ← Suppliers / items / receiving
├── expenses.html         ← Expenses / vendors
├── accounting.html       ← Chart of accounts, ledger, journal
├── settings.html         ← Business profile, team management
├── reports.html          ← P&L, VAT, statements, balance sheet
├── invoice-view.html     ← Invoice preview / print
└── migrations/           ← SQL migrations (run in order)
```

---

## License

Proprietary. © Munsif Alsaadeh.
