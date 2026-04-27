// ═══════════════════════════════════════
//  APPLY TREE TO DATASET
// ═══════════════════════════════════════
// Streams a (potentially huge) external CSV through the current TREE,
// emitting an output CSV with prediction columns appended. Two paths:
//
//   • FSAA path: showOpenFilePicker → byte-sliced read → worker → writable
//     stream from showSaveFilePicker. Constant memory regardless of size.
//   • Fallback: <input type="file"> → same byte-slicing → worker →
//     accumulate output in memory → Blob download. Limited by RAM but
//     keeps the feature available on Firefox/Safari.
//
// The actual prediction loop runs in a Worker spawned from the
// `<script type="text/js-worker" id="predict-worker">` source block, so
// the UI stays responsive.

let _applyState = null;

// Saved mappings keyed by header signature (joined headers). Persisted as
// part of the project payload (persistence.js) so re-running on next month's
// block model with the same schema is a one-click affair. Restored when a
// fresh input file matches a known signature.
let _applyPresets = new Map();

const APPLY_SAMPLE_BYTES = 64 * 1024;
const APPLY_CHUNK_BYTES = 1 << 20; // 1 MiB

function applyHeaderSignature(headers) {
  return headers.join('|');
}

function tryRestoreApplyPreset() {
  const s = _applyState;
  if (!s || !s.headers.length || !_applyPresets || !_applyPresets.size) return false;
  const sig = applyHeaderSignature(s.headers);
  const preset = _applyPresets.get(sig);
  if (!preset) return false;
  s.headerRow = preset.headerRow ?? s.headerRow;
  s.commentPrefix = preset.commentPrefix != null ? preset.commentPrefix : s.commentPrefix;
  if (preset.parseConfig) s.parseConfig = { ...preset.parseConfig };
  s.delimChosen = !!preset.delimChosen;
  s.decimalChosen = !!preset.decimalChosen;
  if (preset.featureMap) {
    // Only keep mappings whose target columns still exist
    const filtered = {};
    const headerSet = new Set(s.headers);
    for (const [feat, col] of Object.entries(preset.featureMap)) {
      if (headerSet.has(col)) filtered[feat] = col;
    }
    s.featureMap = filtered;
  }
  if (preset.outputCols) s.outputCols = { ...preset.outputCols };
  if (preset.targetCol && s.headers.includes(preset.targetCol)) {
    s.targetCol = preset.targetCol;
  }
  return true;
}

function saveApplyPreset() {
  const s = _applyState;
  if (!s || !s.headers.length) return;
  const sig = applyHeaderSignature(s.headers);
  const preset = {
    headerRow: s.headerRow,
    commentPrefix: s.commentPrefix,
    parseConfig: { ...s.parseConfig },
    delimChosen: !!s.delimChosen,
    decimalChosen: !!s.decimalChosen,
    featureMap: { ...s.featureMap },
    outputCols: { ...s.outputCols },
    targetCol: s.targetCol || '',
    savedAt: Date.now(),
  };
  _applyPresets.set(sig, preset);
}

// ─── used-features ─────────────────────────────────────────────
// Walk the tree and return the set of features actually referenced by a
// split. The candidate set on TREE._features is what was *available* at
// growth time, but most trees only end up splitting on a subset — asking
// the user to map an unused feature is busywork (and has zero effect on
// prediction since predict never reads it).
function collectUsedFeatures(node, out) {
  if (!node || node.leaf) return out;
  if (node.split && node.split.feature) out.add(node.split.feature);
  collectUsedFeatures(node.left, out);
  collectUsedFeatures(node.right, out);
  return out;
}

function getUsedFeatures() {
  if (!TREE) return [];
  const set = collectUsedFeatures(TREE, new Set());
  // Preserve the order from TREE._features when possible (stable UI).
  const candidates = TREE._features || [];
  const ordered = candidates.filter(f => set.has(f));
  // Tack on any extras (shouldn't happen, but defensive).
  for (const f of set) if (!ordered.includes(f)) ordered.push(f);
  return ordered;
}

// Walk the tree and collect feature → 'numeric' | 'categorical' from splits.
// Same feature can in principle appear in both numeric and categorical splits
// (it can't, in our CART, but be defensive); first seen wins.
function getUsedFeatureTypes() {
  const out = {};
  const walk = (n) => {
    if (!n || n.leaf) return;
    if (n.split && n.split.feature && !out[n.split.feature]) {
      out[n.split.feature] = n.split.type;
    }
    walk(n.left); walk(n.right);
  };
  walk(TREE);
  return out;
}

