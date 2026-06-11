# GulfLedger — Chart-of-Accounts Pack Validation Package
**For review by a Saudi-licensed accountant (SOCPA)** · Generated from production code · June 2026

## What we need from you
GulfLedger seeds a SOCPA-aligned chart of accounts for new SMEs based on declared business activity: the **universal core** plus one **activity pack**. Please validate:

1. Is each pack's account list appropriate and sufficient for a typical Saudi SME of that activity?
2. Is the P&L presentation (by function vs by nature, per IFRS for SMEs §5) right for each activity?
3. Any accounts missing that ZATCA/Zakat filing or common audit requests need?
4. Any Arabic account names non-standard for KSA practice?

(Regulated sectors — banking, insurance, telecom, oil & gas — are out of product scope and excluded.)

## Universal core — every business (99 accounts)

| Code | English | Arabic | Type |
|---|---|---|---|
| 1000 | Current Assets | الأصول المتداولة | asset |
| 1100 | Cash on Hand | النقد في الصندوق | asset |
| 1110 | Petty Cash | عهدة نقدية | asset |
| 1120 | Bank — Operating | البنك — الحساب التشغيلي | asset |
| 1121 | Bank — Savings | البنك — حساب الادخار | asset |
| 1130 | Cheques in Hand | شيكات تحت التحصيل | asset |
| 1200 | Trade Receivables | ذمم مدينة تجارية | asset |
| 1210 | AR — Current (0-30d) | ذمم مدينة — جارية | asset |
| 1290 | Allowance for Doubtful Accounts | مخصص الديون المشكوك بها | asset |
| 1300 | Inventory | المخزون | asset |
| 1300 | Inventory | المخزون | asset |
| 1330 | Inventory — Finished Goods | المخزون — تامة الصنع | asset |
| 1400 | Prepaid Expenses | مصاريف مدفوعة مقدماً | asset |
| 1410 | Prepaid Rent | إيجار مدفوع مقدماً | asset |
| 1420 | Prepaid Insurance | تأمين مدفوع مقدماً | asset |
| 1500 | VAT Input (Recoverable) | ضريبة القيمة المضافة — مدخلات | asset |
| 1500 | VAT Input (Recoverable) | ضريبة القيمة المضافة — مدخلات | asset |
| 1510 | Prepaid Expenses — Other | مصاريف مدفوعة مقدماً — أخرى | asset |
| 1520 | Employee Advances | سلف الموظفين | asset |
| 1530 | Supplier Advances | دفعات للموردين | asset |
| 1540 | Deposits & Guarantees Paid | تأمينات وضمانات مدفوعة | asset |
| 1550 | Income Tax Receivable | ضريبة دخل مستحقة الاسترداد | asset |
| 1560 | Withholding Tax Recoverable | ضريبة استقطاع مستحقة الاسترداد | asset |
| 1700 | Non-Current Assets | الأصول غير المتداولة | asset |
| 1700 | Non-Current Assets | الأصول غير المتداولة | asset |
| 1710 | Land | الأراضي | asset |
| 1720 | Buildings | المباني | asset |
| 1730 | Plant & Machinery | الآلات والمعدات | asset |
| 1740 | Vehicles | المركبات | asset |
| 1750 | Furniture & Fixtures | الأثاث والتجهيزات | asset |
| 1760 | IT Equipment | معدات تقنية المعلومات | asset |
| 1770 | Intangible Assets | الأصول غير الملموسة | asset |
| 1780 | Investment Property | العقارات الاستثمارية | asset |
| 1790 | Accumulated Depreciation | مجمع الإهلاك | asset |
| 2000 | Current Liabilities | الخصوم المتداولة | liability |
| 2100 | Trade Payables | ذمم دائنة تجارية | liability |
| 2200 | VAT Liabilities | التزامات ضريبة القيمة المضافة | liability |
| 2200 | VAT Liabilities | التزامات ضريبة القيمة المضافة | liability |
| 2210 | VAT Output (on Sales) | ضريبة القيمة المضافة — مخرجات | liability |
| 2220 | VAT Payable | ضريبة القيمة المضافة المستحقة | liability |
| 2230 | VAT Reverse-Charge Payable | ضريبة القيمة المضافة العكسية | liability |
| 2300 | Payroll Liabilities | التزامات الرواتب | liability |
| 2300 | Payroll Liabilities | التزامات الرواتب | liability |
| 2310 | Salaries Payable | رواتب مستحقة الدفع | liability |
| 2320 | GOSI Payable | التأمينات الاجتماعية المستحقة | liability |
| 2400 | Tax Liabilities | التزامات الضرائب | liability |
| 2400 | Tax Liabilities | التزامات الضرائب | liability |
| 2500 | Accrued Expenses | مصاريف مستحقة الدفع | liability |
| 2500 | Accrued Expenses | مصاريف مستحقة الدفع | liability |
| 2600 | Short-term Loans | قروض قصيرة الأجل | liability |
| 2600 | Short-term Loans | قروض قصيرة الأجل | liability |
| 2700 | Deferred Revenue | إيرادات مؤجلة | liability |
| 2700 | Deferred Revenue | إيرادات مؤجلة | liability |
| 2800 | Non-Current Liabilities | الخصوم غير المتداولة | liability |
| 2800 | Non-Current Liabilities | الخصوم غير المتداولة | liability |
| 2810 | Long-term Loans | قروض طويلة الأجل | liability |
| 2820 | EOSB Reserve (Long-term) | مكافأة نهاية الخدمة طويلة الأجل | liability |
| 3000 | Equity | حقوق الملكية | equity |
| 3100 | Share Capital | رأس المال | equity |
| 3200 | Retained Earnings | الأرباح المحتجزة | equity |
| 3300 | Owner's Drawings | المسحوبات | equity |
| 3500 | Statutory Reserve | الاحتياطي النظامي | equity |
| 4000 | Operating Revenue | الإيرادات التشغيلية | income |
| 4100 | Sales Revenue | إيرادات المبيعات | income |
| 4100 | Sales Revenue | إيرادات المبيعات | income |
| 4110 | Sales — Standard Rated (15% VAT) | مبيعات قياسية 15% | income |
| 4120 | Sales — Zero Rated | مبيعات بالمعدل الصفري | income |
| 4190 | Sales Returns & Allowances | مرتجعات مبيعات | income |
| 4200 | Service Revenue | إيرادات الخدمات | income |
| 4900 | Other Income | إيرادات أخرى | income |
| 4900 | Other Income | إيرادات أخرى | income |
| 5000 | Cost of Sales | تكلفة المبيعات | expense |
| 5000 | Cost of Sales | تكلفة المبيعات | expense |
| 6000 | Selling Expenses | مصاريف البيع | expense |
| 6000 | Selling Expenses | مصاريف البيع | expense |
| 6100 | Salesperson Salaries | رواتب موظفي المبيعات | expense |
| 6200 | Marketing & Advertising | مصاريف التسويق والإعلان | expense |
| 7000 | General & Administrative | مصاريف عمومية وإدارية | expense |
| 7000 | General & Administrative | مصاريف عمومية وإدارية | expense |
| 7100 | Administrative Salaries | رواتب إدارية | expense |
| 7200 | Rent — Office | إيجار المكتب | expense |
| 7300 | Utilities | المرافق | expense |
| 7310 | Electricity | الكهرباء | expense |
| 7320 | Water | المياه | expense |
| 7400 | Telecom & Internet | الاتصالات والإنترنت | expense |
| 7500 | Insurance | التأمين | expense |
| 7600 | Legal & Professional Fees | الرسوم القانونية والمهنية | expense |
| 7700 | Stationery & Office Supplies | القرطاسية ومستلزمات المكتب | expense |
| 7800 | Maintenance & Repair | الصيانة والإصلاح | expense |
| 7900 | Depreciation — G&A Assets | إهلاك أصول إدارية | expense |
| 8000 | Other Operating Expenses | مصاريف تشغيلية أخرى | expense |
| 8000 | Other Operating Expenses | مصاريف تشغيلية أخرى | expense |
| 8400 | Entertainment | ضيافة | expense |
| 8700 | Miscellaneous Operating Expenses | مصاريف تشغيلية متنوعة | expense |
| 9000 | Finance Costs | تكاليف تمويلية | expense |
| 9000 | Finance Costs | تكاليف تمويلية | expense |
| 9100 | Interest Expense | فوائد على القروض | expense |
| 9200 | Tax Expenses | مصاريف الضرائب | expense |
| 9210 | Zakat Expense | مصروف الزكاة | expense |

