const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { accounts, inspectSubscriptionPage, parseAccountUsage } = require('../lib/subscription-accounts.cjs');
const { connectionInfo } = require('../lib/provider-catalog.cjs');
const { createSubscriptionController } = require('../lib/subscription-controller.cjs');

function inspect(id, text, { login = false, authenticated = false, conversation = false, foreign = false } = {}) {
  const url = new URL(accounts[id].usageUrl||accounts[id].url);
  const node = text => ({ innerText: text, getAttribute: () => null, getClientRects: () => [1], querySelector: () => ({ innerText: 'Usage' }), querySelectorAll: () => [] });
  const controls = [ ...(login ? [node('Sign in')] : []), ...(authenticated ? [node('Log out')] : []) ];
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(${inspectSubscriptionPage.toString()})(${JSON.stringify(id)}, ${JSON.stringify(url.origin)})`, {
    location: { origin: foreign ? 'https://accounts.google.com' : url.origin, pathname: conversation ? '/chat/123' : url.pathname }, window: {},
    document: { querySelectorAll: selector => selector.startsWith('button') ? controls : conversation ? [] : selector.startsWith('main') ? [node(text)] : ['gemini', 'grok'].includes(id) ? [node(text)] : [] },
  })));
}

test('All four subscription portals have account connectors and explicit windows, no monetary balance', () => {
  for (const id of Object.keys(accounts).filter(id=>id!=='openai')) {
    assert.equal(connectionInfo(id).mode, 'account');
    const result = inspect(id, '5 hour usage limit\n80% remaining\nWeekly usage limit\n35% used\nResets 2026-10-07T12:00:00Z');
    const s = parseAccountUsage(id, result);
    assert.equal(s.quotaRemaining, 65);
    assert.equal(s.quotaWindows.length, 2);
    assert.equal(s.resetAt, '2026-10-07T12:00:00.000Z');
    assert.deepEqual(s.balances, []);
    assert.match(s.quotaLabel, /Semaine/);
  }
});
test('French wording, zero and 100 are preserved; ambiguous values never invent a quota', () => {
  const s = parseAccountUsage('gemini', inspect('gemini', '5 heures\n100 % utilisés\nSemaine\n0 % consommés'));
  assert.equal(s.quotaRemaining, 0);
  assert.equal(s.quotaWindows[1].remaining, 100);
  for (const text of ['Weekly limit\n50%', 'Weekly limit\n$20 per month', 'Weekly limit\n101% used', 'Weekly limit\n20% used\nWeekly limit\n30% used']) {
    assert.equal(parseAccountUsage('grok', inspect('grok', text, { authenticated: true })), null);
  }
  assert.throws(() => parseAccountUsage('zai', { authenticated: true, windows: [{ label: 'Semaine', remaining: NaN, resetAt: null }] }));
});
test('OpenAI uses Codex authentication without forcing a web analytics redirect', () => {
  assert.equal(accounts.openai.url, 'https://chatgpt.com/');
  assert.equal(connectionInfo('openai').codexAccount, true);
});
test('Gemini recognizes its current usage wording independently of weekly usage', () => {
  const s=parseAccountUsage('gemini',inspect('gemini','Limites d’utilisation\nUtilisation actuelle\n0 % utilisé(s)\nRéinitialisation à 16:20\nLimite hebdomadaire\nRéinitialisation le 8 sept. à 10:20\n15 % utilisé(s)'));
  assert.equal(s.quotaRemaining,85);assert.equal(s.quotaWindows.length,2);
  assert.equal(s.quotaWindows[0].label,'Période en cours');assert.equal(s.quotaWindows[0].remaining,100);
});
test('Reopening cancels an in-flight background read instead of waiting for its timeout', async () => {
  const events=[];
  const c=createSubscriptionController({dataDir:'test-only',onChange(){},onResult:async()=>assert.fail('Cancelled read must not be saved'),deleteProfile:async()=>{},openBrowser:async(_dir,id,headless,{signal}={})=>{
    if(headless){events.push('background');await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}
    events.push('interactive');return {isOpen:()=>true,close:async()=>{},readSubscriptionPage:async()=>({authenticated:false,windows:[]})};
  }});
  const reading=c.read('grok',{background:true}).catch(()=>{});
  const start=Date.now();await c.open('grok');await reading;
  assert.ok(Date.now()-start<500);assert.deepEqual(events,['background','interactive']);
  await c.closeAll();
});
test('A closed browser never erases the actionable verification error', async t => {
  t.mock.timers.enable({apis:['setInterval']});let failure;
  const c=createSubscriptionController({dataDir:'test-only',onChange(){},onResult:async()=>assert.fail('Not authenticated'),onFailure:async(_id,message)=>{failure=message;},deleteProfile:async()=>{},openBrowser:async()=>({isOpen:()=>false,close:async()=>{},readSubscriptionPage:async()=>({authenticated:false,windows:[]})})});
  await c.open('zai');
  // Fresh background verification, no successful session; simulated clock keeps this bounded.
  await assert.rejects(c.read('zai'), /Ouvre le compte/);
  // Verify a browser that closes during its failed read.
  await c.closeAll();
  let open=true;
  const d=createSubscriptionController({dataDir:'test-only',onChange(){},onResult:async()=>assert.fail(),onFailure:async(_id,message)=>{failure=message;},deleteProfile:async()=>{},openBrowser:async()=>({isOpen:()=>open,close:async()=>{open=false;},readSubscriptionPage:async()=>{open=false;return {authenticated:false,windows:[]};}})});
  await d.open('zai');await assert.rejects(d.read('zai',{automatic:true}),{code:'ACCOUNT_SIGNIN'});
  t.mock.timers.tick(2000);assert.equal(d.info('zai').status,'error');assert.match(failure,/absente ou expirée/);
  await d.closeAll();
});
test('Public sign-in pages, foreign origins and conversation text cannot authenticate or create quotas', () => {
  for (const options of [{ login: true }, { foreign: true }, { conversation: true }]) {
    const result = inspect('grok', 'Weekly limit\n20% used', options);
    assert.equal(result.authenticated, false);
    assert.throws(() => parseAccountUsage('grok', result), { code: 'ACCOUNT_SIGNIN' });
  }
  assert.throws(() => parseAccountUsage('__proto__', {}));
});
function harness() {
  const reads = [], opens = [], deleted = [], closed = [];
  let result = { authenticated: true, windows: [{ label: 'Semaine', remaining: 75, resetAt: null }] };
  const controller = createSubscriptionController({ dataDir: 'test-only', onChange() {},
    openBrowser: async (_dir, id, headless) => {
      opens.push({ id, headless }); let open = true;
      return { isOpen: () => open, readSubscriptionPage: async () => result, close: async () => { open = false; closed.push(id); } };
    }, deleteProfile: async (_dir, id) => deleted.push(id), onResult: async (id, snapshot) => reads.push({ id, snapshot }),
  });
  return { controller, reads, opens, deleted, closed, result: value => { result = value; } };
}
test('Sessions open interactively, refresh without a window, close after reading and disconnect independently', async () => {
  const h = harness();
  try {
    for (const id of Object.keys(accounts)) { await h.controller.open(id); await h.controller.read(id); }
    assert.equal(h.reads.length, 4);
    assert.equal(h.closed.length, 4);
    assert.ok(h.opens.every(o => o.headless === false));
    await h.controller.read('openai', { background: true });
    assert.deepEqual(h.opens.at(-1), { id: 'openai', headless: true });
    await h.controller.disconnect('gemini');
    assert.deepEqual(h.deleted, ['gemini']);
    assert.equal(h.controller.info('openai').status, 'connected');
  } finally { await h.controller.closeAll(); }
});
test('Unauthenticated verification never saves; missing usage saves only after explicit verification and retains no invented snapshot', async () => {
  const h = harness();
  try {
    await h.controller.open('gemini');
    h.result({ authenticated: false, windows: [] });
    await assert.rejects(h.controller.read('gemini'), { code: 'ACCOUNT_SIGNIN' });
    assert.equal(h.reads.length, 0);
    h.result({ authenticated: true, windows: [] });
    await h.controller.read('gemini', { automatic: true });
    assert.equal(h.reads.length, 0);
    await h.controller.read('gemini');
    assert.deepEqual(h.reads, [{ id: 'gemini', snapshot: null }]);
    assert.match(h.controller.info('gemini').message, /quota indisponible/);
  } finally { await h.controller.closeAll(); }
});
test('Concurrent opening/verification creates one browser and one measurement; disconnect waits for verification', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const events = [];
  const c = createSubscriptionController({ dataDir: 'test-only', onChange() {}, onResult: async () => events.push('saved'), deleteProfile: async () => events.push('deleted'),
    openBrowser: async () => { events.push('opened'); return { isOpen: () => true, close: async () => events.push('closed'), readSubscriptionPage: async () => { await gate; return { authenticated: true, windows: [{ label: 'Semaine', remaining: 20, resetAt: null }] }; } }; },
  });
  await Promise.all([c.open('grok'), c.open('grok')]);
  const a = c.read('grok'), b = c.read('grok'), d = c.disconnect('grok');
  release(); const result=await Promise.allSettled([a, b, d]);
  assert.equal(result[0].status,'rejected');assert.equal(result[1].status,'rejected');assert.equal(result[2].status,'fulfilled');
  assert.deepEqual(events, ['opened', 'closed', 'deleted']);
  await c.closeAll();
});
