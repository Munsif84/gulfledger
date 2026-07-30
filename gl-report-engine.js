/* ═══════════════════════════════════════════════════════════════════════════
   GULFLEDGER UNIVERSAL REPORT ENGINE — the stem cell
   Every report = a CONFIG. The engine renders the standard layout:
   [Filter bar] → [KPI cards] → [toolbar: search·columns·group·export] → [grid]
   Grid contract: sortable headers, group-by with subtotals, footer totals,
   column show/hide with localStorage persistence, global search, CSV export,
   row drill hook. One DOM, one CSS, one behavior — configs only declare data.

   CONFIG SHAPE:
   { id, title:{ar,en},
     fetch: async(ctx)=>rows[],            // ctx={from,to,biz,sb,lang}
     columns:[{key,ar,en,type:'text|num|money|pct|date|badge',default:true,
               total?:'sum|avg', render?:(v,row)=>html}],
     filters:['daterange'],                 // v1: daterange (+config-declared selects)
     selects:[{id,ar,en,options:async()=>[{v,l}] ,apply:(row,val)=>bool}],
     kpis:[{ar,en,calc:(rows)=>string}],
     groupBy:[{key,ar,en}],                 // dimensions offered
     drill?: (row)=>void }
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  const LS = (id, k, v) => {
    const key = 'glrpt.' + id + '.' + k;
    if(v === undefined){ try{ return JSON.parse(localStorage.getItem(key)); }catch(_e){ return null; } }
    try{ localStorage.setItem(key, JSON.stringify(v)); }catch(_e){}
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const fmtM = x => (parseFloat(x)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtN = x => (parseFloat(x)||0).toLocaleString('en-US',{maximumFractionDigits:2});

  window.glReportEngine = {
    _cfg: null, _rows: [], _state: null,

    async mount(cfg, hostId, ctx){
      this._cfg = cfg; this._ctx = ctx;
      const ar = ctx.lang === 'ar';
      this._state = {
        cols: LS(cfg.id,'cols') || cfg.columns.filter(c=>c.default!==false).map(c=>c.key),
        sort: LS(cfg.id,'sort') || {key: cfg.columns.find(c=>c.type==='money'||c.type==='num')?.key || cfg.columns[0].key, dir:-1},
        group: LS(cfg.id,'group') || '', q: '', selVals: {}
      };
      const host = document.getElementById(hostId);
      host.innerHTML = `
      <div class="glr-wrap">
        <div class="glr-filters">
          ${cfg.filters?.includes('daterange') ? `
            <div class="glr-f"><label>${ar?'من':'From'}</label><input type="date" id="glr-from" class="mono"></div>
            <div class="glr-f"><label>${ar?'إلى':'To'}</label><input type="date" id="glr-to" class="mono"></div>` : ''}
          ${(cfg.selects||[]).map(s=>`<div class="glr-f"><label>${ar?s.ar:s.en}</label><select id="glr-sel-${s.id}"><option value="">${ar?'الكل':'All'}</option></select></div>`).join('')}
          <button class="glr-run" onclick="glReportEngine.run()">${ar?'عرض':'Run'}</button>
        </div>
        <div class="glr-kpis" id="glr-kpis"></div>
        <div class="glr-toolbar">
          <input type="search" id="glr-q" placeholder="🔍 ${ar?'بحث في كل الأعمدة':'Search all columns'}" oninput="glReportEngine._state.q=this.value;glReportEngine.render()">
          <select id="glr-group" onchange="glReportEngine.setGroup(this.value)">
            <option value="">${ar?'بدون تجميع':'No grouping'}</option>
            ${(cfg.groupBy||[]).map(g=>`<option value="${g.key}">${ar?'تجميع: ':'Group: '}${ar?g.ar:g.en}</option>`).join('')}
          </select>
          <div class="glr-colpick">
            <button class="glr-ghost" onclick="document.getElementById('glr-colmenu').classList.toggle('open')">☰ ${ar?'الأعمدة':'Columns'}</button>
            <div class="glr-colmenu" id="glr-colmenu">
              ${cfg.columns.map(c=>`<label><input type="checkbox" ${this._state.cols.includes(c.key)?'checked':''}
                onchange="glReportEngine.toggleCol('${c.key}',this.checked)"> ${ar?c.ar:c.en}</label>`).join('')}
            </div>
          </div>
          <button class="glr-ghost" onclick="glReportEngine.exportCSV()">⬇ CSV</button>
          <button class="glr-ghost" onclick="window.print()">🖨</button>
        </div>
        <div id="glr-stage"><div class="glr-empty">${ar?'اضغط «عرض»':'Press Run'}</div></div>
      </div>`;
      /* defaults: current month */
      const t = new Date();
      const f = document.getElementById('glr-from'), to = document.getElementById('glr-to');
      if(f){ f.value = new Date(t.getFullYear(), t.getMonth()-2, 1).toISOString().slice(0,10); to.value = t.toISOString().slice(0,10); }
      /* populate selects */
      for(const s of (cfg.selects||[])){
        try{ const opts = await s.options(ctx);
          document.getElementById('glr-sel-'+s.id).innerHTML =
            `<option value="">${ar?'الكل':'All'}</option>` + opts.map(o=>`<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('');
        }catch(e){ console.error('[GLR] select', s.id, e.message||e); }
      }
      const gsel = document.getElementById('glr-group'); if(gsel) gsel.value = this._state.group;
    },

    toggleCol(key, on){
      const s = this._state;
      s.cols = on ? [...s.cols, key] : s.cols.filter(k=>k!==key);
      /* preserve config order */
      s.cols = this._cfg.columns.map(c=>c.key).filter(k=>s.cols.includes(k));
      LS(this._cfg.id,'cols',s.cols); this.render();
    },
    setGroup(g){ this._state.group = g; LS(this._cfg.id,'group',g); this.render(); },
    sortBy(k){ const s=this._state.sort; s.dir = s.key===k ? -s.dir : -1; s.key = k; LS(this._cfg.id,'sort',s); this.render(); },

    async run(){
      const ar = this._ctx.lang === 'ar';
      document.getElementById('glr-stage').innerHTML = `<div class="glr-empty">${ar?'جارٍ التحميل…':'Loading…'}</div>`;
      const ctx = { ...this._ctx,
        from: document.getElementById('glr-from')?.value || null,
        to: document.getElementById('glr-to')?.value || null };
      (this._cfg.selects||[]).forEach(s => { this._state.selVals[s.id] = document.getElementById('glr-sel-'+s.id)?.value || ''; });
      try{ this._rows = await this._cfg.fetch(ctx) || []; }
      catch(e){ console.error('[GLR]', e.message||e);
        document.getElementById('glr-stage').innerHTML = `<div class="glr-error">${(ar?'فشل التحميل: ':'Load failed: ')+esc(e.message||e)}</div>`; return; }
      this.render();
    },

    _visible(){
      let rows = this._rows;
      const q = (this._state.q||'').toLowerCase();
      (this._cfg.selects||[]).forEach(s => {
        const v = this._state.selVals[s.id];
        if(v) rows = rows.filter(r => s.apply(r, v));
      });
      if(q) rows = rows.filter(r => this._cfg.columns.some(c => String(r[c.key]??'').toLowerCase().includes(q)));
      const { key, dir } = this._state.sort;
      const ctype = this._cfg.columns.find(c=>c.key===key)?.type;
      rows = [...rows].sort((a,b) => {
        const av=a[key], bv=b[key];
        if(ctype==='num'||ctype==='money'||ctype==='pct') return dir*(((parseFloat(av)||0))-((parseFloat(bv)||0)));
        return dir * String(av??'').localeCompare(String(bv??''), 'ar');
      });
      return rows;
    },

    _cell(c, r){
      const v = r[c.key];
      if(c.render) return c.render(v, r);
      if(v === null || v === undefined || v === '') return '—';
      if(c.type==='money') return 'SAR ' + fmtM(v);
      if(c.type==='num') return fmtN(v);
      if(c.type==='pct') return (parseFloat(v)||0).toFixed(1) + '٪';
      return esc(v);
    },

    render(){
      const ar = this._ctx.lang === 'ar';
      const cfg = this._cfg, s = this._state;
      const rows = this._visible();
      const cols = cfg.columns.filter(c => s.cols.includes(c.key));
      /* KPIs */
      const kp = document.getElementById('glr-kpis');
      kp.innerHTML = (cfg.kpis||[]).map(k =>
        `<div class="glr-kpi"><div class="l">${ar?k.ar:k.en}</div><div class="v">${k.calc(rows, {fmtM, fmtN})}</div></div>`).join('');
      /* totals */
      const totalRow = cols.map(c => {
        if(c.total==='sum') return {c, v: rows.reduce((a,r)=>a+(parseFloat(r[c.key])||0),0)};
        if(c.total==='avg') return {c, v: rows.length ? rows.reduce((a,r)=>a+(parseFloat(r[c.key])||0),0)/rows.length : 0};
        return {c, v:null};
      });
      const arr = k => s.sort.key===k ? `<span class="glr-arr">${s.sort.dir<0?'▼':'▲'}</span>` : '';
      const head = `<tr>${cols.map(c=>`<th class="${c.type==='money'||c.type==='num'||c.type==='pct'?'num':''}" onclick="glReportEngine.sortBy('${c.key}')">${ar?c.ar:c.en} ${arr(c.key)}</th>`).join('')}</tr>`;
      const rowHtml = r => `<tr ${cfg.drill?`class="glr-drill" onclick='glReportEngine._cfg.drill(${JSON.stringify(JSON.stringify(r._id||''))}.length?${JSON.stringify(r._id||'')}:null, this)'`:''}>
        ${cols.map(c=>`<td class="${c.type==='money'||c.type==='num'||c.type==='pct'?'num':''}">${this._cell(c,r)}</td>`).join('')}</tr>`;
      let body = '';
      if(s.group){
        const gcol = cfg.columns.find(c=>c.key===s.group);
        const groups = {};
        rows.forEach(r => { const k = r[s.group] ?? '—'; (groups[k]=groups[k]||[]).push(r); });
        body = Object.entries(groups).map(([k, list]) => {
          const subs = cols.map(c => c.total==='sum' ? list.reduce((a,r)=>a+(parseFloat(r[c.key])||0),0) : null);
          return `<tr class="glr-grp"><td colspan="${cols.length}">▸ ${ar?(gcol?.ar||''):(gcol?.en||'')}: <b>${esc(k)}</b> · ${list.length}</td></tr>`
            + list.map(rowHtml).join('')
            + `<tr class="glr-sub">${cols.map((c,i)=>`<td class="${c.type==='money'?'num':''}">${subs[i]!==null?('SAR '+fmtM(subs[i])):''}</td>`).join('')}</tr>`;
        }).join('');
      } else body = rows.map(rowHtml).join('');
      document.getElementById('glr-stage').innerHTML = `
        <div class="glr-count">${rows.length} ${ar?'صف':'rows'}</div>
        <div class="glr-scroll"><table class="glr-tbl"><thead>${head}</thead><tbody>
          ${body || `<tr><td colspan="${cols.length}" class="glr-none">${ar?'لا بيانات':'No data'}</td></tr>`}
          <tr class="glr-total">${totalRow.map(t=>`<td class="${t.c.type==='money'||t.c.type==='num'?'num':''}">${t.v===null?'':(t.c.type==='money'?'SAR '+fmtM(t.v):fmtN(t.v))}</td>`).join('')}</tr>
        </tbody></table></div>`;
    },

    exportCSV(){
      const cols = this._cfg.columns.filter(c => this._state.cols.includes(c.key));
      const ar = this._ctx.lang === 'ar';
      const lines = [cols.map(c => '"'+(ar?c.ar:c.en)+'"').join(',')];
      this._visible().forEach(r => lines.push(cols.map(c => '"'+String(r[c.key]??'').replace(/"/g,'""')+'"').join(',')));
      const blob = new Blob(['\ufeff'+lines.join('\n')], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = this._cfg.id + '.csv'; a.click();
    }
  };
})();


/* self-injected skin — pages need only this file */
(function(){
  if(document.getElementById('glr-skin')) return;
  var st = document.createElement('style'); st.id = 'glr-skin';
  st.textContent = `
.glr-filters{background:#fff;border:1px solid var(--border,#E3E1D9);border-radius:12px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-bottom:10px;}
.glr-f{display:flex;flex-direction:column;gap:4px;}
.glr-f label{font-size:10.5px;font-weight:700;color:var(--muted,#7A8B80);}
.glr-f input,.glr-f select{padding:7px 10px;border:1.5px solid var(--border,#E3E1D9);border-radius:8px;font-family:inherit;font-size:13px;background:#fff;}
.glr-run{background:var(--green,#0E5232);color:#fff;border:none;border-radius:8px;padding:9px 24px;font-weight:700;cursor:pointer;font-family:inherit;}
.glr-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px;}
.glr-kpi{background:#fff;border:1px solid var(--border,#E3E1D9);border-radius:12px;padding:10px 14px;}
.glr-kpi .l{font-size:10.5px;font-weight:700;color:var(--muted,#7A8B80);}
.glr-kpi .v{font-size:17px;font-weight:800;unicode-bidi:plaintext;}
.glr-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px;}
.glr-toolbar input[type=search]{flex:1;min-width:180px;padding:8px 12px;border:1.5px solid var(--border,#E3E1D9);border-radius:8px;font-family:inherit;}
.glr-toolbar select{padding:8px 10px;border:1.5px solid var(--border,#E3E1D9);border-radius:8px;font-family:inherit;background:#fff;}
.glr-ghost{background:#fff;border:1.5px solid var(--border,#E3E1D9);border-radius:8px;padding:7px 13px;font-family:inherit;font-size:12.5px;cursor:pointer;}
.glr-colpick{position:relative;}
.glr-colmenu{display:none;position:absolute;inset-inline-end:0;top:110%;z-index:50;background:#fff;border:1px solid var(--border,#E3E1D9);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.14);padding:10px 12px;max-height:300px;overflow:auto;min-width:200px;}
.glr-colmenu.open{display:block;}
.glr-colmenu label{display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0;cursor:pointer;white-space:nowrap;}
.glr-count{font-size:11px;color:var(--muted,#7A8B80);margin:4px 2px;}
.glr-scroll{overflow-x:auto;border:1px solid var(--border,#E3E1D9);border-radius:12px;background:#fff;}
.glr-tbl{width:100%;border-collapse:collapse;font-size:12.5px;min-width:640px;}
.glr-tbl th{background:var(--tint,#F4F8F5);padding:9px 10px;text-align:start;font-size:10.5px;font-weight:800;cursor:pointer;white-space:nowrap;user-select:none;}
.glr-tbl th.num,.glr-tbl td.num{text-align:end;}
.glr-tbl td{padding:8px 10px;border-top:1px solid #F0EFE9;unicode-bidi:plaintext;}
.glr-arr{font-size:9px;color:var(--green,#0E5232);}
.glr-grp td{background:#EDF4EF;font-weight:800;border-top:2px solid #CDE0D4;}
.glr-sub td{background:#F7FAF8;font-weight:700;font-size:11.5px;border-top:1px dashed #CDE0D4;}
.glr-total td{background:var(--navy,#0D2618);color:#fff;font-weight:800;}
.glr-empty,.glr-none{padding:26px;text-align:center;color:var(--muted,#7A8B80);}
.glr-error{padding:18px;color:#991B1B;font-weight:700;}
@media print{.glr-filters,.glr-toolbar{display:none!important;}}`;
  document.head.appendChild(st);
})();


/* ═══ UNIVERSAL REPORT CONFIGS — every report is a config on ONE engine ═══ */
const GLR_CONFIGS = {
  products: {
    id:'products', filters:[], groupBySpec:'category',
    columns:[
      {key:'sku', ar:'رمز الصنف', en:'SKU', type:'text'},
      {key:'name', ar:'اسم الصنف', en:'Product', type:'text'},
      {key:'category', ar:'الفئة', en:'Category', type:'text'},
      {key:'barcode', ar:'الباركود', en:'Barcode', type:'text', default:false},
      {key:'unit', ar:'الوحدة', en:'Unit', type:'text', default:false},
      {key:'cost', ar:'التكلفة', en:'Cost', type:'money'},
      {key:'price', ar:'سعر البيع', en:'Price', type:'money'},
      {key:'margin', ar:'الهامش ٪', en:'Margin %', type:'pct'},
      {key:'qty', ar:'المخزون', en:'On Hand', type:'num', total:'sum'},
      {key:'value', ar:'قيمة المخزون', en:'Stock Value', type:'money', total:'sum'},
      {key:'alert', ar:'حد الطلب', en:'Reorder Lvl', type:'num', default:false},
      {key:'status', ar:'الحالة', en:'Status', type:'text', default:false},
    ],
    kpis:[
      {ar:'عدد الأصناف', en:'SKUs', calc:(r)=>r.length},
      {ar:'قيمة المخزون', en:'Stock Value', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+(x.value||0),0))},
      {ar:'تحت حد الطلب', en:'Below Reorder', calc:(r)=>r.filter(x=>x.alert&&x.qty<=x.alert).length},
    ],
    groupBy:[{key:'category', ar:'الفئة', en:'Category'}],
    fetch: async(ctx)=>{
      const ar = ctx.lang==='ar';
      const {data, error} = await ctx.sb.from('inventory_items')
        .select('sku,barcode,name,name_ar,name_en,unit,cost_price,sale_price,current_qty,alert_level,is_active,category_id')
        .eq('business_id', ctx.biz.id);
      if(error) throw error;
      let cat = {};
      try{ const {data:c} = await ctx.sb.from('categories').select('id,name_ar,name_en').eq('business_id', ctx.biz.id);
        (c||[]).forEach(x=>cat[x.id]= ar?(x.name_ar||x.name_en):(x.name_en||x.name_ar)); }catch(_e){}
      return (data||[]).map(x=>{
        const cost=parseFloat(x.cost_price)||0, price=parseFloat(x.sale_price)||0, qty=parseFloat(x.current_qty)||0;
        return { sku:x.sku, barcode:x.barcode, unit:x.unit,
          name: ar?(x.name_ar||x.name||x.name_en):(x.name_en||x.name||x.name_ar),
          category: cat[x.category_id]|| (ar?'غير مصنّف':'Uncategorized'),
          cost, price, margin: price?(price-cost)/price*100:0, qty, value: qty*cost,
          alert: parseFloat(x.alert_level)||null,
          status: x.is_active===false ? (ar?'موقوف':'Inactive') : (ar?'نشط':'Active') };
      });
    }
  },

  sales_lines: {
    id:'sales_lines', filters:['daterange'],
    columns:[
      {key:'date', ar:'التاريخ', en:'Date', type:'date'},
      {key:'inv', ar:'الفاتورة', en:'Invoice', type:'text'},
      {key:'customer', ar:'العميل', en:'Customer', type:'text'},
      {key:'sku', ar:'الصنف', en:'Product', type:'text'},
      {key:'category', ar:'الفئة', en:'Category', type:'text', default:false},
      {key:'qty', ar:'الكمية', en:'Qty', type:'num', total:'sum'},
      {key:'price', ar:'سعر الوحدة', en:'Unit Price', type:'money', default:false},
      {key:'revenue', ar:'الإيراد', en:'Revenue', type:'money', total:'sum'},
      {key:'cost', ar:'التكلفة', en:'Cost', type:'money', total:'sum', default:false},
      {key:'profit', ar:'الربح', en:'Profit', type:'money', total:'sum'},
      {key:'margin', ar:'الهامش ٪', en:'Margin %', type:'pct'},
      {key:'branch', ar:'الفرع', en:'Branch', type:'text', default:false},
    ],
    kpis:[
      {ar:'الإيراد', en:'Revenue', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+x.revenue,0))},
      {ar:'الربح الإجمالي', en:'Gross Profit', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+x.profit,0))},
      {ar:'الهامش', en:'Margin', calc:(r)=>{const rev=r.reduce((a,x)=>a+x.revenue,0);return rev?((r.reduce((a,x)=>a+x.profit,0)/rev*100).toFixed(1)+'٪'):'—';}},
      {ar:'وحدات مباعة', en:'Units', calc:(r,f)=>f.fmtN(r.reduce((a,x)=>a+x.qty,0))},
      {ar:'متوسط سعر البيع', en:'Avg Price', calc:(r,f)=>{const q=r.reduce((a,x)=>a+x.qty,0);return q?('SAR '+f.fmtM(r.reduce((a,x)=>a+x.revenue,0)/q)):'—';}},
    ],
    groupBy:[{key:'customer',ar:'العميل',en:'Customer'},{key:'sku',ar:'الصنف',en:'Product'},{key:'category',ar:'الفئة',en:'Category'},{key:'branch',ar:'الفرع',en:'Branch'}],
    fetch: async(ctx)=>{
      const ar = ctx.lang==='ar';
      const {data:invs, error} = await ctx.sb.from('invoices')
        .select('id,invoice_number,issue_date,buyer_name,buyer_name_en,branch_id')
        .eq('business_id', ctx.biz.id).neq('status','draft').neq('status','voided')
        .gte('issue_date', ctx.from).lte('issue_date', ctx.to);
      if(error) throw error;
      const {data:items} = await ctx.sb.from('inventory_items').select('id,name_ar,name_en,cost_price,category_id').eq('business_id', ctx.biz.id);
      const im = {}; (items||[]).forEach(x=>im[x.id]=x);
      let cat = {}; try{ const {data:c} = await ctx.sb.from('categories').select('id,name_ar,name_en').eq('business_id', ctx.biz.id);
        (c||[]).forEach(x=>cat[x.id]= ar?(x.name_ar||x.name_en):(x.name_en||x.name_ar)); }catch(_e){}
      let br = {}; try{ const {data:b} = await ctx.sb.from('branches').select('id,name,name_ar').eq('business_id', ctx.biz.id);
        (b||[]).forEach(x=>br[x.id]= ar?(x.name_ar||x.name):(x.name||x.name_ar)); }catch(_e){}
      const ids = (invs||[]).map(v=>v.id);
      let lines = [];
      for(let i=0;i<ids.length;i+=100){
        const {data:ls} = await ctx.sb.from('invoice_items')
          .select('invoice_id,description,description_ar,item_id,quantity,unit_price,discount_pct')
          .in('invoice_id', ids.slice(i,i+100));
        lines = lines.concat(ls||[]);
      }
      const vm = {}; (invs||[]).forEach(v=>vm[v.id]=v);
      return lines.map(l=>{
        const v = vm[l.invoice_id]||{}; const it = im[l.item_id]||{};
        const qty = parseFloat(l.quantity)||0;
        const rev = qty*(parseFloat(l.unit_price)||0)*(1-(parseFloat(l.discount_pct)||0)/100);
        const cost = qty*(parseFloat(it.cost_price)||0);
        const nm = (v.buyer_name==='عميل نقدي'||v.buyer_name==='Cash Customer') ? (ar?'🚶 عميل نقدي':'🚶 Walk-in') : (v.buyer_name||v.buyer_name_en||'—');
        return { date:v.issue_date, inv:v.invoice_number||'—', customer:nm,
          sku: ar?(it.name_ar||l.description_ar||l.description):(it.name_en||l.description||l.description_ar),
          category: cat[it.category_id]||(ar?'غير مصنّف':'Uncategorized'),
          qty, price: parseFloat(l.unit_price)||0, revenue:rev, cost, profit:rev-cost,
          margin: rev?(rev-cost)/rev*100:0, branch: br[v.branch_id]||'—' };
      });
    }
  },

  purchase_lines: {
    id:'purchase_lines', filters:['daterange'],
    columns:[
      {key:'date', ar:'التاريخ', en:'Date', type:'date'},
      {key:'grn', ar:'رقم الاستلام', en:'GRN', type:'text'},
      {key:'supinv', ar:'فاتورة المورد', en:'Supplier Inv', type:'text', default:false},
      {key:'supplier', ar:'المورد', en:'Supplier', type:'text'},
      {key:'sku', ar:'الصنف', en:'Product', type:'text'},
      {key:'qty', ar:'الكمية', en:'Qty', type:'num', total:'sum'},
      {key:'cost', ar:'تكلفة الوحدة', en:'Unit Cost', type:'money'},
      {key:'value', ar:'القيمة', en:'Value', type:'money', total:'sum'},
      {key:'paystat', ar:'السداد', en:'Payment', type:'text', default:false},
    ],
    kpis:[
      {ar:'قيمة المشتريات', en:'Purchase Value', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+x.value,0))},
      {ar:'وحدات مشتراة', en:'Units', calc:(r,f)=>f.fmtN(r.reduce((a,x)=>a+x.qty,0))},
      {ar:'متوسط التكلفة', en:'Avg Cost', calc:(r,f)=>{const q=r.reduce((a,x)=>a+x.qty,0);return q?('SAR '+f.fmtM(r.reduce((a,x)=>a+x.value,0)/q)):'—';}},
    ],
    groupBy:[{key:'supplier',ar:'المورد',en:'Supplier'},{key:'sku',ar:'الصنف',en:'Product'}],
    fetch: async(ctx)=>{
      const ar = ctx.lang==='ar';
      const {data:rcs, error} = await ctx.sb.from('stock_receipts')
        .select('id,receipt_number,receipt_date,supplier_name_snapshot,supplier_invoice_number,payment_status')
        .eq('business_id', ctx.biz.id).gte('receipt_date', ctx.from).lte('receipt_date', ctx.to);
      if(error) throw error;
      const {data:items} = await ctx.sb.from('inventory_items').select('id,name_ar,name_en').eq('business_id', ctx.biz.id);
      const im = {}; (items||[]).forEach(x=>im[x.id]=x);
      const ids = (rcs||[]).map(r=>r.id);
      let lines = [];
      for(let i=0;i<ids.length;i+=100){
        const {data:ls} = await ctx.sb.from('stock_receipt_items').select('receipt_id,item_id,quantity,unit_cost').in('receipt_id', ids.slice(i,i+100));
        lines = lines.concat(ls||[]);
      }
      const rm = {}; (rcs||[]).forEach(r=>rm[r.id]=r);
      return lines.map(l=>{
        const r = rm[l.receipt_id]||{}; const it = im[l.item_id]||{};
        const qty=parseFloat(l.quantity)||0, uc=parseFloat(l.unit_cost)||0;
        return { date:r.receipt_date, grn:r.receipt_number||'—', supinv:r.supplier_invoice_number||'—',
          supplier:r.supplier_name_snapshot||'—',
          sku: ar?(it.name_ar||'—'):(it.name_en||it.name_ar||'—'),
          qty, cost:uc, value:qty*uc, paystat:r.payment_status||'—' };
      });
    }
  },

  customers_master: {
    id:'customers_master', filters:[],
    columns:[
      {key:'name', ar:'العميل', en:'Customer', type:'text'},
      {key:'type', ar:'النوع', en:'Type', type:'text'},
      {key:'city', ar:'المدينة', en:'City', type:'text', default:false},
      {key:'country', ar:'الدولة', en:'Country', type:'text', default:false},
      {key:'phone', ar:'الجوال', en:'Phone', type:'text'},
      {key:'trn', ar:'الرقم الضريبي', en:'TRN', type:'text', default:false},
      {key:'terms', ar:'شروط السداد', en:'Terms', type:'text', default:false},
      {key:'sales', ar:'إجمالي المبيعات', en:'Lifetime Sales', type:'money', total:'sum'},
      {key:'balance', ar:'الرصيد المستحق', en:'Outstanding', type:'money', total:'sum'},
      {key:'lastOrder', ar:'آخر فاتورة', en:'Last Invoice', type:'date'},
      {key:'orders', ar:'عدد الفواتير', en:'Invoices', type:'num', total:'sum'},
    ],
    kpis:[
      {ar:'عدد العملاء', en:'Customers', calc:(r)=>r.length},
      {ar:'إجمالي المستحق', en:'Total Outstanding', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+(x.balance||0),0))},
    ],
    groupBy:[{key:'type',ar:'النوع',en:'Type'},{key:'city',ar:'المدينة',en:'City'}],
    fetch: async(ctx)=>{
      const ar = ctx.lang==='ar';
      const {data:cs, error} = await ctx.sb.from('customers')
        .select('id,name,name_ar,name_en,customer_type,city,country,mobile,phone,trn,payment_terms_days')
        .eq('business_id', ctx.biz.id);
      if(error) throw error;
      const {data:invs} = await ctx.sb.from('invoices')
        .select('customer_id,issue_date,total,amount_paid,status')
        .eq('business_id', ctx.biz.id).neq('status','draft').neq('status','voided');
      const agg = {};
      (invs||[]).forEach(v=>{
        if(!v.customer_id) return;
        const a = agg[v.customer_id] = agg[v.customer_id]||{sales:0,bal:0,n:0,last:''};
        a.sales += parseFloat(v.total)||0;
        a.bal += Math.max(0,(parseFloat(v.total)||0)-(parseFloat(v.amount_paid)||0));
        a.n++; if(String(v.issue_date)>a.last) a.last=v.issue_date;
      });
      return (cs||[]).map(c=>{
        const a = agg[c.id]||{sales:0,bal:0,n:0,last:null};
        return { name: ar?(c.name_ar||c.name||c.name_en):(c.name_en||c.name||c.name_ar),
          type: c.customer_type==='b2b'?(ar?'أعمال B2B':'B2B'):(ar?'أفراد B2C':'B2C'),
          city:c.city, country:c.country, phone:c.mobile||c.phone, trn:c.trn,
          terms:(c.payment_terms_days!=null?c.payment_terms_days+(ar?' يوم':'d'):'—'),
          sales:a.sales, balance:a.bal, lastOrder:a.last, orders:a.n };
      });
    }
  },

  suppliers_master: {
    id:'suppliers_master', filters:[],
    columns:[
      {key:'name', ar:'المورد', en:'Supplier', type:'text'},
      {key:'type', ar:'النوع', en:'Type', type:'text'},
      {key:'phone', ar:'الجوال', en:'Phone', type:'text', default:false},
      {key:'email', ar:'البريد', en:'Email', type:'text', default:false},
      {key:'purchases', ar:'إجمالي المشتريات', en:'Total Purchases', type:'money', total:'sum'},
      {key:'balance', ar:'الرصيد المستحق', en:'Outstanding', type:'money', total:'sum'},
      {key:'lastGRN', ar:'آخر استلام', en:'Last Receipt', type:'date'},
      {key:'grns', ar:'عدد الاستلامات', en:'Receipts', type:'num', total:'sum'},
    ],
    kpis:[
      {ar:'عدد الموردين', en:'Suppliers', calc:(r)=>r.length},
      {ar:'إجمالي المستحق لهم', en:'Total Payable', calc:(r,f)=>'SAR '+f.fmtM(r.reduce((a,x)=>a+(x.balance||0),0))},
    ],
    groupBy:[{key:'type',ar:'النوع',en:'Type'}],
    fetch: async(ctx)=>{
      const ar = ctx.lang==='ar';
      const {data:ss, error} = await ctx.sb.from('suppliers')
        .select('id,name,name_ar,name_en,usage_type,mobile,phone,email').eq('business_id', ctx.biz.id);
      if(error) throw error;
      const {data:rcs} = await ctx.sb.from('stock_receipts')
        .select('supplier_id,receipt_date,subtotal,vat_amount,amount_paid').eq('business_id', ctx.biz.id);
      const agg = {};
      (rcs||[]).forEach(r=>{
        if(!r.supplier_id) return;
        const t = (parseFloat(r.subtotal)||0)+(parseFloat(r.vat_amount)||0);
        const a = agg[r.supplier_id]=agg[r.supplier_id]||{p:0,b:0,n:0,last:''};
        a.p+=t; a.b+=Math.max(0,t-(parseFloat(r.amount_paid)||0)); a.n++;
        if(String(r.receipt_date)>a.last)a.last=r.receipt_date;
      });
      return (ss||[]).map(s=>{
        const a = agg[s.id]||{p:0,b:0,n:0,last:null};
        return { name: ar?(s.name_ar||s.name||s.name_en):(s.name_en||s.name||s.name_ar),
          type: s.usage_type==='purchase'?(ar?'بضائع':'Goods'):s.usage_type==='both'?(ar?'بضائع وخدمات':'Both'):(ar?'خدمات':'Services'),
          phone:s.mobile||s.phone, email:s.email,
          purchases:a.p, balance:a.b, lastGRN:a.last, grns:a.n };
      });
    }
  },
};
window.GLR_CONFIGS = GLR_CONFIGS;
function __glUReport_unused(key, btn){
  
  
}
