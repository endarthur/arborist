// ═══════════════════════════════════════
//  BONSAI: tree mutation engine
// ═══════════════════════════════════════
const undoStack = [];
const MAX_UNDO = 30;

function deepCloneTree(node) {
  if (!node) return null;
  const clone = { ...node, classCounts: { ...node.classCounts } };
  // Keep _rows as shared reference (no need to deep copy data)
  if (!node.leaf) {
    clone.left = deepCloneTree(node.left);
    clone.right = deepCloneTree(node.right);
  }
  return clone;
}

function pushUndo(label) {
  // Save full tree state + metadata
  undoStack.push({
    tree: deepCloneTree(TREE),
    label,
    _target: TREE._target,
    _features: [...TREE._features],
    _classes: [...TREE._classes],
    _rows: TREE._rows,
  });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  updateUndoBar();
}

function undoEdit() {
  if (undoStack.length === 0) return;
  const state = undoStack.pop();
  TREE = state.tree;
  TREE._target = state._target;
  TREE._features = state._features;
  TREE._classes = state._classes;
  TREE._rows = state._rows;
  refreshAfterEdit();
  showToast('Undo: ' + state.label);
}

function updateUndoBar() {
  const bar = document.getElementById('undoBar');
  if (!bar) return;
  if (undoStack.length === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = '';
    bar.querySelector('.edit-count').textContent = undoStack.length;
  }
}

function refreshAfterEdit() {
  // Save selected node's row ref before re-IDing
  let selectedRows = null;
  if (selectedNodeId !== null) {
    const selNode = findNode(TREE, selectedNodeId);
    if (selNode) selectedRows = selNode._rows;
  }
  // Reassign IDs and fix depths
  nodeIdCounter = 0;
  fixTreeMeta(TREE, 0);
  // Update stats
  const acc = treeAccuracy(TREE, TREE._rows, TREE._target);
  const stats = countNodes(TREE);
  const metricLabel = TREE_MODE === 'regression' ? 'R²' : 'Accuracy';
  const metricVal = TREE_MODE === 'regression' ? acc.toFixed(3) : (acc * 100).toFixed(1) + '%';
  document.getElementById('statsBar').innerHTML = `
    <span>Rows: <span class="stat-val">${TREE._rows.length}</span></span>
    <span>Nodes: <span class="stat-val">${stats.total}</span></span>
    <span>Leaves: <span class="stat-val">${stats.leaves}</span></span>
    <span>Depth: <span class="stat-val">${stats.maxDepth}</span></span>
    <span>${metricLabel}: <span class="stat-val">${metricVal}</span></span>
    <span>Edits: <span class="stat-val" style="color:var(--amber)">${undoStack.length}</span></span>
  `;
  renderTree();
  renderRules();
  updateUndoBar();
  if (selectedRows) {
    const node = findNodeWithRows(TREE, selectedRows);
    if (node) { selectedNodeId = node.id; selectNode(node.id); }
    else deselectNode();
  }

  publish('tree', TREE);
}

function fixTreeMeta(node, depth) {
  node.id = nodeIdCounter++;
  node.depth = depth;
  if (!node.leaf) {
    fixTreeMeta(node.left, depth + 1);
    fixTreeMeta(node.right, depth + 1);
  }
}

// ── Prune to Leaf ──
function pruneToLeaf(nodeId) {
  const node = findNode(TREE, nodeId);
  if (!node || node.leaf) return;
  pushUndo('Prune node ' + node.split.feature);
  // Convert to leaf: keep classCounts, prediction, n, _rows
  node.leaf = true;
  delete node.left;
  delete node.right;
  delete node.split;
  refreshAfterEdit();
  // Reselect
  const newNode = findNodeWithRows(TREE, node._rows);
  if (newNode) selectNode(newNode.id);
  showToast('✂ Pruned to leaf');
}

// ── Regrow from Leaf ──
function regrowFromLeaf(nodeId) {
  const node = findNode(TREE, nodeId);
  if (!node || !node.leaf || !node._rows) return;
  pushUndo('Regrow from leaf');
  const maxDepth = parseInt(document.getElementById('maxDepth').value) || 5;
  const minLeaf = parseInt(document.getElementById('minLeaf').value) || 3;
  const minSplit = parseInt(document.getElementById('minSplit').value) || 6;
  const depthBudget = maxDepth - node.depth;
  if (depthBudget <= 0) { showToast('At max depth — increase Max Depth first'); return; }

  const subtree = buildTree(node._rows, TREE._features, TREE._target, DATA.types,
    node.depth, node.depth + depthBudget, minLeaf, minSplit);
  // Graft subtree onto parent
  Object.assign(node, subtree);
  refreshAfterEdit();
  showToast('🌱 Regrew subtree');
}

