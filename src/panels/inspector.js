// ═══════════════════════════════════════
//  PANEL: Inspector (node info, bonsai actions, undo, decision rules)
// ═══════════════════════════════════════
// Previously an overlay inside the tree panel. Split out in Phase 3.5 so
// the user can dock it freely (to the right of the tree, below, tabbed).
// IDs in the template (#inspectorContent, #rulesSection, #rulesBox,
// #undoBar) are preserved so the existing v1 render code continues to
// find its targets via document.getElementById.

let _inspectorPanelElement = null;
function getInspectorPanelElement() {
  if (_inspectorPanelElement) return _inspectorPanelElement;
  const tpl = document.getElementById('tpl-inspector-panel');
  _inspectorPanelElement = tpl.content.firstElementChild.cloneNode(true);
  return _inspectorPanelElement;
}
