// ═══════════════════════════════════════
//  HELP
// ═══════════════════════════════════════
function showHelp() {
  const host = openFloatingPanel('help', { title: '🌳 Arborist — Guide', width: 600, height: 600 });
  if (!host) return;
  host.innerHTML = `
    <div class="help-sub">Decision Tree Cultivator · v0.1</div>

    <h4>Workflow</h4>
    <div class="help-flow">
      <span class="help-flow-step">Load Data</span>
      <span class="help-flow-arrow">→</span>
      <span class="help-flow-step">Configure</span>
      <span class="help-flow-arrow">→</span>
      <span class="help-flow-step">Grow Tree</span>
      <span class="help-flow-arrow">→</span>
      <span class="help-flow-step">Inspect</span>
      <span class="help-flow-arrow">→</span>
      <span class="help-flow-step">Reshape</span>
      <span class="help-flow-arrow">→</span>
      <span class="help-flow-step">Export</span>
    </div>
    <p>Load a CSV (or use an example dataset), pick a target column, set tree parameters, and hit <code>🌱 Grow Tree</code>.
    Click nodes to inspect them, then use the bonsai tools to reshape the tree manually. Export the final rules.</p>

    <h4>CSV Parsing</h4>
    <p>Arborist auto-detects the delimiter (comma, tab, semicolon, pipe, space) and decimal separator. Semicolon-delimited files are assumed to use comma as the decimal separator (European/Brazilian convention). Click the <strong>⚙</strong> gear icon in the Data section header to override auto-detected settings — useful for pipe-delimited files, custom separators, or when detection gets it wrong. The config dialog shows a live preview of the parse result as you adjust settings.</p>
    <p>Missing values — including <code>NA</code>, <code>NaN</code>, <code>null</code>, <code>-999</code>, <code>#N/A</code>, <code>*</code>, <code>-</code>, and others — are detected automatically and shown per-column in the data summary.</p>

    <h4>Row Filter</h4>
    <p>Below the data summary, the row filter lets you restrict the dataset using JavaScript expressions on a row object <code>r</code>. For example: <code>r.Fe_pct > 60 && r.weathering === 'oxide'</code>. Column names autocomplete as you type. The filter applies to both tree growing and CSV prediction export. Filters are saved with projects.</p>

    <h4>Classification vs Regression</h4>
    <p>Arborist auto-detects the mode from your target column. Categorical targets (text values) trigger <strong>classification</strong> using Gini impurity. Numeric targets trigger <strong>regression</strong> using variance reduction. The stats bar shows Accuracy or R² accordingly.</p>

    <h4>Column Types</h4>
    <p>In the left panel data summary, each column shows <code>num #</code> or <code>cat ●</code>. Click the type badge on any originally-numeric column to force it to categorical — useful for zone IDs, litho codes, or drillhole numbers that look numeric but should be treated as categories.</p>

    <h4>Tree Parameters</h4>
    <ul>
      <li><strong>Target</strong> — the column to predict. Categoricals are listed first.</li>
      <li><strong>Max Depth</strong> — limits how deep the tree can grow. Deeper = more specific, risk of overfitting.</li>
      <li><strong>Min Leaf</strong> — minimum samples required in a leaf. Larger = smoother, more conservative.</li>
      <li><strong>Min Split</strong> — minimum samples required to attempt a split.</li>
    </ul>

    <h4>Inspector Panel</h4>
    <p>Click any node to open the inspector. For classification, you see the class distribution bar and proportions. For regression, a histogram of values with mean (amber line) and ±σ range.</p>
    <p>The panel also shows: impurity (Gini or Variance), sample count, prediction, confidence/std, and split details with child stats.</p>

    <h4>Bonsai Tools (Manual Reshaping)</h4>
    <p>Below the metrics you'll find bonsai actions for the selected node:</p>
    <ul>
      <li><strong>✂ Prune to Leaf</strong> — collapse a split node into a leaf, removing all children.</li>
      <li><strong>🌿 Regrow from Leaf</strong> — let CART find the best split for a leaf, expanding it.</li>
      <li><strong>⚡ Force Split</strong> — manually split a leaf on any feature/threshold you choose. The Gini/Variance chart helps you pick optimal thresholds visually (click the chart to set a value).</li>
    </ul>
    <p>The <strong>Top Splits</strong> section shows the 6 best data-driven splits for the selected node, ranked by Gini gain or variance reduction. Click any to apply it.</p>
    <p>All edits are tracked with an undo stack (max 30). Use <kbd>↩ Undo</kbd> to step back or <kbd>⟲ Reset</kbd> to restore the original tree.</p>

    <h4>Exporting Rules</h4>
    <ul>
      <li><code>📋 Rules</code> — human-readable IF/AND/THEN pseudocode.</li>
      <li><code>🐍 Python</code> — nested if/else function, paste into a script.</li>
      <li><code>📊 Excel IF</code> — nested IF() formula for spreadsheets.</li>
      <li><code>🗄 SQL CASE</code> — CASE WHEN block for block model queries (Vulcan, Surpac, Datamine).</li>
      <li><code>📁 CSV</code> — downloads predictions for every row with predicted class/value, confidence, and leaf ID.</li>
    </ul>

    <h4>Importing SQL Rules</h4>
    <p>Use <code>📥 Import SQL</code> to paste a CASE WHEN block from Minitab, legacy block models, or any SQL source. Arborist parses the conditions and reconstructs a binary tree. If data is loaded, it evaluates accuracy immediately — you can then use bonsai tools to refine the imported rules.</p>

    <h4>Projects (Save / Load)</h4>
    <p>Projects are stored in the browser's IndexedDB (no size limit). Use the left panel buttons:</p>
    <ul>
      <li><code>💾 Save</code> / <code>📂 Open</code> — persist to browser storage.</li>
      <li><code>📤 Export</code> / <code>📥 Import</code> — download/upload as JSON files to share between machines.</li>
    </ul>
    <p>Projects store: CSV data, tree structure, configuration, column type overrides, and tree mode.</p>

    <h4>Navigation</h4>
    <ul>
      <li><strong>Pan</strong> — click and drag on the tree canvas.</li>
      <li><strong>Zoom</strong> — mouse wheel, or use the +/− buttons.</li>
      <li><strong>Fit</strong> — auto-zoom to show the entire tree.</li>
      <li><strong>Deselect</strong> — click empty canvas area.</li>
    </ul>

    <h4>About</h4>
    <p>Arborist is a browser-based CART (Classification and Regression Trees) implementation with an interactive "bonsai" workflow for expert-guided tree reshaping. It is written in vanilla JavaScript with zero dependencies — no frameworks, no build tools, no server required. The entire application runs client-side in a single HTML file.</p>
    <p>The bonsai workflow allows post-hoc integration of domain knowledge into data-driven trees — particularly useful in geometallurgical domaining and resource estimation, where statistical optima don't always align with geological reality and regulatory frameworks (JORC, NI 43-101) require transparent, justifiable domain boundaries.</p>

    <h4>References</h4>
    <p style="font-size:0.62rem; color:var(--text-faint); line-height:1.7;">
      Breiman, L., Friedman, J.H., Olshen, R.A. and Stone, C.J. (1984). <em>Classification and Regression Trees</em>. Wadsworth & Brooks/Cole, Monterey, CA. ISBN 978-0-412-04841-8.
      <br><br>
      The CART algorithm — greedy binary recursive partitioning using Gini impurity for classification and variance reduction for regression — follows the original formulation in Breiman et al. (1984). The incremental sweep implementation for finding optimal numeric thresholds is inspired by the approach used in scikit-learn's <code>DecisionTreeClassifier</code> (Pedregosa et al., 2011).
      <br><br>
      Pedregosa, F. et al. (2011). Scikit-learn: Machine Learning in Python. <em>Journal of Machine Learning Research</em>, 12, pp. 2825–2830.
    </p>
    <p style="color:var(--text-faint); font-size:0.58rem; margin-top:0.6rem;">Arborist v0.2.0 · Geoscientific Chaos Union · © 2026 Arthur Endlein Correia, Jéssica da Matta · MIT License</p>
  `;
}

