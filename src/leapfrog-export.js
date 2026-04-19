// ═══════════════════════════════════════
//  LEAPFROG EXPORT
// ═══════════════════════════════════════
function showLfcalcDialog() {
  if (!TREE) return;
  document.querySelectorAll('.load-dialog-overlay').forEach(d => d.remove());

  // Collect features used in splits
  const features = new Set();
  (function walk(n) {
    if (n.leaf) return;
    features.add(n.split.feature);
    walk(n.left); walk(n.right);
  })(TREE);
  const featureList = [...features].sort();

  const overlay = document.createElement('div');
  overlay.className = 'load-dialog-overlay';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

  const dialog = document.createElement('div');
  dialog.className = 'lfcalc-dialog';

  const defaultCalcName = (TREE._target || 'prediction') + '_pred';
  const escAttr = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const escHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const varsHtml = featureList.map(f =>
    `<div class="lf-var-row"><label>${escHtml(f)}</label><input type="text" data-csv-name="${escAttr(f)}" value="${escAttr(f)}"></div>`
  ).join('');

  dialog.innerHTML = `
    <h3>🐸 Leapfrog Export</h3>
    <div class="lf-hint">Map CSV column names to Leapfrog variable names. Edit to remap.</div>
    <div class="lf-section">Variables</div>
    ${varsHtml}
    <div class="lf-section">Output</div>
    <div class="lf-var-row">
      <label>Calculation name</label>
      <input type="text" id="lfCalcName" value="${escAttr(defaultCalcName)}">
    </div>
    <div class="lf-buttons">
      <button class="lf-cancel" onclick="this.closest('.load-dialog-overlay').remove()">Cancel</button>
      <button class="lf-export" onclick="exportLfcalc()">Export .lfcalc</button>
    </div>`;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function treeToLfcalc(node, varMap, calcName) {
  const isReg = TREE_MODE === 'regression';

  // Recursive converter: tree node → Pollywog If/value
  function convert(n) {
    if (n.leaf) {
      if (isReg) {
        const v = Number(n.prediction);
        return Number.isInteger(v) ? String(v) : v.toFixed(6);
      }
      return '"' + String(n.prediction) + '"';
    }
    const s = n.split;
    const mapped = varMap[s.feature] || s.feature;
    let cond;
    if (s.type === 'numeric') {
      const thresh = Number.isInteger(s.threshold) ? String(s.threshold) : s.threshold.toFixed(6);
      cond = '[' + mapped + '] <= ' + thresh;
    } else {
      cond = '[' + mapped + '] == "' + s.category + '"';
    }
    return Pollywog.If(cond, convert(n.left), convert(n.right));
  }

  const expr = convert(node);

  // Wrap in Category (classification) or NumberCalc (regression)
  // No Variable items needed — [bracketed] references resolve directly against the block model
  const CalcType = isReg ? Pollywog.NumberCalc : Pollywog.Category;
  const comment = 'Arborist CART ' + (isReg ? 'regression' : 'classification') + ' tree';
  const calc = new CalcType(calcName, [expr], '', comment);

  return new Pollywog.CalcSet([calc]);
}

function exportLfcalc() {
  try {
    const dialog = document.querySelector('.lfcalc-dialog');
    const varMap = {};
    dialog.querySelectorAll('.lf-var-row input[data-csv-name]').forEach(input => {
      varMap[input.dataset.csvName] = input.value.trim() || input.dataset.csvName;
    });
    const calcName = document.getElementById('lfCalcName').value.trim() || (TREE._target + '_pred');
    const calcSet = treeToLfcalc(TREE, varMap, calcName);
    calcSet.downloadLfcalc('arborist_tree.lfcalc').then(() => {
      showToast('Leapfrog .lfcalc exported');
      document.querySelector('.load-dialog-overlay')?.remove();
    }).catch(err => {
      showToast('Export failed: ' + err.message);
    });
  } catch (err) {
    showToast('Export failed: ' + err.message);
  }
}

