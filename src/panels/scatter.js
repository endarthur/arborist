// ═══════════════════════════════════════
//  PANEL: 3D Scatter (point cloud of samples coloured by predictions)
// ═══════════════════════════════════════
// Uses @gcu/dee (wrapped as the DEE global) on top of vendored Three.js.
// Coordinates come from the X/Y/Z column roles. Panel starts empty if
// no coordinate role is assigned.

let _scatterPanelElement = null;
let _deeScene = null;           // dee instance once initialised
let _scatterInitPending = false;
let _scatterColorBy = 'predicted';   // 'predicted' | 'true' | 'misclass'

function getScatterPanelElement() {
  if (_scatterPanelElement) return _scatterPanelElement;
  const tpl = document.getElementById('tpl-scatter-panel');
  _scatterPanelElement = tpl.content.firstElementChild.cloneNode(true);
  initScatterPanelListeners(_scatterPanelElement);
  return _scatterPanelElement;
}

function initScatterPanelListeners(root) {
  const colorBySel = root.querySelector('#scatterColorBy');
  if (colorBySel) {
    colorBySel.addEventListener('change', () => {
      _scatterColorBy = colorBySel.value;
      renderScatterPanel();
    });
  }

  // dee needs a non-zero container size before init; defer until the panel
  // has actual dimensions. ResizeObserver fires once dockview mounts and
  // lays out the content.
  const host = root.querySelector('#scatterHost');
  if (host && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (!_deeScene && host.clientWidth > 0 && host.clientHeight > 0) {
        tryInitDee(host);
      } else if (_deeScene) {
        _deeScene.resize();
      }
    });
    ro.observe(host);
  }

  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(renderScatterPanel, 50);
  };
  subscribe('tree', schedule);
  subscribe('dataset', schedule);
  subscribe('columns', schedule);
}

function tryInitDee(host) {
  if (_deeScene || _scatterInitPending) return;
  if (typeof DEE === 'undefined' || typeof THREE === 'undefined') return;
  _scatterInitPending = true;
  try {
    _deeScene = DEE.create(host, {
      THREE,
      background: 0x0f110f,
      origin: [0, 0, 0],
    });
    renderScatterPanel();
  } catch (e) {
    console.error('[scatter] dee init failed:', e);
  } finally {
    _scatterInitPending = false;
  }
}

function datasetBounds(rows, coordCols) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const r of rows) {
    if (coordCols.x) { const v = Number(r[coordCols.x]); if (isFinite(v)) { minX = Math.min(minX, v); maxX = Math.max(maxX, v); } }
    if (coordCols.y) { const v = Number(r[coordCols.y]); if (isFinite(v)) { minY = Math.min(minY, v); maxY = Math.max(maxY, v); } }
    if (coordCols.z) { const v = Number(r[coordCols.z]); if (isFinite(v)) { minZ = Math.min(minZ, v); maxZ = Math.max(maxZ, v); } }
  }
  const fallback = (a, b) => isFinite(a) ? [a, b] : [0, 0];
  return {
    x: fallback(minX, maxX),
    y: fallback(minY, maxY),
    z: fallback(minZ, maxZ),
  };
}