function showAbout() {
  const host = openFloatingPanel('about', { title: 'About Arborist', width: 460, height: 400 });
  if (!host) return;
  host.innerHTML = `
    <div style="text-align:center;margin-bottom:0.8rem;">
      <div style="font-family:var(--display);font-size:1.4rem;font-weight:900;color:var(--text);letter-spacing:-0.02em;">
        🌳 Arbor<span style="color:var(--green);">ist</span>
      </div>
      <div style="font-family:var(--mono);font-size:0.6rem;color:var(--text-faint);letter-spacing:0.06em;text-transform:uppercase;margin-top:0.2rem;">
        Decision Tree Cultivator · v0.2.0
      </div>
    </div>
    <h4>Authors</h4>
    <p>Arthur Endlein Correia · Jéssica da Matta</p>
    <p style="color:var(--text-faint);font-size:0.6rem;">Geoscientific Chaos Union</p>

    <h4>Repository</h4>
    <p><a href="https://github.com/endarthur/arborist" target="_blank" style="color:var(--green);">github.com/endarthur/arborist</a></p>
    <p style="color:var(--text-faint);font-size:0.6rem;">DOI: pending first release</p>

    <h4>License</h4>
    <p>MIT © 2026 Arthur Endlein Correia, Jéssica da Matta</p>

    <h4>Built on</h4>
    <ul style="font-size:0.62rem;">
      <li>dockview-core 5.2.0 (MIT) — panel layout</li>
      <li>three.js r160 (MIT) + OrbitControls — 3D scatter</li>
      <li>@gcu/dee (MIT) — geoscientific 3D scene wrapper</li>
      <li>pollywog (vendored) — Leapfrog .lfcalc serialiser</li>
    </ul>
  `;
}

