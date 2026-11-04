const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const {
  DEFAULT_ACCOUNT_ORIGINS, originOf, normalizeAllowlist, isAllowedOrigin,
  secureWindow, secureAccountWindow, applyDataDirAcl, purgeLeftovers,
} = require('../lib/window-security.cjs');

async function withTestDir(prefix, run) {
  const projectRoot = await fs.realpath(path.resolve(__dirname, '..'));
  const results = path.join(projectRoot, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const realResults = await fs.realpath(results);
  const dir = await fs.mkdtemp(path.join(realResults, prefix));
  assert.equal(path.dirname(dir), realResults);
  try { return await run(dir); }
  finally {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), realResults);
    assert.ok(path.basename(target).startsWith(prefix));
    await fs.rm(target, { recursive: true, force: true });
  }
}

function fakeWindow() {
  const contents = new EventEmitter();
  contents.session = new EventEmitter();
  contents.openHandler = null;
  contents.setWindowOpenHandler = handler => { contents.openHandler = handler; };
  contents.closeDevTools = () => { contents.devtoolsClosed = (contents.devtoolsClosed || 0) + 1; };
  contents.session.permissionRequest = null;
  contents.session.permissionCheck = null;
  contents.session.setPermissionRequestHandler = handler => { contents.session.permissionRequest = handler; };
  contents.session.setPermissionCheckHandler = handler => { contents.session.permissionCheck = handler; };
  return { webContents: contents };
}

function navigationEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

test('origins are normalized strictly to HTTPS and compared exactly', () => {
  assert.equal(originOf('https://grok.com/dashboard?x=1'), 'https://grok.com');
  assert.equal(originOf('http://grok.com'), 'http://grok.com');
  assert.equal(originOf('not a url'), null);
  assert.equal(originOf(undefined), null);
  const allowlist = normalizeAllowlist(['https://grok.com/path', 'http://claude.ai', 'https://accounts.google.com', 'javascript:alert(1)', null]);
  assert.deepEqual([...allowlist], ['https://grok.com', 'https://accounts.google.com']);
  assert.equal(isAllowedOrigin('https://grok.com/dashboard', allowlist), true);
  assert.equal(isAllowedOrigin('https://grok.com.evil.test/', allowlist), false);
  assert.equal(isAllowedOrigin('http://grok.com/', allowlist), false);
  assert.equal(isAllowedOrigin('https://claude.ai/', allowlist), false);
  assert.equal(isAllowedOrigin('data:text/html,<script>1</script>', allowlist), false);
  assert.deepEqual([...normalizeAllowlist(DEFAULT_ACCOUNT_ORIGINS)], ['https://accounts.google.com']);
});

test('UI windows deny navigation, popups and permissions', () => {
  const win = fakeWindow();
  secureWindow(win);
  const { webContents } = win;
  assert.deepEqual(webContents.openHandler({ url: 'https://example.test' }), { action: 'deny' });
  const event = navigationEvent();
  webContents.emit('will-navigate', event, 'https://example.test/');
  assert.equal(event.prevented, true);
  let requested = null;
  webContents.session.permissionRequest({}, 'notifications', value => { requested = value; });
  assert.equal(requested, false);
  assert.equal(webContents.session.permissionCheck({}, 'geolocation'), false);
  webContents.emit('devtools-opened');
  assert.equal(webContents.devtoolsClosed, 1);
  assert.equal(secureWindow(undefined), undefined);
  assert.doesNotThrow(() => secureWindow({}));
});

test('account windows only allow the explicit origin allowlist for navigation, redirects and popups', () => {
  const win = fakeWindow();
  const allowlist = ['https://grok.com', 'https://accounts.google.com', 'http://insecure.test'];
  secureAccountWindow(win, allowlist);
  const { webContents } = win;

  const sameOrigin = navigationEvent();
  webContents.emit('will-navigate', sameOrigin, 'https://grok.com/dashboard');
  assert.equal(sameOrigin.prevented, false);
  const thirdParty = navigationEvent();
  webContents.emit('will-navigate', thirdParty, 'https://evil.test/');
  assert.equal(thirdParty.prevented, true);
  const insecure = navigationEvent();
  webContents.emit('will-redirect', insecure, 'http://grok.com/');
  assert.equal(insecure.prevented, true);
  const google = navigationEvent();
  webContents.emit('will-redirect', google, 'https://accounts.google.com/signin');
  assert.equal(google.prevented, false);

  const popup = webContents.openHandler({ url: 'https://accounts.google.com/o/oauth2' });
  assert.equal(popup.action, 'allow');
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.nodeIntegration, false);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.contextIsolation, true);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.sandbox, true);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.devTools, false);
  assert.equal(popup.overrideBrowserWindowOptions.webPreferences.session, webContents.session);
  assert.deepEqual(webContents.openHandler({ url: 'https://evil.test/popup' }), { action: 'deny' });
  assert.deepEqual(webContents.openHandler({ url: 'http://grok.com/popup' }), { action: 'deny' });
});