// ── Force Split ──
function forceSplit(nodeId, split) {
  const node = findNode(TREE, nodeId);
  if (!node || !node._rows) return;

  // Check if this is already the current split
  if (!node.leaf && node.split && node.split.feature === split.feature) {
    if ((split.type === 'numeric' && Math.abs((node.split.threshold||0) - (split.threshold||0)) < 0.001) ||
        (split.type === 'categorical' && node.split.category === split.category)) {
      return; // Already this split
    }
  }

  pushUndo('Force split: ' + split.feature);
  const [leftRows, rightRows] = splitRows(node._rows, split);
  if (leftRows.length === 0 || rightRows.length === 0) {
    showToast('Split produces an empty child — skipped');
    undoStack.pop();
    return;
  }

  // Compute proper split stats
  const isReg = TREE_MODE === 'regression';
  let parentImp, lImp, rImp;
  if (isReg) {
    parentImp = regVariance(node._rows, TREE._target);
    lImp = regVariance(leftRows, TREE._target);
    rImp = regVariance(rightRows, TREE._target);
  } else {
    parentImp = giniImpurity(countClasses(node._rows, TREE._target), node._rows.length);
    const lc = countClasses(leftRows, TREE._target), rc = countClasses(rightRows, TREE._target);
    lImp = giniImpurity(lc, leftRows.length); rImp = giniImpurity(rc, rightRows.length);
  }
  const total = leftRows.length + rightRows.length;
  split.gain = parentImp - (leftRows.length * lImp + rightRows.length * rImp) / total;
  split.giniLeft = lImp;
  split.giniRight = rImp;
  split.nLeft = leftRows.length;
  split.nRight = rightRows.length;

  const maxDepth = parseInt(document.getElementById('maxDepth').value) || 5;
  const minLeaf = parseInt(document.getElementById('minLeaf').value) || 3;
  const minSplit = parseInt(document.getElementById('minSplit').value) || 6;

  node.leaf = false;
  node.split = split;
  node.left = buildTree(leftRows, TREE._features, TREE._target, DATA.types,
    node.depth + 1, maxDepth, minLeaf, minSplit);
  node.right = buildTree(rightRows, TREE._features, TREE._target, DATA.types,
    node.depth + 1, maxDepth, minLeaf, minSplit);

  refreshAfterEdit();
  const newNode = findNodeWithRows(TREE, node._rows);
  if (newNode) selectNode(newNode.id);
  showToast('🔀 Forced split on ' + split.feature);
}

function findNodeWithRows(node, rows) {
  if (node._rows === rows) return node;
  if (node.leaf) return null;
  return findNodeWithRows(node.left, rows) || findNodeWithRows(node.right, rows);
}

// ── Find top N splits for a node's rows ──
function findTopSplits(rows, features, target, types, minLeaf, maxResults) {
  const n = rows.length;
  const isReg = TREE_MODE === 'regression';
  let parentImpurity;
  if (isReg) {
    parentImpurity = regVariance(rows, target);
  } else {
    const parentCounts = countClasses(rows, target);
    parentImpurity = giniImpurity(parentCounts, n);
  }
  const allSplits = [];

  for (const feat of features) {
    if (feat === target) continue;
    if (types[feat] === 'numeric') {
      const valid = rows.filter(r => r[feat] !== '' && r[feat] !== 'NA' && !isNaN(parseFloat(r[feat])));
      if (valid.length < 2) continue;
      let bestForFeat = null;

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
          const gain = parentImpurity - (lN * lVar + rN * rVar) / (lN + rN);
          if (!bestForFeat || gain > bestForFeat.gain) {
            bestForFeat = { feature: feat, type: 'numeric', threshold: (sorted[i].val + sorted[i + 1].val) / 2, gain, nLeft: lN, nRight: rN };
          }
        }
      } else {
        const sorted = valid.map(r => ({ val: parseFloat(r[feat]), cls: r[target] })).sort((a, b) => a.val - b.val);
        const parentCounts2 = countClasses(rows, target);
        const leftCounts = {}, rightCounts = { ...parentCounts2 };
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
          const wGini = (leftN * giniImpurity(leftCounts, leftN) + rightN * giniImpurity(rightCounts, rightN)) / (leftN + rightN);
          const gain = parentImpurity - wGini;
          if (!bestForFeat || gain > bestForFeat.gain) {
            bestForFeat = { feature: feat, type: 'numeric', threshold: (sorted[i].val + sorted[i+1].val) / 2, gain, nLeft: leftN, nRight: rightN };
          }
        }
      }
      if (bestForFeat) allSplits.push(bestForFeat);
    } else {
      const categories = [...new Set(rows.map(r => r[feat]).filter(v => v !== '' && v !== 'NA'))];
      if (categories.length < 2) continue;
      let bestForFeat = null;
      for (const cat of categories) {
        const lRows = rows.filter(r => r[feat] === cat);
        const rRows = rows.filter(r => r[feat] !== cat && r[feat] !== '' && r[feat] !== 'NA');
        if (lRows.length < minLeaf || rRows.length < minLeaf) continue;
        const total = lRows.length + rRows.length;
        let gain;
        if (isReg) {
          gain = parentImpurity - (lRows.length * regVariance(lRows, target) + rRows.length * regVariance(rRows, target)) / total;
        } else {
          const lc = countClasses(lRows, target), rc = countClasses(rRows, target);
          gain = parentImpurity - (lRows.length * giniImpurity(lc, lRows.length) + rRows.length * giniImpurity(rc, rRows.length)) / total;
        }
        if (!bestForFeat || gain > bestForFeat.gain) {
          bestForFeat = { feature: feat, type: 'categorical', category: cat, gain, nLeft: lRows.length, nRight: rRows.length };
        }
      }
      if (bestForFeat) allSplits.push(bestForFeat);
    }
  }
  return allSplits.sort((a, b) => b.gain - a.gain).slice(0, maxResults);
}

function resetTree() {
  if (undoStack.length === 0) return;
  const first = undoStack[0];
  TREE = first.tree;
  TREE._target = first._target;
  TREE._features = first._features;
  TREE._classes = first._classes;
  TREE._rows = first._rows;
  undoStack.length = 0;
  selectedNodeId = null;
  refreshAfterEdit();
  showToast('⟲ Reset to original tree');
}