// Compute training-side stats for the given features over the current DATA.
// Numeric: { n, min, max, mean, std }. Categorical: { n, categories: Set, top }.
function gatherTrainingStats(features) {
  if (!DATA) return {};
  const out = {};
  const types = getUsedFeatureTypes();
  for (const f of features) {
    const t = types[f] || DATA.types[f] || 'numeric';
    if (t === 'numeric') {
      let n = 0, sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
      for (const r of DATA.rows) {
        const v = parseFloat(r[f]);
        if (!isFinite(v)) continue;
        n++; sum += v; sumSq += v * v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const mean = n ? sum / n : 0;
      const std = n ? Math.sqrt(Math.max(0, sumSq / n - mean * mean)) : 0;
      out[f] = { type: 'numeric', n, min, max, mean, std };
    } else {
      const cats = new Set();
      const counts = Object.create(null);
      let n = 0;
      for (const r of DATA.rows) {
        const v = r[f];
        if (v === '' || v == null) continue;
        const s = String(v);
        cats.add(s);
        counts[s] = (counts[s] || 0) + 1;
        n++;
      }
      out[f] = { type: 'categorical', n, categories: [...cats], counts };
    }
  }
  return out;
}

// ─── tree clone ────────────────────────────────────────────────
// Strip _rows (potentially MB of row references) and any other transient
// fields from the tree before postMessage. Recurse over left/right.
function cloneTreeForWorker(node) {
  if (!node) return null;
  const out = {
    id: node.id,
    leaf: !!node.leaf,
    prediction: node.prediction,
    confidence: node.confidence,
  };
  if (!node.leaf) {
    out.split = {
      type: node.split.type,
      feature: node.split.feature,
    };
    if (node.split.type === 'numeric') out.split.threshold = node.split.threshold;
    else out.split.category = node.split.category;
    out.left = cloneTreeForWorker(node.left);
    out.right = cloneTreeForWorker(node.right);
  }
  return out;
}

// ─── entry ─────────────────────────────────────────────────────
function showApplyTreeDialog() {
  if (!TREE) { showToast('Grow a tree first'); return; }

  _applyState = {
    inputHandle: null,           // FileSystemFileHandle (FSAA) or null
    inputFile: null,             // File object
    inputName: '',
    sampleText: '',              // first ~64 KB decoded
    headerRow: 1,                // 1-indexed: which non-comment line is the header
    commentPrefix: '#',          // skip lines starting with this (after trim)
    headers: [],                 // detected input headers (from selected header row)
    previewRows: [],             // first ~3 parsed data rows (array of field arrays)
    parseError: null,            // last parse complaint
    parseConfig: { delimiter: ',', decimalSep: '.' },
    detectedConfig: { delimiter: ',', decimalSep: '.' },
    delimChosen: false,          // user has manually picked a delimiter
    decimalChosen: false,        // user has manually picked a decimal sep
    featureMap: {},              // feature → column name (or '' = skip)
    targetCol: '',               // if set + present in input, validation stats are emitted
    outputCols: { pred: true, conf: true, leaf: true },
    outputHandle: null,          // FileSystemFileHandle (FSAA save) or null
    outputName: 'predictions.csv',
    running: false,
    cancelled: false,
    worker: null,
    bytesRead: 0,
    totalBytes: 0,
    rowsOut: 0,
    startedAt: 0,
    completed: false,            // run finished successfully
    elapsedMs: 0,
    stats: null,                 // populated by worker on isLast
    trainingStats: null,         // computed at run start over DATA.rows
  };

  const host = openFloatingPanel('apply-tree', { title: '🌲 Apply Tree to Dataset', width: 580, height: 640 });
  if (!host) return;
  renderApplyDialog(host);
}

// ─── auto-map: case-insensitive name match between tree features and headers ──
function applyAutoMap() {
  const s = _applyState;
  const lower = {};
  s.headers.forEach(h => { lower[h.toLowerCase()] = h; });
  for (const f of getUsedFeatures()) {
    if (s.featureMap[f]) continue; // user already chose
    const hit = lower[f.toLowerCase()];
    if (hit) s.featureMap[f] = hit;
  }
}

// ─── parse the cached sample with current header-row + comment-prefix +
// parse-config settings. Updates s.headers, s.previewRows, s.detectedConfig,
// s.parseError. Drops feature mappings that no longer point to a real column.
function recomputeFromSample() {
  const s = _applyState;
  if (!s) return;
  s.headers = [];
  s.previewRows = [];
  s.parseError = null;
  if (!s.sampleText) return;

  let raw = s.sampleText;
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = normalised.split('\n');

  const isSkippable = (line) => {
    if (!line.trim()) return true;
    if (s.commentPrefix && line.trimStart().startsWith(s.commentPrefix)) return true;
    return false;
  };

  // Find the headerRow-th non-skippable line
  let nonSkipCount = 0;
  let headerIdx = -1;
  for (let i = 0; i < allLines.length; i++) {
    if (isSkippable(allLines[i])) continue;
    nonSkipCount++;
    if (nonSkipCount === s.headerRow) { headerIdx = i; break; }
  }
  if (headerIdx < 0) {
    s.parseError = `Header row ${s.headerRow} not found (sample has ${nonSkipCount} non-comment line${nonSkipCount === 1 ? '' : 's'})`;
    return;
  }

  // Collect first ~20 non-skippable lines from the header onward for delim
  // detection, and the next ~3 data lines for preview.
  const detectLines = [];
  const previewLines = [];
  for (let i = headerIdx; i < allLines.length; i++) {
    if (isSkippable(allLines[i])) continue;
    if (detectLines.length < 20) detectLines.push(allLines[i]);
    if (i > headerIdx && previewLines.length < 3) previewLines.push(allLines[i]);
    if (detectLines.length >= 20 && previewLines.length >= 3) break;
  }

  // Auto-detect delim/decimal unless user has overridden
  const detectedDelim = detectDelimiter(detectLines);
  const detectedDecimal = detectedDelim === ';' ? ',' : '.';
  s.detectedConfig = { delimiter: detectedDelim, decimalSep: detectedDecimal };
  if (!s.delimChosen) s.parseConfig.delimiter = detectedDelim;
  if (!s.decimalChosen) s.parseConfig.decimalSep = detectedDecimal;

  s.headers = splitCSVRow(allLines[headerIdx], s.parseConfig.delimiter)
    .map(h => h.trim().replace(/^["']|["']$/g, ''));
  s.previewRows = previewLines.map(line =>
    splitCSVRow(line, s.parseConfig.delimiter)
      .map(v => v.trim().replace(/^["']|["']$/g, ''))
  );

  // Drop mappings that no longer point to a real column
  const headerSet = new Set(s.headers);
  for (const [feat, col] of Object.entries(s.featureMap)) {
    if (!headerSet.has(col)) delete s.featureMap[feat];
  }
  applyAutoMap();

  // Auto-pick target column when the tree's target name appears verbatim in
  // the new headers (case-insensitive). Drop a stale selection if the column
  // disappeared.
  if (s.targetCol && !headerSet.has(s.targetCol)) s.targetCol = '';
  if (!s.targetCol && TREE && TREE._target) {
    const tgt = TREE._target.toLowerCase();
    const hit = s.headers.find(h => h.toLowerCase() === tgt);
    if (hit) s.targetCol = hit;
  }
}

// ─── render ────────────────────────────────────────────────────
function renderApplyDialog(host) {
  const s = _applyState;
  const isReg = TREE._mode === 'regression';
  const fsaaIn = typeof window.showOpenFilePicker === 'function';
  const fsaaOut = typeof window.showSaveFilePicker === 'function';

  const features = getUsedFeatures();
  const allMapped = s.headers.length > 0 && features.every(f => s.featureMap[f]);
  const canRun = !s.running && s.inputFile && allMapped && !s.parseError &&
    (fsaaOut ? s.outputHandle : true);

  // Mapping list (use feature index for callbacks — feature names may contain
  // quotes, which would break inline JS strings in onchange attributes).
  let mappingHtml;
  if (!s.headers.length) {
    mappingHtml = `<div class="apply-empty">Pick an input file to map columns.</div>`;
  } else {
    mappingHtml = features.map((f, i) => {
      const cur = s.featureMap[f] || '';
      const opts = [
        `<option value="">— no source · predict at this node —</option>`,
        ...s.headers.map(h => `<option value="${escHtml(h)}"${h === cur ? ' selected' : ''}>${escHtml(h)}</option>`),
      ].join('');
      const status = cur ? '✓' : '⚠';
      const cls = cur ? 'apply-feat-ok' : 'apply-feat-missing';
      return `<div class="apply-map-row">
        <span class="apply-map-status ${cls}">${status}</span>
        <span class="apply-feat" title="${escHtml(f)}">${escHtml(f)}</span>
        <select onchange="onApplyMapChange(${i}, this.value)">${opts}</select>
      </div>`;
    }).join('');
  }

  // Parse-config selectors
  const delims = [',', '\t', ';', '|', ' '];
  const dLabels = { ',': 'Comma (,)', '\t': 'Tab (⇥)', ';': 'Semicolon (;)', '|': 'Pipe (|)', ' ': 'Space ( )' };
  const delimOpts = delims.map(d => {
    const det = d === s.detectedConfig.delimiter ? ' (detected)' : '';
    const sel = d === s.parseConfig.delimiter ? ' selected' : '';
    return `<option value="${d === '\t' ? 'TAB' : d}"${sel}>${dLabels[d]}${det}</option>`;
  }).join('');
  const decOpts = ['.', ','].map(d => {
    const lbl = d === '.' ? 'Period (.)' : 'Comma (,)';
    const det = d === s.detectedConfig.decimalSep ? ' (detected)' : '';
    const sel = d === s.parseConfig.decimalSep ? ' selected' : '';
    return `<option value="${d}"${sel}>${lbl}${det}</option>`;
  }).join('');

  const predLabel = isReg ? 'predicted_value' : 'predicted_class';
  const confLabel = isReg ? 'std_dev' : 'confidence';

  // Output target description
  let outTargetHtml;
  if (fsaaOut) {
    if (s.outputHandle) {
      outTargetHtml = `<button class="apply-pick-btn" onclick="applyPickOutput()">💾 Change…</button>
        <span class="apply-fname">${escHtml(s.outputName)}</span>`;
    } else {
      outTargetHtml = `<button class="apply-pick-btn" onclick="applyPickOutput()">💾 Choose output…</button>
        <span class="apply-fname-hint">streamed write (no RAM cap)</span>`;
    }
  } else {
    outTargetHtml = `<span class="apply-fname-hint">${escHtml(s.outputName)} (download — limited by RAM)</span>`;
  }

  // Progress bar (during run) or completion summary (after run)
  let progressHtml = '';
  if (s.running || (s.bytesRead > 0 && !s.completed)) {
    const pct = s.totalBytes > 0 ? Math.min(100, (s.bytesRead / s.totalBytes) * 100) : 0;
    progressHtml = `<div class="apply-progress">
         <div class="apply-progress-bar"><div class="apply-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
         <div class="apply-progress-stats">
           ${fmtBytes(s.bytesRead)} / ${fmtBytes(s.totalBytes)} · ${s.rowsOut.toLocaleString()} rows · ${pct.toFixed(1)}%
         </div>
       </div>`;
  } else if (s.completed) {
    progressHtml = renderCompletionSummary(s, isReg);
  }

  const inputDesc = s.inputFile
    ? `<span class="apply-fname">${escHtml(s.inputName)}</span> <span class="apply-fname-hint">${fmtBytes(s.inputFile.size)}</span>`
    : `<span class="apply-fname-hint">no file selected</span>`;

  // Preview table (shows what the parser thinks the header + first rows are)
  let previewHtml = '';
  if (s.headers.length || s.parseError) {
    if (s.parseError) {
      previewHtml = `<div class="apply-preview-error">${escHtml(s.parseError)}</div>`;
    } else {
      const cols = s.headers.slice(0, 6);
      const overflow = s.headers.length > 6 ? ` <span class="apply-fname-hint">…+${s.headers.length - 6} more</span>` : '';
      const headRow = '<tr>' + cols.map(h => `<th>${escHtml(h)}</th>`).join('') + '</tr>';
      const bodyRows = (s.previewRows.length ? s.previewRows : [[]]).map(row => {
        return '<tr>' + cols.map((_, i) => {
          const v = row[i];
          return `<td${v == null || v === '' ? ' class="apply-preview-empty"' : ''}>${v == null || v === '' ? '—' : escHtml(v)}</td>`;
        }).join('') + '</tr>';
      }).join('');
      previewHtml = `
        <div class="apply-preview-label">Preview (after header row ${s.headerRow})${overflow}</div>
        <table class="apply-preview-table">${headRow}${bodyRows}</table>`;
    }
  }

  host.innerHTML = `
    <div class="apply-dialog">
      <div class="dialog-hint">
        Streams an external CSV through the current tree, appending prediction columns to each row.
        For each <em>tree feature</em> below (left), pick which column in your input file provides
        its value (right). Auto-matched by name when possible. All input columns pass through to
        the output unchanged; only the prediction columns are added.
      </div>

      <div class="apply-section">
        <div class="apply-label">1. Input file</div>
        <div class="apply-row">
          <button class="apply-pick-btn" onclick="applyPickInput()">📂 ${s.inputFile ? 'Change…' : 'Choose file…'}</button>
          ${inputDesc}
        </div>
        <div class="apply-mode-hint">${fsaaIn ? 'FSAA streaming available' : 'Fallback (whole-file read)'}</div>
      </div>

      <div class="apply-section">
        <div class="apply-label">2. Parsing</div>
        <div class="apply-row apply-parse-row">
          <label>Delim</label>
          <select id="applyDelim" onchange="onApplyParseChange()">${delimOpts}</select>
          <label>Decimal</label>
          <select id="applyDecimal" onchange="onApplyParseChange()">${decOpts}</select>
        </div>
        <div class="apply-row apply-parse-row">
          <label title="1-indexed: which non-comment line is the column header">Header row</label>
          <input type="number" id="applyHeaderRow" min="1" step="1" value="${s.headerRow}"
            onchange="onApplyHeaderRowChange()" style="width:3.6rem;" />
          <label title="Lines starting with this prefix are skipped (set blank to disable)">Comment prefix</label>
          <input type="text" id="applyCommentPrefix" value="${escHtml(s.commentPrefix)}" maxlength="4"
            onchange="onApplyCommentPrefixChange()" style="width:3rem;" />
        </div>
        ${previewHtml}
      </div>

      <div class="apply-section">
        <div class="apply-label">3. Column mapping <span class="apply-label-sub">tree feature → input column</span></div>
        <div class="apply-mapping">${mappingHtml}</div>
      </div>

      <div class="apply-section">
        <div class="apply-label">4. Validation <span class="apply-label-sub">optional · pick the target column if your input has it</span></div>
        <div class="apply-row apply-parse-row">
          <label title="Tree predicts: ${escHtml(TREE && TREE._target || '')}">Target</label>
          <select id="applyTargetCol" onchange="onApplyTargetChange()">
            <option value="">(none — no validation)</option>
            ${s.headers.map(h => `<option value="${escHtml(h)}"${h === s.targetCol ? ' selected' : ''}>${escHtml(h)}</option>`).join('')}
          </select>
          ${s.targetCol ? `<span class="apply-fname-hint">→ confusion matrix / metrics in summary</span>` : `<span class="apply-fname-hint">prediction-only</span>`}
        </div>
      </div>

      <div class="apply-section">
        <div class="apply-label">5. Output columns <span class="apply-label-sub">appended after the input columns</span></div>
        <div class="apply-row apply-cols-row">
          <label><input type="checkbox" id="applyOutPred" ${s.outputCols.pred ? 'checked' : ''} onchange="onApplyOutColsChange()"> ${predLabel}</label>
          <label><input type="checkbox" id="applyOutConf" ${s.outputCols.conf ? 'checked' : ''} onchange="onApplyOutColsChange()"> ${confLabel}</label>
          <label><input type="checkbox" id="applyOutLeaf" ${s.outputCols.leaf ? 'checked' : ''} onchange="onApplyOutColsChange()"> leaf_id</label>
        </div>
      </div>

      <div class="apply-section">
        <div class="apply-label">6. Output target</div>
        <div class="apply-row">${outTargetHtml}</div>
      </div>

      ${progressHtml}

      <div class="dialog-error" id="applyError"></div>

      <div class="dialog-buttons">
        <button class="dialog-btn" onclick="closeApplyDialog()">${s.running ? 'Cancel' : 'Close'}</button>
        <button class="dialog-btn dialog-btn-primary" onclick="applyRun()" ${canRun ? '' : 'disabled'}>
          ${s.running ? '⏳ Running…' : (s.completed ? '↻ Run again' : '▶ Run')}
        </button>
      </div>
    </div>`;
}

function refreshApplyDialog() {
  const host = _floatingHosts['apply-tree'];
  if (host) renderApplyDialog(host);
}

function closeApplyDialog() {
  const s = _applyState;
  if (s && s.running) {
    s.cancelled = true;
    if (s.worker) { try { s.worker.terminate(); } catch (e) {} s.worker = null; }
    s.running = false;
    showToast('Apply cancelled');
  }
  closeFloatingPanel('apply-tree');
  _applyState = null;
}

// ─── input picker ──────────────────────────────────────────────
async function applyPickInput() {
  const s = _applyState;
  if (!s) return;
  let file = null;
  let handle = null;

  if (typeof window.showOpenFilePicker === 'function') {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv', '.tsv', '.txt'] } }],
        multiple: false,
      });
      handle = h;
      file = await h.getFile();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      // Fall through to <input> fallback
    }
  }

  if (!file) {
    file = await pickViaInput();
    if (!file) return;
  }

  s.inputHandle = handle;
  s.inputFile = file;
  s.inputName = file.name;
  s.featureMap = {};
  s.targetCol = '';
  s.delimChosen = false;
  s.decimalChosen = false;

  // Read sample, then run the shared parse pipeline. If the file's headers
  // match a saved preset, restore it and re-run with those settings so the
  // user lands on a fully-configured dialog.
  try {
    const sampleBlob = file.slice(0, Math.min(APPLY_SAMPLE_BYTES, file.size));
    const sampleBuf = await sampleBlob.arrayBuffer();
    s.sampleText = new TextDecoder('utf-8', { fatal: false }).decode(sampleBuf);
    recomputeFromSample();
    if (tryRestoreApplyPreset()) {
      recomputeFromSample();
      showToast('🔁 Restored mapping from previous run');
    }
    setApplyError('');
  } catch (e) {
    setApplyError('Could not read sample: ' + (e.message || e));
  }

  refreshApplyDialog();
}

function pickViaInput() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.csv,.tsv,.txt';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      document.body.removeChild(inp);
      resolve(f || null);
    });
    inp.click();
  });
}

