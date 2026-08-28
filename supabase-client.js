// ============================================================
// AUNT CAROL'S SAUCE — SUPABASE DATA LAYER  v2
// Replaces the Google Sheets Apps Script backend as the app's live,
// real-time data source. Still writes to the old Sheet too (best
// effort, one-way, non-blocking) so it keeps working as a human-
// readable backup/export — but the app never READS from Sheets again,
// which is what avoids the sync-conflict/stale-overwrite bugs from
// earlier in this build.
//
// v2 fix: the client instance is now named `sb`, not `supabase` — the
// CDN library itself declares a global `var supabase`, and you can't
// also declare `const supabase` in the same scope (that's the
// "Identifier 'supabase' has already been declared" SyntaxError).
// v2 fix: setSyncStatus() now targets the real element id `sync-lbl`
// (was incorrectly `sync-label`, which silently did nothing).
// ============================================================

const SUPABASE_URL = 'https://fsyypypudlaaretqkzwj.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PjS3uIMy8vKwRyGnwcKJuQ_jLceCG03';

const SHEET_CONFIGURED = true; // gates sync-dot/boot behavior in app-logic.js
const SHEET_URL = '';          // paste your EXISTING Apps Script URL here to keep the write-only backup mirror; leave blank to skip it entirely

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Connection test / sync indicator ──────────────────────────
async function testSheetConnection() {
  setSyncStatus('busy', 'Connecting…');
  try {
    const { error } = await sb.from('stores').select('store_id').limit(1);
    if (error) throw error;
    setSyncStatus('ok', 'Connected');
  } catch (e) {
    console.error('Supabase connection failed:', e);
    setSyncStatus('err', 'Connection failed');
  }
}

function setSyncStatus(state, label) {
  const dot = document.getElementById('sync-dot');
  const text = document.getElementById('sync-lbl');
  if (dot) dot.className = 'sync-dot ' + state; // ok | busy | err
  if (text) text.textContent = label || '';
}

// ── Best-effort, write-only mirror to the old Google Sheet ─────
// Fire-and-forget: never awaited by anything that matters, never
// allowed to throw out to a caller, never used as a read source.
function mirrorToSheet(action, payload) {
  if (!SHEET_URL) return;
  fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids a CORS preflight on Apps Script
    body: JSON.stringify({ action, ...payload }),
  }).catch(e => console.warn('Sheet mirror failed (non-fatal):', action, e));
}

