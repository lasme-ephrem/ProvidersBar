const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseWallet, fetchWallet } = require('../lib/orca-account.cjs');
const ref = { userId: 12, workspaceId: 34 };
const account = { success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota: 26600000 }, quota: 999999999 } };
const status = { success: true, data: { quota_per_unit: 500000 } };

test('Wallet uses the selected workspace and provider conversion, not a key or user quota', () => {
  const result = parseWallet(account, status, ref);
  assert.equal(result.balances[0].remaining, 53.2);
  assert.equal(result.connectorVersion, 'orca-wallet-v1');
  assert.equal(result.balanceLabel, 'Solde du portefeuille');
  assert.equal(parseWallet(account, { success: true, data: { quota_per_unit: 1000000 } }, ref).balances[0].remaining, 26.6);
  for (const wallet_quota of [0, -2500]) assert.equal(parseWallet({ success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota } } }, status, ref).balances[0].remaining, wallet_quota / 500000);
});

test('Invalid conversion, missing wallet, changed identity and expired sessions fail closed', () => {
  for (const quota_per_unit of [undefined, null, 0, -1, 0.5, '500000']) assert.throws(() => parseWallet(account, { success: true, data: { quota_per_unit } }, ref));
  for (const wallet_quota of [undefined, null, '26600000', 1.2, Infinity]) assert.throws(() => parseWallet({ success: true, data: { id: 12, active_workspace: { id: 34, wallet_quota } } }, status, ref));
  assert.throws(() => parseWallet(account, status, { userId: 12, workspaceId: 35 }), /changé/);
  assert.throws(() => parseWallet(account, status, { userId: 13, workspaceId: 34 }), /changé/);
  assert.throws(() => parseWallet({ success: false }, status, ref), /expirée/);
});

test('Wallet reads only official endpoints using the isolated browser session', async () => {
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
  await assert.rejects(fetchWallet(ref, async () => ({ ok: false, status: 401 })), /expirée/);
  await assert.rejects(fetchWallet(ref, async () => { throw new Error('secret'); }), /Connexion.*impossible/);
});
