// ═══════════════════════════════════════
//  PANEL: Validation (holdout metrics on every tree edit)
// ═══════════════════════════════════════

let _validationPanelElement = null;
function getValidationPanelElement() {
  if (_validationPanelElement) return _validationPanelElement;
  const tpl = document.getElementById('tpl-validation-panel');
  _validationPanelElement = tpl.content.firstElementChild.cloneNode(true);
  // The cloned element is detached at this moment — document.getElementById
  // can't find children of the panel yet, so scope queries to the root.
  initValidationPanelListeners(_validationPanelElement);
  return _validationPanelElement;
}

function initValidationPanelListeners(root) {
  const strat = root.querySelector('#valStrategy');
  const sizeVal = root.querySelector('#valSizeValue');
  const sizeUnit = root.querySelector('#valSizeUnit');
  const resample = root.querySelector('#valResampleBtn');
  const buffer = root.querySelector('#valBuffer');
  if (!strat) return;

  const applySplit = (reseed) => {
    const seed = reseed ? Date.now() : (CURRENT_SPLIT?.seed ?? Date.now());
    setCurrentSplit(strat.value, { value: parseFloat(sizeVal.value), unit: sizeUnit.value }, seed);
    renderValidationPanel();
  };

  strat.addEventListener('change', () => applySplit(false));
  sizeVal.addEventListener('change', () => applySplit(false));
  sizeUnit.addEventListener('change', () => applySplit(false));
  resample.addEventListener('click', () => applySplit(true));
  buffer.addEventListener('input', renderValidationPanel);

  // Debounced subscribe for reactive rescoring.
  let rescoreTimer = null;
  const scheduleRescore = () => {
    clearTimeout(rescoreTimer);
    rescoreTimer = setTimeout(renderValidationPanel, 50);
  };
  subscribe('tree', scheduleRescore);
  subscribe('split', scheduleRescore);
  subscribe('dataset', scheduleRescore);
  subscribe('columns', scheduleRescore);
}

function renderValidationPanel() {
  // See importance.js — dockview may not have attached the panel to the
  // live DOM if it's on an inactive tab. Query the cached root instead.
  const root = _validationPanelElement;
  if (!root) return;
  const metricsEl = root.querySelector('#valMetrics');
  const confusionEl = root.querySelector('#valConfusion');
  if (!metricsEl || !confusionEl) return;

  // Update the size echo ("= 60 samples") whenever inputs or data change.
  updateValSizeEcho();

  if (!DATA) {
    metricsEl.innerHTML = '<div class="val-empty">Load a dataset first.</div>';
    confusionEl.innerHTML = '';
    return;
  }
  if (!CURRENT_SPLIT) {
    metricsEl.innerHTML = '<div class="val-empty">No partition yet.</div>';
    confusionEl.innerHTML = '';
    return;
  }

  const n_train = CURRENT_SPLIT.trainRows.size;
  const n_test = CURRENT_SPLIT.testRows.size;

  if (!TREE) {
    metricsEl.innerHTML = `
      <div class="val-empty">
        Partition ready (n<sub>train</sub> = ${n_train}, n<sub>test</sub> = ${n_test}).
        Grow a tree to see scores.
      </div>`;
    confusionEl.innerHTML = '';
    return;
  }

  const target = TREE._target;
  const isReg = TREE._mode === 'regression';
  const validOf = (rows) => rows.filter(r => {
    const v = r[target];
    return v !== '' && v !== 'NA' && v !== 'null' && v != null;
  });
  const trainRows = validOf(getTrainingRows());
  const testRows = validOf(getTestRows());
  const trainM = computeMetrics(TREE, trainRows, isReg);
  const testM = computeMetrics(TREE, testRows, isReg);

  // Autocorrelation-leakage diagnostic: split the test set into leaky
  // (within buffer of any train sample) and isolated (outside buffer).
  const roles = getColumnRoles();
  const hasCoords = !!(roles && (roles.x || roles.y || roles.z));
  const bufferSection = root.querySelector('#valBufferSection');
  if (bufferSection) bufferSection.style.display = hasCoords ? '' : 'none';

  let leakyHtml = '';
  if (hasCoords && trainRows.length > 0 && testRows.length > 0) {
    const coordCols = { x: roles.x, y: roles.y, z: roles.z };
    const dists = computeTestDistances(testRows, trainRows, coordCols);
    const summary = summarizeDistances(dists);
    const bufferInput = root.querySelector('#valBuffer');
    const buffer = parseFloat(bufferInput?.value) || 0;
    updateBufferHint(root, summary, buffer);
    if (buffer > 0) {
      const { leaky, isolated } = splitLeakyIsolated(dists, buffer);
      const leakyM = computeMetrics(TREE, leaky, isReg);
      const isoM = computeMetrics(TREE, isolated, isReg);
      leakyHtml = renderLeakyIsolatedHtml(leakyM, isoM, isReg, buffer);
    }
  }

  metricsEl.innerHTML = renderMetricsHtml(trainM, testM, isReg) + leakyHtml;
  confusionEl.innerHTML = isReg ? '' : renderConfusionMatrix(testM);

  // Hide the confusion section for regression.
  const confSection = root.querySelector('#valConfusionSection');
  if (confSection) confSection.style.display = isReg ? 'none' : '';
}

