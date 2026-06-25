// ============================================================
// AUNT CAROL'S SAUCE — INVENTORY REPORT PARSER
// Parses Food Lion .docx inventory reports in the browser.
// No external libraries needed — reads the ZIP/XML directly.
// ============================================================

// ── Entry point: called when user picks a file ───────────────
async function handleReportUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'docx') {
    showParseError('Please upload a .docx file (the Word document Rachel sends).');
    return;
  }

  setParseStatus('reading', `Reading ${file.name}…`);

  try {
    const rows = await parseDocx(file);
    if (!rows.length) throw new Error('No inventory rows found in this file.');
    applyParsedReport(rows, file.name);
  } catch (e) {
    showParseError(e.message);
    console.error('Parse error:', e);
  }
}

// ── Parse .docx → array of { storeId, sku, units } ──────────
async function parseDocx(file) {
  // .docx is a ZIP. Use the browser's DecompressionStream to read it.
  const arrayBuf = await file.arrayBuffer();
  const xml = await extractDocumentXml(arrayBuf);
  return parseInventoryXml(xml);
}

// ── Extract word/document.xml from the ZIP bytes ─────────────
async function extractDocumentXml(arrayBuf) {
  // Minimal ZIP reader — finds the word/document.xml entry
  const bytes = new Uint8Array(arrayBuf);

  // ZIP local file header signature: PK\x03\x04
  const TARGET = 'word/document.xml';
  let i = 0;

  while (i < bytes.length - 30) {
    // Find PK\x03\x04
    if (bytes[i]!==0x50 || bytes[i+1]!==0x4B || bytes[i+2]!==0x03 || bytes[i+3]!==0x04) {
      i++; continue;
    }

    const compressionMethod = bytes[i+8] | (bytes[i+9]<<8);
    const compressedSize    = bytes[i+18] | (bytes[i+19]<<8) | (bytes[i+20]<<16) | (bytes[i+21]<<24);
    const fileNameLen       = bytes[i+26] | (bytes[i+27]<<8);
    const extraLen          = bytes[i+28] | (bytes[i+29]<<8);
    const fileNameBytes     = bytes.slice(i+30, i+30+fileNameLen);
    const fileName          = new TextDecoder().decode(fileNameBytes);
    const dataStart         = i + 30 + fileNameLen + extraLen;

    if (fileName === TARGET) {
      const compressedData = bytes.slice(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        // Stored (no compression)
        return new TextDecoder().decode(compressedData);
      } else if (compressionMethod === 8) {
        // Deflate
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compressedData);
        writer.close();
        const chunks = [];
        const reader = ds.readable.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const total = chunks.reduce((s,c)=>s+c.length,0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
        return new TextDecoder().decode(out);
      } else {
        throw new Error('Unsupported ZIP compression method: ' + compressionMethod);
      }
    }

    i = dataStart + Math.max(compressedSize, 0);
    if (compressedSize === 0) i++;
  }

  throw new Error('Could not find word/document.xml inside the .docx file. Make sure this is a valid Word document.');
}

// ── Parse the XML into inventory rows ────────────────────────
// Food Lion report table structure (from the actual .docx):
//   Col 0: Store #
//   Col 1: UPC (86000870950 = Spicy, 86000870951 = Mild)
//   Col 2: Product name (AUNT CAROLS SPC SAUC / MLD SAUC)
//   Col 3: (empty Metrics column)
//   Col 4: Yesterday's Store Inventory (units)
function parseInventoryXml(xml) {
  const UPC_SPICY = '86000870950';
  const UPC_MILD  = '86000870951';

  // Pull all <w:tr> (table row) elements
  const rowMatches = [...xml.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)];
  const rows = [];

  for (const [rowXml] of rowMatches) {
    // Pull <w:tc> (table cell) text content
    const cells = [...rowXml.matchAll(/<w:tc[\s>][\s\S]*?<\/w:tc>/g)]
      .map(([cellXml]) => {
        // Collect all <w:t> text nodes, strip XML tags
        return [...cellXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map(m => m[1])
          .join('')
          .trim();
      });

    if (cells.length < 5) continue;

    const storeId = cells[0].replace(/\D/g,'');
    const upc     = cells[1].replace(/\s/g,'');
    const unitsRaw= cells[4].replace(/[()]/g,'').trim(); // handle negative like (8.00)
    const units   = parseFloat(unitsRaw) || 0;
    // Negative values in parens = Food Lion's way of showing returns
    const isNegative = cells[4].includes('(') && cells[4].includes(')');
    const finalUnits = isNegative ? -Math.abs(units) : units;

    if (!storeId || (!upc.includes(UPC_SPICY) && !upc.includes(UPC_MILD))) continue;

    const sku = upc.includes(UPC_SPICY) ? 'SPC' : 'MLD';
    rows.push({ storeId: parseInt(storeId), sku, units: Math.max(finalUnits, 0) });
  }

  return rows;
}