function showParamHelp() {
  const host = openFloatingPanel('param-help', { title: '⚙️ Tree Parameters', width: 460, height: 520 });
  if (!host) return;
  host.innerHTML = `
    <div class="help-sub">What each configuration option does</div>

    <h4>Target</h4>
    <p>The column you want the tree to <strong>predict</strong>. For example, if your spreadsheet has rock types and chemical values, and you want to predict the rock type, you'd choose that column here.</p>
    <p>Columns with text values (categories) appear at the top of the list. Columns with numbers appear below. The tree automatically detects whether it's a <em>classification</em> (predicting categories) or <em>regression</em> (predicting a number) problem.</p>

    <h4>Max Depth</h4>
    <p>The <strong>maximum number of questions</strong> the tree can ask from the root to any leaf. Think of it like a flowchart — depth 1 means just one question; depth 5 means up to 5 questions in a row.</p>
    <ul>
      <li><strong>Too small</strong> (e.g. 1–2) → tree is too simple, may miss real patterns (<em>underfitting</em>)</li>
      <li><strong>Too large</strong> (e.g. 15+) → tree memorises noise in your data (<em>overfitting</em>)</li>
      <li><strong>Default: 5</strong> — a good starting point for most datasets</li>
    </ul>

    <h4>Min Leaf</h4>
    <p>The <strong>minimum number of samples</strong> that must end up in a leaf node. A leaf is a "final answer" box at the bottom of the tree.</p>
    <ul>
      <li>A leaf with only 1–2 samples might look 100% pure, but could just be noise</li>
      <li>Increasing this value makes the tree more conservative and reliable</li>
      <li><strong>Default: 5</strong> — each final group must have at least 5 data points</li>
    </ul>

    <h4>Min Split</h4>
    <p>The <strong>minimum number of samples</strong> a node must have before the tree is even allowed to try splitting it. If a node has fewer samples than this, it stays as a leaf.</p>
    <ul>
      <li>A good rule of thumb is to set this to roughly <strong>2 × Min Leaf</strong></li>
      <li>This prevents splits where one of the two children would be too small</li>
      <li><strong>Default: 10</strong></li>
    </ul>
  `;
}