## Activity packs (added on top of core)

### wholesale · P&L: By Function (Cost of Sales & Gross Profit shown) · +11 accounts

| Code | English | Arabic |
|---|---|---|
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 5130 | COGS — Manufacturing Overhead | تكلفة — مصاريف صناعية |
| 1220 | AR — 31-60 days | ذمم مدينة — 31-60 يوم |
| 1230 | AR — 61-90 days | ذمم مدينة — 61-90 يوم |
| 1240 | AR — Over 90 days | ذمم مدينة — أكثر من 90 يوم |
| 1310 | Inventory — Raw Materials | المخزون — المواد الخام |
| 1320 | Inventory — WIP | المخزون — تحت التشغيل |
| 1340 | Inventory — Goods in Transit | المخزون — في الطريق |
| 6300 | Sales Travel | سفر المبيعات |
| 6400 | Shipping & Delivery (outbound) | شحن وتوصيل (مبيعات) |

### retail · P&L: By Function (Cost of Sales & Gross Profit shown) · +3 accounts

| Code | English | Arabic |
|---|---|---|
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 6110 | Sales Commissions | عمولات المبيعات |
| 6400 | Shipping & Delivery (outbound) | شحن وتوصيل (مبيعات) |

### trading · P&L: By Function (Cost of Sales & Gross Profit shown) · +11 accounts

