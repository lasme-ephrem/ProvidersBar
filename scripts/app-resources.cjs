const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { copyRuntimeDependencies } = require('./runtime-dependencies.cjs');

// Replace the entire application tree so removed sources cannot survive updates.
// Account data lives beside resources/ and is never copied or removed here.
async function updateAppResources(root, portable) {
  const dist = path.resolve(root, 'dist');
  const relative = path.relative(dist, path.resolve(portable));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Portable must be inside the workspace dist directory.');
  const resources = path.join(portable, 'resources');
  await fs.mkdir(resources, { recursive: true });
  const stage = await fs.mkdtemp(path.join(resources, '.app-build-'));
  const appDir = path.join(resources, 'app');
  const previous = path.join(resources, '.app-previous-' + randomUUID());
  let replaced = false;
  try {
    for (const name of ['main.cjs', 'preload.cjs', 'lib', 'renderer', 'assets', 'docs', 'README.md', 'CHANGELOG.md']) {
      await fs.cp(path.join(root, name), path.join(stage, name), { recursive: true });
    }
    await copyRuntimeDependencies(root, stage);
    const { version } = require(path.join(root, 'package.json'));
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'providersbar', productName: 'ProvidersBar', version, main: 'main.cjs' }));
    try { await fs.rename(appDir, previous); replaced = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await fs.rename(stage, appDir); }
    catch (error) { if (replaced) await fs.rename(previous, appDir); throw error; }
    if (replaced) await fs.rm(previous, { recursive: true, force: true });
  } finally {
    // stage is an absolute, generated child of the verified portable/resources.
    await fs.rm(stage, { recursive: true, force: true });
  }
}
module.exports = { updateAppResources };
