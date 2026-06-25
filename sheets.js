// ============================================================
// GOOGLE SHEETS BACKEND  — sheets.js
// ============================================================
// Your Apps Script Web App URL is already set below.
// If you ever redeploy the script and get a new URL,
// update SHEET_URL here and push to GitHub.
// ============================================================

const SHEET_URL = 'https://script.google.com/macros/s/AKfycbyBLxa6MIICHmPwFSk1Ip_-nvOe4ZRkX-PBeKybVBTiwloqsyXMw90FheBasVbJ15nUkQ/exec';

const SHEET_CONFIGURED = SHEET_URL.startsWith('https://script.google.com');

// ── Sync status UI ───────────────────────────────────────────
function setSyncStatus(state, msg) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-lbl');
  if (!dot || !lbl) return;
  dot.className = 'sync-dot ' + state;
  lbl.textContent = msg;
}

// ── Test connection (called from the UI test button) ─────────
async function testSheetConnection() {
  setSyncStatus('busy', 'Testing…');
  const banner = document.getElementById('config-banner');
  try {
    // GET request — Apps Script handles this without CORS issues
    const res = await fetch(SHEET_URL + '?action=ping', { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.ok) {
      setSyncStatus('ok', 'Connected ✓');
      if (banner) {
        banner.style.background = '#e6f4ec';
        banner.style.borderColor = '#a3d4b5';
        banner.innerHTML = `<strong>✅ Google Sheets connected!</strong> All delivery updates sync in real time.`;
      }
    } else {
      throw new Error(JSON.stringify(json));
    }
  } catch (e) {
    setSyncStatus('err', 'Connection failed');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <strong>⚠️ Could not reach Google Sheets.</strong>
        Most common cause: the Apps Script was not deployed with <em>"Who has access: Anyone"</em>.<br><br>
        <strong>Fix in 2 minutes:</strong><br>
        1. Open <a href="https://script.google.com" target="_blank">script.google.com</a> → find your project<br>
        2. Click <strong>Deploy → Manage Deployments</strong><br>
        3. Edit the deployment → set <strong>Who has access → Anyone</strong> → click Deploy<br>
        4. Copy the new URL, update <code>SHEET_URL</code> in <code>sheets.js</code>, push to GitHub<br><br>
        <em>Error detail: ${e.message}</em><br>
        <button onclick="testSheetConnection()" style="margin-top:8px;padding:4px 12px;cursor:pointer;border-radius:5px;border:1px solid #ccc">Retry connection</button>
      `;
    }
    console.error('Sheet connection error:', e);
  }
}

// ── Generic POST to Apps Script ───────────────────────────────
// Uses Content-Type: text/plain to avoid CORS preflight
async function sheetRequest(action, payload = {}) {
  if (!SHEET_CONFIGURED) return null;
  setSyncStatus('busy', 'Syncing…');
  try {
    const res = await fetch(SHEET_URL + '?action=' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    setSyncStatus('ok', 'Synced ✓');
    return json;
  } catch (e) {
    setSyncStatus('err', 'Sync error');
    console.error('sheetRequest error:', action, e);
    return null;
  }
}

// ── Generic GET from Apps Script ──────────────────────────────
async function sheetGet(action) {
  if (!SHEET_CONFIGURED) return null;
  setSyncStatus('busy', 'Loading…');
  try {
    const res = await fetch(SHEET_URL + '?action=' + action, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    setSyncStatus('ok', 'Synced ✓');
    return json.data || [];
  } catch (e) {
    setSyncStatus('err', 'Load error');
    console.error('sheetGet error:', action, e);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────
async function sheetGetDeliveries()       { return sheetGet('getDeliveries'); }
async function sheetGetSales()            { return sheetGet('getSales'); }
async function sheetAddDelivery(rec)      { return sheetRequest('addDelivery', rec); }
async function sheetUpdateDelivery(rec)   { return sheetRequest('updateDelivery', rec); }
async function sheetDeleteDelivery(id)    { return sheetRequest('deleteDelivery', { id }); }
async function sheetAddSale(rec)          { return sheetRequest('addSale', rec); }
async function sheetAddStore(rec)         { return sheetRequest('addStore', rec); }
