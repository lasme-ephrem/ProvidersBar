const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ollamaCookie, openSubscriptionBrowser } = require('../lib/account-browser.cjs');

test('Repeated Grok automatic refreshes use no browser window; login and explicit checks remain visible', async () => {
  const launches = [];
  const dependencies = {
    openLogin: async (...args) => { launches.push({ kind: 'login', args }); return {}; },
    openReader: async (...args) => { launches.push({ kind: 'reader', args }); return {}; },
  };
  for (let i = 0; i < 3; i++) await openSubscriptionBrowser('fixture-profile', 'grok', true, {}, dependencies);
  assert.equal(launches.length, 3);
  for (const launch of launches) {
    assert.equal(launch.kind, 'reader');
    assert.equal(launch.args[2], true, 'automatic Grok readings must be headless');
    assert.equal(launch.args[3].minimized, false, 'a minimized window is still an unwanted window');
  }
  await openSubscriptionBrowser('fixture-profile', 'grok', true, { interactive: true }, dependencies);
  assert.equal(launches.at(-1).args[2], false);
  await openSubscriptionBrowser('fixture-profile', 'grok', false, {}, dependencies);
  assert.equal(launches.at(-1).kind, 'login');
});
test('Session transfer strictly excludes Google, WorkOS and other domains', () => {
  for(const domain of ['accounts.google.com','.google.com','signin.ollama.com','.evilollama.com','ollama.com.evil.example']) assert.equal(ollamaCookie({domain,name:'session',value:'test'}),null);
  const c=ollamaCookie({domain:'.ollama.com',name:'session',value:'test',path:'/',secure:true,httpOnly:true,sameSite:'Lax',expires:1900000000});
  assert.equal(c.url,'https://ollama.com/'); assert.equal(c.sameSite,'lax'); assert.equal(c.httpOnly,true); assert.equal(c.expirationDate,1900000000);
  const host=ollamaCookie({domain:'ollama.com',name:'__Host-session',value:'test',path:'/',secure:true,httpOnly:true,expires:-1});
  assert.equal(host.domain,undefined); assert.equal(host.expirationDate,undefined);
});
