# Arborist v2 — Specification

**Status:** Draft v0.2
**Date:** 2026-04-19
**License:** MIT
**Repository:** github.com/endarthur/arborist
**Authors:** Arthur Endlein Correia, Jessica (Seequent)
**Presentation:** II Simpósio de Geometalurgia, Gramado, May 2026 (oral session)

---

## 1. Scope and Motivation

Arborist is a browser-native tool for interactive decision tree classification, designed for geometallurgical domaining workflows. It implements a "bonsai" interaction model: the expert guides tree construction by forcing splits, pruning branches, and regrowing nodes, combining domain knowledge with algorithmic optimisation.

v1 was a single-file HTML+JS prototype. It demonstrated the concept and is broadly feature-complete for tree construction, bonsai editing, and export — but it lacks validation feedback, spatial awareness, and a panel-based UI for non-linear workflows.

v2 is a focused extension addressing the reviewer feedback from the GEOMET submission:

> "O fluxo de trabalho 'bonsai' introduz um risco considerável de overfitting manual. [...] Para elevar o rigor científico da ferramenta, seria fundamental incorporar a exibição de métricas de validação cruzada (k-fold CV) ou de um conjunto de teste (hold-out) em tempo real."

The core response: a live **holdout** validation panel that updates as the user edits the tree, with an optional **spatial exclusion buffer** that respects drillhole autocorrelation. Accompanying this are a confusion matrix, feature importance, and a 3D scatter view — all the things a geometallurgist needs to judge whether bonsai edits are helping or hurting.

### 1.1 What v2 is not

- Not a rewrite. The CART engine, bonsai interactions, exports, SQL import, workshop, IndexedDB projects, Leapfrog `.lfcalc` export, and CSV parser are kept as-is and ported onto the new shell.
- Not a PWA in the full sense. See §6.1 — the single-HTML WA artifact remains canonical.
- Not a preprocessing suite. Log-ratio transforms, imputation, and scaling are out of scope for v2 and tracked separately.

---

## 2. Architecture

### 2.1 Shell

