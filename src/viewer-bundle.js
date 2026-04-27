// ═══════════════════════════════════════
//  ARBORIST STANDALONE PREDICTOR — viewer bundle
// ═══════════════════════════════════════
// This file ships inside the standalone HTML artifact produced by Arborist's
// "Export → Standalone HTML" action. It reads a JSON payload baked into the
// page (#arborist-payload), renders a static SVG of the tree, surfaces the
// rule-export buttons (text/Python/Excel/SQL/mimic-io) and an Apply-to-Dataset
// dialog backed by the same predict-worker the main app uses. No dockview,
// no 3D, no bonsai — the tree is read-only here.

(function () {
  'use strict';

  // ─── payload ────────────────────────────────────────────────
  const payloadEl = document.getElementById('arborist-payload');
  if (!payloadEl) {
    document.body.innerHTML = '<div class="vw-error">Missing tree payload — was this file produced by Arborist?</div>';
    return;
  }
  let PAYLOAD;
  try {
    PAYLOAD = JSON.parse(payloadEl.textContent);
  } catch (e) {
    document.body.innerHTML = '<div class="vw-error">Tree payload is not valid JSON: ' + e.message + '</div>';
    return;
  }

  const TREE = PAYLOAD.tree;
  const META = PAYLOAD.meta || {};
  const IS_REG = META.mode === 'regression';
  const TARGET = META.target || 'prediction';
  const FEATURES = META.features || [];
  const CLASSES = META.classes || [];
  const TRAIN_STATS = META.trainingStats || {};

  // ─── state ──────────────────────────────────────────────────
  let _selectedNodeId = null;
  let _applyState = null;

  // ─── pure CSV parser (from csv.js, trimmed) ─────────────────
  const NULLISH = new Set(['', 'NA', 'na', 'NaN', 'nan', 'NULL', 'null', '#N/A', '-', '.', '?']);
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
    const fields = []; let i = 0, field = '', inQ = false;
    while (i < line.length) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i += 2; }
          else { inQ = false; i++; }
        } else { field += c; i++; }
      } else {
        if (c === '"') { inQ = true; i++; }
        else if (c === delimiter) { fields.push(field); field = ''; i++; }
        else { field += c; i++; }
      }
    }
    fields.push(field);
    return fields;
  }

  // ─── pure predictRow (iterative; from cart.js) ──────────────
  function predictRow(node, get) {
    while (!node.leaf) {
      const split = node.split;
      if (split.type === 'numeric') {
        const v = parseFloat(get(split.feature));
        if (isNaN(v)) return { class: node.prediction, confidence: node.confidence, leafId: node.id };
        node = v <= split.threshold ? node.left : node.right;
      } else {
        node = get(split.feature) === split.category ? node.left : node.right;
      }
    }
    return { class: node.prediction, confidence: node.confidence, leafId: node.id };
  }

  function countNodes(node) {
    if (node.leaf) return { total: 1, leaves: 1, maxDepth: node.depth || 0 };
    const l = countNodes(node.left), r = countNodes(node.right);
    return { total: 1 + l.total + r.total, leaves: l.leaves + r.leaves,
      maxDepth: Math.max(l.maxDepth, r.maxDepth) };
  }

  function getUsedFeatureTypes() {
    const out = {};
    const walk = (n) => {
      if (!n || n.leaf) return;
      if (n.split && n.split.feature && !out[n.split.feature]) out[n.split.feature] = n.split.type;
      walk(n.left); walk(n.right);
    };
    walk(TREE);
    return out;
  }

  function collectUsedFeatures(node, out) {
    if (!node || node.leaf) return out;
    if (node.split && node.split.feature) out.add(node.split.feature);
    collectUsedFeatures(node.left, out);
    collectUsedFeatures(node.right, out);
    return out;
  }

  // ─── rule extraction & exporters (from export.js) ───────────
  function extractRules(node, conditions = []) {
    if (node.leaf) return [{ conditions: [...conditions], prediction: node.prediction, confidence: node.confidence, n: node.n }];
    const s = node.split;
    const leftCond = s.type === 'numeric'
      ? { feature: s.feature, op: '≤', value: s.threshold, type: 'numeric' }
      : { feature: s.feature, op: '=', value: s.category, type: 'categorical' };
    const rightCond = s.type === 'numeric'
      ? { feature: s.feature, op: '>', value: s.threshold, type: 'numeric' }
      : { feature: s.feature, op: '≠', value: s.category, type: 'categorical' };
    return [...extractRules(node.left, [...conditions, leftCond]),
            ...extractRules(node.right, [...conditions, rightCond])];
  }

  function rulesToText() {
    const rules = extractRules(TREE);
    let out = '';
    for (const r of rules) {
      const conds = r.conditions.map(c => {
        const v = c.type === 'numeric' ? (Number.isInteger(c.value) ? c.value : c.value.toFixed(3)) : `"${c.value}"`;
        return `${c.feature} ${c.op} ${v}`;
      }).join(' AND ');
      const pred = IS_REG ? Number(r.prediction).toFixed(3) : r.prediction;
      const meta = IS_REG ? `σ=${(r.confidence ?? 0).toFixed(2)}, n=${r.n}` : `${((r.confidence ?? 0) * 100).toFixed(0)}%, n=${r.n}`;
      out += `IF ${conds} THEN ${pred} (${meta})\n`;
    }
    return out;
  }

  function rulesToPython() {
    function gen(node, indent) {
      if (node.leaf) {
        const pred = IS_REG ? Number(node.prediction).toFixed(6) : `"${node.prediction}"`;
        const cmt = IS_REG ? `σ=${(node.confidence ?? 0).toFixed(2)}, n=${node.n}` : `${((node.confidence ?? 0) * 100).toFixed(0)}%, n=${node.n}`;
        return `${indent}return ${pred}  # ${cmt}\n`;
      }
      const s = node.split;
      const cond = s.type === 'numeric'
        ? `row["${s.feature}"] <= ${Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(6)}`
        : `row["${s.feature}"] == "${s.category}"`;
      return `${indent}if ${cond}:\n` + gen(node.left, indent + '    ')
           + `${indent}else:\n` + gen(node.right, indent + '    ');
    }
    return `def predict(row):\n` + gen(TREE, '    ');
  }

  function rulesToExcel() {
    function gen(n) {
      if (n.leaf) return IS_REG ? Number(n.prediction).toFixed(3) : `"${n.prediction}"`;
      const s = n.split;
      const cond = s.type === 'numeric'
        ? `${s.feature}<=${Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(3)}`
        : `${s.feature}="${s.category}"`;
      return `IF(${cond},${gen(n.left)},${gen(n.right)})`;
    }
    return '=' + gen(TREE);
  }

  function rulesToSQL() {
    const rules = extractRules(TREE);
    const sqlOp = op => ({ '≤': '<=', '≠': '<>', '=': '=', '>': '>' }[op] || op);
    let sql = `-- Arborist CART ${IS_REG ? 'regression' : 'classification'} tree\n`;
    sql += `-- Target: ${TARGET} | Leaves: ${rules.length}\n`;
    sql += `CASE\n`;
    for (const r of rules) {
      const conds = r.conditions.map(c => {
        if (c.type === 'numeric') {
          const v = Number.isInteger(c.value) ? c.value : c.value.toFixed(6);
          return `${c.feature} ${sqlOp(c.op)} ${v}`;
        }
        return `${c.feature} ${sqlOp(c.op)} '${c.value}'`;
      }).join('\n      AND ');
      const pred = IS_REG ? Number(r.prediction).toFixed(3) : `'${r.prediction}'`;
      sql += `  WHEN ${conds}\n    THEN ${pred}\n`;
    }
    sql += `  ELSE NULL\nEND AS ${TARGET}_pred`;
    return sql;
  }

  function downloadMimicIo() {
    const order = [];
    function walk(node) {
      const idx = order.length;
      order.push({ idx, node, leftIdx: -1, rightIdx: -1 });
      if (!node.leaf) {
        const me = order[idx];
        me.leftIdx = order.length; walk(node.left);
        me.rightIdx = order.length; walk(node.right);
      }
    }
    walk(TREE);
    const n = order.length;
    const tree = {
      node_count: n,
      children_left: new Array(n), children_right: new Array(n),
      feature: new Array(n), threshold: new Array(n),
      category: new Array(n), value: new Array(n),
      impurity: new Array(n), n_node_samples: new Array(n),
    };
    for (let i = 0; i < n; i++) {
      const { node, leftIdx, rightIdx } = order[i];
      tree.children_left[i] = node.leaf ? -1 : leftIdx;
      tree.children_right[i] = node.leaf ? -1 : rightIdx;
      if (node.leaf) {
        tree.feature[i] = -2; tree.threshold[i] = -2; tree.category[i] = null;
      } else {
        tree.feature[i] = FEATURES.indexOf(node.split.feature);
        if (node.split.type === 'numeric') { tree.threshold[i] = node.split.threshold; tree.category[i] = null; }
        else { tree.threshold[i] = null; tree.category[i] = node.split.category; }
      }
      tree.impurity[i] = node.gini;
      tree.n_node_samples[i] = node.n;
      if (IS_REG) tree.value[i] = [Number(node.prediction)];
      else tree.value[i] = CLASSES.map(c => (node.classCounts && node.classCounts[c]) || 0);
    }
    const payload = {
      format: 'mimic-io', version: 1, algorithm: 'CART',
      criterion: IS_REG ? 'variance' : 'gini',
      mode: IS_REG ? 'regression' : 'classification',
      n_features: FEATURES.length, n_classes: IS_REG ? 1 : CLASSES.length,
      feature_names: FEATURES, class_names: IS_REG ? null : CLASSES,
      target_name: TARGET, tree,
      bonsai: { forced_splits: [], forced_classes: {}, pruned_nodes: [] },
      exported_at: new Date().toISOString(),
    };
    const text = JSON.stringify(payload, (_, v) => (typeof v === 'number' && !isFinite(v)) ? null : v, 2);
    downloadBlob(text, (TARGET || 'arborist_tree') + '.mimic-io.json', 'application/json');
    toast(`mimic-io JSON downloaded · ${n} nodes`);
  }

  // ─── helpers ───────────────────────────────────────────────
  function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }
  function escSvg(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtNum(v, digits = 3) {
    if (!isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    if (Math.abs(v) >= 1) return v.toFixed(2);
    return v.toPrecision(digits);
  }
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function downloadBlob(text, name, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function copyText(text, label) {
    if (!navigator.clipboard) { toast('Clipboard not available — try a download instead'); return; }
    navigator.clipboard.writeText(text).then(
      () => toast(`${label} copied to clipboard`),
      () => toast(`Copy failed (clipboard permission?)`)
    );
  }

  // ─── toast (no dockview) ───────────────────────────────────
  let _toastEl = null, _toastTimer = null;
  function toast(msg) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.className = 'vw-toast';
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    _toastEl.classList.add('show');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => _toastEl.classList.remove('show'), 2200);
  }

  // ─── static SVG tree render ────────────────────────────────
  // Class palette tuned for dark theme (pastel). The light-theme export uses
  // a darker, more saturated variant so the bars stay legible on white.
  const CLASS_COLORS = ['#9bcf6f', '#6cb8ff', '#ffb86c', '#c693e0', '#ff8b8b', '#7bdcdc', '#e0d36c'];
  const CLASS_COLORS_LIGHT = ['#5fa83a', '#3d8ad9', '#d8901a', '#a45cc7', '#cf3d3d', '#3da0a0', '#9b8814'];
  const THEME_COLORS = {
    dark: {
      bg: '#0f110f', surface: '#171a17', surface2: '#1e221e', surface3: '#252a25',
      border: '#2d332d', borderHi: '#3d453d',
      text: '#d4dcd0', textDim: '#8a9486', textFaint: '#5a6358',
      green: '#4caf50', red: '#c45e5e',
      classes: CLASS_COLORS,
    },
    light: {
      bg: '#f6f7f3', surface: '#ffffff', surface2: '#eeefea', surface3: '#e1e3dc',
      border: '#d6d8d0', borderHi: '#b3b6ab',
      text: '#1c2419', textDim: '#525a4d', textFaint: '#8a9180',
      green: '#2f8233', red: '#b84c4c',
      classes: CLASS_COLORS_LIGHT,
    },
  };
  const NODE_W = 160, NODE_H = 62, H_GAP = 30, V_GAP = 55;

  function layoutTree(node) {
    if (node.leaf) { node._width = NODE_W; return; }
    layoutTree(node.left); layoutTree(node.right);
    const lw = node.left._width, rw = node.right._width;
    node._width = lw + H_GAP + rw;
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
  function collect(node, nodes = [], links = []) {
    nodes.push(node);
    if (!node.leaf) {
      links.push({ from: node, to: node.left, label: 'yes' });
      links.push({ from: node, to: node.right, label: 'no' });
      collect(node.left, nodes, links);
      collect(node.right, nodes, links);
    }
    return { nodes, links };
  }

  // Build SVG markup. mode='screen' uses CSS vars (so the live theme applies);
  // mode='export' bakes in hex colours from the requested theme so the SVG
  // renders correctly when detached from the page (e.g. PNG raster, embedded
  // in a Word doc, or opened directly in a browser).
  function buildTreeSvg(mode, exportTheme) {
    layoutTree(TREE);
    assignPositions(TREE, TREE._width / 2, 30);
    const { nodes, links } = collect(TREE);

    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (const n of nodes) {
      minX = Math.min(minX, n._cx - NODE_W / 2);
      maxX = Math.max(maxX, n._cx + NODE_W / 2);
      maxY = Math.max(maxY, n._cy + NODE_H);
    }
    const pad = 30;
    const svgW = (maxX - minX) + pad * 2, svgH = maxY + pad * 2;
    const offsetX = -minX + pad, offsetY = pad;

    const theme = THEME_COLORS[exportTheme || 'light'];
    const isExport = mode === 'export';
    // Colour resolver: live theme uses CSS vars, export uses literal hex.
    const fillSurface  = isExport ? theme.surface  : 'var(--surface)';
    const fillSurface2 = isExport ? theme.surface2 : 'var(--surface2)';
    const strokeBorder = isExport ? theme.border   : 'var(--border)';
    const strokeBorderHi = isExport ? theme.borderHi : 'var(--border-hi)';
    const fillText     = isExport ? theme.text     : 'var(--text)';
    const fillTextDim  = isExport ? theme.textDim  : 'var(--text-dim)';
    const fillGreen    = isExport ? theme.green    : 'var(--green)';
    const fillRed      = isExport ? theme.red      : 'var(--red)';
    const linkStroke   = isExport ? theme.borderHi : 'var(--border-hi)';
    const palette      = isExport ? theme.classes  : CLASS_COLORS;

    // For export, embed font-family on the root so the file is self-contained.
    // No background rect — the canvas stays transparent so the result drops
    // cleanly onto any slide / report / wiki page regardless of the host's
    // background colour. Node fills are still drawn (they're cards), but the
    // outer page is see-through.
    const fontAttrs = isExport
      ? ' font-family="IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"'
      : '';

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}"${fontAttrs}>`;

    for (const link of links) {
      const x1 = link.from._cx + offsetX, y1 = link.from._cy + NODE_H + offsetY;
      const x2 = link.to._cx + offsetX, y2 = link.to._cy + offsetY;
      const my = (y1 + y2) / 2;
      const linkStrokeAttr = isExport ? ` stroke="${linkStroke}" stroke-width="1.4" fill="none"` : '';
      svg += `<path class="vw-tree-link" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"${linkStrokeAttr} />`;
      const lx = (x1 + x2) / 2 + (link.label === 'yes' ? -12 : 12);
      const ly = (y1 + y2) / 2 - 4;
      const fill = link.label === 'yes' ? fillGreen : fillRed;
      const cls = link.label === 'yes' ? 'vw-link-yes' : 'vw-link-no';
      const fillAttr = isExport ? ` fill="${fill}"` : ` class="${cls}"`;
      svg += `<text x="${lx}" y="${ly}"${fillAttr} font-size="9" text-anchor="middle" font-weight="600">${link.label === 'yes' ? '≤ yes' : '> no'}</text>`;
    }

    for (const node of nodes) {
      const x = node._cx + offsetX - NODE_W / 2, y = node._cy + offsetY;
      const sel = !isExport && _selectedNodeId === node.id ? ' vw-selected' : '';
      let barSvg = '', bx = 0;
      if (!IS_REG) {
        for (const cls of CLASSES) {
          const count = (node.classCounts || {})[cls] || 0;
          const w = node.n ? (count / node.n) * (NODE_W - 8) : 0;
          if (w > 0) {
            const colour = palette[CLASSES.indexOf(cls) % palette.length];
            barSvg += `<rect x="${x + 4 + bx}" y="${y + NODE_H - 10}" width="${w}" height="6" rx="1" fill="${colour}" opacity="0.85"/>`;
            bx += w;
          }
        }
      }
      let line1 = '', line2 = '';
      if (node.leaf) {
        if (IS_REG) {
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
      const fillRect   = node.leaf ? fillSurface2 : fillSurface;
      const strokeRect = node.leaf ? strokeBorderHi : strokeBorder;
      const groupAttr = isExport ? '' : ` class="vw-tree-node${sel}" data-id="${node.id}"`;
      svg += `<g${groupAttr}>`;
      svg += `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fillRect}" stroke="${strokeRect}" stroke-width="1.5"/>`;
      svg += `<text x="${x + NODE_W / 2}" y="${y + 22}" text-anchor="middle" fill="${fillText}" font-size="11" font-weight="600">${escSvg(line1)}</text>`;
      svg += `<text x="${x + NODE_W / 2}" y="${y + 38}" text-anchor="middle" fill="${fillTextDim}" font-size="10">${escSvg(line2)}</text>`;
      svg += barSvg;
      svg += `</g>`;
    }
    svg += '</svg>';
    return { svg, width: svgW, height: svgH };
  }

  function renderTree() {
    const { svg } = buildTreeSvg('screen');
    document.getElementById('vw-tree-stage').innerHTML = svg;

    document.querySelectorAll('.vw-tree-node').forEach(g => {
      g.addEventListener('click', () => {
        _selectedNodeId = parseInt(g.dataset.id, 10);
        renderTree();
        renderInspector();
      });
    });
    applyTransform();
  }

  // Zoom + pan (mirrors the main app's tree panel)
  let _panX = 0, _panY = 0, _scale = 1;
  function applyTransform() {
    const stage = document.getElementById('vw-tree-stage');
    if (!stage) return;
    stage.style.transform = `translate(${_panX}px, ${_panY}px) scale(${_scale})`;
    const lvl = document.getElementById('vw-zoom-level');
    if (lvl) lvl.textContent = Math.round(_scale * 100) + '%';
  }
  function zoomIn() { _scale = Math.min(4, _scale * 1.2); applyTransform(); }
  function zoomOut() { _scale = Math.max(0.1, _scale / 1.2); applyTransform(); }
  function zoomFit() {
    const host = document.getElementById('vw-tree-host');
    const stage = document.getElementById('vw-tree-stage');
    if (!host || !stage) return;
    const svg = stage.querySelector('svg');
    if (!svg) return;
    const w = svg.getAttribute('width') || svg.clientWidth;
    const h = svg.getAttribute('height') || svg.clientHeight;
    const pad = 20;
    const sx = (host.clientWidth - pad * 2) / Number(w);
    const sy = (host.clientHeight - pad * 2) / Number(h);
    _scale = Math.max(0.1, Math.min(1.5, Math.min(sx, sy)));
    _panX = (host.clientWidth - Number(w) * _scale) / 2;
    _panY = pad;
    applyTransform();
  }
  function initTreeInteraction() {
    const host = document.getElementById('vw-tree-host');
    if (!host) return;
    // Mouse wheel zoom (desktop)
    host.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      _scale = Math.max(0.1, Math.min(4, _scale * factor));
      applyTransform();
    }, { passive: false });
    // Drag to pan; track distance moved so a no-drag click can deselect.
    let panning = false, lastX = 0, lastY = 0, totalMoved = 0, startedOnNode = false;
    host.addEventListener('mousedown', (e) => {
      startedOnNode = !!e.target.closest('.vw-tree-node');
      panning = true; lastX = e.clientX; lastY = e.clientY; totalMoved = 0;
      if (!startedOnNode) e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      totalMoved += Math.abs(dx) + Math.abs(dy);
      if (!startedOnNode) {
        _panX += dx; _panY += dy;
        applyTransform();
      }
      lastX = e.clientX; lastY = e.clientY;
    });
    window.addEventListener('mouseup', (e) => {
      if (!panning) return;
      panning = false;
      // Click on empty area (no node, no drag) → deselect.
      if (!startedOnNode && totalMoved < 4 && _selectedNodeId != null) {
        _selectedNodeId = null;
        renderTree();
        renderInspector();
      }
    });
  }

  // ─── theme ──────────────────────────────────────────────────
  function getStoredTheme() {
    try {
      const v = localStorage.getItem('arborist.viewer.theme');
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) { return null; }
  }
  function setStoredTheme(theme) {
    try { localStorage.setItem('arborist.viewer.theme', theme); } catch (e) {}
  }
  function applyTheme(theme) {
    if (theme === 'light') document.body.classList.add('light-theme');
    else document.body.classList.remove('light-theme');
    const btn = document.getElementById('vw-theme-btn');
    if (btn) {
      // Glyph shows the *current* state; tooltip says what clicking does.
      btn.textContent = theme === 'light' ? '◑' : '◐';
      btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }
  }
  function toggleTheme() {
    const cur = document.body.classList.contains('light-theme') ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    applyTheme(next);
    setStoredTheme(next);
  }

  // ─── tree image export (always light theme) ─────────────────
  function exportSvg() {
    const { svg } = buildTreeSvg('export', 'light');
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg;
    downloadBlob(xml, exportFilename('svg'), 'image/svg+xml;charset=utf-8');
    toast('SVG downloaded');
  }

  async function exportPng() {
    const { svg, width, height } = buildTreeSvg('export', 'light');
    const SCALE = 2; // hi-DPI for crisp text
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG decode failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * SCALE);
      canvas.height = Math.ceil(height * SCALE);
      // Leave canvas transparent — no fillRect — so the PNG drops cleanly
      // onto any slide / report background. Node fills inside the SVG are
      // preserved, since the outer canvas is the only thing made see-through.
      const ctx = canvas.getContext('2d');
      ctx.scale(SCALE, SCALE);
      ctx.drawImage(img, 0, 0, width, height);
      await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (!b) { reject(new Error('PNG encode failed')); return; }
          const purl = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = purl; a.download = exportFilename('png');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(purl), 1500);
          resolve();
        }, 'image/png');
      });
      toast('PNG downloaded');
    } catch (err) {
      toast('PNG export failed: ' + (err && err.message || err));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function exportFilename(ext) {
    const base = (META.dataset || TARGET || 'tree')
      .toString().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tree';
    return `${base}_tree.${ext}`;
  }

  function findNode(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    if (node.leaf) return null;
    return findNode(node.left, id) || findNode(node.right, id);
  }

  function renderInspector() {
    const host = document.getElementById('vw-inspector');
    if (!host) return;
    if (_selectedNodeId == null) { host.innerHTML = `<div class="vw-empty">Click a node to inspect.</div>`; return; }
    const n = findNode(TREE, _selectedNodeId);
    if (!n) { host.innerHTML = ''; return; }
    let html = `<div class="vw-insp-head">${n.leaf ? '🍂 Leaf' : 'Split'} #${n.id} · n=${n.n} · depth=${n.depth ?? '?'}</div>`;
    if (!n.leaf) {
      const s = n.split;
      const v = s.type === 'numeric'
        ? (Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(3))
        : `"${s.category}"`;
      html += `<div class="vw-insp-row"><span>split</span><span><strong>${escHtml(s.feature)}</strong> ${escHtml(s.type === 'numeric' ? '≤' : '=')} ${escHtml(v)}</span></div>`;
    }
    html += `<div class="vw-insp-row"><span>prediction</span><span>${escHtml(IS_REG ? Number(n.prediction).toFixed(4) : n.prediction)}</span></div>`;
    html += `<div class="vw-insp-row"><span>${IS_REG ? 'std-dev' : 'confidence'}</span><span>${escHtml(IS_REG ? (n.confidence ?? 0).toFixed(3) : ((n.confidence ?? 0) * 100).toFixed(1) + '%')}</span></div>`;
    if (!IS_REG && n.classCounts) {
      const total = Object.values(n.classCounts).reduce((a, b) => a + b, 0) || 1;
      html += `<div class="vw-insp-classes">`;
      for (const c of CLASSES) {
        const cnt = n.classCounts[c] || 0;
        if (!cnt) continue;
        const pct = (cnt / total) * 100;
        html += `<div class="vw-insp-class">
          <span>${escHtml(c)}</span>
          <span class="vw-insp-bar"><span style="width:${pct.toFixed(1)}%"></span></span>
          <span>${cnt} (${pct.toFixed(0)}%)</span>
        </div>`;
      }
      html += `</div>`;
    }
    host.innerHTML = html;
  }

  function renderFooter() {
    const el = document.getElementById('vw-footer-target');
    if (!el) return;
    const parts = [];
    if (META.author) parts.push(escHtml(META.author));
    if (META.dataset) parts.push(escHtml(META.dataset));
    if (META.exportedAt) parts.push(escHtml(new Date(META.exportedAt).toISOString().slice(0, 10)));
    el.innerHTML = parts.length ? parts.join(' <span class="vw-footer-sep">·</span> ') : '';
  }

  function renderDescription() {
    const el = document.getElementById('vw-description');
    if (!el) return;
    if (!META.description) { el.style.display = 'none'; return; }
    el.style.display = '';
    // Plain text with line breaks preserved; no markdown to keep the viewer
    // dependency-free. Empty lines start a new paragraph.
    const paragraphs = String(META.description).split(/\n{2,}/).map(p =>
      `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`
    ).join('');
    el.innerHTML = paragraphs;
  }

  // ─── header / metadata ─────────────────────────────────────
  function renderHeader() {
    const stats = countNodes(TREE);
    const h = document.getElementById('vw-meta');
    if (!h) return;
    const subParts = [
      `<strong>${FEATURES.length}</strong> features`,
      `<strong>${stats.total}</strong> nodes`,
      `<strong>${stats.leaves}</strong> leaves`,
      `depth <strong>${stats.maxDepth}</strong>`,
    ];
    if (META.dataset) subParts.push(`trained on <strong>${escHtml(META.dataset)}</strong>`);
    if (META.exportedAt) subParts.push(`exported <strong>${escHtml(new Date(META.exportedAt).toLocaleDateString())}</strong>`);
    h.innerHTML = `
      <div class="vw-meta-pri">
        <span class="vw-meta-target">${escHtml(TARGET)}</span>
        <span class="vw-tag">${IS_REG ? 'regression' : 'classification'}</span>
      </div>
      <div class="vw-meta-sub">${subParts.join('<span class="sep">·</span>')}</div>
      ${!IS_REG && CLASSES.length ? `<div class="vw-classes">${CLASSES.map((c, i) => {
        const colour = CLASS_COLORS[i % CLASS_COLORS.length];
        return `<span class="vw-class-pill"><span class="vw-class-dot" style="background:${colour}"></span>${escHtml(c)}</span>`;
      }).join('')}</div>` : ''}`;
  }

  // ─── apply-tree dialog (fallback path only — Blob download) ─
  const VW_CHUNK_BYTES = 1 << 20; // 1 MiB
  const HAS_FSAA_OPEN = typeof window.showOpenFilePicker === 'function';
  const HAS_FSAA_SAVE = typeof window.showSaveFilePicker === 'function';

  function openApplyDialog() {
    if (!_applyState) {
      _applyState = {
        inputHandle: null, inputFile: null, inputName: '', sampleText: '',
        headerRow: 1, commentPrefix: '#',
        headers: [], previewRows: [], parseError: null,
        parseConfig: { delimiter: ',', decimalSep: '.' },
        detectedConfig: { delimiter: ',', decimalSep: '.' },
        delimChosen: false, decimalChosen: false,
        featureMap: {}, targetCol: '',
        outputCols: { pred: true, conf: true, leaf: true },
        outputHandle: null, outputName: 'predictions.csv',
        running: false, cancelled: false, completed: false,
        elapsedMs: 0, stats: null, rowsOut: 0, totalBytes: 0, bytesRead: 0,
        startedAt: 0,
      };
    }
    const dlg = document.getElementById('vw-apply-dialog');
    renderApplyDialog();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', 'open');
  }

  function closeApplyDialog() {
    const s = _applyState;
    if (s && s.running) {
      s.cancelled = true;
      if (s.worker) try { s.worker.terminate(); } catch (e) {}
    }
    const dlg = document.getElementById('vw-apply-dialog');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  function getUsedFeatures() {
    const set = collectUsedFeatures(TREE, new Set());
    const ordered = FEATURES.filter(f => set.has(f));
    for (const f of set) if (!ordered.includes(f)) ordered.push(f);
    return ordered;
  }

  function applyAutoMap() {
    const s = _applyState;
    const lower = {};
    s.headers.forEach(h => { lower[h.toLowerCase()] = h; });
    for (const f of getUsedFeatures()) {
      if (s.featureMap[f]) continue;
      const hit = lower[f.toLowerCase()];
      if (hit) s.featureMap[f] = hit;
    }
  }

  function recomputeFromSample() {
    const s = _applyState;
    s.headers = []; s.previewRows = []; s.parseError = null;
    if (!s.sampleText) return;
    let raw = s.sampleText;
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const allLines = normalised.split('\n');
    const skippable = (l) => !l.trim() || (s.commentPrefix && l.trimStart().startsWith(s.commentPrefix));
    let nonSkip = 0, headerIdx = -1;
    for (let i = 0; i < allLines.length; i++) {
      if (skippable(allLines[i])) continue;
      nonSkip++;
      if (nonSkip === s.headerRow) { headerIdx = i; break; }
    }
    if (headerIdx < 0) {
      s.parseError = `Header row ${s.headerRow} not found (sample has ${nonSkip} non-comment line${nonSkip === 1 ? '' : 's'})`;
      return;
    }
    const detect = [], preview = [];
    for (let i = headerIdx; i < allLines.length; i++) {
      if (skippable(allLines[i])) continue;
      if (detect.length < 20) detect.push(allLines[i]);
      if (i > headerIdx && preview.length < 3) preview.push(allLines[i]);
      if (detect.length >= 20 && preview.length >= 3) break;
    }
    const detDelim = detectDelimiter(detect);
    const detDec = detDelim === ';' ? ',' : '.';
    s.detectedConfig = { delimiter: detDelim, decimalSep: detDec };
    if (!s.delimChosen) s.parseConfig.delimiter = detDelim;
    if (!s.decimalChosen) s.parseConfig.decimalSep = detDec;
    s.headers = splitCSVRow(allLines[headerIdx], s.parseConfig.delimiter)
      .map(h => h.trim().replace(/^["']|["']$/g, ''));
    s.previewRows = preview.map(line =>
      splitCSVRow(line, s.parseConfig.delimiter).map(v => v.trim().replace(/^["']|["']$/g, '')));
    const headerSet = new Set(s.headers);
    for (const [feat, col] of Object.entries(s.featureMap)) {
      if (!headerSet.has(col)) delete s.featureMap[feat];
    }
    applyAutoMap();
    if (s.targetCol && !headerSet.has(s.targetCol)) s.targetCol = '';
    if (!s.targetCol && TARGET) {
      const tgt = TARGET.toLowerCase();
      const hit = s.headers.find(h => h.toLowerCase() === tgt);
      if (hit) s.targetCol = hit;
    }
  }

  async function applyPickInput() {
    const s = _applyState;
    let file = null, handle = null;
    if (HAS_FSAA_OPEN) {
      try {
        const [h] = await window.showOpenFilePicker({
          types: [{ description: 'CSV', accept: { 'text/csv': ['.csv', '.tsv', '.txt'] } }],
          multiple: false,
        });
        handle = h;
        file = await h.getFile();
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    if (!file) {
      file = await pickViaInput();
      if (!file) return;
    }
    s.inputHandle = handle;
    s.inputFile = file; s.inputName = file.name;
    s.featureMap = {}; s.targetCol = '';
    s.delimChosen = false; s.decimalChosen = false;
    try {
      const sampleBlob = file.slice(0, Math.min(64 * 1024, file.size));
      const buf = await sampleBlob.arrayBuffer();
      s.sampleText = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      recomputeFromSample();
    } catch (e) {
      s.parseError = 'Could not read sample: ' + (e.message || e);
    }
    renderApplyDialog();
  }

  async function applyPickOutput() {
    const s = _applyState;
    if (!HAS_FSAA_SAVE) return;
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
    } catch (e) {
      if (!(e && e.name === 'AbortError')) toast('Save picker failed: ' + e.message);
    }
    renderApplyDialog();
  }

  function pickViaInput() {
    return new Promise(resolve => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = '.csv,.tsv,.txt';
      i.style.display = 'none';
      document.body.appendChild(i);
      i.addEventListener('change', () => {
        const f = i.files && i.files[0];
        document.body.removeChild(i);
        resolve(f || null);
      });
      i.click();
    });
  }

  function renderApplyDialog() {
    const s = _applyState;
    if (!s) return;
    const features = getUsedFeatures();
    const allMapped = s.headers.length > 0 && features.every(f => s.featureMap[f]);
    const canRun = !s.running && s.inputFile && allMapped && !s.parseError;

    let mappingHtml;
    if (!s.headers.length) {
      mappingHtml = `<div class="vw-empty">Pick an input file to map columns.</div>`;
    } else {
      mappingHtml = features.map((f, i) => {
        const cur = s.featureMap[f] || '';
        const opts = [`<option value="">— no source · predict at this node —</option>`,
          ...s.headers.map(h => `<option value="${escHtml(h)}"${h === cur ? ' selected' : ''}>${escHtml(h)}</option>`)].join('');
        const cls = cur ? 'vw-feat-ok' : 'vw-feat-missing';
        const status = cur ? '✓' : '⚠';
        return `<div class="vw-map-row">
          <span class="${cls}">${status}</span>
          <span class="vw-map-feat">${escHtml(f)}</span>
          <select data-feat-idx="${i}" onchange="window.__vwMapChange(this)">${opts}</select>
        </div>`;
      }).join('');
    }

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

    let previewHtml = '';
    if (s.parseError) {
      previewHtml = `<div class="vw-error-soft">${escHtml(s.parseError)}</div>`;
    } else if (s.headers.length) {
      const cols = s.headers.slice(0, 6);
      const overflow = s.headers.length > 6 ? ` <span class="vw-faint">…+${s.headers.length - 6} more</span>` : '';
      const head = '<tr>' + cols.map(h => `<th>${escHtml(h)}</th>`).join('') + '</tr>';
      const body = (s.previewRows.length ? s.previewRows : [[]]).map(row =>
        '<tr>' + cols.map((_, i) => {
          const v = row[i];
          return `<td${v == null || v === '' ? ' class="vw-empty-cell"' : ''}>${v == null || v === '' ? '—' : escHtml(v)}</td>`;
        }).join('') + '</tr>').join('');
      previewHtml = `<div class="vw-faint">Preview (after header row ${s.headerRow})${overflow}</div>
        <table class="vw-preview">${head}${body}</table>`;
    }

    let progressHtml = '';
    if (s.running || (s.bytesRead > 0 && !s.completed)) {
      const pct = s.totalBytes > 0 ? Math.min(100, (s.bytesRead / s.totalBytes) * 100) : 0;
      progressHtml = `<div class="vw-progress">
        <div class="vw-progress-bar"><div class="vw-progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="vw-faint">${fmtBytes(s.bytesRead)} / ${fmtBytes(s.totalBytes)} · ${s.rowsOut.toLocaleString()} rows · ${pct.toFixed(1)}%</div>
      </div>`;
    } else if (s.completed) {
      progressHtml = renderApplyDoneSummary(s);
    }

    const inputDesc = s.inputFile
      ? `<span>${escHtml(s.inputName)}</span> <span class="vw-faint">${fmtBytes(s.inputFile.size)}</span>`
      : `<span class="vw-faint">no file selected</span>`;

    const targetSelectOpts = `<option value="">(none — no validation)</option>`
      + s.headers.map(h => `<option value="${escHtml(h)}"${h === s.targetCol ? ' selected' : ''}>${escHtml(h)}</option>`).join('');

    const predLabel = IS_REG ? 'predicted_value' : 'predicted_class';
    const confLabel = IS_REG ? 'std_dev' : 'confidence';

    let outTargetHtml;
    if (HAS_FSAA_SAVE) {
      if (s.outputHandle) {
        outTargetHtml = `<button class="vw-btn" onclick="window.__vwPickOut()">💾 Change…</button>
          <span>${escHtml(s.outputName)}</span>`;
      } else {
        outTargetHtml = `<button class="vw-btn" onclick="window.__vwPickOut()">💾 Choose output…</button>
          <span class="vw-faint">streamed write (no RAM cap)</span>`;
      }
    } else {
      outTargetHtml = `<span class="vw-faint">${escHtml(s.outputName)} (download — limited by RAM)</span>`;
    }

    document.getElementById('vw-apply-body').innerHTML = `
      <div class="vw-dialog-hint">
        Streams your CSV through the tree, appending prediction columns. All input columns pass through;
        only prediction columns are added.
      </div>
      <div class="vw-section">
        <div class="vw-section-label">1. Input file</div>
        <div class="vw-row"><button class="vw-btn" onclick="window.__vwPick()">📂 ${s.inputFile ? 'Change…' : 'Choose file…'}</button>${inputDesc}</div>
      </div>
      <div class="vw-section">
        <div class="vw-section-label">2. Parsing</div>
        <div class="vw-row vw-parse-row">
          <label>Delim</label><select id="vw-delim" onchange="window.__vwParseChange()">${delimOpts}</select>
          <label>Decimal</label><select id="vw-dec" onchange="window.__vwParseChange()">${decOpts}</select>
        </div>
        <div class="vw-row vw-parse-row">
          <label>Header row</label>
          <input type="number" min="1" step="1" id="vw-hrow" value="${s.headerRow}" onchange="window.__vwHrowChange()" style="width:3.6rem;" />
          <label>Comment</label>
          <input type="text" maxlength="4" id="vw-cprefix" value="${escHtml(s.commentPrefix)}" onchange="window.__vwCpChange()" style="width:3rem;" />
        </div>
        ${previewHtml}
      </div>
      <div class="vw-section">
        <div class="vw-section-label">3. Column mapping <span class="vw-faint">tree feature → input column</span></div>
        <div class="vw-mapping">${mappingHtml}</div>
      </div>
      <div class="vw-section">
        <div class="vw-section-label">4. Validation <span class="vw-faint">optional · target column for accuracy</span></div>
        <div class="vw-row vw-parse-row">
          <label>Target</label>
          <select id="vw-target" onchange="window.__vwTargetChange()">${targetSelectOpts}</select>
        </div>
      </div>
      <div class="vw-section">
        <div class="vw-section-label">5. Output columns</div>
        <div class="vw-row vw-cols-row">
          <label><input type="checkbox" id="vw-out-pred" ${s.outputCols.pred ? 'checked' : ''} onchange="window.__vwOutChange()"> ${predLabel}</label>
          <label><input type="checkbox" id="vw-out-conf" ${s.outputCols.conf ? 'checked' : ''} onchange="window.__vwOutChange()"> ${confLabel}</label>
          <label><input type="checkbox" id="vw-out-leaf" ${s.outputCols.leaf ? 'checked' : ''} onchange="window.__vwOutChange()"> leaf_id</label>
        </div>
      </div>
      <div class="vw-section">
        <div class="vw-section-label">6. Output target</div>
        <div class="vw-row">${outTargetHtml}</div>
      </div>
      ${progressHtml}
      <div class="vw-buttons">
        <button class="vw-btn" onclick="window.__vwClose()">${s.running ? 'Cancel' : 'Close'}</button>
        <button class="vw-btn vw-btn-primary" onclick="window.__vwRun()" ${canRun ? '' : 'disabled'}>
          ${s.running ? '⏳ Running…' : (s.completed ? '↻ Run again' : '▶ Run')}
        </button>
      </div>`;
  }

  // Bridge inline-onchange handlers to closure-bound functions
  window.__vwPick = applyPickInput;
  window.__vwPickOut = applyPickOutput;
  window.__vwClose = closeApplyDialog;
  window.__vwMapChange = function (sel) {
    const s = _applyState;
    const idx = parseInt(sel.dataset.featIdx, 10);
    const f = getUsedFeatures()[idx];
    if (!f) return;
    if (sel.value) s.featureMap[f] = sel.value; else delete s.featureMap[f];
    renderApplyDialog();
  };
  window.__vwParseChange = function () {
    const s = _applyState;
    const d = document.getElementById('vw-delim').value;
    s.parseConfig.delimiter = d === 'TAB' ? '\t' : d;
    s.parseConfig.decimalSep = document.getElementById('vw-dec').value;
    s.delimChosen = true; s.decimalChosen = true;
    recomputeFromSample(); renderApplyDialog();
  };
  window.__vwHrowChange = function () {
    const v = parseInt(document.getElementById('vw-hrow').value, 10);
    if (isFinite(v) && v >= 1) { _applyState.headerRow = v; recomputeFromSample(); renderApplyDialog(); }
  };
  window.__vwCpChange = function () {
    _applyState.commentPrefix = document.getElementById('vw-cprefix').value;
    recomputeFromSample(); renderApplyDialog();
  };
  window.__vwTargetChange = function () {
    _applyState.targetCol = document.getElementById('vw-target').value;
    renderApplyDialog();
  };
  window.__vwOutChange = function () {
    _applyState.outputCols.pred = !!document.getElementById('vw-out-pred').checked;
    _applyState.outputCols.conf = !!document.getElementById('vw-out-conf').checked;
    _applyState.outputCols.leaf = !!document.getElementById('vw-out-leaf').checked;
  };
  window.__vwRun = applyRun;

  function spawnPredictWorker() {
    const src = document.getElementById('predict-worker').textContent;
    const blob = new Blob([src], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const w = new Worker(url);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return w;
  }

  async function applyRun() {
    const s = _applyState;
    if (!s || s.running) return;
    if (!s.inputFile) return;
    const features = getUsedFeatures();
    const missing = features.filter(f => !s.featureMap[f]);
    if (missing.length) return;
    if (!s.outputCols.pred && !s.outputCols.conf && !s.outputCols.leaf) return;

    s.running = true; s.completed = false; s.cancelled = false;
    s.bytesRead = 0; s.totalBytes = s.inputFile.size; s.rowsOut = 0;
    s.startedAt = performance.now(); s.elapsedMs = 0; s.stats = null;
    renderApplyDialog();

    // Sink: FSAA writable stream or memory-collected for download
    const usingFSAA = !!s.outputHandle;
    let writable = null;
    let memChunks = null;
    if (usingFSAA) {
      try { writable = await s.outputHandle.createWritable(); }
      catch (e) {
        s.running = false;
        toast('Could not open output: ' + (e.message || e));
        renderApplyDialog();
        return;
      }
    } else {
      memChunks = [];
    }
    const writeText = async (t) => {
      if (!t) return;
      if (usingFSAA) await writable.write(t);
      else memChunks.push(t);
    };

    const headerToIdx = {};
    s.headers.forEach((h, i) => { headerToIdx[h] = i; });
    const featureColIdx = {};
    for (const f of features) {
      const col = s.featureMap[f];
      featureColIdx[f] = col != null && headerToIdx[col] != null ? headerToIdx[col] : -1;
    }
    const outputInputColIdx = s.headers.map((_, i) => i);

    const predLabel = IS_REG ? 'predicted_value' : 'predicted_class';
    const confLabel = IS_REG ? 'std_dev' : 'confidence';
    const outHeader = [...s.headers];
    if (s.outputCols.pred) outHeader.push(predLabel);
    if (s.outputCols.conf) outHeader.push(confLabel);
    if (s.outputCols.leaf) outHeader.push('leaf_id');
    const headerLine = outHeader.map(h => /[",\n]/.test(h) ? '"' + h.replace(/"/g, '""') + '"' : h)
      .join(s.parseConfig.delimiter) + '\n';

    const worker = spawnPredictWorker();
    s.worker = worker;

    let pending = null;
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'error') { const p = pending; pending = null; p && p.reject(new Error(m.error)); return; }
      if (m.type === 'ready' || m.type === 'output') { const p = pending; pending = null; p && p.resolve(m); }
    };
    worker.onerror = (e) => { const p = pending; pending = null; p && p.reject(new Error(e.message || 'Worker error')); };
    const ask = (msg) => new Promise((resolve, reject) => {
      if (s.cancelled) { reject(new Error('cancelled')); return; }
      pending = { resolve, reject };
      worker.postMessage(msg);
    });

    try {
      await writeText(headerLine);
      await ask({
        type: 'init', tree: TREE,
        delim: s.parseConfig.delimiter, decimalSep: s.parseConfig.decimalSep,
        featureColIdx, featureTypes: getUsedFeatureTypes(),
        outputInputColIdx, outputCols: s.outputCols,
        isReg: IS_REG, commentPrefix: s.commentPrefix || '',
        targetColIdx: (s.targetCol && headerToIdx[s.targetCol] != null) ? headerToIdx[s.targetCol] : -1,
      });

      // Stream by byte chunks. Header phase consumes complete lines from the
      // pendingText buffer, skipping comments and counting non-skippable lines
      // until headerRow; body phase passes everything else to the worker.
      const file = s.inputFile;
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let pos = 0, pendingText = '', isFirstChunk = true;
      let headerSkipped = false, nonSkipCount = 0;
      const isSkippableLine = (line) => {
        if (!line.trim()) return true;
        if (s.commentPrefix && line.trimStart().startsWith(s.commentPrefix)) return true;
        return false;
      };
      const stripHeaderPhase = () => {
        while (true) {
          const nl = pendingText.indexOf('\n');
          if (nl < 0) return false;
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
        const end = Math.min(pos + VW_CHUNK_BYTES, file.size);
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
            if (isLastByteChunk) { pendingText = ''; break; }
            s.bytesRead = pos; renderApplyDialog();
            continue;
          }
        }
        const reply = await ask({ type: 'chunk', text: pendingText, isLast: isLastByteChunk });
        pendingText = '';
        if (reply.text) await writeText(reply.text);
        s.rowsOut = reply.totalRows || s.rowsOut;
        s.bytesRead = pos;
        if (reply.stats) s.stats = reply.stats;
        renderApplyDialog();
      }
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
        const baseName = s.inputName ? s.inputName.replace(/\.[^.]+$/, '') : 'predictions';
        const a = document.createElement('a');
        a.href = url; a.download = baseName + '_predictions.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }

      s.elapsedMs = performance.now() - s.startedAt;
      s.running = false; s.completed = true; s.worker = null;
      try { worker.terminate(); } catch (e) {}
      toast(`Applied · ${s.rowsOut.toLocaleString()} rows · ${(s.elapsedMs / 1000).toFixed(1)}s`);
      renderApplyDialog();
    } catch (err) {
      if (writable) { try { await writable.abort(); } catch (e) {} }
      try { worker.terminate(); } catch (e) {}
      s.worker = null; s.running = false;
      if (err && err.message !== 'cancelled') toast('Run failed: ' + (err && err.message || err));
      renderApplyDialog();
    }
  }

  function renderApplyDoneSummary(s) {
    const stats = s.stats;
    const elapsed = (s.elapsedMs / 1000);
    const head = `<div class="vw-done-head">
      ✓ Completed · ${s.rowsOut.toLocaleString()} rows · ${elapsed.toFixed(2)}s
    </div>`;
    if (!stats) return `<div class="vw-done">${head}</div>`;

    let validationHtml = '';
    if (stats.validation && stats.validation.enabled) {
      const v = stats.validation;
      if (IS_REG && v.actualN >= 2) {
        const meanA = v.actualSum / v.actualN;
        const ssTot = v.actualSumSq - v.actualSum * v.actualSum / v.actualN;
        const ssRes = v.residSumSq;
        const r2 = ssTot > 0 ? 1 - ssRes / ssTot : (ssRes === 0 ? 1 : 0);
        const rmse = Math.sqrt(ssRes / v.actualN);
        const mae = v.absResidSum / v.actualN;
        const bias = v.residSum / v.actualN;
        validationHtml = `<div class="vw-done-section">
          <div class="vw-done-label">Validation <span class="vw-faint">${v.actualN.toLocaleString()} matched</span></div>
          <div class="vw-done-stats">
            <span>R² <strong>${fmtNum(r2)}</strong></span>
            <span>RMSE <strong>${fmtNum(rmse)}</strong></span>
            <span>MAE <strong>${fmtNum(mae)}</strong></span>
            <span>bias <strong>${bias >= 0 ? '+' : ''}${fmtNum(bias)}</strong></span>
          </div></div>`;
      } else if (!IS_REG && v.matchedCount > 0) {
        const acc = v.correctCount / v.matchedCount;
        validationHtml = `<div class="vw-done-section">
          <div class="vw-done-label">Validation <span class="vw-faint">${v.matchedCount.toLocaleString()} matched</span></div>
          <div class="vw-done-stats">
            <span>Accuracy <strong>${(acc * 100).toFixed(1)}%</strong></span>
            <span>${v.correctCount.toLocaleString()} / ${v.matchedCount.toLocaleString()} correct</span>
          </div></div>`;
      }
    }

    let distHtml;
    if (IS_REG) {
      const n = stats.valN;
      const mean = n ? stats.valSum / n : 0;
      const variance = n ? Math.max(0, stats.valSumSq / n - mean * mean) : 0;
      const std = Math.sqrt(variance);
      distHtml = `<div class="vw-done-section">
        <div class="vw-done-label">Predicted value</div>
        <div class="vw-done-stats">
          <span>min ${fmtNum(stats.valMin)}</span>
          <span>mean ${fmtNum(mean)}</span>
          <span>max ${fmtNum(stats.valMax)}</span>
          <span>σ ${fmtNum(std)}</span>
        </div></div>`;
    } else {
      const entries = Object.entries(stats.classCounts).sort((a, b) => b[1] - a[1]);
      const total = entries.reduce((a, [, n]) => a + n, 0) || 1;
      const rows = entries.map(([cls, n]) => {
        const pct = (n / total) * 100;
        return `<div class="vw-done-bar-row">
          <span class="vw-done-bar-label">${escHtml(cls)}</span>
          <span class="vw-done-bar-track"><span class="vw-done-bar-fill" style="width:${pct.toFixed(1)}%"></span></span>
          <span>${n.toLocaleString()} <span class="vw-faint">${pct.toFixed(1)}%</span></span>
        </div>`;
      }).join('');
      distHtml = `<div class="vw-done-section">
        <div class="vw-done-label">Predicted class distribution</div>
        ${rows}
      </div>`;
    }

    // Drift comparison
    let driftHtml = '';
    const fStats = stats.featureStats || {};
    const fNames = Object.keys(fStats);
    if (fNames.length) {
      const rows = fNames.map(f => {
        const t = TRAIN_STATS[f];
        const n = fStats[f];
        if (!n) return '';
        const missing = s.rowsOut ? (n.missing / s.rowsOut) * 100 : 0;
        const missTag = missing >= 1 ? `<span class="vw-flag" title="${n.missing} missing in new (${missing.toFixed(1)}%)">⚠ ${missing.toFixed(0)}% missing</span>` : '';
        if (n.type === 'numeric') {
          const newMean = n.n ? n.sum / n.n : 0;
          const trCell = t ? `${fmtNum(t.min)}–${fmtNum(t.max)} <span class="vw-faint">µ ${fmtNum(t.mean)}</span>` : '<span class="vw-faint">—</span>';
          const newCell = n.n ? `${fmtNum(n.min)}–${fmtNum(n.max)} <span class="vw-faint">µ ${fmtNum(newMean)}</span>` : '<span class="vw-faint">no values</span>';
          let flag = '';
          if (t && n.n) {
            const out = (n.min < t.min) || (n.max > t.max);
            const shift = t.std > 0 ? Math.abs(newMean - t.mean) / t.std : 0;
            if (out) flag = `<span class="vw-flag" title="New range escapes training range">⚠ out of range</span>`;
            else if (shift > 2) flag = `<span class="vw-flag" title="Mean shifted ${shift.toFixed(1)}σ vs training">⚠ ${shift.toFixed(1)}σ shift</span>`;
          }
          return `<div class="vw-drift-row">
            <span>${escHtml(f)} <span class="vw-faint">#</span></span>
            <span>${trCell}</span>
            <span class="vw-faint">→</span>
            <span>${newCell}</span>
            <span>${flag}${flag && missTag ? ' ' : ''}${missTag}</span>
          </div>`;
        }
        const trCats = t ? new Set(t.categories || []) : new Set();
        const newCats = Object.keys(n.counts);
        const novel = newCats.filter(c => !trCats.has(c));
        const trCell = t ? `${trCats.size} cats <span class="vw-faint">(${[...trCats].slice(0, 3).map(escHtml).join(', ')}${trCats.size > 3 ? '…' : ''})</span>` : '<span class="vw-faint">—</span>';
        const newCell = `${newCats.length} cats <span class="vw-faint">(${newCats.slice(0, 3).map(escHtml).join(', ')}${newCats.length > 3 ? '…' : ''})</span>`;
        const flag = novel.length ? `<span class="vw-flag" title="${novel.length} novel value${novel.length === 1 ? '' : 's'}: ${novel.slice(0, 3).map(escHtml).join(', ')}${novel.length > 3 ? '…' : ''}">⚠ ${novel.length} novel</span>` : '';
        return `<div class="vw-drift-row">
          <span>${escHtml(f)} <span class="vw-faint">●</span></span>
          <span>${trCell}</span>
          <span class="vw-faint">→</span>
          <span>${newCell}</span>
          <span>${flag}${flag && missTag ? ' ' : ''}${missTag}</span>
        </div>`;
      }).filter(Boolean).join('');
      driftHtml = `<div class="vw-done-section">
        <div class="vw-done-label">Feature drift <span class="vw-faint">training → new</span></div>${rows}</div>`;
    }

    return `<div class="vw-done">${head}${validationHtml}${distHtml}${driftHtml}</div>`;
  }

  // ─── wire up the page ───────────────────────────────────────
  function init() {
    // Theme — restore stored preference (defaults to dark)
    const stored = getStoredTheme();
    applyTheme(stored || 'dark');
    renderHeader();
    renderDescription();
    renderFooter();
    renderTree();
    renderInspector();
    initTreeInteraction();
    setTimeout(zoomFit, 30);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Expose top-level actions for inline onclicks in the template HTML
  window.vw = {
    copyText: (fmt) => {
      let t = '', label = fmt;
      if (fmt === 'text') { t = rulesToText(); label = 'Rules'; }
      else if (fmt === 'python') { t = rulesToPython(); label = 'Python'; }
      else if (fmt === 'excel') { t = rulesToExcel(); label = 'Excel IF'; }
      else if (fmt === 'sql') { t = rulesToSQL(); label = 'SQL CASE'; }
      copyText(t, label);
    },
    downloadMimicIo: downloadMimicIo,
    openApply: openApplyDialog,
    closeApply: closeApplyDialog,
    zoomIn, zoomOut, zoomFit,
    toggleTheme,
    exportSvg, exportPng,
  };
})();