| Code | English | Arabic |
|---|---|---|
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 5130 | COGS — Manufacturing Overhead | تكلفة — مصاريف صناعية |
| 1220 | AR — 31-60 days | ذمم مدينة — 31-60 يوم |
| 1230 | AR — 61-90 days | ذمم مدينة — 61-90 يوم |
| 1240 | AR — Over 90 days | ذمم مدينة — أكثر من 90 يوم |
| 1310 | Inventory — Raw Materials | المخزون — المواد الخام |
| 1320 | Inventory — WIP | المخزون — تحت التشغيل |
| 1340 | Inventory — Goods in Transit | المخزون — في الطريق |
| 6300 | Sales Travel | سفر المبيعات |
| 6400 | Shipping & Delivery (outbound) | شحن وتوصيل (مبيعات) |

### manufacturing · P&L: By Function (Cost of Sales & Gross Profit shown) · +13 accounts

| Code | English | Arabic |
|---|---|---|
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 5130 | COGS — Manufacturing Overhead | تكلفة — مصاريف صناعية |
| 5140 | COGS — Freight In | تكلفة — مصاريف شحن داخل |
| 1310 | Inventory — Raw Materials | المخزون — المواد الخام |
| 1320 | Inventory — WIP | المخزون — تحت التشغيل |
| 1330 | Inventory — Finished Goods | المخزون — تامة الصنع |
| 1340 | Inventory — Goods in Transit | المخزون — في الطريق |
| 1220 | AR — 31-60 days | ذمم مدينة — 31-60 يوم |
| 1230 | AR — 61-90 days | ذمم مدينة — 61-90 يوم |
| 1240 | AR — Over 90 days | ذمم مدينة — أكثر من 90 يوم |
| 6300 | Sales Travel | سفر المبيعات |
| 6400 | Shipping & Delivery (outbound) | شحن وتوصيل (مبيعات) |

### construction · P&L: Mixed presentation · +11 accounts

| Code | English | Arabic |
|---|---|---|
| 4150 | Contract Revenue | إيرادات العقود |
| 4160 | Contract Revenue — Long-term | إيرادات عقود طويلة الأجل |
| 1450 | Accrued Receivables | إيرادات مستحقة |
| 2580 | Advance Billings (Contract Liability) | فواتير مقدمة (التزامات عقود) |
| 2590 | Retention Payable | محتجزات تحت الدفع |
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 5130 | COGS — Manufacturing Overhead | تكلفة — مصاريف صناعية |
| 1220 | AR — 31-60 days | ذمم مدينة — 31-60 يوم |
| 1230 | AR — 61-90 days | ذمم مدينة — 61-90 يوم |
| 1240 | AR — Over 90 days | ذمم مدينة — أكثر من 90 يوم |

### services · P&L: By Nature (no Cost of Sales line) · +4 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 4220 | Service Revenue — Zero Rated | إيرادات خدمات بالمعدل الصفري |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |
| 1460 | Costs to Obtain Contract | تكاليف الحصول على عقد |

