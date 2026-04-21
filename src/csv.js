// ═══════════════════════════════════════
//  CSV PARSING (RFC 4180)
// ═══════════════════════════════════════
const DELIMITERS = [',', '\t', ';', '|', ' '];

function detectDelimiter(lines) {
  let best = ',', bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map(l => splitCSVRow(l, d).length);
    if (counts[0] < 2) continue;
    const allSame = counts.every(c => c === counts[0]);
    const score = allSame ? counts[0] * 1000 + counts.length : counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitCSVRow(line, delimiter) {
  // RFC 4180 compliant field splitting with quoted field support
  const fields = [];
  let i = 0, field = '', inQuote = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"'; i += 2; // escaped quote
        } else {
          inQuote = false; i++;
        }
      } else {
        field += c; i++;
      }
    } else {
      if (c === '"') {
        inQuote = true; i++;
      } else if (c === delimiter) {
        fields.push(field); field = ''; i++;
      } else {
        field += c; i++;
      }
    }
  }
  fields.push(field);
  return fields;
}

function parseCSV(text, config) {
  config = config || {};
  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [], types: {}, missing: {} };

  const detectedDelimiter = detectDelimiter(lines.slice(0, 20));
  const delimiter = config.delimiter || detectedDelimiter;

  const detectedDecimal = delimiter === ';' ? ',' : '.';
  const decimalSep = config.decimalSep || detectedDecimal;
  const commaDecimal = decimalSep === ',';

  // Store detected + active values for config dialog
  csvConfig = {
    delimiter,
    decimalSep,
    detected: { delimiter: detectedDelimiter, decimalSep: detectedDecimal },
  };

  const headers = splitCSVRow(lines[0], delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = [];
  const missing = {};
  headers.forEach(h => { missing[h] = 0; });

  for (let i = 1; i < lines.length; i++) {
    const vals = splitCSVRow(lines[i], delimiter);
    if (vals.length !== headers.length) continue; // skip ragged rows
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      let v = vals[j].trim().replace(/^["']|["']$/g, '');
      if (commaDecimal && v) v = v.replace(/,/g, '.');
      if (NULL_SENTINELS.has(v)) {
        row[headers[j]] = '';
        missing[headers[j]]++;
      } else {
        row[headers[j]] = v;
      }
    }
    rows.push(row);
  }

  // Type detection
  const types = {};
  headers.forEach(h => {
    const sample = rows.slice(0, 100).map(r => r[h]).filter(v => v !== '');
    const numCount = sample.filter(v => !isNaN(parseFloat(v)) && isFinite(v)).length;
    const total = sample.length;
    types[h] = (total > 0 && numCount / total > 0.8) ? 'numeric' : 'categorical';
  });

  return { headers, rows, types, missing, delimiter };
}

function getFilteredRows() {
  if (!DATA) return [];
  if (!currentFilter) return DATA.rows;
  return DATA.rows.filter(r => {
    try { return currentFilter.fn(r); } catch { return false; }
  });
}

function loadData(csvText, config) {
  csvRawText = csvText; // store for re-parsing
  DATA = parseCSV(csvText, config);
  if (DATA.rows.length === 0) { alert('No data rows found.'); return; }
  DATA._origTypes = { ...DATA.types };
  currentFilter = null;

  populateColumnRoleSelects();
  document.getElementById('configSection').style.display = '';
  document.getElementById('growBtn').disabled = false;
  document.getElementById('csvConfigBtn').style.display = '';
  const configEmpty = document.getElementById('configEmpty');
  if (configEmpty) configEmpty.style.display = 'none';

  // Show filter section
  document.getElementById('filterSection').style.display = '';
  document.getElementById('filterInput').value = '';
  document.getElementById('filterError').textContent = '';
  document.getElementById('filterError').className = 'filter-error';
  document.getElementById('filterCount').textContent = '';
  initFilterAutocomplete();

  // Data summary in left panel
  const ds = document.getElementById('dataSummary');
  ds.style.display = '';
  renderDataSummary();

  // Create the default train/test partition before any tree is grown.
  initializeDefaultSplit();

  publish('dataset', DATA);
}

function renderDataSummary() {
  if (!DATA) return;
  const ds = document.getElementById('dataSummary');
  const nums = DATA.headers.filter(h => DATA.types[h] === 'numeric');
  const cats = DATA.headers.filter(h => DATA.types[h] === 'categorical');
  const totalMissing = Object.values(DATA.missing).reduce((a, b) => a + b, 0);
  let dsHtml = '<div class="data-summary">';
  dsHtml += `<div class="ds-row"><span class="ds-label">Rows</span><span class="ds-val">${DATA.rows.length}</span></div>`;
  dsHtml += `<div class="ds-row"><span class="ds-label">Columns</span><span class="ds-val">${DATA.headers.length}</span></div>`;
  dsHtml += `<div class="ds-row"><span class="ds-label">Numeric</span><span class="ds-val">${nums.length}</span></div>`;
  dsHtml += `<div class="ds-row"><span class="ds-label">Categorical</span><span class="ds-val">${cats.length}</span></div>`;
  if (totalMissing > 0) {
    dsHtml += `<div class="ds-row"><span class="ds-label" style="color:var(--amber)">Missing</span><span class="ds-val" style="color:var(--amber)">${totalMissing}</span></div>`;
  }
  dsHtml += '<div class="ds-cols">';
  for (const h of DATA.headers) {
    const isNum = DATA.types[h] === 'numeric';
    const canToggle = DATA._origTypes[h] === 'numeric';
    const miss = DATA.missing[h] || 0;
    const missTag = miss > 0 ? `<span style="color:var(--amber);font-size:0.48rem;" title="${miss} missing values">${miss}?</span>` : '';
    dsHtml += `<div class="ds-col">
      <span class="ds-col-name">${h}</span>${missTag}
      <span class="ds-col-type${canToggle ? ' ds-col-toggle' : ''}"
        ${canToggle ? `onclick="toggleColType('${h.replace(/'/g, "\\'")}')" title="Click to toggle numeric ↔ categorical"` : `title="${isNum ? 'numeric' : 'categorical (text)'}"`}
      >${isNum ? 'num #' : 'cat ●'}</span>
    </div>`;
  }
  dsHtml += '</div></div>';
  ds.innerHTML = dsHtml;
}

function toggleColType(col) {
  if (!DATA) return;
  DATA.types[col] = DATA.types[col] === 'numeric' ? 'categorical' : 'numeric';
  renderDataSummary();
  // Refresh target select
  const sel = document.getElementById('targetSelect');
  const prevTarget = sel.value;
  sel.innerHTML = '';
  const cats = DATA.headers.filter(h => DATA.types[h] === 'categorical');
  const nums = DATA.headers.filter(h => DATA.types[h] === 'numeric');
  [...cats, ...nums].forEach(h => {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h + (DATA.types[h] === 'categorical' ? ' ●' : ' #');
    sel.appendChild(opt);
  });
  if (DATA.headers.includes(prevTarget)) sel.value = prevTarget;
  showToast(`${col} → ${DATA.types[col]}`);
}

// ═══════════════════════════════════════
//  ROW FILTER + EXPRESSION AUTOCOMPLETE
// ═══════════════════════════════════════
function fuzzyMatch(query, target) {
  if (!query) return true;
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

function safeColAccess(name) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ? 'r.' + name : 'r["' + name.replace(/"/g, '\\"') + '"]';
}

function getTokenAtCursor(el) {
  const pos = el.selectionStart;
  const text = el.value.substring(0, pos);
  const match = text.match(/(?:r\.)?([a-zA-Z_][a-zA-Z0-9_]*)$/);
  if (!match) return { token: '', start: pos, hasPrefix: false, fullLen: 0 };
  const full = match[0];
  return { token: match[1], start: pos - full.length, hasPrefix: full.startsWith('r.'), fullLen: full.length };
}

function buildFilterAcItems() {
  if (!DATA) return [];
  const items = [];
  for (const h of DATA.headers) {
    const isNum = DATA.types[h] === 'numeric';
    items.push({
      label: h,
      insert: safeColAccess(h),
      kind: isNum ? 'num' : 'cat',
      type: isNum ? '#' : '●'
    });
  }
  return items;
}

let filterAcState = null;

function initFilterAutocomplete() {
  const input = document.getElementById('filterInput');
  if (filterAcState) filterAcState.destroy();

  let dropdown = document.getElementById('filterAcDropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'expr-ac';
    dropdown.id = 'filterAcDropdown';
    input.parentElement.appendChild(dropdown);
  }

  let items = [], selected = -1;

  function showAc() {
    const tok = getTokenAtCursor(input);
    if (!tok.token || tok.token.length < 1) { hideAc(); return; }
    const lc = tok.token.toLowerCase();
    items = buildFilterAcItems().filter(it =>
      fuzzyMatch(lc, it.label.toLowerCase())
    ).slice(0, 10);
    if (items.length === 0) { hideAc(); return; }
    selected = 0;
    renderAc();
    dropdown.classList.add('open');
  }

  function hideAc() {
    dropdown.classList.remove('open');
    items = []; selected = -1;
  }

  function renderAc() {
    dropdown.innerHTML = items.map((it, i) => {
      const cls = it.kind === 'num' ? 'ac-col-num' : 'ac-col-cat';
      return `<div class="ac-item ${cls}${i === selected ? ' selected' : ''}" data-idx="${i}">
        <span class="ac-label">${escHtml(it.label)}</span>
        <span class="ac-type">${it.type}</span>
      </div>`;
    }).join('');
    dropdown.querySelectorAll('.ac-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        acceptAc(parseInt(el.dataset.idx));
      });
    });
  }

  function acceptAc(idx) {
    const item = items[idx];
    if (!item) return;
    const tok = getTokenAtCursor(input);
    const before = input.value.substring(0, tok.start);
    const after = input.value.substring(tok.start + tok.fullLen);
    input.value = before + item.insert + after;
    const newPos = before.length + item.insert.length;
    input.setSelectionRange(newPos, newPos);
    hideAc();
    input.focus();
    updateFilterCount();
  }

  function onInput() {
    showAc();
    updateFilterCount();
  }
  function onBlur() { setTimeout(hideAc, 150); }
  function onKeydown(e) {
    if (dropdown.classList.contains('open') && items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); selected = (selected + 1) % items.length; renderAc(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selected = (selected - 1 + items.length) % items.length; renderAc(); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && selected >= 0)) { e.preventDefault(); acceptAc(selected); return; }
      if (e.key === 'Escape') { hideAc(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); applyFilter(); }
  }

  input.addEventListener('input', onInput);
  input.addEventListener('blur', onBlur);
  input.addEventListener('keydown', onKeydown);

  filterAcState = {
    destroy: () => {
      input.removeEventListener('input', onInput);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('keydown', onKeydown);
      hideAc();
    }
  };
}

function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function validateFilterExpr(expr) {
  if (!expr.trim()) return { valid: true, error: null, warnings: [] };
  try {
    new Function('r', 'return !!(' + expr + ')');
  } catch (e) {
    return { valid: false, error: 'Syntax: ' + e.message, warnings: [] };
  }
  const warnings = [];
  if (DATA) {
    const known = new Set(DATA.headers);
    const patterns = [/\br\.([a-zA-Z_]\w*)/g, /\br\["([^"]+)"\]/g, /\br\['([^']+)'\]/g];
    const checked = new Set();
    for (const pat of patterns) {
      for (const m of expr.matchAll(pat)) {
        if (!checked.has(m[1])) {
          checked.add(m[1]);
          if (!known.has(m[1])) warnings.push('Unknown: "' + m[1] + '"');
        }
      }
    }
  }
  return { valid: true, error: null, warnings };
}

function updateFilterCount() {
  const expr = document.getElementById('filterInput').value.trim();
  const countEl = document.getElementById('filterCount');
  const errEl = document.getElementById('filterError');
  if (!expr || !DATA) {
    countEl.textContent = '';
    errEl.textContent = ''; errEl.className = 'filter-error';
    return;
  }
  const result = validateFilterExpr(expr);
  if (!result.valid) {
    errEl.textContent = result.error;
    errEl.className = 'filter-error active';
    countEl.textContent = '';
    return;
  }
  if (result.warnings.length) {
    errEl.textContent = result.warnings.join('; ');
    errEl.className = 'filter-error active warning';
  } else {
    errEl.textContent = ''; errEl.className = 'filter-error';
  }
  try {
    const fn = new Function('r', 'try { return !!(' + expr + '); } catch(e) { return false; }');
    const count = DATA.rows.filter(r => fn(r)).length;
    countEl.innerHTML = `<span class="fc-active">${count}</span> / ${DATA.rows.length} rows`;
  } catch {
    countEl.textContent = '';
  }
}

function applyFilter() {
  const expr = document.getElementById('filterInput').value.trim();
  const errEl = document.getElementById('filterError');
  if (!expr) { clearFilter(); return; }
  const result = validateFilterExpr(expr);
  if (!result.valid) {
    errEl.textContent = result.error;
    errEl.className = 'filter-error active';
    return;
  }
  try {
    const fn = new Function('r', 'try { return !!(' + expr + '); } catch(e) { return false; }');
    currentFilter = { expr, fn };
    const count = getFilteredRows().length;
    showToast(`Filter applied: ${count} / ${DATA.rows.length} rows`);
    // If tree exists, regrow with filter
    if (TREE) growTree();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.className = 'filter-error active';
  }
}

function clearFilter() {
  currentFilter = null;
  document.getElementById('filterInput').value = '';
  document.getElementById('filterError').textContent = '';
  document.getElementById('filterError').className = 'filter-error';
  document.getElementById('filterCount').textContent = '';
  showToast('Filter cleared');
  if (TREE) growTree();
}

// ═══════════════════════════════════════
//  CSV CONFIG DIALOG
// ═══════════════════════════════════════
const DELIM_LABELS = { ',': 'Comma (,)', '\t': 'Tab (⇥)', ';': 'Semicolon (;)', '|': 'Pipe (|)', ' ': 'Space ( )' };

function showCSVConfig() {
  if (!csvConfig || !csvRawText) return;
  const detected = csvConfig.detected;

  const delimOptions = DELIMITERS.map(d => {
    const label = DELIM_LABELS[d] || d;
    const det = d === detected.delimiter ? ' (detected)' : '';
    const sel = d === csvConfig.delimiter ? ' selected' : '';
    return `<option value="${d === '\t' ? 'TAB' : d}"${sel}>${label}${det}</option>`;
  }).join('') + '<option value="__custom__">Custom…</option>';

  const decOptions = ['.', ','].map(d => {
    const label = d === '.' ? 'Period (.)' : 'Comma (,)';
    const det = d === detected.decimalSep ? ' (detected)' : '';
    const sel = d === csvConfig.decimalSep ? ' selected' : '';
    return `<option value="${d}"${sel}>${label}${det}</option>`;
  }).join('');

  const previewRows = DATA ? DATA.rows.slice(0, 3) : [];
  const previewCols = DATA ? DATA.headers.slice(0, 5) : [];
  const ellipsis = DATA && DATA.headers.length > 5 ? `<span style="color:var(--text-faint);font-size:0.5rem;">…+${DATA.headers.length - 5} more</span>` : '';

  let previewHtml = '<div style="margin-top:0.6rem;border-top:1px solid var(--border);padding-top:0.5rem;">';
  previewHtml += '<div style="font-family:var(--mono);font-size:0.52rem;color:var(--text-faint);margin-bottom:0.3rem;">PREVIEW (current parse) ' + ellipsis + '</div>';
  previewHtml += '<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:0.52rem;">';
  previewHtml += '<tr>' + previewCols.map(h => `<th style="text-align:left;padding:0.15rem 0.3rem;color:var(--cyan);border-bottom:1px solid var(--border);white-space:nowrap;">${escHtml(h)}</th>`).join('') + '</tr>';
  for (const row of previewRows) {
    previewHtml += '<tr>' + previewCols.map(h => {
      const v = row[h];
      const style = v === '' ? 'color:var(--amber);' : '';
      return `<td style="padding:0.15rem 0.3rem;${style}white-space:nowrap;">${v === '' ? '—' : escHtml(v)}</td>`;
    }).join('') + '</tr>';
  }
  previewHtml += '</table></div>';

  const host = openFloatingPanel('csv-config', { title: '⚙ CSV Parsing', width: 480, height: 520 });
  if (!host) return;
  host.innerHTML = `
    <div class="csv-cfg-row">
      <label>Delimiter</label>
      <select id="cfgDelimiter">${delimOptions}</select>
    </div>
    <div class="csv-cfg-row" id="cfgCustomDelimRow" style="display:none;">
      <label>Custom</label>
      <input type="text" id="cfgCustomDelim" maxlength="3" placeholder="e.g. ::" style="max-width:4rem;" />
    </div>
    <div class="csv-cfg-row">
      <label>Decimal sep.</label>
      <select id="cfgDecimalSep">${decOptions}</select>
    </div>
    <div id="csvConfigPreview">${previewHtml}</div>
    <div class="dialog-buttons">
      <button class="dialog-btn" onclick="resetCSVConfig()">↺ Auto-detect</button>
      <button class="dialog-btn" onclick="closeFloatingPanel('csv-config')">Cancel</button>
      <button class="dialog-btn dialog-btn-primary" onclick="applyCSVConfig()">Apply & Re-parse</button>
    </div>`;

  const delimSel = host.querySelector('#cfgDelimiter');
  delimSel.addEventListener('change', () => {
    host.querySelector('#cfgCustomDelimRow').style.display =
      delimSel.value === '__custom__' ? '' : 'none';
    previewCSVConfig();
  });
  host.querySelector('#cfgDecimalSep').addEventListener('change', previewCSVConfig);
  host.querySelector('#cfgCustomDelim').addEventListener('input', previewCSVConfig);
}

function getCSVConfigFromDialog() {
  const delimVal = document.getElementById('cfgDelimiter').value;
  let delimiter;
  if (delimVal === '__custom__') {
    delimiter = document.getElementById('cfgCustomDelim').value || ',';
  } else if (delimVal === 'TAB') {
    delimiter = '\t';
  } else {
    delimiter = delimVal;
  }
  const decimalSep = document.getElementById('cfgDecimalSep').value;
  return { delimiter, decimalSep };
}

function previewCSVConfig() {
  if (!csvRawText) return;
  const config = getCSVConfigFromDialog();
  const savedConfig = csvConfig; // preserve global
  const preview = parseCSV(csvRawText, config);
  csvConfig = savedConfig; // restore global
  const previewEl = document.getElementById('csvConfigPreview');
  if (!previewEl || preview.rows.length === 0) return;

  const cols = preview.headers.slice(0, 5);
  const rows = preview.rows.slice(0, 3);
  const ellipsis = preview.headers.length > 5 ? `<span style="color:var(--text-faint);font-size:0.5rem;">…+${preview.headers.length - 5} more</span>` : '';

  let html = '<div style="margin-top:0.6rem;border-top:1px solid var(--border);padding-top:0.5rem;">';
  html += `<div style="font-family:var(--mono);font-size:0.52rem;color:var(--text-faint);margin-bottom:0.3rem;">PREVIEW (${preview.headers.length} cols × ${preview.rows.length} rows) ${ellipsis}</div>`;
  html += '<table style="width:100%;border-collapse:collapse;font-family:var(--mono);font-size:0.52rem;">';
  html += '<tr>' + cols.map(h => `<th style="text-align:left;padding:0.15rem 0.3rem;color:var(--cyan);border-bottom:1px solid var(--border);white-space:nowrap;">${escHtml(h)}</th>`).join('') + '</tr>';
  for (const row of rows) {
    html += '<tr>' + cols.map(h => {
      const v = row[h];
      const style = v === '' ? 'color:var(--amber);' : '';
      return `<td style="padding:0.15rem 0.3rem;${style}white-space:nowrap;">${v === '' ? '—' : escHtml(v)}</td>`;
    }).join('') + '</tr>';
  }
  html += '</table></div>';
  previewEl.innerHTML = html;
}

function applyCSVConfig() {
  const config = getCSVConfigFromDialog();
  const prevTarget = document.getElementById('targetSelect').value;
  TREE = null;
  loadData(csvRawText, config);
  // Try to restore target selection
  if (DATA && DATA.headers.includes(prevTarget)) {
    document.getElementById('targetSelect').value = prevTarget;
  }
  closeFloatingPanel('csv-config');
  showToast(`Re-parsed: ${DELIM_LABELS[config.delimiter] || config.delimiter}, decimal "${config.decimalSep}"`);
}

function resetCSVConfig() {
  const prevTarget = document.getElementById('targetSelect').value;
  TREE = null;
  loadData(csvRawText); // no config = auto-detect
  if (DATA && DATA.headers.includes(prevTarget)) {
    document.getElementById('targetSelect').value = prevTarget;
  }
  closeFloatingPanel('csv-config');
  showToast('Re-parsed with auto-detected settings');
}

