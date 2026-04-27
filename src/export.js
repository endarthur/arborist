// ═══════════════════════════════════════
//  RULES & EXPORT
// ═══════════════════════════════════════
function extractRules(node, conditions = []) {
  if (node.leaf) return [{ conditions: [...conditions], prediction: node.prediction, confidence: node.confidence, n: node.n }];
  const s = node.split;
  const leftCond = s.type === 'numeric'
    ? { feature: s.feature, op: '≤', value: s.threshold, type: 'numeric' }
    : { feature: s.feature, op: '=', value: s.category, type: 'categorical' };
  const rightCond = s.type === 'numeric'
    ? { feature: s.feature, op: '>', value: s.threshold, type: 'numeric' }
    : { feature: s.feature, op: '≠', value: s.category, type: 'categorical' };
  return [...extractRules(node.left, [...conditions, leftCond]), ...extractRules(node.right, [...conditions, rightCond])];
}

function renderRules() {
  if (!TREE) return;
  // Rules panel may be on an inactive tab — query via the cached root.
  const root = typeof _rulesPanelElement !== 'undefined' ? _rulesPanelElement : null;
  const box = root?.querySelector('#rulesBox');
  if (!box) return;
  const rules = extractRules(TREE);
  const isReg = TREE_MODE === 'regression';
  let html = '';
  for (const r of rules) {
    html += `<span class="rule-if">IF </span>`;
    r.conditions.forEach((c, j) => {
      if (j > 0) html += `<span class="rule-if"> AND </span>`;
      html += `<span class="rule-feat">${c.feature}</span>`;
      const valStr = c.type === 'numeric' ? (Number.isInteger(c.value) ? c.value : c.value.toFixed(3)) : `"${c.value}"`;
      html += ` ${c.op} <span class="rule-val">${valStr}</span>`;
    });
    const pred = isReg ? Number(r.prediction).toFixed(3) : r.prediction;
    const meta = isReg ? `σ=${(r.confidence??0).toFixed(2)}, n=${r.n}` : `${((r.confidence??0)*100).toFixed(0)}%, n=${r.n}`;
    html += `\n  <span class="rule-if">THEN</span> <span class="rule-class">${pred}</span>`;
    html += ` <span class="rule-meta">(${meta})</span>\n\n`;
  }
  box.innerHTML = html;
}

function exportRules(format) {
  if (!TREE) return;
  const rules = extractRules(TREE);
  const isReg = TREE_MODE === 'regression';
  let text = '';
  if (format === 'text') {
    for (const r of rules) {
      const conds = r.conditions.map(c => {
        const v = c.type === 'numeric' ? (Number.isInteger(c.value) ? c.value : c.value.toFixed(3)) : `"${c.value}"`;
        return `${c.feature} ${c.op} ${v}`;
      }).join(' AND ');
      const pred = isReg ? Number(r.prediction).toFixed(3) : r.prediction;
      const meta = isReg ? `σ=${r.confidence.toFixed(2)}, n=${r.n}` : `${(r.confidence*100).toFixed(0)}%, n=${r.n}`;
      text += `IF ${conds} THEN ${pred} (${meta})\n`;
    }
  } else if (format === 'python') {
    text = `def predict(row):\n` + treeToIfElse(TREE, '    ');
  } else if (format === 'excel') {
    text = treeToExcel(TREE);
  } else if (format === 'sql') {
    text = treeToSQL(TREE);
  }
  navigator.clipboard.writeText(text).then(() => showToast(`${format} rules copied to clipboard`));
}

function treeToIfElse(node, indent) {
  const isReg = TREE_MODE === 'regression';
  if (node.leaf) {
    const pred = isReg ? Number(node.prediction).toFixed(6) : `"${node.prediction}"`;
    const comment = isReg ? `σ=${(node.confidence??0).toFixed(2)}, n=${node.n}` : `${((node.confidence??0)*100).toFixed(0)}%, n=${node.n}`;
    return `${indent}return ${pred}  # ${comment}\n`;
  }
  const s = node.split;
  const cond = s.type === 'numeric'
    ? `row["${s.feature}"] <= ${Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(6)}`
    : `row["${s.feature}"] == "${s.category}"`;
  return `${indent}if ${cond}:\n` + treeToIfElse(node.left, indent + '    ')
    + `${indent}else:\n` + treeToIfElse(node.right, indent + '    ');
}

function treeToExcel(node) {
  const isReg = TREE_MODE === 'regression';
  function gen(n) {
    if (n.leaf) return isReg ? Number(n.prediction).toFixed(3) : `"${n.prediction}"`;
    const s = n.split;
    const cond = s.type === 'numeric'
      ? `${s.feature}<=${Number.isInteger(s.threshold) ? s.threshold : s.threshold.toFixed(3)}`
      : `${s.feature}="${s.category}"`;
    return `IF(${cond},${gen(n.left)},${gen(n.right)})`;
  }
  return '=' + gen(node);
}

