// ============================================================
// AUNT CAROL'S SAUCE — APP LOGIC  v2
// Storage: Google Sheets (primary) + localStorage (offline cache)
// ============================================================

// ── State ───────────────────────────────────────────────────
let stores      = {};   // merged BASE_STORES + sheet/localStorage additions
let deliveries  = [];   // from Sheet (or localStorage fallback)
let currentEditId = null;

let invFilter   = 'all';
let delFilter   = 'all';
let salesFilter = 'all';

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  loadStoresLocal();
  loadDeliveriesLocal();   // show cached data instantly
  renderAll();

  if (SHEET_CONFIGURED) {
    setSyncStatus('busy', 'Connecting…');
    await refreshFromSheet();
  } else {
    setSyncStatus('err', 'Sheet not configured');
    showConfigBanner();
  }

  // Set default date in run modal
  const rd = document.getElementById('run-date');
  if (rd) rd.value = today();
}

// ── Config banner ─────────────────────────────────────────────
function showConfigBanner() {
  const banner = document.getElementById('config-banner');
  if (banner) banner.style.display = 'block';
}

// ── Pull fresh data from Sheet ────────────────────────────────
async function refreshFromSheet() {
  const [sheetDels, sheetSales, sheetStores] = await Promise.all([
    sheetGetDeliveries(),
    sheetGetSales(),
    (async () => { try {
      const r = await fetch(SHEET_URL + '?action=getStores');
      const j = await r.json(); return j.data || [];
    } catch(e) { return []; }})()
  ]);

  if (sheetDels !== null) {
    deliveries = sheetDels.map(normalizeDelivery);
    localStorage.setItem('ac_deliveries', JSON.stringify(deliveries));
  }
  if (sheetSales !== null) {
    localStorage.setItem('ac_sales', JSON.stringify(sheetSales));
  }
  if (sheetStores && sheetStores.length) {
    sheetStores.forEach(s => {
      stores[s.storeId] = {
        addr: s.addr, city: s.city, zip: s.zip,
        S_may: Number(s.S_may)||0, M_may: Number(s.M_may)||0,
        S_jun: Number(s.S_jun)||0, M_jun: Number(s.M_jun)||0,
      };
    });
    const overrides = {};
    Object.keys(stores).forEach(id => {
      if (!BASE_STORES[id]) overrides[id] = stores[id];
    });
    localStorage.setItem('ac_stores', JSON.stringify(overrides));
  }
  renderAll();
}

function normalizeDelivery(d) {
  return {
    id: String(d.id), storeId: Number(d.storeId),
    addr: d.addr||'', city: d.city||'', zip: d.zip||'',
    spicy: Number(d.spicy)||0, mild: Number(d.mild)||0,
    driver: d.driver||'', date: d.date||today(),
    status: d.status||'pending', notes: d.notes||'',
    createdAt: d.createdAt||new Date().toISOString(),
    updatedAt: d.updatedAt||new Date().toISOString(),
  };
}

// ── Local storage helpers ─────────────────────────────────────
function loadStoresLocal() {
  const saved = JSON.parse(localStorage.getItem('ac_stores') || '{}');
  stores = { ...BASE_STORES };
  Object.keys(saved).forEach(id => { stores[id] = saved[id]; });
}
function loadDeliveriesLocal() {
  deliveries = JSON.parse(localStorage.getItem('ac_deliveries') || '[]');
}
function saveDeliveriesLocal() {
  localStorage.setItem('ac_deliveries', JSON.stringify(deliveries));
}

