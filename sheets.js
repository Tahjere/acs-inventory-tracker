// ============================================================
// AUNT CAROL'S SAUCE — APP LOGIC  v8
// Storage: Google Sheets (primary) + localStorage (offline cache)
// v8 changes (fixes for the paste-report feature added in v7):
//  - Parser rewritten to scan for store-number lines as anchors and
//    validate each candidate 8-line record (state looks like a state
//    code, zip looks like a zip, product mentions SPC/MLD) before
//    accepting it. Stray header rows, page numbers, or footer text
//    anywhere in the paste now get skipped instead of shifting every
//    record after them out of alignment.
//  - The paste UI is now a fully self-contained popup with its own
//    unique element IDs (pr-status/pr-summary/pr-textarea/etc.)
//    instead of reusing parse-status/parse-summary, which may already
//    exist in your real HTML for a separate file-upload feature —
//    reusing those risked writing into the wrong (invisible) element.
// ============================================================

// ── State ───────────────────────────────────────────────────
let stores      = {};   // merged BASE_STORES + sheet/localStorage additions
let deliveries  = [];   // from Sheet (or localStorage fallback)
let currentEditId = null;
let currentEditSaleId = null;
let currentFilteredDeliveries = []; // snapshot of what's on-screen, for bulk actions
let pendingReportUpdates = null;    // staged result from parsePastedReport, awaiting confirm
let deliveryUiStep = {};            // transient, not persisted: deliveryId -> 'main' | 'pick-sku'
let lastDeliveryAction = null;      // snapshot for the undo toast
let deliveryToastTimer = null;

let invFilter   = 'all';
let cityFilter  = 'all';
let currentFilteredStoreIds = []; // snapshot of what's visible in Inventory, for the route button
let delFilter   = 'all';
let salesFilter = 'all';

// ── Boot ─────────────────────────────────────────────────────
async function boot() {
  loadStoresLocal();
  loadDeliveriesLocal();   // show cached data instantly
  renderAll();

  // Set default date in run modal
  const rd = document.getElementById('run-date');
  if (rd) rd.value = today();

  if (SHEET_CONFIGURED) {
    // Test connection first — this sets the dot color and shows error detail if needed
    await testSheetConnection();
    // Only pull data if connection succeeded
    const dot = document.getElementById('sync-dot');
    if (dot && dot.classList.contains('ok')) {
      await refreshFromSheet();
    }
  } else {
    setSyncStatus('err', 'Sheet not configured');
    const banner = document.getElementById('config-banner');
    if (banner) banner.style.display = 'block';
  }
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
    // Only let a field from the Sheet overwrite what's already known
    // locally when the Sheet actually has a real value for it. If the
    // background sync after a paste-report import didn't fully land
    // for a store, its Sheet row may be blank/incomplete — without
    // this guard, that blank would silently wipe out good local data
    // (city, or worse, stock counts) on every page reload. 0 is a
    // legitimate stock value, so this checks presence, not truthiness.
    const has = v => v !== undefined && v !== null && v !== '';
    sheetStores.forEach(s => {
      // Preserve locally-tracked restock history — the report only
      // carries the raw counts, not lastRestockedAt/lastRestockNote.
      const prev = stores[s.storeId] || {};
      stores[s.storeId] = {
        ...prev,
        addr: has(s.addr) ? s.addr : (prev.addr || ''),
        city: has(s.city) ? s.city : (prev.city || ''),
        zip:  has(s.zip)  ? s.zip  : (prev.zip  || ''),
        S_may: has(s.S_may) ? Number(s.S_may) : clamp(prev.S_may),
        M_may: has(s.M_may) ? Number(s.M_may) : clamp(prev.M_may),
        S_jun: has(s.S_jun) ? Number(s.S_jun) : clamp(prev.S_jun),
        M_jun: has(s.M_jun) ? Number(s.M_jun) : clamp(prev.M_jun),
      };
    });
    const overrides = {};
    Object.keys(stores).forEach(id => {
      if (!BASE_STORES[id]) overrides[id] = stores[id];
    });
    localStorage.setItem('ac_stores', JSON.stringify(overrides));
  }
  renderAll();
  populateCityDropdown(); // in case the fix above just restored cities that were previously blanked out
}

