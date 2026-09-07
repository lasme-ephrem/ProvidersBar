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
