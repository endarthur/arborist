// ═══════════════════════════════════════
//  STANDALONE HTML EXPORT
// ═══════════════════════════════════════
// Two entry points:
//   showStandaloneExportDialog() — opens a floating dialog where the user
//     can attach a title, description, author, drift-stats toggle, and
//     filename. Persists the choices on the project payload so subsequent
//     exports remember.
//   exportStandaloneHtml(opts) — reads the embedded viewer template
//     (#viewer-template-b64), injects payload + meta, downloads.

let _standaloneSettings = {
  title: '',
  description: '',
  author: '',
  includeTrainingStats: true,
  filename: '',
};

function getStandaloneDefaults() {
  const datasetLabel = (DATA && DATA._name) ? DATA._name
    : (TREE && TREE._target) ? TREE._target : 'tree';
  const slug = String(datasetLabel).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'tree';
  return {
    title: `Arborist Predictor — ${datasetLabel}`,
    filename: `${slug}_predictor.html`,
    datasetLabel,
  };
}

function showStandaloneExportDialog() {
  if (!TREE) { showToast('Grow a tree first'); return; }
  const host = openFloatingPanel('standalone-export', { title: 'Standalone HTML', width: 540, height: 540 });
  if (!host) return;

  const defaults = getStandaloneDefaults();
  const s = _standaloneSettings;
  const title = s.title || defaults.title;
  const filename = s.filename || defaults.filename;

  host.innerHTML = `
    <div class="dialog-hint">
      Bundles the current tree into a self-contained HTML file. The recipient
      can browse the tree, copy rule exports, and apply the model to their own
      CSV — no installation, works offline, mobile-friendly.
    </div>

    <div class="se-section">
      <label class="se-label">Title</label>
      <input type="text" id="se-title" class="se-input" value="${escHtml(title)}"
        placeholder="${escHtml(defaults.title)}" />
    </div>

    <div class="se-section">
      <label class="se-label">Description <span class="se-hint">methodology, caveats, provenance — shown above the tree</span></label>
      <textarea id="se-description" class="se-textarea" rows="4"
        placeholder="e.g. Trained on Q1 2026 mb_bacd_140623 assays. Hypogene cluster excluded due to assay re-runs."
      >${escHtml(s.description)}</textarea>
    </div>

    <div class="se-section">
      <label class="se-label">Author / contact <span class="se-hint">shown in the footer</span></label>
      <input type="text" id="se-author" class="se-input" value="${escHtml(s.author)}"
        placeholder="e.g. Geomet · GCU Mining · 2026" />
    </div>

    <div class="se-section se-toggle-row">
      <label>
        <input type="checkbox" id="se-include-stats" ${s.includeTrainingStats ? 'checked' : ''} />
        Include per-feature training stats
      </label>
      <span class="se-hint">drives drift comparison in the apply summary; disable when sharing externally if grade ranges are sensitive</span>
    </div>

    <div class="se-section">
      <label class="se-label">Filename</label>
      <input type="text" id="se-filename" class="se-input" value="${escHtml(filename)}"
        placeholder="${escHtml(defaults.filename)}" />
    </div>

    <div class="dialog-buttons">
      <button class="dialog-btn" onclick="closeFloatingPanel('standalone-export')">Cancel</button>
      <button class="dialog-btn dialog-btn-primary" onclick="applyStandaloneExportFromDialog()">Export</button>
    </div>`;
  host.querySelector('#se-title')?.focus();
}

function applyStandaloneExportFromDialog() {
  const s = _standaloneSettings;
  const defaults = getStandaloneDefaults();
  s.title = (document.getElementById('se-title')?.value || '').trim();
  s.description = (document.getElementById('se-description')?.value || '').trim();
  s.author = (document.getElementById('se-author')?.value || '').trim();
  s.includeTrainingStats = !!document.getElementById('se-include-stats')?.checked;
  s.filename = (document.getElementById('se-filename')?.value || '').trim();
  closeFloatingPanel('standalone-export');
  exportStandaloneHtml({
    title: s.title || defaults.title,
    description: s.description,
    author: s.author,
    includeTrainingStats: s.includeTrainingStats,
    filename: s.filename || defaults.filename,
  });
}

function exportStandaloneHtml(opts) {
  if (!TREE) { showToast('Grow a tree first'); return; }
  const defaults = getStandaloneDefaults();
  opts = opts || {};
  const title = opts.title || defaults.title;
  const filename = opts.filename || defaults.filename;
  const description = opts.description || '';
  const author = opts.author || '';
  const includeTrainingStats = opts.includeTrainingStats !== false;

  // Strip _rows + transient fields recursively. Keep classCounts (needed by
  // the viewer's class-distribution bars) and gini/n/depth (used by the
  // viewer's mimic-io re-export).
  const cleanTree = (node) => {
    if (!node) return null;
    const out = {
      id: node.id,
      leaf: !!node.leaf,
      prediction: node.prediction,
      confidence: node.confidence,
      n: node.n,
      depth: node.depth,
      gini: node.gini,
    };
    if (node.classCounts) out.classCounts = { ...node.classCounts };
    if (!node.leaf) {
      out.split = {
        type: node.split.type,
        feature: node.split.feature,
      };
      if (node.split.type === 'numeric') out.split.threshold = node.split.threshold;
      else out.split.category = node.split.category;
      out.left = cleanTree(node.left);
      out.right = cleanTree(node.right);
    }
    return out;
  };

  const usedFeatures = (typeof getUsedFeatures === 'function') ? getUsedFeatures() : (TREE._features || []);
  const trainingStats = (includeTrainingStats && typeof gatherTrainingStats === 'function')
    ? gatherTrainingStats(usedFeatures)
    : {};

  const meta = {
    target: TREE._target || null,
    features: TREE._features || [],
    classes: TREE._mode === 'regression' ? null : (TREE._classes || []),
    mode: TREE._mode,
    dataset: (DATA && DATA._name) ? DATA._name : null,
    exportedAt: new Date().toISOString(),
    title: opts.title || '',
    description,
    author,
    trainingStats,
  };

  const payload = {
    format: 'arborist-standalone',
    version: 1,
    tree: cleanTree(TREE),
    meta,
  };

  const b64El = document.getElementById('viewer-template-b64');
  if (!b64El) { showToast('Standalone template missing — rebuild required'); return; }
  const b64 = b64El.textContent.trim();
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let html = new TextDecoder('utf-8').decode(bytes);

  let payloadJson = JSON.stringify(payload);
  // Neutralise any closing-script-tag sequence inside the JSON so it doesn't
  // terminate the embedding <script> early. Built without the literal pattern
  // in this source so the comment doesn't itself trip the HTML parser.
  const closingPattern = new RegExp('<' + '/script', 'gi');
  payloadJson = payloadJson.replace(closingPattern, '<' + '\\/script');

  html = html.replace('<!-- TITLE -->', escapeForHtml(title));
  html = html.replace('<!-- PAYLOAD -->', payloadJson);

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);

  const kb = (html.length / 1024).toFixed(0);
  showToast(`Standalone HTML downloaded · ${filename} · ${kb} KB`);
}

function escapeForHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