// ── Utilities ─────────────────────────────────────────────────
function clamp(v)    { return Math.max(Number(v) || 0, 0); }
function today()     { return new Date().toISOString().split('T')[0]; }
function fmtDate(s)  { if (!s) return '—'; return new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtCur(n)   { return '$' + (n||0).toFixed(2); }
function isThisWeek(s)  { return new Date(s) >= new Date(Date.now()-7*86400000); }
function isThisMonth(s) { const d=new Date(s),n=new Date(); return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear(); }

function stockStatus(s, m) {
  s = clamp(s); m = clamp(m);
  if (s === 0 && m === 0) return 'urgent';
  if (s <= 3 || m <= 3)   return 'low';
  return 'ok';
}

function bigDrop(id) {
  const d = stores[id]; if (!d) return false;
  return (clamp(d.S_may)-clamp(d.S_jun) >= 5) || (clamp(d.M_may)-clamp(d.M_jun) >= 5);
}

function mapsUrl(id) {
  const d = stores[id];
  return `https://www.google.com/maps/search/${encodeURIComponent(d.addr+', '+d.city+', VA '+d.zip)}`;
}

// ── Tab switching ──────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-'+name).classList.add('active');
  el.classList.add('active');
}

function renderAll() {
  renderInventory();
  renderDeliveries();
  renderSales();
}

