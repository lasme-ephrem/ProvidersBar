const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseAntigravityQuota,fetchAntigravityQuota}=require('../lib/antigravity-account.cjs');
const {addAntigravity}=require('../lib/migrations.cjs');
const {createSeed}=require('../lib/seed.cjs');
function response(){return {response:{groups:[{displayName:'Gemini Models',buckets:[{bucketId:'gemini-weekly',window:'weekly',remainingFraction:.9779,resetTime:'2026-09-10T23:06:43Z'},{bucketId:'gemini-5h',window:'5h',remainingFraction:.9351,resetTime:'2026-09-07T18:32:42Z'}]},{displayName:'Claude and GPT models',buckets:[{bucketId:'3p-weekly',window:'weekly',remainingFraction:1},{bucketId:'3p-5h',window:'5h',remainingFraction:1}]}]}};}
test('Antigravity reads four distinct quotas and matches desktop rounding, without interpreting credits as dollars',()=>{
 const data=response();data.response.email='private@example.test';data.response.credits=500;
 const snapshot=parseAntigravityQuota(data);
 assert.equal(snapshot.quotaRemaining,94);assert.equal(snapshot.quotaWindows.length,4);
 assert.deepEqual(snapshot.quotaWindows.map(w=>w.remaining),[98,94,100,100]);
 assert.equal(snapshot.resetAt,'2026-09-07T18:32:42.000Z');assert.deepEqual(snapshot.balances,[]);
 assert.ok(!JSON.stringify(snapshot).includes('private'));assert.ok(!JSON.stringify(snapshot).includes('500'));
});
test('Unknown, missing, disabled and conflicting buckets never fabricate 100% remaining',()=>{
 for(const value of [null,undefined,NaN,Infinity,-.1,1.1,'0.5']) {const data=response();data.response.groups[0].buckets[0].remainingFraction=value;assert.throws(()=>parseAntigravityQuota(data));}
 assert.throws(()=>parseAntigravityQuota({response:{groups:[]}}));
 const data=response();data.response.groups[0].buckets[0].disabled=true;assert.equal(parseAntigravityQuota(data).quotaWindows.length,3);
 data.response.groups[1].buckets.push(data.response.groups[1].buckets[0]);assert.throws(()=>parseAntigravityQuota(data),/contradictoires/);
 const zero=response();zero.response.groups[0].buckets[0].remainingFraction=0;assert.equal(parseAntigravityQuota(zero).quotaRemaining,0);
});
test('Local discovery handles a closed app and skips non-HTTP service ports without exposing local tokens',async()=>{
 await assert.rejects(fetchAntigravityQuota({discover:async()=>[]}),/Aucune CLI/);
 let calls=0;
 const snapshot=await fetchAntigravityQuota({discover:async()=>[{port:1},{port:2}],request:async()=>{if(++calls===1)throw new Error('private token');return response();}});
 assert.equal(snapshot.quotaRemaining,94);assert.equal(calls,2);
 await assert.rejects(fetchAntigravityQuota({discover:async()=>[{}],request:async()=>{throw new Error('private token')}}),error=>!error.message.includes('private token'));
});
test('Adding Antigravity preserves Gemini web sessions, existing billing and historical readings',()=>{
 const state=createSeed();state.providers=state.providers.filter(p=>p.id!=='antigravity');
 const gemini=state.providers.find(p=>p.id==='gemini');Object.assign(gemini,{name:'Gemini',accountSession:{kind:'subscription-browser'},amount:109.99,snapshot:{quotaRemaining:100}});
 state.history.push({providerId:'gemini',quotaRemaining:100});const before=structuredClone(state);
 const result=addAntigravity(state);assert.equal(result.changed,true);assert.equal(result.state.providers.length,10);
 assert.deepEqual(result.state.providers.find(p=>p.id==='gemini'),{...gemini,name:'Gemini web'});
 assert.equal(result.state.providers.find(p=>p.id==='antigravity').snapshot,null);
 assert.deepEqual(result.state.history,before.history);assert.deepEqual(state,before);assert.equal(addAntigravity(result.state).changed,false);
});
