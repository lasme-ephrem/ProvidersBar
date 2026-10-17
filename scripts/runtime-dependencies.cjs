const fs = require('node:fs/promises');
const path = require('node:path');

// Ship the exact installed production dependency tree, including nested versions.
async function copyRuntimeDependencies(root, appDir) {
  const visited = new Set();
  async function copy(name, from) {
    const manifest = require.resolve(name + '/package.json', { paths: [from] });
    const dir = path.dirname(manifest);
    if (visited.has(dir)) return;
    visited.add(dir);
    const relative = path.relative(root, dir);
    if (!relative.startsWith('node_modules' + path.sep) || relative.includes('..' + path.sep)) throw new Error('Runtime dependency outside the workspace.');
    await fs.cp(dir, path.join(appDir, relative), { recursive: true });
    for (const child of Object.keys(require(manifest).dependencies || {})) await copy(child, dir);
  }
  for (const name of Object.keys(require(path.join(root, 'package.json')).dependencies || {})) await copy(name, root);
}
module.exports = { copyRuntimeDependencies };