// ─── output picker ─────────────────────────────────────────────
async function applyPickOutput() {
  const s = _applyState;
  if (!s) return;
  if (typeof window.showSaveFilePicker !== 'function') return;
  const suggested = s.inputName
    ? s.inputName.replace(/\.[^.]+$/, '') + '_predictions.csv'
    : 'predictions.csv';
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggested,
      types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
    });
    s.outputHandle = handle;
    s.outputName = handle.name || suggested;
    setApplyError('');
  } catch (e) {
    if (!(e && e.name === 'AbortError')) {
      setApplyError('Output picker failed: ' + (e.message || e));
    }
  }
  refreshApplyDialog();
}

// ─── change handlers ───────────────────────────────────────────
function onApplyMapChange(featureIdx, col) {
  const s = _applyState;
  if (!s) return;
  const used = getUsedFeatures();
  const feature = used[featureIdx];
  if (!feature) return;
  if (col) s.featureMap[feature] = col;
  else delete s.featureMap[feature];
  refreshApplyDialog();
}

function onApplyParseChange() {
  const s = _applyState;
  if (!s) return;
  const dEl = document.getElementById('applyDelim');
  const ddEl = document.getElementById('applyDecimal');
  if (!dEl || !ddEl) return;
  const delim = dEl.value === 'TAB' ? '\t' : dEl.value;
  s.parseConfig.delimiter = delim;
  s.parseConfig.decimalSep = ddEl.value;
  s.delimChosen = true;
  s.decimalChosen = true;
  recomputeFromSample();
  refreshApplyDialog();
}

