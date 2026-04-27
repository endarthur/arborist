// Arborist concat build.
// Reads src/index.html, resolves <!-- INLINE: path --> tokens against src/,
// writes the result to ./index.html at the repo root. Root index.html is
// the canonical single-file artifact: opens from file://, served as-is by
// GitHub Pages, USB-stickable. The src/ tree is the editable source.
//
// Also produces the standalone-viewer template (src/viewer-template.html
// → resolved against src/) and embeds it as a base64-encoded <script
// type="text/template" id="viewer-template"> block inside index.html, so
// the "Export → Standalone HTML" action can read the template at runtime
// without a second HTTP request.
const fs = require('fs');
const path = require('path');

const SRC = 'src';
const OUT = 'index.html';

function applyInline(shell) {
  return shell.replace(
    /[ \t]*<!--\s*INLINE:\s*(\S+)\s*-->[ \t]*/g,
    (_, rel) => {
      const filePath = path.join(SRC, rel);
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.endsWith('\n')) content = content.slice(0, -1);
      return content;
    }
  );
}

// Build the viewer template first — the result still has the <!-- TITLE -->
// and <!-- PAYLOAD --> placeholders intact (those are filled at export time).
const viewerShell = fs.readFileSync(path.join(SRC, 'viewer-template.html'), 'utf8');
const viewerResolved = applyInline(viewerShell);
const viewerB64 = Buffer.from(viewerResolved, 'utf8').toString('base64');

// Build the main app
const shell = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const mainResolved = applyInline(shell);

// Embed the viewer template as base64 inside a script-type-template block.
// Base64 avoids any "</script>" collision problems in the embedded HTML.
const viewerScript = `<script type="text/plain" id="viewer-template-b64">${viewerB64}</script>`;
const final = mainResolved.replace('<!-- VIEWER_TEMPLATE_B64 -->', viewerScript);

fs.writeFileSync(OUT, final);

const kb = (final.length / 1024).toFixed(1);
const viewerKb = (viewerResolved.length / 1024).toFixed(1);
console.log(`Built ${OUT}  (${final.length} bytes, ${kb} KB, ${final.split('\n').length} lines)`);
console.log(`Embedded viewer template: ${viewerResolved.length} bytes (${viewerKb} KB raw, ${(viewerB64.length / 1024).toFixed(1)} KB base64)`);
