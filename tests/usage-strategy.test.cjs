const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recommend, defaults, validate, routes } = require('../lib/usage-strategy.js');
const now = Date.parse('2026-09-12T12:00:00Z');
const future = '2026-09-14T12:00:00Z';
const w = (label, remaining, resetAt = future) => ({ label, remaining, resetAt });
function provider(id, windows = [], extra = {}) {
  return { id, name: id, active: true, connected: true, error: null, ...extra,
    snapshot: { source: 'api', updatedAt: new Date(now).toISOString(), quotaWindows: windows, balances: [], quotaRemaining: null, ...extra.snapshot } };
}
const wallet = (id, remaining, extra = {}) => provider(id, [], { type: id==='ollama'?'subscription':'api', snapshot: { balances: [{ currency: 'USD', remaining }] }, ...extra });
test('recommendations contain only usable subscriptions and API providers stay separate', () => {
  const r = recommend([provider('grok', [w('Semaine', 1)]), wallet('orcarouter', 30)], {}, now);
  assert.equal(r.recommended.providerId, 'grok');
  assert.equal(r.queue.length, 1);
  assert.ok(r.queue.every(x=>x.kind==='subscription'));
  assert.equal(r.apiProviders[0].balance, 30);
});
test('Legacy Grok Bot and Grok stay independent; shared pools never become two allowances', () => {
  const p = provider('grok', [w('Semaine', 92), w('Grok Bot · Semaine', 0)]);
  let r = recommend([p], {}, now);
  assert.equal(r.recommended.id, 'grok');
  assert.equal(r.recommended.remaining, 92);
  assert.equal(r.subscriptions.find(x => x.id === 'grok-bot').status, 'blocked');
  p.snapshot.quotaWindows = [w('Semaine', 20)];
  r = recommend([p], {}, now);
  assert.equal(r.subscriptions.length, 1);
  assert.equal(r.subscriptions[0].id, 'grok');
});

test('quality precedes renewal; identical model uses earliest known renewal', () => {
  const zai = provider('zai', [w('5 heures', 80), w('Semaine', 80)]);
  const ollama = wallet('ollama', 40, { snapshot: { connectorVersion: 'ollama-monthly-credits-v1', balances: [{currency:'USD', remaining:40}], resetAt:'2026-09-13T12:00:00Z' } });
  let r = recommend([zai, ollama], {}, now);
  assert.equal(r.recommended.providerId, 'ollama');
  r = recommend([zai, ollama, provider('openai', [w('Codex et Work · 5 heures', 100), w('Codex et Work · Semaine', 1)])], {}, now);
  assert.equal(r.recommended.model, 'astra');
});
test('Claude Pro enters the subscription queue only when both shared limits are readable', () => {
  const claude=provider('claude',[w('5 heures',88),w('Semaine',91)]);
  const openai=provider('openai',[w('Codex et Work · 5 heures',100),w('Codex et Work · Semaine',90)]);
  let r=recommend([claude,openai],{},now);
  assert.equal(r.recommended.providerId,'claude');
  assert.equal(r.recommended.model,'opus55');
  claude.snapshot.quotaWindows=[w('Semaine',91)];
  r=recommend([claude,openai],{},now);
  assert.equal(r.recommended.providerId,'openai');
  assert.equal(r.subscriptions.find(x=>x.providerId==='claude').status,'unknown');
});
test('Antigravity groups are independent, but both windows constrain each group', () => {
  const p = provider('antigravity', [w('Gemini · Semaine', 90), w('Gemini · 5 heures', 0), w('Claude et GPT · Semaine', 50), w('Claude et GPT · 5 heures', 70)]);
  const r = recommend([p, wallet('openrouter', 30)], {}, now);
  assert.equal(r.recommended.id, 'antigravity-claude');
  assert.equal(r.subscriptions.find(x => x.id === 'antigravity-gemini').status, 'blocked');
  assert.equal(r.subscriptions.find(x => x.id === 'antigravity-claude').remaining, 50);
});

