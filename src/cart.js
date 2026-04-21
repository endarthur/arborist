// ═══════════════════════════════════════
//  CART (Gini / Variance — classification + regression)
// ═══════════════════════════════════════
let TREE_MODE = 'classification'; // or 'regression'

function giniImpurity(classCounts, total) {
  if (total === 0) return 0;
  let sum = 0;
  for (const c of Object.values(classCounts)) { const p = c / total; sum += p * p; }
  return 1 - sum;
}

function countClasses(rows, target) {
  const counts = {};
  for (const r of rows) { const v = r[target]; counts[v] = (counts[v] || 0) + 1; }
  return counts;
}

function majorityClass(classCounts) {
  let best = null, bestN = -1;
  for (const [cls, n] of Object.entries(classCounts)) { if (n > bestN) { best = cls; bestN = n; } }
  return best;
}

// Regression helpers
function regVariance(rows, target) {
  if (rows.length === 0) return 0;
  const vals = rows.map(r => parseFloat(r[target])).filter(v => !isNaN(v));
  if (vals.length === 0) return 0;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length;
}
function regMean(rows, target) {
  const vals = rows.map(r => parseFloat(r[target])).filter(v => !isNaN(v));
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}
function regStd(rows, target) { return Math.sqrt(regVariance(rows, target)); }

function findBestSplit(rows, features, target, types, minLeaf) {
  const n = rows.length;
  const isReg = TREE_MODE === 'regression';
  let parentImpurity, parentCounts;
  if (isReg) {
    parentImpurity = regVariance(rows, target);
  } else {
    parentCounts = countClasses(rows, target);
    parentImpurity = giniImpurity(parentCounts, n);
  }
  let bestGain = -Infinity, bestSplit = null;

  for (const feat of features) {
    if (feat === target) continue;
    if (types[feat] === 'numeric') {
      const valid = rows.filter(r => r[feat] !== '' && r[feat] !== 'NA' && !isNaN(parseFloat(r[feat])));
      if (valid.length < 2) continue;

      if (isReg) {
        const sorted = valid.map(r => ({ val: parseFloat(r[feat]), y: parseFloat(r[target]) })).sort((a, b) => a.val - b.val);
        let lN = 0, lSum = 0, lSqSum = 0;
        let rN = sorted.length, rSum = sorted.reduce((a, d) => a + d.y, 0), rSqSum = sorted.reduce((a, d) => a + d.y * d.y, 0);
        for (let i = 0; i < sorted.length - 1; i++) {
          lN++; lSum += sorted[i].y; lSqSum += sorted[i].y * sorted[i].y;
          rN--; rSum -= sorted[i].y; rSqSum -= sorted[i].y * sorted[i].y;
          if (sorted[i].val === sorted[i + 1].val) continue;
          if (lN < minLeaf || rN < minLeaf) continue;
          const lVar = Math.max(0, lSqSum / lN - (lSum / lN) ** 2);
          const rVar = Math.max(0, rSqSum / rN - (rSum / rN) ** 2);
          const wVar = (lN * lVar + rN * rVar) / (lN + rN);
          const gain = parentImpurity - wVar;
          if (gain > bestGain) {
            bestGain = gain;
            bestSplit = { feature: feat, type: 'numeric', threshold: (sorted[i].val + sorted[i + 1].val) / 2,
              gain, giniLeft: lVar, giniRight: rVar, nLeft: lN, nRight: rN };
          }
        }
      } else {
        const sorted = valid.map(r => ({ val: parseFloat(r[feat]), cls: r[target] })).sort((a, b) => a.val - b.val);
        const leftCounts = {}, rightCounts = { ...parentCounts };
        const missing = rows.filter(r => r[feat] === '' || r[feat] === 'NA' || isNaN(parseFloat(r[feat])));
        for (const m of missing) { rightCounts[m[target]]--; if (rightCounts[m[target]] === 0) delete rightCounts[m[target]]; }
        let leftN = 0, rightN = valid.length;
        for (let i = 0; i < sorted.length - 1; i++) {
          const cls = sorted[i].cls;
          leftCounts[cls] = (leftCounts[cls] || 0) + 1;
          rightCounts[cls]--; if (rightCounts[cls] === 0) delete rightCounts[cls];
          leftN++; rightN--;
          if (sorted[i].val === sorted[i + 1].val) continue;
          if (leftN < minLeaf || rightN < minLeaf) continue;
          const leftGini = giniImpurity(leftCounts, leftN);
          const rightGini = giniImpurity(rightCounts, rightN);
          const wGini = (leftN * leftGini + rightN * rightGini) / (leftN + rightN);
          const gain = parentImpurity - wGini;
          if (gain > bestGain) {
            bestGain = gain;
            bestSplit = { feature: feat, type: 'numeric', threshold: (sorted[i].val + sorted[i + 1].val) / 2,
              gain, giniLeft: leftGini, giniRight: rightGini, nLeft: leftN, nRight: rightN };
          }
        }
      }
    } else {
      const categories = [...new Set(rows.map(r => r[feat]).filter(v => v !== '' && v !== 'NA'))];
      if (categories.length < 2) continue;
      for (const cat of categories) {
        const leftRows = rows.filter(r => r[feat] === cat);
        const rightRows = rows.filter(r => r[feat] !== cat && r[feat] !== '' && r[feat] !== 'NA');
        if (leftRows.length < minLeaf || rightRows.length < minLeaf) continue;
        const total = leftRows.length + rightRows.length;
        let gain, lImp, rImp;
        if (isReg) {
          lImp = regVariance(leftRows, target); rImp = regVariance(rightRows, target);
        } else {
          const lc = countClasses(leftRows, target), rc = countClasses(rightRows, target);
          lImp = giniImpurity(lc, leftRows.length); rImp = giniImpurity(rc, rightRows.length);
        }
        gain = parentImpurity - (leftRows.length * lImp + rightRows.length * rImp) / total;
        if (gain > bestGain) {
          bestGain = gain;
          bestSplit = { feature: feat, type: 'categorical', category: cat, gain,
            giniLeft: lImp, giniRight: rImp, nLeft: leftRows.length, nRight: rightRows.length };
        }
      }
    }
  }
  return bestSplit;
}