// ══════════════════════════════════════════════════════════════
// INVENTORY TAB
// ══════════════════════════════════════════════════════════════
function setInvFilter(f, el) {
  invFilter = f;
  document.querySelectorAll('#tab-inventory .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderInventory();
}

function renderInventory() {
  const ids = Object.keys(stores).map(Number).sort((a,b)=>a-b);
  const search  = (document.getElementById('search-input')?.value || '').toLowerCase();
  const sortBy  = document.getElementById('inv-sort')?.value || 'status';
  const statusOrder = { urgent:0, low:1, ok:2 };

  // Stats
  let urgent=0, low=0, ok=0, totalS=0, totalM=0;
  ids.forEach(id => {
    const s = clamp(stores[id].S_jun), m = clamp(stores[id].M_jun);
    totalS += s; totalM += m;
    const st = stockStatus(s, m);
    if (st==='urgent') urgent++; else if (st==='low') low++; else ok++;
  });
  document.getElementById('inv-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Total stores</div><div class="stat-val blue">${ids.length}</div></div>
    <div class="stat"><div class="stat-label">🔴 Both SKUs out</div><div class="stat-val red">${urgent}</div></div>
    <div class="stat"><div class="stat-label">🟡 Needs restock</div><div class="stat-val amber">${low}</div></div>
    <div class="stat"><div class="stat-label">✅ Well stocked</div><div class="stat-val green">${ok}</div></div>
    <div class="stat"><div class="stat-label">🌶️ Spicy on shelf</div><div class="stat-val">${totalS}</div></div>
    <div class="stat"><div class="stat-label">🧡 Mild on shelf</div><div class="stat-val">${totalM}</div></div>
  `;

  // Filter
  let filtered = ids.filter(id => {
    const d = stores[id];
    const s = clamp(d.S_jun), m = clamp(d.M_jun);
    const st = stockStatus(s, m);
    if (invFilter==='urgent'  && st!=='urgent') return false;
    if (invFilter==='low'     && st!=='low')    return false;
    if (invFilter==='dropped' && !bigDrop(id))  return false;
    if (search) {
      const hay = `${id} ${d.city} ${d.addr}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sortBy==='store') return a-b;
    if (sortBy==='city')  return stores[a].city.localeCompare(stores[b].city);
    if (sortBy==='spc')   return clamp(stores[a].S_jun)-clamp(stores[b].S_jun);
    if (sortBy==='mld')   return clamp(stores[a].M_jun)-clamp(stores[b].M_jun);
    const sa=stockStatus(clamp(stores[a].S_jun),clamp(stores[a].M_jun));
    const sb=stockStatus(clamp(stores[b].S_jun),clamp(stores[b].M_jun));
    if (sa!==sb) return statusOrder[sa]-statusOrder[sb];
    return a-b;
  });

  document.getElementById('inv-count').textContent =
    `Showing ${filtered.length} of ${ids.length} stores`;

  const tbody = document.getElementById('inv-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No stores match this filter</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(id => {
    const d   = stores[id];
    const js  = clamp(d.S_jun), jm = clamp(d.M_jun);
    const ms  = clamp(d.S_may), mm = clamp(d.M_may);
    const st  = stockStatus(js, jm);
    const dS  = js-ms, dM = jm-mm;

    const badge = st==='urgent'
      ? `<span class="badge badge-urgent">Both out</span>`
      : st==='low'
      ? `<span class="badge badge-low">Low stock</span>`
      : `<span class="badge badge-ok">OK</span>`;

    function skuEl(v) {
      const c = v===0 ? 'sku-zero' : v<=3 ? 'sku-low' : 'sku-ok';
      return `<span class="sku ${c}">${v}</span>`;
    }
    function dEl(v) {
      return v>0 ? `<span class="delta delta-up">+${v}</span>`
           : v<0 ? `<span class="delta delta-dn">${v}</span>`
           : `<span class="delta delta-nc">—</span>`;
    }

    return `<tr>
      <td><strong>#${id}</strong></td>
      <td class="addr-cell">${d.addr}</td>
      <td>${d.city}, VA ${d.zip}</td>
      <td>${badge}</td>
      <td>${skuEl(js)}</td>
      <td>${skuEl(jm)}</td>
      <td>${dEl(dS)} / ${dEl(dM)}</td>
      <td class="action-cell">
        <a class="map-link" href="${mapsUrl(id)}" target="_blank">📍</a>
        <button class="btn-xs btn-queue" onclick="queueDelivery(${id})">+ Queue</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Queue single store from inventory ─────────────────────────
async function queueDelivery(storeId) {
  const d = stores[storeId]; if (!d) return;
  const rec = {
    id: String(Date.now()),
    storeId, addr:d.addr, city:d.city, zip:d.zip,
    spicy:1, mild:1, driver:'', date:today(),
    status:'pending', notes:'',
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  };
  deliveries.unshift(rec);
  saveDeliveriesLocal();
  await sheetAddDelivery(rec);
  renderDeliveries();
  switchTab('deliveries', document.querySelector('[data-tab="deliveries"]'));
}

// ══════════════════════════════════════════════════════════════
// DELIVERIES TAB
// ══════════════════════════════════════════════════════════════
function setDelFilter(f, el) {
  delFilter = f;
  document.querySelectorAll('#tab-deliveries .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderDeliveries();
}

function renderDeliveries() {
  const dateF = document.getElementById('del-date-filter')?.value || 'all';

  const total     = deliveries.length;
  const pending   = deliveries.filter(d=>d.status==='pending').length;
  const out       = deliveries.filter(d=>d.status==='out').length;
  const delivered = deliveries.filter(d=>d.status==='delivered').length;
  const failed    = deliveries.filter(d=>d.status==='failed').length;
  const revenue   = deliveries
    .filter(d=>d.status==='delivered')
    .reduce((s,d)=>s+((clamp(d.spicy)+clamp(d.mild))*PRICING.casePrice), 0);

  document.getElementById('del-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Total</div><div class="stat-val blue">${total}</div></div>
    <div class="stat"><div class="stat-label">⏳ Pending</div><div class="stat-val amber">${pending}</div></div>
    <div class="stat"><div class="stat-label">🚚 Out</div><div class="stat-val" style="color:var(--blue)">${out}</div></div>
    <div class="stat"><div class="stat-label">✅ Delivered</div><div class="stat-val green">${delivered}</div></div>
    <div class="stat"><div class="stat-label">❌ Failed</div><div class="stat-val red">${failed}</div></div>
    <div class="stat"><div class="stat-label">Revenue</div><div class="stat-val green">${fmtCur(revenue)}</div></div>
  `;

  let filtered = deliveries.filter(d => {
    if (delFilter!=='all' && d.status!==delFilter) return false;
    if (dateF==='today' && d.date!==today()) return false;
    if (dateF==='week'  && !isThisWeek(d.date))  return false;
    if (dateF==='month' && !isThisMonth(d.date)) return false;
    return true;
  });

  document.getElementById('del-count').textContent =
    `Showing ${filtered.length} of ${total} records`;

  const statusLabel = {
    pending:   '<span class="badge badge-pending">⏳ Pending</span>',
    out:       '<span class="badge badge-out">🚚 Out for delivery</span>',
    delivered: '<span class="badge badge-ok">✅ Delivered</span>',
    failed:    '<span class="badge badge-urgent">❌ Failed</span>',
  };

  const tbody = document.getElementById('del-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No deliveries yet. Queue stores from Inventory or create a run.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(d => {
    const cases = clamp(d.spicy)+clamp(d.mild);
    const rev   = cases * PRICING.casePrice;
    return `<tr>
      <td><strong>#${d.storeId}</strong></td>
      <td class="addr-cell">${d.addr}<br><small style="color:var(--ink3)">${d.city}, VA ${d.zip}</small></td>
      <td><span class="sku sku-ok">${clamp(d.spicy)}</span></td>
      <td><span class="sku sku-ok">${clamp(d.mild)}</span></td>
      <td>${cases}</td>
      <td>${d.status==='delivered' ? fmtCur(rev) : '—'}</td>
      <td>${d.driver || '<span style="color:var(--ink4)">Unassigned</span>'}</td>
      <td>${fmtDate(d.date)}</td>
      <td>${statusLabel[d.status] || d.status}</td>
      <td class="action-cell">
        <button class="btn-xs btn-update" onclick="openStatusModal('${d.id}')">Update</button>
        <button class="btn-xs btn-del" onclick="deleteDelivery('${d.id}')">×</button>
      </td>
    </tr>`;
  }).join('');
}

