const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ollamaCookie } = require('../lib/account-browser.cjs');
test('Session transfer strictly excludes Google, WorkOS and other domains', () => {
  for(const domain of ['accounts.google.com','.google.com','signin.ollama.com','.evilollama.com','ollama.com.evil.example']) assert.equal(ollamaCookie({domain,name:'session',value:'test'}),null);
  const c=ollamaCookie({domain:'.ollama.com',name:'session',value:'test',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:1900000000});
  assert.equal(c.url,'https://ollama.com/'); assert.equal(c.sameSite,'lax'); assert.equal(c.httpOnly,true); assert.equal(c.expirationDate,1900000000);
  const host=ollamaCookie({domain:'ollama.com',name:'__Host-session',value:'test',path:'/',secure:true,httpOnly:true,expires:-1});
  assert.equal(host.domain,undefined); assert.equal(host.expirationDate,undefined);
});
