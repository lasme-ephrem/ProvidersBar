const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSeed } = require('../lib/seed.cjs');
const { summary, renewalOverdue, validatePatch, daysUntil, dateOnly, isTracked, expireSubscriptions } = require('../lib/domain.cjs');
const { fetchUsage, parseResponse } = require('../lib/connectors.cjs');

test('Selected inventory has 10 unique services, keeping six subscription services and four APIs', () => {
  const s=createSeed();
  assert.equal(s.settings.theme,'system');
  assert.equal(new Set(s.providers.map(p=>p.id)).size,10);
  assert.equal(s.providers.filter(p=>p.type==='subscription').length,6);
  assert.equal(s.providers.find(p=>p.id==='claude').plan,'Claude Pro');
  assert.deepEqual(s.providers.filter(p=>p.type==='api').map(p=>p.id),['openrouter','deepseek','runinfra','orcarouter']);
  assert.ok(s.providers.every(p=>p.snapshot===null&&p.billingCycle==='unknown'));
  // 0.6.9 : plus aucun champ saisi à la main en dehors des quatre essentiels.
  for (const field of ['notes','statusMessage','reviewed','nextAmount','priceChangeDate']) assert.ok(s.providers.every(p=>!(field in p)),field);
  for(const id of ['ollama']) assert.equal(s.providers.find(p=>p.id===id).renewalDate,null);
  assert.deepEqual(summary(s.providers),{monthly:{},oneTime:{},oneTimeCount:0,nextOneTimeEnd:null,overdue:0,unpriced:6});
});
test('Monthly summary normalizes annual prices, separates currencies and excludes unknowns/inactive subscriptions',()=>{
  const now=new Date(2026,10,5,12);
  const rows=[{type:'subscription',active:true,amount:120,currency:'USD',billingCycle:'yearly'}, {type:'subscription',active:true,amount:20,currency:'EUR',billingCycle:'monthly'}, {type:'subscription',active:true,amount:100,currency:'USD',billingCycle:'unknown'}, {type:'subscription',active:false,amount:900,currency:'USD',billingCycle:'monthly'}, {type:'api',active:true,amount:55,currency:'USD',billingCycle:'monthly'}];
  assert.deepEqual(summary(rows,now),{monthly:{USD:10,EUR:20},oneTime:{},oneTimeCount:0,nextOneTimeEnd:null,overdue:0,unpriced:1});
});
test('One-time payments are summed apart, whatever their duration, until each one ends',()=>{
  const now=new Date(2026,10,5,12);
  const rows=[
    {type:'subscription',active:true,amount:199,currency:'USD',billingCycle:'one-time',renewalDate:'2028-11-05'},
    {type:'subscription',active:true,amount:35,currency:'USD',billingCycle:'one-time',renewalDate:'2027-01-07'},
    {type:'subscription',active:true,amount:50,currency:'EUR',billingCycle:'one-time',renewalDate:null},
    {type:'subscription',active:true,amount:12,currency:'USD',billingCycle:'one-time',renewalDate:'2026-11-04'},
    {type:'subscription',active:true,amount:null,currency:'USD',billingCycle:'one-time',renewalDate:'2027-01-01'},
    {type:'subscription',active:true,amount:20,currency:'USD',billingCycle:'monthly',renewalDate:'2026-12-04'},
  ];
  assert.deepEqual(summary(rows,now),{monthly:{USD:20},oneTime:{USD:234,EUR:50},oneTimeCount:3,nextOneTimeEnd:'2027-01-07',overdue:0,unpriced:1});
  // Le lendemain de sa fin, un paiement unique sort du total (sans attendre l'expiration).
  assert.deepEqual(summary(rows,new Date(2027,0,8,12)).oneTime,{USD:199,EUR:50});
  assert.deepEqual(summary(rows,now,{apiSpending:{month:{USD:30},tracked:1,topUps:1}}).api,{month:{USD:30},tracked:1,topUps:1});
});
test('A recurring subscription past its due date stays counted and becomes « à vérifier »',()=>{
  const p={id:'antigravity',type:'subscription',active:true,subscriptionStatus:'active',amount:99.99,currency:'USD',billingCycle:'monthly',renewalDate:'2026-11-15'};
  const after=new Date(2026,10,16,9);
  assert.equal(renewalOverdue(p,new Date(2026,10,15,9)),false);
  assert.equal(renewalOverdue(p,after),true);
  assert.equal(expireSubscriptions([p],after),false,'un abonnement mensuel n’expire plus à sa date');
  assert.equal(p.subscriptionStatus,'active');
  assert.equal(isTracked(p),true);
  assert.deepEqual(summary([p],after),{monthly:{USD:99.99},oneTime:{},oneTimeCount:0,nextOneTimeEnd:null,overdue:1,unpriced:0});
  assert.equal(renewalOverdue({...p,billingCycle:'one-time'},after),false,'un paiement unique n’est jamais « à vérifier » : il expire');
  assert.equal(renewalOverdue({...p,subscriptionStatus:'expired'},after),false);
});
test('Provider updates only accept the four essential fields, the status and real calendar dates',()=>{
  assert.deepEqual(validatePatch({id:'evil',snapshot:{},favorite:true,amount:0}),{favorite:true,amount:0});
  assert.deepEqual(validatePatch({plan:'  Max  ',amount:100,currency:'EUR',billingCycle:'one-time',renewalDate:'2027-01-01'}),{plan:'Max',amount:100,currency:'EUR',billingCycle:'one-time',renewalDate:'2027-01-01'});
  assert.deepEqual(validatePatch({notes:'x',statusMessage:'y',reviewed:true,nextAmount:3,priceChangeDate:'2027-01-01'}),{},'les anciens champs sont ignorés');
  assert.throws(()=>validatePatch({amount:-1}));assert.throws(()=>validatePatch({currency:'XYZ'}));
  assert.throws(()=>validatePatch({billingCycle:'weekly'}),/Fréquence/);
  assert.throws(()=>validatePatch({plan:'x'.repeat(201)}),/forfait/);
  assert.throws(()=>dateOnly('2026-02-30'));assert.equal(dateOnly('2028-02-29'),'2028-02-29');
  assert.equal(daysUntil('2026-09-08',new Date(2026,8,7,23,59)),1);
});
test('Expired subscription is excluded without losing its historic price or renewal date',()=>{
  const p={type:'subscription',active:true,subscriptionStatus:'expired',amount:18,currency:'USD',billingCycle:'monthly',renewalDate:'2026-09-25'};
  assert.equal(isTracked(p),false);
  assert.deepEqual(summary([p]),{monthly:{},oneTime:{},oneTimeCount:0,nextOneTimeEnd:null,overdue:0,unpriced:0});
  assert.deepEqual(validatePatch({subscriptionStatus:'expired'}),{subscriptionStatus:'expired'});
  assert.throws(()=>validatePatch({subscriptionStatus:'ended'}),/Statut/);
  assert.equal(isTracked({...p,active:true,subscriptionStatus:'paused'}),false);
  assert.equal(isTracked({...p,active:true,subscriptionStatus:'active'}),true);
});

