// ═══════════════════════════════════════
//  FILE HANDLING
// ═══════════════════════════════════════
// Called by app.js once panels are mounted (template DOM is live).
function initDataPanelFileDrop() {
  const dropZones = document.querySelectorAll('.drop-zone');
  const fileInput = document.getElementById('fileInput');
  if (!fileInput) return;
  dropZones.forEach(dz => {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) readCSVFile(e.dataTransfer.files[0]);
    });
  });
  fileInput.addEventListener('change', e => { if (e.target.files[0]) readCSVFile(e.target.files[0]); });
}

function readCSVFile(file) {
  const reader = new FileReader();
  reader.onload = e => { const name = file.name.replace(/\.[^.]+$/, ''); loadData(e.target.result); if (DATA) DATA._name = name; showToast(`Loaded ${file.name}`); };
  reader.readAsText(file);
}

// ═══════════════════════════════════════
//  PROJECTS — IndexedDB storage
// ═══════════════════════════════════════
const DB_NAME = 'arborist_db';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(project) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(project);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(name) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function buildProjectPayload() {
  return {
    savedAt: new Date().toISOString(),
    mode: TREE_MODE,
    config: {
      target: document.getElementById('targetSelect').value,
      maxDepth: document.getElementById('maxDepth').value,
      minLeaf: document.getElementById('minLeaf').value,
      minSplit: document.getElementById('minSplit').value,
    },
    types: DATA ? { ...DATA.types } : {},
    filter: currentFilter ? currentFilter.expr : null,
    csv: reconstructCSV(),
    tree: TREE ? serializeTree(TREE) : null,
    edits: undoStack.length,
  };
}

function restoreProjectState(p) {
  TREE_MODE = p.mode || 'classification';
  loadData(p.csv);

  // Restore type overrides
  if (p.types && DATA) {
    for (const h of DATA.headers) {
      if (p.types[h]) DATA.types[h] = p.types[h];
    }
    renderDataSummary();
    // Refresh target select with restored types
    const sel = document.getElementById('targetSelect');
    sel.innerHTML = '';
    const cats = DATA.headers.filter(h => DATA.types[h] === 'categorical');
    const nums = DATA.headers.filter(h => DATA.types[h] === 'numeric');
    [...cats, ...nums].forEach(h => {
      const opt = document.createElement('option');
      opt.value = h; opt.textContent = h + (DATA.types[h] === 'categorical' ? ' ●' : ' #');
      sel.appendChild(opt);
    });
  }

  if (p.config) {
    document.getElementById('targetSelect').value = p.config.target;
    document.getElementById('maxDepth').value = p.config.maxDepth;
    document.getElementById('minLeaf').value = p.config.minLeaf;
    document.getElementById('minSplit').value = p.config.minSplit;
  }

  // Restore filter
  if (p.filter) {
    document.getElementById('filterInput').value = p.filter;
    try {
      const fn = new Function('r', 'try { return !!(' + p.filter + '); } catch(e) { return false; }');
      currentFilter = { expr: p.filter, fn };
      updateFilterCount();
    } catch { currentFilter = null; }
  } else {
    currentFilter = null;
    document.getElementById('filterInput').value = '';
    document.getElementById('filterCount').textContent = '';
  }

  if (p.tree) {
    TREE = deserializeTree(p.tree, DATA.rows);
    const target = p.config?.target || document.getElementById('targetSelect').value;
    const features = DATA.headers.filter(h => h !== target);
    const validRows = DATA.rows.filter(r => r[target] !== '' && r[target] !== 'NA');
    TREE._target = target; TREE._features = features;
    TREE._rows = validRows; TREE._mode = TREE_MODE;
    TREE._classes = TREE_MODE === 'classification' ? [...new Set(validRows.map(r => r[target]))].sort() : [];
    selectedNodeId = null; undoStack.length = 0;
    const es = document.getElementById('emptyState');
    if (es) es.style.display = 'none';
    renderTree(); renderRules(); updateUndoBar();
    const metric = treeAccuracy(TREE, validRows, target);
    const stats = countNodes(TREE);
    const metricLabel = TREE_MODE === 'regression' ? 'R²' : 'Accuracy';
    const metricVal = TREE_MODE === 'regression' ? metric.toFixed(3) : (metric * 100).toFixed(1) + '%';
    document.getElementById('statsBar').innerHTML = `
      <span>Rows: <span class="stat-val">${validRows.length}</span></span>
      <span>Nodes: <span class="stat-val">${stats.total}</span></span>
      <span>Leaves: <span class="stat-val">${stats.leaves}</span></span>
      <span>Depth: <span class="stat-val">${stats.maxDepth}</span></span>
      <span>${metricLabel}: <span class="stat-val">${metricVal}</span></span>
    `;
    setTimeout(zoomFit, 30);
  }
}

async function saveProject() {
  if (!DATA || !TREE) { showToast('Nothing to save — load data and grow a tree first'); return; }
  const defaultName = (DATA._name || 'project') + (TREE_MODE === 'regression' ? ' (reg)' : '');
  const name = prompt('Project name:', defaultName);
  if (!name) return;

  const project = { name, ...buildProjectPayload() };
  try {
    await dbPut(project);
    showToast(`💾 Saved "${name}"`);
    refreshSavedLists();
  } catch (e) {
    showToast('Save failed: ' + e.message);
  }
}

