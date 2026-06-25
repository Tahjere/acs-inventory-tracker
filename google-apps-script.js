// ============================================================
// GOOGLE APPS SCRIPT  —  paste this into Extensions → Apps Script
// in your Google Sheet, then Deploy as a Web App (access: Anyone)
//
// Sheet tabs required:
//   Deliveries  |  Sales  |  Stores
// ============================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

// Column order for Deliveries sheet
const DEL_COLS = [
  'id','storeId','addr','city','zip',
  'spicy','mild','driver','date',
  'status','notes','createdAt','updatedAt'
];

// Column order for Sales sheet
const SALE_COLS = [
  'deliveryId','storeId','addr','city','zip','driver','date',
  'spicyCases','mildCases','totalCases','spicyUnits','mildUnits',
  'revenue','cogs','deliveryFee','grossProfit','recordedAt'
];

// Column order for Stores sheet
const STORE_COLS = [
  'storeId','addr','city','zip','S_may','M_may','S_jun','M_jun','addedAt'
];

// ── Router ───────────────────────────────────────────────────
function doGet(e)  { return route(e); }
function doPost(e) { return route(e); }

function route(e) {
  const action = e.parameter.action || 'ping';
  const body   = e.postData ? JSON.parse(e.postData.contents || '{}') : {};

  const handlers = {
    ping:            () => ({ ok: true }),
    getDeliveries:   () => ({ data: readSheet('Deliveries', DEL_COLS) }),
    getSales:        () => ({ data: readSheet('Sales', SALE_COLS) }),
    getStores:       () => ({ data: readSheet('Stores', STORE_COLS) }),
    addDelivery:     () => appendRow('Deliveries', DEL_COLS, body),
    updateDelivery:  () => updateRow('Deliveries', DEL_COLS, body),
    deleteDelivery:  () => deleteRow('Deliveries', body.id),
    addSale:         () => appendRow('Sales', SALE_COLS, body),
    addStore:            () => appendRow('Stores', STORE_COLS, body),
    bulkUpdateInventory: () => bulkUpdateStores(body.stores || []),
  };

  const fn = handlers[action];
  const result = fn ? fn() : { error: 'Unknown action: ' + action };
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet helpers ─────────────────────────────────────────────
function getSheet(name) {
  let sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
  }
  // Write headers if empty
  if (sheet.getLastRow() === 0) {
    const cols = name === 'Deliveries' ? DEL_COLS
               : name === 'Sales'      ? SALE_COLS
               : STORE_COLS;
    sheet.appendRow(cols);
  }
  return sheet;
}

function readSheet(name, cols) {
  const sheet = getSheet(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const data = sheet.getRange(2, 1, lastRow - 1, cols.length).getValues();
  return data
    .filter(row => row[0] !== '')
    .map(row => {
      const obj = {};
      cols.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
}

function appendRow(name, cols, data) {
  const sheet = getSheet(name);
  const row = cols.map(col => data[col] !== undefined ? data[col] : '');
  sheet.appendRow(row);
  return { ok: true };
}

function updateRow(name, cols, data) {
  const sheet = getSheet(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false, error: 'No data' };
  const idCol = 1; // 'id' is first column
  const ids = sheet.getRange(2, idCol, lastRow - 1, 1).getValues().flat();
  const rowIdx = ids.findIndex(v => String(v) === String(data.id));
  if (rowIdx === -1) return { ok: false, error: 'Row not found' };
  const sheetRow = rowIdx + 2;
  const row = cols.map(col => data[col] !== undefined ? data[col] : '');
  sheet.getRange(sheetRow, 1, 1, cols.length).setValues([row]);
  return { ok: true };
}

function deleteRow(name, id) {
  const sheet = getSheet(name);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: false };
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  const rowIdx = ids.findIndex(v => String(v) === String(id));
  if (rowIdx === -1) return { ok: false, error: 'Not found' };
  sheet.deleteRow(rowIdx + 2);
  return { ok: true };
}

// ── Bulk update/insert inventory from a parsed report ─────────
function bulkUpdateStores(storeList) {
  const sheet = getSheet('Stores');
  const lastRow = sheet.getLastRow();

  // Build a map of existing storeId → sheet row number
  const existingIds = lastRow >= 2
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String)
    : [];

  const now = new Date().toISOString();

  storeList.forEach(s => {
    const idStr = String(s.storeId);
    const rowData = STORE_COLS.map(col => {
      if (col === 'storeId')  return s.storeId;
      if (col === 'addedAt')  return s.updatedAt || now;
      return s[col] !== undefined ? s[col] : '';
    });

    const existingIdx = existingIds.indexOf(idStr);
    if (existingIdx >= 0) {
      // Update existing row
      sheet.getRange(existingIdx + 2, 1, 1, STORE_COLS.length).setValues([rowData]);
    } else {
      // Append new store
      sheet.appendRow(rowData);
      existingIds.push(idStr);
    }
  });

  // Also write a report log entry to a "Reports" tab
  const logSheet = SS.getSheetByName('Reports') || SS.insertSheet('Reports');
  if (logSheet.getLastRow() === 0) {
    logSheet.appendRow(['timestamp','fileName','storesUpdated','reportLabel']);
  }
  logSheet.appendRow([now, storeList[0]?.reportLabel || 'report', storeList.length, storeList[0]?.reportLabel || '']);

  return { ok: true, updated: storeList.length };
}
