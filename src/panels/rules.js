// ═══════════════════════════════════════
//  PANEL: Rules (decision rules preview + tree-scoped export buttons)
// ═══════════════════════════════════════
// Split from the inspector in Phase 3.5 — node-scoped content stayed in
// Inspector; the tree-scoped rules text and export buttons moved here.
// The #rulesBox ID is preserved so existing renderRules() keeps working.

let _rulesPanelElement = null;
function getRulesPanelElement() {
  if (_rulesPanelElement) return _rulesPanelElement;
  const tpl = document.getElementById('tpl-rules-panel');
  _rulesPanelElement = tpl.content.firstElementChild.cloneNode(true);
  return _rulesPanelElement;
}