// ── Status update modal ───────────────────────────────────────
function openStatusModal(delivId) {
  const d = deliveries.find(x => String(x.id)===String(delivId));
  if (!d) return;
  currentEditId = delivId;
  document.getElementById('status-modal-title').textContent =
    `Update — Store #${d.storeId} | ${d.addr}`;
  document.getElementById('driver-input').value   = d.driver || '';
  document.getElementById('notes-input').value    = d.notes  || '';
  document.getElementById('spicy-delivered').value = clamp(d.spicy) || 1;
  document.getElementById('mild-delivered').value  = clamp(d.mild)  || 1;
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status===d.status);
  });
  document.getElementById('status-modal').classList.add('open');
}

function selectStatus(el) {
  document.querySelectorAll('.status-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}

async function saveStatus() {
  const d = deliveries.find(x => String(x.id)===String(currentEditId));
  if (!d) return;
  const newStatus = document.querySelector('.status-btn.active')?.dataset.status || d.status;
  d.status    = newStatus;
  d.driver    = document.getElementById('driver-input').value.trim();
  d.notes     = document.getElementById('notes-input').value.trim();
  d.spicy     = parseInt(document.getElementById('spicy-delivered').value) || 0;
  d.mild      = parseInt(document.getElementById('mild-delivered').value)  || 0;
  d.updatedAt = new Date().toISOString();

  saveDeliveriesLocal();
  await sheetUpdateDelivery(d);

  if (newStatus==='delivered') {
    const sale = buildSaleRecord(d);
    const sales = JSON.parse(localStorage.getItem('ac_sales')||'[]');
    const idx   = sales.findIndex(s=>String(s.deliveryId)===String(d.id));
    if (idx>=0) sales[idx]=sale; else sales.unshift(sale);
    localStorage.setItem('ac_sales', JSON.stringify(sales));
    await sheetAddSale(sale);
  }

  renderDeliveries();
  renderSales();
  closeModal('status-modal');
}

async function deleteDelivery(delivId) {
  if (!confirm('Remove this delivery record?')) return;
  deliveries = deliveries.filter(x => String(x.id)!==String(delivId));
  saveDeliveriesLocal();
  await sheetDeleteDelivery(delivId);
  renderDeliveries();
}

// ── New delivery run ──────────────────────────────────────────
function createDeliveryRun() {
  const ids = Object.keys(stores).map(Number);
  const statusOrder = {urgent:0,low:1,ok:2};
  const sorted = [...ids].sort((a,b)=>{
    const sa=stockStatus(clamp(stores[a].S_jun),clamp(stores[a].M_jun));
    const sb=stockStatus(clamp(stores[b].S_jun),clamp(stores[b].M_jun));
    return statusOrder[sa]-statusOrder[sb];
  });

  document.getElementById('run-store-list').innerHTML = sorted.map(id=>{
    const d  = stores[id];
    const s  = clamp(d.S_jun), m = clamp(d.M_jun);
    const st = stockStatus(s, m);
    const pre= st==='urgent'||st==='low';
    const em = st==='urgent'?'🔴':st==='low'?'🟡':'✅';
    return `<label class="store-check-item">
      <input type="checkbox" value="${id}" ${pre?'checked':''}>
      <span>${em} #${id} — ${d.addr}, ${d.city}</span>
      <small>Spicy:${s} Mild:${m}</small>
    </label>`;
  }).join('');

  document.getElementById('run-driver').value = '';
  document.getElementById('run-date').value   = today();
  document.getElementById('run-modal').classList.add('open');
}

async function saveRun() {
  const driver  = document.getElementById('run-driver').value.trim();
  const date    = document.getElementById('run-date').value || today();
  const checked = [...document.querySelectorAll('#run-store-list input:checked')];
  if (!checked.length) { alert('Select at least one store.'); return; }

  const newRecs = checked.map(cb => {
    const id = Number(cb.value);
    const d  = stores[id] || {};
    return {
      id: String(Date.now()+Math.random()),
      storeId:id, addr:d.addr||'', city:d.city||'', zip:d.zip||'',
      spicy:1, mild:1, driver, date,
      status:'pending', notes:'',
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    };
  });

  deliveries.unshift(...newRecs);
  saveDeliveriesLocal();
  await Promise.all(newRecs.map(r=>sheetAddDelivery(r)));
  renderDeliveries();
  closeModal('run-modal');
  switchTab('deliveries', document.querySelector('[data-tab="deliveries"]'));
}

// ══════════════════════════════════════════════════════════════
// SALES HISTORY TAB
// ══════════════════════════════════════════════════════════════
function buildSaleRecord(d) {
  const cases = clamp(d.spicy)+clamp(d.mild);
  return {
    deliveryId: d.id, storeId: d.storeId,
    addr: d.addr, city: d.city||stores[d.storeId]?.city||'',
    zip:  d.zip,  driver: d.driver, date: d.date,
    spicyCases: clamp(d.spicy), mildCases: clamp(d.mild),
    totalCases: cases,
    spicyUnits: clamp(d.spicy)*PRICING.unitsPerCase,
    mildUnits:  clamp(d.mild)*PRICING.unitsPerCase,
    revenue:    cases*PRICING.casePrice,
    cogs:       cases*PRICING.unitsPerCase*PRICING.unitCost,
    deliveryFee: PRICING.deliveryFeePerVisit,
    grossProfit: (cases*PRICING.casePrice)-(cases*PRICING.unitsPerCase*PRICING.unitCost)-PRICING.deliveryFeePerVisit,
    recordedAt: new Date().toISOString(),
  };
}

function setSalesFilter(f, el) {
  salesFilter = f;
  document.querySelectorAll('#tab-sales .pill').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  renderSales();
}

function renderSales() {
  const all   = JSON.parse(localStorage.getItem('ac_sales')||'[]');
  const groupBy = document.getElementById('sales-group')?.value || 'store';

  const filtered = all.filter(s=>{
    if (salesFilter==='week')  return isThisWeek(s.date);
    if (salesFilter==='month') return isThisMonth(s.date);
    return true;
  });

  const totalRev   = filtered.reduce((s,r)=>s+r.revenue,0);
  const totalCases = filtered.reduce((s,r)=>s+r.totalCases,0);
  const totalGP    = filtered.reduce((s,r)=>s+r.grossProfit,0);
  const totalSpc   = filtered.reduce((s,r)=>s+r.spicyCases,0);
  const totalMld   = filtered.reduce((s,r)=>s+r.mildCases,0);
  const storesServed = new Set(filtered.map(s=>s.storeId)).size;

  document.getElementById('sales-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Deliveries</div><div class="stat-val blue">${filtered.length}</div></div>
    <div class="stat"><div class="stat-label">Stores served</div><div class="stat-val">${storesServed}</div></div>
    <div class="stat"><div class="stat-label">Cases sold</div><div class="stat-val">${totalCases}</div></div>
    <div class="stat"><div class="stat-label">🌶️ Spicy</div><div class="stat-val">${totalSpc}</div></div>
    <div class="stat"><div class="stat-label">🧡 Mild</div><div class="stat-val">${totalMld}</div></div>
    <div class="stat"><div class="stat-label">Revenue</div><div class="stat-val green">${fmtCur(totalRev)}</div></div>
    <div class="stat"><div class="stat-label">Gross profit</div><div class="stat-val green">${fmtCur(totalGP)}</div></div>
  `;

  const thead = document.getElementById('sales-thead-row');
  const tbody = document.getElementById('sales-body');

  if (!filtered.length) {
    thead.innerHTML = `<th>No sales yet</th>`;
    tbody.innerHTML = `<tr><td class="empty-row">Mark deliveries as Delivered to log sales automatically.</td></tr>`;
    return;
  }

  function agg(key) {
    const map = {};
    filtered.forEach(s=>{
      const k=s[key]||'Unknown';
      if (!map[k]) map[k]={key:k,visits:0,spicy:0,mild:0,revenue:0,gp:0};
      map[k].visits++; map[k].spicy+=s.spicyCases; map[k].mild+=s.mildCases;
      map[k].revenue+=s.revenue; map[k].gp+=s.grossProfit;
    });
    return Object.values(map).sort((a,b)=>b.revenue-a.revenue);
  }

  if (groupBy==='store') {
    const rows = agg('storeId');
    thead.innerHTML = `<th>Store</th><th>Address</th><th>Visits</th><th>🌶️ Spicy</th><th>🧡 Mild</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r=>{
      const st=stores[r.key]||{};
      return `<tr>
        <td><strong>#${r.key}</strong></td>
        <td class="addr-cell">${st.addr||'—'}, ${st.city||''}</td>
        <td>${r.visits}</td><td>${r.spicy}</td><td>${r.mild}</td>
        <td class="num-cell">${fmtCur(r.revenue)}</td>
        <td class="num-cell green-text">${fmtCur(r.gp)}</td>
      </tr>`;
    }).join('');
  } else if (groupBy==='city') {
    const rows = agg('city');
    thead.innerHTML = `<th>City</th><th>Visits</th><th>🌶️ Spicy</th><th>🧡 Mild</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r=>`<tr>
      <td><strong>${r.key}</strong></td><td>${r.visits}</td>
      <td>${r.spicy}</td><td>${r.mild}</td>
      <td class="num-cell">${fmtCur(r.revenue)}</td>
      <td class="num-cell green-text">${fmtCur(r.gp)}</td>
    </tr>`).join('');
  } else if (groupBy==='date') {
    const rows = agg('date').sort((a,b)=>b.key.localeCompare(a.key));
    thead.innerHTML = `<th>Date</th><th>Deliveries</th><th>🌶️ Spicy</th><th>🧡 Mild</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r=>`<tr>
      <td>${fmtDate(r.key)}</td><td>${r.visits}</td>
      <td>${r.spicy}</td><td>${r.mild}</td>
      <td class="num-cell">${fmtCur(r.revenue)}</td>
      <td class="num-cell green-text">${fmtCur(r.gp)}</td>
    </tr>`).join('');
  } else {
    const spicyRev=totalSpc*PRICING.casePrice, mildRev=totalMld*PRICING.casePrice;
    thead.innerHTML = `<th>SKU</th><th>Cases sold</th><th>Units sold</th><th>Revenue</th>`;
    tbody.innerHTML = `
      <tr><td>🌶️ Spicy</td><td>${totalSpc}</td><td>${totalSpc*PRICING.unitsPerCase}</td><td class="num-cell">${fmtCur(spicyRev)}</td></tr>
      <tr><td>🧡 Mild</td><td>${totalMld}</td><td>${totalMld*PRICING.unitsPerCase}</td><td class="num-cell">${fmtCur(mildRev)}</td></tr>
      <tr style="font-weight:600;border-top:2px solid var(--border)">
        <td>Total</td><td>${totalSpc+totalMld}</td><td>${(totalSpc+totalMld)*PRICING.unitsPerCase}</td>
        <td class="num-cell">${fmtCur(spicyRev+mildRev)}</td>
      </tr>`;
  }
}