function splitRows(rows, split) {
  if (split.type === 'numeric') {
    const left = rows.filter(r => { const v = parseFloat(r[split.feature]); return !isNaN(v) && v <= split.threshold; });
    const right = rows.filter(r => { const v = parseFloat(r[split.feature]); return !isNaN(v) && v > split.threshold; });
    return [left, right];
  }
  return [rows.filter(r => r[split.feature] === split.category),
          rows.filter(r => r[split.feature] !== split.category && r[split.feature] !== '' && r[split.feature] !== 'NA')];
}

let nodeIdCounter = 0;

function buildTree(rows, features, target, types, depth, maxDepth, minLeaf, minSplit) {
  const id = nodeIdCounter++;
  const n = rows.length;
  const isReg = TREE_MODE === 'regression';

  let classCounts, gini, prediction, confidence;
  if (isReg) {
    classCounts = {};
    gini = regVariance(rows, target);
    prediction = regMean(rows, target);
    confidence = regStd(rows, target); // std stored in confidence field
    const uniqueVals = new Set(rows.map(r => r[target])).size;
    if (depth >= maxDepth || n < minSplit || uniqueVals <= 1) {
      return { id, leaf: true, prediction, classCounts, gini, n, depth, confidence, _rows: rows };
    }
  } else {
    classCounts = countClasses(rows, target);
    gini = giniImpurity(classCounts, n);
    prediction = majorityClass(classCounts);
    confidence = (classCounts[prediction] || 0) / n;
    const uniqueClasses = Object.keys(classCounts).length;
    if (depth >= maxDepth || n < minSplit || uniqueClasses <= 1) {
      return { id, leaf: true, prediction, classCounts, gini, n, depth, confidence, _rows: rows };
    }
  }

  const split = findBestSplit(rows, features, target, types, minLeaf);
  if (!split || split.gain <= 0) {
    return { id, leaf: true, prediction, classCounts, gini, n, depth, confidence, _rows: rows };
  }
  const [leftRows, rightRows] = splitRows(rows, split);
  if (leftRows.length === 0 || rightRows.length === 0) {
    return { id, leaf: true, prediction, classCounts, gini, n, depth, confidence, _rows: rows };
  }

  return {
    id, leaf: false, split, prediction, classCounts, gini, n, depth,
    confidence, _rows: rows,
    left: buildTree(leftRows, features, target, types, depth + 1, maxDepth, minLeaf, minSplit),
    right: buildTree(rightRows, features, target, types, depth + 1, maxDepth, minLeaf, minSplit),
  };
}