function renderScatterPanel() {
  const root = _scatterPanelElement;
  if (!root) return;
  const host = root.querySelector('#scatterHost');
  const empty = root.querySelector('#scatterEmpty');
  if (!host || !empty) return;

  const roles = getColumnRoles();
  const hasCoords = !!(roles && (roles.x || roles.y || roles.z));
  if (!DATA || !hasCoords) {
    empty.style.display = '';
    empty.textContent = !DATA
      ? 'Load a dataset first.'
      : 'Assign at least one of X / Y / Z in the Configuration section to enable the 3D view.';
    host.style.visibility = 'hidden';
    return;
  }
  empty.style.display = 'none';
  host.style.visibility = '';

  if (!_deeScene && host.clientWidth > 0 && host.clientHeight > 0) {
    tryInitDee(host);
  }
  if (!_deeScene) return;

  const coordCols = { x: roles.x, y: roles.y, z: roles.z };

  // Build positions (flat [x,y,z,x,y,z,...]) — rows missing any coord are skipped.
  const positions = [];
  const rowRefs = [];
  for (const r of DATA.rows) {
    const x = coordCols.x ? Number(r[coordCols.x]) : 0;
    const y = coordCols.y ? Number(r[coordCols.y]) : 0;
    const z = coordCols.z ? Number(r[coordCols.z]) : 0;
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    positions.push(x, y, z);
    rowRefs.push(r);
  }
  if (positions.length === 0) return;

  // Colour per point.
  const target = roles.target;
  const colourBy = _scatterColorBy;
  const rgb = []; // flat [r,g,b,r,g,b,...] in 0-1
  const classes = TREE?._classes || (target && DATA ? [...new Set(DATA.rows.map(r => r[target]).filter(v => v !== '' && v != null))].sort() : []);
  const classColor = (idx) => {
    if (idx < 0 || idx >= CLASS_COLORS.length) return [0.6, 0.6, 0.6];
    return hexToRgb01(CLASS_COLORS[idx]);
  };

  for (const r of rowRefs) {
    let c = [0.6, 0.6, 0.6];
    if (colourBy === 'misclass') {
      if (TREE && target) {
        const pred = predictRow(TREE, r);
        const actual = r[target];
        c = (String(pred.class) === String(actual)) ? [0.35, 0.7, 0.35] : [0.85, 0.35, 0.35];
      }
    } else if (colourBy === 'true') {
      const actual = r[target];
      const idx = classes.indexOf(actual);
      c = classColor(idx);
    } else {
      // predicted (fallback: true class if no tree)
      if (TREE) {
        const pred = predictRow(TREE, r);
        const idx = classes.indexOf(pred.class);
        c = classColor(idx);
      } else {
        const actual = r[target];
        const idx = classes.indexOf(actual);
        c = classColor(idx);
      }
    }
    rgb.push(c[0], c[1], c[2]);
  }

  // Dee's addPointsLayer expects an optional colorMap. We colour rows
  // ourselves and pass a passthrough identity map.
  _deeScene.removeLayer('samples');
  const colorMap = {
    map: (v) => [rgb[v * 3], rgb[v * 3 + 1], rgb[v * 3 + 2]],
  };
  const values = new Uint32Array(rowRefs.length);
  for (let i = 0; i < rowRefs.length; i++) values[i] = i;
  _deeScene.addPoints('samples', {
    positions: new Float32Array(positions),
    values, colorMap, size: 6,
  });

  // Recenter camera on first populated render.
  if (!root._scatterFramed) {
    const b = datasetBounds(DATA.rows, coordCols);
    frameCameraToBounds(_deeScene, b);
    root._scatterFramed = true;
  }
}

function frameCameraToBounds(dee, b) {
  // Naive: set origin to the centre of the bounding box. Dee's default
  // OrbitControls will orbit around that origin.
  const cx = (b.x[0] + b.x[1]) / 2;
  const cy = (b.y[0] + b.y[1]) / 2;
  const cz = (b.z[0] + b.z[1]) / 2;
  // dee was initialised with origin [0,0,0]; translate group positions
  // by recentering. Since layers set pointGroup.position to -origin, and
  // origin is fixed at init, we instead move the camera.
  const span = Math.max(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0], 1);
  const dist = span * 1.6;
  if (dee.camera) {
    dee.camera.position.set(cx + dist, cy + dist, cz + dist);
    dee.camera.lookAt(cx, cy, cz);
    dee.markDirty();
  }
}

function hexToRgb01(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function disposeScatterPanel() {
  if (_deeScene) {
    try { _deeScene.dispose(); } catch {}
    _deeScene = null;
  }
}
