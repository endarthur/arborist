// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
let DATA = null;
let TREE = null;
let selectedNodeId = null;
let svgZoom = 1;
let currentFilter = null; // { expr: string, fn: Function }
let csvRawText = null; // raw CSV text for re-parsing
let csvConfig = null; // { delimiter, decimalSep, detected: {...} }
const CLASS_COLORS = [
  '#4caf50','#c9a227','#5aadad','#c45e5e','#8a7abf',
  '#bf8a5a','#5abf7a','#bf5a8a','#5a7abf','#afaf4c',
  '#7a5abf','#5abfbf','#bf5a5a','#8abf5a','#5a8abf'
];

const NULL_SENTINELS = new Set([
  '', 'NA', 'NaN', 'na', 'nan', 'N/A', 'n/a', 'null', 'NULL',
  '*', '-', '-999', '-99', '-9999', '-99999',
  '#N/A', 'VOID', 'void', 'None', 'none',
  '-1.0e+32', '-1e+32', '1e+31'
]);

