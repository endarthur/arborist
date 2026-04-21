// ═══════════════════════════════════════
//  MENUBAR
// ═══════════════════════════════════════
// Fixed strip at the top of the viewport, above the dockview container.
// Addresses the dockview UX gap where closed panels have no reopen affordance.

const MENU_STRUCTURE = [
  {
    id: 'file',
    label: 'File',
    items: () => [
      { label: 'Open CSV…', action: () => document.getElementById('fileInput')?.click() },
      { label: 'Load Iron Ore example', action: () => loadExample('ironore') },
      { label: 'Load Rock Type example', action: () => loadExample('rocktype') },
      { label: 'Load Iris example', action: () => loadExample('iris') },
      { label: 'Load Cu Porphyry example', action: () => loadExample('porphyry') },
      { type: 'divider' },
      { label: 'Save Project', action: () => saveProject() },
      { label: 'Open Project…', action: () => showLoadDialog() },
      { label: 'Export Project as JSON', action: () => exportProject() },
      { label: 'Import Project from JSON', action: () => document.getElementById('importInput')?.click() },
      { label: 'Import SQL CASE WHEN…', action: () => showSQLImportDialog() },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: () => {
      const panelState = (id) => (_dockviewApi?.getPanel(id) ? '✓ ' : '  ');
      return [
        { label: panelState('dataset') + 'Dataset', action: () => togglePanel('dataset') },
        { label: panelState('config') + 'Configuration', action: () => togglePanel('config') },
        { label: panelState('tree') + 'Tree Builder', action: () => togglePanel('tree') },
        { label: panelState('inspector') + 'Inspector', action: () => togglePanel('inspector') },
        { label: panelState('rules') + 'Rules', action: () => togglePanel('rules') },
        { label: panelState('validation') + 'Validation', action: () => togglePanel('validation') },
        { label: panelState('importance') + 'Importance', action: () => togglePanel('importance') },
        { label: panelState('scatter') + '3D Scatter', action: () => togglePanel('scatter') },
        { type: 'divider' },
        { label: 'Reset Layout', action: () => resetLayout() },
      ];
    },
  },
  {
    id: 'tree',
    label: 'Tree',
    items: () => [
      { label: 'Grow Tree', action: () => growTree() },
      { label: 'Reset Edits', action: () => resetTree() },
      { type: 'divider' },
      { label: 'Zoom Fit', action: () => zoomFit() },
      { label: 'Zoom In', action: () => zoomIn() },
      { label: 'Zoom Out', action: () => zoomOut() },
    ],
  },
  {
    id: 'export',
    label: 'Export',
    items: () => [
      { label: 'Rules (text)', action: () => exportRules('text') },
      { label: 'Python', action: () => exportRules('python') },
      { label: 'Excel IF', action: () => exportRules('excel') },
      { label: 'SQL CASE WHEN', action: () => exportRules('sql') },
      { label: 'CSV with Predictions', action: () => exportCSVPredictions() },
      { type: 'divider' },
      { label: 'Leapfrog .lfcalc', action: () => showLfcalcDialog() },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: () => [
      { label: 'Guided Workshop', action: () => startWorkshop() },
      { label: 'Help & Guide', action: () => showHelp() },
      { type: 'divider' },
      { label: 'About / GitHub', action: () => window.open('https://github.com/endarthur/arborist', '_blank') },
    ],
  },
];

let _openMenu = null; // currently-open dropdown element, or null

function closeMenubarDropdown() {
  if (_openMenu) {
    _openMenu.remove();
    _openMenu = null;
  }
  document.querySelectorAll('#menubar .menubar-item.active').forEach(b => b.classList.remove('active'));
}

function openMenubarDropdown(menuId, anchorBtn) {
  closeMenubarDropdown();
  const menu = MENU_STRUCTURE.find(m => m.id === menuId);
  if (!menu) return;
  const items = menu.items();

  const dropdown = document.createElement('div');
  dropdown.className = 'menubar-dropdown';
  const rect = anchorBtn.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = rect.bottom + 'px';

  for (const item of items) {
    if (item.type === 'divider') {
      const div = document.createElement('div');
      div.className = 'menu-divider';
      dropdown.appendChild(div);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      closeMenubarDropdown();
      try { item.action(); } catch (e) { console.error('[menu action]', e); }
    });
    dropdown.appendChild(btn);
  }

  document.body.appendChild(dropdown);
  _openMenu = dropdown;
  anchorBtn.classList.add('active');
}

function initMenubar() {
  const bar = document.getElementById('menubar');
  if (!bar) return;
  bar.innerHTML = '';
  for (const menu of MENU_STRUCTURE) {
    const btn = document.createElement('button');
    btn.className = 'menubar-item';
    btn.dataset.menu = menu.id;
    btn.textContent = menu.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_openMenu && btn.classList.contains('active')) {
        closeMenubarDropdown();
      } else {
        openMenubarDropdown(menu.id, btn);
      }
    });
    btn.addEventListener('mouseenter', () => {
      // If a dropdown is already open, switch to this one on hover
      if (_openMenu && !btn.classList.contains('active')) {
        openMenubarDropdown(menu.id, btn);
      }
    });
    bar.appendChild(btn);
  }

  // Close on outside click or Escape
  document.addEventListener('click', () => closeMenubarDropdown());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenubarDropdown();
  });
}

