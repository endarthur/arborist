// ═══════════════════════════════════════
//  GUIDED WORKSHOP
// ═══════════════════════════════════════
let workshopStep = 0;
let workshopActive = false;

const WORKSHOP_STEPS = [
  {
    title: 'Welcome',
    desc: `Welcome to the Arborist guided workshop.
<br><br>
This interactive guide will walk you through the complete workflow for building, interpreting, reshaping, and exporting <strong>decision trees</strong> — one of the most powerful and interpretable tools in applied geoscience and data analysis.
<br><br>
<strong>What is a decision tree?</strong> A decision tree is a flowchart-like model that splits data into progressively more homogeneous groups by asking a sequence of yes/no questions about the input features. Each internal node tests a condition (e.g. "Is Fe &gt; 58%?"), each branch represents the outcome, and each leaf node gives a prediction — either a class label (classification) or a numeric value (regression).
<br><br>
<strong>Why are they useful?</strong> Unlike black-box models (neural networks, random forests), a single decision tree produces <em>transparent, auditable rules</em> that can be written as SQL, applied in spreadsheets, or communicated in a report. In geometallurgy and resource estimation, this transparency is essential — regulatory frameworks like JORC and NI 43-101 require that domain boundaries be justifiable and documented.
<br><br>
<strong>What is CART?</strong> Arborist implements the CART algorithm (Classification and Regression Trees) introduced by Breiman, Friedman, Olshen and Stone in 1984. CART grows binary trees by exhaustively searching all features and thresholds for the split that maximally reduces impurity — measured by <strong>Gini impurity</strong> for classification or <strong>variance</strong> for regression.
<br><br>
Each step in this workshop has <span style="color:var(--green-bright)">green action buttons</span> that drive the real interface. Click them to load data, select nodes, and apply operations as you follow along. Use <strong>Next ▶</strong> to advance.`,
    actions: [],
  },
  {
    title: '1 — Load Data',
    desc: `Every tree starts with data. Arborist accepts <strong>CSV files</strong> with a header row, or you can use one of the built-in example datasets.
<br><br>
Let's load the <strong>Iron Ore Domains</strong> dataset — a synthetic but realistic geometallurgical dataset with 200 samples: iron grade, silica, alumina, depth, weathering state, and the target ore domain classification.
<br><br>
<strong>CSV format auto-detection:</strong> Arborist automatically detects the delimiter and decimal separator. The three example datasets each use a different format to demonstrate this:
<br><br>
• <strong>Iron Ore</strong> — semicolon delimited, comma decimal (Brazilian/European Excel export)
<br>• <strong>Rock Type</strong> — tab delimited, period decimal (spreadsheet copy-paste)
<br>• <strong>Iris</strong> — comma delimited, period decimal (standard CSV)
<br><br>
After loading, the <strong>⚙</strong> gear icon appears in the Data section header. Click it to open the <strong>CSV config dialog</strong> where you can override the auto-detected delimiter and decimal separator with a live preview. This is essential when auto-detection gets it wrong — e.g. pipe-delimited files, or files where semicolons appear inside fields.
<br><br>
Click below to load the iron ore data. Arborist will detect the semicolons and comma decimals, parse the data correctly, and grow an initial tree.`,
    actions: [{ label: '⛏ Load Iron Ore & Grow', fn: () => { loadExample('ironore'); setTimeout(zoomFit, 60); } }],
  },
  {
    title: '2 — Reading the Tree',
    desc: `The tree visualization reads <strong>top to bottom</strong>. Let's break down what you see:
<br><br>
<strong>Split nodes</strong> (rectangles) contain:
<br>• A condition like <code>Fe_pct ≤ 58.0</code>
<br>• A color bar showing class proportions at that node
<br>• The sample count (<code>n=...</code>)
<br>• Left child = condition is TRUE, Right child = FALSE
<br><br>
<strong>Leaf nodes</strong> (with 🍂) contain:
<br>• The predicted class (majority vote)
<br>• The confidence (proportion of the majority class)
<br>• The sample count
<br><br>
<strong>The root node</strong> (topmost) contains all samples. At each level, the data is partitioned. By the time you reach a leaf, you have a (hopefully) homogeneous subset dominated by one class.
<br><br>
<strong>Reading a path:</strong> To understand a prediction, trace from the root to a leaf, collecting conditions along the way. For example: "Fe ≤ 58 AND weathering = fresh → BIF" means that low-iron, fresh (unweathered) rock is classified as banded iron formation.
<br><br>
The <strong>stats bar</strong> in the left panel summarizes: total rows, node/leaf counts, tree depth, and overall accuracy. Accuracy is the percentage of training samples correctly classified. (For regression, this becomes R².)
<br><br>
Click Fit View to center the tree if needed.`,
    actions: [{ label: 'Fit View', fn: () => zoomFit() }],
  },
  {
    title: '3 — The Inspector',
    desc: `The <strong>Inspector panel</strong> on the right side reveals detailed statistics for any node you click. It's the analytical heart of Arborist.
<br><br>
Let's select the root node to see the full dataset statistics.
<br><br>
<strong>What you'll see:</strong>
<br><br>
<strong>Class Distribution</strong> — a horizontal stacked bar chart showing the proportion of each class at this node, with a color legend and exact counts. At the root, this is the full dataset's class balance.
<br><br>
<strong>Metrics Section:</strong>
<br>• <strong>Gini Impurity</strong> — measures how "mixed" the node is. Ranges from 0 (perfectly pure: all one class) to ≈0.5 (maximally mixed). Formally: Gini = 1 − Σpᵢ² where pᵢ is the proportion of class i. A Gini of 0.65 means the node is very heterogeneous; a Gini of 0.05 means it's nearly pure.
<br>• <strong>Samples</strong> — how many data points reach this node.
<br>• <strong>Prediction</strong> — the majority class.
<br>• <strong>Confidence</strong> — proportion of the majority class (higher = more certain).
<br><br>
<strong>Split Details</strong> (for non-leaf nodes):
<br>Shows the feature and threshold used, plus Gini and sample count for each child. The <strong>gain</strong> is the reduction in impurity achieved by this split — higher gain = more informative split.
<br><br>
Try clicking around the tree after this to see how statistics change at different nodes.`,
    actions: [{ label: '🔍 Select Root Node', fn: () => { if (TREE) { selectNodeById(TREE.id); openInspector(); } } }],
  },
  {
    title: '4 — Purity & Leaves',
    desc: `Now let's look at a <strong>leaf node</strong> — the endpoints where predictions are made.
<br><br>
A well-grown tree produces leaves that are much purer than their parent nodes. The class distribution bar should be dominated by a single color, and the Gini impurity should be low (close to 0).
<br><br>
<strong>Why purity matters:</strong> In geometallurgy, each leaf defines a <em>processing domain</em>. If a leaf is 95% "HG_oxide", you can confidently route that material to the oxide processing circuit. But if it's only 60% one class, there's significant misclassification risk — some material will be sent to the wrong circuit, causing recovery losses or contamination.
<br><br>
<strong>The confidence value</strong> shown on each leaf is exactly this purity measure: the fraction of samples belonging to the predicted class. In practice:
<br>• <strong>&gt;90%</strong> — high confidence, reliable domain
<br>• <strong>70-90%</strong> — moderate, may need refinement
<br>• <strong>&lt;70%</strong> — the tree is uncertain here; consider further splitting or expert review
<br><br>
<strong>Sample count</strong> is equally important. A leaf with 95% purity but only 3 samples is statistically unreliable — it might just be noise. The <code>Min Leaf</code> parameter controls this: it prevents the tree from creating leaves with too few samples. In geostatistics, we'd call this ensuring domain stationarity requires sufficient data.
<br><br>
Click below to select a leaf and examine its purity.`,
    actions: [{ label: '🍂 Select a Leaf', fn: () => { if (TREE) { const leaf = findFirstLeaf(TREE); if (leaf) { selectNodeById(leaf.id); openInspector(); } } } }],
  },
  {
    title: '5 — Bonsai: Pruning',
    desc: `This is where Arborist differs from standard CART tools. The <strong>bonsai workflow</strong> lets you manually reshape the tree after growing it, integrating domain knowledge with data-driven optimization.
<br><br>
<strong>Pruning</strong> means collapsing a subtree into a single leaf. The children are removed, and the node becomes a leaf with the majority-vote prediction of all samples that reach it.
<br><br>
<strong>When to prune:</strong>
<br>• A split separates samples that should be in the same domain (e.g. splitting oxide ore on an irrelevant feature)
<br>• The accuracy gain from a split is negligible
<br>• The split creates leaves with too few samples for practical use
<br>• You're simplifying for operational clarity — a 5-leaf tree is easier to implement in a processing plant than a 15-leaf tree
<br><br>
<strong>Accuracy feedback:</strong> When you prune, the stats bar immediately updates the accuracy. This tells you the cost of simplification. Often, pruning several nodes only drops accuracy by 1-2% while dramatically simplifying the model.
<br><br>
Let's try it. First we'll select a split node (one whose children are both leaves), then prune it. Watch the accuracy change.`,
    actions: [{ label: '🔍 Select a Split Node', fn: () => { if (TREE) { const sn = findFirstSplit(TREE); if (sn) { selectNodeById(sn.id); openInspector(); } } } },
              { label: '✂ Prune It', fn: () => { if (selectedNodeId !== null) pruneToLeaf(selectedNodeId); } }],
  },
  {
    title: '6 — Undo & History',
    desc: `Every bonsai edit is recorded on an <strong>undo stack</strong> (up to 30 operations deep). This is critical for experimentation — you can freely try pruning, regrowing, and forcing splits without fear of losing your work.
<br><br>
The undo bar at the top of the inspector shows:
<br>• <strong>Edit count</strong> — how many modifications you've made
<br>• <strong>↩ Undo</strong> — reverts the last operation
<br>• <strong>⟲ Reset</strong> — restores the original auto-grown tree completely
<br><br>
<strong>Practical workflow:</strong> A common pattern is to grow an initial tree, then iteratively prune and resplit until the tree reflects both the statistics and your geological understanding. If an experiment doesn't improve things, undo and try a different approach. The real-time accuracy feedback makes each decision immediately quantifiable.
<br><br>
Let's undo the prune we just did to restore the previous tree state.`,
    actions: [{ label: '↩ Undo Last Edit', fn: () => undoEdit() }],
  },
  {
    title: '7 — Top Splits',
    desc: `When you select a <strong>leaf node</strong>, the inspector's <strong>Top Splits by Gini</strong> section (scroll down in the inspector) shows the 6 best possible splits for that node, ranked by information gain.
<br><br>
<strong>How splits are evaluated:</strong> For each feature, CART tests every possible threshold (for numeric features) or category (for categorical features), computing the weighted impurity of the resulting children. The split that maximizes the <em>gain</em> — the difference between parent impurity and the weighted average of child impurities — wins.
<br><br>
<strong>The top splits table shows:</strong>
<br>• <strong>Feature</strong> and threshold/category
<br>• <strong>Gain</strong> — impurity reduction (higher = more informative)
<br>• <strong>Left/Right</strong> — sample counts for each child
<br><br>
<strong>Click any row</strong> in the top splits table to apply that split, expanding the leaf into a split node with two children. This is a quick way to let the data guide your next refinement.
<br><br>
<strong>Geological interpretation:</strong> Look at which features appear in the top splits. If Fe and SiO₂ dominate, the tree is finding geochemical boundaries. If depth appears, it may be picking up a supergene enrichment profile. If weathering appears, the tree is separating oxide from primary material. These patterns should align with your geological model — if they don't, it may indicate data issues or unexpected geological complexity.
<br><br>
Select a leaf below and examine the suggested splits in the inspector.`,
    actions: [{ label: '🍂 Select a Leaf', fn: () => { if (TREE) { const leaf = findFirstLeaf(TREE); if (leaf) { selectNodeById(leaf.id); openInspector(); } } } }],
  },
  {
    title: '8 — Force Split',
    desc: `<strong>Force Split</strong> is the most powerful bonsai tool. It lets you split a leaf on <em>any feature at any threshold you choose</em>, overriding the data-driven optimization.
<br><br>
<strong>To use it:</strong>
<br>1. Select a leaf node
<br>2. Click <strong>⚡ Force Split</strong> in the inspector
<br>3. Choose a feature from the dropdown
<br>4. An interactive <strong>Gini/Variance chart</strong> appears showing impurity across all possible thresholds
<br>5. <strong>Click on the chart</strong> to place your threshold
<br>6. Click <strong>Apply Custom Split</strong>
<br><br>
<strong>The interactive chart</strong> is key: it shows weighted impurity (y-axis) vs. threshold (x-axis). Valleys in the curve represent good split points. The green dashed line marks your current selection. You can see exactly the trade-off before committing.
<br><br>
<strong>When to force-split:</strong>
<br>• You know a geological contact exists at a specific depth (e.g. base of weathering at 45m)
<br>• You want to enforce a grade cutoff used by the processing plant (e.g. Fe = 58%)
<br>• The automatic split chose a threshold that doesn't align with geological boundaries
<br>• You need to separate domains by a feature the algorithm didn't prioritize
<br><br>
<strong>The philosophical point:</strong> In geostatistics and geometallurgy, purely data-driven boundaries often don't respect geological reality. A statistical boundary at Fe = 57.3% might actually correspond to a known geological contact that occurs at Fe ≈ 58% in the grade-tonnage curve. Force-splitting lets you encode this knowledge while still getting accuracy feedback from the data.
<br><br>
Try it now: select a leaf, open Force Split, and experiment with the chart.`,
    actions: [{ label: '🍂 Select a Leaf', fn: () => { if (TREE) { const leaf = findFirstLeaf(TREE); if (leaf) { selectNodeById(leaf.id); openInspector(); } } } }],
  },
  {
    title: '9 — Column Types',
    desc: `Arborist auto-detects whether each column is <strong>numeric</strong> (<code>num #</code>) or <strong>categorical</strong> (<code>cat ●</code>) based on whether the values parse as numbers. But this heuristic isn't always right.
<br><br>
<strong>The problem:</strong> Many geoscience datasets contain coded variables — columns that look numeric but represent categories:
<br>• Lithology codes: 1=granite, 2=schist, 3=gneiss
<br>• Zone IDs: 100, 200, 300
<br>• Drillhole numbers: DH001 → might parse as numeric 1
<br>• Boolean flags: 0/1 for yes/no
<br><br>
If a coded column is treated as numeric, the tree will generate splits like <code>litho_code ≤ 1.5</code>, which is technically valid but geologically meaningless — it means "granite vs everything else" rather than testing each lithology properly. As a categorical column, the tree would generate splits like <code>litho_code = granite</code>, which is correct.
<br><br>
<strong>How to toggle:</strong> In the left panel <strong>Data</strong> section, look at the column list. Each column has a type badge: <code>num #</code> or <code>cat ●</code>. For originally-numeric columns, <strong>click the badge</strong> to toggle between numeric and categorical. It highlights on hover to show it's clickable.
<br><br>
After toggling, the target dropdown updates to reflect the new types. You can regrow the tree with the corrected types.
<br><br>
<strong>When in doubt:</strong> If a numeric column has fewer than ~10 unique values, it's probably categorical. If it has continuous values with many decimals, it's truly numeric.`,
    actions: [],
  },
  {
    title: '10 — Regression',
    desc: `So far we've been doing <strong>classification</strong> — predicting a categorical target. But Arborist also supports <strong>regression trees</strong> for predicting continuous numeric values.
<br><br>
<strong>The difference:</strong>
<br>• <strong>Classification:</strong> Gini impurity, accuracy metric, class predictions
<br>• <strong>Regression:</strong> Variance reduction, R² metric, mean ± σ predictions
<br><br>
Mode is auto-detected from the target column type. If you select a numeric target, Arborist switches to regression automatically.
<br><br>
<strong>How regression trees work:</strong> Instead of finding splits that separate classes, the algorithm finds splits that reduce the <em>variance</em> of the target within each child. Each leaf predicts the <strong>mean value</strong> of its samples. The quality metric is R² = 1 − SS<sub>res</sub>/SS<sub>tot</sub>, where values close to 1.0 mean the tree explains most of the variance.
<br><br>
<strong>Visual differences:</strong>
<br>• Leaf nodes show the predicted mean and standard deviation: <code>🍂 23.45 σ=4.12</code>
<br>• Node bars show a range indicator: grey = global target range, cyan = ±1σ around the node mean, amber line = mean
<br>• Inspector shows a histogram of target values instead of a class distribution bar
<br><br>
<strong>Geological use case:</strong> Regression trees are excellent for predicting grade (Fe%, Cu%, Au g/t) from other features. The resulting tree gives interpretable rules like "If depth &gt; 50m AND SiO₂ &lt; 4% THEN predicted Fe = 63.2%". This is essentially what geostatisticians do manually when building estimation domains — the tree automates the boundary search.
<br><br>
Click below to switch the target to <code>Fe_pct</code> and see regression mode in action.`,
    actions: [{ label: '# Switch to Fe_pct Regression', fn: () => {
      document.getElementById('targetSelect').value = 'Fe_pct';
      growTree(); setTimeout(zoomFit, 60);
    } }],
  },
  {
    title: '11 — Export Formats',
    desc: `The final goal is to get your tree <em>out</em> of Arborist and into production. The <strong>Export</strong> section (in the inspector, below Decision Rules) provides five clipboard formats, plus file exports:
<br><br>
<strong>📋 Rules</strong> — Human-readable pseudocode:
<br><code>IF Fe ≤ 58 AND weathering = "fresh" THEN BIF</code>
<br>Perfect for reports, documentation, and communication with non-technical stakeholders. This is what goes in your JORC Table 1 or NI 43-101 technical report.
<br><br>
<strong>🐍 Python</strong> — A nested <code>if/else</code> function:
<br>Paste into any Python script. Useful for batch processing, integration with geostatistical workflows, or embedding in Leapfrog/OMF toolchains.
<br><br>
<strong>📊 Excel IF()</strong> — A nested <code>=IF()</code> formula:
<br>Paste into a spreadsheet cell. Immediately classifies rows based on their feature values. Great for quick checks and auditing. Can get deeply nested for large trees.
<br><br>
<strong>🗄 SQL CASE</strong> — A <code>CASE WHEN</code> block:
<br>The most critical format for mining. This plugs directly into block model software (Vulcan, Surpac, Datamine, Deswik) as a field calculation or SQL query. Each WHEN clause defines one leaf's path from root to prediction.
<br><br>
<strong>📁 CSV</strong> — Downloads the full dataset with predictions appended:
<br>Each row gets: predicted class/value, confidence/std, and leaf ID. The leaf ID lets you cross-reference back to the tree for auditing.
<br><br>
All exports are <strong>regression-aware</strong> — numeric predictions for regression, class labels for classification. Try copying the SQL version.`,
    actions: [{ label: '🗄 Copy SQL CASE', fn: () => exportRules('sql') }],
  },
  {
    title: '12 — Leapfrog Export',
    desc: `Arborist can export your tree directly as a <strong>Leapfrog .lfcalc file</strong> — the native calculation set format used by Seequent's Leapfrog Geo and Leapfrog Works.
<br><br>
<strong>Why this matters:</strong> The traditional workflow for getting CART rules into Leapfrog is painful — you'd export SQL or Python, then manually rebuild the logic as a Leapfrog calculation using nested if/else blocks in the calculator UI. For a tree with 15+ leaves, this is tedious and error-prone.
<br><br>
<strong>With .lfcalc export:</strong> Click <strong>🐸 Leapfrog .lfcalc</strong> in the left panel, map your variable names if needed, and download. In Leapfrog, go to <em>Calculations → Import</em> and select the file. Your entire decision tree appears as a native calculation set, ready to evaluate against your block model.
<br><br>
<strong>Variable remapping:</strong> CSV column names often differ from Leapfrog variable names (e.g. <code>Fe_pct</code> in your CSV vs. <code>Fe</code> in the block model). The export dialog lets you remap each variable before export — no manual find-and-replace needed.
<br><br>
<strong>What gets exported:</strong>
<br>• One <strong>Calculation</strong> (Category for classification, Number for regression) containing the full nested if/else tree
<br>• The <code>[variable]</code> references in the expression resolve directly against your block model columns — no intermediate Variable items needed
<br>• The output calculation name is configurable (defaults to <code>{target}_pred</code>)
<br><br>
Try it now — click the button below to open the export dialog.`,
    actions: [{ label: '🐸 Open Leapfrog Export', fn: () => showLfcalcDialog() }],
  },
  {
    title: '13 — Import SQL',
    desc: `Arborist can also go the <strong>other direction</strong> — import existing rules as a tree structure.
<br><br>
<strong>The use case:</strong> A geologist has domain rules in SQL from a previous study (maybe from Minitab, a legacy block model, or hand-coded by a consultant). They want to:
<br>1. Visualize the rules as a tree
<br>2. Evaluate them against new data
<br>3. Refine them with bonsai tools
<br>4. Re-export the improved version
<br><br>
<strong>How it works:</strong> Paste a <code>CASE WHEN</code> block into the import dialog. Arborist parses the conditions, reconstructs a binary tree by finding shared condition prefixes, and displays it. If data is loaded, every node gets real statistics — you immediately see accuracy, class distributions, and impurities.
<br><br>
<strong>Supported syntax:</strong>
<br>• <code>feature &lt;= 58.5</code> (numeric comparison)
<br>• <code>feature &gt; 10</code> (numeric comparison)
<br>• <code>feature = 'oxide'</code> (categorical match)
<br>• <code>feature &lt;&gt; 'fresh'</code> (categorical not-equal)
<br>• Multiple conditions joined with <code>AND</code>
<br>• <code>ELSE</code> clause (optional)
<br>• SQL comments (<code>--</code>) are stripped
<br><br>
<strong>The round-trip:</strong> Import SQL → load data → see accuracy → reshape with bonsai → export updated SQL. This is particularly powerful for auditing and improving existing domain models that may have been built years ago with different data.
<br><br>
Click below to open the import dialog and try pasting a CASE WHEN block.`,
    actions: [{ label: '📥 Open Import Dialog', fn: () => showSQLImportDialog() }],
  },
  {
    title: '14 — Projects',
    desc: `Arborist stores projects in the browser's <strong>IndexedDB</strong>, which has effectively no size limit — you can save datasets with hundreds of thousands of rows without issue.
<br><br>
<strong>The Projects section</strong> in the left panel provides four operations:
<br><br>
<strong>💾 Save</strong> — stores everything to IndexedDB: the CSV data, tree structure, configuration (target, max depth, min leaf, min split), column type overrides, and tree mode. Projects are named and timestamped. You can overwrite existing projects by saving with the same name.
<br><br>
<strong>📂 Open</strong> — opens a dialog listing all saved projects with name, date, mode, row count, and edit count. Click to load; click ✕ to delete (with confirmation).
<br><br>
<strong>📤 Export</strong> — downloads the project as a <code>.json</code> file. This is the way to transfer projects between browsers, machines, or colleagues. The file contains everything needed to fully reconstruct the state.
<br><br>
<strong>📥 Import</strong> — uploads a <code>.json</code> file previously exported. Restores the full project including data, tree, config, and types.
<br><br>
<strong>Saved projects on the splash:</strong> When you first open Arborist, the splash screen shows your most recent saved projects for quick access.
<br><br>
<strong>Data safety note:</strong> IndexedDB is browser-local storage. Clearing browser data will delete your projects. For important work, always use <strong>📤 Export</strong> to keep a copy as a JSON file. The files are self-contained and can be version-controlled (e.g. in git alongside your geological model files).`,
    actions: [],
  },
  {
    title: '15 — Tree Parameters',
    desc: `Let's circle back to the <strong>Configuration</strong> section and understand the parameters that control tree growth:
<br><br>
<strong>Max Depth</strong> (default: 5)
<br>The maximum number of splits from root to any leaf. A depth of 1 gives a single split (a "stump"); depth 5 gives up to 32 leaves; depth 10 gives up to 1024 leaves. Deeper trees fit the training data more closely but risk <strong>overfitting</strong> — memorizing noise rather than capturing real patterns.
<br>• <em>Practical guidance:</em> For geomet domaining, 3–6 is usually enough. Domain boundaries shouldn't require 10 levels of conditions to define.
<br><br>
<strong>Min Leaf</strong> (default: 5)
<br>The minimum number of samples allowed in a leaf. This is your <strong>statistical support</strong> constraint. A leaf with only 2 samples might have 100% purity but is meaningless — it could be noise.
<br>• <em>Practical guidance:</em> In resource estimation, each domain needs enough data for variogram modeling — typically 30+ samples for 3D variography. For initial domaining, min leaf of 5–10 is a reasonable starting point.
<br><br>
<strong>Min Split</strong> (default: 10)
<br>The minimum number of samples required at a node before it can be split. If a node has fewer than this, it becomes a leaf regardless of whether a good split exists.
<br>• <em>Practical guidance:</em> Set this to roughly 2× Min Leaf to ensure both children have enough data.
<br><br>
<strong>The trade-off:</strong> Smaller values → deeper, more complex trees with higher training accuracy but higher overfitting risk. Larger values → simpler, more robust trees with lower training accuracy but better generalization. The bonsai workflow lets you start complex and prune back, or start simple and selectively expand.`,
    actions: [],
  },
  {
    title: '16 — Gini Impurity',
    desc: `Let's go deeper on the mathematics. <strong>Gini impurity</strong> is the splitting criterion for classification trees.
<br><br>
<strong>Formula:</strong>
<br><code>Gini(node) = 1 − Σ pᵢ²</code>
<br>where pᵢ is the proportion of class i at the node.
<br><br>
<strong>Intuition:</strong> If you randomly picked two samples from the node, Gini is the probability they'd be different classes. 
<br>• A node with all one class: Gini = 0 (pure)
<br>• A node with 2 classes at 50/50: Gini = 0.5 (maximum impurity for 2 classes)
<br>• A node with 4 classes at 25% each: Gini = 0.75
<br><br>
<strong>How splits are chosen:</strong> For each possible split, we compute:
<br><code>Gain = Gini(parent) − [nₗ·Gini(left) + nᵣ·Gini(right)] / (nₗ+nᵣ)</code>
<br>The split that maximizes gain wins. This means the algorithm finds the threshold that most cleanly separates classes.
<br><br>
<strong>For numeric features:</strong> All data is sorted by the feature value. The algorithm sweeps from left to right, computing Gini incrementally at each potential threshold. This gives O(n·log n) complexity per feature. For a feature with values [3, 5, 8, 12], it tests thresholds at 4, 6.5, and 10 (midpoints between consecutive unique values).
<br><br>
<strong>For categorical features:</strong> Each unique category is tested as a binary split: "Is this category?" vs. "Is it not?". The category that gives the best Gini gain is chosen.
<br><br>
<strong>Gini vs. Entropy:</strong> Some implementations (like ID3/C4.5) use information entropy instead of Gini. In practice, they produce very similar trees. Gini is slightly faster to compute and is the standard for CART.`,
    actions: [],
  },
  {
    title: '17 — Variance & R²',
    desc: `For <strong>regression trees</strong>, the splitting criterion switches from Gini to <strong>variance reduction</strong>.
<br><br>
<strong>Node variance:</strong>
<br><code>Var(node) = (1/n) · Σ(yᵢ − ȳ)²</code>
<br>where ȳ is the mean target value at the node. This is simply the mean squared error (MSE) from predicting the mean.
<br><br>
<strong>Split evaluation:</strong>
<br><code>Gain = Var(parent) − [nₗ·Var(left) + nᵣ·Var(right)] / (nₗ+nᵣ)</code>
<br>Same structure as Gini gain, but measuring variance instead of impurity. The best split creates children with the most internally homogeneous target values.
<br><br>
<strong>Leaf predictions:</strong> Each leaf predicts the <strong>mean</strong> of its samples, with standard deviation as the uncertainty measure. This is a piecewise-constant approximation to the true relationship.
<br><br>
<strong>R² (coefficient of determination):</strong>
<br><code>R² = 1 − SS_res / SS_tot</code>
<br>where SS_res = Σ(yᵢ − ŷᵢ)² (prediction errors) and SS_tot = Σ(yᵢ − ȳ)² (total variance). R² = 1 means perfect prediction; R² = 0 means the tree is no better than predicting the global mean.
<br><br>
<strong>Practical reading:</strong>
<br>• R² &gt; 0.85 — excellent, the tree captures most of the grade variability
<br>• R² 0.6–0.85 — good, useful for domaining but not for final estimation
<br>• R² &lt; 0.6 — the features don't explain much variance; consider different inputs
<br><br>
<strong>Connection to geostatistics:</strong> Regression tree domains are essentially estimation domains where each leaf defines a zone with its own local mean and variance. This is the same concept as stationary domains in variogram modeling — the tree just finds the boundaries automatically.`,
    actions: [],
  },
  {
    title: 'Workshop Complete 🎉',
    desc: `You've completed the full Arborist workshop. Here's a summary of the key concepts:
<br><br>
<strong>Core workflow:</strong> Load CSV → Configure → Grow → Inspect → Reshape → Export
<br><br>
<strong>The bonsai philosophy:</strong> Start with a data-driven tree, then refine it with domain knowledge. The algorithm finds optimal statistical boundaries; you adjust them to match geological reality. Real-time accuracy feedback quantifies every decision.
<br><br>
<strong>Key tools:</strong>
<br>• <strong>Prune</strong> — simplify by collapsing subtrees
<br>• <strong>Regrow</strong> — let CART expand a leaf
<br>• <strong>Force Split</strong> — manually place expert-driven boundaries
<br>• <strong>Top Splits</strong> — data-ranked alternatives for quick refinement
<br>• <strong>Column Types</strong> — force numeric codes to categorical
<br>• <strong>SQL round-trip</strong> — import/export for block model integration
<br><br>
<strong>When to use Arborist:</strong>
<br>• Geometallurgical domain definition
<br>• Grade estimation domain boundaries
<br>• Ore/waste classification rules
<br>• Auditing and improving legacy domain models
<br>• Communicating domain logic to non-specialists
<br>• Any situation where you need transparent, justifiable classification or regression rules
<br><br>
<strong>Reference:</strong>
<br>Breiman, L., Friedman, J.H., Olshen, R.A. and Stone, C.J. (1984). <em>Classification and Regression Trees</em>. Wadsworth & Brooks/Cole, Monterey, CA. ISBN 978-0-412-04841-8.
<br><br>
<em style="color:var(--text-faint);">© 2026 Arthur Endlein · MIT License · Geoscientific Chaos Union</em>`,
    actions: [{ label: '⛏ Reload Iron Ore Classification', fn: () => { loadExample('ironore'); setTimeout(zoomFit, 60); } }],
  },
  {
    title: 'Certificate',
    desc: `Completed the workshop? Enter your full name below and click <strong>Claim Certificate</strong> to open a certificate request on GitHub. A bot will validate your submission and reply with a link to view and download your certificate as a PDF.
<br><br>
Completou o workshop? Digite seu nome completo abaixo e clique em <strong>Claim Certificate</strong> para abrir uma solicita\u00e7\u00e3o de certificado no GitHub. Um bot vai validar sua submiss\u00e3o e responder com um link para visualizar e baixar seu certificado em PDF.
<br><br>
<div>
  <label for="cert-name" style="display:block;font-family:var(--mono);font-size:0.58rem;color:var(--text-faint);margin-bottom:0.3rem;">Full name / Nome completo</label>
  <input type="text" id="cert-name" placeholder="Your Name" style="width:100%;padding:0.35rem 0.5rem;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--text);font-family:var(--mono);font-size:0.62rem;box-sizing:border-box;">
  <div style="margin-top:0.4rem;display:flex;align-items:center;gap:0.5rem;">
    <button onclick="claimCertificate()" style="padding:0.35rem 0.7rem;background:var(--green);border:none;border-radius:4px;color:#111;font-family:var(--mono);font-size:0.62rem;font-weight:700;cursor:pointer;">Claim Certificate</button>
    <span id="cert-status" style="font-family:var(--mono);font-size:0.55rem;"></span>
  </div>
</div>
<br><span style="font-size:0.55rem;color:var(--text-faint);">Requires a GitHub account. If you don't have one, ask the instructor.<br>Requer conta no GitHub. Caso n\u00e3o tenha, pe\u00e7a ao instrutor.</span>`,
    actions: [],
  },
];

