// ═══════════════════════════════════════
//  SPATIAL (distances + exclusion buffer)
// ═══════════════════════════════════════
// Used by the validation panel's autocorrelation-leakage diagnostic.
//
// For every test sample we compute the minimum distance to any training
// sample. At a chosen buffer threshold, test samples split into:
//   - "leaky":    min_dist ≤ buffer  (spatially adjacent to training)
//   - "isolated": min_dist >  buffer  (honestly held out in space)
//
// The gap between leaky-test accuracy and isolated-test accuracy is the
// honest autocorrelation signal. No refitting, no ghost tree — bonsai
// edits stay on the wheel.

function coordValues(row, coordCols) {
  // coordCols = { x, y, z } — any may be null. Returns an array of numeric
  // values from the assigned axes, or null if any assigned axis is missing
  // or non-numeric for this row (caller treats it as distance = Infinity).
  const values = [];
  for (const axis of ['x', 'y', 'z']) {
    const col = coordCols[axis];
    if (!col) continue;
    const v = Number(row[col]);
    if (!isFinite(v)) return null;
    values.push(v);
  }
  return values.length > 0 ? values : null;
}

function euclideanDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// For each test row, return { row, minDist } against any training row.
// O(n_test * n_train) — fine up to a few thousand samples in plain JS.
function computeTestDistances(testRows, trainRows, coordCols) {
  const trainCoords = [];
  for (const t of trainRows) {
    const c = coordValues(t, coordCols);
    if (c) trainCoords.push(c);
  }
  const result = [];
  for (const test of testRows) {
    const tc = coordValues(test, coordCols);
    if (!tc || trainCoords.length === 0) {
      result.push({ row: test, minDist: Infinity });
      continue;
    }
    let min = Infinity;
    for (const trc of trainCoords) {
      const d = euclideanDistance(tc, trc);
      if (d < min) { min = d; if (min === 0) break; }
    }
    result.push({ row: test, minDist: min });
  }
  return result;
}

function splitLeakyIsolated(testDistances, buffer) {
  const leaky = [];
  const isolated = [];
  for (const { row, minDist } of testDistances) {
    if (minDist <= buffer) leaky.push(row);
    else isolated.push(row);
  }
  return { leaky, isolated };
}

function summarizeDistances(testDistances) {
  // Median and quartiles of min-distance distribution — used to suggest a
  // sensible buffer value to the user.
  const finite = testDistances
    .map(d => d.minDist)
    .filter(d => isFinite(d))
    .sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor(q * (finite.length - 1)))];
  return {
    min: finite[0],
    q25: pick(0.25),
    median: pick(0.5),
    q75: pick(0.75),
    max: finite[finite.length - 1],
  };
}
