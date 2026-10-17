// Fault injection inside Electron. No real credentials or Claude requests.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSeed } = require('../lib/seed.cjs');
const root = path.resolve(__dirname, '..');
let desktop;
async function launch(dataDir) {
  const env = { ...process.env, PROVIDERSBAR_DATA_DIR: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  desktop = await electron.launch({ executablePath: process.env.PROVIDERSBAR_EXECUTABLE || require('electron'), args: process.env.PROVIDERSBAR_EXECUTABLE ? [] : [root], cwd: root, env });
  const page = await desktop.firstWindow();
  await page.waitForSelector('.cards .card');
  return page;
}
async function main() {
  const results = path.join(root, 'test-results');
  await fs.mkdir(results, { recursive: true });
  const dataDir = await fs.mkdtemp(path.join(results, 'claude-smoke-'));
  const initial = createSeed(); initial.settings.autoRefresh = false;
  await fs.writeFile(path.join(dataDir, 'state.json'), JSON.stringify(initial));
  let page = await launch(dataDir);
  await desktop.evaluate(() => {
    const live = process.mainModule.require('./lib/claude-live-usage.cjs');
    const { ClaudeError } = process.mainModule.require('./lib/claude-connection.cjs');
    live.readClaudeLiveUsage = async () => { throw new ClaudeError('auth-required'); };
    live.claudeLiveStatus = () => ({ errorCode: 'auth-required', nextAttemptAt: new Date(Date.now() + 300000).toISOString() });
  });
  await assert.rejects(page.evaluate(() => window.providersBar.enableClaudeLive()), /renouveler/);
  const failed = (await page.evaluate(() => window.providersBar.getState())).providers.find(p => p.id === 'claude');
  assert.equal(failed.accountSession.kind, 'claude-live-local'); assert.equal(failed.snapshot, null);
  assert.equal(failed.claudeSync.errorCode, 'auth-required');
  await page.evaluate(() => openDetail('claude', 'connection'));
  assert.equal(await page.locator('.connection-success').count(), 0);
  assert.match(await page.locator('.dialog-body').innerText(), /Prochaine tentative/);
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(saved.providers.find(p => p.id === 'claude').accountSession.kind, 'claude-live-local');
  await desktop.close(); desktop = null;
  page = await launch(dataDir);
  assert.equal((await page.evaluate(() => window.providersBar.getState())).providers.find(p => p.id === 'claude').accountSession.kind, 'claude-live-local');
  await desktop.evaluate(() => {
    const live = process.mainModule.require('./lib/claude-live-usage.cjs');
    globalThis.claudeClock = Date.now(); globalThis.claudeRequests = 0; globalThis.claudeOffline = false;
    const reader = live.createClaudeLiveReader({ now: () => new Date(globalThis.claudeClock), readToken: async () => 'fixture-only',
      fetchImpl: async () => {
        globalThis.claudeRequests++;
        if (globalThis.claudeOffline) throw new Error('Offline fixture');
        return { status: 200, ok: true, json: async () => ({ five_hour: { utilization: 39, resets_at: '2099-10-02T11:00:00Z' },
          seven_day: { utilization: 46, resets_at: '2099-10-07T08:00:00Z' }, limits: [{ display_name: 'Fable', percent: 39, resets_at: '2099-10-07T08:00:00Z' }] }) };
      } });
    live.readClaudeLiveUsage = reader.read; live.claudeLiveStatus = reader.info;
    live.wakeClaudeLiveUsage = reader.wake; live.claudeCredentialsChanged = reader.credentialsChanged;
  });
  await page.evaluate(() => window.providersBar.verifyAccount('claude'));
  const first = (await page.evaluate(() => window.providersBar.getState())).providers.find(p => p.id === 'claude');
  assert.deepEqual(first.snapshot.quotaWindows.map(w => w.remaining), [61, 54, 61]);
  await page.evaluate(() => openDetail('claude', 'connection'));
  assert.match(await page.locator('.dialog-body').innerText(), /39 % utilisés/);
  assert.equal(await page.locator('.connection-success').count(), 1);
  await page.evaluate(async () => { const s = await window.providersBar.getState(); await window.providersBar.updateSettings({ ...s.settings, autoRefresh: true }); });
  await desktop.evaluate(() => { globalThis.claudeClock += 60000; globalThis.claudeOffline = true; });
  // Date.now drives the app scheduler, the injected clock drives the reader.
  await desktop.evaluate(() => { process.mainModule.require('./lib/claude-live-usage.cjs').claudeLiveStatus = () => ({ nextAttemptAt: null }); });
  await page.waitForFunction(() => Boolean(state.providers.find(p => p.id === 'claude').error));
  const offline = (await page.evaluate(() => window.providersBar.getState())).providers.find(p => p.id === 'claude');
  assert.equal(offline.snapshot.updatedAt, first.snapshot.updatedAt);
  assert.equal(await page.locator('.connection-success').count(), 0);
  await desktop.evaluate(() => { globalThis.claudeClock += 60000; globalThis.claudeOffline = false; });
  await page.waitForFunction(() => !state.providers.find(p => p.id === 'claude').error);
  const recovered = (await page.evaluate(() => window.providersBar.getState())).providers.find(p => p.id === 'claude');
  assert.notEqual(recovered.snapshot.updatedAt, first.snapshot.updatedAt);
  assert.equal(recovered.accountSession.kind, 'claude-live-local');
  assert.equal(await desktop.evaluate(() => globalThis.claudeRequests), 3);
  await page.screenshot({ path: path.join(results, 'claude-recovery.png') });
  const persisted = await fs.readFile(path.join(dataDir, 'state.json'), 'utf8');
  assert.ok(!persisted.includes('fixture-only'));
  await desktop.close(); desktop = null;
  console.log('Claude Electron faults passed: initial failure, persisted opt-in, restart, automatic outage/recovery, used/remaining display, no token persistence.');
}
main().catch(async error => { console.error(error); await desktop?.close().catch(() => {}); process.exitCode = 1; });