function findFirstLeaf(node) {
  if (node.leaf) return node;
  const l = findFirstLeaf(node.left);
  if (l) return l;
  return findFirstLeaf(node.right);
}

function findFirstSplit(node) {
  if (node.leaf) return null;
  // Find a split whose children are both leaves (simplest case)
  if (node.left?.leaf && node.right?.leaf) return node;
  const l = findFirstSplit(node.left);
  if (l) return l;
  return findFirstSplit(node.right);
}

function selectNodeById(id) {
  selectedNodeId = id;
  renderTree();
  renderInspector(id);
}

function openInspector() {
  const panel = document.getElementById('panelRight');
  if (panel) panel.style.transform = 'translateX(0)';
  const toggle = document.getElementById('panelToggle');
  if (toggle) toggle.textContent = '▶ Inspector';
}

function startWorkshop() {
  workshopStep = 0;
  workshopActive = true;
  renderWorkshopCol();
}

function endWorkshop() {
  workshopActive = false;
  const col = document.getElementById('workshopCol');
  if (col) col.remove();
}

function renderWorkshopCol() {
  let col = document.getElementById('workshopCol');
  if (!col) {
    col = document.createElement('div');
    col.className = 'workshop-col';
    col.id = 'workshopCol';
    const appLayout = document.getElementById('app-layout');
    appLayout.insertBefore(col, appLayout.firstChild);
  }

  const step = WORKSHOP_STEPS[workshopStep];
  const total = WORKSHOP_STEPS.length;
  const isFirst = workshopStep === 0;
  const isLast = workshopStep === total - 1;
  const pct = ((workshopStep + 1) / total * 100).toFixed(0);

  let actionsHtml = '';
  if (step.actions.length > 0) {
    actionsHtml = '<div class="ws-actions">' +
      step.actions.map((a, i) => `<button class="ws-action-btn" onclick="workshopAction(${i})">${a.label}</button>`).join('') +
      '</div>';
  }

  col.innerHTML = `
    <div class="ws-header">
      <span class="ws-header-title">📖 Workshop</span>
      <button class="ws-close-btn" onclick="endWorkshop()" title="Exit workshop">✕</button>
    </div>
    <div class="ws-body">
      <div class="ws-step-indicator">STEP ${workshopStep + 1} OF ${total}</div>
      <div class="ws-progress"><div class="ws-progress-fill" style="width:${pct}%"></div></div>
      <div class="ws-title">${step.title}</div>
      <div class="ws-desc">${step.desc}</div>
      ${actionsHtml}
    </div>
    <div class="ws-footer">
      <button class="ws-nav-btn" onclick="workshopPrev()" ${isFirst ? 'disabled' : ''}>◀ Prev</button>
      <button class="ws-nav-btn ws-next" onclick="workshopNext()">${isLast ? '✓ Done' : 'Next ▶'}</button>
    </div>
  `;
}

function workshopPrev() {
  if (workshopStep > 0) { workshopStep--; renderWorkshopCol(); }
}

function workshopNext() {
  if (workshopStep < WORKSHOP_STEPS.length - 1) {
    workshopStep++;
    renderWorkshopCol();
  } else {
    endWorkshop();
  }
}

function workshopAction(idx) {
  const step = WORKSHOP_STEPS[workshopStep];
  if (step.actions[idx]?.fn) step.actions[idx].fn();
}

