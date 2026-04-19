// ═══════════════════════════════════════
//  PANEL: Data (left rail — data loading, column config, file ops, stats)
// ═══════════════════════════════════════
// v1 left-rail DOM lives in <template id="tpl-data-panel"> in src/index.html.
// The element is cloned once, cached, and reused across panel mount/unmount
// cycles so IDs stay stable and existing v1 code continues to find its targets.
let _dataPanelElement = null;
function getDataPanelElement() {
  if (_dataPanelElement) return _dataPanelElement;
  const tpl = document.getElementById('tpl-data-panel');
  _dataPanelElement = tpl.content.firstElementChild.cloneNode(true);
  return _dataPanelElement;
}
