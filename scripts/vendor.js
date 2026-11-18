// Copies third-party browser bundles from node_modules into resources/vendor.
// Run with: npm run vendor
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const nm = (p) => path.join(root, 'node_modules', p);
const out = (p) => path.join(root, 'resources', 'vendor', p);

const files = {
  'marked.umd.js': 'marked/lib/marked.umd.js',
  'marked-alert.umd.js': 'marked-alert/dist/index.umd.js',
  'marked-footnote.umd.js': 'marked-footnote/dist/index.umd.js',
  'marked-katex.umd.js': 'marked-katex-extension/lib/index.umd.js',
  'purify.min.js': 'dompurify/dist/purify.min.js',
  'highlight.min.js': '@highlightjs/cdn-assets/highlight.min.js',
  'hljs-github.min.css': '@highlightjs/cdn-assets/styles/github.min.css',
  'hljs-github-dark.min.css': '@highlightjs/cdn-assets/styles/github-dark.min.css',
  'mermaid.min.js': 'mermaid/dist/mermaid.min.js',
  'katex/katex.min.js': 'katex/dist/katex.min.js',
  'katex/katex.min.css': 'katex/dist/katex.min.css',
  'fonts/vazirmatn-arabic.woff2': '@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2',
  'fonts/vazirmatn-latin.woff2': '@fontsource-variable/vazirmatn/files/vazirmatn-latin-wght-normal.woff2',
  'fonts/vazirmatn-latin-ext.woff2': '@fontsource-variable/vazirmatn/files/vazirmatn-latin-ext-wght-normal.woff2'
};

fs.rmSync(out(''), { recursive: true, force: true });
for (const [dest, src] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(out(dest)), { recursive: true });
  fs.copyFileSync(nm(src), out(dest));
}

// KaTeX fonts: woff2 only (every WebView2/Chromium supports it)
const kfonts = nm('katex/dist/fonts');
fs.mkdirSync(out('katex/fonts'), { recursive: true });
for (const f of fs.readdirSync(kfonts).filter((f) => f.endsWith('.woff2'))) {
  fs.copyFileSync(path.join(kfonts, f), out('katex/fonts/' + f));
}

// Neutralino client library (same version as the binary)
fs.copyFileSync(nm('@neutralinojs/lib/dist/neutralino.js'), path.join(root, 'resources', 'js', 'neutralino.js'));

console.log('vendor: copied', Object.keys(files).length, 'files + KaTeX fonts + neutralino.js');