function onApplyHeaderRowChange() {
  const s = _applyState;
  if (!s) return;
  const v = parseInt(document.getElementById('applyHeaderRow')?.value, 10);
  if (!isFinite(v) || v < 1) return;
  s.headerRow = v;
  recomputeFromSample();
  refreshApplyDialog();
}

function onApplyCommentPrefixChange() {
  const s = _applyState;
  if (!s) return;
  const el = document.getElementById('applyCommentPrefix');
  if (!el) return;
  s.commentPrefix = el.value;
  recomputeFromSample();
  refreshApplyDialog();
}

function onApplyTargetChange() {
  const s = _applyState;
  if (!s) return;
  s.targetCol = document.getElementById('applyTargetCol')?.value || '';
  refreshApplyDialog();
}

function onApplyOutColsChange() {
  const s = _applyState;
  if (!s) return;
  s.outputCols.pred = !!document.getElementById('applyOutPred')?.checked;
  s.outputCols.conf = !!document.getElementById('applyOutConf')?.checked;
  s.outputCols.leaf = !!document.getElementById('applyOutLeaf')?.checked;
}

// ─── helpers ───────────────────────────────────────────────────
function setApplyError(msg) {
  const el = document.getElementById('applyError');
  if (el) el.textContent = msg || '';
}

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function fmtNum(v, digits = 3) {
  if (!isFinite(v)) return '—';
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toPrecision(digits);
}

