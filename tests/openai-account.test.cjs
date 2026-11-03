const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOpenAiLimits, createOpenAiAccount } = require('../lib/openai-account.cjs');
const limits = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 1789378823 } }, spark: { limitName: 'Spark', primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1788793467 } } } };
test('OpenAI uses named quota buckets, seconds for resets and preserves the main Codex quota', () => {
  const s = parseOpenAiLimits(limits);
  assert.equal(s.quotaRemaining, 98); assert.equal(s.quotaWindows.length, 2);
  assert.equal(s.resetAt, new Date(1789378823000).toISOString()); assert.deepEqual(s.balances, []);
  assert.equal(parseOpenAiLimits({ rateLimits: { primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: null } } }).quotaRemaining, 0);
  for (const usedPercent of [null, -1, 101, NaN, '2']) assert.throws(() => parseOpenAiLimits({ rateLimits: { primary: { usedPercent, windowDurationMins: 300, resetsAt: null } } }));
  assert.throws(() => parseOpenAiLimits({ rateLimitsByLimitId: {} }));
});
test('OpenAI exposes the five-hour and weekly windows required by the strategy', () => {
  const full = parseOpenAiLimits({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1788793467 },
    secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1789378823 },
  } } });
  assert.deepEqual(full.quotaWindows.map(window => window.label), ['Codex et Work · 5 heures', 'Codex et Work · Semaine']);
  assert.equal(full.quotaRemaining, 80);
  // A partial report stays a partial report: the strategy must see it as incomplete,
  // never silently turned into a complete quota.
  const partial = parseOpenAiLimits({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null } } } });
  assert.deepEqual(partial.quotaWindows.map(window => window.label), ['Codex et Work · 5 heures']);
  assert.equal(partial.quotaWindows.some(window => window.label === 'Codex et Work · Semaine'), false);
});
test('Connecting reuses the official account interface, stores no email and disconnect never logs Codex out', async () => {
  const calls = [], saved = []; let closes = 0;
  const c = createOpenAiAccount({ onChange() {}, openExternal: async () => assert.fail('No browser needed for an existing account'), onResult: async (s, identity) => saved.push({s,identity}), rpcFactory: async () => ({ close: () => closes++, request: async method => { calls.push(method); if(method==='account/read')return {account:{type:'chatgpt',email:'account@example.test'}}; if(method==='account/rateLimits/read')return limits; assert.fail(method); } }) });
  await c.open(); assert.equal(saved.length,1); assert.equal(saved[0].s.quotaRemaining,98);
  assert.equal(saved[0].identity.length,64); assert.ok(!JSON.stringify(saved).includes('account@example.test'));
  await assert.rejects(c.read('different-identity'), /a changé/);
  await c.disconnect(); assert.equal(c.info().status,'idle'); assert.equal(closes,2);
  assert.deepEqual(calls,['account/read','account/rateLimits/read','account/read']);
});
test('Official login callback verifies limits automatically without requiring browser closure', async () => {
  let authenticated=false, callback, opened, saved=false;
  const c=createOpenAiAccount({onChange(){},openExternal:async url=>{opened=url;},onResult:async()=>{saved=true;},rpcFactory:async()=>({close(){},onLogin:fn=>{callback=fn;},request:async method=>{
    if(method==='account/read')return {account:authenticated?{type:'chatgpt',email:null}:null};
    if(method==='account/login/start')return {authUrl:'https://auth.openai.com/authorize?example=test'};
    if(method==='account/rateLimits/read')return limits;
    assert.fail(method);
  }})});
  await c.open();assert.ok(opened.startsWith('https://auth.openai.com/'));assert.equal(saved,false);
  authenticated=true;await callback({success:true});assert.equal(saved,true);assert.equal(c.info().status,'connected');
  await c.close();
});

test('Concurrent opens share one login flow', async () => {
  let factories = 0, starts = 0, externalOpens = 0;
  const c = createOpenAiAccount({ onChange() {}, onResult: async () => {}, openExternal: async () => { externalOpens++; },
    rpcFactory: async () => {
      factories++;
      return { close() {}, onLogin() {}, request: async method => {
        if (method === 'account/read') return { account: null };
        if (method === 'account/login/start') { starts++; return { authUrl: 'https://auth.openai.com/authorize' }; }
        assert.fail(method);
      } };
    } });
  assert.deepEqual(await Promise.all([c.open(), c.open()]), [true, true]);
  assert.equal(factories, 2); assert.equal(starts, 1); assert.equal(externalOpens, 1);
  await c.close();
});

test('Disconnect cancels a login while its app-server is starting', async () => {
  let resolveLoginRpc, loginStarted;
  const started = new Promise(resolve => { loginStarted = resolve; });
  let factories = 0, closedLoginRpcs = 0, starts = 0;
  const c = createOpenAiAccount({ onChange() {}, onResult: async () => {}, openExternal: async () => {},
    rpcFactory: async () => {
      factories++;
      if (factories === 1) return { close() {}, request: async method => {
        assert.equal(method, 'account/read'); return { account: null };
      } };
      loginStarted();
      return await new Promise(resolve => { resolveLoginRpc = resolve; });
    } });
  const opening = c.open();
  await started;
  await c.disconnect();
  resolveLoginRpc({ close() { closedLoginRpcs++; }, onLogin() {}, request: async method => {
    if (method === 'account/login/start') starts++;
    assert.fail(`Unexpected RPC after disconnect: ${method}`);
  } });
  assert.equal(await opening, false);
  assert.equal(closedLoginRpcs, 1); assert.equal(starts, 0); assert.equal(c.info().status, 'idle');
});
