// ============================================================
// GOOGLE SHEETS BACKEND  — sheets.js
// ============================================================
// HOW TO SET UP (one-time, ~10 minutes):
//
// 1. Open your Google Sheet:
//    https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID
//    Create THREE tabs named exactly:
//      Deliveries | Sales | Stores
//
// 2. In the Sheet, go to Extensions → Apps Script
//    Paste the code from google-apps-script.js into the editor
//    Click Save, then Deploy → New Deployment → Web App
//    Set "Who has access" to "Anyone"  (no sign-in needed for your Netlify app)
//    Copy the Web App URL — it looks like:
//    https://script.google.com/macros/s/AKfycb.../exec
//
// 3. Paste that URL into SHEET_URL below and push to GitHub.
//    Netlify redeploys automatically.
//
// 4. That's it. Every status update, new delivery, and
//    completed sale now writes directly to your Sheet in real time.
// ============================================================

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyLD-WlibU4daMR5Idw9OhPhATzUE2o_KSF3zysGghf0dsfRmk5hIIF87y7HXtPWj_JAw/exec';
// Example: 'https://script.google.com/macros/s/AKfycbyBLxa.../exec'

const SHEET_CONFIGURED = SHEET_URL !== 'https://script.google.com/macros/s/AKfycbyLD-WlibU4daMR5Idw9OhPhATzUE2o_KSF3zysGghf0dsfRmk5hIIF87y7HXtPWj_JAw/exec';

// ── Sync status UI ───────────────────────────────────────────
function setSyncStatus(state, msg) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-lbl');
  if (!dot || !lbl) return;
  dot.className = 'sync-dot ' + state;
  lbl.textContent = msg;
}

// ── Generic fetch wrapper ────────────────────────────────────
async function sheetRequest(action, payload = {}) {
  if (!SHEET_CONFIGURED) return null;
  setSyncStatus('busy', 'Syncing…');
  try {
    const url = SHEET_URL + '?action=' + action;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSyncStatus('ok', 'Synced');
    return json;
  } catch (e) {
    setSyncStatus('err', 'Sync error');
    console.error('Sheet error:', e);
    return null;
  }
}

// ── READ all deliveries from Sheet ───────────────────────────
async function sheetGetDeliveries() {
  if (!SHEET_CONFIGURED) return null;
  setSyncStatus('busy', 'Loading…');
  try {
    const res = await fetch(SHEET_URL + '?action=getDeliveries');
    const json = await res.json();
    setSyncStatus('ok', 'Synced');
    return json.data || [];
  } catch (e) {
    setSyncStatus('err', 'Load error');
    return null;
  }
}

// ── READ all sales from Sheet ────────────────────────────────
async function sheetGetSales() {
  if (!SHEET_CONFIGURED) return null;
  try {
    const res = await fetch(SHEET_URL + '?action=getSales');
    const json = await res.json();
    return json.data || [];
  } catch (e) { return null; }
}

// ── WRITE a new delivery row ─────────────────────────────────
async function sheetAddDelivery(record) {
  return sheetRequest('addDelivery', record);
}

// ── UPDATE a delivery row ────────────────────────────────────
async function sheetUpdateDelivery(record) {
  return sheetRequest('updateDelivery', record);
}

// ── DELETE a delivery row ────────────────────────────────────
async function sheetDeleteDelivery(id) {
  return sheetRequest('deleteDelivery', { id });
}

// ── WRITE a sale row (called automatically on "Delivered") ───
async function sheetAddSale(record) {
  return sheetRequest('addSale', record);
}

// ── WRITE a store override (new store added via UI) ──────────
async function sheetAddStore(record) {
  return sheetRequest('addStore', record);
}
