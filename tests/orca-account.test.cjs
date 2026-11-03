const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWallet, fetchWallet, resetOrcaRateLimit } = require('../lib/orca-account.cjs');
const ref = { userId: 12, workspaceId: 34 };
const account = { success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota: 26600000 }, quota: 999999999 } };
const status = { success: true, data: { quota_per_unit: 500000 } };

test('Wallet uses the selected workspace and provider conversion, not a key or user quota', () => {
  const result = parseWallet(account, status, ref);
  assert.equal(result.balances[0].remaining, 53.2);
  assert.equal(result.connectorVersion, 'orca-wallet-v1');
  assert.equal(result.balanceLabel, 'Solde du portefeuille');
  assert.equal(parseWallet(account, { success: true, data: { quota_per_unit: 1000000 } }, ref).balances[0].remaining, 26.6);
  assert.equal(parseWallet({ success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota: 0 } } }, status, ref).balances[0].remaining, 0);
});

test('Invalid conversion, negative or missing wallet, changed identity and expired sessions fail closed', () => {
  for (const quota_per_unit of [undefined, null, 0, -1, 0.5, '500000']) assert.throws(() => parseWallet(account, { success: true, data: { quota_per_unit } }, ref));
  for (const wallet_quota of [undefined, null, '26600000', 1.2, Infinity, -2500]) assert.throws(() => parseWallet({ success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota } } }, status, ref));
  assert.throws(() => parseWallet(account, status, { userId: 12, workspaceId: 35 }), /changé/);
  assert.throws(() => parseWallet(account, status, { userId: 13, workspaceId: 34 }), /changé/);
  assert.throws(() => parseWallet({ success: false }, status, ref), /expirée/);
  // Authentication and transient errors are distinguishable for main.cjs.
  assert.throws(() => parseWallet({ success: false }, status, ref), { code: 'ORCA_AUTH' });
  assert.throws(() => parseWallet({ success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota: -1 } } }, status, ref), { code: 'ORCA_TRANSIENT' });
});

test('Wallet reads only official endpoints using the isolated browser session', async () => {
  resetOrcaRateLimit();
  const requests = [];
  const result = await fetchWallet(ref, async (url, options) => {
    requests.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers['New-API-User'], '12');
    assert.equal(options.headers['X-Workspace-Id'], '34'); assert.equal(options.headers.Authorization, undefined);
    return { ok: true, json: async () => url.endsWith('/self') ? account : status };
  });
  assert.equal(result.balances[0].remaining, 53.2);
  assert.deepEqual(requests, ['https://www.orcarouter.ai/api/user/self', 'https://www.orcarouter.ai/api/status']);
  await assert.rejects(fetchWallet(ref, async () => ({ ok: false, status: 401 })), error => error.code === 'ORCA_AUTH' && /expirée/.test(error.message));
  await assert.rejects(fetchWallet(ref, async () => { throw new Error('secret'); }), error => error.code === 'ORCA_TRANSIENT' && /Connexion.*impossible/.test(error.message) && !error.message.includes('secret'));
});

test('OrcaRouter honors Retry-After on 429 with a local cooldown and a readable time', async () => {
  resetOrcaRateLimit();
  let time = Date.parse('2026-10-14T21:00:00Z');
  let calls = 0;
  const now = () => new Date(time);
  const limited = async () => { calls++; return { ok: false, status: 429, headers: { get: name => name === 'retry-after' ? '30' : null } }; };
  await assert.rejects(fetchWallet(ref, limited, now()), error => error.code === 'ORCA_RATE_LIMIT' && error.retryAt === time + 60000 && /Nouvelle lecture possible après/.test(error.message));
  assert.equal(calls, 1);
  // While the cooldown is active no request is sent, and the same actionable error is returned.
  await assert.rejects(fetchWallet(ref, limited, now()), { code: 'ORCA_RATE_LIMIT' });
  assert.equal(calls, 1);
  time += 60001;
  const result = await fetchWallet(ref, async url => ({ ok: true, json: async () => url.endsWith('/self') ? account : status }), now());
  assert.equal(result.balances[0].remaining, 53.2);
  resetOrcaRateLimit();
});
