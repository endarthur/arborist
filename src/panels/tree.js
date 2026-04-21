// ═══════════════════════════════════════
//  PANEL: Tree (canvas + inspector overlay)
// ═══════════════════════════════════════
// v1 .main DOM lives in <template id="tpl-tree-panel"> in src/index.html.
// Cloned once, cached, reused across mount/unmount cycles.
let _treePanelElement = null;
function getTreePanelElement() {
  if (_treePanelElement) return _treePanelElement;
  const tpl = document.getElementById('tpl-tree-panel');
  _treePanelElement = tpl.content.firstElementChild.cloneNode(true);
  return _treePanelElement;
}

// ═══════════════════════════════════════
//  TREE VIZ (SVG)
// ═══════════════════════════════════════
const NODE_W = 160, NODE_H = 62, H_GAP = 30, V_GAP = 55;

function layoutTree(node) {
  if (node.leaf) { node._width = NODE_W; return; }
  layoutTree(node.left); layoutTree(node.right);
  const lw = node.left._width, rw = node.right._width;
  node._width = lw + H_GAP + rw;
  // Left child center = parent - (rightWidth + gap) / 2
  // Right child center = parent + (leftWidth + gap) / 2
  node.left._x = -(rw + H_GAP) / 2;
  node.right._x = (lw + H_GAP) / 2;
}

function assignPositions(node, cx, cy) {
  node._cx = cx; node._cy = cy;
  if (!node.leaf) {
    assignPositions(node.left, cx + node.left._x, cy + NODE_H + V_GAP);
    assignPositions(node.right, cx + node.right._x, cy + NODE_H + V_GAP);
  }
}

function collectNodes(node, nodes = [], links = []) {
  nodes.push(node);
  if (!node.leaf) {
    links.push({ from: node, to: node.left, label: 'yes' });
    links.push({ from: node, to: node.right, label: 'no' });
    collectNodes(node.left, nodes, links);
    collectNodes(node.right, nodes, links);
  }
  return { nodes, links };
}

