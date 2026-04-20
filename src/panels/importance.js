// ═══════════════════════════════════════
//  PANEL: Feature Importance
// ═══════════════════════════════════════
// Standard CART feature importance: at every internal node, the feature
// used by the split gets credit for the weighted impurity decrease
//   n_node * impurity_node − n_left * impurity_left − n_right * impurity_right
// (same formula as sklearn, works for both Gini and variance). Per-feature
// totals are normalised to sum to 100%.

function computeFeatureImportance(tree) {
  if (!tree) return [];
  const features = tree._features || [];
  const importance = Object.create(null);
  for (const f of features) importance[f] = 0;

  function visit(node) {
    if (!node || node.leaf) return;
    const f = node.split?.feature;
    if (f != null) {
      const nodeImp = node.gini * node.n;
      const leftImp = (node.left?.gini ?? 0) * (node.left?.n ?? 0);
      const rightImp = (node.right?.gini ?? 0) * (node.right?.n ?? 0);
      importance[f] = (importance[f] || 0) + (nodeImp - leftImp - rightImp);
    }
    visit(node.left);
    visit(node.right);
  }
  visit(tree);

  const total = Object.values(importance).reduce((a, b) => a + b, 0);
  const out = features.map(f => ({
    feature: f,
    importance: total > 0 ? importance[f] / total : 0,
    raw: importance[f],
  }));
  out.sort((a, b) => b.importance - a.importance);
  return out;
}

let _importancePanelElement = null;
function getImportancePanelElement() {
  if (_importancePanelElement) return _importancePanelElement;
  const tpl = document.getElementById('tpl-importance-panel');
  _importancePanelElement = tpl.content.firstElementChild.cloneNode(true);
  initImportancePanelListeners(_importancePanelElement);
  return _importancePanelElement;
}

function initImportancePanelListeners(root) {
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(renderImportancePanel, 50);
  };
  subscribe('tree', schedule);
  subscribe('dataset', schedule);
  subscribe('columns', schedule);
}

function renderImportancePanel() {
  // Importance lives in a tabbed group; dockview only attaches the active
  // tab's content to the live DOM, so document.getElementById can't find
  // the panel's children while the tab is inactive. Query the cached root
  // instead — it stays live regardless of attachment state.
  const root = _importancePanelElement;
  const container = root?.querySelector('#impContent');
  if (!container) return;

  if (!DATA) {
    container.innerHTML = '<div class="val-empty">Load a dataset first.</div>';
    return;
  }
  if (!TREE) {
    container.innerHTML = '<div class="val-empty">Grow a tree to see feature importance.</div>';
    return;
  }

  const items = computeFeatureImportance(TREE);
  if (items.length === 0) {
    container.innerHTML = '<div class="val-empty">Tree has no splits yet.</div>';
    return;
  }

  const topPct = items[0]?.importance || 0;
  if (topPct === 0) {
    container.innerHTML = '<div class="val-empty">No feature contributed to splits — tree is a single leaf.</div>';
    return;
  }

  let html = '<div class="imp-list">';
  for (const item of items) {
    const pct = item.importance * 100;
    const widthPct = topPct > 0 ? (item.importance / topPct) * 100 : 0;
    const dim = pct < 0.5 ? ' imp-row-dim' : '';
    html += `
      <div class="imp-row${dim}">
        <span class="imp-feature">${item.feature}</span>
        <div class="imp-bar-wrap">
          <div class="imp-bar" style="width:${widthPct.toFixed(1)}%"></div>
        </div>
        <span class="imp-pct">${pct.toFixed(1)}%</span>
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}
