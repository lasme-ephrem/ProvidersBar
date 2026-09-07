const { _electron: electron } = require(process.env.PROVIDERSBAR_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const results=path.join(root,'test-results');
let desktop;
async function launch(dataDir){
  const env={...process.env,PROVIDERSBAR_DATA_DIR:dataDir};
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({executablePath:process.env.PROVIDERSBAR_EXECUTABLE || require('electron'),args:process.env.PROVIDERSBAR_EXECUTABLE?[]:[root],cwd:root,env,timeout:30000});
}
async function main(){
  await fs.mkdir(results,{recursive:true});
  const dataDir=await fs.mkdtemp(path.join(results,'smoke-data-'));
  desktop=await launch(dataDir);
  let page=await desktop.firstWindow();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('.cards .card');
  assert.equal(await page.locator('.cards .card').count(),10);
  await page.screenshot({path:path.join(results,'dashboard.png'),fullPage:true});
  await page.screenshot({path:path.join(results,'dashboard-window.png')});
  await page.locator('[data-nav="subscriptions"]').first().click();
  assert.equal(await page.locator('.data-table tbody tr').count(),6);
  await page.screenshot({path:path.join(results,'subscriptions.png'),fullPage:true});
  await page.locator('[data-nav="connections"]').click();
  assert.equal(await page.locator('.connection-card').count(),10);
  await page.screenshot({path:path.join(results,'connections.png'),fullPage:true});
  await page.locator('[data-nav="overview"]').click();
  await page.locator('#search').fill('deepseek');
  assert.equal(await page.locator('.cards .card').count(),1);
  await page.locator('#search').fill('');
  await page.locator('[data-filter="api"]').click();
  assert.equal(await page.locator('.cards .card').count(),4);
  await page.locator('[data-filter="all"]').click();
  await page.locator('[data-open="openai"]').click();
  await page.screenshot({path:path.join(results,'provider-details.png')});
  await page.locator('#plan').fill('Offre de test');
  await page.locator('#amount').fill('103');
  await page.locator('#billingCycle').selectOption('monthly');
  await page.locator('#renewalDate').fill('2026-10-05');
  await page.locator('[name="reviewed"]').check();
  await page.locator('#provider-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert.ok((await page.locator('.stats').innerText()).includes('103'));
  await page.locator('[data-open="openai"]').click();
  await page.locator('[data-dialog-tab="manual"]').click();
  await page.locator('#quotaRemaining').fill('62');
  await page.locator('#manual-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  await page.locator('[data-nav="history"]').click();
  await page.locator('#history-provider').selectOption('openai');
  assert.equal(await page.locator('.chart-panel').count(),1);
  assert.ok((await page.locator('.data-table').innerText()).includes('62 %'));
  await page.screenshot({path:path.join(results,'history.png'),fullPage:true});
  // Only these smoke tests replace the network transport; application code is unchanged.
  await desktop.evaluate(()=>{
    globalThis.fetch=async(_url,options)=>{
      if(options.headers.Authorization==='Bearer test-rejected')return {ok:false,status:403};
      return {ok:true,json:async()=>({data:{total_credits:100,total_usage:25.5}})};
    };
  });
  await page.locator('[data-nav="connections"]').first().click();
  await page.locator('[data-open="openrouter"]').click();
  await page.locator('#api-key').fill('test-rejected');
  await page.locator('#connection-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#connection-form .form-error').textContent.includes('clé de gestion'));
  await page.locator('#api-key').fill('test-secret-never-export');
  await page.locator('#connection-form button[type="submit"]').click();
  await page.waitForSelector('.connection-success');
  assert.equal(await page.locator('#api-key').inputValue(),'');
  const secretText=await fs.readFile(path.join(dataDir,'credentials.json'),'utf8');
  assert.ok(!secretText.includes('test-secret-never-export'));
  await page.locator('[data-action="close-dialog"]').click();
  // Verify both new connectors through the real IPC and encrypted credential store.
  await desktop.evaluate(()=>{
    globalThis.fetch=async(url)=>{
      if(url==='https://api.runinfra.ai/v1/credits')return {ok:true,json:async()=>({object:'credits',currency:'usd',balance_cents:5476,available_cents:5476,held_cents:34,period:{spent_cents:1500}})};
      if(url==='https://api.orcarouter.ai/v1/dashboard/billing/subscription')return {ok:true,json:async()=>({object:'billing_subscription',hard_limit_usd:19.25})};
      throw new Error('Unexpected endpoint');
    };
  });
  for(const [id,amount] of [['runinfra',54.76]]){
    await page.locator('[data-open="'+id+'"]').click();
    await page.locator('#api-key').fill('test-secret-'+id);
    await page.locator('#connection-form button[type="submit"]').click();
    await page.waitForSelector('.connection-success');
    const connected=await page.evaluate(()=>window.providersBar.getState());
    assert.equal(connected.providers.find(p=>p.id===id).snapshot.balances[0].remaining,amount);
    assert.equal(connected.providers.find(p=>p.id===id).connected,true);
    assert.ok(!(await fs.readFile(path.join(dataDir,'credentials.json'),'utf8')).includes('test-secret'));
    await page.locator('[data-action="disconnect"]').click();
    await page.waitForFunction(()=>!document.querySelector('.connection-success'));
    await page.locator('[data-action="close-dialog"]').click();
  }
  await desktop.evaluate(({session})=>{
    const isolated=session.fromPartition('persist:orcarouter-account');
    isolated.protocol.handle('https',()=>new Response('<!doctype html><title>Orca account test</title><p>Simulated login page</p>',{headers:{'content-type':'text/html'}}));
    isolated.fetch=async(url,options)=>{
      if(options.headers['New-API-User']!=='12'||options.headers['X-Workspace-Id']!=='34')throw new Error('Wrong workspace');
      if(url==='https://www.orcarouter.ai/api/user/self')return {ok:true,json:async()=>({success:true,data:{id:12,active_workspace:{id:34,wallet_quota:26600000}}})};
      if(url==='https://www.orcarouter.ai/api/status')return {ok:true,json:async()=>({success:true,data:{quota_per_unit:500000}})};
      throw new Error('Unexpected wallet endpoint');
    };
  });
  await page.locator('[data-open="orcarouter"]').click();
  assert.equal(await page.locator('#api-key').count(),0);
  const accountOpened=desktop.waitForEvent('window');
  await page.locator('[data-action="orca-open"]').click();
  const accountWindow=await accountOpened;
  await accountWindow.waitForURL('https://www.orcarouter.ai/console');
  assert.ok(accountWindow);
  assert.equal(await accountWindow.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await accountWindow.evaluate(()=>typeof window.providersBar),'undefined');
  assert.ok((await page.locator('#orca-connection-progress').innerText()).includes('automatiquement'));
  assert.equal(await page.locator('.connection-success').count(),0);
  // Sign in after the login page has loaded. No second click in ProvidersBar.
  await accountWindow.evaluate(()=>{localStorage.setItem('user',JSON.stringify({id:12}));localStorage.setItem('active_workspace_id','34');});
  await page.waitForSelector('.connection-success');
  assert.ok((await page.locator('.dialog-body').innerText()).includes('53,20'));
  await page.screenshot({path:path.join(results,'orca-account.png')});
  let orcaState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(orcaState.providers.find(p=>p.id==='orcarouter').snapshot.balances[0].remaining,53.2);
  assert.equal(orcaState.providers.find(p=>p.id==='orcarouter').connected,true);
  await desktop.evaluate(({session})=>{session.fromPartition('persist:orcarouter-account').fetch=async()=>({ok:false,status:401});});
  orcaState=await page.evaluate(()=>window.providersBar.syncOne('orcarouter'));
  assert.match(orcaState.providers.find(p=>p.id==='orcarouter').error,/expirée/);
  assert.equal(orcaState.providers.find(p=>p.id==='orcarouter').snapshot.balances[0].remaining,53.2);
  await page.locator('[data-action="close-dialog"]').click();
  await page.locator('[data-nav="overview"]').click();
  const router=page.locator('.card').filter({has:page.locator('[data-open="openrouter"]')});
  await desktop.evaluate(({session})=>{
    const isolated=session.fromPartition('persist:ollama-account');
    isolated.protocol.handle('https',()=>new Response('<!doctype html><title>Ollama account test</title><p>Signed-in settings</p>',{headers:{'content-type':'text/html'}}));
    isolated.fetch=async url=>{
      if(url!=='https://ollama.com/settings')throw new Error('Unexpected settings URL');
      return {ok:true,status:200,url,text:async()=>'<h2>Included usage Pro</h2><h3>Monthly usage</h3><span>$12.50 of $60.00 used</span><span data-time="2026-10-07T12:00:00Z">Resets</span><h3>Extra usage</h3>$99.00'};
    };
  });
  await page.locator('[data-open="ollama"]').click();
  await page.locator('[data-dialog-tab="connection"]').click();
  const ollamaOpened=desktop.waitForEvent('window');
  await page.locator('[data-action="ollama-email"]').click();
  const ollamaWindow=await ollamaOpened;
  await ollamaWindow.waitForURL('https://ollama.com/settings');
  assert.equal(await ollamaWindow.evaluate(()=>typeof window.providersBar),'undefined');
  assert.equal(await desktop.evaluate(({BrowserWindow,session})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('https://ollama.com')).webContents.session===session.fromPartition('persist:orcarouter-account')),false);
  await page.waitForSelector('.connection-success');
  await page.screenshot({path:path.join(results,'ollama-account.png')});
  let ollamaState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').snapshot.balances[0].remaining,47.5);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').amount,null);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').connected,true);
  await desktop.evaluate(({session})=>{session.fromPartition('persist:ollama-account').fetch=async()=>({ok:false,status:302});});
  ollamaState=await page.evaluate(()=>window.providersBar.syncOne('ollama'));
  assert.match(ollamaState.providers.find(p=>p.id==='ollama').error,/expirée/);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').snapshot.balances[0].remaining,47.5);
  await page.locator('[data-action="close-dialog"]').click();
  assert.ok((await router.innerText()).includes('74,50'));
  // A failed refresh must retain the last valid measurement.
  await desktop.evaluate(()=>{globalThis.fetch=async()=>({ok:false,status:429});});
  await page.locator('[data-action="sync"]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.card-error')].some(el=>el.textContent.includes('Trop de demandes')));
  assert.ok((await router.innerText()).includes('74,50'));
  await page.locator('[data-open="openrouter"]').click();
  await page.locator('[data-dialog-tab="connection"]').click();
  await page.locator('[data-action="disconnect"]').click();
  await page.waitForFunction(()=>!document.querySelector('.connection-success'));
  await page.locator('[data-action="close-dialog"]').click();
  await page.locator('[data-favorite="grok"]').click();
  await page.locator('[data-nav="settings"]').click();
  await page.locator('[name="autoRefresh"]').uncheck();
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Préférences enregistrées.');
  // New account connectors: actual renderer/IPC/controller, simulated browser transport.
  await desktop.evaluate(({app})=>{
    const openai=process.mainModule.require('./lib/openai-account.cjs');
    openai.openCodexRpc=async()=>({close(){},request:async method=>method==='account/read'?{account:{type:'chatgpt',email:'smoke@example.test'}}:{rateLimitsByLimitId:{codex:{primary:{usedPercent:38,windowDurationMins:10080,resetsAt:1900000000}}}}});
    const transport=process.mainModule.require('./lib/account-browser.cjs');
    transport.openSubscriptionBrowser=async(_dataDir,id)=>{
      let open=true;
      return {isOpen:()=>open,close:async()=>{open=false;},readSubscriptionPage:async()=>({authenticated:true,windows:[{label:'5 heures',remaining:80,resetAt:null},{label:'Semaine',remaining:id==='openai'?62:45,resetAt:null}]})};
    };
  });
  await page.locator('[data-nav="connections"]').click();
  for(const id of ['openai','gemini','grok','zai']) {
    await page.locator('[data-open="'+id+'"]').click();
    assert.equal(await page.locator('#api-key').count(),0);
    assert.equal(await page.locator('[data-action="ollama-open"]').count(),0);
    await page.locator('[data-action="account-open"]').click();
    await page.waitForSelector('#account-connection-progress');
    if(id!=='openai')await page.locator('[data-action="account-verify"]').click();
    await page.waitForSelector('.connection-success');
    assert.ok((await page.locator('.dialog-body').innerText()).includes('Semaine'));
    const connected=await page.evaluate(()=>window.providersBar.getState());
    assert.equal(connected.providers.find(p=>p.id===id).connected,true);
    assert.equal(connected.providers.find(p=>p.id===id).snapshot.balances.length,0);
    if(id==='openai')assert.equal(connected.providers.find(p=>p.id===id).amount,103);
    if(id!=='zai') {
      await page.locator('[data-action="disconnect"]').click();
      await page.waitForFunction(()=>!document.querySelector('.connection-success'));
    }
    await page.locator('[data-action="close-dialog"]').click();
  }
  await page.screenshot({path:path.join(results,'connections-updated.png'),fullPage:true});
  // Run the exact settings reader inside real sandboxed Chromium documents.
  const readings=await desktop.evaluate(async({app,BrowserWindow,session})=>{
    const {accounts,inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('subscription-dom-test');
    isolated.protocol.handle('https',()=>new Response('<main><section role="dialog"><h2>Usage</h2><h3>5 hour usage limit</h3><p>80% remaining</p><h3>Weekly usage limit</h3><p>35% used</p></section></main>',{headers:{'content-type':'text/html'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try {
      const results=[];
      for(const [id,config] of Object.entries(accounts).filter(([id])=>id!=='openai')) {
        await w.loadURL(config.url);
        results.push(await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')('+JSON.stringify(id)+','+JSON.stringify(config.origin)+')'));
      }
      return results;
    }finally{w.destroy();}
  });
  for(const result of readings) {assert.equal(result.authenticated,true);assert.equal(result.windows.length,2);assert.equal(result.windows[1].remaining,65);}
  // Grok's displayed total is an accessible shadow-DOM number, while the
  // separate model breakdown can differ and must not replace the total.
  const grokReading=await desktop.evaluate(async({BrowserWindow,session})=>{
    const {inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('grok-number-dom-test');
    isolated.protocol.handle('https',()=>new Response('<section role="dialog"><h2>Utilisation</h2><h3>Limite hebdomadaire SuperGrok</h3><span><number-flow-react aria-label="12%" role="img" style="display:inline-block;width:30px;height:20px"></number-flow-react><span>utilisés</span></span><p>Grok Build 8%</p></section>',{headers:{'content-type':'text/html; charset=utf-8'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{await w.loadURL('https://grok.com/');return await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')("grok","https://grok.com")');}finally{w.destroy();}
  });
  assert.equal(grokReading.authenticated,true);assert.deepEqual(grokReading.windows,[{label:'Semaine',remaining:88,resetAt:null}]);
  await page.locator('[data-nav="settings"]').click();
  const exportPath=path.join(results,'export-test.json');
  await desktop.evaluate(({dialog},exportPath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});},exportPath);
  await page.locator('[data-action="export"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Données exportées, sans les clés.');
  const exported=await fs.readFile(exportPath,'utf8');
  assert.ok(!exported.includes('test-secret'));assert.equal(JSON.parse(exported).history.length,9);
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await page.evaluate(()=>typeof window.process),'undefined');
  const quick=desktop.windows().find(w=>w.url().includes('mode=quick'));
  assert.ok(quick);
  await quick.waitForSelector('.quick-row');
  assert.equal(await quick.locator('.quick-row').count(),10);
  assert.doesNotMatch(await quick.locator('.quick-list').innerText(),/Reset|Dernier relevé|Échéance|Il y a|À l’instant/);
  assert.equal(await quick.locator('.quick-list').evaluate(el=>el.scrollHeight<=el.clientHeight),true);
  await desktop.evaluate(({BrowserWindow})=>{const quick=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=quick'));quick.show();});
  await quick.evaluate(()=>{
    // Visual fixture only in this renderer: include the full Antigravity group
    // before its separate connection test later in the suite.
    state.providers.find(p=>p.id==='antigravity').snapshot={balances:[],quotaRemaining:92,quotaWindows:[
      {label:'Gemini · 5 heures',remaining:92},{label:'Gemini · Semaine',remaining:98},
      {label:'Claude et GPT · 5 heures',remaining:100},{label:'Claude et GPT · Semaine',remaining:100},
    ]};renderQuick();
  });
  assert.equal(await quick.locator('[data-provider="antigravity"] .quick-quota').count(),4);
  assert.equal(await quick.locator('.quick-list').evaluate(el=>el.scrollHeight<=el.clientHeight),true);
  assert.match(await quick.locator('[data-provider="antigravity"]').innerText(),/Claude \/ GPT/);
  await quick.waitForFunction(()=>!document.querySelector('#toast').classList.contains('visible'));
  await quick.waitForFunction(()=>[...document.querySelectorAll('.logo img')].length===10&&[...document.querySelectorAll('.logo img')].every(img=>img.complete&&img.naturalWidth>0));
  assert.deepEqual(await quick.locator('[data-provider="antigravity"] .quick-period-label').allTextContents(),['Hebdo','5 h','Hebdo','5 h']);
  await quick.screenshot({path:path.join(results,'quick.png')});
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('mode=quick')).close());
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('mode=quick')).isVisible()),false);
  assert.deepEqual(errors,[]);
  await desktop.close();desktop=null;
  desktop=await launch(dataDir);page=await desktop.firstWindow();
  await page.waitForSelector('.cards .card');
  await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('mode=quick')).setSize(960,760));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(results,'compact-window.png')});
  const loaded=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(loaded.providers.find(p=>p.id==='openai').plan,'Offre de test');
  assert.equal(loaded.providers.find(p=>p.id==='openai').snapshot.quotaRemaining,62);
  assert.equal(loaded.providers.find(p=>p.id==='grok').favorite,true);
  assert.equal(loaded.providers.find(p=>p.id==='openrouter').connected,false);
  assert.equal(loaded.settings.autoRefresh,false);
  assert.equal(loaded.history.length,9);
  assert.equal(loaded.providers.find(p=>p.id==='ollama').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='ollama').snapshot.balances[0].remaining,47.5);
  await page.evaluate(()=>window.providersBar.disconnect('ollama'));
  const otherSession=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(otherSession.providers.find(p=>p.id==='orcarouter').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='zai').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='zai').snapshot.quotaRemaining,45);
  await page.evaluate(()=>window.providersBar.disconnect('zai'));
  assert.equal(loaded.providers.find(p=>p.id==='runinfra').connected,false);
  assert.equal(loaded.providers.find(p=>p.id==='orcarouter').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='orcarouter').snapshot.balances[0].remaining,53.2);
  const disconnected=await page.evaluate(()=>window.providersBar.disconnect('orcarouter'));
  assert.equal(disconnected.providers.find(p=>p.id==='orcarouter').connected,false);
  assert.equal(disconnected.providers.find(p=>p.id==='orcarouter').accountSession,undefined);
  await desktop.evaluate(()=>{
    const module=process.mainModule.require('./lib/antigravity-account.cjs');
    process.mainModule.require('./lib/account-browser.cjs').openSubscriptionBrowser=async()=>({isOpen:()=>true,close:async()=>{},readSubscriptionPage:async()=>({authenticated:true,windows:[{label:'Semaine',remaining:45,resetAt:null}]})});
    module.fetchAntigravityQuota=async()=>module.parseAntigravityQuota({response:{groups:[{buckets:[
      {bucketId:'gemini-weekly',window:'weekly',remainingFraction:.98},
      {bucketId:'gemini-5h',window:'5h',remainingFraction:.94},
      {bucketId:'3p-weekly',window:'weekly',remainingFraction:1},
      {bucketId:'3p-5h',window:'5h',remainingFraction:1},
    ]}]}});
  });
  await page.evaluate(()=>window.providersBar.verifyAccount('gemini'));
  await page.locator('[data-nav="connections"]').click();
  await page.locator('[data-open="antigravity"]').click();
  await page.locator('[data-action="account-open"]').click();
  await page.waitForFunction(()=>document.querySelector('dialog').innerText.includes('Claude et GPT · Semaine : 100 %'));
  let local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').snapshot.quotaRemaining,94);
  assert.equal(local.providers.find(p=>p.id==='gemini').snapshot.quotaRemaining,45);
  await desktop.evaluate(()=>{process.mainModule.require('./lib/antigravity-account.cjs').fetchAntigravityQuota=async()=>{throw new Error('Antigravity fermé');};});
  await assert.rejects(page.evaluate(()=>window.providersBar.verifyAccount('antigravity')),/Antigravity fermé/);
  local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').snapshot.quotaRemaining,94);
  assert.match(local.providers.find(p=>p.id==='antigravity').error,/Antigravity fermé/);
  await page.evaluate(()=>window.providersBar.disconnect('antigravity'));
  local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').connected,false);
  assert.equal(local.providers.find(p=>p.id==='gemini').connected,true);
  await desktop.close();desktop=null;
  console.log('PASS: inventory, search, filters, provider editing, manual quota, history graph, rejected/valid connector (mock), credential encryption, stale-on-error, disconnect, export without keys, sandbox, quick panel, close-to-tray, restart persistence.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(desktop)await desktop.close();});