function renderTree() {
  if (!TREE) return;
  layoutTree(TREE);
  assignPositions(TREE, TREE._width / 2, 30);
  const { nodes, links } = collectNodes(TREE);
  const classes = TREE._classes;

  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n._cx - NODE_W / 2);
    maxX = Math.max(maxX, n._cx + NODE_W / 2);
    maxY = Math.max(maxY, n._cy + NODE_H);
  }

  const pad = 40;
  const svgW = (maxX - minX) + pad * 2, svgH = maxY + pad * 2;
  const offsetX = -minX + pad, offsetY = pad;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}"
    style="min-width:${svgW}px; min-height:${svgH}px;">`;

  for (const link of links) {
    const x1 = link.from._cx + offsetX, y1 = link.from._cy + NODE_H + offsetY;
    const x2 = link.to._cx + offsetX, y2 = link.to._cy + offsetY;
    const my = (y1 + y2) / 2;
    svg += `<path class="tree-link" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" />`;
    const lx = (x1 + x2) / 2 + (link.label === 'yes' ? -12 : 12);
    const ly = (y1 + y2) / 2 - 4;
    const col = link.label === 'yes' ? 'var(--green)' : 'var(--red)';
    svg += `<text x="${lx}" y="${ly}" fill="${col}" font-size="9" text-anchor="middle"
      font-family="var(--mono)" font-weight="600">${link.label === 'yes' ? '≤ yes' : '> no'}</text>`;
  }

  for (const node of nodes) {
    const x = node._cx + offsetX - NODE_W / 2, y = node._cy + offsetY;
    const sel = selectedNodeId === node.id ? ' selected' : '';

    let barSvg = '', bx = 0;
    if (TREE_MODE === 'regression' && node._rows) {
      // Mini box showing relative mean position within parent range
      const vals = node._rows.map(r => parseFloat(r[TREE._target])).filter(v => !isNaN(v));
      if (vals.length > 0) {
        const allVals = TREE._rows.map(r => parseFloat(r[TREE._target])).filter(v => !isNaN(v));
        const gMin = Math.min(...allVals), gMax = Math.max(...allVals);
        const range = gMax - gMin || 1;
        const nMean = regMean(node._rows, TREE._target);
        const nStd = regStd(node._rows, TREE._target);
        const barW = NODE_W - 8;
        // Draw range bar
        barSvg += `<rect x="${x + 4}" y="${y + NODE_H - 10}" width="${barW}" height="6" rx="1" fill="var(--surface3)" opacity="0.5"/>`;
        // Draw std range
        const lo = Math.max(0, ((nMean - nStd - gMin) / range) * barW);
        const hi = Math.min(barW, ((nMean + nStd - gMin) / range) * barW);
        barSvg += `<rect x="${x + 4 + lo}" y="${y + NODE_H - 10}" width="${Math.max(1, hi - lo)}" height="6" rx="1" fill="var(--cyan)" opacity="0.5"/>`;
        // Draw mean line
        const mx = ((nMean - gMin) / range) * barW;
        barSvg += `<line x1="${x + 4 + mx}" y1="${y + NODE_H - 11}" x2="${x + 4 + mx}" y2="${y + NODE_H - 3}" stroke="var(--amber)" stroke-width="1.5"/>`;
      }
    } else {
      for (const cls of classes) {
        const count = (node.classCounts || {})[cls] || 0;
        const w = (count / node.n) * (NODE_W - 8);
        if (w > 0) {
          barSvg += `<rect x="${x + 4 + bx}" y="${y + NODE_H - 10}" width="${w}" height="6" rx="1"
            fill="${CLASS_COLORS[classes.indexOf(cls) % CLASS_COLORS.length]}" opacity="0.8"/>`;
          bx += w;
        }
      }
    }

    let line1 = '', line2 = '';
    if (node.leaf) {
      if (TREE_MODE === 'regression') {
        const pred = typeof node.prediction === 'number' ? node.prediction : parseFloat(node.prediction);
        line1 = `🍂 ${isNaN(pred) ? '—' : pred.toFixed(2)}`;
        line2 = `n=${node.n}  σ=${(node.confidence ?? 0).toFixed(2)}`;
      } else {
        line1 = `🍂 ${node.prediction}`;
        line2 = `n=${node.n}  ${((node.confidence ?? 0) * 100).toFixed(0)}%`;
      }
    } else {
      const s = node.split;
      line1 = s.feature;
      line2 = s.type === 'numeric'
        ? `≤ ${Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(2)}`
        : `= "${s.category}"`;
    }

    const fill = node.leaf ? 'var(--surface2)' : 'var(--surface)';
    const stroke = node.leaf ? 'var(--border-hi)' : 'var(--border)';
    svg += `<g class="tree-node${sel}" data-id="${node.id}" onclick="selectNode(${node.id})">`;
    svg += `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    svg += `<text x="${x + NODE_W/2}" y="${y + 22}" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="600">${escSvg(line1)}</text>`;
    svg += `<text x="${x + NODE_W/2}" y="${y + 38}" text-anchor="middle" fill="var(--text-dim)" font-size="10">${escSvg(line2)}</text>`;
    svg += barSvg;
    svg += `</g>`;
  }

  svg += '</svg>';
  document.getElementById('treeContainer').innerHTML = svg;
  applyTransform();
}

function escSvg(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════
//  ZOOM + PAN (transform-based, unconstrained)
// ═══════════════════════════════════════
let panX = 0, panY = 0;

function applyTransform() {
  const svg = document.querySelector('#treeContainer svg');
  if (svg) { svg.style.transform = `translate(${panX}px, ${panY}px) scale(${svgZoom})`; svg.style.transformOrigin = '0 0'; }
  document.getElementById('zoomLevel').textContent = Math.round(svgZoom * 100) + '%';
}

function zoomIn() { svgZoom = Math.min(svgZoom * 1.2, 3); applyTransform(); }
function zoomOut() { svgZoom = Math.max(svgZoom / 1.2, 0.1); applyTransform(); }
function zoomFit() {
  if (!TREE) return;
  const c = document.getElementById('treeContainer'), s = c.querySelector('svg');
  if (!s) return;
  const sw = parseFloat(s.getAttribute('width')), sh = parseFloat(s.getAttribute('height'));
  const cw = c.clientWidth, ch = c.clientHeight;
  svgZoom = Math.max(Math.min(cw / sw, ch / sh, 1.5) * 0.92, 0.15);
  // Center in viewport
  panX = (cw - sw * svgZoom) / 2;
  panY = (ch - sh * svgZoom) / 2;
  applyTransform();
}

// Wheel zoom (zoom toward cursor) — called by app.js after tree panel mounts.
function initTreeWheelZoom() {
  const tc = document.getElementById('treeContainer');
  if (!tc) return;
  tc.addEventListener('wheel', function(e) {
    e.preventDefault();
    const rect = this.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const oldZoom = svgZoom;
    if (e.deltaY < 0) svgZoom = Math.min(svgZoom * 1.15, 3);
    else svgZoom = Math.max(svgZoom / 1.15, 0.1);
    // Adjust pan so zoom centers on cursor
    panX = mx - (mx - panX) * (svgZoom / oldZoom);
    panY = my - (my - panY) * (svgZoom / oldZoom);
    applyTransform();
  }, { passive: false });
}

// Drag-to-pan (unconstrained) — called by app.js after tree panel mounts.
function initTreePan() {
  const tc = document.getElementById('treeContainer');
  if (!tc) return;
  let isPanning = false, didDrag = false, startX, startY, startPanX, startPanY;

  tc.addEventListener('pointerdown', function(e) {
    if (e.target.closest && (e.target.closest('.tree-node') || e.target.closest('.empty-state') || e.target.closest('button') || e.target.closest('a') || e.target.closest('select') || e.target.closest('input'))) return;
    isPanning = true; didDrag = false; tc.classList.add('panning');
    tc.setPointerCapture(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    startPanX = panX; startPanY = panY;
    e.preventDefault();
  });
  tc.addEventListener('pointermove', function(e) {
    if (!isPanning) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    panX = startPanX + dx;
    panY = startPanY + dy;
    applyTransform();
  });
  tc.addEventListener('pointerup', function(e) {
    if (!isPanning) return;
    isPanning = false; tc.classList.remove('panning');
    tc.releasePointerCapture(e.pointerId);
    // Click without drag = deselect
    if (!didDrag && selectedNodeId !== null) deselectNode();
  });
}

// ═══════════════════════════════════════
//  INSPECTOR
// ═══════════════════════════════════════
function findNode(node, id) {
  if (node.id === id) return node;
  if (node.leaf) return null;
  return findNode(node.left, id) || findNode(node.right, id);
}

function selectNode(id) {
  // Toggle: clicking the already-selected node deselects
  if (selectedNodeId === id) { deselectNode(); return; }
  selectedNodeId = id;
  document.querySelectorAll('.tree-node').forEach(g => {
    g.classList.toggle('selected', parseInt(g.dataset.id) === id);
  });
  // Inspector is now its own dockview panel; if it's closed, surface it.
  if (typeof ensurePanelOpen === 'function') ensurePanelOpen('inspector');
  renderInspector(id);
}

function deselectNode() {
  selectedNodeId = null;
  document.querySelectorAll('.tree-node').forEach(g => g.classList.remove('selected'));
  renderInspectorDefault();
}

// Shown in the inspector whenever nothing is selected. If a tree exists we
// render the root — it represents the full training set and its split is
// usually what users want to see first — with a gentle hint that clicking
// a node will drill down.
function renderInspectorDefault() {
  const el = document.getElementById('inspectorContent');
  if (!el) return;
  if (!TREE) {
    el.innerHTML = '<div class="inspector-empty">Load a dataset and grow a tree to begin, or click a node here once one exists.</div>';
    return;
  }
  renderInspector(TREE.id);
  el.insertAdjacentHTML('afterbegin',
    '<div class="inspector-hint">Showing the <strong>root node</strong> — click any node in the tree to drill in.</div>');
}

function renderInspector(id) {
  const node = findNode(TREE, id);
  if (!node) return;
  const classes = TREE._classes || [];
  const isReg = TREE_MODE === 'regression';
  let html = '';

  if (isReg && node._rows) {
    // Regression: show value distribution
    const vals = node._rows.map(r => parseFloat(r[TREE._target])).filter(v => !isNaN(v));
    const mean = regMean(node._rows, TREE._target);
    const std = regStd(node._rows, TREE._target);
    const min = vals.length > 0 ? Math.min(...vals) : 0;
    const max = vals.length > 0 ? Math.max(...vals) : 0;
    html += `<div class="inspector-section"><h4>Value Distribution (n=${node.n})</h4>`;
    // Mini histogram
    if (vals.length >= 2) {
      const nBins = 20;
      const range = max - min || 1;
      const bins = new Array(nBins).fill(0);
      for (const v of vals) { const b = Math.min(nBins - 1, Math.floor((v - min) / range * nBins)); bins[b]++; }
      const maxBin = Math.max(...bins, 1);
      const hW = 240, hH = 35;
      html += `<svg viewBox="0 0 ${hW} ${hH}" style="display:block;width:100%;margin:0.3rem 0;">`;
      const bw = hW / nBins;
      for (let i = 0; i < nBins; i++) {
        const bh = (bins[i] / maxBin) * (hH - 2);
        html += `<rect x="${i * bw}" y="${hH - bh}" width="${bw - 1}" height="${bh}" fill="var(--cyan)" opacity="0.6" rx="1"/>`;
      }
      // Mean line
      const mx = ((mean - min) / range) * hW;
      html += `<line x1="${mx}" y1="0" x2="${mx}" y2="${hH}" stroke="var(--amber)" stroke-width="1.5"/>`;
      html += `</svg>`;
    }
    html += `<div style="font-family:var(--mono);font-size:0.6rem;color:var(--text-dim);display:flex;gap:0.8rem;flex-wrap:wrap;">
      <span>μ = <span style="color:var(--amber)">${mean.toFixed(2)}</span></span>
      <span>σ = <span style="color:var(--cyan)">${std.toFixed(2)}</span></span>
      <span>range: ${min.toFixed(1)}–${max.toFixed(1)}</span>
    </div></div>`;
  } else {
    // Classification: class distribution bar
    html += `<div class="inspector-section"><h4>Class Distribution (n=${node.n})</h4><div class="class-bar">`;
    for (const cls of classes) {
      const count = (node.classCounts || {})[cls] || 0;
      const pct = node.n ? (count / node.n) * 100 : 0;
      if (count > 0) {
        html += `<div class="class-bar-seg" style="width:${pct}%;background:${CLASS_COLORS[classes.indexOf(cls) % CLASS_COLORS.length]}"
          title="${cls}: ${count} (${pct.toFixed(1)}%)"></div>`;
      }
    }
    html += `</div><div class="class-legend">`;
    for (const cls of classes) {
      const count = (node.classCounts || {})[cls] || 0;
      if (count > 0) {
        html += `<div class="class-legend-item"><div class="class-dot" style="background:${CLASS_COLORS[classes.indexOf(cls) % CLASS_COLORS.length]}"></div>
          ${cls}: ${count} (${(count/node.n*100).toFixed(1)}%)</div>`;
      }
    }
    html += `</div></div>`;
  }

  const gini = node.gini ?? 0;
  const impLabel = isReg ? 'Variance' : 'Gini';
  html += `<div class="inspector-section"><h4>Metrics</h4><div class="metric-grid">`;
  html += `<div class="metric-cell"><div class="mc-label">${impLabel}</div><div class="mc-val">${gini.toFixed(4)}</div></div>`;
  html += `<div class="metric-cell"><div class="mc-label">Samples</div><div class="mc-val">${node.n}</div></div>`;
  if (isReg) {
    html += `<div class="metric-cell"><div class="mc-label">Prediction</div><div class="mc-val" style="font-size:0.7rem">${typeof node.prediction === 'number' ? node.prediction.toFixed(2) : node.prediction}</div></div>`;
    html += `<div class="metric-cell"><div class="mc-label">Std Dev</div><div class="mc-val">${(node.confidence ?? 0).toFixed(2)}</div></div>`;
  } else {
    html += `<div class="metric-cell"><div class="mc-label">Prediction</div><div class="mc-val" style="font-size:0.7rem">${node.prediction || '—'}</div></div>`;
    html += `<div class="metric-cell"><div class="mc-label">Confidence</div><div class="mc-val">${((node.confidence ?? 0)*100).toFixed(1)}%</div></div>`;
  }
  if (!node.leaf && node.split) {
    html += `<div class="metric-cell"><div class="mc-label">Gain</div><div class="mc-val">${(node.split.gain ?? 0).toFixed(4)}</div></div>`;
    html += `<div class="metric-cell"><div class="mc-label">Depth</div><div class="mc-val">${node.depth}</div></div>`;
  }
  html += `</div></div>`;

  if (!node.leaf && node.split) {
    const s = node.split;
    const childLabel = isReg ? 'Var' : 'Gini';
    html += `<div class="inspector-section"><h4>Split</h4><div class="split-info">`;
    if (s.type === 'numeric') {
      const thr = s.threshold ?? 0;
      html += `IF <span class="split-feature">${s.feature}</span> ≤ <span class="split-threshold">${
        Number.isInteger(thr) ? thr : thr.toFixed(3)}</span><br>`;
      html += `→ left: ${s.nLeft ?? '?'} samples (${childLabel} ${(s.giniLeft ?? 0).toFixed(3)})<br>→ right: ${s.nRight ?? '?'} samples (${childLabel} ${(s.giniRight ?? 0).toFixed(3)})`;
    } else {
      html += `IF <span class="split-feature">${s.feature}</span> = <span class="split-threshold">"${s.category}"</span><br>`;
      html += `→ yes: ${s.nLeft ?? '?'} samples (${childLabel} ${(s.giniLeft ?? 0).toFixed(3)})<br>→ no: ${s.nRight ?? '?'} samples (${childLabel} ${(s.giniRight ?? 0).toFixed(3)})`;
    }
    html += `</div></div>`;
  }

  const path = getPathTo(TREE, id);
  if (path.length > 0) {
    html += `<div class="inspector-section"><h4>Path to Node</h4><div class="split-info">`;
    for (const step of path) {
      if (step.split.type === 'numeric') {
        html += `<span class="split-feature">${step.split.feature}</span> ${step.direction === 'left' ? '≤' : '>'} `;
        html += `<span class="split-threshold">${Number.isInteger(step.split.threshold) ? step.split.threshold : step.split.threshold.toFixed(3)}</span><br>`;
      } else {
        html += `<span class="split-feature">${step.split.feature}</span> ${step.direction === 'left' ? '=' : '≠'} `;
        html += `<span class="split-threshold">"${step.split.category}"</span><br>`;
      }
    }
    html += `</div></div>`;
  }

  document.getElementById('inspectorContent').innerHTML = html;

  // ── Bonsai controls (rendered separately so onclick works) ──
  const bonsaiDiv = document.createElement('div');
  bonsaiDiv.className = 'bonsai-section';
  bonsaiDiv.innerHTML = `<h4>✂ Bonsai</h4>`;

  const row1 = document.createElement('div');
  row1.className = 'bonsai-row';

  if (!node.leaf) {
    const pruneBtn = document.createElement('button');
    pruneBtn.className = 'bonsai-btn danger';
    pruneBtn.textContent = '✂ Prune to Leaf';
    pruneBtn.onclick = () => pruneToLeaf(id);
    row1.appendChild(pruneBtn);
  }

  if (node.leaf && node._rows && node._rows.length >= (parseInt(document.getElementById('minSplit').value) || 6)) {
    const regrowBtn = document.createElement('button');
    regrowBtn.className = 'bonsai-btn grow';
    regrowBtn.textContent = '🌱 Regrow Subtree';
    regrowBtn.onclick = () => regrowFromLeaf(id);
    row1.appendChild(regrowBtn);
  }
  bonsaiDiv.appendChild(row1);

  // ── Top alternative splits by Gini ──
  if (node._rows && node._rows.length >= 6) {
    const altDiv = document.createElement('div');
    const splitsLabel = TREE_MODE === 'regression' ? 'TOP SPLITS BY VARIANCE' : 'TOP SPLITS BY GINI';
    altDiv.innerHTML = `<div style="font-family:var(--mono);font-size:0.58rem;color:var(--text-faint);margin-top:0.3rem;margin-bottom:0.3rem;">${splitsLabel}</div>`;
    const alts = findTopSplits(node._rows, TREE._features, TREE._target, DATA.types,
      parseInt(document.getElementById('minLeaf').value) || 3, 6);
    const altList = document.createElement('div');
    altList.className = 'alt-splits';
    for (const alt of alts) {
      const item = document.createElement('div');
      item.className = 'alt-split-item';
      if (!node.leaf && node.split &&
          node.split.feature === alt.feature &&
          ((alt.type === 'numeric' && Math.abs((node.split.threshold||0) - (alt.threshold||0)) < 0.001) ||
           (alt.type === 'categorical' && node.split.category === alt.category))) {
        item.classList.add('current');
      }
      item.innerHTML = `<span class="alt-gain">${(alt.gain ?? 0).toFixed(3)}</span>
        <span class="alt-feat">${alt.feature}</span>
        <span class="alt-val">${alt.type === 'numeric' ? '≤ ' + (Number.isInteger(alt.threshold) ? alt.threshold : (alt.threshold ?? 0).toFixed(2)) : '= "' + alt.category + '"'}</span>`;
      item.onclick = () => forceSplit(id, alt);
      altList.appendChild(item);
    }
    altDiv.appendChild(altList);
    bonsaiDiv.appendChild(altDiv);
  }

  // ── Custom split ──
  if (node._rows && node._rows.length >= 4) {
    const customDiv = document.createElement('div');
    customDiv.style.marginTop = '0.5rem';
    customDiv.innerHTML = '<div style="font-family:var(--mono);font-size:0.58rem;color:var(--text-faint);margin-bottom:0.3rem;">CUSTOM SPLIT</div>';

    const form = document.createElement('div');
    form.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.3rem;align-items:center;';

    const featSel = document.createElement('select');
    featSel.style.cssText = 'flex:1;min-width:80px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.25rem 0.3rem;border-radius:3px;font-family:var(--mono);font-size:0.62rem;';
    for (const f of TREE._features) {
      const o = document.createElement('option');
      o.value = f; o.textContent = f + (DATA.types[f] === 'numeric' ? ' #' : ' ●');
      featSel.appendChild(o);
    }

    const valInput = document.createElement('input');
    valInput.style.cssText = 'width:70px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.25rem 0.3rem;border-radius:3px;font-family:var(--mono);font-size:0.62rem;';

    const catSel = document.createElement('select');
    catSel.style.cssText = 'width:90px;background:var(--bg);border:1px solid var(--border);color:var(--text);padding:0.25rem 0.3rem;border-radius:3px;font-family:var(--mono);font-size:0.62rem;display:none;';

    const opLabel = document.createElement('span');
    opLabel.style.cssText = 'font-family:var(--mono);font-size:0.62rem;color:var(--text-dim);';
    opLabel.textContent = '≤';

    // Gini chart container
    const giniChartBox = document.createElement('div');
    giniChartBox.style.cssText = 'width:100%;margin-top:0.4rem;';

    function updateCustomUI() {
      const feat = featSel.value;
      giniChartBox.innerHTML = '';
      if (DATA.types[feat] === 'numeric') {
        valInput.style.display = '';
        catSel.style.display = 'none';
        opLabel.textContent = '≤';
        const vals = node._rows.map(r => parseFloat(r[feat])).filter(v => !isNaN(v)).sort((a,b) => a - b);
        if (vals.length > 0) {
          valInput.value = vals[Math.floor(vals.length / 2)].toFixed(2);
          renderNumericGiniChart(node._rows, feat, TREE._target, giniChartBox, valInput, id);
        }
      } else {
        valInput.style.display = 'none';
        catSel.style.display = '';
        opLabel.textContent = '=';
        catSel.innerHTML = '';
        const cats = [...new Set(node._rows.map(r => r[feat]).filter(v => v !== '' && v !== 'NA'))].sort();
        for (const c of cats) {
          const o = document.createElement('option');
          o.value = c; o.textContent = c;
          catSel.appendChild(o);
        }
        renderCatGiniTable(node._rows, feat, TREE._target, giniChartBox, catSel, id);
      }
    }
    featSel.onchange = updateCustomUI;
    valInput.oninput = () => {
      // Update threshold line in chart
      const line = giniChartBox.querySelector('.gini-threshold-line');
      if (line) {
        const v = parseFloat(valInput.value);
        const svg = giniChartBox.querySelector('svg');
        if (svg && !isNaN(v)) {
          const minV = parseFloat(svg.dataset.minv), maxV = parseFloat(svg.dataset.maxv);
          const cw = parseFloat(svg.dataset.cw), pad = parseFloat(svg.dataset.pad);
          const range = maxV - minV || 1;
          const x = pad + ((v - minV) / range) * cw;
          line.setAttribute('x1', x); line.setAttribute('x2', x);
        }
      }
    };
    // Default to current split's feature + value
    if (!node.leaf && node.split) {
      featSel.value = node.split.feature;
    }
    updateCustomUI();
    // Override median with actual current threshold/category
    if (!node.leaf && node.split) {
      if (node.split.type === 'numeric' && node.split.threshold != null) {
        valInput.value = Number.isInteger(node.split.threshold) ? node.split.threshold : node.split.threshold.toFixed(2);
        valInput.dispatchEvent(new Event('input'));
      } else if (node.split.type === 'categorical' && node.split.category) {
        catSel.value = node.split.category;
      }
    }

    const applyBtn = document.createElement('button');
    applyBtn.className = 'bonsai-btn';
    applyBtn.textContent = '⚡ Apply';
    applyBtn.style.cssText += 'white-space:nowrap;';
    applyBtn.onclick = () => {
      const feat = featSel.value;
      let split;
      if (DATA.types[feat] === 'numeric') {
        const thr = parseFloat(valInput.value);
        if (isNaN(thr)) { showToast('Enter a numeric threshold'); return; }
        split = { feature: feat, type: 'numeric', threshold: thr, gain: 0 };
      } else {
        const cat = catSel.value;
        if (!cat) { showToast('Select a category'); return; }
        split = { feature: feat, type: 'categorical', category: cat, gain: 0 };
      }
      forceSplit(id, split);
    };

    form.appendChild(featSel);
    form.appendChild(opLabel);
    form.appendChild(valInput);
    form.appendChild(catSel);
    form.appendChild(applyBtn);
    customDiv.appendChild(form);
    customDiv.appendChild(giniChartBox);
    bonsaiDiv.appendChild(customDiv);
  }

  document.getElementById('inspectorContent').appendChild(bonsaiDiv);
}

// ═══════════════════════════════════════
//  GINI CHARTS
// ═══════════════════════════════════════

function computeGiniCurve(rows, feat, target, nSteps) {
  const isReg = TREE_MODE === 'regression';
  const vals = rows.map(r => ({ v: parseFloat(r[feat]), cls: r[target], y: parseFloat(r[target]) }))
    .filter(d => !isNaN(d.v) && (isReg ? !isNaN(d.y) : true)).sort((a, b) => a.v - b.v);
  if (vals.length < 4) return [];

  const n = vals.length;
  const minV = vals[0].v, maxV = vals[n - 1].v;
  if (maxV === minV) return [];

  const curve = [];
  let vi = 0;

  if (isReg) {
    // Incremental variance via running sums
    let lN = 0, lSum = 0, lSqSum = 0;
    let rN = n, rSum = vals.reduce((a, d) => a + d.y, 0), rSqSum = vals.reduce((a, d) => a + d.y * d.y, 0);
    for (let step = 0; step <= nSteps; step++) {
      const threshold = minV + (step / nSteps) * (maxV - minV);
      while (vi < n && vals[vi].v <= threshold) {
        lN++; lSum += vals[vi].y; lSqSum += vals[vi].y * vals[vi].y;
        rN--; rSum -= vals[vi].y; rSqSum -= vals[vi].y * vals[vi].y;
        vi++;
      }
      if (lN === 0 || rN === 0) continue;
      const lVar = Math.max(0, lSqSum / lN - (lSum / lN) ** 2);
      const rVar = Math.max(0, rSqSum / rN - (rSum / rN) ** 2);
      const wVar = (lN * lVar + rN * rVar) / (lN + rN);
      curve.push({ threshold, gini: wVar });
    }
  } else {
    // Incremental Gini
    const allCounts = countClasses(rows, target);
    const leftCounts = {}, rightCounts = { ...allCounts };
    const nanRows = rows.filter(r => isNaN(parseFloat(r[feat])));
    for (const nr of nanRows) { rightCounts[nr[target]]--; if (rightCounts[nr[target]] === 0) delete rightCounts[nr[target]]; }
    let leftN = 0, rightN = vals.length;
    for (let step = 0; step <= nSteps; step++) {
      const threshold = minV + (step / nSteps) * (maxV - minV);
      while (vi < n && vals[vi].v <= threshold) {
        leftCounts[vals[vi].cls] = (leftCounts[vals[vi].cls] || 0) + 1;
        rightCounts[vals[vi].cls]--;
        if (rightCounts[vals[vi].cls] === 0) delete rightCounts[vals[vi].cls];
        leftN++; rightN--;
        vi++;
      }
      if (leftN === 0 || rightN === 0) continue;
      const wGini = (leftN * giniImpurity(leftCounts, leftN) + rightN * giniImpurity(rightCounts, rightN)) / (leftN + rightN);
      curve.push({ threshold, gini: wGini });
    }
  }
  return curve;
}

function renderNumericGiniChart(rows, feat, target, container, valInput, nodeId) {
  const STEPS = 80;
  const curve = computeGiniCurve(rows, feat, target, STEPS);
  if (curve.length === 0) { container.innerHTML = '<div style="font-family:var(--mono);font-size:0.55rem;color:var(--text-faint);">Not enough distinct values</div>'; return; }

  const W = 300, H = 80, PAD_L = 4, PAD_R = 4, PAD_T = 6, PAD_B = 14;
  const cw = W - PAD_L - PAD_R, ch = H - PAD_T - PAD_B;
  const minV = curve[0].threshold, maxV = curve[curve.length - 1].threshold;
  const minG = Math.min(...curve.map(c => c.gini));
  const maxG = Math.max(...curve.map(c => c.gini));
  const gRange = (maxG - minG) || 0.01;

  function tx(v) { return PAD_L + ((v - minV) / (maxV - minV || 1)) * cw; }
  function ty(g) { return PAD_T + (1 - (g - minG) / gRange) * ch; }

  // Build path
  const pts = curve.map(c => `${tx(c.threshold).toFixed(1)},${ty(c.gini).toFixed(1)}`);
  const pathD = 'M' + pts.join('L');

  // Fill area
  const fillD = pathD + `L${tx(maxV).toFixed(1)},${(PAD_T + ch).toFixed(1)}L${PAD_L},${(PAD_T + ch).toFixed(1)}Z`;

  // Best split marker
  const best = curve.reduce((a, b) => a.gini < b.gini ? a : b);

  // Current threshold line
  const curThr = parseFloat(valInput.value);

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="display:block;width:100%;"
    data-minv="${minV}" data-maxv="${maxV}" data-cw="${cw}" data-pad="${PAD_L}">`;

  // Background
  svg += `<rect x="${PAD_L}" y="${PAD_T}" width="${cw}" height="${ch}" fill="var(--bg)" rx="2" stroke="var(--border)" stroke-width="0.5"/>`;

  // Fill under curve
  svg += `<path d="${fillD}" fill="var(--green-dim)" opacity="0.5"/>`;

  // Curve line
  svg += `<path d="${pathD}" fill="none" stroke="var(--green)" stroke-width="1.5" opacity="0.8"/>`;

  // Best point
  svg += `<circle cx="${tx(best.threshold)}" cy="${ty(best.gini)}" r="3" fill="var(--green-bright)" stroke="var(--bg)" stroke-width="1"/>`;

  // Current threshold line
  if (!isNaN(curThr) && curThr >= minV && curThr <= maxV) {
    svg += `<line class="gini-threshold-line" x1="${tx(curThr)}" y1="${PAD_T}" x2="${tx(curThr)}" y2="${PAD_T + ch}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="3,2"/>`;
  } else {
    svg += `<line class="gini-threshold-line" x1="${tx(curThr)}" y1="${PAD_T}" x2="${tx(curThr)}" y2="${PAD_T + ch}" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0"/>`;
  }

  // Hover target (invisible rect)
  svg += `<rect class="gini-hover-area" x="${PAD_L}" y="${PAD_T}" width="${cw}" height="${ch}" fill="transparent" style="cursor:crosshair;"/>`;

  // Hover line & tooltip (initially hidden)
  svg += `<line class="gini-hover-line" x1="0" y1="${PAD_T}" x2="0" y2="${PAD_T + ch}" stroke="var(--text-faint)" stroke-width="0.5" opacity="0"/>`;
  svg += `<text class="gini-hover-text" x="0" y="${PAD_T - 1}" fill="var(--text)" font-size="8" font-family="var(--mono)" text-anchor="middle" opacity="0"></text>`;

  // Axis labels
  svg += `<text x="${PAD_L}" y="${H - 1}" fill="var(--text-faint)" font-size="7" font-family="var(--mono)">${Number.isInteger(minV) ? minV : minV.toFixed(1)}</text>`;
  svg += `<text x="${PAD_L + cw}" y="${H - 1}" fill="var(--text-faint)" font-size="7" font-family="var(--mono)" text-anchor="end">${Number.isInteger(maxV) ? maxV : maxV.toFixed(1)}</text>`;
  const chartLabel = TREE_MODE === 'regression' ? 'weighted variance' : 'weighted gini';
  svg += `<text x="${PAD_L + cw / 2}" y="${H - 1}" fill="var(--text-faint)" font-size="7" font-family="var(--mono)" text-anchor="middle">${chartLabel}</text>`;

  svg += '</svg>';
  container.innerHTML = svg;

  // Interaction
  const svgEl = container.querySelector('svg');
  const hoverArea = svgEl.querySelector('.gini-hover-area');
  const hoverLine = svgEl.querySelector('.gini-hover-line');
  const hoverText = svgEl.querySelector('.gini-hover-text');

  hoverArea.addEventListener('mousemove', function(e) {
    const rect = svgEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const svgScale = rect.width / W;
    const svgX = mx / svgScale;
    const frac = Math.max(0, Math.min(1, (svgX - PAD_L) / cw));
    const threshold = minV + frac * (maxV - minV);
    // Find nearest curve point
    const idx = Math.round(frac * STEPS);
    const pt = curve[Math.max(0, Math.min(idx, curve.length - 1))];
    hoverLine.setAttribute('x1', svgX); hoverLine.setAttribute('x2', svgX);
    hoverLine.setAttribute('opacity', '1');
    hoverText.setAttribute('x', svgX);
    hoverText.textContent = `${threshold.toFixed(1)} → ${pt.gini.toFixed(3)}`;
    hoverText.setAttribute('opacity', '1');
  });

  hoverArea.addEventListener('mouseleave', function() {
    hoverLine.setAttribute('opacity', '0');
    hoverText.setAttribute('opacity', '0');
  });

  hoverArea.addEventListener('click', function(e) {
    const rect = svgEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const svgScale = rect.width / W;
    const svgX = mx / svgScale;
    const frac = Math.max(0, Math.min(1, (svgX - PAD_L) / cw));
    const threshold = minV + frac * (maxV - minV);
    valInput.value = threshold.toFixed(2);
    // Update threshold line
    const tLine = svgEl.querySelector('.gini-threshold-line');
    tLine.setAttribute('x1', svgX); tLine.setAttribute('x2', svgX);
    tLine.setAttribute('opacity', '1');
  });
}

