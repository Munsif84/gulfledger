-- ============================================
-- GulfLedger Database Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- BUSINESSES (one per client account)
CREATE TABLE businesses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  trn TEXT,
  cr_number TEXT,
  address TEXT,
  city TEXT,
  postal_code TEXT,
  email TEXT,
  phone TEXT,
  logo_url TEXT,
  tagline TEXT,
  business_type TEXT DEFAULT 'services',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVOICES
CREATE TABLE invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  invoice_number TEXT NOT NULL,
  invoice_type TEXT DEFAULT 'b2b',
  status TEXT DEFAULT 'draft',
  issue_date DATE NOT NULL,
  buyer_name TEXT,
  buyer_trn TEXT,
  buyer_address TEXT,
  buyer_email TEXT,
  subtotal NUMERIC(15,2) DEFAULT 0,
  vat_amount NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  notes TEXT,
  zatca_submitted BOOLEAN DEFAULT FALSE,
  zatca_uuid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVOICE ITEMS
CREATE TABLE invoice_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(10,3) DEFAULT 1,
  unit_price NUMERIC(15,2) DEFAULT 0,
  subtotal NUMERIC(15,2) DEFAULT 0,
  vat_amount NUMERIC(15,2) DEFAULT 0,
  total NUMERIC(15,2) DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

-- JOURNAL ENTRIES (Ledger)
CREATE TABLE journal_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  entry_date DATE NOT NULL,
  reference TEXT,
  description TEXT,
  entry_hash TEXT,
  prev_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- JOURNAL LINES (debit/credit)
CREATE TABLE journal_lines (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT,
  debit NUMERIC(15,2) DEFAULT 0,
  credit NUMERIC(15,2) DEFAULT 0,
  narration TEXT
);

-- INVENTORY ITEMS
CREATE TABLE inventory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  sku TEXT,
  category TEXT,
  unit TEXT DEFAULT 'piece',
  cost_price NUMERIC(15,2) DEFAULT 0,
  sale_price NUMERIC(15,2) DEFAULT 0,
  current_qty NUMERIC(10,3) DEFAULT 0,
  alert_level NUMERIC(10,3) DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- INVENTORY MOVEMENTS
CREATE TABLE inventory_movements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE NOT NULL,
  movement_type TEXT NOT NULL,
  quantity NUMERIC(10,3) NOT NULL,
  balance_after NUMERIC(10,3),
  reference TEXT,
  note TEXT,
  movement_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUPPLIERS
CREATE TABLE suppliers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  trn TEXT,
  email TEXT,
  city TEXT,
  supplier_type TEXT DEFAULT 'distributor',
  payment_terms TEXT DEFAULT 'cash',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Each user sees only their own data
-- ============================================

ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

-- Businesses policies
CREATE POLICY "Users see own businesses" ON businesses FOR ALL USING (auth.uid() = user_id);

-- Invoices policies
CREATE POLICY "Users see own invoices" ON invoices FOR ALL USING (auth.uid() = user_id);

-- Invoice items (via invoice ownership)
CREATE POLICY "Users see own invoice items" ON invoice_items FOR ALL
  USING (invoice_id IN (SELECT id FROM invoices WHERE user_id = auth.uid()));

-- Journal entries policies
CREATE POLICY "Users see own entries" ON journal_entries FOR ALL USING (auth.uid() = user_id);

-- Journal lines (via entry ownership)
CREATE POLICY "Users see own lines" ON journal_lines FOR ALL
  USING (entry_id IN (SELECT id FROM journal_entries WHERE user_id = auth.uid()));

-- Inventory policies
CREATE POLICY "Users see own inventory" ON inventory_items FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users see own movements" ON inventory_movements FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE user_id = auth.uid()));

-- Suppliers policies
CREATE POLICY "Users see own suppliers" ON suppliers FOR ALL USING (auth.uid() = user_id);