function updateBufferHint(root, summary, buffer) {
  const el = root.querySelector('#valBufferHint');
  if (!el) return;
  if (!summary) { el.textContent = ''; return; }
  const fmt = (v) => v.toFixed(2);
  const hint = `min-dist percentiles — 25%: ${fmt(summary.q25)} · 50%: ${fmt(summary.median)} · 75%: ${fmt(summary.q75)}`;
  const advice = buffer === 0
    ? ' · set buffer above 0 to activate'
    : '';
  el.textContent = hint + advice;
}

function renderLeakyIsolatedHtml(leakyM, isoM, isReg, buffer) {
  if (isReg) {
    const leak = leakyM?.r2 ?? NaN;
    const iso = isoM?.r2 ?? NaN;
    return `
      <div class="val-leaky-box">
        <div class="val-section-label">Autocorrelation leakage (buffer = ${buffer})</div>
        <div class="val-leaky-row"><span>Leaky test (≤ buffer)</span><span>R² ${isFinite(leak) ? leak.toFixed(3) : '—'} · n=${leakyM?.n ?? 0}</span></div>
        <div class="val-leaky-row"><span>Isolated test (> buffer)</span><span>R² ${isFinite(iso) ? iso.toFixed(3) : '—'} · n=${isoM?.n ?? 0}</span></div>
      </div>`;
  }
  const leak = leakyM ? leakyM.accuracy * 100 : NaN;
  const iso = isoM ? isoM.accuracy * 100 : NaN;
  const deltaStr = (isFinite(leak) && isFinite(iso))
    ? `Δ = ${(leak - iso).toFixed(1)} pp`
    : 'Δ = —';
  return `
    <div class="val-leaky-box">
      <div class="val-section-label">Autocorrelation leakage (buffer = ${buffer})</div>
      <div class="val-leaky-row"><span>Leaky test (≤ buffer)</span><span>${isFinite(leak) ? leak.toFixed(1) + '%' : '—'} · n=${leakyM?.n ?? 0}</span></div>
      <div class="val-leaky-row"><span>Isolated test (> buffer)</span><span>${isFinite(iso) ? iso.toFixed(1) + '%' : '—'} · n=${isoM?.n ?? 0}</span></div>
      <div class="val-leaky-delta">${deltaStr}</div>
    </div>`;
}