// ── Apply parsed data to dashboard ───────────────────────────
async function applyParsedReport(rows, fileName) {
  setParseStatus('applying', `Found ${rows.length} rows — updating inventory…`);

  // Extract date from filename if possible (e.g. "Food_Lion_Inventory_report_6_24_2026.docx")
  const dateMatch = fileName.match(/(\d{1,2})[_\-](\d{1,2})[_\-](\d{4})/);
  const reportLabel = dateMatch
    ? `${getMonthName(dateMatch[1])} ${dateMatch[2]}, ${dateMatch[3]}`
    : 'New report';

  // Group by store
  const byStore = {};
  rows.forEach(r => {
    if (!byStore[r.storeId]) byStore[r.storeId] = { SPC: null, MLD: null };
    byStore[r.storeId][r.sku] = r.units;
  });

  // Track what changed
  const changes   = [];
  const newStores = [];

  Object.entries(byStore).forEach(([idStr, counts]) => {
    const id  = parseInt(idStr);
    const existing = stores[id];

    if (existing) {
      // Roll current "jun" values → "may" (previous), new values → "jun" (current)
      const prevSpc = existing.S_jun ?? existing.S_may ?? 0;
      const prevMld = existing.M_jun ?? existing.M_may ?? 0;
      const newSpc  = counts.SPC !== null ? counts.SPC : prevSpc;
      const newMld  = counts.MLD !== null ? counts.MLD : prevMld;

      stores[id] = {
        ...existing,
        S_may: prevSpc,
        M_may: prevMld,
        S_jun: newSpc,
        M_jun: newMld,
      };

      if (newSpc !== prevSpc || newMld !== prevMld) {
        changes.push({ id, prevSpc, prevMld, newSpc, newMld });
      }
    } else {
      // Brand new store in the report — add it
      const newSpc = counts.SPC ?? 0;
      const newMld = counts.MLD ?? 0;
      stores[id] = { addr:'', city:'', zip:'', S_may:0, M_may:0, S_jun:newSpc, M_jun:newMld };
      newStores.push(id);
    }
  });

  // Persist to localStorage
  const overrides = {};
  Object.keys(stores).forEach(id => {
    if (!BASE_STORES[id] || JSON.stringify(BASE_STORES[id]) !== JSON.stringify(stores[id])) {
      overrides[id] = stores[id];
    }
  });
  localStorage.setItem('ac_stores', JSON.stringify(overrides));

  // Push to Google Sheet if connected
  if (SHEET_CONFIGURED) {
    setParseStatus('syncing', 'Syncing to Google Sheets…');
    const updatePayload = Object.entries(byStore).map(([idStr, counts]) => {
      const id  = parseInt(idStr);
      const s   = stores[id];
      return { storeId:id, addr:s.addr||'', city:s.city||'', zip:s.zip||'',
               S_may:s.S_may, M_may:s.M_may, S_jun:s.S_jun, M_jun:s.M_jun,
               reportLabel, updatedAt:new Date().toISOString() };
    });
    await sheetRequest('bulkUpdateInventory', { stores: updatePayload });
  }

  // Update report date badge
  const badge = document.getElementById('report-badge');
  if (badge) badge.textContent = reportLabel;
  localStorage.setItem('ac_report_label', reportLabel);

  // Re-render
  renderInventory();

  // Show summary
  showParseSummary(rows.length, changes, newStores, reportLabel);
}

// ── UI helpers ────────────────────────────────────────────────
function setParseStatus(state, msg) {
  const el = document.getElementById('parse-status');
  if (!el) return;
  const colors = { reading:'#2471a3', applying:'#b7770d', syncing:'#1a7a40', done:'#1a7a40', error:'#c0392b' };
  el.style.color = colors[state] || '#333';
  el.textContent = msg;
}

function showParseError(msg) {
  setParseStatus('error', '⚠️ ' + msg);
  const area = document.getElementById('parse-drop-area');
  if (area) { area.style.borderColor = '#c0392b'; area.style.background = '#fde8e8'; }
}