function renderCompletionSummary(s, isReg) {
  const stats = s.stats;
  const elapsedSec = (s.elapsedMs / 1000);
  const rate = elapsedSec > 0 ? Math.round(s.rowsOut / elapsedSec) : 0;
  const head = `<div class="apply-done-head">
    ✓ Completed · ${s.rowsOut.toLocaleString()} rows · ${fmtBytes(s.bytesRead)} ·
    ${elapsedSec.toFixed(2)}s${rate ? ` (${rate.toLocaleString()} rows/s)` : ''}
  </div>`;

  if (!stats) return `<div class="apply-done">${head}</div>`;

  // Predicted distribution
  let distHtml;
  if (isReg) {
    const n = stats.valN;
    const mean = n ? stats.valSum / n : 0;
    const variance = n ? Math.max(0, stats.valSumSq / n - mean * mean) : 0;
    const std = Math.sqrt(variance);
    distHtml = `<div class="apply-done-section">
      <div class="apply-done-label">Predicted value</div>
      <div class="apply-done-stats">
        <span>min ${fmtNum(stats.valMin)}</span>
        <span>mean ${fmtNum(mean)}</span>
        <span>max ${fmtNum(stats.valMax)}</span>
        <span>σ ${fmtNum(std)}</span>
      </div>
    </div>`;
  } else {
    const entries = Object.entries(stats.classCounts).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
    const rows = entries.map(([cls, n]) => {
      const pct = (n / total) * 100;
      return `<div class="apply-done-bar-row">
        <span class="apply-done-bar-label" title="${escHtml(cls)}">${escHtml(cls)}</span>
        <span class="apply-done-bar-track"><span class="apply-done-bar-fill" style="width:${pct.toFixed(1)}%"></span></span>
        <span class="apply-done-bar-val">${n.toLocaleString()} <span class="apply-done-bar-pct">${pct.toFixed(1)}%</span></span>
      </div>`;
    }).join('');
    distHtml = `<div class="apply-done-section">
      <div class="apply-done-label">Predicted class distribution</div>
      ${rows}
    </div>`;
  }

  // Confidence summary
  const c = stats.confN ? stats.confSum / stats.confN : 0;
  const confLabel = isReg ? 'Std-dev (model uncertainty)' : 'Confidence';
  const confHtml = stats.confN
    ? `<div class="apply-done-section">
        <div class="apply-done-label">${confLabel}</div>
        <div class="apply-done-stats">
          <span>mean ${fmtNum(c)}</span>
          <span>min ${fmtNum(stats.confMin)}</span>
          <span>max ${fmtNum(stats.confMax)}</span>
        </div>
      </div>`
    : '';

  // Per-feature comparison (train vs new). Flag drift in amber.
  let driftHtml = '';
  const tr = s.trainingStats || {};
  const featStats = stats.featureStats || {};
  const featNames = Object.keys(featStats);
  if (featNames.length) {
    const rows = featNames.map(f => {
      const t = tr[f];
      const n = featStats[f];
      if (!n) return '';
      const totalRows = s.rowsOut;
      const missingPct = totalRows ? (n.missing / totalRows) * 100 : 0;
      const missingTag = missingPct >= 1
        ? `<span class="apply-drift-flag" title="${n.missing.toLocaleString()} missing/unparseable in new (${missingPct.toFixed(1)}%)">⚠ ${missingPct.toFixed(0)}% missing</span>`
        : '';

      if (n.type === 'numeric') {
        const newMean = n.n ? n.sum / n.n : 0;
        const trCell = t ? `${fmtNum(t.min)}–${fmtNum(t.max)} <span class="apply-drift-mu">µ ${fmtNum(t.mean)}</span>` : '<span class="apply-fname-hint">—</span>';
        const newCell = n.n
          ? `${fmtNum(n.min)}–${fmtNum(n.max)} <span class="apply-drift-mu">µ ${fmtNum(newMean)}</span>`
          : '<span class="apply-fname-hint">no values</span>';
        let flag = '';
        if (t && n.n) {
          const out = (n.min < t.min) || (n.max > t.max);
          const meanShift = t.std > 0 ? Math.abs(newMean - t.mean) / t.std : 0;
          if (out) flag = `<span class="apply-drift-flag" title="New range escapes training range — predictions extrapolate.">⚠ out of range</span>`;
          else if (meanShift > 2) flag = `<span class="apply-drift-flag" title="New mean shifted by ${meanShift.toFixed(1)}σ vs training">⚠ ${meanShift.toFixed(1)}σ shift</span>`;
        }
        return `<div class="apply-drift-row">
          <span class="apply-drift-feat">${escHtml(f)} <span class="apply-drift-type">#</span></span>
          <span class="apply-drift-train">${trCell}</span>
          <span class="apply-drift-arrow">→</span>
          <span class="apply-drift-new">${newCell}</span>
          <span class="apply-drift-flags">${flag}${flag && missingTag ? ' ' : ''}${missingTag}</span>
        </div>`;
      } else {
        const trCats = t ? new Set(t.categories) : new Set();
        const newCats = Object.keys(n.counts);
        const novel = newCats.filter(c => !trCats.has(c));
        const trCell = t
          ? `${trCats.size} cats <span class="apply-fname-hint">(${[...trCats].slice(0, 3).map(escHtml).join(', ')}${trCats.size > 3 ? '…' : ''})</span>`
          : '<span class="apply-fname-hint">—</span>';
        const newCell = `${newCats.length} cats <span class="apply-fname-hint">(${newCats.slice(0, 3).map(escHtml).join(', ')}${newCats.length > 3 ? '…' : ''})</span>`;
        let flag = '';
        if (novel.length) {
          const sample = novel.slice(0, 3).map(escHtml).join(', ');
          flag = `<span class="apply-drift-flag" title="${novel.length} value${novel.length === 1 ? '' : 's'} not in training: ${sample}${novel.length > 3 ? '…' : ''}">⚠ ${novel.length} novel</span>`;
        }
        return `<div class="apply-drift-row">
          <span class="apply-drift-feat">${escHtml(f)} <span class="apply-drift-type">●</span></span>
          <span class="apply-drift-train">${trCell}</span>
          <span class="apply-drift-arrow">→</span>
          <span class="apply-drift-new">${newCell}</span>
          <span class="apply-drift-flags">${flag}${flag && missingTag ? ' ' : ''}${missingTag}</span>
        </div>`;
      }
    }).filter(Boolean).join('');
    driftHtml = `<div class="apply-done-section">
      <div class="apply-done-label">Feature drift <span class="apply-done-sub">training → new dataset</span></div>
      ${rows}
    </div>`;
  }

  // Top leaves
  const leafEntries = Object.entries(stats.leafCounts).sort((a, b) => b[1] - a[1]);
  const topLeaves = leafEntries.slice(0, 5);
  const totalLeafHits = leafEntries.reduce((a, [, n]) => a + n, 0) || 1;
  const leafHtml = topLeaves.length
    ? `<div class="apply-done-section">
        <div class="apply-done-label">
          Top leaves <span class="apply-done-sub">(${leafEntries.length} of ${TREE ? countNodes(TREE).leaves : '?'} hit)</span>
        </div>
        ${topLeaves.map(([id, n]) => {
          const pct = (n / totalLeafHits) * 100;
          return `<div class="apply-done-leaf-row">
            <span class="apply-done-leaf-id">leaf #${escHtml(id)}</span>
            <span class="apply-done-leaf-bar"><span class="apply-done-leaf-fill" style="width:${pct.toFixed(1)}%"></span></span>
            <span class="apply-done-leaf-val">${n.toLocaleString()} <span class="apply-done-bar-pct">${pct.toFixed(1)}%</span></span>
          </div>`;
        }).join('')}
      </div>`
    : '';

  const validationHtml = renderValidationBlock(stats.validation, isReg);

  return `<div class="apply-done">${head}${validationHtml}${distHtml}${confHtml}${driftHtml}${leafHtml}</div>`;
}