test('Argon uses its own weekly limit without borrowing or blocking other Antigravity groups', () => {
  const p = provider('antigravity', [w('Gemini · Semaine', 0), w('Gemini · 5 heures', 0), w('Gemini 4 Argon · Semaine', 88)]);
  let r = recommend([p], {}, now);
  assert.equal(r.recommended.id, 'antigravity-argon');
  assert.equal(r.recommended.remaining, 88);
  assert.equal(r.recommended.quality, null);
  p.snapshot.quotaWindows.pop();
  r = recommend([p], {}, now);
  assert.equal(r.subscriptions.find(x => x.id === 'antigravity-argon').status, 'unknown');
  assert.equal(r.recommended, null);
});

test('Claude model-specific quotas constrain only the selected model', () => {
  const p = provider('claude', [w('5 heures', 91), w('Semaine', 58), w('Fable · Semaine', 0), w('Sonnet · Semaine', 0)]);
  assert.equal(recommend([p], {}, now).recommended.remaining, 58);
  p.snapshot.quotaWindows.push(w('Opus · Semaine', 0));
  assert.equal(recommend([p], {}, now).recommended, null);
  assert.equal(recommend([p], {}, now).subscriptions[0].status, 'blocked');
});
test('missing Antigravity window is unknown and aggregate never fills another group', () => {
  const r = recommend([provider('antigravity', [w('Gemini · Semaine', 80)], {snapshot:{quotaRemaining:100}}), wallet('openrouter', 1)], {}, now);
  assert.equal(r.recommended, null);
  assert.equal(r.mode, 'verify');
  assert.ok(r.subscriptions.filter(x=>x.providerId==='antigravity').every(x=>x.status==='unknown'));
});
test('renewal never assumes a restored quota, even before freshness deadline', () => {
  const p = provider('openai', [w('Codex et Work · 5 heures', 100), w('Codex et Work · Semaine', 0, new Date(now - 1000).toISOString())]);
  assert.equal(recommend([p, wallet('openrouter', 1)], {}, now).mode, 'verify');
  p.snapshot.quotaWindows = [w('Codex et Work · 5 heures', 100), w('Codex et Work · Semaine', 100)];
  assert.equal(recommend([p, wallet('openrouter', 1)], {}, now).recommended.providerId, 'openai');
});
test('OpenAI requires both the five-hour and weekly windows, and never borrows Spark', () => {
  // A weekly-only report is visible but explicitly incomplete: never "ready".
  const weeklyOnly = provider('openai', [w('Codex et Work · Semaine', 90)]);
  let r = recommend([weeklyOnly, wallet('openrouter', 1)], {}, now);
  assert.equal(r.recommended, null);
  assert.equal(r.subscriptions.find(x => x.id === 'openai').status, 'unknown');
  assert.match(r.subscriptions.find(x => x.id === 'openai').reason, /incomplet/i);
  // A five-hour-only report is incomplete too.
  const hourlyOnly = provider('openai', [w('Codex et Work · 5 heures', 90)]);
  r = recommend([hourlyOnly, wallet('openrouter', 1)], {}, now);
  assert.equal(r.subscriptions.find(x => x.id === 'openai').status, 'unknown');
  assert.equal(r.mode, 'verify');
  // Both windows: the most constrained one drives the readiness.
  const complete = provider('openai', [w('Codex et Work · 5 heures', 80), w('Codex et Work · Semaine', 95)]);
  r = recommend([complete], {}, now);
  assert.equal(r.recommended.providerId, 'openai');
  assert.equal(r.recommended.remaining, 80);
  // Spark never substitutes for the main Codex quota.
  const sparkOnly = provider('openai', [w('Spark · Semaine', 100)]);
  r = recommend([sparkOnly, wallet('openrouter', 1)], {}, now);
  assert.equal(r.recommended, null);
  assert.equal(r.mode, 'verify');
  assert.equal(r.subscriptions.find(x => x.id === 'openai').status, 'unknown');
});
test('OpenAI main quota does not borrow Spark allowance and honors a returned hourly limit', () => {
  const p = provider('openai', [w('Codex et Work · 5 heures', 100), w('Codex et Work · Semaine', 0), w('Spark · Semaine', 100)]);
  assert.equal(recommend([p, wallet('openrouter', 1)], {}, now).recommended, null);
  p.snapshot.quotaWindows = [w('Codex et Work · 5 heures', 0), w('Codex et Work · Semaine', 100)];
  assert.equal(recommend([p, wallet('openrouter', 1)], {}, now).recommended, null);
  p.snapshot.quotaWindows = [w('Spark · Semaine', 100)];
  assert.equal(recommend([p, wallet('openrouter', 1)], {}, now).mode, 'verify');
});
test('stale, disconnected and failed subscriptions are not treated as exhausted', () => {
  for (const patch of [{error:'Offline'}, {connected:false}, {snapshot:{updatedAt:new Date(now - 600001).toISOString()}}]) {
    assert.equal(recommend([provider('grok', [w('Semaine',80)], patch), wallet('openrouter', 2)], {}, now).mode, 'verify');
  }
  assert.equal(recommend([provider('grok', [w('Semaine',80)], {active:false}), wallet('openrouter', 2)], {}, now).recommended, null);
});
test('expired subscriptions are excluded even if a previous quota and active flag remain', () => {
  const expired=provider('zai',[w('5 heures', 100),w('Semaine', 100)],{subscriptionStatus:'expired',statusMessage:'Renouvellement indisponible.'});
  const r=recommend([expired,wallet('orcarouter',2)],{},now);
  assert.equal(r.recommended,null);
  assert.equal(r.subscriptions.some(x=>x.providerId==='zai'),false);
  assert.equal(r.apiProviders[0].providerId,'orcarouter');
});
test('Gemini web is absent while Antigravity and Gemini API remain', () => {
  const r=recommend([provider('gemini',[w('Semaine',100)]),wallet('openrouter',10)],{},now);
  assert.ok(!r.subscriptions.some(x=>x.providerId==='gemini'));
  assert.ok(!r.subscriptions.some(x=>x.id==='antigravity-gemini'));
  assert.ok(r.api.some(x=>x.model==='geminiFlash'));
  assert.equal(r.recommended,null);
});
test('API availability indicators contain each wallet once, sorted by actual credits descending', () => {
  const r = recommend([wallet('orcarouter',50),wallet('runinfra',5),wallet('openrouter',2),wallet('deepseek',10)], {}, now);
  assert.deepEqual(r.apiProviders.map(x=>x.providerId), ['orcarouter','deepseek','runinfra','openrouter']);
  assert.equal(new Set(r.apiProviders.map(x=>x.providerId)).size, r.apiProviders.length);
  assert.deepEqual(r.queue, []);
  assert.equal(r.recommended, null);
  assert.equal(r.api.filter(x=>x.providerId==='openrouter' && x.status==='ready').length, 6);
});

