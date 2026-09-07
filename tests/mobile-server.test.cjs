const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const raw = (url, options, body) => new Promise((resolve,reject)=>{const req=http.request(url,options,res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:res.headers}));});req.on('error',reject);req.end(body);});
const { randomBytes } = require('node:crypto');
const { startMobileServer, mobileState, validateOrigin } = require('../lib/mobile-server.cjs');

test('Mobile projection omits secrets, account identity, notes and history', () => {
  const result = mobileState({history:[{private:true}],providers:[{id:'openai',name:'OpenAI',notes:'private',accountSession:{identity:'secret'},error:'token secret',snapshot:{updatedAt:'now',balances:[{currency:'USD',remaining:2,private:'secret'}],quotaWindows:[{label:'Semaine',remaining:0,token:'secret'}]}}]});
  assert.doesNotMatch(JSON.stringify(result),/secret|private|accountSession|history|identity/);
  assert.equal(result.providers[0].snapshot.quotaWindows[0].remaining,0);
});
test('Only a private Tailscale HTTPS origin is allowed', () => {
  assert.equal(validateOrigin('https://pc.tailabc.ts.net/'),'https://pc.tailabc.ts.net');
  for(const value of ['http://pc.tailabc.ts.net','https://pc.tailabc.ts.net.evil.com','https://user@pc.tailabc.ts.net','https://pc.tailabc.ts.net/path','https://pc.tailabc.ts.net:8443'])assert.throws(()=>validateOrigin(value));
});
test('Mobile server requires pairing, enforces origin, serves only allowlisted files and limits refresh', async t => {
  const token = randomBytes(24).toString('hex'); let syncs = 0;
  const server = await startMobileServer({root:path.resolve(__dirname,'..'),token,port:0,origin:'https://pc.tailabc.ts.net',getState:()=>({providers:[]}),sync:async()=>{syncs++;}});
  t.after(()=>server.close());
  const base = `http://127.0.0.1:${server.port}`;
  const post = (route, body, extra={})=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-ProvidersBar':'mobile','Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await raw(base+'/',{headers:{Host:'evil.test'}})).status,403);
  assert.equal((await post('/api/login',{code:token},{Origin:'https://evil.test'})).status,403);
  assert.equal((await post('/api/login',{code:'wrong'})).status,401);
  const login = await post('/api/login',{code:token}); assert.equal(login.status,200);
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).status,200);
  const remote = await raw(base+'/api/login',{method:'POST',headers:{Host:'pc.tailabc.ts.net',Origin:'https://pc.tailabc.ts.net','Content-Type':'application/json','X-ProvidersBar':'mobile'}},JSON.stringify({code:token}));
  assert.match(remote.headers['set-cookie'][0],/; Secure/);
  assert.equal((await post('/api/sync',{}, {Cookie:cookie})).status,202);
  assert.equal((await post('/api/sync',{}, {Cookie:cookie})).status,429);
  assert.equal(syncs,1);
  assert.equal((await post('/api/provider/disconnect',{}, {Cookie:cookie})).status,404);
  for(const route of ['/main.cjs','/.local/credentials.json','/data/state.json','/assets/providers/sources.json'])assert.equal((await fetch(base+route)).status,404);
  assert.equal((await fetch(base+'/assets/providers/gemini.svg')).status,200);
  assert.equal((await fetch(base+'/api/state',{headers:{Cookie:cookie}})).headers.get('cache-control'),'no-store');
  const logout=await post('/api/logout',{}, {Cookie:cookie});assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
});
test('Pairing attempts are bounded', async t => {
  const server = await startMobileServer({root:path.resolve(__dirname,'..'),token:'valid',port:0,getState:()=>({providers:[]}),sync:async()=>{}});
  t.after(()=>server.close());const base=`http://127.0.0.1:${server.port}`;
  for(let i=0;i<11;i++){
    const response=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'X-ProvidersBar':'mobile','Content-Type':'application/json'},body:'{"code":"wrong"}'});
    assert.equal(response.status,i<10?401:429);
  }
});