function renderValidationBlock(v, isReg) {
  if (!v || !v.enabled) return '';
  if (isReg) {
    if (v.actualN < 2) {
      return `<div class="apply-done-section apply-done-validation">
        <div class="apply-done-label">Validation <span class="apply-done-sub">vs target column</span></div>
        <div class="apply-fname-hint">Not enough numeric target values to compute metrics.</div>
      </div>`;
    }
    const meanA = v.actualSum / v.actualN;
    const ssTot = v.actualSumSq - v.actualSum * v.actualSum / v.actualN;
    const ssRes = v.residSumSq;
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : (ssRes === 0 ? 1 : 0);
    const rmse = Math.sqrt(ssRes / v.actualN);
    const mae = v.absResidSum / v.actualN;
    const bias = v.residSum / v.actualN;
    return `<div class="apply-done-section apply-done-validation">
      <div class="apply-done-label">Validation <span class="apply-done-sub">vs target column · ${v.actualN.toLocaleString()} matched rows</span></div>
      <div class="apply-done-stats">
        <span>R² <strong>${fmtNum(r2)}</strong></span>
        <span>RMSE <strong>${fmtNum(rmse)}</strong></span>
        <span>MAE <strong>${fmtNum(mae)}</strong></span>
        <span title="Mean signed residual (actual − predicted). >0 means tree underpredicts.">bias <strong>${bias >= 0 ? '+' : ''}${fmtNum(bias)}</strong></span>
        <span>µ actual ${fmtNum(meanA)}</span>
      </div>
    </div>`;
  }
  // Classification: confusion matrix + accuracy
  if (v.matchedCount === 0) {
    return `<div class="apply-done-section apply-done-validation">
      <div class="apply-done-label">Validation <span class="apply-done-sub">vs target column</span></div>
      <div class="apply-fname-hint">No non-empty target values seen.</div>
    </div>`;
  }
  const acc = v.correctCount / v.matchedCount;
  // Collect class labels — union of actual + predicted, ordered with TREE's
  // training classes first (consistent layout with the Validation panel).
  const seen = new Set();
  const orderedClasses = [];
  if (TREE && TREE._classes) {
    for (const c of TREE._classes) { seen.add(c); orderedClasses.push(c); }
  }
  for (const a of Object.keys(v.confusion)) {
    if (!seen.has(a)) { seen.add(a); orderedClasses.push(a); }
    for (const p of Object.keys(v.confusion[a])) {
      if (!seen.has(p)) { seen.add(p); orderedClasses.push(p); }
    }
  }
  // Per-actual totals + diagonal counts
  const head = '<tr><th class="apply-cm-corner">actual ↓ / pred →</th>' +
    orderedClasses.map(c => `<th>${escHtml(c)}</th>`).join('') + '</tr>';
  const body = orderedClasses.map(actual => {
    const row = v.confusion[actual] || {};
    const rowTotal = Object.values(row).reduce((a, b) => a + b, 0);
    const cells = orderedClasses.map(predicted => {
      const n = row[predicted] || 0;
      if (n === 0) return `<td class="apply-cm-zero">·</td>`;
      const isDiag = predicted === actual;
      const cls = isDiag ? 'apply-cm-diag' : 'apply-cm-off';
      const pct = rowTotal ? (n / rowTotal) * 100 : 0;
      return `<td class="${cls}" title="${pct.toFixed(1)}% of actual ${escHtml(actual)}">${n.toLocaleString()}</td>`;
    }).join('');
    return `<tr><th class="apply-cm-row">${escHtml(actual)} <span class="apply-cm-rowtot">${rowTotal.toLocaleString()}</span></th>${cells}</tr>`;
  }).join('');
  return `<div class="apply-done-section apply-done-validation">
    <div class="apply-done-label">Validation <span class="apply-done-sub">vs target column · ${v.matchedCount.toLocaleString()} matched rows</span></div>
    <div class="apply-done-stats">
      <span>Accuracy <strong>${(acc * 100).toFixed(1)}%</strong></span>
      <span>${v.correctCount.toLocaleString()} / ${v.matchedCount.toLocaleString()} correct</span>
    </div>
    <div class="apply-cm-wrap">
      <table class="apply-cm">${head}${body}</table>
    </div>
  </div>`;
}

