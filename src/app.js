// ═══════════════════════════════════════
//  APP BOOTSTRAP (dockview init + panel registration + default layout)
// ═══════════════════════════════════════
let _dockviewApi = null;

function initDockview() {
  const container = document.getElementById('dockview-container');
  const dockview = window['dockview-core'];
  if (!dockview || typeof dockview.createDockview !== 'function') {
    console.error('dockview-core global not found');
    return;
  }
  _dockviewApi = dockview.createDockview(container, {
    className: 'dockview-theme-dark',
    createComponent: (options) => {
      let element;
      switch (options.name) {
        case 'data': element = getDataPanelElement(); break;
        case 'tree': element = getTreePanelElement(); break;
        default:
          element = document.createElement('div');
          element.textContent = `Unknown panel component: ${options.name}`;
      }
      // dockview-core requires IContentRenderer shape: { element, init, dispose? }.
      return {
        element,
        init: () => {},
      };
    },
  });

  // addPanel splits 50/50 by weight regardless of initialWidth, so the
  // default layout is authored as a fromJSON payload where the leaf `size`
  // values are relative weights — 280 vs 1000 gives roughly a 22/78 split
  // that scales with the viewport.
  _dockviewApi.fromJSON({
    grid: {
      root: {
        type: 'branch',
        data: [
          { type: 'leaf', data: { views: ['data'], activeView: 'data', id: 'group-data' }, size: 280 },
          { type: 'leaf', data: { views: ['tree'], activeView: 'tree', id: 'group-tree' }, size: 1000 },
        ],
        size: 800,
      },
      width: 1280,
      height: 800,
      orientation: 'HORIZONTAL',
    },
    panels: {
      data: { id: 'data', contentComponent: 'data', title: 'Data' },
      tree: { id: 'tree', contentComponent: 'tree', title: 'Tree Builder' },
    },
    activeGroup: 'group-tree',
  });
}

// Workshop and other helpers use this to guarantee a panel is visible before
// acting on its DOM.
function ensurePanelOpen(panelId) {
  if (!_dockviewApi) return;
  const existing = _dockviewApi.getPanel(panelId);
  if (existing) { existing.api.setActive(); return; }
  const specs = {
    data: { title: 'Data', component: 'data' },
    tree: { title: 'Tree Builder', component: 'tree' },
  };
  if (specs[panelId]) _dockviewApi.addPanel({ id: panelId, ...specs[panelId] });
}

function bootstrapApp() {
  initDockview();
  // Panel DOM is now live — wire up listeners that assume the elements exist.
  initDataPanelFileDrop();
  initImportInputListener();
  initTreeWheelZoom();
  initTreePan();
  initInspectorResize();
  // Populate the splash/sidebar saved-projects lists.
  refreshSavedLists();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
