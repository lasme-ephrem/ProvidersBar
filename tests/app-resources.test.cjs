const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { updateAppResources } = require('../scripts/app-resources.cjs');

async function withWorkspace(run, { missingSource } = {}) {
  const projectRoot = await fs.realpath(path.resolve(__dirname, '..'));
  const testResults = path.join(projectRoot, 'test-results');
  await fs.mkdir(testResults, { recursive: true });
  const realTestResults = await fs.realpath(testResults);
  assert.equal(path.relative(projectRoot, realTestResults), 'test-results');

  const root = await fs.mkdtemp(path.join(realTestResults, 'app-resources-'));
  assert.equal(path.dirname(root), realTestResults);
  assert.ok(path.basename(root).startsWith('app-resources-'));
  try {
    const fixture = await createWorkspace(root, { missingSource });
    await run(root, fixture);
  } finally {
    // Only remove the unique directory created above, after resolving and
    // checking that it remains an immediate child of this test's output dir.
    const target = path.resolve(root);
    assert.equal(path.dirname(target), realTestResults);
    assert.ok(path.basename(target).startsWith('app-resources-'));
    await fs.rm(target, { recursive: true, force: true });
  }
}

async function write(root, relative, contents) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

async function createWorkspace(root, { missingSource } = {}) {
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'providersbar-fixture', version: '9.8.7', dependencies: {},
  }));

  const sources = {
    'main.cjs': 'module.exports = "new-main";\n',
    'preload.cjs': 'module.exports = "new-preload";\n',
    'lib/quota-resets.js': 'module.exports = "new-quota-resets";\n',
    'renderer/index.html': '<main>new renderer</main>\n',
    'assets/providers/marker.svg': '<svg>new asset</svg>\n',
    'docs/guide.md': '# New guide\n',
    'README.md': '# New README\n',
    'CHANGELOG.md': '# New release notes\n',
  };
  for (const [relative, contents] of Object.entries(sources)) {
    if (relative.startsWith(`${missingSource}/`)) continue;
    await write(root, relative, contents);
  }

  const portable = path.join(root, 'dist', 'ProvidersBar-win32-x64');
  const oldApp = path.join(portable, 'resources', 'app');
  await write(oldApp, 'main.cjs', 'module.exports = "old-main";\n');
  await write(oldApp, 'package.json', JSON.stringify({ version: '1.0.0' }));
  await write(oldApp, 'obsolete-module.cjs', 'must disappear\n');

  const dataFiles = new Map([
    ['state.json', Buffer.from('{"fixture":"state"}\n')],
    ['credentials.json', Buffer.from('{"fixture":"credentials"}\n')],
    ['account-browsers/profile/session.bin', Buffer.from([0, 1, 2, 255, 0, 42])],
  ]);
  for (const [relative, contents] of dataFiles) await write(portable, `data/${relative}`, contents);
  return { portable, oldApp, dataFiles };
}

async function assertDataUnchanged(portable, dataFiles) {
  for (const [relative, expected] of dataFiles) {
    assert.deepEqual(await fs.readFile(path.join(portable, 'data', relative)), expected, relative);
  }
}

test('resource replacement removes stale app files and preserves portable account data byte-for-byte', async () => {
  await withWorkspace(async (root, { portable, dataFiles }) => {
    await updateAppResources(root, portable);

    const app = path.join(portable, 'resources', 'app');
    assert.equal(await fs.readFile(path.join(app, 'main.cjs'), 'utf8'), 'module.exports = "new-main";\n');
    assert.equal(await fs.readFile(path.join(app, 'lib', 'quota-resets.js'), 'utf8'), 'module.exports = "new-quota-resets";\n');
    assert.equal(await fs.readFile(path.join(app, 'renderer', 'index.html'), 'utf8'), '<main>new renderer</main>\n');
    assert.equal(await fs.readFile(path.join(app, 'assets', 'providers', 'marker.svg'), 'utf8'), '<svg>new asset</svg>\n');
    assert.equal(await fs.readFile(path.join(app, 'docs', 'guide.md'), 'utf8'), '# New guide\n');
    assert.equal(await fs.readFile(path.join(app, 'README.md'), 'utf8'), '# New README\n');
    assert.equal(await fs.readFile(path.join(app, 'CHANGELOG.md'), 'utf8'), '# New release notes\n');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(app, 'package.json'), 'utf8')), {
      name: 'providersbar', productName: 'ProvidersBar', version: '9.8.7', main: 'main.cjs',
    });
    await assert.rejects(fs.access(path.join(app, 'obsolete-module.cjs')), { code: 'ENOENT' });
    await assertDataUnchanged(portable, dataFiles);
  });
});

test('a missing staging source leaves the installed app and portable data untouched', async () => {
  await withWorkspace(async (root, { portable, oldApp, dataFiles }) => {
    const oldMain = await fs.readFile(path.join(oldApp, 'main.cjs'));
    const oldPackage = await fs.readFile(path.join(oldApp, 'package.json'));
    const oldObsolete = await fs.readFile(path.join(oldApp, 'obsolete-module.cjs'));

    await assert.rejects(updateAppResources(root, portable), { code: 'ENOENT' });

    assert.deepEqual(await fs.readFile(path.join(oldApp, 'main.cjs')), oldMain);
    assert.deepEqual(await fs.readFile(path.join(oldApp, 'package.json')), oldPackage);
    assert.deepEqual(await fs.readFile(path.join(oldApp, 'obsolete-module.cjs')), oldObsolete);
    await assertDataUnchanged(portable, dataFiles);
  }, { missingSource: 'docs' });
});

test('resource replacement rejects a portable output outside the workspace dist directory', async () => {
  await withWorkspace(async root => {
    const outside = path.join(root, 'portable-outside-dist');
    await assert.rejects(updateAppResources(root, outside), /inside the workspace dist directory/);
    await assert.rejects(fs.access(outside), { code: 'ENOENT' });
  });
});
