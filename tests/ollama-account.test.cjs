const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOllamaCredits, fetchOllamaCredits, SETTINGS_URL } = require('../lib/ollama-account.cjs');
const page = (used='12.50', total='60.00') => `<main><h2>Included usage <span>Pro</span></h2><h3>Monthly usage</h3><span>$${used}</span> of <span>$${total}</span> used<div data-time="2026-10-07T12:00:00Z">Resets</div><h3>Extra usage</h3><span>$99.00</span><p>Subscription: $20</p></main>`;
test('Monthly dollar credits are independent of subscription price and extra credits', () => {
  const s = parseOllamaCredits(page());
  assert.deepEqual(s.balances, [{currency:'USD',remaining:47.5,total:60,used:12.5}]);
  assert.equal(s.resetAt, '2026-10-07T12:00:00.000Z');
  assert.equal(s.connectorVersion, 'ollama-monthly-credits-v1');
  assert.equal(parseOllamaCredits(page('0')).balances[0].remaining, 60);
  assert.equal(parseOllamaCredits(page('60')).quotaRemaining, 0);
  assert.equal(parseOllamaCredits(page('61')).balances[0].remaining, 0);
  assert.equal(parseOllamaCredits(page('1,025.25','2,000.00')).balances[0].remaining, 974.75);
});
test('Missing dollar amounts, style widths, scripts and unrelated amounts cannot create a balance', () => {
  for(const html of ['<h3>Monthly usage</h3><div style="width:50%">50% used</div>', page().replace('$12.50','unknown'), page('0','0'), '<script>Monthly usage $1 of $60 used</script>', '<h3>Monthly usage</h3><h3>Extra usage</h3>$2 of $90 used', page().replace('2026-10-07T12:00:00Z','unknown')]) assert.throws(()=>parseOllamaCredits(html));
  assert.equal(parseOllamaCredits(page().replace(' data-time="2026-10-07T12:00:00Z"','')).resetAt,null);
});
test('Ollama uses only session-authenticated read-only settings; expired sessions remain unknown', async () => {
  const s = await fetchOllamaCredits(async(url, options)=>{
    assert.equal(url, SETTINGS_URL); assert.equal(options.method,'GET'); assert.equal(options.credentials,'include');
    assert.equal(options.redirect,'manual'); assert.equal(options.headers.Authorization,undefined);
    return {ok:true,status:200,url:SETTINGS_URL,text:async()=>page()};
  });
  assert.equal(s.balances[0].remaining,47.5);
  for(const status of [302,401,403]) await assert.rejects(fetchOllamaCredits(async()=>({ok:false,status})),e=>e.code==='OLLAMA_SIGNIN');
  await assert.rejects(fetchOllamaCredits(async()=>({ok:false,status:429})),/Trop de demandes/);
  await assert.rejects(fetchOllamaCredits(async()=>{throw new Error('secret');}),/Connexion.*impossible/);
});