function renderCatGiniTable(rows, feat, target, container, catSel, nodeId) {
  const cats = [...new Set(rows.map(r => r[feat]).filter(v => v !== '' && v !== 'NA'))].sort();
  if (cats.length < 2) { container.innerHTML = ''; return; }

  const isReg = TREE_MODE === 'regression';
  const parentImp = isReg ? regVariance(rows, target) : giniImpurity(countClasses(rows, target), rows.length);
  const results = [];

  for (const cat of cats) {
    const leftRows = rows.filter(r => r[feat] === cat);
    const rightRows = rows.filter(r => r[feat] !== cat && r[feat] !== '' && r[feat] !== 'NA');
    if (leftRows.length === 0 || rightRows.length === 0) { results.push({ cat, gain: 0, n: leftRows.length }); continue; }
    const total = leftRows.length + rightRows.length;
    let wImp;
    if (isReg) {
      wImp = (leftRows.length * regVariance(leftRows, target) + rightRows.length * regVariance(rightRows, target)) / total;
    } else {
      const lc = countClasses(leftRows, target), rc = countClasses(rightRows, target);
      wImp = (leftRows.length * giniImpurity(lc, leftRows.length) + rightRows.length * giniImpurity(rc, rightRows.length)) / total;
    }
    results.push({ cat, gain: parentImp - wImp, n: leftRows.length, wImp });
  }

  const maxGain = Math.max(...results.map(r => r.gain), 0.001);
  let html = '<div style="margin-top:0.3rem;">';
  for (const r of results.sort((a, b) => b.gain - a.gain)) {
    const barW = (r.gain / maxGain) * 100;
    const selected = catSel.value === r.cat;
    html += `<div class="cat-gini-row${selected ? ' cat-selected' : ''}" data-cat="${r.cat}" style="
      display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0.4rem;margin-bottom:0.15rem;
      border-radius:3px;cursor:pointer;border:1px solid ${selected ? 'var(--cyan)' : 'var(--border)'};
      background:${selected ? 'var(--cyan-dim)' : 'var(--bg)'};transition:all 0.1s;
      font-family:var(--mono);font-size:0.58rem;">
      <span style="min-width:60px;color:var(--text-dim);">${r.cat}</span>
      <span style="flex:1;height:8px;background:var(--surface3);border-radius:2px;overflow:hidden;">
        <span style="display:block;height:100%;width:${barW}%;background:var(--green);border-radius:2px;"></span>
      </span>
      <span style="min-width:40px;text-align:right;color:var(--green-bright);font-weight:600;">${r.gain.toFixed(3)}</span>
      <span style="min-width:24px;text-align:right;color:var(--text-faint);">n=${r.n}</span>
    </div>`;
  }
  html += '</div>';
  container.innerHTML = html;

  // Click to select category
  container.querySelectorAll('.cat-gini-row').forEach(row => {
    row.addEventListener('click', () => {
      const cat = row.dataset.cat;
      catSel.value = cat;
      // Update highlight
      container.querySelectorAll('.cat-gini-row').forEach(r => {
        const isSel = r.dataset.cat === cat;
        r.style.borderColor = isSel ? 'var(--cyan)' : 'var(--border)';
        r.style.background = isSel ? 'var(--cyan-dim)' : 'var(--bg)';
      });
    });
    row.addEventListener('dblclick', () => {
      // Double-click to apply directly
      catSel.value = row.dataset.cat;
      const split = { feature: feat, type: 'categorical', category: row.dataset.cat, gain: 0 };
      forceSplit(nodeId, split);
    });
  });
}

function getPathTo(node, targetId, path = []) {
  if (node.id === targetId) return path;
  if (node.leaf) return null;
  return getPathTo(node.left, targetId, [...path, { split: node.split, direction: 'left' }])
    || getPathTo(node.right, targetId, [...path, { split: node.split, direction: 'right' }]);
}

