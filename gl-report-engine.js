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
