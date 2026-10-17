const { _electron: electron } = require(process.env.PROVIDERSBAR_PLAYWRIGHT || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const results=path.join(root,'test-results');
const futureDate=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
const pastDate=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
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
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.match(await page.locator('.workspace').innerText(),/Lasme/);
  assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(234, 240, 233)');
  assert.equal(await page.locator('.cards .card').count(),10);
  assert.match(await page.locator('.strategy-panel').innerText(), /Abonnements à vérifier/);
  await page.locator('[data-action="strategy-settings"]').click();
  assert.equal(await page.locator('#strategy-form [name="contributor"]').isChecked(),false);
  await page.locator('#strategy-model-ollama').selectOption('kimi');
  await page.locator('#strategy-inputTokens').fill('20000');
  await page.locator('#strategy-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Stratégie enregistrée.');
  const strategyState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(strategyState.strategy.inputTokens,20000);
  assert.equal(strategyState.strategy.subscriptionModels.ollama,'kimi');
  assert.equal(strategyState.strategy.contributor,false);
  await assert.rejects(page.evaluate(()=>window.providersBar.updateStrategy({contributor:'true'})),/invalide/);
  await page.locator('[data-nav="overview"]').click();
  await page.screenshot({path:path.join(results,'dashboard.png'),fullPage:true});
  await page.screenshot({path:path.join(results,'dashboard-window.png')});
  // Recommendation visual fixture is renderer-only, never persisted or sent to a provider.
  await page.evaluate(()=>{
    globalThis.strategyVisualOriginal=state;
    state=structuredClone(state);
    const stamp=new Date().toISOString(),resetAt=new Date(Date.now()+86400000).toISOString();
    for(const p of state.providers){
      p.active=['openai','zai','antigravity','openrouter','deepseek','runinfra','orcarouter'].includes(p.id);
      p.connected=true;p.error=null;
      const labels=p.id==='openai'?['Codex et Work · Semaine']:p.id==='antigravity'?['Gemini · Semaine','Gemini · 5 heures','Claude et GPT · Semaine','Claude et GPT · 5 heures','Gemini 4 Argon · Semaine']:['Semaine','5 heures'];
      p.snapshot={source:'api',updatedAt:stamp,quotaRemaining:90,balances:p.type==='api'?[{currency:'USD',remaining:10}]:[],quotaWindows:labels.map(label=>({label,remaining:90,resetAt}))};
    }
    render();
  });
  assert.match(await page.locator('.strategy-current').innerText(),/GPT-6 Astra/);
  assert.equal(await page.locator('.strategy-next li').count(),3);
  assert.doesNotMatch(await page.locator('.strategy-panel').innerText(),/undefined|NaN/);
  await page.screenshot({path:path.join(results,'strategy-dashboard.png'),fullPage:true});
  await page.evaluate(()=>{for(const p of state.providers.filter(p=>p.type==='subscription'))for(const w of p.snapshot.quotaWindows)w.remaining=0;render();});
  assert.match(await page.locator('.strategy-current').innerText(),/Aucun abonnement disponible/);
  assert.doesNotMatch(await page.locator('.strategy-current').innerText(),/OrcaRouter|GLM-5.3 Flash/);
  assert.match(await page.locator('.strategy-api').innerText(),/API disponibles à utiliser/);
  assert.match(await page.locator('.strategy-api-providers').innerText(),/restants/);
  assert.doesNotMatch(await page.locator('.strategy-api-providers').innerText(),/estimés|Flash/);
  assert.equal(await page.evaluate(()=>strategyResult().queue.every(x=>x.kind==='subscription')),true);
  await page.locator('.strategy-details summary').click();
  await page.waitForFunction(() => document.querySelector('[data-disclosure="subscriptions"]').open);
  // Quota broadcasts and the minute timer rebuild the view. User expansion
  // must survive even when successive toggle events have not been delivered.
  await page.evaluate(() => { for (let i=0;i<8;i++) receiveState(structuredClone(state)); });
  assert.equal(await page.locator('[data-disclosure="subscriptions"]').evaluate(el=>el.open), true);
  await page.locator('.strategy-details summary').click();
  await page.evaluate(() => receiveState(structuredClone(state)));
  assert.equal(await page.locator('[data-disclosure="subscriptions"]').evaluate(el=>el.open), false);
  await page.locator('.strategy-details summary').click();
  await page.evaluate(() => { render(); render(); });
  assert.equal(await page.locator('[data-disclosure="subscriptions"]').evaluate(el=>el.open), true);
  assert.match(await page.locator('.strategy-details').innerText(), /Réserves des abonnements actifs/);
  assert.doesNotMatch(await page.locator('.strategy-details').innerText(), /Modèles API|OrcaRouter|OpenRouter|RunInfra|DeepSeek Platform|Muse Spark|Qwen3.8 Flash/);
  assert.equal(await page.locator('.strategy-details [data-api-provider]').count(), 0);
  await page.screenshot({path:path.join(results,'strategy-api.png'),fullPage:true});
  await page.evaluate(()=>{state=globalThis.strategyVisualOriginal;delete globalThis.strategyVisualOriginal;render();});
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
  await page.locator('#renewalDate').fill(futureDate);
  await page.locator('[name="reviewed"]').check();
  await page.locator('#provider-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert.ok((await page.locator('.stats').innerText()).includes('103'));
  await page.locator('[data-open="openai"]').click();
  await page.locator('#subscriptionStatus').selectOption('expired');
  await page.locator('#statusMessage').fill('Renouvellement indisponible pour ce plan.');
  await page.locator('#provider-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
  const expiredState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(expiredState.providers.find(p=>p.id==='openai').active,false);
  assert.equal(expiredState.providers.find(p=>p.id==='openai').subscriptionStatus,'expired');
  assert.deepEqual(expiredState.summary.monthly,{});
  assert.match(await page.locator('.expired-card').innerText(),/Renouvellement indisponible pour ce plan/);
  await page.screenshot({path:path.join(results,'expired-subscription.png'),fullPage:true});
  await assert.rejects(page.evaluate(()=>window.providersBar.syncOne('openai')),/expiré/);
  await page.locator('[data-nav="subscriptions"]').click();
  assert.match(await page.locator('.expired-row').innerText(),/Fin du forfait/);
  await page.locator('[data-nav="overview"]').click();
  await page.locator('[data-open="openai"]').click();
  await page.locator('#subscriptionStatus').selectOption('active');
  await page.locator('#provider-form button[type="submit"]').click();
  assert.match(await page.locator('#provider-form .form-error').innerText(),/Confirme le renouvellement/);
  await page.locator('[name="confirmRenewal"]').check();
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
    process.mainModule.require('electron').session.defaultSession.fetch=async(_url,options)=>{
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
  // Disconnect while a replacement key is still validating: the pending
  // request must finish before deletion, and no third request may resurrect it.
  await desktop.evaluate(({session}) => {
    const gate = new Promise(resolve => { globalThis.releaseApiConnection = resolve; });
    session.defaultSession.fetch = async (_url, options) => {
      if (options.headers.Authorization === 'Bearer test-pending-replacement') await gate;
      return { ok: true, json: async () => ({ data: { total_credits: 100, total_usage: 25.5 } }) };
    };
  });
  await page.evaluate(() => { globalThis.pendingReplacement = window.providersBar.connect('openrouter', 'test-pending-replacement'); });
  await page.waitForFunction(() => state.providers.find(p => p.id === 'openrouter').syncing);
  await page.evaluate(() => { globalThis.pendingDisconnect = window.providersBar.disconnect('openrouter'); });
  await assert.rejects(page.evaluate(() => window.providersBar.connect('openrouter', 'test-overlapping')), /opération.*en cours/);
  await desktop.evaluate(() => globalThis.releaseApiConnection());
  await page.evaluate(async () => { await Promise.all([globalThis.pendingReplacement, globalThis.pendingDisconnect]); });
  const disconnectedDuringConnect = await page.evaluate(() => window.providersBar.getState());
  assert.equal(disconnectedDuringConnect.providers.find(p => p.id === 'openrouter').connected, false);
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, 'credentials.json'), 'utf8')).openrouter, undefined);
  await page.evaluate(() => window.providersBar.connect('openrouter', 'test-secret-never-export'));
  await page.locator('[data-action="close-dialog"]').click();
  // Verify both new connectors through the real IPC and encrypted credential store.
  await desktop.evaluate(()=>{
    process.mainModule.require('electron').session.defaultSession.fetch=async(url)=>{
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
      return {ok:true,status:200,url,text:async()=>'<h2>Included usage Pro</h2><h3>Monthly usage</h3><span>$12.50 of $60.00 used</span><span data-time="2026-10-07T12:00:00Z">Resets</span><h3>Usage credits</h3><span>$2.98</span><small>Current balance</small>'};
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
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').snapshot.usageCredits.remaining,2.98);
  assert.match(await page.locator('[data-open="ollama"]').locator('..').innerText(),/Réserve supplémentaire/);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').amount,null);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').connected,true);
  await desktop.evaluate(({session})=>{session.fromPartition('persist:ollama-account').fetch=async()=>({ok:false,status:302});});
  ollamaState=await page.evaluate(()=>window.providersBar.syncOne('ollama'));
  assert.match(ollamaState.providers.find(p=>p.id==='ollama').error,/expirée/);
  assert.equal(ollamaState.providers.find(p=>p.id==='ollama').snapshot.balances[0].remaining,47.5);
  await page.locator('[data-action="close-dialog"]').click();
  assert.ok((await router.innerText()).includes('74,50'));
  // A failed refresh must retain the last valid measurement.
  await desktop.evaluate(()=>{process.mainModule.require('electron').session.defaultSession.fetch=async()=>({ok:false,status:429});});
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
    const claudeDesktop=process.mainModule.require('./lib/claude-desktop-usage.cjs');
    claudeDesktop.readClaudeDesktopUsage=async()=>({source:'api',connectorVersion:'claude-desktop-local-v1',updatedAt:new Date().toISOString(),balances:[],quotaRemaining:80,resetAt:null,quotaWindows:[{label:'5 heures',remaining:80,resetAt:null},{label:'Semaine',remaining:91,resetAt:null}],quotaLabel:'Claude Pro · 5 heures · Claude Desktop'});
  });
  await page.locator('[data-nav="connections"]').click();
  for(const id of ['openai','grok','zai']) {
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
  await page.locator('[data-open="claude"]').click();
  assert.equal(await page.locator('[data-action="account-open"]').count(),0);
  await desktop.evaluate(() => {
    const local = process.mainModule.require('./lib/claude-desktop-usage.cjs');
    globalThis.savedClaudeRead = local.readClaudeDesktopUsage;
    local.readClaudeDesktopUsage = async () => { throw new Error('Relevé Claude Desktop ancien : aucun nouveau quota depuis plus de 45 minutes.'); };
  });
  await page.evaluate(() => window.providersBar.verifyAccount('claude')).catch(() => {});
  const staleClaude = await page.evaluate(() => window.providersBar.getState());
  assert.equal(staleClaude.providers.find(p => p.id === 'claude').accountSession.kind, 'claude-desktop-local');
  assert.match(await page.evaluate(() => statusBadge(state.providers.find(p => p.id === 'claude'))), /Relevé ancien/);
  await desktop.evaluate(() => { process.mainModule.require('./lib/claude-desktop-usage.cjs').readClaudeDesktopUsage = globalThis.savedClaudeRead; });
  await page.locator('[data-action="account-verify"]').click();
  await page.waitForFunction(() => !state.providers.find(p => p.id === 'claude').error);
  const claudeState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(claudeState.providers.find(p=>p.id==='claude').accountSession.kind,'claude-desktop-local');
  assert.deepEqual(claudeState.providers.find(p=>p.id==='claude').snapshot.quotaWindows.map(w=>w.remaining),[80,91]);
  // Direct usage is opt-in. Test transport never reads real credentials or calls Claude.
  assert.equal(await page.locator('[data-action="claude-enable-live"]').count(), 1);
  await desktop.evaluate(() => {
    const live = process.mainModule.require('./lib/claude-live-usage.cjs');
    const snapshot = live.parseClaudeLiveUsage({ five_hour: { utilization: 9, resets_at: '2099-09-30T11:00:00Z' },
      seven_day: { utilization: 42, resets_at: '2099-10-07T08:00:00Z' }, limits: [{ display_name: 'Fable', percent: 31, resets_at: '2099-10-07T08:00:00Z' }] });
    live.readClaudeLiveUsage = async () => structuredClone(snapshot);
  });
  await page.locator('[data-action="claude-enable-live"]').click();
  await page.waitForFunction(() => state.providers.find(p=>p.id==='claude').accountSession.kind==='claude-live-local');
  assert.equal(await page.locator('[data-action="claude-enable-live"]').count(), 0);
  assert.match(await page.locator('.connection-success').innerText(), /chaque minute/);
  const directClaude=await page.evaluate(()=>window.providersBar.getState());
  assert.deepEqual(directClaude.providers.find(p=>p.id==='claude').snapshot.quotaWindows.map(w=>w.remaining),[91,58,69]);
  await desktop.evaluate(() => { process.mainModule.require('./lib/claude-desktop-usage.cjs').readClaudeDesktopUsage=async()=>{throw new Error('Must not read old Desktop history in direct mode');}; });
  await page.locator('[data-action="account-verify"]').click();
  assert.equal((await page.evaluate(()=>window.providersBar.getState())).providers.find(p=>p.id==='claude').error, null);
  await page.screenshot({path:path.join(results,'claude-live-connection.png')});
  await desktop.evaluate(() => { process.mainModule.require('./lib/claude-live-usage.cjs').readClaudeLiveUsage=async()=>{throw new Error('Claude limite les lectures de quota. Dernier relevé conservé.');}; });
  await page.evaluate(()=>window.providersBar.verifyAccount('claude')).catch(()=>{});
  const failedClaude=(await page.evaluate(()=>window.providersBar.getState())).providers.find(p=>p.id==='claude');
  assert.equal(failedClaude.snapshot.updatedAt,directClaude.providers.find(p=>p.id==='claude').snapshot.updatedAt);
  assert.deepEqual(failedClaude.snapshot.quotaWindows.map(w=>w.remaining),[91,58,69]);
  await page.locator('[data-action="disconnect"]').click();
  await desktop.evaluate(() => { process.mainModule.require('./lib/claude-desktop-usage.cjs').readClaudeDesktopUsage=globalThis.savedClaudeRead; });
  await page.locator('[data-action="close-dialog"]').click();
  await page.screenshot({path:path.join(results,'connections-updated.png'),fullPage:true});
  // Reset editing is allowed on connected accounts without creating usage history.
  await page.locator('[data-open="zai"]').click();
  await page.locator('[data-dialog-tab="resets"]').click();
  await page.locator('#reset-date-0').fill('2099-09-19');
  await page.locator('#resets-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Dates de réinitialisation enregistrées.');
  assert.match(await page.locator('#resets-form').innerText(),/manuel/);
  assert.match(await page.locator('#resets-form').innerText(),/heure non précisée/);
  await page.screenshot({path:path.join(results,'reset-editor.png')});
  const resetState=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(resetState.providers.find(p=>p.id==='zai').connected,true);
  assert.equal(resetState.providers.find(p=>p.id==='zai').manualResets.Semaine.date,'2099-09-19');
  assert.equal(resetState.providers.find(p=>p.id==='zai').manualResets.Semaine.at,null);
  await assert.rejects(page.evaluate(()=>window.providersBar.saveResets('zai',{'Semaine':{date:'2099-02-30'}})),/invalide/);
  await page.locator('[data-action="close-dialog"]').click();
  // Run the exact settings reader inside real sandboxed Chromium documents.
  const readings=await desktop.evaluate(async({app,BrowserWindow,session})=>{
    const {accounts,inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('subscription-dom-test');
    isolated.protocol.handle('https',()=>new Response('<main><section role="dialog"><h2>Usage</h2><h3>5 hour usage limit</h3><p>80% remaining</p><h3>Weekly usage limit</h3><p>35% used</p></section></main>',{headers:{'content-type':'text/html'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try {
      const results=[];
      for(const [id,config] of Object.entries(accounts).filter(([id])=>!['openai','claude'].includes(id))) {
        await w.loadURL(config.url);
        results.push(await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')('+JSON.stringify(id)+','+JSON.stringify(config.origin)+')'));
      }
      return results;
    }finally{w.destroy();}
  });
  for(const result of readings) {assert.equal(result.authenticated,true);assert.equal(result.windows.length,2);assert.equal(result.windows[1].remaining,65);}
  const claudeReading=await desktop.evaluate(async({BrowserWindow,session})=>{
    const {inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('claude-usage-dom-test');
    isolated.protocol.handle('https',()=>new Response('<main><h1>Votre utilisation</h1><p>Pro</p><h2>Session actuelle</h2><p>Réinitialisation à 4:40</p><p>12 % utilisés</p><h2>Cette semaine</h2><p>Réinitialisation le mercredi 10:00</p><p>9 % utilisés</p><h2>Crédits d’utilisation</h2><p>4,71 €</p></main>',{headers:{'content-type':'text/html; charset=utf-8'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{await w.loadURL('https://claude.ai/settings/usage');return await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')("claude","https://claude.ai")');}finally{w.destroy();}
  });
  assert.equal(claudeReading.authenticated,true);
  assert.deepEqual(claudeReading.windows.map(w=>[w.label,w.remaining]),[['5 heures',88],['Semaine',91]]);
  // Grok's displayed total is an accessible shadow-DOM number, while the
  // separate model breakdown can differ and must not replace the total.
  const grokReading=await desktop.evaluate(async({BrowserWindow,session})=>{
    const {inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('grok-number-dom-test');
    isolated.protocol.handle('https',()=>new Response('<section role="dialog"><h2>Paramètres</h2><h2>Utilisation</h2><h3>Limite hebdomadaire SuperGrok</h3><span><number-flow-react aria-label="12%" role="img" style="display:inline-block;width:30px;height:20px"></number-flow-react><span>utilisés</span></span><p>Grok Build 8%</p></section>',{headers:{'content-type':'text/html; charset=utf-8'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{await w.loadURL('https://grok.com/');return await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')("grok","https://grok.com")');}finally{w.destroy();}
  });
  assert.equal(grokReading.authenticated,true);assert.deepEqual(grokReading.windows,[{label:'Semaine',remaining:88,resetAt:null}]);
  const grokBotReading=await desktop.evaluate(async({BrowserWindow,session})=>{
    const {inspectSubscriptionPage}=process.mainModule.require('./lib/subscription-accounts.cjs');
    const isolated=session.fromPartition('grok-bot-dom-test');
    isolated.protocol.handle('https',()=>new Response('<section role="dialog"><h2>Paramètres</h2><h2>Utilisation</h2><p>Grok Bot a une limite hebdomadaire distincte.</p><h3>Limite hebdomadaire SuperGrok</h3><div><span><number-flow-react aria-label="8%" role="img" style="display:inline-block;width:30px;height:20px"></number-flow-react><span>utilisés</span></span><p>Réinitialisation le<br>21 octobre 2026 à 20:14</p><p>Grok Build 8%</p></div><h3>Weekly Grok Bot Limit</h3><div><span><number-flow-react aria-label="0%" role="img" style="display:inline-block;width:30px;height:20px"></number-flow-react><span>utilisés</span></span><p>Réinitialisation le<br>24 octobre 2026 à 16:12</p></div><h3>Crédits d’utilisation supplémentaires</h3><span>0,00 $US</span></section>',{headers:{'content-type':'text/html; charset=utf-8'}}));
    const w=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{await w.loadURL('https://grok.com/?_s=usage');return await w.webContents.executeJavaScript('('+inspectSubscriptionPage.toString()+')("grok","https://grok.com")');}finally{w.destroy();}
  });
  assert.equal(grokBotReading.usageKind,'supergrok-legacy');
  assert.deepEqual(grokBotReading.windows,[{label:'Semaine',remaining:92,resetAt:new Date(2026,9,21,20,14).toISOString()},{label:'Grok Bot · Semaine',remaining:100,resetAt:new Date(2026,9,24,16,12).toISOString()}]);
  await page.locator('[data-nav="settings"]').click();
  const quick=desktop.windows().find(w=>w.url().includes('mode=quick'));
  assert.ok(quick);
  assert.equal(await quick.evaluate(()=>document.documentElement.dataset.theme),'light');
  await page.locator('[name="theme"]').selectOption('dark');
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await quick.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(20, 22, 23)');
  await page.screenshot({path:path.join(results,'settings-dark.png')});
  await page.locator('[name="theme"]').selectOption('light');
  await page.locator('#settings-form button[type="submit"]').click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await quick.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.screenshot({path:path.join(results,'settings-light.png')});
  const exportPath=path.join(results,'export-test.json');
  await desktop.evaluate(({dialog},exportPath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});},exportPath);
  await page.locator('[data-action="export"]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Données exportées, sans les clés.');
  const exported=await fs.readFile(exportPath,'utf8');
  assert.ok(!exported.includes('test-secret'));assert.equal(JSON.parse(exported).history.length,12);
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  assert.equal(await page.evaluate(()=>typeof window.process),'undefined');
  await quick.waitForSelector('.quick-row');
  await quick.waitForFunction(()=>{
    const footer=document.querySelector('.quick-footer');
    return footer && Math.abs(innerHeight-footer.getBoundingClientRect().bottom-12)<6;
  },null,{timeout:10000});
  assert.ok((await quick.evaluate(()=>innerHeight))<=900);
  assert.equal(await quick.locator('.quick-row').count(),10);
  assert.deepEqual(await quick.locator('.quick-row').evaluateAll(rows => rows.slice(0,6).map(row => row.dataset.provider)), ['openai','claude','grok','antigravity','zai','ollama']);
  assert.equal(await quick.locator('.quick-strategy').count(),1);
  assert.equal(await quick.locator('.quick-api').count(),1);
  const dashboardRecommendation=await page.evaluate(()=>UsageStrategy.recommend(state.providers,state.strategy).recommended?.id);
  assert.equal(await quick.evaluate(()=>UsageStrategy.recommend(state.providers,state.strategy).recommended?.id),dashboardRecommendation);
  assert.doesNotMatch(await quick.locator('.quick-list').innerText(),/Échéance|Il y a|À l’instant/);
  assert.match(await quick.locator('[data-provider="zai"] .reset-date').first().innerText(),/19\/09\/2099.*manuel/);
  const initialQuickFit=await quick.locator('.quick-list').evaluate(el=>({scroll:el.scrollHeight,client:el.clientHeight,window:innerHeight}));
  assert.equal(initialQuickFit.scroll<=initialQuickFit.client||initialQuickFit.window===900,true,JSON.stringify(initialQuickFit));
  await desktop.evaluate(({BrowserWindow})=>{const quick=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=quick'));quick.webContents.setBackgroundThrottling(false);quick.removeAllListeners('blur');quick.showInactive();});
  await quick.evaluate(()=>{
    // Visual fixture only in this renderer: include the full Antigravity group
    // before its separate connection test later in the suite.
    state.providers.find(p=>p.id==='antigravity').snapshot={balances:[],quotaRemaining:92,quotaWindows:[
      {label:'Gemini · 5 heures',remaining:92},{label:'Gemini · Semaine',remaining:98},
      {label:'Claude et GPT · 5 heures',remaining:100},{label:'Claude et GPT · Semaine',remaining:100},
      {label:'Gemini 4 Argon · Semaine',remaining:88},
    ]};renderQuick();
  });
  assert.equal(await quick.locator('[data-provider="antigravity"] .quick-quota').count(),5);
  assert.equal(await quick.locator('.quick-list').evaluate(el=>el.scrollHeight<=el.clientHeight||innerHeight===900),true);
  assert.match(await quick.locator('[data-provider="antigravity"]').innerText(),/Claude \/ GPT/);
  await quick.waitForFunction(()=>!document.querySelector('#toast').classList.contains('visible'));
  await quick.waitForFunction(()=>[...document.querySelectorAll('.logo img')].length===10&&[...document.querySelectorAll('.logo img')].every(img=>img.complete&&img.naturalWidth>0));
  assert.deepEqual(await quick.locator('[data-provider="antigravity"] .quick-period-label').allTextContents(),['Hebdo','5 h','Hebdo','5 h','Hebdo']);
  await quick.screenshot({path:path.join(results,'quick.png')});
  // Exercise depletion and the tier boundaries in both rendered surfaces,
  // using renderer-only fixtures: real wallet values remain untouched.
  for (const surface of [page, quick]) await surface.evaluate(() => {
    globalThis.resourceOriginalState = state;
    globalThis.resourceOriginalView = { page, filter, query };
    page = 'overview'; filter = 'all'; query = '';
    state = structuredClone(state);
    const stamp = new Date().toISOString();
    for (const [id, remaining] of [['openrouter', 0], ['deepseek', 2], ['runinfra', 5], ['orcarouter', 10]]) {
      const p = state.providers.find(p => p.id === id);
      Object.assign(p, { active: true, connected: true, error: null, snapshot: { source: 'api', updatedAt: stamp, balances: [{ currency: 'USD', remaining }], quotaRemaining: null } });
    }
    const ollama = state.providers.find(p => p.id === 'ollama');
    Object.assign(ollama, { active: true, connected: true, error: null, snapshot: { source: 'api', connectorVersion: 'ollama-monthly-credits-v1', updatedAt: stamp, balances: [{ currency: 'USD', remaining: 0, total: 60, used: 60 }], usageCredits: { currency: 'USD', remaining: 2.98 }, quotaRemaining: 0 } });
    const p = state.providers.find(p => p.id === 'antigravity');
    Object.assign(p, { active: true, connected: true, error: null, snapshot: { source: 'api', updatedAt: stamp, balances: [], quotaWindows: [
      { label: 'Gemini · Semaine', remaining: 0 }, { label: 'Gemini · 5 heures', remaining: 10 },
      { label: 'Claude et GPT · Semaine', remaining: 25 }, { label: 'Claude et GPT · 5 heures', remaining: 90 },
      { label: 'Gemini 4 Argon · Semaine', remaining: 88 },
    ] } });
    render();
  });
  assert.match(await quick.locator('[data-provider="openrouter"]').innerText(), /Solde épuisé/);
  assert.match(await page.locator('.card:has([data-open="openrouter"])').innerText(), /Solde épuisé/);
  assert.match(await quick.locator('[data-provider="ollama"]').innerText(), /Crédits inclus épuisés · réserve disponible/);
  assert.match(await page.locator('.card:has([data-open="ollama"])').innerText(), /Réserve supplémentaire[\s\S]*2,98/);
  assert.match(await quick.locator('[data-provider="antigravity"]').innerText(), /Limite Gemini · hebdo atteinte/);
  assert.equal(await quick.locator('[data-provider="antigravity"] .quick-resource-status').count(), 0);
  for (const [id, level] of [['openrouter', 'empty'], ['deepseek', 'critical'], ['runinfra', 'low'], ['orcarouter', 'healthy']]) {
    assert.equal(await quick.locator(`[data-provider="${id}"].resource-${level}`).count(), 1);
    assert.equal(await page.locator(`.card.resource-${level}:has([data-open="${id}"])`).count(), 1);
    const dashboardColor = await page.locator(`.card:has([data-open="${id}"]) .resource-value`).evaluate(el => getComputedStyle(el).color);
    assert.equal(await quick.locator(`[data-provider="${id}"] .resource-value`).evaluate(el => getComputedStyle(el).color), dashboardColor);
  }
  assert.deepEqual(await quick.locator('[data-provider="antigravity"] .quick-quota').evaluateAll(els => els.map(el => [...el.classList].find(c => c.startsWith('resource-')))), ['resource-empty','resource-critical','resource-low','resource-healthy','resource-healthy']);
  for (const surface of [page, quick]) {
    const result = await surface.evaluate(() => ({ queue: strategyResult().queue, api: strategyResult().apiProviders }));
    assert.ok(result.queue.every(x => x.kind === 'subscription'));
    assert.equal(result.api.some(x => x.providerId === 'openrouter'), false);
    assert.ok(result.api.every((x, i, all) => i === 0 || all[i-1].balance >= x.balance));
  }
  await quick.waitForFunction(() => {
    const list = document.querySelector('.quick-list');
    return list.scrollHeight <= list.clientHeight || innerHeight === 900;
  });
  // With all reset lines, depletion notices and API indicators, scrolling is
  // intentional at the existing height cap; the footer must remain reachable.
  assert.equal(await quick.locator('.quick-list').evaluate(el => getComputedStyle(el).overflowY), 'auto');
  assert.ok(await quick.locator('.quick-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight));
  await quick.screenshot({path:path.join(results,'resource-levels-widget.png')});
  await page.screenshot({path:path.join(results,'resource-levels-dashboard.png'),fullPage:true});
  for (const surface of [page, quick]) await surface.evaluate(() => { state = globalThis.resourceOriginalState; ({ page, filter, query } = globalThis.resourceOriginalView); delete globalThis.resourceOriginalState; delete globalThis.resourceOriginalView; render(); });
  // Removing content must reduce the window, not create another blank area.
  const fullQuickHeight=await quick.evaluate(()=>innerHeight);
  await quick.evaluate(()=>{globalThis.quickSizingState=state;state={...state,providers:state.providers.slice(0,2)};renderQuick();});
  await quick.waitForFunction(previous=>innerHeight<previous-80,fullQuickHeight,{timeout:10000});
  await quick.evaluate(()=>{state=globalThis.quickSizingState;delete globalThis.quickSizingState;renderQuick();});
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
  assert.equal(loaded.settings.theme,'light');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  assert.equal(loaded.strategy.inputTokens,20000);
  assert.equal(loaded.strategy.subscriptionModels.ollama,'kimi');
  assert.equal(loaded.strategy.contributor,false);
  assert.equal(loaded.historyCount,12);
  assert.equal((await page.evaluate(()=>window.providersBar.getHistory())).length,12);
  assert.equal(loaded.providers.find(p=>p.id==='ollama').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='ollama').snapshot.balances[0].remaining,47.5);
  assert.equal(loaded.providers.find(p=>p.id==='ollama').snapshot.usageCredits.remaining,2.98);
  let freeState=await page.evaluate(renewalDate=>window.providersBar.updateProvider('ollama',{amount:18,billingCycle:'monthly',renewalDate}),pastDate);
  let free=freeState.providers.find(p=>p.id==='ollama');
  assert.equal(free.subscriptionStatus,'expired');
  assert.equal(free.active,true);
  assert.equal(freeState.summary.monthly.USD,103);
  assert.deepEqual(free.snapshot.balances,[]);
  assert.equal(free.snapshot.usageCredits.remaining,2.98);
  assert.match(await page.locator('.card:has([data-open="ollama"])').innerText(),/Free · 0 \$\/mo/);
  await page.screenshot({path:path.join(results,'ollama-free.png'),fullPage:true});
  await desktop.evaluate(({session})=>{session.fromPartition('persist:ollama-account').fetch=async url=>({ok:true,status:200,url,text:async()=>'<h2>Included usage Free</h2><h3>Monthly usage</h3><p>25% used</p><h3>Usage credits</h3><span>$2.98</span><small>Current balance</small>'});});
  freeState=await page.evaluate(()=>window.providersBar.syncOne('ollama'));
  free=freeState.providers.find(p=>p.id==='ollama');
  assert.equal(free.snapshot.quotaRemaining,75);
  assert.equal(free.snapshot.usageCredits.remaining,2.98);
  // Current official usage page: no monthly section or Current balance caption.
  await desktop.evaluate(({session})=>{session.fromPartition('persist:ollama-account').fetch=async url=>({ok:true,status:200,url,text:async()=>'<main><h1>Usage credits <span>Free</span></h1><p>$1.05</p><p>Add usage credits to pay as you go on any cloud model.</p><button>Add funds</button><h2>Usage credits used this month</h2><p>model A $1.03</p><p>model B $0.90</p><h2>Usage breakdown</h2><p>62.8%</p></main>'});});
  freeState=await page.evaluate(()=>window.providersBar.syncOne('ollama'));
  free=freeState.providers.find(p=>p.id==='ollama');
  assert.equal(free.error,null);assert.equal(free.connected,true);
  assert.equal(free.snapshot.usageCredits.remaining,1.05);
  assert.equal(free.snapshot.usageCredits.stale,false);
  assert.equal(free.snapshot.quotaRemaining,null);
  const latestReserveAt=free.snapshot.usageCredits.observedAt;
  const currentWidget=desktop.windows().find(w=>w.url().includes('mode=quick'));
  const currentReserveCard=page.locator('.card:has([data-open="ollama"])');
  const currentReserveRow=currentWidget.locator('[data-provider="ollama"]');
  await currentWidget.evaluate(()=>{state.providers.find(p=>p.id==='zai').subscriptionStatus='expired';renderQuick();});
  assert.equal(await currentWidget.locator('[data-provider="zai"]').count(),0);
  assert.equal(await currentReserveRow.count(),1);
  await currentWidget.evaluate(data=>receiveState(data),freeState);
  assert.match(await page.evaluate(()=>statusBadge({...state.providers.find(p=>p.id==='ollama'),error:'Session absente ou expirée.'})),/Connexion à vérifier/);
  for(const surface of [page,currentWidget]) await surface.waitForFunction(()=>state.providers.find(p=>p.id==='ollama').snapshot.usageCredits.remaining===1.05);
  for(const container of [currentReserveCard,currentReserveRow]){
    assert.match(await container.innerText(),/Réserve supplémentaire[\s\S]*1,05/);
    assert.equal(await container.locator('.stale').count(),0);
  }
  assert.equal(await currentReserveRow.locator('[aria-label="Relevé à vérifier"]').count(),0);
  await currentReserveCard.screenshot({path:path.join(results,'ollama-current-card.png')});
  await desktop.evaluate(({BrowserWindow})=>{const quick=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=quick'));quick.webContents.setBackgroundThrottling(false);quick.removeAllListeners('blur');quick.showInactive();});
  await currentReserveRow.screenshot({path:path.join(results,'ollama-current-row.png')});
  await desktop.evaluate(({session})=>{session.fromPartition('persist:ollama-account').fetch=async url=>({ok:true,status:200,url,text:async()=>'<main><h1>Usage credits Free</h1><h2>Usage breakdown</h2></main>'});});
  freeState=await page.evaluate(()=>window.providersBar.syncOne('ollama'));
  free=freeState.providers.find(p=>p.id==='ollama');
  assert.equal(free.snapshot.usageCredits.remaining,1.05);
  assert.equal(free.snapshot.usageCredits.stale,true);
  assert.equal(free.snapshot.usageCredits.observedAt,latestReserveAt);
  for(const surface of [page,currentWidget]) await surface.waitForFunction(()=>state.providers.find(p=>p.id==='ollama').snapshot.usageCredits.stale);
  for(const container of [currentReserveCard,currentReserveRow])assert.match(await container.innerText(),/Dernière valeur connue[\s\S]*1,05/);
  await assert.rejects(page.evaluate(renewalDate=>window.providersBar.updateProvider('ollama',{subscriptionStatus:'active',renewalDate}),futureDate),/Confirme le renouvellement/);
  await page.evaluate(()=>window.providersBar.disconnect('ollama'));
  const otherSession=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(otherSession.providers.find(p=>p.id==='orcarouter').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='zai').connected,true);
  assert.equal(loaded.providers.find(p=>p.id==='zai').snapshot.quotaRemaining,45);
  assert.equal(loaded.providers.find(p=>p.id==='zai').manualResets.Semaine.date,'2099-09-19');
  const clearedDates=await page.evaluate(()=>window.providersBar.saveResets('zai',{}));
  assert.deepEqual(clearedDates.providers.find(p=>p.id==='zai').manualResets,{});
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
  await assert.rejects(page.evaluate(()=>window.providersBar.verifyAccount('gemini')),/introuvable|inconnu/i);
  await page.locator('[data-nav="connections"]').click();
  await page.locator('[data-open="antigravity"]').click();
  await page.locator('[data-action="account-open"]').click();
  await page.waitForFunction(()=>document.querySelector('dialog').innerText.includes('Claude et GPT · Semaine : 100 %'));
  let local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').snapshot.quotaRemaining,94);
  assert.equal(local.providers.some(p=>p.id==='gemini'),false);
  await desktop.evaluate(()=>{process.mainModule.require('./lib/antigravity-account.cjs').fetchAntigravityQuota=async()=>{throw new Error('Antigravity fermé');};});
  await assert.rejects(page.evaluate(()=>window.providersBar.verifyAccount('antigravity')),/Antigravity fermé/);
  local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').snapshot.quotaRemaining,94);
  assert.match(local.providers.find(p=>p.id==='antigravity').error,/Antigravity fermé/);
  await page.evaluate(()=>window.providersBar.disconnect('antigravity'));
  local=await page.evaluate(()=>window.providersBar.getState());
  assert.equal(local.providers.find(p=>p.id==='antigravity').connected,false);
  assert.equal(local.providers.some(p=>p.id==='gemini'),false);
  await desktop.close();desktop=null;
  console.log('PASS: inventory, search, filters, provider editing, manual quota, history graph, rejected/valid connector (mock), credential encryption, stale-on-error, disconnect, export without keys, sandbox, quick panel, close-to-tray, restart persistence.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(desktop)await desktop.close();});