function normalizeDelivery(d) {
  return {
    id: String(d.id), storeId: Number(d.storeId),
    addr: d.addr||'', city: d.city||'', zip: d.zip||'',
    spicy: Number(d.spicy)||0, mild: Number(d.mild)||0,
    driver: d.driver||'', date: d.date||today(),
    status: d.status||'pending', notes: d.notes||'',
    // How much of this delivery's spicy/mild has already been applied
    // to store stock — used to avoid double-counting on edits/reloads.
    appliedSpicy: Number(d.appliedSpicy)||0,
    appliedMild:  Number(d.appliedMild)||0,
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

// Anything below this quantity on a SKU counts as low stock.
const LOW_STOCK_THRESHOLD = 5;

function stockStatus(s, m) {
  s = clamp(s); m = clamp(m);
  if (s === 0 && m === 0) return 'urgent';
  if (s < LOW_STOCK_THRESHOLD || m < LOW_STOCK_THRESHOLD) return 'low';
  return 'ok';
}

// Fine-grained status distinguishing which SKU(s) are out or low, for
// badge labels. "Out" (0 on hand) takes priority over "low" per SKU.
function stockStatusDetail(s, m) {
  s = clamp(s); m = clamp(m);
  const spicyOut = s === 0;
  const mildOut  = m === 0;
  const spicyLow = s > 0 && s < LOW_STOCK_THRESHOLD;
  const mildLow  = m > 0 && m < LOW_STOCK_THRESHOLD;

  if (spicyOut && mildOut) return { code: 'both-out',  label: 'Both out' };
  if (spicyOut)            return { code: 'spicy-out', label: 'Spicy out' };
  if (mildOut)             return { code: 'mild-out',  label: 'Mild out' };
  if (spicyLow && mildLow) return { code: 'low-both',  label: 'Low stock (both)' };
  if (spicyLow)            return { code: 'low-spicy', label: 'Low stock (spicy)' };
  if (mildLow)             return { code: 'low-mild',  label: 'Low stock (mild)' };
  return { code: 'ok', label: 'OK' };
}

function bigDrop(id) {
  const d = stores[id]; if (!d) return false;
  return (clamp(d.S_may)-clamp(d.S_jun) >= 5) || (clamp(d.M_may)-clamp(d.M_jun) >= 5);
}

// ── Store ↔ delivery linkage ─────────────────────────────────────
// The most recently touched delivery record for a store, or null.
function getLatestDeliveryForStore(storeId) {
  const list = deliveries.filter(d => d.storeId === storeId);
  if (!list.length) return null;
  return list.slice().sort((a,b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
}
// True if this store still needs eyes on it: a delivery is actively
// in flight (pending/out), or stock is low/urgent with nothing queued.
function storeNeedsAttention(storeId) {
  const d = stores[storeId]; if (!d) return false;
  const st = stockStatus(clamp(d.S_jun), clamp(d.M_jun));
  const latest = getLatestDeliveryForStore(storeId);
  if (latest && (latest.status === 'pending' || latest.status === 'out')) return true;
  // Current stock always counts, regardless of past delivery history —
  // a store that had one SKU restocked but is still low/out on the
  // other one still needs attention, even though its last delivery is
  // already marked "delivered".
  if (st === 'urgent' || st === 'low') return true;
  return false;
}

// Save a store record locally and best-effort push it to the Sheet so
// the stock change survives a refresh. ASSUMES sheetAddStore upserts
// by storeId — if your backend only inserts new rows, this won't
// stick past the next Sheet pull (localStorage will still be correct
// on this device though).
async function persistStoreOverride(id, storeRec) {
  const saved = JSON.parse(localStorage.getItem('ac_stores')||'{}');
  saved[id] = storeRec;
  localStorage.setItem('ac_stores', JSON.stringify(saved));
  if (typeof sheetAddStore === 'function') {
    try { await sheetAddStore({ storeId:id, ...storeRec }); } catch(e) { /* best effort */ }
  }
}

// Apply (or reverse) a delivery's effect on its store's live stock.
// isNowDelivered=true moves the store's stock toward "already has
// d.spicy/d.mild extra on the shelf"; false moves it back toward zero
// extra. Diffs against what was previously applied, so calling this
// again after an edit only adds/removes the difference.
async function reconcileDeliveryStock(d, isNowDelivered) {
  const store = stores[d.storeId];
  if (!store) return;

  const targetSpicy = isNowDelivered ? clamp(d.spicy) : 0;
  const targetMild  = isNowDelivered ? clamp(d.mild)  : 0;
  const deltaSpicy  = targetSpicy - (d.appliedSpicy || 0);
  const deltaMild   = targetMild  - (d.appliedMild  || 0);

  if (deltaSpicy !== 0 || deltaMild !== 0) {
    // "Versus/last" only moves for a SKU that actually changed —
    // it captures the value right before this change, not a fixed
    // reporting-period snapshot.
    if (deltaSpicy !== 0) {
      store.S_may = clamp(store.S_jun);
      store.S_jun = clamp(clamp(store.S_jun) + deltaSpicy);
    }
    if (deltaMild !== 0) {
      store.M_may = clamp(store.M_jun);
      store.M_jun = clamp(clamp(store.M_jun) + deltaMild);
    }

    if (deltaSpicy > 0 || deltaMild > 0) {
      store.lastRestockedAt = new Date().toISOString();
      const parts = [];
      if (deltaSpicy > 0) parts.push(`Spicy +${deltaSpicy}`);
      if (deltaMild  > 0) parts.push(`Mild +${deltaMild}`);
      store.lastRestockNote = parts.join(', ') + (d.driver ? ` via ${d.driver}` : '');
    }
    await persistStoreOverride(d.storeId, store);
  }

  d.appliedSpicy = targetSpicy;
  d.appliedMild  = targetMild;
}

// ── GPS / Maps helpers ──────────────────────────────────────────
// Build a maps search link from raw address parts (works for any
// address — current store record or a delivery's own snapshot).
function mapsUrlForAddress(addr, city, zip) {
  return `https://www.google.com/maps/search/${encodeURIComponent(addr+', '+city+', VA '+zip)}`;
}
// Convenience wrapper for a store's CURRENT address on file.
function mapsUrl(id) {
  const d = stores[id];
  if (!d) return '#';
  return mapsUrlForAddress(d.addr, d.city, d.zip);
}
// Rendered HTML for a GPS link. Uses inline styles (not just a CSS
// class) so it always shows up as a visible pill regardless of what
// .map-link is (or isn't) styled as in the page's stylesheet.
function gpsLinkHtml(addr, city, zip) {
  const url = mapsUrlForAddress(addr, city, zip);
  return `<a href="${url}" target="_blank" class="map-link"
    style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;
           border:1px solid var(--border,#ccc);border-radius:6px;
           font-size:12px;text-decoration:none;white-space:nowrap;"
    title="Open in Maps">📍 GPS</a>`;
}
// Multi-stop turn-by-turn route (Google Maps supports this without an API key).
function buildRouteUrl(addrList) {
  const capped = addrList.slice(0, 23); // practical cap for a single route link
  const destination = encodeURIComponent(capped[capped.length-1]);
  const waypoints = capped.slice(0, -1).map(a=>encodeURIComponent(a)).join('|');
  let url = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving`;
  if (waypoints) url += `&waypoints=${waypoints}`;
  return url;
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
// PASTE-REPORT PARSER  (Food Lion-style scan-report format)
// ══════════════════════════════════════════════════════════════
// Scans for lines that are purely a store number and treats each as
// an "anchor." The 7 lines after an anchor are only accepted as a
// record if they look right (state code, zip, UPC, product mentions
// SPC/MLD) — otherwise that anchor is rejected as a false positive
// (e.g. a stray page number) and scanning resumes one line later.
// This means header rows, footers, or other junk text anywhere in
// the paste get skipped instead of shifting every record after them
// out of alignment.
function parsePastedReport(rawText) {
  const lines = String(rawText || '').split('\n').map(l => l.trim()).filter(l => l !== '');
  const results = [];
  const anomalies = [];
  const n = lines.length;
  let i = 0;

  while (i < n) {
    if (!/^\d+$/.test(lines[i])) { i++; continue; }

    if (i + 7 >= n) {
      anomalies.push(`Incomplete record at the end, starting with "${lines[i]}" — ignored.`);
      break;
    }

    const chunk = lines.slice(i, i + 8);
    const [storeNum, addr, city, state, zip, upc, product, qtyRaw] = chunk;

    const looksValid =
      /^[A-Za-z]{2}$/.test(state) &&
      /^\d{5}(-\d{4})?$/.test(zip) &&
      /^\d+$/.test(upc) &&
      /(SPC|MLD)/i.test(product);

    if (!looksValid) {
      // False anchor (stray number, header, page number, etc.) —
      // don't consume 8 lines, just move past this one line.
      i++;
      continue;
    }

    let qtyStr = qtyRaw.trim();
    let negative = false;
    if (qtyStr.startsWith('(') && qtyStr.endsWith(')')) {
      negative = true;
      qtyStr = qtyStr.slice(1, -1);
    }
    const qty = parseFloat(qtyStr);
    if (isNaN(qty)) {
      anomalies.push(`Store #${storeNum}: couldn't read quantity "${qtyRaw}" — skipped this line.`);
      i += 8;
      continue;
    }
    const signedQty = negative ? -qty : qty;
    const sku = /MLD/i.test(product) || upc.endsWith('951') ? 'mild'
              : /SPC/i.test(product) || upc.endsWith('950') ? 'spicy'
              : null;

    if (negative) {
      anomalies.push(`Store #${storeNum}: ${sku || 'a'} quantity is negative (${signedQty}) — likely a return/credit, worth double-checking before trusting it as a shelf count.`);
    }
    if (!sku) {
      anomalies.push(`Store #${storeNum}: couldn't tell spicy vs. mild from "${product}" / UPC ${upc} — skipped.`);
    } else {
      results.push({ storeNum, addr, city, state, zip, upc, product, sku, qty: signedQty });
    }

    i += 8;
  }

  // Group into per-store updates
  const byStore = {};
  results.forEach(r => {
    if (!byStore[r.storeNum]) {
      byStore[r.storeNum] = { addr: r.addr, city: r.city, zip: r.zip, spicy: null, mild: null };
    }
    byStore[r.storeNum][r.sku] = r.qty;
  });

  Object.entries(byStore).forEach(([storeNum, v]) => {
    if (v.spicy === null || v.mild === null) {
      anomalies.push(`Store #${storeNum}: only found one SKU in the report (spicy=${v.spicy}, mild=${v.mild}) — the missing one will be left unchanged.`);
    }
  });

  return { byStore, anomalies, recordCount: results.length, totalLines: n };
}

// Stage parsed results and show a review summary before touching any
// data. Nothing is applied until applyPastedReport() is called.
function previewPastedReport(rawText) {
  let parsed;
  try {
    parsed = parsePastedReport(rawText);
  } catch (e) {
    const statusEl = document.getElementById('pr-status');
    if (statusEl) statusEl.textContent = `Parse error: ${e.message}`;
    return;
  }

  const { byStore, anomalies, recordCount, totalLines } = parsed;
  const storeNums = Object.keys(byStore);
  pendingReportUpdates = byStore;

  const newStores = storeNums.filter(id => !stores[id]);
  const existingStores = storeNums.filter(id => stores[id]);

  const statusEl = document.getElementById('pr-status');
  const summaryEl = document.getElementById('pr-summary');

  if (statusEl) {
    statusEl.textContent = storeNums.length
      ? `Recognized ${recordCount} SKU line(s) across ${storeNums.length} store(s), out of ${totalLines} non-blank line(s) pasted.`
      : `Found 0 valid records out of ${totalLines} non-blank line(s) pasted. This usually means the format doesn't match store#/address/city/state/zip/UPC/product/qty per line — check the raw text below.`;
  }

  if (summaryEl) {
    summaryEl.style.display = 'block';
    summaryEl.innerHTML = storeNums.length ? `
      <div style="margin-bottom:6px;"><strong>${existingStores.length}</strong> existing stores will be updated, <strong>${newStores.length}</strong> new stores will be added.</div>
      ${newStores.length ? `<div style="margin-bottom:6px;">New: ${newStores.map(id=>'#'+id).join(', ')}</div>` : ''}
      ${anomalies.length ? `<div style="color:#b45309;margin-bottom:6px;"><strong>${anomalies.length} thing(s) to check:</strong><br>${anomalies.map(a=>'• '+a).join('<br>')}</div>` : '<div style="color:#15803d;">No anomalies found.</div>'}
      <button id="pr-apply-btn" class="btn-xs btn-queue" onclick="applyPastedReport()">Apply ${storeNums.length} stores to Inventory</button>
    ` : `
      ${anomalies.length ? `<div style="color:#b45309;">${anomalies.map(a=>'• '+a).join('<br>')}</div>` : ''}
      <div style="margin-top:6px;color:#666;">First 3 non-blank lines of what was pasted, for reference:<br>
        <code style="white-space:pre-wrap;">${String(rawText||'').split('\\n').map(l=>l.trim()).filter(l=>l).slice(0,3).join('\\n')}</code>
      </div>
    `;
  }
}

// Actually merge the staged report into `stores`, same pattern as a
// Sheet refresh: overwrite S_jun/M_jun, preserve lastRestockedAt/note.
async function applyPastedReport() {
  if (!pendingReportUpdates) return;
  const btn = document.getElementById('pr-apply-btn');
  const statusEl = document.getElementById('pr-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }

  try {
    const entries = Object.entries(pendingReportUpdates);

    for (const [storeNum, v] of entries) {
      const prev = stores[storeNum] || {};
      const prevSpicy = clamp(prev.S_jun);
      const prevMild  = clamp(prev.M_jun);
      const newSpicy  = v.spicy !== null ? v.spicy : prevSpicy;
      const newMild   = v.mild  !== null ? v.mild  : prevMild;

      // Only move "versus/last" for a SKU whose count actually changed
      // from what's currently on file — an unchanged count keeps
      // whatever versus/last value it already had.
      const spicyChanged = newSpicy !== prevSpicy;
      const mildChanged  = newMild  !== prevMild;

      stores[storeNum] = {
        ...prev,
        addr: v.addr, city: v.city, zip: v.zip,
        S_may: spicyChanged ? prevSpicy : (prev.S_may !== undefined ? prev.S_may : 0),
        M_may: mildChanged  ? prevMild  : (prev.M_may !== undefined ? prev.M_may : 0),
        S_jun: newSpicy,
        M_jun: newMild,
      };
    }

    // Persist locally FIRST — instant, always succeeds, and is what
    // actually drives the Inventory tab. The Sheet sync below is
    // best-effort and must not block this.
    const saved = JSON.parse(localStorage.getItem('ac_stores')||'{}');
    for (const [storeNum] of entries) {
      saved[storeNum] = stores[storeNum];
    }
    localStorage.setItem('ac_stores', JSON.stringify(saved));

    const count = entries.length;
    pendingReportUpdates = null;
    renderInventory();
    populateCityDropdown(); // a pasted report can introduce new cities

    if (statusEl) statusEl.textContent = `✅ Applied ${count} stores to Inventory. Syncing to the Sheet in the background — you can close this window now.`;
    const summaryEl = document.getElementById('pr-summary');
    if (summaryEl) summaryEl.style.display = 'none';
    if (btn) { btn.textContent = 'Applied'; }

    // Push to the Sheet in the background, in parallel, with a timeout
    // per request — a slow or hung call here can no longer freeze the
    // UI or block the other 68 stores from applying.
    if (typeof sheetAddStore === 'function') {
      const withTimeout = (p, ms) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))
      ]);
      Promise.all(entries.map(([storeNum]) =>
        withTimeout(sheetAddStore({ storeId: storeNum, ...stores[storeNum] }), 8000)
          .catch(e => console.warn('Background Sheet sync failed for store', storeNum, e))
      )).then(() => console.log('Background Sheet sync finished for pasted report.'));
    }
  } catch (err) {
    console.error('applyPastedReport failed:', err);
    if (statusEl) statusEl.textContent = `⚠️ Apply failed: ${err.message}. Open the browser console (F12 → Console tab) and share the red error text so I can fix it.`;
    if (btn) { btn.disabled = false; btn.textContent = 'Retry apply'; }
  }
}

