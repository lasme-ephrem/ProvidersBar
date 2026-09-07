const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../lib/seed.cjs');
const { summary, manualSnapshot, validatePatch, daysUntil, dateOnly } = require('../lib/domain.cjs');
const { fetchUsage, parseResponse } = require('../lib/connectors.cjs');

test('Selected inventory has 10 unique services, keeping six subscription services and four APIs', () => {
  const s=createSeed();
  assert.equal(new Set(s.providers.map(p=>p.id)).size,10);
  assert.equal(s.providers.filter(p=>p.type==='subscription').length,6);
  assert.deepEqual(s.providers.filter(p=>p.type==='api').map(p=>p.id),['openrouter','deepseek','runinfra','orcarouter']);
  assert.ok(s.providers.every(p=>p.snapshot===null&&p.billingCycle==='unknown'));
  for(const id of ['ollama']) assert.equal(s.providers.find(p=>p.id===id).renewalDate,null);
  assert.deepEqual(summary(s.providers),{monthly:{},unpriced:6});
});
test('Monthly summary normalizes annual prices, separates currencies and excludes unknowns/inactive subscriptions',()=>{
  const rows=[{type:'subscription',active:true,amount:120,currency:'USD',billingCycle:'yearly'}, {type:'subscription',active:true,amount:20,currency:'EUR',billingCycle:'monthly'}, {type:'subscription',active:true,amount:100,currency:'USD',billingCycle:'unknown'}, {type:'subscription',active:false,amount:900,currency:'USD',billingCycle:'monthly'}, {type:'api',active:true,amount:55,currency:'USD',billingCycle:'monthly'}];
  assert.deepEqual(summary(rows),{monthly:{USD:10,EUR:20},unpriced:1});
  assert.deepEqual(summary([{type:'subscription',active:true,amount:35,currency:'USD',billingCycle:'one-time'}]),{monthly:{},unpriced:0});
});
test('Manual snapshots preserve zero and unknown independently, validate range and timestamp',()=>{
  const s=manualSnapshot({currency:'USD',balance:0,quotaRemaining:null},new Date('2026-09-07T10:00:00Z'));
  assert.equal(s.balances[0].remaining,0);assert.equal(s.quotaRemaining,null);assert.equal(s.source,'manual');
  assert.throws(()=>manualSnapshot({currency:'USD',balance:null,quotaRemaining:null}));
  assert.throws(()=>manualSnapshot({currency:'USD',balance:1,quotaRemaining:101}));
  assert.throws(()=>manualSnapshot({currency:'USD',balance:1,quotaRemaining:NaN}));
  assert.throws(()=>manualSnapshot({currency:'USD',balance:1,quotaRemaining:null,resetAt:'bad'}));
  assert.equal(manualSnapshot({currency:'USD',balance:null,quotaRemaining:0}).quotaRemaining,0);
});
test('Provider updates only accept allowed fields and real calendar dates',()=>{
  assert.deepEqual(validatePatch({id:'evil',snapshot:{},favorite:true,amount:0}),{favorite:true,amount:0});
  assert.throws(()=>validatePatch({amount:-1}));assert.throws(()=>validatePatch({currency:'XYZ'}));
  assert.throws(()=>dateOnly('2026-02-30'));assert.equal(dateOnly('2028-02-29'),'2028-02-29');
  assert.equal(daysUntil('2026-09-08',new Date(2026,8,7,23,59)),1);
});
test('OpenRouter balance is credits minus usage, including depleted balances',()=>{
  assert.deepEqual(parseResponse('openrouter',{data:{total_credits:100.5,total_usage:25.75}}).balances,[{currency:'USD',remaining:74.75,total:100.5,used:25.75}]);
  assert.equal(parseResponse('openrouter',{data:{total_credits:10,total_usage:12}}).balances[0].remaining,-2);
  assert.throws(()=>parseResponse('openrouter',{data:{total_credits:null,total_usage:0}}));
  assert.throws(()=>parseResponse('openrouter',{data:{total_credits:10,total_usage:-3}}));
});
test('DeepSeek preserves multiple currencies and rejects malformed balances',()=>{
  assert.deepEqual(parseResponse('deepseek',{balance_infos:[{currency:'USD',total_balance:'10.50'},{currency:'CNY',total_balance:'0'}]}).balances,[{currency:'USD',remaining:10.5},{currency:'CNY',remaining:0}]);
  assert.throws(()=>parseResponse('deepseek',{balance_infos:[{currency:'USD',total_balance:''}]}));
  assert.throws(()=>parseResponse('deepseek',{balance_infos:[]}));
});
test('Connector uses only its fixed endpoint, no redirect, and actionable sanitized errors',async()=>{
  let request;
  await fetchUsage('deepseek',' example-key ',async(url,options)=>{request={url,options};return {ok:true,json:async()=>({balance_infos:[{currency:'USD',total_balance:'9.25'}]})};});
  assert.equal(request.url,'https://api.deepseek.com/user/balance');assert.equal(request.options.headers.Authorization,'Bearer example-key');assert.equal(request.options.redirect,'error');
  await assert.rejects(fetchUsage('openrouter','key',async()=>({ok:false,status:403})),/clé de gestion/);
  await assert.rejects(fetchUsage('deepseek','key',async()=>({ok:false,status:401})),/Clé refusée/);
  await assert.rejects(fetchUsage('deepseek','key',async()=>({ok:false,status:429})),/Trop de demandes/);
  await assert.rejects(fetchUsage('deepseek','secret',async()=>{throw new Error('secret');}),/Connexion impossible/);
  await assert.rejects(fetchUsage('other','key'),/non disponible/);
});