test('Only one-time payments (and Ollama, back to Free) expire at their date; Ollama keeps its purchased credits',()=>{
  const paid={id:'openai',type:'subscription',active:true,subscriptionStatus:'active',amount:20,currency:'USD',billingCycle:'monthly',renewalDate:'2026-09-28'};
  const once={id:'grok',type:'subscription',active:true,subscriptionStatus:'active',amount:35,currency:'USD',billingCycle:'one-time',renewalDate:'2026-09-28'};
  const ollama={id:'ollama',type:'subscription',active:true,subscriptionStatus:'active',amount:18,currency:'USD',billingCycle:'monthly',renewalDate:'2026-09-28',snapshot:{source:'api',connectorVersion:'ollama-monthly-credits-v1',balances:[{currency:'USD',remaining:47.5}],usageCredits:{currency:'USD',remaining:2.98},quotaRemaining:79,resetAt:'2026-10-07T12:00:00Z',details:[{label:'Crédits inclus',amount:60,currency:'USD'}]}};
  const rows=[paid,once,ollama];
  assert.equal(expireSubscriptions(rows,new Date(2026,8,28,23,59)),false);
  assert.equal(expireSubscriptions(rows,new Date(2026,8,29,0,1)),true);
  assert.equal(paid.subscriptionStatus,'active','un mensuel passe « à vérifier » sans expirer');assert.equal(paid.active,true);
  assert.equal(once.subscriptionStatus,'expired');assert.equal(once.active,false);
  assert.equal(ollama.subscriptionStatus,'expired');assert.equal(ollama.active,true);
  assert.equal(isTracked(ollama),true);
  assert.deepEqual(summary(rows,new Date(2026,8,29,12)),{monthly:{USD:20},oneTime:{},oneTimeCount:0,nextOneTimeEnd:null,overdue:1,unpriced:0});
  assert.deepEqual(ollama.snapshot.balances,[]);
  assert.equal(ollama.snapshot.quotaRemaining,null);
  assert.equal(ollama.snapshot.usageCredits.remaining,2.98);
  assert.equal(expireSubscriptions(rows,new Date(2026,8,30)),false);
  assert.deepEqual(validatePatch({subscriptionStatus:'active',confirmRenewal:true,renewalDate:'2026-10-29'}),{subscriptionStatus:'active',confirmRenewal:true,renewalDate:'2026-10-29'});
});
test('OpenRouter balance is credits minus usage, including a real overdraft',()=>{
  assert.deepEqual(parseResponse('openrouter',{data:{total_credits:100.5,total_usage:25.75}}).balances,[{currency:'USD',remaining:74.75,total:100.5,used:25.75}]);
  // Un découvert réel (usage > crédits) est conservé tel quel : c'est un solde épuisé, pas une incohérence.
  assert.equal(parseResponse('openrouter',{data:{total_credits:10,total_usage:12}}).balances[0].remaining,-2);
  const real=parseResponse('openrouter',{data:{total_credits:45,total_usage:45.08283509}}).balances[0];
  assert.equal(real.remaining,45-45.08283509);
  // Seule une consommation très au-delà du plausible (découvert > max(total, 1)) est rejetée.
  assert.throws(()=>parseResponse('openrouter',{data:{total_credits:10,total_usage:25}}),/incohérent/i);
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
