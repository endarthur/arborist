# Arborist — repository orientation

A reference for working on this repo cold. Conventions, build mechanics, and
the dockview-integration patterns we hit the hard way during the v2 rebuild.
For *what* the app does and *why*, see `README.md` and `docs/SPEC-v2.md`.

## TL;DR

- One-file artifact. `node build.js` reads `src/index.html`, resolves
  `<!-- INLINE: path -->` tokens against `src/`, writes the result to
  `./index.html` at the repo root. That root file is the canonical
  artifact: opens from `file://`, served by GitHub Pages, USB-stickable.
- `src/` is the editable source. `src/panels/*.js` are dockview panel
  modules. `src/vendor/` holds vendored third-party code (dockview-core,
  three.min.js, three-orbitcontrols.js, dee.js).
- No npm in production. The build is zero-dep Node. Vendored libraries
  are checked in.
- Single global script scope. All non-vendor `src/*.js` files are
  concatenated into one `<script>` block. Top-level `let`/`const`
  declarations share a scope; cross-file function calls work.

## Build

`build.js` is ~25 lines. The shell `src/index.html` contains
`<!-- INLINE: path -->` tokens; the build replaces each with the file
contents. Vendored scripts get their own `<script>` blocks (they have
their own UMD/IIFE wrappers); the rest of `src/` concats into one block.

### INLINE order matters

`let`/`const` top-level declarations are not available in their TDZ until
their line executes. Functions are hoisted. The current order in
`src/index.html` is:

```
state.js         — pub/sub + global state
columns.js       — column-role helpers (depends on DATA from state)
spatial.js       — distance + buffer (no deps)
validation.js    — partition + metrics (depends on columns/spatial)
csv.js           — parser + loadData (calls populateColumnRoleSelects, initializeDefaultSplit)
cart.js          — buildTree + growTree (uses getColumnRoles, filterToTrain)
panels/tree.js   — SVG render + bonsai pointer handlers
bonsai.js        — prune/regrow/forceSplit/refreshAfterEdit
export.js        — text/python/excel/sql/csv/mimic-io exporters
panels/help.js   — showHelp + showAbout + showParamHelp (floating dialogs)
panels/workshop.js
sql-import.js
persistence.js   — IndexedDB + JSON project save/load
examples.js      — synthetic dataset generators (ironore/rocktype/iris/porphyry)
certificate.js   — workshop certificate flow
leapfrog-export.js
toast.js
panels/dataset.js, panels/config.js, panels/inspector.js, panels/rules.js,
panels/validation.js, panels/importance.js, panels/scatter.js
menubar.js       — MENU_STRUCTURE + DEFAULT_LAYOUT + togglePanel/resetLayout/floatActivePanel
app.js           — bootstrapApp (DOMContentLoaded), initDockview, openFloatingPanel
```

Rule of thumb: state-and-utility before consumers, panels before app.

## Pub/sub channels

Defined in `src/state.js`. Flat key→Set-of-callbacks store; no DAG.

| Channel | Producer(s) | Consumers |
|---|---|---|
| `dataset` | `csv.js#loadData` after parse | dataset/validation/scatter panels |
| `columns` | `columns.js#onColumnRolesChanged` (and at populate time) | dataset (role badges) / validation / scatter |
| `tree` | `cart.js#growTree`, `bonsai.js#refreshAfterEdit` | validation / importance / scatter / rules |
| `split` | `validation.js#setCurrentSplit` | validation |

Subscribers debounce with `setTimeout(fn, 50)` to coalesce burst publishes
during bonsai edits.

## Dockview integration patterns

The hard-won lessons. Read these before adding a panel.

### 1. `fromJSON` is the only reliable initial-size mechanism

`addPanel({ initialWidth: 280 })` is silently ignored when the panel
splits an existing container — the new group always gets 50/50 by weight.
`group.api.setSize({ width: 280 })` succeeds at API-call time but does
nothing useful when the container hasn't been measured yet (`toJSON()`
shows `width: 0, height: 0` right after `addPanel`).

