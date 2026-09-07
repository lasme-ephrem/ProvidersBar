const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const { openNativeLogin } = require('../lib/account-browser.cjs');
const { accounts } = require('../lib/subscription-accounts.cjs');
const { createSubscriptionController } = require('../lib/subscription-controller.cjs');

for (const id of Object.keys(accounts).filter(id=>accounts[id].nativeLogin)) test(`${id} authentication launches an uninstrumented browser; reader only starts after it exits`, async t => {
  const results = path.resolve(__dirname, '../test-results');
  await fs.mkdir(results, { recursive: true });
  const dir = await fs.mkdtemp(path.join(results, 'native-login-'));
  t.after(async () => { assert.equal(path.dirname(dir), results); await fs.rm(dir, { recursive: true, force: true }); });
  const child = new EventEmitter(); let launches = 0, reads = 0, closes = 0;
  child.kill = () => child.emit('exit', 0);
  const browser = await openNativeLogin(dir, id, {
    findBrowser: async () => 'installed-chrome.exe',
    spawn: (exe, args) => {
      assert.equal(exe, 'installed-chrome.exe');
      assert.equal(args.at(-1), accounts[id].url); assert.equal(accounts[id].nativeLogin, true);
      assert.ok(!args.some(arg => /debug|automat|headless|disable-web-security|disable-blink/i.test(arg)));
      assert.ok(args.includes(`--user-data-dir=${path.join(dir, 'account-browsers', id)}`));
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    openReader: async (dataDir, actualId, headless) => {
      launches++; assert.equal(dataDir, dir); assert.equal(actualId, id); assert.equal(headless, true);
      return { readSubscriptionPage: async () => { reads++; return { authenticated: true, windows: [{ label: 'Semaine', remaining: 99, resetAt: null }] }; }, close: async () => { closes++; } };
    },
  });
  assert.equal(browser.isOpen(), true);
  await assert.rejects(browser.readSubscriptionPage(), { code: 'ACCOUNT_LOGIN_PENDING' });
  assert.equal(launches, 0); assert.equal(reads, 0);
  child.emit('exit', 0);
  assert.equal((await browser.readSubscriptionPage()).windows[0].remaining, 99);
  assert.equal(launches, 1); assert.equal(reads, 1);
  await browser.close(); assert.equal(closes, 1); assert.equal(browser.isOpen(), false);
});

test('Controller keeps the sign-in window pending without saving a connection or treating it as expired', async () => {
  let saved = false, ready = false;
  const c = createSubscriptionController({ dataDir: 'test-only', onChange() {}, deleteProfile: async () => {}, onResult: async () => { saved = true; },
    openBrowser: async () => ({ isOpen: () => true, close: async () => {}, readSubscriptionPage: async () => {
      if (!ready) throw Object.assign(new Error('Ferme cette fenêtre après connexion.'), { code: 'ACCOUNT_LOGIN_PENDING' });
      return { authenticated: true, windows: [{ label: 'Semaine', remaining: 99, resetAt: null }] };
    } }),
  });
  try {
    await c.open('openai');
    await assert.rejects(c.read('openai', { automatic: true }), { code: 'ACCOUNT_LOGIN_PENDING' });
    assert.equal(c.info('openai').status, 'waiting'); assert.equal(saved, false);
    ready = true;
    await c.read('openai', { automatic: true });
    assert.equal(saved, true); assert.equal(c.info('openai').status, 'connected');
  } finally { await c.closeAll(); }
});