// ══════════════════════════════════════════════════════════════
// ADD STORE
// ══════════════════════════════════════════════════════════════
function openAddStoreModal() { document.getElementById('addstore-modal').classList.add('open'); }

async function saveNewStore() {
  const num  = document.getElementById('ns-num').value.trim();
  const addr = document.getElementById('ns-addr').value.trim();
  const city = document.getElementById('ns-city').value.trim();
  const zip  = document.getElementById('ns-zip').value.trim();
  const spc  = parseInt(document.getElementById('ns-spc').value)||0;
  const mld  = parseInt(document.getElementById('ns-mld').value)||0;
  if (!num||!addr||!city) { alert('Store #, address, and city are required.'); return; }
  if (stores[num] && !confirm(`Store #${num} already exists. Overwrite?`)) return;

  const rec = { addr, city, zip, S_may:0, M_may:0, S_jun:spc, M_jun:mld };
  stores[num] = rec;

  const saved = JSON.parse(localStorage.getItem('ac_stores')||'{}');
  saved[num] = rec;
  localStorage.setItem('ac_stores', JSON.stringify(saved));

  await sheetAddStore({ storeId:num, ...rec, addedAt:new Date().toISOString() });
  renderInventory();
  closeModal('addstore-modal');
}

// ══════════════════════════════════════════════════════════════
// EXPORT DISPATCH
// ══════════════════════════════════════════════════════════════
function exportDispatch() {
  const ids    = Object.keys(stores).map(Number);
  const urgent = ids.filter(id=>stockStatus(clamp(stores[id].S_jun),clamp(stores[id].M_jun))==='urgent');
  const low    = ids.filter(id=>stockStatus(clamp(stores[id].S_jun),clamp(stores[id].M_jun))==='low');
  let txt = `AUNT CAROL'S SAUCE — RESTOCK DISPATCH\n`;
  txt += `Vendor: TTP Foods LLC | #${PRICING.vendorNum}\n`;
  txt += `Generated: ${new Date().toLocaleString()}\n`;
  txt += `Case price: ${fmtCur(PRICING.casePrice)} | Invoice photos → ${PRICING.invoicePhone}\n`;
  txt += `${'='.repeat(52)}\n\n`;
  txt += `🔴 URGENT — BOTH SKUs AT ZERO (${urgent.length} stores)\n${'—'.repeat(40)}\n`;
  urgent.forEach(id=>{const d=stores[id];txt+=`#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n`;});
  txt += `\n🟡 LOW STOCK — ONE SKU ≤3 (${low.length} stores)\n${'—'.repeat(40)}\n`;
  low.forEach(id=>{const d=stores[id];txt+=`#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n  Spicy:${clamp(d.S_jun)} Mild:${clamp(d.M_jun)}\n`;});
  txt += `\nTotal needing delivery: ${urgent.length+low.length}`;
  document.getElementById('dispatch-text').textContent = txt;
  document.getElementById('dispatch-modal').classList.add('open');
}

function copyDispatch() {
  navigator.clipboard.writeText(document.getElementById('dispatch-text').textContent).then(()=>{
    const btn=event.target; btn.textContent='✓ Copied!';
    setTimeout(()=>btn.textContent='📋 Copy',2000);
  });
}

// ══════════════════════════════════════════════════════════════
// EMAIL RACHEL
// ══════════════════════════════════════════════════════════════
function openEmailModal() { document.getElementById('email-modal').classList.add('open'); }
function sendEmail() {
  const subj=encodeURIComponent(document.getElementById('email-subject').value);
  const body=encodeURIComponent(document.getElementById('email-body').value);
  window.open(`mailto:${PRICING.rachelEmail}?subject=${subj}&body=${body}`);
}

// ══════════════════════════════════════════════════════════════
// UPLOAD MODAL
// ══════════════════════════════════════════════════════════════
function openUploadModal() {
  alert('To update inventory:\n1. Email Rachel → get the new .docx\n2. Upload it to Claude.ai with this message:\n   "Update my dashboard data.js with this new report"\n3. Push the updated data.js to GitHub → Netlify auto-deploys');
}

// ══════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Boot
window.addEventListener('DOMContentLoaded', boot);
