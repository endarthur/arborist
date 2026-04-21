// ═══════════════════════════════════════
//  PANEL: Configuration (column roles + tree hyperparameters + Grow)
// ═══════════════════════════════════════
// Split from the old Data panel in Phase 3.5. Shows an empty-state until a
// dataset loads, at which point csv.js flips #configSection visible.
let _configPanelElement = null;
function getConfigPanelElement() {
  if (_configPanelElement) return _configPanelElement;
  const tpl = document.getElementById('tpl-config-panel');
  _configPanelElement = tpl.content.firstElementChild.cloneNode(true);
  return _configPanelElement;
}
