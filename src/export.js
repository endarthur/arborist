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

