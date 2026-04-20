// ═══════════════════════════════════════
//  VALIDATION (partition + metrics)
// ═══════════════════════════════════════
// Holdout train/test split pinned at session start (or re-rolled via the
// validation panel's Resample button). The tree is always built on the
// training subset; the validation panel always scores on the test subset.
//
// This is the v2 reviewer response — the gap between training accuracy and
// holdout accuracy is the honest overfitting signal.

let CURRENT_SPLIT = null;
// Shape:
// {
//   strategy: 'random' | 'stratified' | 'dhid',
//   sizeSpec: { value: number, unit: 'percent' | 'count' },
//   trainRows: Set<row>,    // references into DATA.rows
//   testRows: Set<row>,
//   seed: number,           // for reproducibility within a session
// }
// Row-reference sets (not indices) so downstream filters can cheaply check
// `split.trainRows.has(row)` regardless of any upstream filtering.

// ── Size-spec resolution ─────────────────────────────────────────────

function resolveTestCount(sizeSpec, total) {
  if (!sizeSpec) return Math.round(total * 0.3);
  if (sizeSpec.unit === 'percent') {
    return Math.max(0, Math.min(total, Math.round(total * sizeSpec.value / 100)));
  }
  return Math.max(0, Math.min(total, Math.round(sizeSpec.value)));
}

// ── Shuffle (Fisher-Yates, deterministic via seeded RNG) ─────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Partitioning strategies ──────────────────────────────────────────

function createPartition(strategy, sizeSpec, seed) {
  if (!DATA || !DATA.rows || DATA.rows.length === 0) return null;
  const rows = DATA.rows;
  const n = rows.length;
  const rng = mulberry32(seed ?? Date.now());
  const testRows = new Set();
  const trainRows = new Set();

  if (strategy === 'stratified') {
    const roles = getColumnRoles();
    const target = roles?.target;
    if (!target || DATA.types[target] !== 'categorical') {
      // Stratification needs a categorical target — fall back to random.
      return createPartition('random', sizeSpec, seed);
    }
    const byClass = {};
    for (const r of rows) {
      const cls = r[target];
      (byClass[cls] ??= []).push(r);
    }
    const testTarget = resolveTestCount(sizeSpec, n);
    for (const [, bucket] of Object.entries(byClass)) {
      shuffleInPlace(bucket, rng);
      const classTestCount = Math.round(testTarget * bucket.length / n);
      for (let i = 0; i < bucket.length; i++) {
        if (i < classTestCount) testRows.add(bucket[i]);
        else trainRows.add(bucket[i]);
      }
    }
  } else if (strategy === 'dhid') {
    const roles = getColumnRoles();
    const dhidCol = roles?.dhid;
    if (!dhidCol) return createPartition('random', sizeSpec, seed);
    const holes = [...new Set(rows.map(r => r[dhidCol]))];
    shuffleInPlace(holes, rng);
    // In dhid mode, 'count' means number of drillholes; 'percent' is % of holes.
    const testHoleCount = sizeSpec?.unit === 'count'
      ? Math.max(0, Math.min(holes.length, Math.round(sizeSpec.value)))
      : Math.max(0, Math.min(holes.length, Math.round(holes.length * (sizeSpec?.value ?? 30) / 100)));
    const testHoles = new Set(holes.slice(0, testHoleCount));
    for (const r of rows) {
      (testHoles.has(r[dhidCol]) ? testRows : trainRows).add(r);
    }
  } else {
    // random
    const shuffled = [...rows];
    shuffleInPlace(shuffled, rng);
    const testCount = resolveTestCount(sizeSpec, n);
    for (let i = 0; i < shuffled.length; i++) {
      if (i < testCount) testRows.add(shuffled[i]);
      else trainRows.add(shuffled[i]);
    }
  }

  return { strategy, sizeSpec, trainRows, testRows, seed: seed ?? Date.now() };
}

// Called by csv.js after a dataset loads, and by the validation panel when
// the user changes strategy/size or clicks Resample.
function setCurrentSplit(strategy, sizeSpec, seed) {
  CURRENT_SPLIT = createPartition(strategy, sizeSpec, seed);
  publish('split', CURRENT_SPLIT);
}

// Filter an arbitrary row array to the training or test subset. Accepts
// already-filtered inputs (e.g. from the row filter) and preserves order.
function filterToTrain(rows) {
  if (!CURRENT_SPLIT) return rows;
  return rows.filter(r => CURRENT_SPLIT.trainRows.has(r));
}

function filterToTest(rows) {
  if (!CURRENT_SPLIT) return [];
  return rows.filter(r => CURRENT_SPLIT.testRows.has(r));
}

function getTrainingRows() {
  if (!DATA || !DATA.rows) return [];
  return filterToTrain(DATA.rows);
}

function getTestRows() {
  if (!DATA || !DATA.rows) return [];
  return filterToTest(DATA.rows);
}

// Called from csv.js once the dataset is loaded and column roles populated.
function initializeDefaultSplit() {
  setCurrentSplit('stratified', { value: 30, unit: 'percent' });
}

// ── Metrics ──────────────────────────────────────────────────────────

function computeMetrics(tree, rows, isRegression) {
  if (!tree || !rows || rows.length === 0) return null;
  const target = tree._target;

  if (isRegression) {
    let sse = 0, sst = 0;
    const ys = rows.map(r => Number(r[target])).filter(v => !isNaN(v));
    if (ys.length === 0) return null;
    const ybar = ys.reduce((a, b) => a + b, 0) / ys.length;
    for (const r of rows) {
      const y = Number(r[target]);
      if (isNaN(y)) continue;
      const pred = predictRow(tree, r);
      sse += (Number(pred.class) - y) ** 2;
      sst += (y - ybar) ** 2;
    }
    return {
      isRegression: true,
      rmse: Math.sqrt(sse / ys.length),
      r2: sst > 0 ? 1 - sse / sst : 0,
      n: ys.length,
    };
  }

  // Classification
  const classes = tree._classes || [];
  const ci = Object.fromEntries(classes.map((c, i) => [c, i]));
  const K = classes.length;
  const confusion = Array.from({ length: K }, () => new Array(K).fill(0));
  let correct = 0;
  let total = 0;
  for (const r of rows) {
    const actual = r[target];
    const iA = ci[actual];
    if (iA === undefined) continue; // target value outside tree's class set
    const pred = predictRow(tree, r);
    const iP = ci[pred.class];
    if (iP === undefined) continue;
    confusion[iA][iP]++;
    total++;
    if (iA === iP) correct++;
  }
  const accuracy = total ? correct / total : 0;

  // Cohen's kappa
  let pe = 0;
  for (let i = 0; i < K; i++) {
    const rowSum = confusion[i].reduce((a, b) => a + b, 0);
    const colSum = confusion.reduce((a, c) => a + c[i], 0);
    pe += (rowSum * colSum) / (total * total || 1);
  }
  const kappa = pe < 1 ? (accuracy - pe) / (1 - pe) : 0;

  // Per-class precision and recall
  const perClass = classes.map((c, i) => {
    const rowSum = confusion[i].reduce((a, b) => a + b, 0);
    const colSum = confusion.reduce((a, cc) => a + cc[i], 0);
    const tp = confusion[i][i];
    return {
      class: c,
      precision: colSum ? tp / colSum : 0,
      recall: rowSum ? tp / rowSum : 0,
      support: rowSum,
    };
  });

  return { isRegression: false, confusion, classes, accuracy, kappa, perClass, n: total };
}