// ═══════════════════════════════════════
//  View menu helpers (panel toggle + layout reset)
// ═══════════════════════════════════════

// Canonical default layout — authored here so resetLayout() and initDockview()
// both consume the same source.
const DEFAULT_LAYOUT = {
  grid: {
    root: {
      type: 'branch',
      data: [
        {
          type: 'branch',
          data: [
            { type: 'leaf', data: { views: ['dataset'], activeView: 'dataset', id: 'group-dataset' }, size: 400 },
            { type: 'leaf', data: { views: ['config'], activeView: 'config', id: 'group-config' }, size: 400 },
          ],
          size: 280,
        },
        {
          type: 'branch',
          data: [
            { type: 'leaf', data: { views: ['tree'], activeView: 'tree', id: 'group-tree' }, size: 700 },
            { type: 'leaf', data: { views: ['validation', 'importance', 'scatter'], activeView: 'validation', id: 'group-bottom' }, size: 340 },
          ],
          size: 800,
        },
        { type: 'leaf', data: { views: ['inspector', 'rules'], activeView: 'inspector', id: 'group-inspector' }, size: 300 },
      ],
      size: 800,
    },
    width: 1380,
    height: 800,
    orientation: 'HORIZONTAL',
  },
  panels: {
    dataset: { id: 'dataset', contentComponent: 'dataset', title: 'Dataset' },
    config: { id: 'config', contentComponent: 'config', title: 'Configuration' },
    tree: { id: 'tree', contentComponent: 'tree', title: 'Tree Builder' },
    inspector: { id: 'inspector', contentComponent: 'inspector', title: 'Inspector' },
    rules: { id: 'rules', contentComponent: 'rules', title: 'Rules' },
    validation: { id: 'validation', contentComponent: 'validation', title: 'Validation' },
    importance: { id: 'importance', contentComponent: 'importance', title: 'Importance' },
    scatter: { id: 'scatter', contentComponent: 'scatter', title: '3D Scatter' },
  },
  activeGroup: 'group-tree',
};

function togglePanel(panelId) {
  if (!_dockviewApi) return;
  const existing = _dockviewApi.getPanel(panelId);
  if (existing) {
    existing.api.close();
    return;
  }
  const specs = {
    dataset: { title: 'Dataset', component: 'dataset' },
    config: { title: 'Configuration', component: 'config' },
    tree: { title: 'Tree Builder', component: 'tree' },
    inspector: { title: 'Inspector', component: 'inspector' },
    rules: { title: 'Rules', component: 'rules' },
    validation: { title: 'Validation', component: 'validation' },
    importance: { title: 'Importance', component: 'importance' },
    scatter: { title: '3D Scatter', component: 'scatter' },
  };
  if (specs[panelId]) _dockviewApi.addPanel({ id: panelId, ...specs[panelId] });
}

function resetLayout() {
  if (!_dockviewApi) return;
  _dockviewApi.clear();
  _dockviewApi.fromJSON(DEFAULT_LAYOUT);
}
