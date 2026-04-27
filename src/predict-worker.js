// ═══════════════════════════════════════
//  PREDICT WORKER — applies a frozen tree to streamed CSV body chunks.
// ═══════════════════════════════════════
// Runs inside a Worker spawned from a Blob URL whose content is the text of
// this file (build inlines it into a <script type="text/js-worker"> tag).
// Main thread strips the input header before sending; this worker only sees
// data lines. Maintains a partial-line buffer across chunks.

let cfg = null;
let lineBuf = '';
let totalRowsOut = 0;
let stats = null;

function newStats() {
  return {
    classCounts: Object.create(null), // classification only
    valN: 0, valSum: 0, valSumSq: 0,  // regression only
    valMin: Infinity, valMax: -Infinity,
    confN: 0, confSum: 0, confMin: Infinity, confMax: -Infinity,
    leafCounts: Object.create(null),  // leafId → count
    featureStats: Object.create(null), // initialised per init from cfg.featureTypes
    validation: null,                  // { enabled, isReg, ... } if cfg.targetColIdx >= 0
  };
}

function newValidation(isReg) {
  return {
    enabled: true, isReg: !!isReg,
    // classification
    confusion: Object.create(null),  // confusion[actual][predicted] = count
    matchedCount: 0, correctCount: 0,
    // regression
    actualN: 0, actualSum: 0, actualSumSq: 0,
    residSum: 0, residSumSq: 0, absResidSum: 0,
  };
}

function newNumericFS() {
  return { type: 'numeric', n: 0, sum: 0, sumSq: 0, min: Infinity, max: -Infinity, missing: 0 };
}
function newCategoricalFS() {
  return { type: 'categorical', n: 0, counts: Object.create(null), missing: 0 };
}

const NULLISH = new Set(['', 'NA', 'na', 'NaN', 'nan', 'NULL', 'null', '#N/A', '-', '.', '?']);

function splitCSVRow(line, delim) {
  const fields = [];
  let i = 0, field = '', inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { field += '"'; i += 2; }
        else { inQ = false; i++; }
      } else { field += c; i++; }
    } else {
      if (c === '"') { inQ = true; i++; }
      else if (c === delim) { fields.push(field); field = ''; i++; }
      else { field += c; i++; }
    }
  }
  fields.push(field);
  return fields;
}

