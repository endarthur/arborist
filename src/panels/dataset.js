// ═══════════════════════════════════════
//  PANEL: Dataset (drop zone + data summary + row filter)
// ═══════════════════════════════════════
// Split from the old Data panel in Phase 3.5 — data intake and description
// lives here, tree-configuration knobs moved to the Configuration panel.
let _datasetPanelElement = null;
function getDatasetPanelElement() {
  if (_datasetPanelElement) return _datasetPanelElement;
  const tpl = document.getElementById('tpl-dataset-panel');
  _datasetPanelElement = tpl.content.firstElementChild.cloneNode(true);
  // Re-render the summary when column roles change so role badges reflect
  // the current assignment (target / X / Y / Z / dhid).
  subscribe('columns', () => renderDataSummary());
  return _datasetPanelElement;
}