test('API credit order is independent of model pricing, token profile and excluded routes', () => {
  const providers = [wallet('openrouter',20),wallet('orcarouter',10),wallet('deepseek',5)];
  const order = cfg => recommend(providers,cfg,now).apiProviders.map(x=>[x.providerId,x.balance]);
  assert.deepEqual(order({}), [['openrouter',20],['orcarouter',10],['deepseek',5]]);
  assert.deepEqual(order({ inputTokens:1000000, outputTokens:1000000, disabledRoutes:routes.map(r=>r.id) }), order({}));
  const unavailable = [wallet('runinfra',50,{error:'Offline'}),wallet('openrouter',30,{active:false}),wallet('deepseek',25,{snapshot:{updatedAt:new Date(now-600001).toISOString(),balances:[{currency:'USD',remaining:25}]}})];
  assert.deepEqual(recommend(unavailable,{},now).apiProviders,[]);
});
test('wallet exhaustion and unknown currency exclude wallet indicators; tiny positive credits stay visible', () => {
  for (const amount of [0,-2]) {
    const r = recommend([wallet('orcarouter', amount), wallet('deepseek', 1)], {}, now);
    assert.equal(r.apiProviders[0].providerId,'deepseek');
  }
  const p = wallet('orcarouter',1); p.snapshot.balances[0].currency='EUR';
  assert.equal(recommend([p],{},now).recommended,null);
});
test('Contributor requires explicit consent; revocation excludes it immediately', () => {
  const p = wallet('openrouter',1);
  assert.equal(recommend([p],{},now).api.find(x=>x.consent).status,'disabled');
  const r = recommend([p],{contributor:true, inputTokens:1000, outputTokens:1000},now);
  assert.equal(r.api.find(x=>x.consent).status,'ready');
  assert.equal(recommend([p],{contributor:false},now).api.find(x=>x.consent).status,'disabled');
});
test('DeepSeek peak windows use UTC with correct boundary and weekend behavior', () => {
  const p = wallet('deepseek',10);
  const costAt = time => { const t = Date.parse(time); p.snapshot.updatedAt=time; return recommend([p],{inputTokens:1000,outputTokens:1000},t).api.find(x=>x.providerId==='deepseek').cost; };
  const off = costAt('2026-09-14T00:59:00Z');
  assert.equal(costAt('2026-09-14T01:00:00Z'),off*2);
  assert.equal(costAt('2026-09-14T04:00:00Z'),off);
  assert.equal(costAt('2026-09-14T06:00:00Z'),off*2);
  assert.equal(costAt('2026-09-14T10:00:00Z'),off);
  assert.equal(costAt('2026-09-12T02:00:00Z'),off);
});
test('cache and long context change estimates; Gemini promotion has an end date', () => {
  const p = wallet('openrouter',10);
  const row = (cfg={}, time=now, model='luna') => { p.snapshot.updatedAt=new Date(time).toISOString();return recommend([p],cfg,time).api.find(x=>x.model===model&&x.providerId==='openrouter'); };
  assert.ok(row({cachePercent:100}).cost < row().cost);
  assert.equal(row({inputTokens:272000}).input,.2);
  assert.equal(row({inputTokens:272001}).input,.4);
  assert.ok(Math.abs(row({inputTokens:272001}).output-1.8)<1e-12);
  assert.equal(row({},Date.parse('2027-01-01T00:00:00Z'),'geminiFlash').output,7.5);
});
test('configuration is validated and a disabled strategy has no recommendation', () => {
  for (const bad of [{contributor:'yes'}, {cachePercent:101}, {inputTokens:NaN}, {outputTokens:-1}, {subscriptionModels:{openai:'muse'}}, {disabledRoutes:['bogus']}, {unknown:true}]) assert.throws(()=>validate(bad));
  assert.equal(defaults().contributor,false);
  assert.equal(recommend([wallet('openrouter',10)],{enabled:false},now).recommended,null);
  const cfg={disabledRoutes:routes.map(x=>x.id)};
  assert.equal(recommend([wallet('openrouter',10)],cfg,now).mode,'empty');
});
test('manual quota is usable but no fabricated Antigravity group or Ollama included balance', () => {
  const p=provider('openai',[],{connected:false,snapshot:{source:'manual',quotaRemaining:65}});
  assert.equal(recommend([p],{},now).recommended.providerId,'openai');
  p.id='antigravity';
  assert.equal(recommend([p],{},now).recommended,null);
  p.id='ollama';p.snapshot.balances=[{currency:'USD',remaining:100}];
  assert.equal(recommend([p],{},now).recommended,null);
});