Arborist v2 uses [dockview-core](https://dockview.dev) as the panel layout engine. Each functional area is a panel type registered with the dockview component. The user can rearrange, split, and tab panels freely. Layout is serialised via `dockview.toJSON()` and persisted to IndexedDB.

Dockview-core is vanilla JS with no framework dependency. It vendors cleanly into the concat build.

This also serves as a proving ground for Auditable Files (AF), which will use the same library. Arborist's smaller, fixed panel vocabulary makes it a low-risk context to learn dockview's vanilla API and serialisation behaviour.

### 2.2 Shared State

Panels communicate through a central state object with pub/sub notification. Flat store, named channels. A panel subscribes to the channels it cares about and receives callbacks when they change.

| Channel | Producer | Consumers |
|---|---|---|
| `dataset` | Data panel | All |
| `columns` | Data panel (user picks target, features, dhid, xyz) | Tree, Validation, Scatter |
| `split` | Validation panel (train/test partition) | Tree, Validation |
| `tree` | Tree builder | Validation, Scatter, Importance, Export |
| `predictions` | Tree builder | Validation, Scatter |
| `validationConfig` | Validation panel | Validation (internal) |
| `validationResults` | Validation panel | (display only) |

### 2.3 External Dependencies

| Dependency | Role | Size (approx. gzipped) | Loading |
|---|---|---|---|
| dockview-core | Panel layout, tabs, drag-and-dock | ~50 KB | Inline (vendored into single HTML) |
| Three.js | 3D scatter visualisation | ~55 KB | Inline (vendored into single HTML) |
| Pollywog.js | Leapfrog `.lfcalc` export (already vendored in v1) | ~15 KB | Inline |

No runtime CSV parser dependency — the v1 parser (RFC 4180, delimiter auto-detection, locale-aware decimals, BOM handling) is already custom and stays. All dependencies are vendored into the single HTML artifact. Nothing is lazy-loaded at runtime; the tradeoff for WA purity is a larger initial HTML (~300–400 KB) versus a faster, network-free startup.

### 2.4 Internal Data Representation

Numeric columns are `Float64Array`. Categorical columns (lithology codes, domain labels) are arrays of strings with a separate integer-coded `Uint32Array` for the tree algorithm. The target column for classification is always integer-coded.

No matrix library. Plain typed arrays. If matrix operations are needed later (distance matrices for spatial blocking are the one place this tempts us), they're written inline — distances are `O(n²)` but for `n < 5000` this is fine in plain JS.

---

## 3. Panels

### 3.1 Data Panel

**Purpose:** Load data, preview it, configure column roles.

- CSV import via the v1 parser (auto-detects delimiter, handles BOM, quoted fields, configurable decimal separator).
- Tabular preview with sorting and scrolling.
- Column role assignment: target (categorical), features (numeric and/or categorical), drillhole ID (optional), X/Y/Z coordinates (optional).
- Column-type toggle (numeric ↔ categorical) — ported from v1.
- Basic column statistics: count, missing, unique values (categorical), min/max/mean/std (numeric).
- Row filter (JS expression, from v1) — ported.
- Publishes `dataset` and `columns` channels on configuration change.

### 3.2 Tree Builder Panel

**Purpose:** Interactive CART construction with bonsai workflow.

This is the core of Arborist. v1's CART implementation, bonsai actions (prune, regrow, force split, top-splits ranking), inspector, undo stack, and column-type overrides are all ported. The only changes are (a) the tree now lives in a dockview panel and (b) it emits `tree` and `predictions` on the shared state whenever it changes.

**Algorithm (unchanged from v1):**

- CART with Gini impurity (classification) or variance reduction (regression). v1 supports both; v2 carries both through.
- Split search: for each candidate feature, sort the column, sweep for the threshold that maximises gain. Plain JS.
- Tree represented as a node object graph with parent/children pointers (v1 format). For export (§4) it is flattened to sklearn-compatible parallel arrays.

**Bonsai interactions (unchanged from v1):**

- Auto-fit to configurable max depth / min samples leaf.
- Manual force-split with interactive impurity chart.
- Prune to leaf.
- Regrow from leaf.
- Merge siblings (via prune + regrow).
- Undo stack, full reset.

**Publishes:** `tree` and `predictions` channels on every edit.

### 3.3 Validation Panel

**Purpose:** Live holdout evaluation that reacts to tree changes.

This is the primary response to the reviewer. It answers: *is my manual intervention improving the model, or just overfitting?*

**Model: holdout, not k-fold.**

v2 deliberately does not implement k-fold CV. K-fold conflates "does my tree generalise?" with "does my modelling *approach* generalise across refits?" — and the bonsai workflow makes the latter question nearly meaningless, because every refit discards the user's expert edits. Holdout is cleaner: one train/test partition, pinned at session start, never touched again. The tree is built on train; the validation panel always scores on test. The score moves *only* because the user changed the tree.

**Partitioning strategies:**

| Strategy | Description | Requires |
|---|---|---|
| Random | Uniform random assignment to train/test | Nothing |
| Stratified | Random, preserving class proportions | Target column |
| Drillhole-grouped | Entire drillholes stay together | Drillhole ID column |
| Spatial (buffered) | Random partition + exclusion buffer: training samples within the buffer distance of any test sample are dropped from train | XYZ columns |

The test set is never modified by the buffer — only the effective training pool shrinks. The UI surfaces the resulting training-pool size so the user sees what the buffer costs.

**Test ratio** is a simple slider (default 30%). Resample button reshuffles the partition with the same ratio and strategy.

**Display:**

- Confusion matrix (heatmap, per-class precision/recall).
- Overall accuracy, Cohen's kappa (classification); R², RMSE (regression).
- Train-accuracy vs. test-accuracy side-by-side. This gap is the honest overfitting indicator, because train and test come from the same partition.
- If XYZ is assigned, a secondary readout showing test accuracy at buffer=0 vs buffer=current. This gap is the *autocorrelation leakage* diagnostic — it measures how much of the apparent test score was coming from spatially adjacent samples, not from honest generalisation. The gap is not purely overfitting; even a well-fit model shows a gap when samples are spatially autocorrelated. The copy in the panel says as much.

**Behaviour:**

- Rescoring is cheap (one forward pass over the test set, no refit), so debounce is only a courtesy. Target: update on every `tree` edit with no perceptible delay.
- No web worker needed in v2. Holdout rescoring is linear; the buffer computation is `O(n_test · n_train)` and runs once per partition change, not per tree edit.

### 3.4 3D Scatter Panel

**Purpose:** Spatial visualisation of samples coloured by predicted domain.

- Three.js point cloud. Each sample is a point at its XYZ coordinates, coloured by predicted class.
- Orbit controls (rotate, zoom, pan).
- Toggle: colour by predicted class, true class, or misclassification (red/green).
- Toggle: show train vs test subset.
- Only available if XYZ columns are assigned.

Three.js is inlined in the single-HTML build. Panel lifecycle explicitly disposes the WebGL context on panel close (avoids leaking contexts across layout changes — dockview panels can be closed and reopened without reloading the page).

### 3.5 Feature Importance Panel

**Purpose:** Show which features drive the classification.

- Bar chart of feature importance (total impurity decrease per feature, normalised).
- Sortable.
- Reacts to tree changes.

Small, low-effort, high-value for both the talk and day-to-day use.

### 3.6 Workshop Panel

**Purpose:** Guided 18-step tutorial ported from v1.

v1's interactive workshop is a signature feature — it doubles as training material, demo script, and documentation. Each step has action buttons that drive the real UI. In v2, steps that reference a specific panel first call `ensurePanelOpen(panelId)` so the action lands in a visible panel regardless of the user's current layout.

### 3.7 Export

**Purpose:** Get results out of Arborist.

Not a permanent panel — available from the toolbar. All v1 exports are preserved:

| Format | Status | Notes |
|---|---|---|
| CSV with predictions | v1 port | Original data + predicted class + leaf ID + confidence |
| Python `if/else` | v1 port | Paste-into-script function |
| Excel `IF()` | v1 port | Nested formulas |
| SQL `CASE WHEN` | v1 port | Block model software (Vulcan, Surpac, Datamine, Deswik) |
| Rules (IF/THEN pseudocode) | v1 port | For technical reports and JORC/NI 43-101 documentation |
| Leapfrog `.lfcalc` | v1 port | Via Pollywog.js |
| JSON (mimic-io) | **new in v2** | sklearn-compatible interchange, §4 |
| Project JSON | v1 port | Full round-trip save/load |

---

## 4. Tree Data Format (mimic-io)

The new v2 interchange format is a JSON object mirroring sklearn's internal `Tree` structure:

```json
{
  "format": "mimic-io",
  "version": 1,
  "algorithm": "CART",
  "criterion": "gini",
  "n_features": 12,
  "n_classes": 3,
  "feature_names": ["SiO2", "Al2O3", "Fe2O3", "..."],
  "class_names": ["oxide", "transition", "sulphide"],
  "tree": {
    "node_count": 15,
    "children_left": [1, 3, -1, -1, -1],
    "children_right": [2, 4, -1, -1, -1],
    "feature": [5, 2, -2, -2, -2],
    "threshold": [0.45, 12.3, -2.0, -2.0, -2.0],
    "value": [[10, 5, 2], [8, 1, 0]],
    "impurity": [0.58, 0.21, 0.0],
    "n_node_samples": [100, 50, 50]
  },
  "bonsai": {
    "forced_splits": [1, 4],
    "forced_classes": { "7": 2 },
    "pruned_nodes": [9]
  }
}
```

The `bonsai` section records which nodes were manually manipulated. This is metadata for reproducibility — it tells the reader which decisions were algorithmic and which were expert-driven. Not present in sklearn's format; ignored by the Python shim's `predict()`.

A small Python shim (published separately, not part of the Arborist build) duck-types `sklearn.tree.DecisionTreeClassifier` so the exported file is loadable in notebooks with `from arborist_mimic import load_tree`.

---

## 5. Spatial Exclusion Buffer

### 5.1 How it works

1. Partition samples into train/test using the chosen strategy (random, stratified, drillhole-grouped).
2. For every training sample, compute the minimum distance to any test sample.
3. If that minimum distance is less than the user-set exclusion range, drop the training sample.
4. Refit on the surviving training pool. Score on the unchanged test pool.

Setting the buffer to zero reduces to standard holdout. Setting it to the variogram range of the target variable ensures spatially correlated samples don't leak across the train/test boundary.

### 5.2 UI

- Slider for exclusion range (0 to max pairwise distance in dataset, log-scale likely).
- Display: effective training-pool size (so the user can see how much data they're losing to the buffer).
- Optional user-entered annotation for "variogram range here" — just a reference line on the slider, not a computed value.

### 5.3 Scope note

Arborist does not compute variograms. The user provides the range, or eyeballs it. This is a deliberate scope call: variogram modelling is a full tool of its own, and the user's geostats software already produces a range value.

---

## 6. Build and Distribution

### 6.1 Single-file WA artifact, optional PWA wrapper

The canonical output of the build is `arborist.html` — a single HTML file with all vendored dependencies inlined. This preserves the GCU **WA** (Works in Airplane) classification: downloadable, USB-stickable, openable from any filesystem path, zero network calls, zero installation.

A "dumb PWA" wrapper is shipped alongside for hosted deployment (GitHub Pages, internal servers): a `manifest.json` and a minimal `sw.js` that caches `arborist.html` and its assets for offline use after first visit. The PWA wrapper is optional — `arborist.html` works standalone without it. Install-as-desktop-app works when visiting via HTTPS; the offline WA mode works regardless.

```
dist/
  arborist.html        — canonical artifact, single-file, WA-compliant
  manifest.json        — PWA manifest (optional)
  sw.js                — service worker (optional)
  icon-192.png         — (optional, PWA only)
  icon-512.png         — (optional, PWA only)
  demo-dataset.csv     — bundled synthetic dataset
```

### 6.2 Persistence (IndexedDB)

Storage is the same as v1 with two additions:

| Store | Contents |
|---|---|
| `projects` | Saved project state (v1 format extended with layout + validation config) |
| `layout` | **new** — Dockview serialised layout |
| `preferences` | **new** — Theme, default validation strategy, default test ratio, last-used settings |

Projects remain the primary persistence unit and contain everything needed to resume work.

### 6.3 Source Structure

At 5800+ lines, the single `index.html` is past the point where a split helps development. v2 introduces a `src/` tree and a trivial concat build. The build output is still the single-file `arborist.html`.

```
arborist/
  build.js             — zero-dep Node concat script
  src/
    index.html         — shell with placeholder tokens for inlined modules
    state.js           — shared state pub/sub
    cart.js            — CART algorithm (ported from v1)
    validation.js      — holdout, partitioning, buffer, metrics
    spatial.js         — distance computation, buffer filtering
    export.js          — all exporters (ported from v1 + mimic-io)
    persistence.js     — IndexedDB store (ported from v1)
    pollywog.js        — Leapfrog export (vendored from v1)
    panels/
      data.js          — data loading and column config (ported from v1)
      tree.js          — tree builder and visualisation (ported from v1)
      validation.js    — validation panel (new)
      scatter.js       — Three.js 3D scatter (new)
      importance.js    — feature importance bar chart (new)
      workshop.js      — guided tutorial (ported from v1)
    vendor/
      dockview-core.js
      three.min.js
    style.css          — theme + dockview overrides
    app.js             — dockview init, panel registration, default layout
  dist/                — built output (gitignored)
  docs/
    SPEC-v2.md
  demo/
    demo-dataset.csv
```

The concat build is ~50 lines: read `src/index.html`, replace `<!-- INLINE: path -->` tokens with the content of each referenced file wrapped in appropriate `<script>` or `<style>` tags, write to `dist/arborist.html`. That's it. No minification for v2; the artifact is small enough and plain-text is a debugging asset.

### 6.4 Hosting for the Demo

For Jessica's GEOMET presentation: either serve `dist/arborist.html` from `localhost` or deploy the PWA bundle to `endarthur.github.io/arborist`. The synthetic demo dataset is bundled in the build as a static asset, loadable from a "Demo dataset" button without a file dialog. For robustness, `dist/arborist.html` goes on her laptop's local disk as the primary, with PWA hosting as backup.

---

## 7. Default Layout

On first open, the default dockview layout is:

```
┌──────────────┬──────────────────────────┐
│              │                          │
│              │     Tree Builder         │
│  Data        │                          │
│              │                          │
│              ├──────────┬───────────────┤
│              │Validation│  3D Scatter / │
│              │          │  Importance   │
│              │          │  (tabbed)     │
└──────────────┴──────────┴───────────────┘
```

Export actions, project save/load, and the workshop launcher are all in the top toolbar.

---

## 8. Presentation Demo Script

Jessica presents at GEOMET Gramado. The tool supports a live demo:

1. Open Arborist (PWA or local file). Click "Demo dataset" — synthetic geometallurgical assay + recovery dataset loads.
2. Assign target (recovery domain), features (assays), drillhole ID, XYZ.
3. Auto-fit a tree. Train accuracy: 95%. Test accuracy (random partition): 88%. Looks fine.
4. Turn on the spatial buffer. Test accuracy at buffer=variogram-range: 71%. *The gap is the autocorrelation leakage.*
5. Show 3D scatter — domains look noisy, with salt-and-pepper misclassifications on the test set.
6. Use bonsai: prune overfit branches, force geologically sensible splits on Fe and SiO2.
7. Watch: train accuracy drops slightly (94%), buffered test accuracy climbs (78%), 3D scatter cleans up into coherent spatial zones.
8. Export mimic-io JSON. Show the Python shim reproducing `predict()` in a notebook.

---

## 9. Out of Scope for v2

- Random forests / ensemble methods.
- `@gcu/learn` integration.
- K-fold cross-validation (see §3.3 for the reasoning).
- PCA, clustering, or other unsupervised methods.
- Preprocessing panel (log-ratio, imputation, scaling). Tracked for v2.1.
- Auditable notebook integration.
- WASM kernels for split search.
- Mobile / responsive layout.
- Variogram computation inside Arborist.
- Multiplayer / collaborative editing.

These are valid future directions, not v2 deliverables.

---

## 10. Success Criteria

Arborist v2 is done when:

1. A geologist can load a CSV, build a tree with bonsai interaction, and see live holdout scores with an optional spatial exclusion buffer — in a single HTML file, offline-capable, with no server or backend.
2. The reviewer's concern about overfitting is directly answered by the validation panel's train-vs-test and buffer-on-vs-off readouts.
3. Jessica can demo the full workflow at GEOMET Gramado from a local HTML file on her laptop, with the PWA URL as a backup.
4. The mimic-io JSON export produces a file loadable by a Python shim as a sklearn-compatible estimator.
5. Project state (dataset, tree, layout, preferences) persists across sessions via IndexedDB.
6. The v1 workshop is ported and runs end-to-end in the new shell.
7. The GCU **WA** classification is preserved: `arborist.html` opens and functions correctly from `file://`, with no network calls.

---

*Arborist v2 — Geoscientific Chaos Union, 2026.*