The default layout is authored as a `fromJSON` payload (see
`menubar.js#DEFAULT_LAYOUT`). Leaf `size` values are relative weights
that dockview scales to the actual viewport at layout time.

### 2. `createComponent`'s `options.params` is empty

Dockview's `createComponent({ id, name, params })` only has `id` and
`name` populated when the panel is being constructed. `params` only
arrive later via `init(parameters)`. For the `floating-host` component
we key off `options.id` instead.

### 3. `document.getElementById` doesn't reach inactive tabs

Dockview only attaches the *active* tab's element to the live DOM in a
tabbed group. Inactive tab elements exist (the factory has them in
memory) but are detached. `document.getElementById('valMetrics')` will
return `null` while the Validation tab is inactive.

**Fix**: query via the panel's cached root element, not the document.

```js
let _myPanelElement = null;
function getMyPanelElement() {
  if (_myPanelElement) return _myPanelElement;
  const tpl = document.getElementById('tpl-my-panel');
  _myPanelElement = tpl.content.firstElementChild.cloneNode(true);
  initListeners(_myPanelElement);
  return _myPanelElement;
}

function renderMyPanel() {
  const root = _myPanelElement;
  if (!root) return;
  const out = root.querySelector('#someId');
  if (!out) return;
  out.innerHTML = '...';
}
```

Validation, Importance, Inspector, Rules, and Dataset panels all do
this.

### 4. Component factories return `{ element, init }`

Dockview's `IContentRenderer` shape requires both. Returning just
`{ element }` produces `TypeError: this.content.init is not a function`
at panel creation. We always return `{ element, init: () => {} }`.

### 5. Listeners attached during the factory work because elements are alive (just detached)

`addEventListener` works on detached DOM. So the panel factory can wire
listeners on the cloned template content before dockview attaches it.
The trap is `document.getElementById` lookups, not listener wiring.

### 6. Long-form dialogs are floating panels, not modals

`openFloatingPanel(id, { title, width, height })` in `app.js` creates a
dockview floating panel backed by a shared `floating-host` component.
The host `<div>` is keyed by panel id in `_floatingHosts`. Caller fills
`host.innerHTML = ...` then optionally focuses an element.
`closeFloatingPanel(id)` dismisses.

Pattern used by SQL import, Leapfrog export, CSV config, Help, Param
Help, About. Load Project remains a regular modal because it's a
short-lived picker.

### 7. Drag-tab-out docks elsewhere by default

Dockview's drag gesture defaults to docking the dragged tab into another
position, not floating it. To float, the user has to drag *outside any
drop indicator*, which is fiddly. Hence **View → Float active panel** as
a discoverable menu action via `addFloatingGroup`.

## Theme

Dockview's `dockview-theme-dark` exposes ~30 `--dv-*` CSS variables that
we override in `src/style.css` to match Arborist's palette. The
underline on the focused-group active tab is a custom rule:
`.dockview-theme-dark .dv-groupview.dv-active-group .dv-tab.dv-active-tab`.

## Panel responsibility matrix

| Panel | Source | Reads | Writes | Reacts to |
|---|---|---|---|---|
| Dataset | `panels/dataset.js` + `csv.js#renderDataSummary` | `DATA`, column roles | `#dataSummary` HTML | `columns` (role badges) |
| Configuration | `panels/config.js` | `DATA`, hyperparams | column-role dropdowns | `dataset` |
| Tree | `panels/tree.js` | `TREE`, `selectedNodeId` | SVG, inspector content via `selectNode → renderInspector` | `tree` (no explicit subscribe; redraw is in-place) |
| Inspector | `panels/inspector.js` | `TREE`, `selectedNodeId` | `#inspectorContent` | called from `selectNode`, `growTree`, `refreshAfterEdit` |
| Rules | `panels/rules.js` + `export.js#renderRules` | `TREE` | `#rulesBox` (root-scoped) | `tree` (via `refreshAfterEdit → renderRules`) |
| Validation | `panels/validation.js` + `validation.js` + `spatial.js` | `TREE`, `DATA`, `CURRENT_SPLIT`, column roles | metrics + confusion + leaky/isolated | `tree`, `split`, `dataset`, `columns` |
| Importance | `panels/importance.js` | `TREE` | bar chart | `tree`, `dataset`, `columns` |
| 3D Scatter | `panels/scatter.js` (uses `DEE` + `THREE`) | `DATA`, `TREE`, column roles | dee scene | `tree`, `dataset`, `columns` |

