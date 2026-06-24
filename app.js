// ============================================================
// AUNT CAROL'S SAUCE — APP LOGIC
// All state lives in localStorage under keys:
//   ac_stores      → store overrides (added/updated stores)
//   ac_deliveries  → all delivery records
//   ac_sales       → aggregated sales log
// ============================================================

// ── State ──────────────────────────────────────────────────
let stores = {};          // merged BASE_STORES + localStorage overrides
let deliveries = [];      // all delivery records
let currentEditId = null; // delivery being edited in status modal

let invFilter = 'all';
let delFilter = 'all';
let salesFilter = 'all';

// ── Boot ───────────────────────────────────────────────────
function boot() {
  loadStores();
  loadDeliveries();
  renderAll();
  // Set today's date as default for new run
  const d = document.getElementById('run-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
}

// ── Storage helpers ─────────────────────────────────────────
function loadStores() {
  const saved = JSON.parse(localStorage.getItem('ac_stores') || '{}');
  stores = { ...BASE_STORES };
  // Merge in any saved overrides / new stores
  Object.assign(stores, saved);
}

function saveStores() {
  // Only persist stores that differ from BASE_STORES or are new
  const overrides = {};
  for (const id in stores) {
    const base = BASE_STORES[id];
    const cur = stores[id];
    if (!base || JSON.stringify(base) !== JSON.stringify(cur)) {
      overrides[id] = cur;
    }
  }
  localStorage.setItem('ac_stores', JSON.stringify(overrides));
}

function loadDeliveries() {
  deliveries = JSON.parse(localStorage.getItem('ac_deliveries') || '[]');
}

function saveDeliveries() {
  localStorage.setItem('ac_deliveries', JSON.stringify(deliveries));
}

// ── Utility ─────────────────────────────────────────────────
function clamp(v) { return Math.max(v || 0, 0); }

function stockStatus(s, m) {
  if (s === 0 && m === 0) return 'urgent';
  if (s <= 3 || m <= 3) return 'low';
  return 'ok';
}

function bigDrop(id) {
  const d = stores[id];
  if (!d) return false;
  return (clamp(d.S_may) - clamp(d.S_jun) >= 5) ||
         (clamp(d.M_may) - clamp(d.M_jun) >= 5);
}

function mapsUrl(id) {
  const d = stores[id];
  return `https://www.google.com/maps/search/${encodeURIComponent(d.addr + ', ' + d.city + ', VA ' + d.zip)}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function fmtCur(n) {
  return '$' + (n || 0).toFixed(2);
}

function today() { return new Date().toISOString().split('T')[0]; }

function isThisWeek(iso) {
  const d = new Date(iso);
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  return d >= weekAgo;
}

function isThisMonth(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

// ── Tab switching ────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
}

// ── Render all ───────────────────────────────────────────────
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
  const search = (document.getElementById('search-input')?.value || '').toLowerCase();
  const sortBy = document.getElementById('inv-sort')?.value || 'status';
  const statusOrder = { urgent:0, low:1, ok:2 };

  // Stats
  let urgent=0, low=0, ok=0, totalS=0, totalM=0;
  ids.forEach(id => {
    const s = clamp(stores[id].S_jun), m = clamp(stores[id].M_jun);
    totalS += s; totalM += m;
    const st = stockStatus(s, m);
    if (st === 'urgent') urgent++;
    else if (st === 'low') low++;
    else ok++;
  });
  document.getElementById('inv-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Total stores</div><div class="stat-val blue">${ids.length}</div></div>
    <div class="stat"><div class="stat-label">🔴 Both SKUs out</div><div class="stat-val red">${urgent}</div></div>
    <div class="stat"><div class="stat-label">🟡 Needs restock</div><div class="stat-val amber">${low}</div></div>
    <div class="stat"><div class="stat-label">✅ Well stocked</div><div class="stat-val green">${ok}</div></div>
    <div class="stat"><div class="stat-label">Spicy on shelf</div><div class="stat-val">${totalS}</div></div>
    <div class="stat"><div class="stat-label">Mild on shelf</div><div class="stat-val">${totalM}</div></div>
  `;

  // Filter
  let filtered = ids.filter(id => {
    const d = stores[id];
    const s = clamp(d.S_jun), m = clamp(d.M_jun);
    const st = stockStatus(s, m);
    if (invFilter === 'urgent' && st !== 'urgent') return false;
    if (invFilter === 'low' && st !== 'low') return false;
    if (invFilter === 'dropped' && !bigDrop(id)) return false;
    if (search) {
      const searchable = `${id} ${d.city} ${d.addr}`.toLowerCase();
      if (!searchable.includes(search)) return false;
    }
    return true;
  });

  // Sort
  filtered.sort((a, b) => {
    if (sortBy === 'store') return a - b;
    if (sortBy === 'city') return stores[a].city.localeCompare(stores[b].city);
    if (sortBy === 'spc') return clamp(stores[a].S_jun) - clamp(stores[b].S_jun);
    if (sortBy === 'mld') return clamp(stores[a].M_jun) - clamp(stores[b].M_jun);
    const sa = stockStatus(clamp(stores[a].S_jun), clamp(stores[a].M_jun));
    const sb = stockStatus(clamp(stores[b].S_jun), clamp(stores[b].M_jun));
    if (sa !== sb) return statusOrder[sa] - statusOrder[sb];
    return a - b;
  });

  document.getElementById('inv-count').textContent = `Showing ${filtered.length} of ${ids.length} stores`;

  const tbody = document.getElementById('inv-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">No stores match this filter</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(id => {
    const d = stores[id];
    const js = clamp(d.S_jun), jm = clamp(d.M_jun);
    const ms = clamp(d.S_may), mm = clamp(d.M_may);
    const st = stockStatus(js, jm);
    const dspc = js - ms, dmld = jm - mm;

    const badge = st === 'urgent'
      ? `<span class="badge badge-urgent">Both out</span>`
      : st === 'low'
      ? `<span class="badge badge-low">Low stock</span>`
      : `<span class="badge badge-ok">OK</span>`;

    function skuEl(v) {
      const c = v === 0 ? 'sku-zero' : v <= 3 ? 'sku-low' : 'sku-ok';
      return `<span class="sku ${c}">${v}</span>`;
    }
    function deltaEl(v) {
      if (v > 0) return `<span class="delta delta-up">+${v}</span>`;
      if (v < 0) return `<span class="delta delta-dn">${v}</span>`;
      return `<span class="delta delta-nc">—</span>`;
    }

    return `<tr>
      <td><strong>#${id}</strong></td>
      <td class="addr-cell">${d.addr}</td>
      <td>${d.city}, VA ${d.zip}</td>
      <td>${badge}</td>
      <td>${skuEl(js)}</td>
      <td>${skuEl(jm)}</td>
      <td>${deltaEl(dspc)} / ${deltaEl(dmld)}</td>
      <td class="action-cell">
        <a class="map-link" href="${mapsUrl(id)}" target="_blank">📍</a>
        <button class="btn-xs btn-queue" onclick="queueDelivery(${id})">+ Queue</button>
      </td>
    </tr>`;
  }).join('');
}

