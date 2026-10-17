const { test } = require('node:test');
const assert = require('node:assert/strict');
const resets = require('../lib/quota-resets.js');
const now = Date.parse('2026-09-15T10:00:00Z');
const provider = (id, windows=[]) => ({ id, type:'subscription', connected:true, snapshot:{source:'api',updatedAt:new Date(now).toISOString(),quotaWindows:windows} });
test('slots distinguish every Antigravity window and never borrow billing dates',()=>{
  const p=provider('antigravity');p.renewalDate='2026-09-19';p.snapshot.resetAt='2026-09-19T10:00:00Z';
  assert.equal(resets.slots(p).length,5);
  for(const slot of resets.slots(p))assert.equal(resets.resolve(p,slot.key,now),null);
  assert.deepEqual(resets.slots(provider('openai')).map(s=>s.key),['Codex et Work · Semaine']);
  assert.equal(resets.slots({id:'openrouter',type:'api'}).length,0);
});
test('Grok Bot keeps its own weekly reset without creating an allowance for a shared pool',()=>{
  const p=provider('grok',[{label:'Semaine',remaining:92,resetAt:'2026-10-21T18:14:00Z'},{label:'Grok Bot · Semaine',remaining:100,resetAt:'2026-10-24T14:12:00Z'}]);
  assert.deepEqual(resets.slots(p).map(s=>s.key),['Semaine','Grok Bot · Semaine']);
  assert.equal(resets.resolve(p,'Grok Bot · Semaine',now).value,'2026-10-24T14:12:00Z');
  assert.deepEqual(resets.slots(provider('grok',[{label:'Semaine',remaining:80,resetAt:null}])).map(s=>s.key),['Semaine']);
});

test('provider dates have priority over independent manual fallback',()=>{
  const p=provider('zai',[{label:'Semaine',remaining:80,resetAt:'2026-09-20T12:00:00Z'}]);
  p.manualResets=resets.validate(p,{'Semaine':{date:'2026-09-19',time:null},'5 heures':{date:'2026-09-15',time:'16:30'}});
  assert.equal(resets.resolve(p,'Semaine',now).source,'provider');
  assert.equal(resets.resolve(p,'Semaine',now).value,'2026-09-20T12:00:00Z');
  const manual=resets.resolve(p,'5 heures',now);
  assert.equal(manual.source,'manual');assert.equal(manual.precise,true);
  p.snapshot.quotaWindows[0].resetAt=null;
  assert.equal(resets.resolve(p,'Semaine',now).value,'2026-09-19');
  assert.equal(resets.resolve(p,'Semaine',now).precise,false);
});
test('date-only input never fabricates a time or refreshes a usage reading',()=>{
  const p=provider('grok',[{label:'Semaine',remaining:0,resetAt:null}]);
  p.manualResets=resets.validate(p,{'Semaine':{date:'2026-09-19'}});
  const before=JSON.stringify(p.snapshot), date=resets.resolve(p,'Semaine',now);
  assert.equal(date.precise,false);assert.equal(p.manualResets.Semaine.at,null);
  assert.equal(resets.expiry(date),+new Date(2026,8,20));
  const projected=resets.forStrategy(p);
  assert.equal(projected.snapshot.quotaWindows[0].remaining,0);
  assert.equal(projected.snapshot.updatedAt,p.snapshot.updatedAt);
  assert.equal(JSON.stringify(p.snapshot),before);
});
test('missing reset remains unknown, zero dates are rejected and removal is supported',()=>{
  const p=provider('grok');
  assert.equal(resets.resolve(p,'Semaine',now),null);
  for(const input of [{'Semaine':{date:'2026-02-30'}},{'Semaine':{date:'2026-09-19',time:'25:00'}},{'Semaine':{date:123}},{Other:{date:'2026-09-19'}}])assert.throws(()=>resets.validate(p,input));
  assert.deepEqual(resets.validate(p,{'Semaine':null}),{});
  assert.throws(()=>resets.validate({type:'api'},{}));
});
test('stale provider reset remains visible but is labelled as a last reading',()=>{
  const p=provider('openai',[{label:'Codex et Work · Semaine',resetAt:'2026-09-19T10:00:00Z'}]);
  assert.equal(resets.resolve(p,'Codex et Work · Semaine',now).stale,false);
  assert.equal(resets.resolve(p,'Codex et Work · Semaine',now+600001).stale,true);
  p.error='Session expirée';
  assert.equal(resets.resolve(p,'Codex et Work · Semaine',now).stale,true);
});
test('current-period alias retains its own date independently of weekly reset',()=>{
  const p=provider('zai',[{label:'Période en cours',resetAt:'2026-09-15T16:00:00Z'},{label:'Semaine',resetAt:'2026-09-19T10:00:00Z'}]);
  assert.equal(resets.resolve(p,'5 heures',now).value,'2026-09-15T16:00:00Z');
  assert.equal(resets.resolve(p,'Semaine',now).value,'2026-09-19T10:00:00Z');
});
