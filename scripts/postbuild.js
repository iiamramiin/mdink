// After `neu build`, collect a clean portable Windows package in dist/mdink-win/
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const built = path.join(root, 'dist', 'mdink', 'mdink-win_x64.exe');
const outDir = path.join(root, 'dist', 'mdink-win');

if (!fs.existsSync(built)) {
  console.error('postbuild: ' + built + ' not found (did `neu update` download the binaries?)');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(built, path.join(outDir, 'mdink.exe'));
for (const f of fs.readdirSync(path.join(root, 'windows'))) {
  fs.copyFileSync(path.join(root, 'windows', f), path.join(outDir, f));
}
console.log('postbuild: portable app ready in dist/mdink-win/');