async function loadProject(name) {
  try {
    const p = await dbGet(name);
    if (!p) { showToast('Project not found'); return; }
    restoreProjectState(p);
    document.querySelectorAll('.load-dialog-overlay').forEach(d => d.remove());
    showToast(`📂 Loaded "${name}"`);
    DATA._name = name;
  } catch (e) { showToast('Load failed: ' + e.message); }
}

async function deleteProject(name, e) {
  if (e) e.stopPropagation();
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await dbDelete(name);
    showToast(`Deleted "${name}"`);
    refreshSavedLists();
    const dialog = document.querySelector('.load-dialog');
    if (dialog) showLoadDialog();
  } catch (err) { showToast('Delete failed: ' + err.message); }
}

async function showLoadDialog() {
  document.querySelectorAll('.load-dialog-overlay').forEach(d => d.remove());
  const overlay = document.createElement('div');
  overlay.className = 'load-dialog-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const dialog = document.createElement('div');
  dialog.className = 'load-dialog';
  dialog.innerHTML = '<h3>📂 Open Project</h3>';

  let projects;
  try { projects = await dbGetAll(); }
  catch { projects = []; }

  projects.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  if (projects.length === 0) {
    dialog.innerHTML += '<div class="load-dialog-empty">No saved projects yet</div>';
  } else {
    for (const p of projects) {
      const date = p.savedAt ? new Date(p.savedAt).toLocaleDateString() : '—';
      const mode = p.mode === 'regression' ? 'reg' : 'cls';
      const rows = p.csv ? p.csv.split('\n').length - 1 : '?';
      const item = document.createElement('div');
      item.className = 'load-dialog-item';
      item.innerHTML = `
        <div class="ldi-info">
          <div class="ldi-name">${p.name}</div>
          <div class="ldi-meta">${date} · ${mode} · ${rows} rows${p.edits ? ' · ' + p.edits + ' edits' : ''}</div>
        </div>`;
      const delBtn = document.createElement('button');
      delBtn.className = 'ldi-delete';
      delBtn.textContent = '✕';
      delBtn.onclick = (e) => deleteProject(p.name, e);
      item.appendChild(delBtn);
      item.onclick = () => loadProject(p.name);
      dialog.appendChild(item);
    }
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'load-dialog-close';
  closeBtn.textContent = 'Cancel';
  closeBtn.onclick = () => overlay.remove();
  dialog.appendChild(closeBtn);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════
//  PROJECTS — JSON export/import
// ═══════════════════════════════════════
function exportProject() {
  if (!DATA || !TREE) { showToast('Nothing to export — load data and grow a tree first'); return; }
  const project = {
    _format: 'arborist-v1',
    name: DATA._name || 'project',
    ...buildProjectPayload(),
  };
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (DATA._name || 'arborist_project') + '.json';
  a.click();
  showToast('📤 Exported project as JSON');
}

function importProject(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const p = JSON.parse(e.target.result);
      if (!p.csv) { showToast('Invalid project file — no data found'); return; }
      restoreProjectState(p);
      DATA._name = p.name || file.name.replace(/\.json$/, '');
      showToast(`📥 Imported "${DATA._name}"`);
    } catch (err) { showToast('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}

function initImportInputListener() {
  const input = document.getElementById('importInput');
  if (!input) return;
  input.addEventListener('change', e => {
    if (e.target.files[0]) importProject(e.target.files[0]);
    e.target.value = '';
  });
}

// Tree serialization (strip _rows to save space, store structure only)
function serializeTree(node) {
  const obj = {
    id: node.id, leaf: node.leaf, prediction: node.prediction,
    classCounts: node.classCounts, gini: node.gini, n: node.n,
    depth: node.depth, confidence: node.confidence,
  };
  if (!node.leaf && node.split) {
    obj.split = { ...node.split };
    obj.left = serializeTree(node.left);
    obj.right = serializeTree(node.right);
  }
  return obj;
}

function deserializeTree(obj, allRows) {
  return rebuildRows(obj, allRows);
}

function rebuildRows(node, rows) {
  node._rows = rows;
  if (!node.leaf && node.split && node.left && node.right) {
    const [leftRows, rightRows] = splitRows(rows, node.split);
    node.left = rebuildRows(node.left, leftRows);
    node.right = rebuildRows(node.right, rightRows);
  }
  return node;
}

function reconstructCSV() {
  if (!DATA) return '';
  const lines = [DATA.headers.join(',')];
  for (const r of DATA.rows) {
    lines.push(DATA.headers.map(h => {
      const v = r[h];
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) return '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(','));
  }
  return lines.join('\n');
}

// Refresh saved lists on splash + left panel
async function refreshSavedLists() {
  let projects;
  try { projects = await dbGetAll(); }
  catch { projects = []; }

  projects.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  const splashList = document.getElementById('splashSavedList');
  if (splashList) {
    if (projects.length === 0) {
      splashList.innerHTML = '<div class="splash-saved-empty">No saved projects</div>';
    } else {
      splashList.innerHTML = projects.slice(0, 5).map(p => {
        const date = p.savedAt ? new Date(p.savedAt).toLocaleDateString() : '';
        const esc = p.name.replace(/'/g, "\\'");
        return `<div class="splash-saved-item" onclick="loadProject('${esc}')">
          <span class="ss-name">${p.name}</span>
          <span class="ss-date">${date}</span>
        </div>`;
      }).join('');
    }
  }
}

// Called by app.js after panels mount.
