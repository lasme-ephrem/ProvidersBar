const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOllamaCredits, fetchOllamaCredits, SETTINGS_URL, lastKnownUsageCredits, resetOllamaRateLimit } = require('../lib/ollama-account.cjs');
const page = (used='12.50', total='60.00') => `<main><h2>Included usage <span>Pro</span></h2><h3>Monthly usage</h3><span>$${used}</span> of <span>$${total}</span> used<div data-time="2026-10-07T12:00:00Z">Resets</div><h3>Extra usage</h3><span>$99.00</span><p>Subscription: $20</p></main>`;
test('Monthly dollar credits are independent of subscription price and extra credits', () => {
  const s = parseOllamaCredits(page());
  assert.deepEqual(s.balances, [{currency:'USD',remaining:47.5,total:60,used:12.5}]);
  assert.equal(s.usageCredits,null);
  assert.equal(s.resetAt, '2026-10-07T12:00:00.000Z');
  assert.equal(s.connectorVersion, 'ollama-monthly-credits-v1');
  assert.equal(parseOllamaCredits(page('0')).balances[0].remaining, 60);
  assert.equal(parseOllamaCredits(page('60')).quotaRemaining, 0);
  assert.equal(parseOllamaCredits(page('61')).balances[0].remaining, 0);
  assert.equal(parseOllamaCredits(page('1,025.25','2,000.00')).balances[0].remaining, 974.75);
});
test('Ollama usage credits remain visible when included usage is exhausted', () => {
  const html = `<main><h2>Included usage</h2><h3>Monthly usage</h3><span>$60 of $60 used</span><h3>Usage credits</h3><p>Keep using cloud models after your plan's included usage runs out.</p><span>$2.98</span><small>Current balance</small><button>Add more</button><p>Subscription: $20</p></main>`;
  const snapshot = parseOllamaCredits(html);
  assert.equal(snapshot.balances[0].remaining,0);
  assert.equal(snapshot.quotaRemaining,0);
  assert.deepEqual(snapshot.usageCredits,{currency:'USD',remaining:2.98});
  assert.deepEqual(parseOllamaCredits(html.replace('$2.98','Current balance $1,234.56').replace('<small>Current balance</small>','')).usageCredits,{currency:'USD',remaining:1234.56});
  assert.deepEqual(parseOllamaCredits(html.replace('$2.98',' $0.00')).usageCredits,{currency:'USD',remaining:0});
});
test('Ollama Free keeps purchased credits and only reports an explicit starter limit', () => {
  const head='<main><h2>Included usage <span>Free</span></h2>';
  const credits='<h3>Usage credits</h3><span>$2.98</span><small>Current balance</small></main>';
  const withoutLimit=parseOllamaCredits(head+credits);
  assert.equal(withoutLimit.planTier,'free');
  assert.deepEqual(withoutLimit.balances,[]);
  assert.equal(withoutLimit.quotaRemaining,null);
  assert.equal(withoutLimit.usageCredits.remaining,2.98);
  const percentage=parseOllamaCredits(head+'<h3>Monthly usage</h3><p>25% used</p>'+credits);
  assert.equal(percentage.quotaRemaining,75);
  const zero=parseOllamaCredits(head+'<h3>Monthly usage</h3><p>$0 of $0 used</p>'+credits);
  assert.deepEqual(zero.balances,[]);
  assert.equal(zero.quotaRemaining,null);
  const fallback=parseOllamaCredits('<main><h3>Monthly usage</h3><p>Starter limit</p>'+credits,new Date(),{assumeFree:true});
  assert.equal(fallback.quotaRemaining,null);
  assert.equal(fallback.usageCredits.remaining,2.98);
  assert.deepEqual(parseOllamaCredits(page(),new Date(),{assumeFree:true}).balances,[]);
  assert.throws(()=>parseOllamaCredits('<p>Sign in to Ollama</p><h3>Monthly usage</h3>',new Date(),{assumeFree:true}),e=>e.code==='OLLAMA_SIGNIN');
  assert.throws(()=>parseOllamaCredits('<main>Public page</main>',new Date(),{assumeFree:true}),/non reconnus/);
});
test('Unidentified or ambiguous extra credit amounts stay unknown', () => {
  const original=page();
  assert.equal(parseOllamaCredits(original).usageCredits,null);
  assert.equal(parseOllamaCredits(original.replace('<h3>Extra usage</h3><span>$99.00</span>','<h3>Usage credits</h3><span>$99.00</span>')).usageCredits,null);
  assert.equal(parseOllamaCredits(original.replace('<h3>Extra usage</h3><span>$99.00</span>','<h3>Usage credits</h3><span>$2 Current balance $3 Current balance</span>')).usageCredits,null);
  assert.equal(parseOllamaCredits(original.replace('<h3>Extra usage</h3><span>$99.00</span>','<script>Usage credits $99 Current balance</script>')).usageCredits,null);
});
test('Current authenticated Free usage screen does not require the removed monthly section', () => {
  const html='<main><h1>Usage credits <span>Free</span></h1><p>Usage credits used this month</p><p>Free usage credits</p><h2>Usage breakdown</h2></main>';
  const snapshot=parseOllamaCredits(html);
  assert.equal(snapshot.planTier,'free');
  assert.deepEqual(snapshot.balances,[]);
  assert.equal(snapshot.quotaRemaining,null);
  assert.equal(snapshot.usageCredits,null);
  assert.throws(()=>parseOllamaCredits('<main>Public page</main>',new Date(),{assumeFree:true}),/non reconnus/);
  assert.throws(()=>parseOllamaCredits('<p>Sign in</p>'+html),{code:'OLLAMA_SIGNIN'});
});
test('Current Ollama credit header reads the purchased balance, never model spend or top-up prices', () => {
  const html='<main><h1>Usage credits <span>Free</span></h1><div>$1.05</div><p>Add usage credits to pay as you go on any cloud model.</p><button>Add funds</button><div>Auto-reload Off</div><h2>Usage credits used this month</h2><div>deepseek-v4.1-flash 307 requests $1.03</div><div>glm-5.3-flash 273 requests $0.90</div><h2>Usage breakdown</h2><div>62.8%</div><dialog>Add usage credits $5 $20 $100 $500</dialog></main>';
  const snapshot=parseOllamaCredits(html);
  assert.deepEqual(snapshot.usageCredits,{currency:'USD',remaining:1.05});
  assert.equal(snapshot.quotaRemaining,null);assert.deepEqual(snapshot.balances,[]);
  assert.equal(parseOllamaCredits(html.replace('$1.05','$0.00')).usageCredits.remaining,0);
  assert.equal(parseOllamaCredits(html.replace('<div>$1.05</div>','')).usageCredits,null);
  assert.equal(parseOllamaCredits(html.replace('Free','Pro'),new Date(),{assumeFree:true}).usageCredits.remaining,1.05);
});
test('Missing reserve retains its observed date; a current zero replaces historical credit', () => {
  const history=[{providerId:'ollama',updatedAt:'2026-10-10T00:00:00Z',usageCredits:null},{providerId:'openai',updatedAt:'2026-10-09T00:00:00Z',usageCredits:{currency:'USD',remaining:99}},{providerId:'ollama',updatedAt:'2026-10-07T20:03:52.638Z',usageCredits:{currency:'USD',remaining:1.05}}];
  assert.deepEqual(lastKnownUsageCredits({usageCredits:null},history),{currency:'USD',remaining:1.05,observedAt:'2026-10-07T20:03:52.638Z',stale:true});
  assert.deepEqual(lastKnownUsageCredits({usageCredits:{currency:'USD',remaining:0},updatedAt:'2026-10-11T12:00:00Z'},history),{currency:'USD',remaining:0,observedAt:'2026-10-11T12:00:00Z',stale:false});
});
test('Missing dollar amounts, style widths, scripts and unrelated amounts cannot create a balance', () => {
  for(const html of ['<h3>Monthly usage</h3><div style="width:50%">50% used</div>', page().replace('$12.50','unknown'), page('0','0'), '<script>Monthly usage $1 of $60 used</script>', '<h3>Monthly usage</h3><h3>Extra usage</h3>$2 of $90 used', page().replace('2026-10-07T12:00:00Z','unknown')]) assert.throws(()=>parseOllamaCredits(html));
  assert.equal(parseOllamaCredits(page().replace(' data-time="2026-10-07T12:00:00Z"','')).resetAt,null);
});
test('Ollama uses only session-authenticated read-only settings; expired sessions remain unknown', async () => {
  resetOllamaRateLimit();
  const s = await fetchOllamaCredits(async(url, options)=>{
    assert.equal(url, SETTINGS_URL); assert.equal(options.method,'GET'); assert.equal(options.credentials,'include');
    assert.equal(options.redirect,'manual'); assert.equal(options.headers.Authorization,undefined);
    return {ok:true,status:200,url:SETTINGS_URL,text:async()=>page()};
  });
  assert.equal(s.balances[0].remaining,47.5);
  for(const status of [302,401,403]) await assert.rejects(fetchOllamaCredits(async()=>({ok:false,status})),e=>e.code==='OLLAMA_SIGNIN');
  await assert.rejects(fetchOllamaCredits(async()=>({ok:false,status:429})),e=>e.code==='OLLAMA_RATE_LIMIT'&&/Trop de demandes/.test(e.message));
  resetOllamaRateLimit();
  await assert.rejects(fetchOllamaCredits(async()=>{throw new Error('secret');}),e=>e.code==='OLLAMA_TRANSIENT'&&/Connexion.*impossible/.test(e.message)&&!e.message.includes('secret'));
  await assert.rejects(fetchOllamaCredits(async()=>({ok:false,status:500})),{code:'OLLAMA_TRANSIENT'});
  // A layout change keeps the session usable: it is a transient format error, not a sign-in failure.
  await assert.rejects(fetchOllamaCredits(async()=>({ok:true,status:200,url:SETTINGS_URL,text:async()=>'<main>Public page</main>'})),e=>e.code==='OLLAMA_TRANSIENT'&&/non reconnus/.test(e.message));
  resetOllamaRateLimit();
});

test('Ollama honors Retry-After on 429 with a local cooldown and never exposes a secret', async () => {
  resetOllamaRateLimit();
  let time = Date.parse('2026-10-14T21:00:00Z');
  const now = () => new Date(time);
  let calls = 0;
  const limited = async () => { calls++; return { ok: false, status: 429, headers: { get: name => name === 'retry-after' ? '30' : null } }; };
  await assert.rejects(fetchOllamaCredits(limited, now()), error => error.code === 'OLLAMA_RATE_LIMIT' && error.retryAt === time + 60000 && /Nouvelle lecture possible après/.test(error.message));
  assert.equal(calls, 1);
  // While the cooldown is active no request is sent and the same actionable error is returned.
  await assert.rejects(fetchOllamaCredits(limited, now()), { code: 'OLLAMA_RATE_LIMIT' });
  assert.equal(calls, 1);
  time += 60001;
  const snapshot = await fetchOllamaCredits(async () => ({ ok: true, status: 200, url: SETTINGS_URL, text: async () => page() }), now());
  assert.equal(snapshot.balances[0].remaining, 47.5);
  resetOllamaRateLimit();
});
