// Arborist concat build.
// Reads src/index.html, resolves <!-- INLINE: path --> tokens against src/,
// writes dist/arborist.html as a single self-contained HTML file.
const fs = require('fs');
const path = require('path');

const SRC = 'src';
const DIST = 'dist';
const OUT = path.join(DIST, 'arborist.html');

const shell = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const output = shell.replace(
  /[ \t]*<!--\s*INLINE:\s*(\S+)\s*-->[ \t]*/g,
  (_, rel) => {
    const filePath = path.join(SRC, rel);
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.endsWith('\n')) content = content.slice(0, -1);
    return content;
  }
);

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, output);

const kb = (output.length / 1024).toFixed(1);
console.log(`Built ${OUT}  (${output.length} bytes, ${kb} KB, ${output.split('\n').length} lines)`);
