/* ═══════════════════════════════════════════════════════════════════════════
   GULFLEDGER COMMAND PALETTE · gl-command.js
   ──────────────────────────────────────────────────────────────────────────
   Ctrl+K / Cmd+K from anywhere → search-driven navigation + quick actions.
   The "power user" layer that separates best-in-class SaaS from basic tools.

   Self-contained: injects its own styles (design-system tokens) and DOM.
   Add to a page with: <script src="/gl-command.js" defer></script>
   Bilingual matching: every command carries AR + EN + keyword strings; the
   query matches any of them, so "فاتورة", "invoice" or "inv" all work.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if (window.__glCmdLoaded) return; window.__glCmdLoaded = true;

  var ICONS = '/gl-icons.svg';
  function I(name){ return '<svg class="glc-i"><use href="' + ICONS + '#' + name + '"/></svg>'; }

  /* ── Command registry ─────────────────────────────────────────────── */
  var COMMANDS = [
    /* Navigate */
    { ar:'لوحة التحكم',        en:'Dashboard',            kw:'home dash لوحة الرئيسية',          icon:'i-chart',      href:'dashboard.html',  group:'nav' },
    { ar:'المبيعات والفواتير', en:'Sales & Invoices',     kw:'invoices sales فواتير مبيعات',     icon:'i-invoice',    href:'invoices.html',   group:'nav' },
    { ar:'المحاسبة',           en:'Accounting',           kw:'ledger journal gl محاسبة دفتر قيود', icon:'i-ledger',   href:'accounting.html', group:'nav' },
    { ar:'المالية والمصاريف',  en:'Finance & Expenses',   kw:'expenses bills مصاريف مالية',      icon:'i-cash',       href:'finance.html',    group:'nav' },
    { ar:'المخزون',            en:'Inventory',            kw:'stock products مخزون منتجات',      icon:'i-package',    href:'inventory.html',  group:'nav' },
    { ar:'المشتريات',          en:'Purchasing',           kw:'suppliers po مشتريات موردين',      icon:'i-factory',    href:'purchasing.html', group:'nav' },
    { ar:'التقارير',           en:'Reports',              kw:'reports pl balance تقارير قوائم',   icon:'i-trend-up',   href:'reports.html',    group:'nav' },
    { ar:'الإعدادات',          en:'Settings',             kw:'settings config إعدادات ضبط',      icon:'i-settings',   href:'settings.html',   group:'nav' },
    /* Create */
    { ar:'فاتورة جديدة',       en:'New Invoice',          kw:'create new invoice فاتورة جديدة',  icon:'i-plus',       href:'invoices.html?action=new_invoice',                    group:'new' },
    { ar:'عميل جديد',          en:'New Customer',         kw:'create customer عميل جديد',        icon:'i-user',       href:'invoices.html?action=new_customer',                   group:'new' },
    { ar:'مصروف جديد',         en:'New Expense',          kw:'create expense مصروف جديد',        icon:'i-cash-out',   href:'finance.html?tab=expenses&action=new_expense',        group:'new' },
    { ar:'قيد محاسبي جديد',    en:'New Journal Entry',    kw:'create journal entry قيد جديد',    icon:'i-ledger',     href:'accounting.html?sub=ledger&action=new_journal',       group:'new' },
    { ar:'مورد جديد',          en:'New Supplier',         kw:'create supplier مورد جديد',        icon:'i-factory',    href:'purchasing.html?tab=suppliers&action=new_supplier',   group:'new' },
    { ar:'استلام بضاعة',       en:'Receive Stock',        kw:'receive stock grn استلام بضاعة',   icon:'i-receipt-in', href:'inventory.html?tab=receive&action=new_receipt',       group:'new' },
    /* Reports (deep links) */
    { ar:'قائمة الدخل',        en:'Profit & Loss',        kw:'pl income statement قائمة الدخل أرباح', icon:'i-chart', href:'accounting.html?sub=report-pl',  group:'report' },
    { ar:'الميزانية العمومية', en:'Balance Sheet',        kw:'bs balance ميزانية مركز مالي',     icon:'i-scale',      href:'accounting.html?sub=report-bs',  group:'report' },
    { ar:'إقرار ضريبة القيمة المضافة', en:'VAT Return',  kw:'vat zatca ضريبة إقرار',            icon:'i-document',   href:'accounting.html?sub=report-vat', group:'report' },
    /* System */
    { ar:'التبديل إلى English', en:'Switch to العربية',   kw:'language لغة english عربي switch', icon:'i-globe',      action:'lang',          group:'sys' },
  ];

  var GROUPS = {
    nav:    { ar:'الانتقال إلى',   en:'Go to' },
    'new':  { ar:'إنشاء جديد',     en:'Create new' },
    report: { ar:'التقارير',       en:'Reports' },
    sys:    { ar:'النظام',         en:'System' },
  };

  /* ── Styles (design-system tokens only) ──────────────────────────── */
  var css = ''
  + '.glc-backdrop{position:fixed;inset:0;background:rgba(13,20,16,0.40);z-index:99990;display:none;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;backdrop-filter:blur(2px);}'
  + '.glc-backdrop.open{display:flex;animation:glcFade .12s ease-out;}'
  + '@keyframes glcFade{from{opacity:0}to{opacity:1}}'
  + '.glc{width:100%;max-width:560px;background:var(--color-bg-surface,#fff);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,0.28);overflow:hidden;display:flex;flex-direction:column;max-height:62vh;animation:glcPop .14s cubic-bezier(0.16,1,0.3,1);}'
  + '@keyframes glcPop{from{opacity:0;transform:translateY(-6px) scale(0.99)}to{opacity:1;transform:none}}'
  + '.glc-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--color-border,#E5E7EB);}'
  + '.glc-head .glc-i{width:18px;height:18px;color:var(--color-text-muted,#737373);flex-shrink:0;}'
  + '.glc-input{flex:1;border:none;outline:none;font-family:var(--font-sans,sans-serif);font-size:15px;color:var(--color-text-strong,#171717);background:transparent;min-width:0;}'
  + '.glc-input::placeholder{color:var(--color-text-faint,#A3A3A3);}'
  + '.glc-esc{font-size:10px;font-weight:700;color:var(--color-text-faint,#A3A3A3);border:1px solid var(--color-border,#E5E7EB);border-radius:4px;padding:2px 6px;flex-shrink:0;}'
  + '.glc-list{overflow-y:auto;padding:6px;}'
  + '.glc-group{font-size:10.5px;font-weight:700;color:var(--color-text-faint,#A3A3A3);text-transform:uppercase;letter-spacing:.06em;padding:10px 12px 4px;}'
  + '.glc-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:8px;cursor:pointer;font-size:13.5px;color:var(--color-text-default,#404040);}'
  + '.glc-item .glc-i{width:17px;height:17px;color:var(--color-text-muted,#737373);flex-shrink:0;}'
  + '.glc-item.sel{background:var(--color-primary-soft,rgba(0,108,53,.08));color:var(--color-primary,#006C35);}'
  + '.glc-item.sel .glc-i{color:var(--color-primary,#006C35);}'
  + '.glc-item .glc-sub{margin-inline-start:auto;font-size:11px;color:var(--color-text-faint,#A3A3A3);}'
  + '.glc-empty{text-align:center;padding:28px 16px;color:var(--color-text-muted,#737373);font-size:13px;}'
  + '.glc-hint{display:flex;gap:14px;padding:8px 16px;border-top:1px solid var(--color-border,#E5E7EB);font-size:10.5px;color:var(--color-text-faint,#A3A3A3);}'
  + '.glc-hint b{font-weight:700;color:var(--color-text-muted,#737373);}'
  + '@media (max-width:560px){.glc-backdrop{padding:8vh 8px 8px;}.glc{max-height:74vh;}}'
  /* Topnav trigger button (self-injected before .gl-qa-btn) */
  + '.glc-trigger{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border:1px solid rgba(255,255,255,0.28);border-radius:8px;background:rgba(255,255,255,0.10);color:#fff;font-family:var(--font-sans,sans-serif);font-size:12.5px;cursor:pointer;transition:background .12s,border-color .12s;margin-inline-end:8px;}'
  + '.glc-trigger:hover{background:rgba(255,255,255,0.18);border-color:rgba(255,255,255,0.45);}'
  + '.glc-trigger .glc-i{width:15px;height:15px;}'
  + '.glc-trigger kbd{font-family:var(--font-sans,sans-serif);font-size:10px;font-weight:700;border:1px solid rgba(255,255,255,0.35);border-radius:4px;padding:1px 5px;opacity:0.85;}'
  + '@media (max-width:719px){.glc-trigger .glc-tr-label,.glc-trigger kbd{display:none;}.glc-trigger{padding:7px 9px;margin-inline-end:6px;}}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── DOM ──────────────────────────────────────────────────────────── */
  var lang = function(){ return (typeof currentLang !== 'undefined' && currentLang) ? currentLang : (document.documentElement.lang || 'ar'); };
  var backdrop = document.createElement('div');
  backdrop.className = 'glc-backdrop';
  backdrop.innerHTML =
      '<div class="glc" role="dialog" aria-modal="true" aria-label="Command palette">'
    +   '<div class="glc-head">' + I('i-search')
    +     '<input class="glc-input" id="glc-input" autocomplete="off" spellcheck="false">'
    +     '<span class="glc-esc">ESC</span>'
    +   '</div>'
    +   '<div class="glc-list" id="glc-list"></div>'
    +   '<div class="glc-hint"><span><b>↑↓</b> تنقّل · navigate</span><span><b>↵</b> فتح · open</span></div>'
    + '</div>';
  function mount(){
    if(document.body && !backdrop.isConnected) document.body.appendChild(backdrop);
    /* Discoverability: inject a search trigger before the Quick-Add button
       in the topnav (present on every page). Zero per-page edits needed. */
    if(!document.querySelector('.glc-trigger')){
      var qa = document.querySelector('.gl-qa-btn');
      if(qa && qa.parentNode){
        var ar = lang() === 'ar';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glc-trigger';
        btn.setAttribute('aria-label', ar ? 'بحث سريع' : 'Quick search');
        btn.innerHTML = I('i-search')
          + '<span class="glc-tr-label">' + (ar ? 'بحث' : 'Search') + '</span>'
          + '<kbd>Ctrl K</kbd>';
        btn.addEventListener('click', openPal);
        qa.parentNode.insertBefore(btn, qa);
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  var input, list, results = [], sel = 0, open = false;

  function norm(s){ return (s || '').toLowerCase().replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي'); }

  function filter(q){
    q = norm(q.trim());
    if(!q) return COMMANDS.slice();
    return COMMANDS.filter(function(cmd){
      return norm(cmd.ar + ' ' + cmd.en + ' ' + cmd.kw).indexOf(q) !== -1;
    });
  }

  function render(){
    var L = lang(), ar = L === 'ar';
    if(!results.length){
      list.innerHTML = '<div class="glc-empty">' + (ar ? 'لا توجد نتائج' : 'No results') + '</div>';
      return;
    }
    var html = '', lastGroup = null;
    results.forEach(function(cmd, i){
      if(cmd.group !== lastGroup){
        lastGroup = cmd.group;
        var g = GROUPS[cmd.group];
        html += '<div class="glc-group">' + (ar ? g.ar : g.en) + '</div>';
      }
      html += '<div class="glc-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '">'
            + I(cmd.icon)
            + '<span>' + (ar ? cmd.ar : cmd.en) + '</span>'
            + '<span class="glc-sub">' + (ar ? cmd.en : cmd.ar) + '</span>'
            + '</div>';
    });
    list.innerHTML = html;
    var selEl = list.querySelector('.glc-item.sel');
    if(selEl) selEl.scrollIntoView({block:'nearest'});
  }

  function exec(cmd){
    if(!cmd) return;
    close();
    if(cmd.action === 'lang'){
      var next = lang() === 'ar' ? 'en' : 'ar';
      if(typeof setLang === 'function') setLang(next);
      return;
    }
    if(cmd.href) window.location.href = cmd.href;
  }

  function openPal(){
    mount();
    input = document.getElementById('glc-input');
    list = document.getElementById('glc-list');
    var ar = lang() === 'ar';
    input.placeholder = ar ? 'ابحث أو اكتب أمراً…' : 'Search or type a command…';
    input.value = '';
    results = filter(''); sel = 0; render();
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    open = true;
    setTimeout(function(){ input.focus(); }, 30);
  }
  function close(){
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    open = false;
  }
  window.glOpenCommandPalette = openPal;

  /* ── Events ───────────────────────────────────────────────────────── */
  document.addEventListener('keydown', function(e){
    if((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      open ? close() : openPal();
      return;
    }
    if(!open) return;
    if(e.key === 'Escape'){ e.preventDefault(); close(); }
    else if(e.key === 'ArrowDown'){ e.preventDefault(); sel = Math.min(sel + 1, results.length - 1); render(); }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
    else if(e.key === 'Enter'){ e.preventDefault(); exec(results[sel]); }
  });
  backdrop.addEventListener('click', function(e){ if(e.target === backdrop) close(); });
  backdrop.addEventListener('input', function(e){
    if(e.target.id !== 'glc-input') return;
    results = filter(e.target.value); sel = 0; render();
  });
  backdrop.addEventListener('click', function(e){
    var item = e.target.closest('.glc-item');
    if(item) exec(results[parseInt(item.dataset.i, 10)]);
  });
})();