// Queue a single store delivery directly from inventory
function queueDelivery(storeId) {
  const d = stores[storeId];
  if (!d) return;
  const rec = {
    id: Date.now() + Math.random(),
    storeId: storeId,
    addr: d.addr,
    city: d.city,
    zip: d.zip,
    spicy: 1,
    mild: 1,
    driver: '',
    date: today(),
    status: 'pending',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  deliveries.unshift(rec);
  saveDeliveries();
  renderDeliveries();
  // Switch to deliveries tab
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
  const dateFilter = document.getElementById('del-date-filter')?.value || 'all';

  // Stats
  const total = deliveries.length;
  const pending = deliveries.filter(d => d.status === 'pending').length;
  const out = deliveries.filter(d => d.status === 'out').length;
  const delivered = deliveries.filter(d => d.status === 'delivered').length;
  const failed = deliveries.filter(d => d.status === 'failed').length;
  const totalRevenue = deliveries
    .filter(d => d.status === 'delivered')
    .reduce((sum, d) => sum + ((d.spicy + d.mild) * PRICING.casePrice), 0);

  document.getElementById('del-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Total deliveries</div><div class="stat-val blue">${total}</div></div>
    <div class="stat"><div class="stat-label">⏳ Pending</div><div class="stat-val amber">${pending}</div></div>
    <div class="stat"><div class="stat-label">🚚 Out for delivery</div><div class="stat-val" style="color:#2471a3">${out}</div></div>
    <div class="stat"><div class="stat-label">✅ Delivered</div><div class="stat-val green">${delivered}</div></div>
    <div class="stat"><div class="stat-label">❌ Failed / Rejected</div><div class="stat-val red">${failed}</div></div>
    <div class="stat"><div class="stat-label">Revenue (delivered)</div><div class="stat-val green">${fmtCur(totalRevenue)}</div></div>
  `;

  // Filter
  let filtered = deliveries.filter(d => {
    if (delFilter !== 'all' && d.status !== delFilter) return false;
    if (dateFilter === 'today' && d.date !== today()) return false;
    if (dateFilter === 'week' && !isThisWeek(d.date)) return false;
    if (dateFilter === 'month' && !isThisMonth(d.date)) return false;
    return true;
  });

  document.getElementById('del-count').textContent =
    `Showing ${filtered.length} of ${total} delivery records`;

  const tbody = document.getElementById('del-body');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No deliveries yet — queue stores from the Inventory tab or create a run.</td></tr>`;
    return;
  }

  const statusLabel = {
    pending: '<span class="badge badge-pending">⏳ Pending</span>',
    out: '<span class="badge badge-out">🚚 Out for delivery</span>',
    delivered: '<span class="badge badge-ok">✅ Delivered</span>',
    failed: '<span class="badge badge-urgent">❌ Failed</span>',
  };

  tbody.innerHTML = filtered.map(d => {
    const cases = (d.spicy || 0) + (d.mild || 0);
    const revenue = cases * PRICING.casePrice;
    return `<tr>
      <td><strong>#${d.storeId}</strong></td>
      <td class="addr-cell">${d.addr}<br><small style="color:#888">${d.city}, VA ${d.zip}</small></td>
      <td><span class="sku sku-ok">${d.spicy || 0}</span></td>
      <td><span class="sku sku-ok">${d.mild || 0}</span></td>
      <td>${cases}</td>
      <td>${d.status === 'delivered' ? fmtCur(revenue) : '—'}</td>
      <td>${d.driver || '<span style="color:#aaa">Unassigned</span>'}</td>
      <td>${fmtDate(d.date)}</td>
      <td>${statusLabel[d.status] || d.status}</td>
      <td class="action-cell">
        <button class="btn-xs btn-update" onclick="openStatusModal('${d.id}')">Update</button>
        <button class="btn-xs btn-del" onclick="deleteDelivery('${d.id}')">×</button>
      </td>
    </tr>`;
  }).join('');
}

// Open status update modal
function openStatusModal(delivId) {
  const d = deliveries.find(x => String(x.id) === String(delivId));
  if (!d) return;
  currentEditId = delivId;
  document.getElementById('status-modal-title').textContent =
    `Update — Store #${d.storeId} | ${d.addr}`;
  document.getElementById('driver-input').value = d.driver || '';
  document.getElementById('notes-input').value = d.notes || '';
  document.getElementById('spicy-delivered').value = d.spicy || 1;
  document.getElementById('mild-delivered').value = d.mild || 1;
  // Highlight current status
  document.querySelectorAll('.status-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === d.status);
  });
  document.getElementById('status-modal').classList.add('open');
}