Workshop is a dynamic column inserted into `#app-layout` by
`renderWorkshopCol()` — not a dockview panel (yet). It opens via the
splash button or `Help → Guided Workshop`.

## Tree representation

Two formats coexist:

- **Live (in `cart.js`)**: a node-graph with `{ id, leaf, split, prediction,
  classCounts, gini, n, depth, confidence, _rows, left, right }`.
  This is what bonsai mutates in place. `_rows` keeps row references so
  partition operations don't have to re-scan.
- **mimic-io (in `export.js`)**: sklearn-shaped parallel arrays
  (`children_left`, `children_right`, `feature`, `threshold`, `value`,
  `impurity`, `n_node_samples`). Categorical splits use an Arborist
  `category` extension since sklearn's format is numeric-only. The
  Python shim in `docs/python-shim/` reads it.

`TREE._classes` and `TREE._features` are the index spaces for `value` and
`feature` respectively.

## Adding a new panel

1. Add `<template id="tpl-foo-panel">…</template>` in `src/index.html`.
2. Create `src/panels/foo.js` with `getFooPanelElement()` factory and
   `initFooPanelListeners(root)` (scoped queries).
3. Add to the INLINE list in `src/index.html` (before `menubar.js`).
4. Register in `src/app.js#initDockview#createComponent` — add a
   `case 'foo': element = getFooPanelElement(); break;`.
5. Add to `DEFAULT_LAYOUT` in `src/menubar.js` (both `panels` map and the
   `grid` tree).
6. Add View menu toggle in `MENU_STRUCTURE` and a spec entry in
   `togglePanel`.
7. Subscribe to whichever channels matter. Debounce render with
   ~50 ms `setTimeout`.

## Adding a new floating dialog

```js
function showFooDialog() {
  const host = openFloatingPanel('foo', { title: 'Foo', width: 480, height: 400 });
  if (!host) return;
  host.innerHTML = `... html ...`;
  host.querySelector('#fooApply').addEventListener('click', () => {
    // ... do the thing ...
    closeFloatingPanel('foo');
  });
}
```

Wire `showFooDialog` into the appropriate menu (`menubar.js`) or panel
button (`src/index.html` template + onclick).

## Style conventions

- Panels are `width:100%; height:100%; display:flex; flex-direction:column;
  overflow-y:auto;` so they fill their dockview slot.
- Inside floating hosts, use the unified `.dialog-hint`, `.dialog-textarea`,
  `.dialog-error`, `.dialog-buttons`, `.dialog-btn`, `.dialog-btn-primary`
  classes (defined in `src/style.css`).
- Existing v1 colour vars: `--bg`, `--surface`, `--surface2`, `--surface3`,
  `--border`, `--border-hi`, `--text`, `--text-dim`, `--text-faint`,
  `--green`, `--green-bright`, `--green-dim`, `--amber`, `--amber-dim`,
  `--red`, `--cyan`, `--blue`, `--purple`. Don't introduce new colours
  without a reason.

## Things not yet wired

- **PWA wrapper** (`manifest.json` + `sw.js`) — Phase 4 deferred.
- **Bonsai metadata in mimic-io export** — `bonsai.forced_splits`,
  `bonsai.forced_classes`, `bonsai.pruned_nodes` are currently empty
  arrays. Tracking through `undoStack` would let the JSON faithfully
  record which decisions were algorithmic vs expert-driven.
- **Workshop as dockview panel** — currently still inserts into
  `#app-layout` as a flex sibling. `panels/workshop.js` has the rendering,
  but it's not a registered dockview component.