// ── Self-contained "Paste report" popup ──────────────────────────
// Built entirely in JS with its own unique element IDs (pr-*) so it
// can never collide with parse-status/parse-summary/report-file-input
// or any other IDs your existing HTML might already define for a
// separate file-upload feature.
function ensurePasteReportModal() {
  if (document.getElementById('paste-report-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'paste-report-modal';
  modal.style.cssText = `
    display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);
    z-index:9999; align-items:center; justify-content:center; padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:var(--bg,#fff); color:var(--ink,#111); padding:20px; border-radius:10px; width:600px; max-width:95vw; max-height:90vh; overflow:auto; font-family:inherit;">
      <h3 style="margin:0 0 8px;">Paste inventory report</h3>
      <p style="font-size:13px;color:#666;margin:0 0 10px;">
        Paste a scan report: store #, address, city, state, zip, UPC, product, quantity — repeated per SKU per store.
        Extra header rows, page numbers, or footer text anywhere are fine, they'll be skipped automatically.
      </p>
      <textarea id="pr-textarea" rows="10" style="width:100%;box-sizing:border-box;padding:8px;font-family:monospace;font-size:12px;"></textarea>
      <div style="margin-top:10px;display:flex;gap:8px;">
        <button class="btn-xs btn-queue" onclick="previewPastedReport(document.getElementById('pr-textarea').value)">Parse pasted report</button>
        <button class="btn-xs" onclick="closePasteReportModal()">Close</button>
      </div>
      <div id="pr-status" style="margin-top:10px;font-size:13px;"></div>
      <div id="pr-summary" style="display:none;margin-top:8px;font-size:13px;"></div>
    </div>`;
  document.body.appendChild(modal);
}

function openPasteReportModal() {
  ensurePasteReportModal();
  clearParseState();
  document.getElementById('paste-report-modal').style.display = 'flex';
}

function closePasteReportModal() {
  const m = document.getElementById('paste-report-modal');
  if (m) m.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// INVENTORY TAB  (the "homepage")
// ══════════════════════════════════════════════════════════════
function setInvFilter(f, el) {
  invFilter = f;
  document.querySelectorAll('#tab-inventory .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  renderInventory();
}

// ── Big-button, thumb-friendly delivery actions (mobile-first) ──────
// Replaces the old dropdown: one row of big buttons, no menu to open.
// Tapping "Delivered" swaps in a second row (Spicy/Mild/Both) in the
// same spot instead of a picker. Every action gets a 4-second undo.
function bigDeliveryBtn(label, emoji, cls, onclick) {
  return `<button class="${cls}" onclick="${onclick}"
    style="flex:1;min-width:60px;min-height:46px;border:none;border-radius:8px;
           font-size:13px;font-weight:600;display:flex;flex-direction:column;
           align-items:center;justify-content:center;gap:2px;padding:6px 4px;cursor:pointer;">
    <span style="font-size:17px;line-height:1;">${emoji}</span>${label}
  </button>`;
}

// Shared renderer used by both the Inventory homepage and the
// Deliveries tab — same delivery, same buttons, same state.
function renderDeliveryActionButtons(d) {
  if (!d) return '';
  const step = deliveryUiStep[d.id] || 'main';

  if (step === 'pick-sku') {
    return `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${bigDeliveryBtn('Spicy', '🌶️', 'btn-del',    `handleBigDeliver('${d.id}','spicy')`)}
        ${bigDeliveryBtn('Mild',  '🧡', 'btn-update', `handleBigDeliver('${d.id}','mild')`)}
        ${bigDeliveryBtn('Both',  '✅', 'btn-queue',  `handleBigDeliver('${d.id}','both')`)}
      </div>
      <button onclick="cancelSkuPicker('${d.id}')" style="margin-top:4px;background:none;border:none;color:var(--ink3,#888);font-size:13px;padding:2px;cursor:pointer;">‹ Back</button>`;
  }

  if (d.status === 'delivered' || d.status === 'failed') {
    const label = d.status === 'delivered'
      ? `✅ Delivered${d.lastDeliverNote ? ' — '+d.lastDeliverNote : ''}`
      : '❌ Failed';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        <span style="font-size:13px;">${label}</span>
        <button class="btn-xs btn-queue" onclick="queueDelivery(${d.storeId})">Queue again</button>
      </div>`;
  }

  const buttons = [];
  if (d.status !== 'out') buttons.push(bigDeliveryBtn('Out', '🚚', 'btn-update', `handleBigOut('${d.id}')`));
  buttons.push(bigDeliveryBtn('Delivered', '✅', 'btn-queue', `showSkuPicker('${d.id}')`));
  buttons.push(bigDeliveryBtn('Failed', '❌', 'btn-del', `handleBigFailed('${d.id}')`));
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${buttons.join('')}</div>`;
}

function showSkuPicker(delivId) {
  deliveryUiStep[delivId] = 'pick-sku';
  renderInventory();
  renderDeliveries();
}
function cancelSkuPicker(delivId) {
  delete deliveryUiStep[delivId];
  renderInventory();
  renderDeliveries();
}

// Snapshot enough state to fully undo one quick action: the delivery's
// own fields, plus the whole sales array (since "Delivered" can create
// or overwrite a sale record).
function captureDeliverySnapshot(delivId) {
  const d = deliveries.find(x => String(x.id) === String(delivId));
  if (!d) return null;
  return {
    delivId,
    prevStatus: d.status,
    prevSpicy: d.spicy,
    prevMild: d.mild,
    prevNote: d.lastDeliverNote,
    prevSalesJson: localStorage.getItem('ac_sales') || '[]',
  };
}

async function handleBigOut(delivId) {
  const snap = captureDeliverySnapshot(delivId);
  await quickUpdateStatus(delivId, 'out');
  delete deliveryUiStep[delivId];
  lastDeliveryAction = snap;
  showDeliveryToast('Marked out for delivery');
}

async function handleBigFailed(delivId) {
  const snap = captureDeliverySnapshot(delivId);
  await quickUpdateStatus(delivId, 'failed');
  delete deliveryUiStep[delivId];
  lastDeliveryAction = snap;
  showDeliveryToast('Marked failed');
}

async function handleBigDeliver(delivId, which) {
  const snap = captureDeliverySnapshot(delivId);
  const note = which === 'both' ? 'Both SKUs' : which === 'spicy' ? 'Spicy only' : 'Mild only';
  const d = deliveries.find(x => String(x.id) === String(delivId));
  if (d) d.lastDeliverNote = note;
  const delivered = { spicy: which==='both'||which==='spicy', mild: which==='both'||which==='mild' };
  await quickUpdateStatus(delivId, 'delivered', delivered);
  delete deliveryUiStep[delivId];
  lastDeliveryAction = snap;
  showDeliveryToast(`Delivered — ${note}`);
}

// ── Undo toast ────────────────────────────────────────────────────
function ensureDeliveryToast() {
  if (document.getElementById('delivery-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'delivery-toast';
  toast.style.cssText = `
    display:none; position:fixed; bottom:16px; left:50%; transform:translateX(-50%);
    background:#1f2937; color:#fff; padding:10px 16px; border-radius:8px;
    font-size:13px; z-index:10000; align-items:center; gap:14px; max-width:90vw;
    box-shadow:0 4px 12px rgba(0,0,0,0.3);
  `;
  document.body.appendChild(toast);
}

function showDeliveryToast(message) {
  ensureDeliveryToast();
  const toast = document.getElementById('delivery-toast');
  toast.style.display = 'flex';
  toast.innerHTML = `<span>${message}</span><button onclick="undoLastDeliveryAction()" style="background:none;border:none;color:#93c5fd;font-weight:700;font-size:13px;cursor:pointer;">Undo</button>`;
  clearTimeout(deliveryToastTimer);
  deliveryToastTimer = setTimeout(() => {
    toast.style.display = 'none';
    lastDeliveryAction = null;
  }, 4000);
}

async function undoLastDeliveryAction() {
  if (!lastDeliveryAction) return;
  const { delivId, prevStatus, prevSpicy, prevMild, prevNote, prevSalesJson } = lastDeliveryAction;
  const d = deliveries.find(x => String(x.id) === String(delivId));
  if (d) {
    d.status = prevStatus;
    d.spicy = prevSpicy;
    d.mild = prevMild;
    d.lastDeliverNote = prevNote;
    d.updatedAt = new Date().toISOString();
    await reconcileDeliveryStock(d, prevStatus === 'delivered');
    saveDeliveriesLocal();
    await sheetUpdateDelivery(d);
  }
  localStorage.setItem('ac_sales', prevSalesJson);

  const toast = document.getElementById('delivery-toast');
  if (toast) toast.style.display = 'none';
  clearTimeout(deliveryToastTimer);
  lastDeliveryAction = null;

  renderInventory();
  renderDeliveries();
  renderSales();
}

// Inline delivery controls shown in each Inventory row's action cell.
// Mirrors the Deliveries-tab quick actions so you never have to leave
// the homepage to move a store's delivery along.
function renderInvDeliveryControls(storeId) {
  const d = getLatestDeliveryForStore(storeId);
  if (!d) {
    return `<button class="btn-xs btn-queue" onclick="queueDelivery(${storeId})">+ Queue</button>`;
  }
  return renderDeliveryActionButtons(d);
}


// ── City filter + route helpers ──────────────────────────────────
// Injects a city dropdown + "Route for this view" button above the
// Inventory table once. Rebuilds the dropdown's options every render
// so newly-added stores (e.g. from a pasted report) show up.
function ensureCityFilterBar() {
  // Fold these into the EXISTING filter-pills / control-right groups
  // (same row as All / Both out / Low stock / Search / Sort / Export)
  // instead of a separate floating row on top of it.
  const pillsContainer = document.querySelector('#tab-inventory .filter-pills');
  const rightContainer = document.querySelector('#tab-inventory .control-right');

  if (pillsContainer && !document.getElementById('inv-pill-spicy-needs')) {
    pillsContainer.insertAdjacentHTML('beforeend', `
      <button id="inv-pill-spicy-needs" class="pill" onclick="setInvFilter('spicy-needs', this)">🌶️ Low spicy</button>
      <button id="inv-pill-mild-needs" class="pill" onclick="setInvFilter('mild-needs', this)">🧡 Low mild</button>
    `);
  }

  if (rightContainer && !document.getElementById('inv-city-select')) {
    const wrap = document.createElement('span');
    wrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    wrap.innerHTML = `
      <label style="font-size:12px;color:var(--ink3,#777);">City:</label>
      <select id="inv-city-select" onchange="setCityFilter(this.value)"></select>
      <button class="btn-xs btn-queue" onclick="openRouteForCityView()">🗺️ Route for this view</button>
    `;
    rightContainer.insertBefore(wrap, rightContainer.firstChild);
    populateCityDropdown();
  }

  // Fallback only if neither expected container exists — keeps the
  // feature working even if the real HTML doesn't match these class
  // names, rather than silently doing nothing.
  if (!pillsContainer && !rightContainer && !document.getElementById('inv-city-bar')) {
    const stats = document.getElementById('inv-stats');
    if (!stats) return;
    const bar = document.createElement('div');
    bar.id = 'inv-city-bar';
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;';
    bar.innerHTML = `
      <button class="pill" onclick="setInvFilter('spicy-needs', this)">🌶️ Low spicy</button>
      <button class="pill" onclick="setInvFilter('mild-needs', this)">🧡 Low mild</button>
      <span style="width:1px;height:20px;background:var(--border,#e5e2dc);"></span>
      <label style="font-size:12px;color:var(--ink3,#777);">City:</label>
      <select id="inv-city-select" onchange="setCityFilter(this.value)"></select>
      <button class="btn-xs btn-queue" onclick="openRouteForCityView()">🗺️ Route for this view</button>
    `;
    stats.insertAdjacentElement('afterend', bar);
    populateCityDropdown();
  }
}

// Case-insensitive comparison key — pasted reports use ALL CAPS city
// names, other sources may not, so "Virginia Beach" and "VIRGINIA
// BEACH" need to be treated as the same city, not two different ones.
function normalizeCity(c) {
  return String(c || '').trim().toLowerCase();
}

// Converts any casing ("VIRGINIA BEACH", "virginia beach") to a clean
// "Virginia Beach" for display — the underlying match is still done on
// the lowercase normalized key, so this is purely cosmetic.
function titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function populateCityDropdown() {
  const sel = document.getElementById('inv-city-select');
  if (!sel) return;
  const seen = new Map(); // normalized city -> clean display label
  Object.values(stores).forEach(s => {
    const norm = normalizeCity(s.city);
    if (norm && !seen.has(norm)) seen.set(norm, titleCase(s.city));
  });
  const entries = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = `<option value="all">All cities (${entries.length})</option>` +
    entries.map(([norm, label]) => `<option value="${norm}">${label}</option>`).join('');
  sel.value = cityFilter;
}

// Cheap, safe to call on every render: keeps the dropdown's selected
// value in sync WITHOUT touching its <option> list. Rebuilding the
// options themselves on every render — including from inside the
// select's own onchange handler — is what caused the filter to
// degrade after repeated use; this avoids that for the common case.
// The full rebuild (above) only needs to run when the set of cities
// could actually have changed (new stores added).
function syncCityDropdownValue() {
  const sel = document.getElementById('inv-city-select');
  if (sel && sel.value !== cityFilter) sel.value = cityFilter;
}

function setCityFilter(city) {
  cityFilter = city;
  renderInventory();
}

// Adds "Best route (by zip)" to the existing sort dropdown if it's
// not already there, and makes it the default the first time this
// runs — grouping by zip is a free proxy for "these are probably near
// each other" since there's no real lat/long on file.
function ensureInvRouteSortOption() {
  const sel = document.getElementById('inv-sort');
  if (!sel || sel.querySelector('option[value="route"]')) return;
  sel.insertAdjacentHTML('beforeend', `<option value="route">Best route (by zip)</option>`);
  sel.value = 'route';
}

// Hands the currently-visible stores (respecting city/status/search
// filters) to Google Maps as a multi-stop trip. This is the part that
// gives an actually accurate route — Google has real road data, our
// zip-based sort is just a starting guess at the order.
function openRouteForCityView() {
  const ids = currentFilteredStoreIds;
  if (!ids.length) { alert('No stores in the current view to route.'); return; }
  if (ids.length > 23) alert('Route link is capped at 23 stops — using the first 23 in view.');
  const addrs = ids.map(id => {
    const d = stores[id];
    return `${d.addr}, ${d.city}, VA ${d.zip}`;
  });
  window.open(buildRouteUrl(addrs), '_blank');
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

  ensureCityFilterBar();
  syncCityDropdownValue();
  ensureInvRouteSortOption();

  // Filter
  let filtered = ids.filter(id => {
    const d = stores[id];
    const s = clamp(d.S_jun), m = clamp(d.M_jun);
    const st = stockStatus(s, m);
    if (invFilter==='urgent'  && st!=='urgent') return false;
    if (invFilter==='low'     && st!=='low')    return false;
    if (invFilter==='dropped' && !bigDrop(id))  return false;
    if (invFilter==='spicy-needs' && s >= LOW_STOCK_THRESHOLD) return false;
    if (invFilter==='mild-needs'  && m >= LOW_STOCK_THRESHOLD) return false;
    if (cityFilter !== 'all' && normalizeCity(d.city) !== cityFilter) return false;
    if (search) {
      const hay = `${id} ${d.city} ${d.addr}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  // Primary sort (whatever the user picked)
  filtered.sort((a, b) => {
    if (sortBy==='store') return a-b;
    if (sortBy==='city')  return stores[a].city.localeCompare(stores[b].city);
    if (sortBy==='spc')   return clamp(stores[a].S_jun)-clamp(stores[b].S_jun);
    if (sortBy==='mld')   return clamp(stores[a].M_jun)-clamp(stores[b].M_jun);
    if (sortBy==='route') {
      const za = stores[a].zip || '', zb = stores[b].zip || '';
      // A blank zip (missing/bad data) shouldn't cluster at the top just
      // because an empty string sorts before real zip codes.
      if (!za && zb) return 1;
      if (za && !zb) return -1;
      if (za !== zb) return za.localeCompare(zb);
      return (stores[a].addr||'').localeCompare(stores[b].addr||'');
    }
    const sa=stockStatus(clamp(stores[a].S_jun),clamp(stores[a].M_jun));
    const sb=stockStatus(clamp(stores[b].S_jun),clamp(stores[b].M_jun));
    if (sa!==sb) return statusOrder[sa]-statusOrder[sb];
    return a-b;
  });

  // Secondary pass: whatever still needs attention (an in-flight
  // delivery, or low/urgent stock with nothing queued) floats to the
  // top; stores that are done sink to the bottom. Array.sort is
  // stable, so within each group the primary sort order above holds —
  // this just re-groups it as deliveries get updated.
  filtered.sort((a, b) => {
    const na = storeNeedsAttention(a) ? 0 : 1;
    const nb = storeNeedsAttention(b) ? 0 : 1;
    return na - nb;
  });

  currentFilteredStoreIds = filtered; // for the "Route for this view" button

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
    const done = !storeNeedsAttention(id);

    const detail = stockStatusDetail(js, jm);
    const badgeClass = detail.code === 'ok' ? 'badge-ok'
                      : detail.code.includes('out') ? 'badge-urgent'
                      : 'badge-low';
    const badge = `<span class="badge ${badgeClass}">${detail.label}</span>`;

    function skuEl(v) {
      const c = v===0 ? 'sku-zero' : v<LOW_STOCK_THRESHOLD ? 'sku-low' : 'sku-ok';
      return `<span class="sku ${c}">${v}</span>`;
    }
    function dEl(v) {
      return v>0 ? `<span class="delta delta-up">+${v}</span>`
           : v<0 ? `<span class="delta delta-dn">${v}</span>`
           : `<span class="delta delta-nc">—</span>`;
    }

    const restockLine = d.lastRestockedAt
      ? `<small style="color:var(--ink3);display:block;">Last restocked ${fmtDate(d.lastRestockedAt)}${d.lastRestockNote ? ' — '+d.lastRestockNote : ''}</small>`
      : '';

    return `<tr${done ? ' style="opacity:0.6;"' : ''}>
      <td><strong>#${id}</strong></td>
      <td class="addr-cell">${d.addr}</td>
      <td>${d.city}, VA ${d.zip}</td>
      <td>${badge}</td>
      <td>${skuEl(js)}</td>
      <td>${skuEl(jm)}</td>
      <td>${dEl(dS)} / ${dEl(dM)}</td>
      <td class="action-cell" style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
        ${gpsLinkHtml(d.addr, d.city, d.zip)}
        ${renderInvDeliveryControls(id)}
        ${restockLine}
      </td>
    </tr>`;
  }).join('');
}

// ── Queue single store from inventory ─────────────────────────
// Only proposes the SKU(s) actually low/out — if spicy is well
// stocked, it won't force a spicy case into the delivery just
// because mild needs one, and vice versa. If the store's fine on
// both (rare reason to hit Queue), it falls back to a 1/1 top-up.
async function queueDelivery(storeId) {
  const d = stores[storeId]; if (!d) return;
  const s = clamp(d.S_jun), m = clamp(d.M_jun);
  const st = stockStatus(s, m);

  let spicyQty = s === 0 ? 2 : s <= 3 ? 1 : 0;
  let mildQty  = m === 0 ? 2 : m <= 3 ? 1 : 0;
  if (spicyQty === 0 && mildQty === 0) { spicyQty = 1; mildQty = 1; }

  const autoNote = st === 'urgent' ? 'Urgent restock — both SKUs out'
                 : st === 'low'    ? 'Low stock restock'
                 : '';
  const rec = {
    id: String(Date.now()),
    storeId, addr:d.addr, city:d.city, zip:d.zip,
    spicy:spicyQty, mild:mildQty, driver:'', date:today(),
    status:'pending', notes:autoNote,
    appliedSpicy:0, appliedMild:0,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  };
  deliveries.unshift(rec);
  saveDeliveriesLocal();
  await sheetAddDelivery(rec);
  renderInventory();
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

// Inject a small action toolbar above the table once. Buttons act on
// whatever is currently visible (currentFilteredDeliveries), so they
// respect the active status/date filters.
function ensureDeliveryToolbar() {
  if (document.getElementById('del-toolbar')) return;
  const stats = document.getElementById('del-stats');
  if (!stats) return;
  const bar = document.createElement('div');
  bar.id = 'del-toolbar';
  bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0;';
  bar.innerHTML = `
    <button class="btn-xs btn-queue" onclick="openRouteForFiltered()">🗺️ Route (filtered)</button>
    <button class="btn-xs btn-update" onclick="bulkUpdateFiltered('out')">🚚 Mark filtered Out</button>
    <button class="btn-xs btn-queue" onclick="bulkUpdateFiltered('delivered')">✅ Mark filtered Delivered (both SKUs)</button>
    <button class="btn-xs btn-del" onclick="bulkUpdateFiltered('failed')">❌ Mark filtered Failed</button>
  `;
  stats.insertAdjacentElement('afterend', bar);
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

  ensureDeliveryToolbar();

  let filtered = deliveries.filter(d => {
    if (delFilter!=='all' && d.status!==delFilter) return false;
    if (dateF==='today' && d.date!==today()) return false;
    if (dateF==='week'  && !isThisWeek(d.date))  return false;
    if (dateF==='month' && !isThisMonth(d.date)) return false;
    return true;
  });

  currentFilteredDeliveries = filtered; // for toolbar bulk actions

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
      <td class="action-cell" style="display:flex;flex-direction:column;gap:6px;min-width:180px;">
        ${renderDeliveryActionButtons(d)}
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
          ${gpsLinkHtml(d.addr, d.city, d.zip)}
          <button class="btn-xs btn-update" onclick="openStatusModal('${d.id}')" title="Edit driver / notes / quantities">✎</button>
          <button class="btn-xs btn-del" onclick="deleteDelivery('${d.id}')" title="Delete">×</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── One-tap status update (no modal) ───────────────────────────
// delivered = {spicy: bool, mild: bool} — which SKU(s) actually went
// out. Whichever is false gets zeroed before stock/sale are updated,
// so partial deliveries record correctly. Reconciles the store's
// live stock either way (adds on delivered, reverses otherwise).
async function quickUpdateStatus(delivId, status, delivered = null) {
  const d = deliveries.find(x => String(x.id)===String(delivId));
  if (!d) return;
  d.status    = status;
  d.updatedAt = new Date().toISOString();

  if (status === 'delivered' && delivered) {
    if (!delivered.spicy) d.spicy = 0;
    if (!delivered.mild)  d.mild  = 0;
  }

  await reconcileDeliveryStock(d, status === 'delivered');

  saveDeliveriesLocal();
  await sheetUpdateDelivery(d);

  if (status === 'delivered') {
    const sale = buildSaleRecord(d);
    const sales = JSON.parse(localStorage.getItem('ac_sales')||'[]');
    const idx   = sales.findIndex(s=>String(s.deliveryId)===String(d.id));
    if (idx>=0) sales[idx]=sale; else sales.unshift(sale);
    localStorage.setItem('ac_sales', JSON.stringify(sales));
    await sheetAddSale(sale);
  }

  renderInventory();
  renderDeliveries();
  renderSales();
}

// ── Bulk update everything currently visible in the Deliveries tab ──
// Note: the bulk "Delivered" action records BOTH SKUs for every row —
// for partial deliveries, use the per-row big buttons instead.
async function bulkUpdateFiltered(status) {
  const list = currentFilteredDeliveries.filter(d=>d.status!==status);
  if (!list.length) { alert('Nothing to update in the current view.'); return; }
  if (!confirm(`Mark ${list.length} filtered deliveries as "${status}"?`)) return;

  for (const d of list) {
    d.status    = status;
    d.updatedAt = new Date().toISOString();
    await reconcileDeliveryStock(d, status === 'delivered');
  }
  saveDeliveriesLocal();
  await Promise.all(list.map(d=>sheetUpdateDelivery(d)));

  if (status === 'delivered') {
    const sales = JSON.parse(localStorage.getItem('ac_sales')||'[]');
    for (const d of list) {
      const sale = buildSaleRecord(d);
      const idx  = sales.findIndex(s=>String(s.deliveryId)===String(d.id));
      if (idx>=0) sales[idx]=sale; else sales.unshift(sale);
      await sheetAddSale(sale);
    }
    localStorage.setItem('ac_sales', JSON.stringify(sales));
  }

  renderInventory();
  renderDeliveries();
  renderSales();
}

// ── Multi-stop route for whatever's currently in view ───────────
function openRouteForFiltered() {
  const stops = currentFilteredDeliveries.filter(d=>d.status==='pending'||d.status==='out');
  if (!stops.length) { alert('No pending/out deliveries in the current view to route.'); return; }
  if (stops.length > 23) alert('Route link is capped at 23 stops — using the first 23 in view.');
  const addrs = stops.map(d=>`${d.addr}, ${d.city}, VA ${d.zip}`);
  window.open(buildRouteUrl(addrs), '_blank');
}

// ── Status update modal (full edit: driver, notes, quantities) ──
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

  await reconcileDeliveryStock(d, newStatus === 'delivered');

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

  renderInventory();
  renderDeliveries();
  renderSales();
  closeModal('status-modal');
}

async function deleteDelivery(delivId) {
  if (!confirm('Remove this delivery record?')) return;
  const d = deliveries.find(x => String(x.id)===String(delivId));
  if (d) await reconcileDeliveryStock(d, false); // undo any stock it had already applied
  deliveries = deliveries.filter(x => String(x.id)!==String(delivId));
  saveDeliveriesLocal();
  await sheetDeleteDelivery(delivId);
  renderInventory();
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
    // GPS link is a sibling of the label (not nested inside it) so
    // tapping it opens Maps instead of toggling the checkbox.
    return `<div class="store-check-item" style="display:flex;align-items:center;gap:8px;">
      <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer;">
        <input type="checkbox" value="${id}" ${pre?'checked':''}>
        <span>${em} #${id} — ${d.addr}, ${d.city}</span>
        <small>Spicy:${s} Mild:${m}</small>
      </label>
      ${gpsLinkHtml(d.addr, d.city, d.zip)}
    </div>`;
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
      appliedSpicy:0, appliedMild:0,
      createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    };
  });

  deliveries.unshift(...newRecs);
  saveDeliveriesLocal();
  await Promise.all(newRecs.map(r=>sheetAddDelivery(r)));
  renderInventory();
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

// Add a "Detail (editable)" option to the existing group-by select if
// it's not already there. Safe/idempotent — just extends whatever
// dropdown your HTML already has, no markup assumptions beyond that.
function ensureSalesGroupDetailOption() {
  const sg = document.getElementById('sales-group');
  if (!sg || sg.querySelector('option[value="detail"]')) return;
  sg.insertAdjacentHTML('beforeend', `<option value="detail">Detail (editable)</option>`);
}

function renderSales() {
  ensureSalesGroupDetailOption();

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
  } else if (groupBy==='detail') {
    // Individual, editable sale records — not aggregated.
    const rows = filtered.slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
    thead.innerHTML = `<th>Date</th><th>Store</th><th>🌶️ Spicy</th><th>🧡 Mild</th><th>Driver</th><th>Revenue</th><th>Gross profit</th><th>Actions</th>`;
    tbody.innerHTML = rows.map(r=>{
      const st = stores[r.storeId] || {};
      return `<tr>
        <td>${fmtDate(r.date)}</td>
        <td><strong>#${r.storeId}</strong>${st.addr ? ' — '+st.addr : ''}</td>
        <td>${r.spicyCases}</td>
        <td>${r.mildCases}</td>
        <td>${r.driver || '<span style="color:var(--ink4)">—</span>'}</td>
        <td class="num-cell">${fmtCur(r.revenue)}</td>
        <td class="num-cell green-text">${fmtCur(r.grossProfit)}</td>
        <td class="action-cell">
          <button class="btn-xs btn-update" onclick="openSaleEditModal('${r.deliveryId}')" title="Edit">✎</button>
          <button class="btn-xs btn-del" onclick="deleteSaleRecord('${r.deliveryId}')" title="Delete">×</button>
        </td>
      </tr>`;
    }).join('');
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

// ── Sales record edit modal (built entirely in JS, no HTML dependency) ──
function ensureSalesEditModal() {
  if (document.getElementById('sale-edit-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'sale-edit-modal';
  modal.style.cssText = `
    display:none; position:fixed; inset:0; background:rgba(0,0,0,0.5);
    z-index:9999; align-items:center; justify-content:center;
  `;
  modal.innerHTML = `
    <div style="background:var(--bg,#fff); color:var(--ink,#111); padding:20px; border-radius:10px; width:320px; max-width:90vw; font-family:inherit;">
      <h3 style="margin:0 0 12px;">Edit sale record</h3>
      <label style="display:block;margin-bottom:8px;font-size:13px;">Date<br>
        <input id="se-date" type="date" style="width:100%;padding:6px;box-sizing:border-box;">
      </label>
      <label style="display:block;margin-bottom:8px;font-size:13px;">Driver<br>
        <input id="se-driver" type="text" style="width:100%;padding:6px;box-sizing:border-box;">
      </label>
      <label style="display:block;margin-bottom:8px;font-size:13px;">Spicy cases<br>
        <input id="se-spicy" type="number" min="0" style="width:100%;padding:6px;box-sizing:border-box;">
      </label>
      <label style="display:block;margin-bottom:8px;font-size:13px;">Mild cases<br>
        <input id="se-mild" type="number" min="0" style="width:100%;padding:6px;box-sizing:border-box;">
      </label>
      <small style="color:#888;display:block;margin-bottom:10px;">
        Revenue and profit recalculate from these counts. This only
        corrects the sales record — it won't change today's live stock.
      </small>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn-xs" onclick="closeSaleEditModal()">Cancel</button>
        <button class="btn-xs btn-queue" onclick="saveSaleEdit()">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function openSaleEditModal(deliveryId) {
  ensureSalesEditModal();
  const all = JSON.parse(localStorage.getItem('ac_sales')||'[]');
  const sale = all.find(s=>String(s.deliveryId)===String(deliveryId));
  if (!sale) return;
  currentEditSaleId = deliveryId;
  document.getElementById('se-date').value   = sale.date || today();
  document.getElementById('se-driver').value = sale.driver || '';
  document.getElementById('se-spicy').value  = sale.spicyCases || 0;
  document.getElementById('se-mild').value   = sale.mildCases  || 0;
  document.getElementById('sale-edit-modal').style.display = 'flex';
}

function closeSaleEditModal() {
  const m = document.getElementById('sale-edit-modal');
  if (m) m.style.display = 'none';
  currentEditSaleId = null;
}

async function saveSaleEdit() {
  if (!currentEditSaleId) return;
  const all = JSON.parse(localStorage.getItem('ac_sales')||'[]');
  const idx = all.findIndex(s=>String(s.deliveryId)===String(currentEditSaleId));
  if (idx < 0) return;

  const spicy = parseInt(document.getElementById('se-spicy').value) || 0;
  const mild  = parseInt(document.getElementById('se-mild').value)  || 0;
  const cases = spicy + mild;

  all[idx] = {
    ...all[idx],
    date:   document.getElementById('se-date').value || all[idx].date,
    driver: document.getElementById('se-driver').value.trim(),
    spicyCases: spicy,
    mildCases:  mild,
    totalCases: cases,
    spicyUnits: spicy*PRICING.unitsPerCase,
    mildUnits:  mild*PRICING.unitsPerCase,
    revenue:     cases*PRICING.casePrice,
    cogs:        cases*PRICING.unitsPerCase*PRICING.unitCost,
    grossProfit: (cases*PRICING.casePrice)-(cases*PRICING.unitsPerCase*PRICING.unitCost)-PRICING.deliveryFeePerVisit,
  };
  localStorage.setItem('ac_sales', JSON.stringify(all));

  if (typeof sheetUpdateSale === 'function') {
    try { await sheetUpdateSale(all[idx]); } catch(e) { /* best effort — no backend hook yet */ }
  }

  closeSaleEditModal();
  renderSales();
}

async function deleteSaleRecord(deliveryId) {
  if (!confirm('Delete this sale record? This only removes it from Sales History — it will not change the original delivery.')) return;
  let all = JSON.parse(localStorage.getItem('ac_sales')||'[]');
  const rec = all.find(s=>String(s.deliveryId)===String(deliveryId));
  all = all.filter(s=>String(s.deliveryId)!==String(deliveryId));
  localStorage.setItem('ac_sales', JSON.stringify(all));

  if (typeof sheetDeleteSale === 'function' && rec) {
    try { await sheetDeleteSale(rec); } catch(e) { /* best effort — no backend hook yet */ }
  }

  renderSales();
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
  populateCityDropdown(); // a manually-added store can introduce a new city
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
  urgent.forEach(id=>{const d=stores[id];txt+=`#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n  📍 ${mapsUrl(id)}\n`;});
  txt += `\n🟡 LOW STOCK — ONE SKU <${LOW_STOCK_THRESHOLD} (${low.length} stores)\n${'—'.repeat(40)}\n`;
  low.forEach(id=>{const d=stores[id];txt+=`#${id} | ${d.addr}, ${d.city}, VA ${d.zip}\n  📍 ${mapsUrl(id)}\n  Spicy:${clamp(d.S_jun)} Mild:${clamp(d.M_jun)}\n`;});
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
  // Reset any pre-existing file-upload UI, if your HTML has one — all
  // guarded, so this is a no-op if those elements don't exist.
  const area = document.getElementById('parse-drop-area');
  if (area) { area.style.borderColor=''; area.style.background=''; }
  const fileInput = document.getElementById('report-file-input');
  if (fileInput) fileInput.value = '';
  const existingModal = document.getElementById('upload-modal');
  if (existingModal) existingModal.classList.add('open');

  // Self-contained paste-based import — independent of whatever your
  // existing upload-modal's internal structure looks like.
  openPasteReportModal();
}


// ── Import modal tab switcher ─────────────────────────────────
function switchImportTab(name, el) {
  document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.import-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('import-tab-' + name).classList.add('active');
}

function clearParseState() {
  // Legacy elements from any pre-existing file-upload UI, if present.
  const status  = document.getElementById('parse-status');
  const summary = document.getElementById('parse-summary');
  if (status)  status.textContent = '';
  if (summary) { summary.style.display = 'none'; summary.innerHTML = ''; }

  // This feature's own self-contained elements.
  const prStatus  = document.getElementById('pr-status');
  const prSummary = document.getElementById('pr-summary');
  const prTextarea = document.getElementById('pr-textarea');
  if (prStatus)  prStatus.textContent = '';
  if (prSummary) { prSummary.style.display = 'none'; prSummary.innerHTML = ''; }
  if (prTextarea) prTextarea.value = '';

  pendingReportUpdates = null;
}

// ══════════════════════════════════════════════════════════════
// MODAL HELPERS
// ══════════════════════════════════════════════════════════════
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ── Boot
window.addEventListener('DOMContentLoaded', boot);
