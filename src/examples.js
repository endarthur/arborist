// ═══════════════════════════════════════
//  EXAMPLE DATASETS
// ═══════════════════════════════════════
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function generateIronOre() {
  const rows = [];
  const rng = mulberry32(42);
  function r(min, max) { return min + rng() * (max - min); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  for (let i = 0; i < 200; i++) {
    const depth = r(0, 150);
    let weathering, domain, fe, sio2, al2o3, mn, loi, mag;

    if (depth < 30) {
      weathering = pick(['oxide','oxide','oxide','transition']);
      if (weathering === 'oxide') {
        fe = clamp(r(58,68)+r(-3,3),40,70); sio2 = clamp(r(1,5)+r(-1,1),0.5,15);
        al2o3 = clamp(r(1,4),0.5,8); mn = clamp(r(0.1,0.8),0,2);
        loi = clamp(r(2,6),0,12); mag = clamp(r(5,25),0,50);
        domain = fe > 62 ? 'HG_oxide' : 'MG_oxide';
      } else {
        fe = clamp(r(45,58),30,65); sio2 = clamp(r(5,15),1,25);
        al2o3 = clamp(r(3,8),1,12); mn = clamp(r(0.3,1.5),0,3);
        loi = clamp(r(4,9),0,15); mag = clamp(r(15,40),0,60);
        domain = 'transition';
      }
    } else if (depth < 70) {
      weathering = pick(['transition','transition','fresh','oxide']);
      if (weathering === 'oxide') {
        fe = clamp(r(55,65),40,70); sio2 = clamp(r(2,8),0.5,15);
        al2o3 = clamp(r(1,5),0.5,10); mn = clamp(r(0.2,1),0,2);
        loi = clamp(r(3,7),0,12); mag = clamp(r(8,30),0,50);
        domain = fe > 60 ? 'HG_oxide' : 'MG_oxide';
      } else if (weathering === 'transition') {
        fe = clamp(r(40,55),30,65); sio2 = clamp(r(8,20),2,30);
        al2o3 = clamp(r(4,10),1,15); mn = clamp(r(0.5,2),0,4);
        loi = clamp(r(5,10),0,15); mag = clamp(r(20,50),5,70);
        domain = 'transition';
      } else {
        fe = clamp(r(30,45),20,55); sio2 = clamp(r(20,40),10,50);
        al2o3 = clamp(r(5,12),2,18); mn = clamp(r(0.1,0.5),0,2);
        loi = clamp(r(1,4),0,8); mag = clamp(r(30,70),10,90);
        domain = 'fresh';
      }
    } else {
      weathering = pick(['fresh','fresh','fresh','transition']);
      fe = clamp(r(25,42),15,55); sio2 = clamp(r(25,50),10,60);
      al2o3 = clamp(r(5,14),2,20); mn = clamp(r(0.05,0.4),0,1);
      loi = clamp(r(0.5,3),0,6); mag = clamp(r(40,80),20,100);
      domain = weathering === 'transition' ? 'transition' : 'fresh';
    }
    if (rng() < 0.05) {
      domain = 'contaminant'; sio2 = clamp(r(40,60),30,70); fe = clamp(r(15,30),10,40);
    }
    rows.push([depth.toFixed(1),fe.toFixed(1),sio2.toFixed(1),al2o3.toFixed(1),mn.toFixed(2),loi.toFixed(1),mag.toFixed(0),weathering,domain]);
  }
  // Brazilian Excel style: semicolon delimiter, comma decimal
  return 'depth_m;Fe_pct;SiO2_pct;Al2O3_pct;Mn_pct;LOI_pct;mag_sus;weathering;domain\n' +
    rows.map(r => r.map(v => typeof v === 'string' && !isNaN(parseFloat(v)) ? v.replace('.', ',') : v).join(';')).join('\n');
}

function generateRockType() {
  const rows = [], rng = mulberry32(123);
  function r(min, max) { return min + rng() * (max - min); }
  const templates = {
    basalt:   { SiO2:[45,52],TiO2:[0.8,2.5],Al2O3:[14,18],Fe2O3:[8,14],MgO:[5,10],CaO:[8,12],Na2O:[2,3.5],K2O:[0.2,1.5] },
    andesite: { SiO2:[52,63],TiO2:[0.5,1.5],Al2O3:[15,19],Fe2O3:[4,9],MgO:[2,5],CaO:[4,8],Na2O:[3,5],K2O:[1,3] },
    dacite:   { SiO2:[63,70],TiO2:[0.3,0.8],Al2O3:[14,17],Fe2O3:[2,5],MgO:[1,3],CaO:[2,5],Na2O:[3.5,5],K2O:[1.5,4] },
    rhyolite: { SiO2:[70,78],TiO2:[0.05,0.4],Al2O3:[11,15],Fe2O3:[0.5,3],MgO:[0.1,1],CaO:[0.3,2],Na2O:[3,5],K2O:[3,6] },
  };
  for (const [rock, t] of Object.entries(templates)) {
    for (let i = 0; i < 40; i++) {
      const row = [];
      for (const [, [lo, hi]] of Object.entries(t)) row.push(r(lo, hi).toFixed(2));
      row.push(rock); rows.push(row);
    }
  }
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  // Tab-delimited (common copy-paste from spreadsheets)
  return 'SiO2_pct\tTiO2_pct\tAl2O3_pct\tFe2O3_pct\tMgO_pct\tCaO_pct\tNa2O_pct\tK2O_pct\trock_type\n' + rows.map(r => r.join('\t')).join('\n');
}

function generateIris() {
  const d = [
    [5.1,3.5,1.4,0.2,'setosa'],[4.9,3.0,1.4,0.2,'setosa'],[4.7,3.2,1.3,0.2,'setosa'],
    [4.6,3.1,1.5,0.2,'setosa'],[5.0,3.6,1.4,0.2,'setosa'],[5.4,3.9,1.7,0.4,'setosa'],
    [4.6,3.4,1.4,0.3,'setosa'],[5.0,3.4,1.5,0.2,'setosa'],[4.4,2.9,1.4,0.2,'setosa'],
    [4.9,3.1,1.5,0.1,'setosa'],[5.4,3.7,1.5,0.2,'setosa'],[4.8,3.4,1.6,0.2,'setosa'],
    [4.8,3.0,1.4,0.1,'setosa'],[4.3,3.0,1.1,0.1,'setosa'],[5.8,4.0,1.2,0.2,'setosa'],
    [5.7,4.4,1.5,0.4,'setosa'],[5.4,3.9,1.3,0.4,'setosa'],[5.1,3.5,1.4,0.3,'setosa'],
    [5.7,3.8,1.7,0.3,'setosa'],[5.1,3.8,1.5,0.3,'setosa'],[5.4,3.4,1.7,0.2,'setosa'],
    [5.1,3.7,1.5,0.4,'setosa'],[4.6,3.6,1.0,0.2,'setosa'],[5.1,3.3,1.7,0.5,'setosa'],
    [4.8,3.4,1.9,0.2,'setosa'],[5.0,3.0,1.6,0.2,'setosa'],[5.0,3.4,1.6,0.4,'setosa'],
    [5.2,3.5,1.5,0.2,'setosa'],[5.2,3.4,1.4,0.2,'setosa'],[4.7,3.2,1.6,0.2,'setosa'],
    [4.8,3.1,1.6,0.2,'setosa'],[5.4,3.4,1.5,0.4,'setosa'],[5.2,4.1,1.5,0.1,'setosa'],
    [5.5,4.2,1.4,0.2,'setosa'],[4.9,3.1,1.5,0.2,'setosa'],[5.0,3.2,1.2,0.2,'setosa'],
    [5.5,3.5,1.3,0.2,'setosa'],[4.9,3.6,1.4,0.1,'setosa'],[4.4,3.0,1.3,0.2,'setosa'],
    [5.1,3.4,1.5,0.2,'setosa'],[5.0,3.5,1.3,0.3,'setosa'],[4.5,2.3,1.3,0.3,'setosa'],
    [4.4,3.2,1.3,0.2,'setosa'],[5.0,3.5,1.6,0.6,'setosa'],[5.1,3.8,1.9,0.4,'setosa'],
    [4.8,3.0,1.4,0.3,'setosa'],[5.1,3.8,1.6,0.2,'setosa'],[4.6,3.2,1.4,0.2,'setosa'],
    [5.3,3.7,1.5,0.2,'setosa'],[5.0,3.3,1.4,0.2,'setosa'],
    [7.0,3.2,4.7,1.4,'versicolor'],[6.4,3.2,4.5,1.5,'versicolor'],[6.9,3.1,4.9,1.5,'versicolor'],
    [5.5,2.3,4.0,1.3,'versicolor'],[6.5,2.8,4.6,1.5,'versicolor'],[5.7,2.8,4.5,1.3,'versicolor'],
    [6.3,3.3,4.7,1.6,'versicolor'],[4.9,2.4,3.3,1.0,'versicolor'],[6.6,2.9,4.6,1.3,'versicolor'],
    [5.2,2.7,3.9,1.4,'versicolor'],[5.0,2.0,3.5,1.0,'versicolor'],[5.9,3.0,4.2,1.5,'versicolor'],
    [6.0,2.2,4.0,1.0,'versicolor'],[6.1,2.9,4.7,1.4,'versicolor'],[5.6,2.9,3.6,1.3,'versicolor'],
    [6.7,3.1,4.4,1.4,'versicolor'],[5.6,3.0,4.5,1.5,'versicolor'],[5.8,2.7,4.1,1.0,'versicolor'],
    [6.2,2.2,4.5,1.5,'versicolor'],[5.6,2.5,3.9,1.1,'versicolor'],[5.9,3.2,4.8,1.8,'versicolor'],
    [6.1,2.8,4.0,1.3,'versicolor'],[6.3,2.5,4.9,1.5,'versicolor'],[6.1,2.8,4.7,1.2,'versicolor'],
    [6.4,2.9,4.3,1.3,'versicolor'],[6.6,3.0,4.4,1.4,'versicolor'],[6.8,2.8,4.8,1.4,'versicolor'],
    [6.7,3.0,5.0,1.7,'versicolor'],[6.0,2.9,4.5,1.5,'versicolor'],[5.7,2.6,3.5,1.0,'versicolor'],
    [5.5,2.4,3.8,1.1,'versicolor'],[5.5,2.4,3.7,1.0,'versicolor'],[5.8,2.7,3.9,1.2,'versicolor'],
    [6.0,2.7,5.1,1.6,'versicolor'],[5.4,3.0,4.5,1.5,'versicolor'],[6.0,3.4,4.5,1.6,'versicolor'],
    [6.7,3.1,4.7,1.5,'versicolor'],[6.3,2.3,4.4,1.3,'versicolor'],[5.6,3.0,4.1,1.3,'versicolor'],
    [5.5,2.5,4.0,1.3,'versicolor'],[5.5,2.6,4.4,1.2,'versicolor'],[6.1,3.0,4.6,1.4,'versicolor'],
    [5.8,2.6,4.0,1.2,'versicolor'],[5.0,2.3,3.3,1.0,'versicolor'],[5.6,2.7,4.2,1.3,'versicolor'],
    [5.7,3.0,4.2,1.2,'versicolor'],[5.7,2.9,4.2,1.3,'versicolor'],[6.2,2.9,4.3,1.3,'versicolor'],
    [5.1,2.5,3.0,1.1,'versicolor'],[5.7,2.8,4.1,1.3,'versicolor'],
    [6.3,3.3,6.0,2.5,'virginica'],[5.8,2.7,5.1,1.9,'virginica'],[7.1,3.0,5.9,2.1,'virginica'],
    [6.3,2.9,5.6,1.8,'virginica'],[6.5,3.0,5.8,2.2,'virginica'],[7.6,3.0,6.6,2.1,'virginica'],
    [4.9,2.5,4.5,1.7,'virginica'],[7.3,2.9,6.3,1.8,'virginica'],[6.7,2.5,5.8,1.8,'virginica'],
    [7.2,3.6,6.1,2.5,'virginica'],[6.5,3.2,5.1,2.0,'virginica'],[6.4,2.7,5.3,1.9,'virginica'],
    [6.8,3.0,5.5,2.1,'virginica'],[5.7,2.5,5.0,2.0,'virginica'],[5.8,2.8,5.1,2.4,'virginica'],
    [6.4,3.2,5.3,2.3,'virginica'],[6.5,3.0,5.5,1.8,'virginica'],[7.7,3.8,6.7,2.2,'virginica'],
    [7.7,2.6,6.9,2.3,'virginica'],[6.0,2.2,5.0,1.5,'virginica'],[6.9,3.2,5.7,2.3,'virginica'],
    [5.6,2.8,4.9,2.0,'virginica'],[7.7,2.8,6.7,2.0,'virginica'],[6.3,2.7,4.9,1.8,'virginica'],
    [6.7,3.3,5.7,2.1,'virginica'],[7.2,3.2,6.0,1.8,'virginica'],[6.2,2.8,4.8,1.8,'virginica'],
    [6.1,3.0,4.9,1.8,'virginica'],[6.4,2.8,5.6,2.1,'virginica'],[7.2,3.0,5.8,1.6,'virginica'],
    [7.4,2.8,6.1,1.9,'virginica'],[7.9,3.8,6.4,2.0,'virginica'],[6.4,2.8,5.6,2.2,'virginica'],
    [6.3,2.8,5.1,1.5,'virginica'],[6.1,2.6,5.6,1.4,'virginica'],[7.7,3.0,6.1,2.3,'virginica'],
    [6.3,3.4,5.6,2.4,'virginica'],[6.4,3.1,5.5,1.8,'virginica'],[6.0,3.0,4.8,1.8,'virginica'],
    [6.9,3.1,5.4,2.1,'virginica'],[6.7,3.1,5.6,2.4,'virginica'],[6.9,3.1,5.1,2.3,'virginica'],
    [5.8,2.7,5.1,1.9,'virginica'],[6.8,3.2,5.9,2.3,'virginica'],[6.7,3.3,5.7,2.5,'virginica'],
    [6.7,3.0,5.2,2.3,'virginica'],[6.3,2.5,5.0,1.9,'virginica'],[6.5,3.0,5.2,2.0,'virginica'],
    [6.2,3.4,5.4,2.3,'virginica'],[5.9,3.0,5.1,1.8,'virginica'],
  ];
  return 'sepal_length,sepal_width,petal_length,petal_width,species\n' + d.map(r => r.join(',')).join('\n');
}

function generatePorphyry() {
  // Synthetic Cu-porphyry dataset: 15 drillholes in a 5×3 grid centred on a
  // radial porphyry system. Domains form concentric shells — core holes
  // penetrate oxide → supergene → hypogene; holes further out see only
  // oxide and propylitic alteration. Good for demonstrating column roles,
  // drillhole-grouped CV, and (once 3D scatter lands) spatial structure.
  const rng = mulberry32(777);
  const r = (lo, hi) => lo + rng() * (hi - lo);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const cx = 100, cy = 50;
  const holes = [];
  let hid = 1;
  for (const x of [0, 50, 100, 150, 200]) {
    for (const y of [0, 50, 100]) {
      const dist = Math.hypot(x - cx, y - cy);
      holes.push({
        id: `DH${String(hid).padStart(2, '0')}`,
        x, y, dist,
        to: dist < 75 ? 40 : 28,   // core holes drilled deeper
      });
      hid++;
    }
  }

  const rows = [];
  for (const h of holes) {
    const inCore = h.dist < 55;
    const inHalo = h.dist < 95;
    for (let d = 2; d <= h.to; d += 2) {
      const z = -d;
      let domain, cu, mo, au, s, fe;
      if (d < 7) {
        // Oxide cap across the whole system
        domain = 'oxide';
        const coreBoost = inCore ? 0.3 : (inHalo ? 0.15 : 0);
        cu = clamp(r(0.1, 0.5) + coreBoost, 0, 1.5);
        mo = clamp(r(5, 25), 0, 80);
        au = clamp(r(0.02, 0.12), 0, 0.4);
        s  = clamp(r(0.1, 0.5), 0, 2);
        fe = clamp(r(4, 8), 2, 15);
      } else if (inCore && d < 16) {
        domain = 'supergene';
        cu = clamp(r(0.8, 2.0), 0.3, 3);
        mo = clamp(r(30, 90), 5, 150);
        au = clamp(r(0.1, 0.4), 0, 1);
        s  = clamp(r(0.8, 2.5), 0.2, 4);
        fe = clamp(r(5, 9), 3, 12);
      } else if (inCore) {
        domain = 'hypogene';
        cu = clamp(r(0.4, 1.2), 0.1, 2);
        mo = clamp(r(60, 150), 10, 250);
        au = clamp(r(0.05, 0.3), 0, 0.8);
        s  = clamp(r(2.0, 4.5), 1, 6);
        fe = clamp(r(6, 10), 3, 15);
      } else {
        // Halo and far field are propylitic — background metals
        domain = 'propylitic';
        const halo = inHalo ? 1 : 0.5;
        cu = clamp(r(0.02, 0.25) * halo, 0, 0.5);
        mo = clamp(r(2, 20) * halo, 0, 40);
        au = clamp(r(0.01, 0.1) * halo, 0, 0.25);
        s  = clamp(r(0.1, 1.0), 0, 2);
        fe = clamp(r(3, 6), 1, 10);
      }
      rows.push([h.id, h.x.toFixed(1), h.y.toFixed(1), z.toFixed(1), d.toFixed(1),
                 cu.toFixed(3), mo.toFixed(1), au.toFixed(3), s.toFixed(2), fe.toFixed(2),
                 domain]);
    }
  }
  return 'dhid,x,y,z,depth,Cu_pct,Mo_ppm,Au_ppm,S_pct,Fe_pct,domain\n' +
    rows.map(r => r.join(',')).join('\n');
}

const EXAMPLE_DATA = {
  ironore: generateIronOre(),
  rocktype: generateRockType(),
  iris: generateIris(),
  porphyry: generatePorphyry(),
};

function loadExample(name) {
  loadData(EXAMPLE_DATA[name]);
  const nameMap = { ironore: 'Iron Ore Domains', rocktype: 'Rock Type', iris: 'Iris', porphyry: 'Cu Porphyry' };
  DATA._name = nameMap[name] || name;
  const presets = {
    ironore: { target: 'domain', depth: 5, minLeaf: 3, minSplit: 6 },
    rocktype: { target: 'rock_type', depth: 4, minLeaf: 3, minSplit: 6 },
    iris: { target: 'species', depth: 4, minLeaf: 3, minSplit: 6 },
    porphyry: { target: 'domain', depth: 5, minLeaf: 2, minSplit: 4 },
  };
  const p = presets[name];
  if (p) {
    document.getElementById('targetSelect').value = p.target;
    document.getElementById('maxDepth').value = p.depth;
    document.getElementById('minLeaf').value = p.minLeaf;
    document.getElementById('minSplit').value = p.minSplit;
  }
  growTree();
  setTimeout(zoomFit, 50);
  showToast(`Loaded example: ${name}`);
}