function cleanFieldForFeature(v, commaDecimal) {
  let s = v.trim().replace(/^["']|["']$/g, '');
  if (commaDecimal && s) s = s.replace(/,/g, '.');
  return NULLISH.has(s) ? '' : s;
}

function predictRow(node, get) {
  while (!node.leaf) {
    const split = node.split;
    if (split.type === 'numeric') {
      const v = parseFloat(get(split.feature));
      if (isNaN(v)) return { class: node.prediction, confidence: node.confidence, leafId: node.id };
      node = v <= split.threshold ? node.left : node.right;
    } else {
      node = get(split.feature) === split.category ? node.left : node.right;
    }
  }
  return { class: node.prediction, confidence: node.confidence, leafId: node.id };
}

function escapeOut(v, delim) {
  if (v == null) return '';
  const s = String(v);
  if (s.indexOf(delim) >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatNum(v) {
  let s = Number(v).toFixed(6);
  // Trim trailing zeros for tidiness, keep at least one decimal digit
  s = s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return cfg.commaDecimal ? s.replace('.', ',') : s;
}

function processLine(line) {
  if (!line) return null;
  if (cfg.commentPrefix && line.trimStart().startsWith(cfg.commentPrefix)) return null;
  const fields = splitCSVRow(line, cfg.delim);
  if (fields.length === 0) return null;

  // Pre-extract feature values once so per-feature stats and predictRow both
  // see the same cleaned strings without re-tokenising twice per row.
  const featValues = Object.create(null);
  for (const feat in cfg.featureColIdx) {
    const idx = cfg.featureColIdx[feat];
    let v = '';
    if (idx != null && idx >= 0 && idx < fields.length) {
      v = cleanFieldForFeature(fields[idx], cfg.commaDecimal);
    }
    featValues[feat] = v;

    const fs = stats.featureStats[feat];
    if (!fs) continue;
    if (v === '') { fs.missing++; continue; }
    if (fs.type === 'numeric') {
      const num = parseFloat(v);
      if (isNaN(num)) { fs.missing++; continue; }
      fs.n++; fs.sum += num; fs.sumSq += num * num;
      if (num < fs.min) fs.min = num;
      if (num > fs.max) fs.max = num;
    } else {
      fs.n++;
      fs.counts[v] = (fs.counts[v] || 0) + 1;
    }
  }

  const get = (feat) => featValues[feat] || '';
  const pred = predictRow(cfg.tree, get);

  // Validation: compare prediction to the actual value if a target column was
  // configured. Skip rows where the target field is empty.
  if (cfg.targetColIdx != null && cfg.targetColIdx >= 0 && stats.validation) {
    const v = stats.validation;
    const rawT = (cfg.targetColIdx < fields.length) ? fields[cfg.targetColIdx] : '';
    const cleaned = cleanFieldForFeature(rawT, cfg.commaDecimal);
    if (cleaned !== '') {
      if (cfg.isReg) {
        const actual = parseFloat(cleaned);
        if (isFinite(actual)) {
          v.actualN++;
          v.actualSum += actual;
          v.actualSumSq += actual * actual;
          const predicted = Number(pred.class);
          if (isFinite(predicted)) {
            const r = actual - predicted;
            v.residSum += r;
            v.residSumSq += r * r;
            v.absResidSum += Math.abs(r);
          }
        }
      } else {
        v.matchedCount++;
        const predicted = String(pred.class);
        if (predicted === cleaned) v.correctCount++;
        const row = v.confusion[cleaned] || (v.confusion[cleaned] = Object.create(null));
        row[predicted] = (row[predicted] || 0) + 1;
      }
    }
  }

  // Stats
  if (cfg.isReg) {
    const v = Number(pred.class);
    if (isFinite(v)) {
      stats.valN++;
      stats.valSum += v;
      stats.valSumSq += v * v;
      if (v < stats.valMin) stats.valMin = v;
      if (v > stats.valMax) stats.valMax = v;
    }
  } else {
    const k = String(pred.class);
    stats.classCounts[k] = (stats.classCounts[k] || 0) + 1;
  }
  const c = Number(pred.confidence);
  if (isFinite(c)) {
    stats.confN++;
    stats.confSum += c;
    if (c < stats.confMin) stats.confMin = c;
    if (c > stats.confMax) stats.confMax = c;
  }
  const lk = String(pred.leafId);
  stats.leafCounts[lk] = (stats.leafCounts[lk] || 0) + 1;

  const out = [];
  for (const idx of cfg.outputInputColIdx) {
    out.push(escapeOut(fields[idx] != null ? fields[idx] : '', cfg.delim));
  }
  if (cfg.outputCols.pred) {
    const v = cfg.isReg ? formatNum(pred.class) : pred.class;
    out.push(escapeOut(v, cfg.delim));
  }
  if (cfg.outputCols.conf) {
    out.push(escapeOut(formatNum(pred.confidence), cfg.delim));
  }
  if (cfg.outputCols.leaf) {
    out.push(escapeOut(pred.leafId, cfg.delim));
  }
  return out.join(cfg.delim);
}

self.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    cfg = {
      tree: msg.tree,
      delim: msg.delim,
      commaDecimal: msg.decimalSep === ',',
      featureColIdx: msg.featureColIdx,
      featureTypes: msg.featureTypes || {}, // feat → 'numeric' | 'categorical'
      outputInputColIdx: msg.outputInputColIdx,
      outputCols: msg.outputCols,
      isReg: !!msg.isReg,
      commentPrefix: msg.commentPrefix || '',
      targetColIdx: (msg.targetColIdx != null) ? msg.targetColIdx : -1,
    };
    lineBuf = '';
    totalRowsOut = 0;
    stats = newStats();
    // Pre-allocate per-feature stats slots based on declared types
    for (const feat in cfg.featureColIdx) {
      const idx = cfg.featureColIdx[feat];
      if (idx == null || idx < 0) continue; // unmapped — no stats
      const t = cfg.featureTypes[feat] || 'numeric';
      stats.featureStats[feat] = t === 'categorical' ? newCategoricalFS() : newNumericFS();
    }
    if (cfg.targetColIdx >= 0) stats.validation = newValidation(cfg.isReg);
    self.postMessage({ type: 'ready' });
    return;
  }

  if (msg.type === 'chunk') {
    if (!cfg) {
      self.postMessage({ type: 'error', error: 'chunk before init' });
      return;
    }
    const text = lineBuf + (msg.text || '');
    let toProcess, remaining;

    if (msg.isLast) {
      toProcess = text;
      remaining = '';
    } else {
      const lastNl = text.lastIndexOf('\n');
      if (lastNl < 0) {
        lineBuf = text;
        self.postMessage({ type: 'output', text: '', rows: 0, totalRows: totalRowsOut, isLast: false });
        return;
      }
      toProcess = text.slice(0, lastNl);
      remaining = text.slice(lastNl + 1);
    }
    lineBuf = remaining;

    const normalised = toProcess.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalised.split('\n');
    const outParts = [];
    let rows = 0;
    for (const line of lines) {
      if (!line) continue;
      const result = processLine(line);
      if (result != null) { outParts.push(result); rows++; }
    }
    totalRowsOut += rows;
    const outText = outParts.length ? outParts.join('\n') + '\n' : '';
    const reply = {
      type: 'output',
      text: outText,
      rows,
      totalRows: totalRowsOut,
      isLast: !!msg.isLast,
    };
    if (msg.isLast) reply.stats = stats;
    self.postMessage(reply);
    return;
  }
};
