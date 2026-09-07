const {chromium, devices} = require('playwright');
const {startMobileServer} = require('../lib/mobile-server.cjs');
const {createSeed} = require('../lib/seed.cjs');
const {randomBytes} = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async()=>{
  const state=createSeed(),token=randomBytes(24).toString('hex');
  state.providers.forEach(p=>{p.connected=true;p.snapshot={updatedAt:new Date().toISOString(),quotaRemaining:88,balances:[],quotaWindows:[{label:'Semaine',remaining:88},{label:'5 heures',remaining:92}]};});
  state.providers.find(p=>p.id==='antigravity').snapshot.quotaWindows=[{label:'Gemini · Semaine',remaining:98},{label:'Gemini · 5 heures',remaining:92},{label:'Claude et GPT · Semaine',remaining:100},{label:'Claude et GPT · 5 heures',remaining:100}];
  state.providers.find(p=>p.id==='openai').snapshot.quotaWindows=[{label:'Codex et Work · Semaine',remaining:88}];
  let syncs=0,server,browser;
  try{
    server=await startMobileServer({root:path.resolve(__dirname,'..'),token,port:0,getState:()=>state,sync:async()=>{syncs++;}});
    browser=await chromium.launch({channel:'msedge',headless:true});
    const context=await browser.newContext({...devices['iPhone 13'],defaultBrowserType:undefined});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.port}`);await page.locator('#code').fill(token);await page.locator('#pair button').click();
    await page.waitForSelector('.card');assert.equal(await page.locator('.card').count(),10);
    assert.equal(await page.locator('[data-provider="antigravity"] .period').count(),4);
    assert.equal(await page.locator('[data-provider="openai"] .period').count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.waitForFunction(()=>[...document.querySelectorAll('.logo img')].every(i=>i.complete&&i.naturalWidth>0));
    await page.locator('[data-action="sync"]').click();await page.waitForTimeout(100);assert.equal(syncs,1);
    await page.locator('[data-filter="subscription"]').click();assert.equal(await page.locator('.card').count(),6);
    await page.locator('[data-filter="all"]').click();
    await fs.mkdir(path.resolve('test-results'),{recursive:true});await page.screenshot({path:path.resolve('test-results/mobile.png'),fullPage:true});
    await context.setOffline(true);await page.evaluate(()=>load());assert.match(await page.locator('.connection').innerText(),/injoignable/);assert.equal(await page.locator('.card').count(),10);
    await context.setOffline(false);await page.evaluate(()=>load());assert.doesNotMatch(await page.locator('.connection').innerText(),/injoignable/);
    await page.locator('[data-action="logout"]').click();await page.waitForSelector('#code');await page.reload();await page.waitForSelector('#code');
    assert.deepEqual(errors,[]);console.log('PASS mobile: pairing, 10 accounts, quotas, logos, filters, refresh, offline/recovery, logout, iPhone viewport.');
  }finally{await browser?.close();await server?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
