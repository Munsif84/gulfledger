-- ═══ GulfLedger · ZATCA archive columns (idempotent) ═══
-- Columns the zatca-submit-invoice function stores on the invoice.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_status text DEFAULT 'not_required';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_submitted boolean DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_uuid text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_invoice_hash text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_qr_tlv text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_xml text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_icv bigint;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_submission_id uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS zatca_cleared_at timestamptz;