// ── Field mapping: JS camelCase <-> Postgres snake_case ────────
function deliveryToRow(d) {
  return {
    id: d.id, store_id: String(d.storeId), addr: d.addr, city: d.city, zip: d.zip,
    spicy: d.spicy, mild: d.mild, driver: d.driver, date: d.date,
    status: d.status, notes: d.notes,
    applied_spicy: d.appliedSpicy || 0, applied_mild: d.appliedMild || 0,
    created_at: d.createdAt, updated_at: d.updatedAt,
  };
}
function rowToDelivery(r) {
  return {
    id: r.id, storeId: Number(r.store_id), addr: r.addr, city: r.city, zip: r.zip,
    spicy: r.spicy, mild: r.mild, driver: r.driver, date: r.date,
    status: r.status, notes: r.notes,
    appliedSpicy: r.applied_spicy, appliedMild: r.applied_mild,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function saleToRow(s) {
  return {
    delivery_id: s.deliveryId, store_id: String(s.storeId), addr: s.addr, city: s.city, zip: s.zip,
    driver: s.driver, date: s.date,
    spicy_cases: s.spicyCases, mild_cases: s.mildCases, total_cases: s.totalCases,
    spicy_units: s.spicyUnits, mild_units: s.mildUnits,
    revenue: s.revenue, cogs: s.cogs, delivery_fee: s.deliveryFee, gross_profit: s.grossProfit,
    recorded_at: s.recordedAt,
  };
}
function rowToSale(r) {
  return {
    deliveryId: r.delivery_id, storeId: Number(r.store_id), addr: r.addr, city: r.city, zip: r.zip,
    driver: r.driver, date: r.date,
    spicyCases: r.spicy_cases, mildCases: r.mild_cases, totalCases: r.total_cases,
    spicyUnits: r.spicy_units, mildUnits: r.mild_units,
    revenue: r.revenue, cogs: r.cogs, deliveryFee: r.delivery_fee, grossProfit: r.gross_profit,
    recordedAt: r.recorded_at,
  };
}
function storeToRow(storeId, s) {
  return {
    store_id: String(storeId), addr: s.addr, city: s.city, zip: s.zip,
    s_may: s.S_may || 0, m_may: s.M_may || 0, s_jun: s.S_jun || 0, m_jun: s.M_jun || 0,
    last_restocked_at: s.lastRestockedAt || null, last_restock_note: s.lastRestockNote || null,
  };
}
function rowToStore(r) {
  return {
    storeId: r.store_id, addr: r.addr, city: r.city, zip: r.zip,
    S_may: r.s_may, M_may: r.m_may, S_jun: r.s_jun, M_jun: r.m_jun,
    lastRestockedAt: r.last_restocked_at, lastRestockNote: r.last_restock_note,
  };
}

// ── Stores ──────────────────────────────────────────────────
async function supabaseGetStores() {
  try {
    const { data, error } = await sb.from('stores').select('*');
    if (error) throw error;
    return (data || []).map(rowToStore);
  } catch (e) {
    console.error('supabaseGetStores failed:', e);
    return [];
  }
}

async function sheetAddStore(storeObj) {
  const { storeId, ...rest } = storeObj;
  const row = storeToRow(storeId, rest);
  try {
    const { error } = await sb.from('stores').upsert(row, { onConflict: 'store_id' });
    if (error) throw error;
  } catch (e) {
    console.error('sheetAddStore (Supabase) failed:', e);
  }
  mirrorToSheet('addStore', { storeId, ...rest });
}

// ── Deliveries ──────────────────────────────────────────────
async function sheetGetDeliveries() {
  try {
    const { data, error } = await sb.from('deliveries').select('*');
    if (error) throw error;
    return (data || []).map(rowToDelivery);
  } catch (e) {
    console.error('sheetGetDeliveries (Supabase) failed:', e);
    return null;
  }
}

async function sheetAddDelivery(rec) {
  try {
    const { error } = await sb.from('deliveries').insert(deliveryToRow(rec));
    if (error) throw error;
  } catch (e) {
    console.error('sheetAddDelivery (Supabase) failed:', e);
  }
  mirrorToSheet('addDelivery', rec);
}

async function sheetUpdateDelivery(d) {
  try {
    const { error } = await sb.from('deliveries').update(deliveryToRow(d)).eq('id', d.id);
    if (error) throw error;
  } catch (e) {
    console.error('sheetUpdateDelivery (Supabase) failed:', e);
  }
  mirrorToSheet('updateDelivery', d);
}

async function sheetDeleteDelivery(delivId) {
  try {
    const { error } = await sb.from('deliveries').delete().eq('id', delivId);
    if (error) throw error;
  } catch (e) {
    console.error('sheetDeleteDelivery (Supabase) failed:', e);
  }
  mirrorToSheet('deleteDelivery', { id: delivId });
}

// ── Sales ───────────────────────────────────────────────────
async function sheetGetSales() {
  try {
    const { data, error } = await sb.from('sales').select('*');
    if (error) throw error;
    return (data || []).map(rowToSale);
  } catch (e) {
    console.error('sheetGetSales (Supabase) failed:', e);
    return null;
  }
}

async function sheetAddSale(sale) {
  try {
    const { error } = await sb.from('sales').upsert(saleToRow(sale), { onConflict: 'delivery_id' });
    if (error) throw error;
  } catch (e) {
    console.error('sheetAddSale (Supabase) failed:', e);
  }
  mirrorToSheet('addSale', sale);
}

// ── Realtime: push updates to every open browser ────────────
function initSupabaseRealtime() {
  sb
    .channel('aunt-carols-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' },     () => refreshFromSheet())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'deliveries' }, () => refreshFromSheet())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' },      () => refreshFromSheet())
    .subscribe();
}

// ============================================================
// TWO SMALL CHANGES STILL NEEDED IN app.js (if not already done):
//
// 1. Inside refreshFromSheet(), replace the raw fetch for stores with:
//      supabaseGetStores()
//
// 2. Inside boot(), right after startAutoSync(), add:
//      initSupabaseRealtime();
// ============================================================