### consulting · P&L: By Nature (no Cost of Sales line) · +5 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 4220 | Service Revenue — Zero Rated | إيرادات خدمات بالمعدل الصفري |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |
| 1460 | Costs to Obtain Contract | تكاليف الحصول على عقد |
| 6300 | Sales Travel | سفر المبيعات |

### professional · P&L: By Nature (no Cost of Sales line) · +4 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 4220 | Service Revenue — Zero Rated | إيرادات خدمات بالمعدل الصفري |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |
| 1460 | Costs to Obtain Contract | تكاليف الحصول على عقد |

### saas · P&L: By Nature (no Cost of Sales line) · +5 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 4220 | Service Revenue — Zero Rated | إيرادات خدمات بالمعدل الصفري |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |
| 2720 | Deferred Revenue (Long-term) | إيرادات مؤجلة (طويلة الأجل) |
| 1460 | Costs to Obtain Contract | تكاليف الحصول على عقد |

### technology · P&L: By Nature (no Cost of Sales line) · +3 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 4220 | Service Revenue — Zero Rated | إيرادات خدمات بالمعدل الصفري |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |

### hospitality · P&L: Mixed presentation · +8 accounts

| Code | English | Arabic |
|---|---|---|
| 4130 | Sales — Exempt | مبيعات معفاة |
| 4140 | Sales — Export | مبيعات تصدير |
| 4170 | Service Charges Revenue | إيرادات رسوم الخدمة |
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 1310 | Inventory — Raw Materials | المخزون — المواد الخام |
| 1330 | Inventory — Finished Goods | المخزون — تامة الصنع |
| 2330 | EOSB Accrual (Short-term) | مكافأة نهاية الخدمة قصيرة الأجل |

### restaurant · P&L: Mixed presentation · +7 accounts

| Code | English | Arabic |
|---|---|---|
| 4130 | Sales — Exempt | مبيعات معفاة |
| 4170 | Service Charges Revenue | إيرادات رسوم الخدمة |
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |
| 5120 | COGS — Direct Labor | تكلفة — أجور مباشرة |
| 1310 | Inventory — Raw Materials | المخزون — المواد الخام |
| 1330 | Inventory — Finished Goods | المخزون — تامة الصنع |
| 2330 | EOSB Accrual (Short-term) | مكافأة نهاية الخدمة قصيرة الأجل |

### healthcare · P&L: By Nature (no Cost of Sales line) · +2 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |

### education · P&L: By Nature (no Cost of Sales line) · +2 accounts

| Code | English | Arabic |
|---|---|---|
| 4210 | Service Revenue — Standard Rated | إيرادات خدمات قياسية |
| 2710 | Deferred Revenue (Short-term) | إيرادات مؤجلة (قصيرة الأجل) |

### real_estate · P&L: By Nature (no Cost of Sales line) · +4 accounts

| Code | English | Arabic |
|---|---|---|
| 4280 | Rental Income | إيرادات الإيجار |
| 4290 | Investment Property Income | إيرادات العقارات الاستثمارية |
| 1780 | Investment Property | العقارات الاستثمارية |
| 2750 | Tenant Deposits | تأمينات المستأجرين |

### other · P&L: By Function (Cost of Sales & Gross Profit shown) · +1 accounts

| Code | English | Arabic |
|---|---|---|
| 5110 | COGS — Materials/Purchases | تكلفة — مواد ومشتريات |

## Open questions for the reviewer

1. **Construction** (mixed P&L): should WIP / contract-asset accounts follow IFRS 15 percentage-of-completion in the base pack, or is completed-contract acceptable at SME scope?
2. **Manufacturing**: is a separate factory-overhead clearing account expected in KSA practice beyond the COGS Materials/Labor/Overhead split?
3. **Restaurants**: is a food-cost/beverage-cost split required, or is single COGS acceptable for ZATCA?
4. **Professional/clinics**: any sector-specific Zakat treatments requiring dedicated accounts?
5. **Real estate**: pack assumes operating-lease income; should IFRS 16 right-of-use accounts join the universal core?
6. **Depreciation posting**: the asset register posts all depreciation to 7900 (G&A). Should manufacturing assets depreciate into production cost (e.g. 5130 overhead) instead?
