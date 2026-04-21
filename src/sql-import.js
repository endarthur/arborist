// ═══════════════════════════════════════
//  SQL CASE WHEN IMPORT
// ═══════════════════════════════════════
function showSQLImportDialog() {
  document.querySelectorAll('.load-dialog-overlay').forEach(d => d.remove());
  const overlay = document.createElement('div');
  overlay.className = 'load-dialog-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const dialog = document.createElement('div');
  dialog.className = 'sql-import-dialog';
  dialog.innerHTML = `
    <h3>📥 Import SQL CASE WHEN</h3>
    <div class="sid-hint">
      Paste a CASE WHEN block. Supports conditions like:<br>
      <code>feature &lt;= 58.5</code> · <code>feature &gt; 10</code> · <code>feature = 'oxide'</code> · <code>feature &lt;&gt; 'fresh'</code>
    </div>
    <textarea id="sqlImportText" spellcheck="false" placeholder="CASE
  WHEN Fe_pct <= 58 AND weathering = 'fresh' THEN 'BIF'
  WHEN Fe_pct > 58 AND SiO2_pct <= 4.2 THEN 'HG_oxide'
  ELSE 'unknown'
END"></textarea>
    <div class="sid-error" id="sqlImportError"></div>
    <div class="sid-buttons">
      <button class="sid-cancel" onclick="this.closest('.load-dialog-overlay').remove()">Cancel</button>
      <button class="sid-apply" onclick="applySQLImport()">🌳 Build Tree</button>
    </div>`;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  dialog.querySelector('textarea').focus();
}