function renderMetricsHtml(trainM, testM, isReg) {
  if (isReg) {
    return `
      <div class="val-score-grid">
        <div class="val-score">
          <div class="val-score-label">Train</div>
          <div class="val-score-value">R² ${trainM ? trainM.r2.toFixed(3) : '—'}</div>
          <div class="val-score-sub">RMSE ${trainM ? trainM.rmse.toFixed(3) : '—'} (n=${trainM?.n ?? 0})</div>
        </div>
        <div class="val-score">
          <div class="val-score-label">Test</div>
          <div class="val-score-value">R² ${testM ? testM.r2.toFixed(3) : '—'}</div>
          <div class="val-score-sub">RMSE ${testM ? testM.rmse.toFixed(3) : '—'} (n=${testM?.n ?? 0})</div>
        </div>
      </div>
    `;
  }
  const trainPct = trainM ? (trainM.accuracy * 100).toFixed(1) : '—';
  const testPct = testM ? (testM.accuracy * 100).toFixed(1) : '—';
  const kappa = testM ? testM.kappa.toFixed(3) : '—';
  return `
    <div class="val-score-grid">
      <div class="val-score">
        <div class="val-score-label">Train</div>
        <div class="val-score-value">${trainPct}%</div>
        <div class="val-score-sub">n=${trainM?.n ?? 0}</div>
      </div>
      <div class="val-score">
        <div class="val-score-label">Test</div>
        <div class="val-score-value">${testPct}%</div>
        <div class="val-score-sub">κ = ${kappa} · n=${testM?.n ?? 0}</div>
      </div>
    </div>
  `;
}

function renderConfusionMatrix(m) {
  if (!m || !m.confusion) return '';
  const { confusion, classes } = m;
  const K = classes.length;
  if (K === 0) return '';
  let maxCell = 0;
  for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) maxCell = Math.max(maxCell, confusion[i][j]);
  const cellBg = (v) => {
    if (!maxCell) return 'transparent';
    const intensity = v / maxCell;
    return `rgba(76, 175, 80, ${(intensity * 0.55).toFixed(3)})`;
  };
  let html = '<table class="val-confusion"><thead><tr><th></th><th colspan="' + K + '" class="cm-corner">predicted →</th></tr><tr><th></th>';
  for (const c of classes) html += `<th class="cm-col-head">${c}</th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i < K; i++) {
    html += `<tr><th class="cm-row-head">${classes[i]}</th>`;
    for (let j = 0; j < K; j++) {
      const v = confusion[i][j];
      const diag = i === j ? ' cm-diag' : '';
      html += `<td class="cm-cell${diag}" style="background:${cellBg(v)}">${v}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  // Per-class precision/recall summary below
  html += '<div class="val-perclass">';
  for (const pc of m.perClass) {
    const prec = (pc.precision * 100).toFixed(0);
    const rec = (pc.recall * 100).toFixed(0);
    html += `<div class="val-pc-row"><span class="pc-class">${pc.class}</span><span class="pc-stats">P ${prec}% · R ${rec}% · n=${pc.support}</span></div>`;
  }
  html += '</div>';
  return html;
}

function updateValSizeEcho() {
  const root = _validationPanelElement;
  if (!root) return;
  const echo = root.querySelector('#valSizeEcho');
  const stratEl = root.querySelector('#valStrategy');
  const sizeVal = root.querySelector('#valSizeValue');
  const sizeUnit = root.querySelector('#valSizeUnit');
  if (!echo || !DATA) { if (echo) echo.textContent = ''; return; }
  const strategy = stratEl.value;
  const value = parseFloat(sizeVal.value) || 0;
  const unit = sizeUnit.value;
  if (strategy === 'dhid') {
    const dhidCol = getColumnRoles()?.dhid;
    if (!dhidCol) { echo.textContent = '(no drillhole column → falls back to random)'; return; }
    const totalHoles = new Set(DATA.rows.map(r => r[dhidCol])).size;
    const n = unit === 'percent' ? Math.round(totalHoles * value / 100) : Math.round(value);
    echo.textContent = `= ${Math.min(n, totalHoles)} of ${totalHoles} drillholes`;
  } else {
    const total = DATA.rows.length;
    const n = unit === 'percent' ? Math.round(total * value / 100) : Math.round(value);
    echo.textContent = `= ${Math.min(n, total)} of ${total} samples`;
  }
}