function treeToSQL(tree) {
  const rules = extractRules(tree);
  const isReg = TREE_MODE === 'regression';
  const target = tree._target || 'prediction';
  const sqlOp = op => ({ '≤': '<=', '≠': '<>', '=': '=', '>': '>' }[op] || op);
  let sql = `-- Arborist CART ${isReg ? 'regression' : 'classification'} tree\n`;
  sql += `-- Target: ${target} | Leaves: ${rules.length}\n`;
  sql += `CASE\n`;
  for (const r of rules) {
    const conds = r.conditions.map(c => {
      if (c.type === 'numeric') {
        const v = Number.isInteger(c.value) ? c.value : c.value.toFixed(6);
        return `${c.feature} ${sqlOp(c.op)} ${v}`;
      } else {
        return `${c.feature} ${sqlOp(c.op)} '${c.value}'`;
      }
    }).join('\n      AND ');
    const pred = isReg ? Number(r.prediction).toFixed(3) : `'${r.prediction}'`;
    sql += `  WHEN ${conds}\n    THEN ${pred}\n`;
  }
  sql += `  ELSE NULL\nEND AS ${target}_pred`;
  return sql;
}

// ═══════════════════════════════════════
//  MIMIC-IO JSON EXPORT (sklearn-compatible interchange)
// ═══════════════════════════════════════
// Flattens the v1 node-graph tree to sklearn's parallel-array layout.
// Categoricals don't fit sklearn's numeric-threshold model; we add a
// `category` array as an Arborist extension and the Python shim reads it.
// Loadable via `arborist_mimic.load(path).predict(X)` (see
// docs/python-shim/arborist_mimic.py).
function exportMimicIo() {
  if (!TREE) { showToast('No tree to export'); return; }
  const isReg = TREE._mode === 'regression';
  const featureNames = TREE._features || [];
  const classNames = isReg ? null : (TREE._classes || []);

  // Two-pass flatten. First pass walks the tree to assign sequential
  // depth-first indices; second pass fills the parallel arrays.
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
    children_left:  new Array(n),
    children_right: new Array(n),
    feature:        new Array(n),
    threshold:      new Array(n),
    category:       new Array(n),
    value:          new Array(n),
    impurity:       new Array(n),
    n_node_samples: new Array(n),
  };

  for (let i = 0; i < n; i++) {
    const { node, leftIdx, rightIdx } = order[i];
    tree.children_left[i]  = node.leaf ? -1 : leftIdx;
    tree.children_right[i] = node.leaf ? -1 : rightIdx;
    if (node.leaf) {
      tree.feature[i]   = -2;
      tree.threshold[i] = -2;
      tree.category[i]  = null;
    } else {
      tree.feature[i] = featureNames.indexOf(node.split.feature);
      if (node.split.type === 'numeric') {
        tree.threshold[i] = node.split.threshold;
        tree.category[i]  = null;
      } else {
        // Categorical split: threshold is meaningless; carry the category
        // via the Arborist extension. The Python shim picks the right path
        // when category[i] !== null.
        tree.threshold[i] = null;
        tree.category[i]  = node.split.category;
      }
    }
    tree.impurity[i]       = node.gini;
    tree.n_node_samples[i] = node.n;
    if (isReg) {
      tree.value[i] = [Number(node.prediction)];
    } else {
      tree.value[i] = classNames.map(c => (node.classCounts && node.classCounts[c]) || 0);
    }
  }

  const payload = {
    format: 'mimic-io',
    version: 1,
    algorithm: 'CART',
    criterion: isReg ? 'variance' : 'gini',
    mode: isReg ? 'regression' : 'classification',
    n_features: featureNames.length,
    n_classes: isReg ? 1 : classNames.length,
    feature_names: featureNames,
    class_names: classNames,
    target_name: TREE._target || null,
    tree,
    bonsai: {
      // Reserved for future bonsai-edit metadata (forced splits, forced
      // classes, pruned nodes). Not yet tracked through the undo stack.
      forced_splits: [],
      forced_classes: {},
      pruned_nodes: [],
    },
    exported_at: new Date().toISOString(),
  };

  // JSON.stringify drops NaN/Infinity to null by default? No — it actually
  // emits the literals which are invalid JSON. Replacer handles that.
  const text = JSON.stringify(payload, (_, v) => {
    if (typeof v === 'number' && !isFinite(v)) return null;
    return v;
  }, 2);

  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (TREE._target || 'arborist_tree') + '.mimic-io.json';
  a.click();
  showToast(`mimic-io JSON exported · ${n} nodes`);
}

