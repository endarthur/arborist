// ═══════════════════════════════════════
//  COLUMN ROLES
// ═══════════════════════════════════════
// Every column in the loaded dataset plays a role: target (what the tree
// predicts), X/Y/Z (sample coordinates for spatial validation and the 3D
// scatter panel), drillhole ID (grouping key for drillhole-grouped CV),
// or feature (everything left over).
//
// Coord and drillhole roles are optional. Features are derived — we do NOT
// train on columns assigned to a role, because X/Y/Z as splits would just
// reproduce spatial clusters rather than geometallurgical structure.

const COLUMN_ROLE_PATTERNS = {
  x: [/^x$/i, /^x[_-]?coord/i, /^east/i, /^easting/i, /^xm?$/i],
  y: [/^y$/i, /^y[_-]?coord/i, /^north/i, /^northing/i, /^ym?$/i],
  z: [/^z$/i, /^z[_-]?coord/i, /^elev/i, /^elevation/i, /^rl$/i, /^zm?$/i],
  dhid: [/^dhid$/i, /^hole[_-]?id$/i, /^drillhole/i, /^borehole/i, /^bhid$/i, /^well[_-]?id$/i],
};

function detectColumnRole(role, headers) {
  const patterns = COLUMN_ROLE_PATTERNS[role];
  if (!patterns) return '';
  for (const p of patterns) {
    for (const h of headers) {
      if (p.test(h)) return h;
    }
  }
  return '';
}

function populateColumnRoleSelects() {
  if (!DATA) return;
  const headers = DATA.headers;
  const cats = headers.filter(h => DATA.types[h] === 'categorical');
  const nums = headers.filter(h => DATA.types[h] === 'numeric');

  // Target dropdown: categoricals first, then numerics, with type glyph.
  const target = document.getElementById('targetSelect');
  target.innerHTML = '';
  for (const h of [...cats, ...nums]) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = h + (DATA.types[h] === 'categorical' ? ' ●' : ' #');
    target.appendChild(opt);
  }

  // XYZ and dhid dropdowns: (none) + all columns.
  for (const id of ['xSelect', 'ySelect', 'zSelect', 'dhidSelect']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    sel.appendChild(noneOpt);
    for (const h of headers) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      sel.appendChild(opt);
    }
  }

  // Heuristic auto-detect for coordinates and drillhole ID.
  const xDet = detectColumnRole('x', headers);
  const yDet = detectColumnRole('y', headers);
  const zDet = detectColumnRole('z', headers);
  const dhidDet = detectColumnRole('dhid', headers);
  if (xDet) document.getElementById('xSelect').value = xDet;
  if (yDet) document.getElementById('ySelect').value = yDet;
  if (zDet) document.getElementById('zSelect').value = zDet;
  if (dhidDet) document.getElementById('dhidSelect').value = dhidDet;

  publish('columns', getColumnRoles());
}

function getColumnRoles() {
  if (!DATA) return null;
  const target = document.getElementById('targetSelect')?.value || null;
  const x = document.getElementById('xSelect')?.value || null;
  const y = document.getElementById('ySelect')?.value || null;
  const z = document.getElementById('zSelect')?.value || null;
  const dhid = document.getElementById('dhidSelect')?.value || null;
  const claimed = new Set([target, x, y, z, dhid].filter(Boolean));
  const features = DATA.headers.filter(h => !claimed.has(h));
  return { target, x, y, z, dhid, features };
}

// onchange handler on each role <select>. Publishes 'columns' and invalidates
// the current train/test partition (recomputed lazily by the validation panel).
function onColumnRolesChanged() {
  publish('columns', getColumnRoles());
}