test('popups created by an account window are secured with the same allowlist', () => {
  const win = fakeWindow();
  secureAccountWindow(win, ['https://grok.com']);
  const child = fakeWindow();
  win.webContents.emit('did-create-window', child);
  const event = navigationEvent();
  child.webContents.emit('will-navigate', event, 'https://evil.test/');
  assert.equal(event.prevented, true);
  assert.deepEqual(child.webContents.openHandler({ url: 'https://evil.test/' }), { action: 'deny' });
});

test('default account allowlist contains only the shared Google login origin', () => {
  const win = fakeWindow();
  secureAccountWindow(win);
  const event = navigationEvent();
  win.webContents.emit('will-navigate', event, 'https://accounts.google.com/');
  assert.equal(event.prevented, false);
  const other = navigationEvent();
  win.webContents.emit('will-navigate', other, 'https://claude.ai/');
  assert.equal(other.prevented, true);
});

test('data directory ACL grants the current user and SYSTEM, and never blocks startup on failure', async () => {
  const calls = [];
  const ok = await applyDataDirAcl('C:\\tmp\\lasmium-data', {
    platform: 'win32', account: 'DESKTOP-TEST\\lasme',
    run: async args => { calls.push(args); return { stdout: 'Success', stderr: '' }; },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.account, 'DESKTOP-TEST\\lasme');
  assert.equal(calls.length, 1);
  const [dir, inheritance, grantSwitch, userGrant, systemGrant] = calls[0];
  assert.equal(dir, 'C:\\tmp\\lasmium-data');
  assert.equal(inheritance, '/inheritance:r');
  assert.equal(grantSwitch, '/grant:r');
  assert.equal(userGrant, 'DESKTOP-TEST\\lasme:(OI)(CI)F');
  assert.equal(systemGrant, 'SYSTEM:(OI)(CI)F');

  const warnings = [];
  const failed = await applyDataDirAcl('C:\\tmp\\lasmium-data', {
    platform: 'win32', run: async () => { throw new Error('accès refusé'); },
    logger: { warn: message => warnings.push(message) },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.skipped, undefined);
  assert.match(failed.warning, /accès refusé/);
  assert.equal(warnings.length, 1);

  const skipped = await applyDataDirAcl('/tmp/data', { platform: 'linux', run: async () => { throw new Error('ne doit pas être appelé'); } });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.ok, false);
});

test('leftovers purge removes temp files, stale diagnostic port and old backups while keeping the most recent two', async () => {
  await withTestDir('window-security-', async dir => {
    const write = async (name, contents = '{}') => fs.writeFile(path.join(dir, name), contents);
    await write('state.json', '{"fixture":"state"}');
    await write('credentials.json', '{"fixture":"credentials"}');
    await write('state.json.tmp', 'interrupted');
    await write('credentials.json.tmp', 'interrupted');
    await write('DevToolsActivePort', '9222\n/devtools/browser/abc');
    for (const [index, name] of ['state.before-oldest.json', 'state.before-old.json', 'state.before-recent.json', 'state.before-latest.json'].entries()) {
      await write(name);
      const stamp = new Date(Date.now() - (10 - index) * 1000);
      await fs.utimes(path.join(dir, name), stamp, stamp);
    }
    await fs.mkdir(path.join(dir, 'temporary-account-browsers', 'orphan'), { recursive: true });
    await fs.writeFile(path.join(dir, 'temporary-account-browsers', 'orphan', 'profile.bin'), 'x');

    const summary = await purgeLeftovers(dir);

    assert.deepEqual((await fs.readdir(dir)).sort(), [
      'credentials.json', 'state.before-latest.json', 'state.before-recent.json', 'state.json',
    ]);
    assert.equal(summary.keptBackups, 2);
    assert.ok(summary.removed.includes('state.json.tmp'));
    assert.ok(summary.removed.includes('DevToolsActivePort'));
    assert.ok(summary.removed.includes('temporary-account-browsers'));
    assert.deepEqual(summary.warnings, []);
  });
});

test('leftovers purge preserves the diagnostic port file and delegates temporary profiles when available', async () => {
  await withTestDir('window-security-', async dir => {
    await fs.writeFile(path.join(dir, 'DevToolsActivePort'), '9222\n/devtools/browser/abc');
    await fs.mkdir(path.join(dir, 'temporary-account-browsers', 'orphan'), { recursive: true });
    const delegated = [];
    const summary = await purgeLeftovers(dir, {
      preserveDevToolsPort: true,
      sweepTemporaryProfiles: async target => { delegated.push(target); },
    });
    assert.deepEqual(delegated, [dir]);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['DevToolsActivePort', 'temporary-account-browsers']);
    assert.deepEqual(summary.warnings, []);

    const missing = await purgeLeftovers(path.join(dir, 'absent'));
    assert.deepEqual(missing.removed, []);
    assert.deepEqual(missing.warnings, []);
  });
});