function showParseSummary(totalRows, changes, newStores, label) {
  const el = document.getElementById('parse-summary');
  if (!el) return;

  const urgent = Object.keys(stores).filter(id => {
    const s = stores[id];
    return Math.max(s.S_jun,0)===0 && Math.max(s.M_jun,0)===0;
  }).length;

  el.style.display = 'block';
  el.innerHTML = `
    <div style="font-weight:600;margin-bottom:.5rem">✅ ${label} imported — ${totalRows} rows parsed</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px">
      <span>📊 Stores updated: <strong>${changes.length}</strong></span>
      <span>🆕 New stores: <strong>${newStores.length}</strong></span>
      <span>🔴 Both out: <strong>${urgent}</strong></span>
    </div>
    ${changes.length > 0 ? `
    <div style="margin-top:.75rem;font-size:12px;max-height:140px;overflow-y:auto;border:1px solid #e5e2dc;border-radius:5px;padding:.5rem">
      <strong>Changes:</strong><br>
      ${changes.slice(0,20).map(c=>`
        #${c.id}: Spicy ${c.prevSpc}→${c.newSpc} ${c.newSpc<c.prevSpc?'📉':c.newSpc>c.prevSpc?'📈':'='} &nbsp;|&nbsp;
                  Mild  ${c.prevMld}→${c.newMld} ${c.newMld<c.prevMld?'📉':c.newMld>c.prevMld?'📈':'='}
      `).join('<br>')}
      ${changes.length > 20 ? `<br>…and ${changes.length-20} more` : ''}
    </div>` : ''}
    <button class="btn btn-dark" style="margin-top:.75rem" onclick="closeModal('upload-modal');switchTab('inventory',document.querySelector('[data-tab=inventory]'))">
      View updated inventory →
    </button>
  `;

  setParseStatus('done', `✓ ${totalRows} rows imported`);
}

function getMonthName(m) {
  return ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)] || m;
}

// ── Drag-and-drop support ─────────────────────────────────────
function initDropZone() {
  const area = document.getElementById('parse-drop-area');
  if (!area) return;

  area.addEventListener('dragover', e => {
    e.preventDefault();
    area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleReportUpload({ target: { files: [file] } });
  });
}

window.addEventListener('DOMContentLoaded', initDropZone);

// ── Parse pasted text (copied from email/Word table) ─────────
// Handles tab-separated or space-padded columns like:
//   171  86000870950  AUNT CAROLS SPC SAUC    12.00
//   171  86000870951  AUNT CAROLS MLD SAUC    0.00
function parsePastedText(text) {
  const UPC_SPICY = '86000870950';
  const UPC_MILD  = '86000870951';
  const rows = [];

  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Split on tabs first, then fall back to 2+ spaces
    const cols = line.includes('\t')
      ? line.split('\t').map(c => c.trim())
      : line.split(/\s{2,}/).map(c => c.trim());

    if (cols.length < 3) continue;

    // Find store ID (first numeric-only column)
    const storeId = parseInt(cols[0]);
    if (!storeId || isNaN(storeId)) continue;

    // Find UPC (contains 86000870950 or 86000870951)
    const upcCol = cols.find(c => c.includes(UPC_SPICY) || c.includes(UPC_MILD));
    if (!upcCol) continue;

    // Units: last column that looks like a number, handle negatives in parens like (8.00)
    const lastCol = cols[cols.length - 1];
    const isNeg   = lastCol.startsWith('(') && lastCol.endsWith(')');
    const units   = Math.max(parseFloat(lastCol.replace(/[()]/g, '')) || 0, 0);

    const sku = upcCol.includes(UPC_SPICY) ? 'SPC' : 'MLD';
    rows.push({ storeId, sku, units });
  }

  return rows;
}

// ── Handle paste submit ───────────────────────────────────────
async function handlePasteSubmit() {
  const text = document.getElementById('paste-input')?.value?.trim();
  if (!text) {
    showParseError('Please paste the inventory data first.');
    return;
  }

  setParseStatus('reading', 'Parsing pasted text…');

  // Reset drop zone style
  const area = document.getElementById('parse-drop-area');
  if (area) { area.style.borderColor=''; area.style.background=''; }

  const rows = parsePastedText(text);
  if (!rows.length) {
    showParseError('No inventory rows found. Make sure you copied the full table from Rachel\'s email.');
    return;
  }

  // Use today\'s date as the report label since paste has no filename
  const now = new Date();
  const label = now.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  await applyParsedReport(rows, `Pasted_report_${now.getMonth()+1}_${now.getDate()}_${now.getFullYear()}.docx`);
}