function selectStatus(el) {
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function saveStatus() {
  const d = deliveries.find(x => String(x.id) === String(currentEditId));
  if (!d) return;
  const newStatus = document.querySelector('.status-btn.active')?.dataset.status || d.status;
  const driver = document.getElementById('driver-input').value.trim();
  const notes = document.getElementById('notes-input').value.trim();
  const spicy = parseInt(document.getElementById('spicy-delivered').value) || 0;
  const mild = parseInt(document.getElementById('mild-delivered').value) || 0;

  d.status = newStatus;
  d.driver = driver;
  d.notes = notes;
  d.spicy = spicy;
  d.mild = mild;
  d.updatedAt = new Date().toISOString();

  // If delivered, log to sales history
  if (newStatus === 'delivered') {
    logSale(d);
  }

  saveDeliveries();
  renderDeliveries();
  renderSales();
  closeModal('status-modal');
}

function deleteDelivery(delivId) {
  if (!confirm('Remove this delivery record?')) return;
  deliveries = deliveries.filter(x => String(x.id) !== String(delivId));
  saveDeliveries();
  renderDeliveries();
}

// Create delivery run (multiple stores at once)
function createDeliveryRun() {
  const ids = Object.keys(stores).map(Number);
  // Pre-sort: urgent first, then low
  const statusOrder = { urgent:0, low:1, ok:2 };
  const sorted = [...ids].sort((a, b) => {
    const sa = stockStatus(clamp(stores[a].S_jun), clamp(stores[a].M_jun));
    const sb = stockStatus(clamp(stores[b].S_jun), clamp(stores[b].M_jun));
    return statusOrder[sa] - statusOrder[sb];
  });

  const listEl = document.getElementById('run-store-list');
  listEl.innerHTML = sorted.map(id => {
    const d = stores[id];
    const s = clamp(d.S_jun), m = clamp(d.M_jun);
    const st = stockStatus(s, m);
    const precheck = st === 'urgent' || st === 'low';
    const badge = st === 'urgent' ? '🔴' : st === 'low' ? '🟡' : '✅';
    return `<label class="store-check-item">
      <input type="checkbox" value="${id}" ${precheck ? 'checked' : ''}>
      <span>${badge} #${id} — ${d.addr}, ${d.city}</span>
      <small>Spicy: ${s} | Mild: ${m}</small>
    </label>`;
  }).join('');

  document.getElementById('run-driver').value = '';
  document.getElementById('run-date').value = today();
  document.getElementById('run-modal').classList.add('open');
}

function saveRun() {
  const driver = document.getElementById('run-driver').value.trim();
  const date = document.getElementById('run-date').value || today();
  const checked = [...document.querySelectorAll('#run-store-list input:checked')];
  if (!checked.length) { alert('Select at least one store.'); return; }

  checked.forEach(cb => {
    const id = Number(cb.value);
    const d = stores[id];
    if (!d) return;
    deliveries.unshift({
      id: Date.now() + Math.random(),
      storeId: id,
      addr: d.addr,
      city: d.city,
      zip: d.zip,
      spicy: 1,
      mild: 1,
      driver: driver,
      date: date,
      status: 'pending',
      notes: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  saveDeliveries();
  renderDeliveries();
  closeModal('run-modal');
  switchTab('deliveries', document.querySelector('[data-tab="deliveries"]'));
}

// ══════════════════════════════════════════════════════════════
// SALES HISTORY TAB
// ══════════════════════════════════════════════════════════════

// Log a completed delivery as a sale
function logSale(delivery) {
  let sales = JSON.parse(localStorage.getItem('ac_sales') || '[]');
  // Avoid duplicate entries
  const exists = sales.find(s => String(s.deliveryId) === String(delivery.id));
  if (exists) {
    // Update existing
    Object.assign(exists, buildSaleRecord(delivery));
  } else {
    sales.unshift(buildSaleRecord(delivery));
  }
  localStorage.setItem('ac_sales', JSON.stringify(sales));
}

function buildSaleRecord(d) {
  const cases = (d.spicy || 0) + (d.mild || 0);
  return {
    deliveryId: d.id,
    storeId: d.storeId,
    addr: d.addr,
    city: d.city || (stores[d.storeId]?.city || ''),
    zip: d.zip || (stores[d.storeId]?.zip || ''),
    driver: d.driver,
    date: d.date,
    spicyCases: d.spicy || 0,
    mildCases: d.mild || 0,
    totalCases: cases,
    spicyUnits: (d.spicy || 0) * PRICING.unitsPerCase,
    mildUnits: (d.mild || 0) * PRICING.unitsPerCase,
    revenue: cases * PRICING.casePrice,
    cogs: cases * PRICING.unitsPerCase * PRICING.unitCost,
    deliveryFee: PRICING.deliveryFeePerVisit,
    grossProfit: (cases * PRICING.casePrice) - (cases * PRICING.unitsPerCase * PRICING.unitCost) - PRICING.deliveryFeePerVisit,
    recordedAt: new Date().toISOString(),
  };
}

function setSalesFilter(f, el) {
  salesFilter = f;
  document.querySelectorAll('#tab-sales .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderSales();
}

function renderSales() {
  const sales = JSON.parse(localStorage.getItem('ac_sales') || '[]');
  const groupBy = document.getElementById('sales-group')?.value || 'store';

  // Filter by date
  const filtered = sales.filter(s => {
    if (salesFilter === 'week') return isThisWeek(s.date);
    if (salesFilter === 'month') return isThisMonth(s.date);
    return true;
  });

  // Summary stats
  const totalRev = filtered.reduce((sum, s) => sum + s.revenue, 0);
  const totalCases = filtered.reduce((sum, s) => sum + s.totalCases, 0);
  const totalGP = filtered.reduce((sum, s) => sum + s.grossProfit, 0);
  const totalSpc = filtered.reduce((sum, s) => sum + s.spicyCases, 0);
  const totalMld = filtered.reduce((sum, s) => sum + s.mildCases, 0);
  const storesServed = new Set(filtered.map(s => s.storeId)).size;

  document.getElementById('sales-stats').innerHTML = `
    <div class="stat"><div class="stat-label">Deliveries logged</div><div class="stat-val blue">${filtered.length}</div></div>
    <div class="stat"><div class="stat-label">Stores served</div><div class="stat-val">${storesServed}</div></div>
    <div class="stat"><div class="stat-label">Cases sold</div><div class="stat-val">${totalCases}</div></div>
    <div class="stat"><div class="stat-label">Spicy cases</div><div class="stat-val">${totalSpc}</div></div>
    <div class="stat"><div class="stat-label">Mild cases</div><div class="stat-val">${totalMld}</div></div>
    <div class="stat"><div class="stat-label">Total revenue</div><div class="stat-val green">${fmtCur(totalRev)}</div></div>
    <div class="stat"><div class="stat-label">Gross profit</div><div class="stat-val green">${fmtCur(totalGP)}</div></div>
  `;

  const thead = document.getElementById('sales-thead-row');
  const tbody = document.getElementById('sales-body');

  if (!filtered.length) {
    thead.innerHTML = `<th>No sales recorded yet</th>`;
    tbody.innerHTML = `<tr><td class="empty-row">Mark deliveries as "Delivered" to log sales here automatically.</td></tr>`;
    return;
  }

  if (groupBy === 'store') {
    // Group by store
    const byStore = {};
    filtered.forEach(s => {
      if (!byStore[s.storeId]) byStore[s.storeId] = { storeId:s.storeId, addr:s.addr, city:s.city, visits:0, spicy:0, mild:0, revenue:0, gp:0 };
      byStore[s.storeId].visits++;
      byStore[s.storeId].spicy += s.spicyCases;
      byStore[s.storeId].mild += s.mildCases;
      byStore[s.storeId].revenue += s.revenue;
      byStore[s.storeId].gp += s.grossProfit;
    });
    const rows = Object.values(byStore).sort((a,b) => b.revenue - a.revenue);
    thead.innerHTML = `<th>Store</th><th>Address</th><th>City</th><th>Visits</th><th>Spicy cases</th><th>Mild cases</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r => `<tr>
      <td><strong>#${r.storeId}</strong></td>
      <td class="addr-cell">${r.addr}</td>
      <td>${r.city}</td>
      <td>${r.visits}</td>
      <td>${r.spicy}</td>
      <td>${r.mild}</td>
      <td class="num-cell">${fmtCur(r.revenue)}</td>
      <td class="num-cell green-text">${fmtCur(r.gp)}</td>
    </tr>`).join('');

  } else if (groupBy === 'city') {
    const byCity = {};
    filtered.forEach(s => {
      if (!byCity[s.city]) byCity[s.city] = { city:s.city, visits:0, spicy:0, mild:0, revenue:0, gp:0 };
      byCity[s.city].visits++;
      byCity[s.city].spicy += s.spicyCases;
      byCity[s.city].mild += s.mildCases;
      byCity[s.city].revenue += s.revenue;
      byCity[s.city].gp += s.grossProfit;
    });
    const rows = Object.values(byCity).sort((a,b) => b.revenue - a.revenue);
    thead.innerHTML = `<th>City</th><th>Visits</th><th>Spicy cases</th><th>Mild cases</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r => `<tr>
      <td><strong>${r.city}</strong></td>
      <td>${r.visits}</td>
      <td>${r.spicy}</td>
      <td>${r.mild}</td>
      <td class="num-cell">${fmtCur(r.revenue)}</td>
      <td class="num-cell green-text">${fmtCur(r.gp)}</td>
    </tr>`).join('');

  } else if (groupBy === 'date') {
    const byDate = {};
    filtered.forEach(s => {
      if (!byDate[s.date]) byDate[s.date] = { date:s.date, visits:0, spicy:0, mild:0, revenue:0, gp:0 };
      byDate[s.date].visits++;
      byDate[s.date].spicy += s.spicyCases;
      byDate[s.date].mild += s.mildCases;
      byDate[s.date].revenue += s.revenue;
      byDate[s.date].gp += s.grossProfit;
    });
    const rows = Object.values(byDate).sort((a,b) => b.date.localeCompare(a.date));
    thead.innerHTML = `<th>Date</th><th>Deliveries</th><th>Spicy cases</th><th>Mild cases</th><th>Revenue</th><th>Gross profit</th>`;
    tbody.innerHTML = rows.map(r => `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${r.visits}</td>
      <td>${r.spicy}</td>
      <td>${r.mild}</td>
      <td class="num-cell">${fmtCur(r.revenue)}</td>
      <td class="num-cell green-text">${fmtCur(r.gp)}</td>
    </tr>`).join('');

  } else if (groupBy === 'sku') {
    const spicyTotal = filtered.reduce((s,r)=>s+r.spicyCases,0);
    const mildTotal = filtered.reduce((s,r)=>s+r.mildCases,0);
    const spicyRev = spicyTotal * PRICING.casePrice;
    const mildRev = mildTotal * PRICING.casePrice;
    thead.innerHTML = `<th>SKU</th><th>Cases sold</th><th>Units sold</th><th>Revenue</th>`;
    tbody.innerHTML = `
      <tr><td>🌶️ Spicy</td><td>${spicyTotal}</td><td>${spicyTotal * PRICING.unitsPerCase}</td><td class="num-cell">${fmtCur(spicyRev)}</td></tr>
      <tr><td>🧡 Mild</td><td>${mildTotal}</td><td>${mildTotal * PRICING.unitsPerCase}</td><td class="num-cell">${fmtCur(mildRev)}</td></tr>
      <tr style="font-weight:600;border-top:2px solid #e0ddd6">
        <td>Total</td><td>${spicyTotal+mildTotal}</td><td>${(spicyTotal+mildTotal)*PRICING.unitsPerCase}</td><td class="num-cell">${fmtCur(spicyRev+mildRev)}</td>
      </tr>`;
  }
}

// ══════════════════════════════════════════════════════════════
// ADD STORE
// ══════════════════════════════════════════════════════════════
function openAddStoreModal() { document.getElementById('addstore-modal').classList.add('open'); }

function saveNewStore() {
  const num = document.getElementById('ns-num').value.trim();
  const addr = document.getElementById('ns-addr').value.trim();
  const city = document.getElementById('ns-city').value.trim();
  const zip = document.getElementById('ns-zip').value.trim();
  const spc = parseInt(document.getElementById('ns-spc').value) || 0;
  const mld = parseInt(document.getElementById('ns-mld').value) || 0;
  if (!num || !addr || !city) { alert('Store #, address, and city are required.'); return; }
  if (stores[num]) { if (!confirm(`Store #${num} already exists. Overwrite?`)) return; }
  stores[num] = { addr, city, zip, S_may: 0, M_may: 0, S_jun: spc, M_jun: mld };
  saveStores();
  renderInventory();
  closeModal('addstore-modal');
}

// ══════════════════════════════════════════════════════════════
// EXPORT DISPATCH
// ══════════════════════════════════════════════════════════════
function exportDispatch() {
  const ids = Object.keys(stores).map(Number);
  const urgent = ids.filter(id => stockStatus(clamp(stores[id].S_jun), clamp(stores[id].M_jun)) === 'urgent');
  const low = ids.filter(id => stockStatus(clamp(stores[id].S_jun), clamp(stores[id].M_jun)) === 'low');
  let txt = `AUNT CAROL'S SAUCE — RESTOCK DISPATCH\n`;
  txt += `Vendor: TTP Foods LLC | #${PRICING.vendorNum}\n`;
  txt += `Generated: ${new Date().toLocaleString()}\n`;
  txt += `Case price: ${fmtCur(PRICING.casePrice)} | Invoice photos → ${PRICING.invoicePhone}\n`;
  txt += `${'='.repeat(52)}\n\n`;
  txt += `🔴 URGENT — BOTH SKUs AT ZERO (${urgent.length} stores)\n${'—'.repeat(40)}\n`;
  urgent.forEach(id => { const d = stores[id]; txt += `#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n`; });
  txt += `\n🟡 LOW STOCK — ONE SKU AT 0 OR ≤3 (${low.length} stores)\n${'—'.repeat(40)}\n`;
  low.forEach(id => {
    const d = stores[id];
    txt += `#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n  Spicy: ${clamp(d.S_jun)} | Mild: ${clamp(d.M_jun)}\n`;
  });
  txt += `\nTotal stores needing delivery: ${urgent.length + low.length}`;
  document.getElementById('dispatch-text').textContent = txt;
  document.getElementById('dispatch-modal').classList.add('open');
}

function copyDispatch() {
  navigator.clipboard.writeText(document.getElementById('dispatch-text').textContent).then(() => {
    const btn = event.target; btn.textContent = '✓ Copied!';
    setTimeout(() => btn.textContent = '📋 Copy', 2000);
  });
}

// ══════════════════════════════════════════════════════════════
// EMAIL RACHEL
// ══════════════════════════════════════════════════════════════
function openEmailModal() { document.getElementById('email-modal').classList.add('open'); }

function sendEmail() {
  const subj = encodeURIComponent(document.getElementById('email-subject').value);
  const body = encodeURIComponent(document.getElementById('email-body').value);
  window.open(`mailto:${PRICING.rachelEmail}?subject=${subj}&body=${body}`);
}

// ══════════════════════════════════════════════════════════════
// UPLOAD MODAL (placeholder — paste text or upload .docx)
// ══════════════════════════════════════════════════════════════
function openUploadModal() {
  alert('To update inventory data:\n\n1. Email Rachel for a new report\n2. Upload the .docx to Claude.ai and paste the text back here\n3. Claude will parse it and update the dashboard automatically\n\nFor now, you can manually update store counts by editing data.js and redeploying.');
}

// ══════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Boot ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', boot);