function predictRow(node, row) {
  if (node.leaf) return { class: node.prediction, confidence: node.confidence, leafId: node.id };
  const { split } = node;
  if (split.type === 'numeric') {
    const v = parseFloat(row[split.feature]);
    if (isNaN(v)) return { class: node.prediction, confidence: node.confidence, leafId: node.id };
    return v <= split.threshold ? predictRow(node.left, row) : predictRow(node.right, row);
  }
  return row[split.feature] === split.category ? predictRow(node.left, row) : predictRow(node.right, row);
}

function treeAccuracy(tree, rows, target) {
  if (TREE_MODE === 'regression') {
    const vals = rows.map(r => parseFloat(r[target]));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const ssTot = vals.reduce((a, v) => a + (v - mean) ** 2, 0);
    if (ssTot === 0) return 1;
    const ssRes = rows.reduce((a, r) => {
      const pred = predictRow(tree, r).class;
      return a + (parseFloat(r[target]) - pred) ** 2;
    }, 0);
    return Math.max(0, 1 - ssRes / ssTot);
  }
  let correct = 0;
  for (const r of rows) { if (predictRow(tree, r).class === r[target]) correct++; }
  return correct / rows.length;
}

function countNodes(node) {
  if (node.leaf) return { total: 1, leaves: 1, maxDepth: node.depth };
  const l = countNodes(node.left), r = countNodes(node.right);
  return { total: 1 + l.total + r.total, leaves: l.leaves + r.leaves, maxDepth: Math.max(l.maxDepth, r.maxDepth) };
}

// ═══════════════════════════════════════
//  GROW
// ═══════════════════════════════════════
function growTree() {
  if (!DATA) return;
  const roles = getColumnRoles();
  const target = roles.target;
  const features = roles.features;
  const maxDepth = parseInt(document.getElementById('maxDepth').value) || 5;
  const minLeaf = parseInt(document.getElementById('minLeaf').value) || 5;
  const minSplit = parseInt(document.getElementById('minSplit').value) || 10;
  const allRows = filterToTrain(getFilteredRows());
  const validRows = allRows.filter(r => r[target] !== '' && r[target] !== 'NA' && r[target] !== 'null');

  // Detect mode from target column type
  TREE_MODE = DATA.types[target] === 'numeric' ? 'regression' : 'classification';

  nodeIdCounter = 0;
  const t0 = performance.now();
  TREE = buildTree(validRows, features, target, DATA.types, 0, maxDepth, minLeaf, minSplit);
  TREE._target = target; TREE._features = features;
  TREE._mode = TREE_MODE;
  TREE._rows = validRows;
  if (TREE_MODE === 'classification') {
    TREE._classes = [...new Set(validRows.map(r => r[target]))].sort();
  } else {
    TREE._classes = [];
  }
  const elapsed = (performance.now() - t0).toFixed(1);
  const metric = treeAccuracy(TREE, validRows, target);
  const stats = countNodes(TREE);
  const metricLabel = TREE_MODE === 'regression' ? 'R²' : 'Accuracy';
  const metricVal = TREE_MODE === 'regression' ? metric.toFixed(3) : (metric * 100).toFixed(1) + '%';

  const filterTag = currentFilter ? ' · filtered' : '';
  showToast(
    `🌱 Grew tree · ${validRows.length} rows · ${stats.total} nodes, ${stats.leaves} leaves, depth ${stats.maxDepth} · ` +
    `${metricLabel} ${metricVal} · ${elapsed} ms${filterTag}`
  );

  selectedNodeId = null;
  undoStack.length = 0;
  renderInspectorDefault();
  const es = document.getElementById('emptyState');
  if (es) es.style.display = 'none';
  renderTree();
  renderRules();
  updateUndoBar();
  setTimeout(zoomFit, 30);

  publish('tree', TREE);
}