function parseSQLCaseWhen(sql) {
  // Strip comments
  sql = sql.replace(/--[^\n]*/g, '');
  // Normalize whitespace
  sql = sql.replace(/\s+/g, ' ').trim();

  // Extract WHEN...THEN pairs
  const rules = [];
  let elseVal = null;

  // Match WHEN ... THEN ... patterns
  const whenRegex = /WHEN\s+(.*?)\s+THEN\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[\w.\-]+)/gi;
  let match;
  while ((match = whenRegex.exec(sql)) !== null) {
    const condStr = match[1].trim();
    const rawPred = match[2].trim().replace(/^['"]|['"]$/g, '');
    const conditions = parseConditions(condStr);
    if (conditions === null) throw new Error(`Cannot parse conditions: ${condStr}`);
    rules.push({ conditions, prediction: rawPred });
  }

  // Match ELSE
  const elseMatch = sql.match(/ELSE\s+('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|[\w.\-]+)/i);
  if (elseMatch) {
    elseVal = elseMatch[1].trim().replace(/^['"]|['"]$/g, '');
    if (elseVal.toUpperCase() === 'NULL') elseVal = null;
  }

  if (rules.length === 0) throw new Error('No WHEN clauses found');
  return { rules, elseVal };
}

function parseConditions(str) {
  // Split on AND (not inside quotes)
  const parts = [];
  let current = '', inQuote = false, qChar = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuote) {
      current += c;
      if (c === qChar) inQuote = false;
    } else if (c === "'" || c === '"') {
      inQuote = true; qChar = c; current += c;
    } else if (str.slice(i).match(/^\s+AND\s+/i)) {
      parts.push(current.trim());
      const m = str.slice(i).match(/^\s+AND\s+/i);
      i += m[0].length - 1;
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const conditions = [];
  for (const part of parts) {
    const cond = parseSingleCondition(part);
    if (!cond) return null;
    conditions.push(cond);
  }
  return conditions;
}

function parseSingleCondition(str) {
  str = str.trim();
  // Try operators in order: <=, >=, <>, !=, <, >, =
  const ops = [
    { sql: '<=', op: '≤', dir: 'left' },
    { sql: '>=', op: '≥', dir: 'right_eq' },
    { sql: '<>', op: '≠', dir: 'right' },
    { sql: '!=', op: '≠', dir: 'right' },
    { sql: '<',  op: '<', dir: 'left_strict' },
    { sql: '>',  op: '>', dir: 'right' },
    { sql: '=',  op: '=', dir: 'left' },
  ];
  for (const { sql: opStr, op, dir } of ops) {
    const idx = str.indexOf(opStr);
    if (idx === -1) continue;
    const feature = str.slice(0, idx).trim();
    let value = str.slice(idx + opStr.length).trim().replace(/^['"]|['"]$/g, '');
    if (!feature) continue;

    const numVal = parseFloat(value);
    const isNumeric = !isNaN(numVal) && isFinite(numVal) && !/^['"]/.test(str.slice(idx + opStr.length).trim());

    if (isNumeric) {
      return { feature, op, value: numVal, type: 'numeric' };
    } else {
      return { feature, op, value, type: 'categorical' };
    }
  }
  return null;
}

function buildTreeFromRules(rules, elseVal, depth = 0) {
  const id = nodeIdCounter++;

  // Base case: no rules left → else leaf
  if (rules.length === 0) {
    return { id, leaf: true, prediction: elseVal || 'unknown', classCounts: {}, gini: 0, n: 0, depth, confidence: 0, _rows: [] };
  }

  // Base case: single rule with no conditions → leaf
  if (rules.length === 1 && rules[0].conditions.length === 0) {
    return { id, leaf: true, prediction: rules[0].prediction, classCounts: {}, gini: 0, n: 0, depth, confidence: 0, _rows: [] };
  }

  // Find the best split: the first condition that appears across rules
  // Group rules by their first condition's feature + threshold to find the root split
  const firstConds = rules.filter(r => r.conditions.length > 0).map(r => r.conditions[0]);
  if (firstConds.length === 0) {
    // All rules have empty conditions — use first rule's prediction
    return { id, leaf: true, prediction: rules[0].prediction, classCounts: {}, gini: 0, n: 0, depth, confidence: 0, _rows: [] };
  }

  // Find the most common split point (feature + value)
  const splitKeys = {};
  for (const c of firstConds) {
    const key = `${c.feature}|${c.value}|${c.type}`;
    splitKeys[key] = (splitKeys[key] || 0) + 1;
  }
  const bestKey = Object.keys(splitKeys).sort((a, b) => splitKeys[b] - splitKeys[a])[0];
  const [sFeat, sVal, sType] = bestKey.split('|');
  const splitValue = sType === 'numeric' ? parseFloat(sVal) : sVal;

  // Determine split structure
  let split;
  if (sType === 'numeric') {
    split = { feature: sFeat, type: 'numeric', threshold: splitValue, gain: 0, giniLeft: 0, giniRight: 0, nLeft: 0, nRight: 0 };
  } else {
    split = { feature: sFeat, type: 'categorical', category: splitValue, gain: 0, giniLeft: 0, giniRight: 0, nLeft: 0, nRight: 0 };
  }

  // Partition rules into left and right based on this split
  const leftRules = [], rightRules = [];
  for (const rule of rules) {
    if (rule.conditions.length === 0) {
      // Rule with no conditions left — treat as else
      rightRules.push(rule);
      continue;
    }
    const c = rule.conditions[0];
    const matchesSplit = c.feature === sFeat &&
      (sType === 'numeric' ? c.value === splitValue : c.value === splitValue);

    if (matchesSplit) {
      // This rule's first condition matches our split
      const isLeft = (c.op === '≤' || c.op === '=' || c.op === '<');
      const remaining = { conditions: rule.conditions.slice(1), prediction: rule.prediction };
      if (isLeft) leftRules.push(remaining);
      else rightRules.push(remaining);
    } else {
      // Different feature/value — push to both with condition intact
      // This handles non-binary rule sets gracefully
      rightRules.push(rule);
    }
  }

  // If partitioning failed (everything on one side), make a leaf
  if (leftRules.length === 0 || rightRules.length === 0) {
    const allPreds = rules.map(r => r.prediction);
    const pred = allPreds[0];
    return { id, leaf: true, prediction: pred, classCounts: {}, gini: 0, n: 0, depth, confidence: 0, _rows: [] };
  }

  return {
    id, leaf: false, split,
    prediction: rules[0].prediction, classCounts: {}, gini: 0, n: 0,
    depth, confidence: 0, _rows: [],
    left: buildTreeFromRules(leftRules, elseVal, depth + 1),
    right: buildTreeFromRules(rightRules, elseVal, depth + 1),
  };
}

function applySQLImport() {
  const textarea = document.getElementById('sqlImportText');
  const errorDiv = document.getElementById('sqlImportError');
  errorDiv.textContent = '';

  try {
    const sql = textarea.value.trim();
    if (!sql) { errorDiv.textContent = 'Paste a SQL CASE WHEN statement'; return; }

    const { rules, elseVal } = parseSQLCaseWhen(sql);

    // Detect mode from predictions
    const preds = rules.map(r => r.prediction);
    const allNumeric = preds.every(p => !isNaN(parseFloat(p)) && isFinite(parseFloat(p)));
    TREE_MODE = allNumeric ? 'regression' : 'classification';

    // Build tree
    nodeIdCounter = 0;
    const tree = buildTreeFromRules(rules, elseVal);

    // Attach metadata
    const allFeatures = new Set();
    for (const r of rules) for (const c of r.conditions) allFeatures.add(c.feature);
    tree._features = [...allFeatures];
    tree._target = 'imported';
    tree._mode = TREE_MODE;
    tree._classes = TREE_MODE === 'classification' ? [...new Set(preds)].sort() : [];
    tree._rows = [];

    TREE = tree;

    // If data is loaded, evaluate against it
    if (DATA) {
      // Try to find a matching target column
      const possibleTargets = DATA.headers.filter(h => !allFeatures.has(h));
      if (possibleTargets.length > 0) {
        // Rebuild _rows using data
        const target = document.getElementById('targetSelect').value;
        const validRows = DATA.rows.filter(r => r[target] !== '' && r[target] !== 'NA');
        attachRowsToTree(TREE, validRows);
        TREE._target = target;
        TREE._rows = validRows;
        TREE._features = DATA.headers.filter(h => h !== target);
        if (TREE_MODE === 'classification') {
          TREE._classes = [...new Set(validRows.map(r => r[target]))].sort();
        }

        // Compute stats
        const metric = treeAccuracy(TREE, validRows, target);
        const stats = countNodes(TREE);
        const metricLabel = TREE_MODE === 'regression' ? 'R²' : 'Accuracy';
        const metricVal = TREE_MODE === 'regression' ? metric.toFixed(3) : (metric * 100).toFixed(1) + '%';
        showToast(`📥 Imported SQL tree · ${validRows.length} rows · ${stats.total} nodes, ${stats.leaves} leaves, depth ${stats.maxDepth} · ${metricLabel} ${metricVal}`);
      }
    } else {
      const stats = countNodes(TREE);
      showToast(`📥 Imported SQL tree · ${stats.total} nodes, ${stats.leaves} leaves, depth ${stats.maxDepth} · load a CSV to evaluate`);
    }

    selectedNodeId = null;
    undoStack.length = 0;
    const es = document.getElementById('emptyState');
    if (es) es.style.display = 'none';
    renderTree();
    renderRules();
    updateUndoBar();
    setTimeout(zoomFit, 30);

    document.querySelectorAll('.load-dialog-overlay').forEach(d => d.remove());
    showToast(`📥 Imported ${rules.length} rules as tree`);

  } catch (err) {
    errorDiv.textContent = err.message;
  }
}

function attachRowsToTree(node, rows) {
  node._rows = rows;
  if (node.leaf) {
    // Update stats from data
    node.n = rows.length;
    if (TREE_MODE === 'classification' && rows.length > 0 && TREE._target) {
      node.classCounts = countClasses(rows, TREE._target);
      node.gini = giniImpurity(node.classCounts, rows.length);
      const maj = majorityClass(node.classCounts);
      node.confidence = maj ? (node.classCounts[maj] || 0) / rows.length : 0;
    } else if (TREE_MODE === 'regression' && rows.length > 0 && TREE._target) {
      node.gini = regVariance(rows, TREE._target);
      node.confidence = regStd(rows, TREE._target);
      node.classCounts = {};
    }
    return;
  }
  if (!node.split) return;
  const [leftRows, rightRows] = splitRows(rows, node.split);
  node.n = rows.length;
  node.split.nLeft = leftRows.length;
  node.split.nRight = rightRows.length;

  if (TREE_MODE === 'classification' && TREE._target) {
    node.classCounts = countClasses(rows, TREE._target);
    node.gini = giniImpurity(node.classCounts, rows.length);
    const lc = countClasses(leftRows, TREE._target), rc = countClasses(rightRows, TREE._target);
    node.split.giniLeft = giniImpurity(lc, leftRows.length);
    node.split.giniRight = giniImpurity(rc, rightRows.length);
    node.split.gain = node.gini - (leftRows.length * node.split.giniLeft + rightRows.length * node.split.giniRight) / rows.length;
  } else if (TREE_MODE === 'regression' && TREE._target) {
    node.gini = regVariance(rows, TREE._target);
    node.classCounts = {};
    const lVar = regVariance(leftRows, TREE._target), rVar = regVariance(rightRows, TREE._target);
    node.split.giniLeft = lVar; node.split.giniRight = rVar;
    node.split.gain = node.gini - (leftRows.length * lVar + rightRows.length * rVar) / (rows.length || 1);
  }

  attachRowsToTree(node.left, leftRows);
  attachRowsToTree(node.right, rightRows);
}

function exportCSVPredictions() {
  if (!TREE || !DATA) return;
  const isReg = TREE_MODE === 'regression';
  const predLabel = isReg ? 'predicted_value' : 'predicted_class';
  const confLabel = isReg ? 'std_dev' : 'confidence';
  const rows = getFilteredRows();
  const headers = [...DATA.headers, predLabel, confLabel, 'leaf_id'];
  let csv = headers.join(',') + '\n';
  for (const row of rows) {
    const pred = predictRow(TREE, row);
    const vals = DATA.headers.map(h => { const v = row[h]; return typeof v === 'string' && v.includes(',') ? `"${v}"` : v; });
    const predVal = isReg ? Number(pred.class).toFixed(3) : pred.class;
    vals.push(predVal, pred.confidence.toFixed(3), pred.leafId);
    csv += vals.join(',') + '\n';
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'arborist_predictions.csv'; a.click();
  showToast('CSV predictions downloaded');
}

