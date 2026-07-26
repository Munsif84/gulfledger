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
  + '.glc-trigger{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border:1px solid rgba(232,200,116,0.55);border-radius:10px;background:rgba(255,255,255,0.12);color:#fff;font-family:var(--font-sans,sans-serif);font-size:13.5px;font-weight:700;cursor:pointer;transition:background .12s,border-color .12s;margin-inline-end:10px;box-shadow:0 1px 4px rgba(0,0,0,0.12);}'
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
      var navRight = document.querySelector('.nav-right');
      var qa = navRight ? navRight.firstElementChild : document.querySelector('.gl-qa-btn');
      if(qa && qa.parentNode){
        var ar = lang() === 'ar';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'glc-trigger';
        btn.setAttribute('aria-label', ar ? 'إجراءات سريعة وبحث' : 'Quick actions & search');
        btn.innerHTML = I('i-search')
          + '<span class="glc-tr-label">' + (ar ? 'إجراءات سريعة' : 'Quick actions') + '</span>'
          + '<span style="opacity:.75;font-size:10px;">▾</span>'
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

  /* ── Profile identity header ─────────────────────────────────────
     Business name + user email at the top of the avatar dropdown
     (GitHub/QuickBooks pattern). Reads page globals currentBiz /
     currentUser; caches name for instant paint. */
  function glFillIdentity(bizName, email){
    var dd = document.querySelector('.profile-dropdown');
    if(!dd) return;
    var id = dd.querySelector('.profile-id');
    if(!id){
      id = document.createElement('div');
      id.className = 'profile-id';
      id.innerHTML = '<div class="profile-id-biz"></div><div class="profile-id-user"></div>';
      var div = document.createElement('div');
      div.className = 'profile-divider';
      dd.insertBefore(div, dd.firstChild);
      dd.insertBefore(id, dd.firstChild);
    }
    if(bizName) id.querySelector('.profile-id-biz').textContent = bizName;
    if(email) id.querySelector('.profile-id-user').textContent = email;
  }
  function glIdentityBoot(){
    try { var n = localStorage.getItem('gl_biz_name'); if(n) glFillIdentity(n, ''); } catch(_e){}
    var tries = 0;
    var t = setInterval(function(){
      tries++;
      var biz = (typeof currentBiz !== 'undefined') ? currentBiz : null;
      var usr = (typeof currentUser !== 'undefined') ? currentUser : null;
      if(biz && biz.name){
        glFillIdentity(biz.name, (usr && usr.email) || '');
        try { localStorage.setItem('gl_biz_name', biz.name); } catch(_e){}
        clearInterval(t);
      } else if(tries > 40){ clearInterval(t); }
    }, 250);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', glIdentityBoot);
  else glIdentityBoot();

  /* ── Listbar progressive filters ──────────────────────────────────
     For every .toolbar:
       1. Each select.filter-select gets an active-state highlight + an
          inline ✕ clear mark whenever it holds a non-default value. Clicking
          ✕ resets that ONE filter to its first option and re-renders.
       2. Search + the FIRST filter stay inline; remaining filters collapse
          into a "Filters" popover with a count badge (space-saving on dense
          toolbars). The ✕ clear marks work inline AND inside the popover.
       3. [data-lb="link"] items become popover footer links. */

  /* Wrap a select so we can overlay a ✕ clear button when it's active.
     "Active" = the select's value is not its first <option> (the default). */
  function glDecorateFilter(sel){
    /* Opt-out for selects that use the filter-select class for styling but are
       INPUTS, not filters (e.g. payroll period pickers, report parameters).
       Tag them with data-glnoclear and they keep their look, no ✕. */
    if(sel.hasAttribute('data-glnoclear')) return;
    if(sel.dataset.glClearWired) return;
    sel.dataset.glClearWired = '1';
    var defaultVal = sel.options.length ? sel.options[0].value : '';
    sel.dataset.glDefault = defaultVal;
    /* Wrap select in a relative container so the ✕ can sit inside it */
    var holder = document.createElement('span');
    holder.className = 'gl-filter-holder';
    sel.parentNode.insertBefore(holder, sel);
    holder.appendChild(sel);
    var clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'gl-filter-clear';
    clr.setAttribute('aria-label', lang()==='ar' ? 'مسح الفلتر' : 'Clear filter');
    clr.innerHTML = '✕';
    holder.appendChild(clr);
    function sync(){
      var active = sel.value !== sel.dataset.glDefault;
      sel.classList.toggle('is-active', active);
      clr.style.display = active ? '' : 'none';
    }
    clr.addEventListener('click', function(e){
      e.stopPropagation();
      sel.value = sel.dataset.glDefault;
      sel.dispatchEvent(new Event('change', {bubbles:true}));
      sync();
    });
    sel.addEventListener('change', sync);
    sync();
  }

  /* Pill groups (.filter-group > .filter-btn[data-filter]): treat the FIRST
     pill (usually data-filter="all") as the default. When a non-default pill is
     active, show a ✕ on the group that returns to the default pill. */
  function glDecoratePills(grp){
    if(grp.dataset.glClearWired) return;
    var pills = Array.prototype.slice.call(grp.querySelectorAll('.filter-btn'));
    if(pills.length < 2) return;
    grp.dataset.glClearWired = '1';
    var def = pills[0];
    var clr = document.createElement('button');
    clr.type = 'button';
    clr.className = 'gl-filter-clear gl-pills-clear';
    clr.setAttribute('aria-label', lang()==='ar' ? 'مسح الفلتر' : 'Clear filter');
    clr.innerHTML = '✕';
    grp.style.position = 'relative';
    grp.appendChild(clr);
    function sync(){
      var active = grp.querySelector('.filter-btn.active');
      var isDefault = !active || active === def;
      grp.classList.toggle('has-active', !isDefault);
      clr.style.display = isDefault ? 'none' : '';
    }
    clr.addEventListener('click', function(e){
      e.stopPropagation();
      def.click();   /* re-run the page's own handler for the default pill */
      setTimeout(sync, 0);
    });
    pills.forEach(function(p){ p.addEventListener('click', function(){ setTimeout(sync, 0); }); });
    sync();
  }


  /* ── Custom date range on period dropdowns ──────────────────────────
     Any select.filter-select[data-gl-period] gains a "Custom range…"
     option. Choosing it reveals inline from→to date pickers; once both
     are set, the range is stored on the select (dataset.glFrom/glTo),
     the option relabels to the compact range, and a change event fires
     so the page's existing render logic runs. Pages read the dataset in
     their '__custom' branch. The standard ✕ (glDecorateFilter) clears
     back to the default option, which also removes the pickers. */
  function glPeriodCustom(sel){
    if(sel.dataset.glRangeWired) return;
    sel.dataset.glRangeWired = '1';
    var ar = lang() === 'ar';
    var baseLabel = ar ? 'نطاق مخصص…' : 'Custom range…';
    var opt = document.createElement('option');
    opt.value = '__custom'; opt.textContent = baseLabel;
    sel.appendChild(opt);
    var wrap = null;
    function cleanup(){
      if(wrap){ wrap.remove(); wrap = null; }
      delete sel.dataset.glFrom; delete sel.dataset.glTo;
      opt.textContent = baseLabel;
    }
    sel.addEventListener('change', function(){
      if(sel.value !== '__custom'){ cleanup(); return; }
      if(wrap) return;                       // re-entry from our own dispatch
      wrap = document.createElement('span');
      wrap.className = 'gl-range-wrap';
      wrap.innerHTML = '<input type="date" class="gl-range-in" lang="en">'
        + '<span class="gl-range-sep">→</span>'
        + '<input type="date" class="gl-range-in" lang="en">';
      var holder = sel.closest('.gl-filter-holder') || sel;
      holder.parentNode.insertBefore(wrap, holder.nextSibling);
      var ins = wrap.querySelectorAll('input');
      function apply(){
        if(!ins[0].value || !ins[1].value) return;
        sel.dataset.glFrom = ins[0].value;
        sel.dataset.glTo = ins[1].value;
        opt.textContent = ins[0].value.slice(2) + ' → ' + ins[1].value.slice(2);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      ins[0].addEventListener('change', apply);
      ins[1].addEventListener('change', apply);
      ins[0].focus();
    });
  }


  /* ── LANGUAGE-AWARE ENTITY NAMES (site convention) ──────────────────────
     THE RULE: whatever the record holds, display follows the SITE language
     with graceful fallback. Arabic site (95% of clients) → Arabic name
     first; English site → English name if one was entered at creation,
     otherwise the Arabic original (never blank, never wrong-language when
     the right one exists).
       glName(entity)    → name_ar/name_en/name family
       glCompany(entity) → company_name(_en) family, falls through to names
     Every list, dropdown, table cell, and report should render entity
     names through these — not raw .name / .name_ar. */
  function glName(e){
    if(!e) return '';
    var ar = lang() === 'ar';
    return (ar ? (e.name_ar || e.name || e.name_en)
               : (e.name_en || e.name || e.name_ar)) || '';
  }
  function glCompany(e){
    if(!e) return '';
    var ar = lang() === 'ar';
    return (ar ? (e.company_name || e.company_name_ar || e.company_name_en)
               : (e.company_name_en || e.company_name || e.company_name_ar))
           || glName(e);
  }
  window.glName = glName;
  window.glCompany = glCompany;


  /* ── STATIC LANGUAGE APPLIER (one convention, applied centrally) ────────
     Language changes reload the page, so a single pass at load is enough.
     Handles the three static surfaces pages have: element text via
     data-ar/data-en, placeholders via data-ph-ar/data-ph-en, titles via
     data-title-ar/data-title-en. <option> elements included. Runs after
     DOM ready on every page that loads gl-command.js — pages need zero
     applier code of their own. */
  function glApplyStaticLang(){
    var L = lang();
    document.querySelectorAll('[data-ar][data-en]').forEach(function(el){
      if(el.children.length > 0 && el.tagName !== 'OPTION') return;
      var t = el.getAttribute('data-' + L);
      if(t != null) el.textContent = t;
    });
    document.querySelectorAll('[data-ph-ar][data-ph-en]').forEach(function(el){
      var t = el.getAttribute(L === 'ar' ? 'data-ph-ar' : 'data-ph-en');
      if(t != null) el.setAttribute('placeholder', t);
    });
    document.querySelectorAll('[data-title-ar][data-title-en]').forEach(function(el){
      var t = el.getAttribute(L === 'ar' ? 'data-title-ar' : 'data-title-en');
      if(t != null) el.setAttribute('title', t);
    });
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', glApplyStaticLang);
  } else { glApplyStaticLang(); }


  /* ── UNIVERSAL LANGUAGE SWITCHER (central fallback) ─────────────────────
     Older/lighter pages carry no switcher and no profile menu. Rather than
     grafting headers per page: if a page has no #btn-ar, inject the flag
     pair into its top bar, and provide setLang if the page lacks one
     (persist + reload — the sitewide convention). Every page, present and
     future, gets a working switcher with zero page edits. */
  function glEnsureLang(){
    if(document.getElementById('btn-ar')) return;
    var host = document.querySelector('.nav-right') || document.querySelector('.topnav') || document.querySelector('header');
    if(!host) return;
    if(typeof window.setLang !== 'function'){
      window.setLang = function(l){
        var prev = localStorage.getItem('gl_lang');
        localStorage.setItem('gl_lang', l);
        if(prev !== l) location.reload();
      };
    }
    var wrap = document.createElement('div');
    wrap.className = 'lang-switch';
    wrap.style.cssText = 'display:inline-flex;gap:4px;align-items:center;margin-inline-start:8px;';
    wrap.innerHTML =
        '<button class="lang-btn" id="btn-ar" title="العربية" aria-label="العربية" style="font-size:17px;line-height:1;padding:4px 8px;background:transparent;border:1px solid rgba(255,255,255,0.3);border-radius:6px;cursor:pointer;">🇸🇦</button>'
      + '<button class="lang-btn" id="btn-en" title="English" aria-label="English" style="font-size:17px;line-height:1;padding:4px 8px;background:transparent;border:1px solid rgba(255,255,255,0.3);border-radius:6px;cursor:pointer;">🇬🇧</button>';
    wrap.querySelector('#btn-ar').addEventListener('click', function(){ window.setLang('ar'); });
    wrap.querySelector('#btn-en').addEventListener('click', function(){ window.setLang('en'); });
    host.appendChild(wrap);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', glEnsureLang);
  } else { glEnsureLang(); }

  function glListbar(){
    var ar = lang() === 'ar';
    /* Scan the standard .toolbar AND report-specific toolbars so the one filter
       design reaches every page (reports uses .db-toolbar / .report-toolbar). */
    document.querySelectorAll('.toolbar, .db-toolbar, .report-toolbar').forEach(function(tb){
      /* Decorate dropdown filters with a clear ✕ (idempotent) */
      Array.prototype.slice.call(tb.querySelectorAll('select.filter-select')).forEach(glDecorateFilter);
      Array.prototype.slice.call(tb.querySelectorAll('select.filter-select[data-gl-period]')).forEach(glPeriodCustom);
      /* Decorate pill groups with a group-level clear ✕ */
      Array.prototype.slice.call(tb.querySelectorAll('.filter-group')).forEach(glDecoratePills);
      if(tb.dataset.lbDone) return;
      var sels = Array.prototype.slice.call(tb.querySelectorAll('select.filter-select'));
      var extras = Array.prototype.slice.call(tb.querySelectorAll('[data-lb="more"]'));
      var links = Array.prototype.slice.call(tb.querySelectorAll('[data-lb="link"]'));
      /* Move the HOLDERS (select + its ✕), not the bare selects */
      var movers = sels.slice(1).map(function(s){ return s.closest('.gl-filter-holder') || s; }).concat(extras);
      if(!movers.length && !links.length) return;
      tb.dataset.lbDone = '1';

      var wrap = document.createElement('div');
      wrap.className = 'lb-wrap';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lb-btn';
      btn.innerHTML = '<svg class="gl-i"><use href="/gl-icons.svg#i-filter"/></svg>'
        + '<span>' + (ar ? 'فلاتر' : 'Filters') + '</span>'
        + '<span class="lb-badge" style="display:none;">0</span>';
      var pop = document.createElement('div');
      pop.className = 'lb-pop';
      pop.innerHTML = '<div class="lb-pop-label">' + (ar ? 'تصفية النتائج' : 'Filter results') + '</div>';
      movers.forEach(function(el){ el.style.display = ''; pop.appendChild(el); });
      if(links.length){
        var foot = document.createElement('div');
        foot.className = 'lb-pop-foot';
        links.forEach(function(a){ foot.appendChild(a); });
        pop.appendChild(foot);
      }
      wrap.appendChild(btn); wrap.appendChild(pop);

      var anchor = sels.length ? (sels[0].closest('.gl-filter-holder') || sels[0]) : tb.querySelector('.search-wrap');
      if(anchor && anchor.parentNode === tb) tb.insertBefore(wrap, anchor.nextSibling);
      else tb.insertBefore(wrap, tb.children[1] || null);

      function badge(){
        var n = 0;
        movers.forEach(function(el){
          var s = el.tagName === 'SELECT' ? el : el.querySelector && el.querySelector('select');
          if(s && s.value && s.value !== (s.dataset.glDefault||'')) n++;
        });
        var b = btn.querySelector('.lb-badge');
        b.textContent = n;
        b.style.display = n ? '' : 'none';
      }
      pop.addEventListener('change', badge);
      badge();
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        pop.classList.toggle('open');
      });
      document.addEventListener('click', function(e){
        if(!wrap.contains(e.target)) pop.classList.remove('open');
      });
    });
  }
  window.glListbar = glListbar;
  function glListbarBoot(){
    glListbar(); setTimeout(glListbar, 800); setTimeout(glListbar, 2500);
    /* Debounced observer: pages render toolbars after auth/data loads, which
       can be later than the fixed retries on slow connections. Watch for new
       nodes and re-run the (idempotent) decorator. */
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var t = null;
      new MutationObserver(function(){
        if (t) clearTimeout(t);
        t = setTimeout(glListbar, 250);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', glListbarBoot);
  else glListbarBoot();
})();


/* ═══════════════════════════════════════════════════════════════════════════
   GL SHELL — the single source of truth for chrome, tables, filters, feedback
   ─────────────────────────────────────────────────────────────────────────
   PRINCIPLE: anything appearing on more than one page is defined HERE, once.
   The shell REPLACES each page's private header/nav at runtime — so all ~24
   pages become consistent through this one file, and a page cannot drift
   because it no longer owns chrome. The Registry declares every page and its
   place in navigation (sub-pages included), so reachability is a declared
   fact, not an accident of pasted links.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  var L = function(){ return (localStorage.getItem('gl_lang') || document.documentElement.lang || 'ar'); };
  var ar = function(){ return L() === 'ar'; };

  /* ── 1. PAGE REGISTRY ──────────────────────────────────────────────────
     group:'main' = top nav tab · parent:'x.html' = sub-page chip shown when
     on that page or its parent · hidden pages exist but never render links. */
  var REG = [
    { href:'dashboard.html',  ar:'الرئيسية',  en:'Dashboard',  group:'main' },
    { href:'purchasing.html', ar:'المشتريات', en:'Purchasing', group:'main' },
    { href:'inventory.html',  ar:'المخزون',   en:'Inventory',  group:'main' },
    { href:'invoices.html',   ar:'المبيعات',  en:'Sales',      group:'main' },
    { href:'finance.html',    ar:'المالية',   en:'Finance',    group:'main' },
    { href:'accounting.html', ar:'المحاسبة',  en:'Accounting', group:'main' },
    { href:'reports.html',    ar:'التقارير',  en:'Reports',    group:'main' },
    { href:'audit.html',          ar:'سجل التدقيق',   en:'Audit Log',    parent:'reports.html' },
    { href:'statements.html',     ar:'كشوف الحساب',   en:'Statements',   parent:'reports.html' },
    { href:'branch-report.html',  ar:'تقرير الفروع',  en:'Branch Report',parent:'reports.html' },
    { href:'locations.html',      ar:'المواقع',       en:'Locations',    parent:'inventory.html' },
    { href:'customer-detail.html',ar:'بطاقة عميل',    en:'Customer',     parent:'invoices.html', hidden:true },
    { href:'vendor-detail.html',  ar:'بطاقة مورد',    en:'Vendor',       parent:'purchasing.html', hidden:true },
    { href:'invoice-view.html',   ar:'عرض فاتورة',    en:'Invoice',      parent:'invoices.html', hidden:true },
    { href:'credit-note-view.html', ar:'إشعار دائن',  en:'Credit Note',  parent:'invoices.html', hidden:true },
    { href:'debit-note-view.html',  ar:'إشعار مدين',  en:'Debit Note',   parent:'invoices.html', hidden:true },
    { href:'settings.html',   ar:'الإعدادات', en:'Settings',   group:'utility' }
  ];
  var here = (location.pathname.split('/').pop() || 'dashboard.html');
  var me = null; REG.forEach(function(p){ if(p.href === here) me = p; });

  /* ── 2. CHROME RENDERER (replaces page-owned header/nav at runtime) ── */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function shellHeaderHTML(){
    var isAr = ar();
    var tabs = REG.filter(function(p){ return p.group === 'main'; }).map(function(p){
      var active = (p.href === here) || (me && me.parent === p.href);
      return '<a href="' + p.href + '" class="gls-tab' + (active ? ' on' : '') + '">' + esc(isAr ? p.ar : p.en) + '</a>';
    }).join('');
    var subs = '';
    var parentHref = me && (me.group === 'main' ? me.href : me.parent);
    if(parentHref){
      var kids = REG.filter(function(p){ return p.parent === parentHref && !p.hidden; });
      if(kids.length){
        subs = '<div class="gls-subs">' + kids.map(function(p){
          return '<a href="' + p.href + '" class="gls-sub' + (p.href === here ? ' on' : '') + '">' + esc(isAr ? p.ar : p.en) + '</a>';
        }).join('') + '</div>';
      }
    }
    return ''
      + '<div class="gls-top">'
      +   '<a href="dashboard.html" class="gls-logo" aria-label="GulfLedger">'
      +     '<span class="gls-bars"><i></i><i></i></span>'
      +     '<span class="gls-name">Gulf<b>Ledger</b></span>'
      +   '</a>'
      +   '<div class="gls-right">'
      +     '<span class="gls-mount-trigger"></span>'
      +     '<div class="gls-prof">'
      +       '<button class="gls-prof-btn" aria-haspopup="true" aria-expanded="false">'
      +         '<svg class="gl-i"><use href="/gl-icons.svg#i-user"/></svg><span class="gls-caret">▾</span>'
      +       '</button>'
      +       '<div class="gls-prof-dd" role="menu">'
      +         '<div class="gls-dd-user"><b id="gls-user-name">—</b><span id="gls-user-mail"></span></div>'
      +         '<a href="settings.html" class="gls-dd-item"><svg class="gl-i"><use href="/gl-icons.svg#i-settings"/></svg><span>' + (isAr?'الإعدادات':'Settings') + '</span></a>'
      +         '<div class="gls-dd-item gls-lang-row"><span>' + (isAr?'اللغة':'Language') + '</span>'
      +           '<span class="gls-flags">'
      +             '<button id="btn-ar" class="' + (isAr ? 'on' : '') + '" title="العربية">🇸🇦</button>'
      +             '<button id="btn-en" class="' + (isAr ? '' : 'on') + '" title="English">🇬🇧</button>'
      +           '</span>'
      +         '</div>'
      +         '<button class="gls-dd-item gls-logout"><svg class="gl-i"><use href="/gl-icons.svg#i-logout"/></svg><span>' + (isAr?'تسجيل الخروج':'Log out') + '</span></button>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="gls-nav">' + tabs + '</div>'
      + subs;
  }
  var SHELL_CSS = ''
    + '.gls-top{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#0B3D24,#0E5232);padding:10px 22px;}'
    + '.gls-logo{display:inline-flex;align-items:center;gap:10px;text-decoration:none;}'
    + '.gls-bars{display:inline-flex;flex-direction:column;gap:3px;}'
    + '.gls-bars i{width:22px;height:5px;border-radius:3px;background:#fff;display:block;}'
    + '.gls-bars i:last-child{background:rgba(255,255,255,0.45);width:15px;}'
    + '.gls-name{font-size:21px;font-weight:800;color:#fff;letter-spacing:-0.01em;}'
    + '.gls-name b{color:#9FD9B8;font-weight:800;}'
    + '.gls-right{display:flex;align-items:center;gap:6px;}'
    + '.gls-prof{position:relative;}'
    + '.gls-prof-btn{display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.25);border-radius:999px;padding:6px 10px;color:#fff;cursor:pointer;}'
    + '.gls-prof-btn .gl-i{width:17px;height:17px;fill:currentColor;}'
    + '.gls-caret{font-size:10px;opacity:.8;}'
    + '.gls-prof-dd{position:absolute;inset-inline-end:0;top:calc(100% + 8px);min-width:210px;background:#fff;border:1px solid #E3E1DA;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.14);padding:6px;display:none;z-index:60;}'
    + '.gls-prof.open .gls-prof-dd{display:block;}'
    + '.gls-dd-item{display:flex;align-items:center;gap:9px;width:100%;padding:9px 11px;border:0;background:none;border-radius:8px;font:inherit;font-size:13.5px;color:#0D2618;text-decoration:none;cursor:pointer;justify-content:flex-start;}'
    + '.gls-dd-item:hover{background:#F2F7F3;}'
    + '.gls-dd-user{display:flex;flex-direction:column;gap:2px;padding:10px 12px 9px;border-bottom:1px solid #EFEDE7;margin-bottom:4px;}'
    + '.gls-dd-user b{font-size:13.5px;color:#0D2618;}'
    + '.gls-dd-user span{font-size:11.5px;color:#5B7263;direction:ltr;text-align:end;}'
    + '.gls-dd-item .gl-i{width:16px;height:16px;fill:#5B7263;}'
    + '.gls-lang-row{justify-content:space-between;cursor:default;}'
    + '.gls-flags{display:inline-flex;gap:4px;}'
    + '.gls-flags button{font-size:17px;line-height:1;padding:3px 7px;border:1px solid #E3E1DA;border-radius:6px;background:#fff;cursor:pointer;}'
    + '.gls-flags button{opacity:.45;}'
    + '.gls-flags button.on{opacity:1;border-color:#0E5232;background:#EAF5EE;box-shadow:0 0 0 1px #0E5232 inset;}'
    + '.gls-flags button:hover{opacity:1;border-color:#0E5232;}'
    + '.gls-nav{display:flex;gap:4px;background:#177349;padding:0 16px;overflow-x:auto;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08);}'
    + '.gls-tab{padding:11px 15px;color:rgba(255,255,255,0.82);text-decoration:none;font-size:14px;font-weight:600;border-bottom:3px solid transparent;white-space:nowrap;}'
    + '.gls-tab:hover{color:#fff;}'
    + '.gls-tab.on{color:#fff;border-bottom-color:#9FD9B8;border-bottom-width:4px;background:rgba(255,255,255,0.13);font-weight:800;border-radius:6px 6px 0 0;}'
    + '.gls-subs{display:flex;gap:8px;background:#F2F7F3;border-bottom:1px solid #E3E1DA;padding:8px 22px;}'
    + '.gls-sub{padding:5px 13px;border:1px solid #D8E5DC;border-radius:999px;background:#fff;color:#0D2618;font-size:12.5px;font-weight:600;text-decoration:none;}'
    + '.gls-sub.on{background:#0E5232;border-color:#0E5232;color:#fff;}'
    + '@media(max-width:600px){.gls-name{font-size:18px;}.gls-top{padding:8px 12px;}.gls-nav{padding:0 8px;}}';

  function mountShell(){
    if(document.getElementById('gl-shell')) return;
    var st = document.createElement('style'); st.textContent = SHELL_CSS; document.head.appendChild(st);
    var shell = document.createElement('div'); shell.id = 'gl-shell';
    shell.innerHTML = shellHeaderHTML();
    /* Replace page-owned chrome: topnav + app-nav (+ sub-tab strips) die here. */
    var olds = document.querySelectorAll('.topnav, .app-nav');
    if(olds.length){
      olds[0].parentNode.insertBefore(shell, olds[0]);
      olds.forEach(function(n){ n.remove(); });
    } else {
      document.body.insertBefore(shell, document.body.firstChild);
    }
    /* Behaviors — owned by the shell, not the page */
    var prof = shell.querySelector('.gls-prof');
    shell.querySelector('.gls-prof-btn').addEventListener('click', function(e){
      e.stopPropagation(); prof.classList.toggle('open');
      this.setAttribute('aria-expanded', prof.classList.contains('open'));
    });
    document.addEventListener('click', function(){ prof.classList.remove('open'); });
    shell.querySelector('#btn-ar').addEventListener('click', function(){ glSetLang('ar'); });
    shell.querySelector('#btn-en').addEventListener('click', function(){ glSetLang('en'); });
    shell.querySelector('.gls-logout').addEventListener('click', function(){
      try{
        var c = (typeof sb !== 'undefined' && sb) || (typeof supabase !== 'undefined' && supabase) || null;
        if(c && c.auth && c.auth.signOut){ c.auth.signOut().then(function(){ location.href='login.html'; }); return; }
      }catch(_e){}
      location.href = 'login.html';
    });
    /* Fill the username row (best-effort — any auth client shape) */
    (function fillUser(tries){
      try{
        var c = (typeof sb !== 'undefined' && sb) || (typeof supabase !== 'undefined' && supabase) || null;
        if(c && c.auth && c.auth.getUser){
          c.auth.getUser().then(function(r){
            var u = r && r.data && r.data.user;
            if(!u) return;
            var nm = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email ? u.email.split('@')[0] : '');
            var n1 = document.getElementById('gls-user-name'), n2 = document.getElementById('gls-user-mail');
            if(n1 && nm) n1.textContent = nm;
            if(n2 && u.email) n2.textContent = u.email;
          });
          return;
        }
      }catch(_e){}
      if(tries > 0) setTimeout(function(){ fillUser(tries - 1); }, 400);
    })(6);
    /* Move the quick-actions trigger (glc) into the shell if it mounts later */
    var mt = shell.querySelector('.gls-mount-trigger');
    var relocate = function(){
      var t = document.querySelector('.glc-trigger');
      if(t && mt && t.parentNode !== mt){ mt.appendChild(t); }
    };
    relocate(); setTimeout(relocate, 300);
  }
  function glSetLang(l){
    var prev = localStorage.getItem('gl_lang');
    localStorage.setItem('gl_lang', l);
    if(prev !== l) location.reload();
  }
  window.glSetLang = glSetLang;
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', mountShell); }
  else { mountShell(); }
})();