function spawnPredictWorker() {
  const src = document.getElementById('predict-worker')?.textContent;
  if (!src) throw new Error('Worker source not found');
  const blob = new Blob([src], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const w = new Worker(url);
  // Revoke shortly after spawn — Chrome keeps the script alive once the worker
  // is loaded. (If we revoke too early on Safari it can race; small delay.)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return w;
}

// ─── run ───────────────────────────────────────────────────────
async function applyRun() {
  const s = _applyState;
  if (!s || s.running) return;
  if (!s.inputFile) { setApplyError('Pick an input file first.'); return; }

  const features = getUsedFeatures();
  const missing = features.filter(f => !s.featureMap[f]);
  if (missing.length) {
    setApplyError(`Map all features (${missing.length} unmapped).`);
    return;
  }
  if (!s.outputCols.pred && !s.outputCols.conf && !s.outputCols.leaf) {
    setApplyError('Select at least one output column.');
    return;
  }

  s.running = true;
  s.completed = false;
  s.cancelled = false;
  s.bytesRead = 0;
  s.totalBytes = s.inputFile.size;
  s.rowsOut = 0;
  s.startedAt = performance.now();
  s.elapsedMs = 0;
  s.stats = null;
  s.trainingStats = gatherTrainingStats(features);
  setApplyError('');
  refreshApplyDialog();

  // Sink: FSAA writable or memory-collected for download
  const usingFSAA = !!s.outputHandle;
  let writable = null;
  let memChunks = null;
  if (usingFSAA) {
    try {
      writable = await s.outputHandle.createWritable();
    } catch (e) {
      s.running = false;
      setApplyError('Could not open output: ' + (e.message || e));
      refreshApplyDialog();
      return;
    }
  } else {
    memChunks = [];
  }

  // Build column index map
  const headerToIdx = {};
  s.headers.forEach((h, i) => { headerToIdx[h] = i; });
  const featureColIdx = {};
  for (const f of features) {
    const col = s.featureMap[f];
    featureColIdx[f] = col != null && headerToIdx[col] != null ? headerToIdx[col] : -1;
  }
  const outputInputColIdx = s.headers.map((_, i) => i); // pass through all input cols

  const isReg = TREE._mode === 'regression';
  const predLabel = isReg ? 'predicted_value' : 'predicted_class';
  const confLabel = isReg ? 'std_dev' : 'confidence';

  // Output header line
  const outHeaderCols = [...s.headers];
  if (s.outputCols.pred) outHeaderCols.push(predLabel);
  if (s.outputCols.conf) outHeaderCols.push(confLabel);
  if (s.outputCols.leaf) outHeaderCols.push('leaf_id');
  const headerLine = outHeaderCols
    .map(h => /[",\n]/.test(h) ? '"' + h.replace(/"/g, '""') + '"' : h)
    .join(s.parseConfig.delimiter) + '\n';

  const writeText = async (text) => {
    if (!text) return;
    if (usingFSAA) await writable.write(text);
    else memChunks.push(text);
  };

  // Spawn worker
  let worker;
  try {
    worker = spawnPredictWorker();
  } catch (e) {
    s.running = false;
    setApplyError('Worker spawn failed: ' + e.message);
    if (writable) try { await writable.abort(); } catch {}
    refreshApplyDialog();
    return;
  }
  s.worker = worker;

  // Promise-based ack handshake (one in flight at a time)
  let pending = null;
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'error') {
      const p = pending; pending = null;
      p && p.reject(new Error(m.error));
      return;
    }
    if (m.type === 'ready' || m.type === 'output') {
      const p = pending; pending = null;
      p && p.resolve(m);
    }
  };
  worker.onerror = (e) => {
    const p = pending; pending = null;
    p && p.reject(new Error(e.message || 'Worker error'));
  };

  const ask = (msg) => new Promise((resolve, reject) => {
    if (s.cancelled) { reject(new Error('cancelled')); return; }
    pending = { resolve, reject };
    worker.postMessage(msg);
  });

  try {
    await writeText(headerLine);

    await ask({
      type: 'init',
      tree: cloneTreeForWorker(TREE),
      delim: s.parseConfig.delimiter,
      decimalSep: s.parseConfig.decimalSep,
      featureColIdx,
      featureTypes: getUsedFeatureTypes(),
      outputInputColIdx,
      outputCols: s.outputCols,
      isReg,
      commentPrefix: s.commentPrefix || '',
      targetColIdx: (s.targetCol && headerToIdx[s.targetCol] != null) ? headerToIdx[s.targetCol] : -1,
    });

    // Stream the file in byte chunks via Blob.slice + TextDecoder(stream).
    // Header phase: skip empty + comment lines, count to s.headerRow, then
    // skip that header line itself. Body phase: pass straight to worker.
    // (Worker also re-checks comment lines in case any appear mid-stream.)
    const file = s.inputFile;
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let pos = 0;
    let pendingText = '';
    let isFirstChunk = true;
    let headerSkipped = false;
    let nonSkipCount = 0;

    const isSkippableLine = (line) => {
      if (!line.trim()) return true;
      if (s.commentPrefix && line.trimStart().startsWith(s.commentPrefix)) return true;
      return false;
    };

    const stripHeaderPhase = () => {
      // Consume complete lines from pendingText until we've consumed the
      // headerRow-th non-skippable line. Returns true if header has been
      // fully consumed (and pendingText now starts at body).
      while (true) {
        const nl = pendingText.indexOf('\n');
        if (nl < 0) return false; // need more bytes
        let line = pendingText.slice(0, nl);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        pendingText = pendingText.slice(nl + 1);
        if (isSkippableLine(line)) continue;
        nonSkipCount++;
        if (nonSkipCount === s.headerRow) return true;
      }
    };

    while (pos < file.size) {
      if (s.cancelled) throw new Error('cancelled');
      const end = Math.min(pos + APPLY_CHUNK_BYTES, file.size);
      const isLastByteChunk = end === file.size;
      const buf = await file.slice(pos, end).arrayBuffer();
      let text = decoder.decode(buf, { stream: !isLastByteChunk });
      pos = end;

      if (isFirstChunk) {
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        isFirstChunk = false;
      }

      pendingText += text;

      if (!headerSkipped) {
        headerSkipped = stripHeaderPhase();
        if (!headerSkipped) {
          if (isLastByteChunk) {
            // Reached EOF while still searching for the header — no data rows.
            pendingText = '';
            break;
          }
          s.bytesRead = pos;
          refreshApplyDialog();
          continue;
        }
      }

      const reply = await ask({ type: 'chunk', text: pendingText, isLast: isLastByteChunk });
      pendingText = '';
      if (reply.text) await writeText(reply.text);
      s.rowsOut = reply.totalRows || s.rowsOut;
      s.bytesRead = pos;
      if (reply.stats) s.stats = reply.stats;
      refreshApplyDialog();
    }

    // Defensive flush: any leftover (e.g. file ends without newline after
    // header has been stripped, but loop didn't ask isLast=true on the final
    // pendingText).
    if (headerSkipped && pendingText) {
      const reply = await ask({ type: 'chunk', text: pendingText, isLast: true });
      if (reply.text) await writeText(reply.text);
      s.rowsOut = reply.totalRows || s.rowsOut;
      if (reply.stats) s.stats = reply.stats;
    }

    // Finalise output
    if (usingFSAA) {
      await writable.close();
    } else {
      const blob = new Blob(memChunks, { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = s.outputName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    s.elapsedMs = performance.now() - s.startedAt;
    const elapsed = (s.elapsedMs / 1000).toFixed(1);
    showToast(`🌲 Applied tree · ${s.rowsOut.toLocaleString()} rows · ${fmtBytes(s.bytesRead)} · ${elapsed}s`);
    s.running = false;
    s.completed = true;
    s.worker = null;
    try { worker.terminate(); } catch {}
    saveApplyPreset();
    refreshApplyDialog();
  } catch (err) {
    if (writable) { try { await writable.abort(); } catch {} }
    try { worker.terminate(); } catch {}
    s.worker = null;
    s.running = false;
    if (err && err.message === 'cancelled') {
      showToast('Apply cancelled');
    } else {
      setApplyError('Run failed: ' + (err && err.message || err));
    }
    refreshApplyDialog();
  }
}
