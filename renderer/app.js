/* Local UI. Provider credentials only cross the narrow preload bridge. */
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V6a2 2 0 0 1 2-2h13M21 11h-6v5h6"/><path d="M17 13.5h.1"/>',
  chart:'<path d="M4 3v17h17M8 15l4-5 4 2 5-7"/>',
  plug:'<path d="m9 3 1 5m5-5-1 5M7 8h10v4a5 5 0 0 1-5 5v4M7 8v4a5 5 0 0 0 5 5"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.2 7a8 8 0 0 1 13.3-2L20 8M4 16l1.5 3A8 8 0 0 0 19 17"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  file:'<path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name, size=17) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (value, currency='USD') => new Intl.NumberFormat('fr-FR',{style:'currency',currency,maximumFractionDigits:2}).format(value);
const quotaDisplay = (value, providerId) => providerId === 'ollama' ? Math.round(value) : value;
const shortDate = value => value ? new Date(value+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : 'À préciser';
function age(value) { if (!value) return 'Aucun relevé'; const mins=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000)); return mins<1?'À l’instant':mins<60?`Il y a ${mins} min`:mins<1440?`Il y a ${Math.floor(mins/60)} h`:`Il y a ${Math.floor(mins/1440)} j`; }
function days(value) { const n=new Date(); return Math.round((Date.parse(value+'T00:00:00Z')-Date.UTC(n.getFullYear(),n.getMonth(),n.getDate()))/86400000); }
function resetLabel(value) { const minutes=Math.ceil((Date.parse(value)-Date.now())/60000); if(minutes<=0)return 'Reset passé · nouveau relevé nécessaire'; if(minutes<60)return `Reset dans ${minutes} min`; if(minutes<1440)return `Reset dans ${Math.floor(minutes/60)} h ${minutes%60} min`; return `Reset dans ${Math.floor(minutes/1440)} j ${Math.floor(minutes%1440/60)} h`; }
const brand = '<div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span>ProvidersBar</div>';
function applyTheme(value) {
  const theme=value==='dark'?'dark':'light';
  document.documentElement.dataset.theme=theme;
  try { localStorage.setItem('providersbar-theme',theme); } catch {}
}
const providerLogos = {openai:'openai.svg',claude:'claude.ico',antigravity:'antigravity.ico',zai:'zai.svg',ollama:'ollama.png',grok:'grok.svg',openrouter:'openrouter.png',deepseek:'deepseek.ico',runinfra:'runinfra.svg',orcarouter:'orcarouter.png'};
const logo = (p, small=false) => `<span class="logo ${small?'small':''} provider-${escapeHtml(p.id)}" style="--provider-color:${escapeHtml(p.color)}">${providerLogos[p.id]?`<img src="../assets/providers/${providerLogos[p.id]}" alt="" draggable="false">`:escapeHtml(p.monogram)}</span>`;
const hasConnector = p => Boolean(p.connector);
const isTracked = p => Boolean(p.active && p.subscriptionStatus !== 'paused' && (p.subscriptionStatus !== 'expired' || p.id === 'ollama'));
const ollamaFree = p => p.id === 'ollama' && p.subscriptionStatus === 'expired';
const subscriptionStatus = p => p.subscriptionStatus || (p.active ? 'active' : 'paused');
let state, page='overview', filter='all', query='', dialogId=null, dialogTab='info', historyProvider='all', historyPeriod='all', syncing=false, toastTimer;
let historyLoaded=false, historyLoading=false, historyError='';
const disclosureState = new Map();
document.addEventListener('toggle', event => {
  const panel = event.target;
  if (panel.isConnected && panel.matches('details[data-disclosure]')) disclosureState.set(panel.dataset.disclosure, panel.open);
}, true);
let api=window.providersBar;
const quick=new URLSearchParams(location.search).get('mode')==='quick';

// The browser preview is intentionally read-only and never accepts API credentials.
if (!api) api={getState:async()=>{ const response=await fetch('/preview-state'); if(!response.ok) throw new Error('Ouvre ProvidersBar avec son lanceur Windows.'); return response.json(); },onChange:()=>()=>{},showMain:()=>location.assign('/')};
function toast(message) { const el=document.getElementById('toast'); el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function nav(id,label,name,count) { return `<button data-nav="${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(name)}${label}${count===undefined?'':`<span class="count">${count}</span>`}</button>`; }
function render() {
  applyTheme(state.settings?.theme);
  // Capture immediately as toggle events can still be queued when state arrives.
  // Detached panels must never overwrite the state of their replacements.
  for (const panel of document.querySelectorAll('details[data-disclosure]')) disclosureState.set(panel.dataset.disclosure, panel.open);
  if (quick) { renderQuick(); return; }
  const labels={overview:'Vue d’ensemble',subscriptions:'Abonnements',history:'Historique',connections:'Connexions',settings:'Réglages'};
  document.getElementById('app').innerHTML=`${state.desktop?'':'<div class="preview-banner">Aperçu en lecture seule · Ouvre l’application Windows pour enregistrer tes données et connecter tes comptes.</div>'}<div class="shell"><aside class="sidebar">${brand}<div class="workspace"><span class="workspace-avatar">L</span><div><strong>L’atelier de Lasme</strong></div></div><div class="nav-label">ESPACE DE TRAVAIL</div><nav class="nav" aria-label="Navigation principale">${nav('overview','Vue d’ensemble','grid',state.providers.length)}${nav('subscriptions','Abonnements','wallet',state.providers.filter(p=>p.type==='subscription').length)}${nav('history','Historique','chart')}${nav('connections','Connexions','plug')}</nav><div class="sidebar-bottom"><nav class="nav">${nav('settings','Réglages','settings')}</nav><div class="local-status"><span class="dot"></span>Données stockées sur cet appareil</div></div></aside><main class="main"><header class="topbar"><div class="crumb">Atelier de Lasme <span>/</span><span>${labels[page]}</span></div><div class="top-actions"><span class="local-pill">${icon('shield',12)} Stockage local</span><span>${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</span></div></header><div class="content">${page==='overview'?overview():page==='subscriptions'?subscriptions():page==='history'?history():page==='connections'?connections():settings()+strategySettings()}</div></main></div>`;
}
function heading(kicker,title,description,action='') { return `<div class="heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function syncButton() { return `<button class="primary" data-action="sync" ${syncing?'disabled':''}>${icon('refresh',15)} ${syncing?'Synchronisation…':'Synchroniser'}</button>`; }
function stats() {
  const sub=state.providers.filter(p=>p.type==='subscription'&&isTracked(p)), apiCount=state.providers.filter(p=>p.type==='api'&&isTracked(p)).length;
  const connected=state.providers.filter(p=>p.connected).length;
  const totals=Object.entries(state.summary.monthly);
  const monthly=totals.length?totals.map(([currency,value])=>money(value,currency)).join(' + '):'—';
  const next=state.providers.filter(p=>isTracked(p)&&p.renewalDate&&days(p.renewalDate)>=0).sort((a,b)=>a.renewalDate.localeCompare(b.renewalDate))[0];
  return `<section class="stats" aria-label="Chiffres clés"><div class="stat"><div class="stat-top">Services suivis ${icon('grid',15)}</div><div class="stat-value">${sub.length+apiCount}<small>services</small></div><div class="stat-note">${sub.length} abonnements · ${apiCount} accès API</div></div><div class="stat"><div class="stat-top">Abonnements / mois ${icon('wallet',15)}</div><div class="stat-value">${monthly}</div><div class="stat-note">${state.summary.unpriced?`${state.summary.unpriced} périodicités ou tarifs à préciser`:'Équivalent mensuel des tarifs renseignés'}</div></div><div class="stat"><div class="stat-top">Comptes connectés ${icon('plug',15)}</div><div class="stat-value accent">${connected}<small>/ ${state.providers.filter(hasConnector).length} disponibles</small></div><div class="stat-note">${connected?'Actualisation automatique toutes les 5 min':'Connecte un compte pour commencer le suivi automatique'}</div></div><div class="stat"><div class="stat-top">Prochaine échéance ${icon('clock',15)}</div><div class="stat-value">${next?`${days(next.renewalDate)}<small>jours</small>`:'—'}</div><div class="stat-note">${next?`${escapeHtml(next.name)}${next.reviewed?'':' · date à vérifier'}`:'Aucune date à venir renseignée'}</div></div></section>`;
}
function toolbar() { return `<div class="toolbar"><div class="filters" role="group" aria-label="Filtrer les services">${[['all','Tous les services'],['subscription','Abonnements'],['api','API'],['favorite','Favoris']].map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><label class="search">${icon('search',15)}<input id="search" type="search" placeholder="Rechercher un service…" aria-label="Rechercher un service" value="${escapeHtml(query)}"></label></div>`; }
function overview() { return `${heading('TOUT SOUS LES YEUX','Tes usages, en un regard.','Quotas, crédits et abonnements. Garde le fil de tes outils IA.',syncButton())}${stats()}${strategyPanel()}<div class="section-heading"><h2>Mes providers <small>${state.providers.length} services</small></h2><span class="muted" style="font-size:10px">Clique sur une carte pour la configurer</span></div>${toolbar()}<section class="cards" id="provider-cards" aria-label="Mes providers">${filteredCards()}</section><div class="bottom-note"><span>${icon('shield',12)} Tes clés restent chiffrées sur cet appareil.</span><span>Aucune estimation présentée comme un solde réel.</span></div>`; }
function filteredCards() {
  const providers=state.providers.filter(p=>(filter==='all'||(filter==='favorite'?p.favorite:p.type===filter))&&p.name.toLowerCase().includes(query.toLowerCase()));
  return providers.length?providers.map(card).join(''):'<div class="empty-state" style="grid-column:1/-1"><h2>Aucun service trouvé</h2><p>Essaie un autre nom ou un autre filtre.</p></div>';
}
function statusBadge(p) {
  if(p.subscriptionStatus==='expired'&&!ollamaFree(p)) return '<span class="badge error">Expiré · désactivé</span>';
  if(!isTracked(p)) return '<span class="badge warn">En pause</span>';
  if(p.syncing) return '<span class="badge">Synchronisation…</span>';
  if(p.id==='claude' && p.error?.startsWith('Relevé Claude Desktop ancien')) return '<span class="badge warn">Relevé ancien</span>';
  if(p.error) return `<span class="badge error">${p.id==='claude'&&p.accountSession?.kind==='claude-live-local'?(p.claudeSync?.errorCode==='auth-required'?'Reconnexion requise':'Dernier relevé · reprise en attente'):p.connected&&p.error.includes('quota indisponible')?'Quota indisponible':'Connexion à vérifier'}</span>`;
  if(ollamaFree(p)&&p.connected) return '<span class="badge warn">Free · 0 $</span>';
  if(p.snapshot) {
    if(p.snapshot.source==='api'&&!p.connected) return '<span class="badge">Déconnecté · dernier relevé</span>';
    if(Date.now()-Date.parse(p.snapshot.updatedAt)>600000) return '<span class="badge warn">Relevé ancien</span>';
    return `<span class="badge ${p.snapshot.source==='api'?'live':''}">${p.snapshot.source==='api'?'Synchronisé':'Saisie manuelle'}</span>`;
  }
  return `<span class="badge">${p.connected?'Compte connecté':hasConnector(p)?'À connecter':'Saisie manuelle'}</span>`;
}
function quotaGroups(p) {
  if(p.type!=='subscription'||p.id==='ollama')return [];
  const slots=QuotaResets.slots(p), groups=[];
  for(const slot of slots){
    let group=groups.find(g=>g.groupKey===slot.group);
    if(!group){group={groupKey:slot.group,name:p.id==='claude'&&slot.group==='Fable'?'':slot.group==='Claude et GPT'?'Claude / GPT':p.id==='grok'&&!slot.group?(p.snapshot?.usageKind==='x-subscription-shared'?'Grok / Bot / Cursor':slots.some(s=>s.group==='Grok Bot')?'Grok':''):slot.group,periods:[]};groups.push(group);}
    let quota=p.snapshot?.quotaWindows?.find(w=>QuotaResets.canonical(w.label)===slot.key);
    if(!quota&&!p.snapshot?.quotaWindows?.length&&slots.length===1)quota={remaining:p.snapshot?.quotaRemaining,resetAt:p.snapshot?.resetAt};
    group.periods.push({label:slot.period,key:slot.key,quota});
  }
  return groups;
}
function quotaPeriodLabel(provider,key,label) {
  if(provider.id==='claude'&&key==='Fable · Semaine') return 'Hebdo Fable';
  return label==='Semaine'?'Hebdo':label==='5 heures'?'5 h':label;
}
function quotaStatusPeriods(p) {
  const groups=quotaGroups(p);
  return groups.flatMap(group=>group.periods.map(period=>({...period,groupName:group.name})));
}
function allQuotaPeriodsExhausted(p) {
  const periods=quotaStatusPeriods(p);
  if(!periods.length)return false;
  return periods.every(({quota})=>typeof quota?.remaining==='number'&&Number.isFinite(quota.remaining)&&quota.remaining===0);
}
function providerResourceLevel(p) {
  const currentLevel=ResourceLevels.providerLevel(p);
  if(p.type!=='subscription'||p.id==='ollama'||currentLevel==='unknown')return currentLevel;
  if((p.snapshot?.balances||[]).some(balance=>ResourceLevels.level(balance.remaining,balance.currency)==='empty'))return 'empty';
  const periods=quotaGroups(p).flatMap(group=>group.periods);
  if(!periods.some(({quota})=>typeof quota?.remaining==='number'&&Number.isFinite(quota.remaining)))return ResourceLevels.providerLevel(p);
  if(allQuotaPeriodsExhausted(p))return 'empty';
  const levels=[...(p.snapshot?.balances||[]).map(balance=>ResourceLevels.level(balance.remaining,balance.currency)),...periods.map(({quota})=>ResourceLevels.level(quota?.remaining,'%'))].filter(value=>value!=='unknown'&&value!=='empty');
  return ['critical','low','healthy'].find(value=>levels.includes(value))||'unknown';
}
function quotaLimitStatus(provider,key,label,groupName='') {
  const period=label==='Semaine'?'hebdo':label==='5 heures'?'5 h':label==='Période en cours'?'en cours':label.toLocaleLowerCase('fr-FR');
  if(provider.id==='claude') {
    const model=key.includes(' · ')?key.slice(0,key.lastIndexOf(' · ')):'';
    return `Limite ${period}${model?' '+model:''} atteinte`;
  }
  return `Limite ${groupName?groupName+' · ':''}${period} atteinte`;
}
function resourceClass(value,unit) { return 'resource-'+ResourceLevels.level(value,unit); }
function resourceAmount(balance) { const level=ResourceLevels.level(balance.remaining,balance.currency);return `<span class="resource-value resource-${level}" title="${ResourceLevels.labels[level]}">${money(balance.remaining,balance.currency)}</span>`; }
function resourceUnverified(p) { return Boolean(p.error || (p.snapshot?.source==='api'&&!p.connected) || Date.now()-Date.parse(p.snapshot?.updatedAt)>600000); }
function ollamaUsageCredits(p) { const reserve=p.id==='ollama'&&p.snapshot?.connectorVersion==='ollama-monthly-credits-v1'?p.snapshot.usageCredits:null;return reserve?.currency==='USD'&&typeof reserve.remaining==='number'&&Number.isFinite(reserve.remaining)&&reserve.remaining>=0?reserve:null; }
function ollamaReserveMarkup(p,compact=false) { if(p.id!=='ollama'||p.snapshot?.connectorVersion!=='ollama-monthly-credits-v1')return '';const reserve=ollamaUsageCredits(p);const label=reserve?.stale?`Dernière valeur connue · ${age(reserve.observedAt)}`:reserve?'Réserve supplémentaire':'Réserve indisponible';return `<div class="${compact?'quick-ollama-reserve':'ollama-reserve'} ${reserve?.stale?'stale':''}"><span>${label}</span><strong class="resource-value ${resourceClass(reserve?.remaining,'USD')}"${reserve?.stale?` title="Dernier montant lu le ${new Date(reserve.observedAt).toLocaleString('fr-FR')}"`:''}>${reserve?money(reserve.remaining,'USD'):'—'}</strong></div>`; }
function resourceNotice(p,compact=false) {
  const level=providerResourceLevel(p);
  if(level==='unknown')return '';
  const emptyBalance=(p.snapshot?.balances||[]).some(balance=>ResourceLevels.level(balance.remaining,balance.currency)==='empty');
  const quotaPeriods=p.type==='subscription'&&p.id!=='ollama'?quotaStatusPeriods(p):[];
  const hasQuota=quotaPeriods.some(({quota})=>typeof quota?.remaining==='number'&&Number.isFinite(quota.remaining));
  let text;
  if(p.id==='ollama'&&emptyBalance)text=`Crédits inclus épuisés${ollamaUsageCredits(p)?.remaining>0?' · réserve disponible':''}`;
  else if(emptyBalance)text='Solde épuisé';
  else if(hasQuota) {
    if(!allQuotaPeriodsExhausted(p))return '';
    text=quotaPeriods.length>1?'Toutes les limites atteintes':'Limite atteinte';
  } else if(level==='empty')text='Limite atteinte';
  else return '';
  return `<span class="${compact?'quick-resource-status':'resource-status'}">${text}${resourceUnverified(p)?' · dernier relevé':''}</span>`;
}
function resourceLegend() { return '<p class="resource-legend">Couleurs des ressources restantes : <span class="resource-empty">rouge : 0</span> · <span class="resource-critical">orange : ≤ 2 $ / ≤ 10 %</span> · <span class="resource-low">jaune : ≤ 5 $ / ≤ 25 %</span> · <span class="resource-healthy">vert : au-dessus</span>. Les seuils en dollars concernent uniquement les soldes USD, et sont distincts du seuil des notifications.</p>'; }
function quotaGroupsMarkup(groups,p) {
  return `<div class="quota-groups">${groups.map(group=>`<section class="quota-group">${group.name?`<h4>${escapeHtml(group.name)}</h4>`:''}<div class="quota-periods ${group.periods.length===1?'single':''}">${[...group.periods].sort((a,b)=>(a.label==='Semaine'?-1:1)-(b.label==='Semaine'?-1:1)).map(({label,quota,key})=>{
    const value=quota?.remaining;
    const known=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
    const status=known&&value===0?`<div class="quota-period-status">${escapeHtml(quotaLimitStatus(p,key,label,group.name))}</div>`:'';
    return `<div class="quota-period ${resourceClass(value,'%')}" ${quota?.resetAt?`title="${escapeHtml(resetLabel(quota.resetAt))}"`:''}><div class="quota-period-label">${escapeHtml(quotaPeriodLabel(p,key,label))}</div><div class="quota-period-value">${known?`${value}<small>%</small>`:'—'}</div><div class="meter ${known?'':'empty'}" role="meter" aria-label="${escapeHtml(quotaPeriodLabel(p,key,label))} : quota restant" ${known?`aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"`:'aria-valuetext="Indisponible"'}>${known?`<span style="width:${value}%"></span>`:''}</div>${status}${resetMarkup(p,key)}</div>`;
  }).join('')}</div></section>`).join('')}</div>`;
}
function card(p) {
  if(p.subscriptionStatus==='expired'&&!ollamaFree(p)) return `<article class="card expired-card"><button class="card-open" data-open="${p.id}" aria-label="Configurer ${escapeHtml(p.name)}"></button><div class="card-top">${logo(p)}<div class="provider-title"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.plan && p.plan !== p.name ? p.plan : '') || 'Abonnement'} · expiré</p></div><button class="icon-button ${p.favorite?'selected':''}" data-favorite="${p.id}" title="${p.favorite?'Retirer des favoris':'Ajouter aux favoris'}" aria-label="${p.favorite?'Retirer':'Ajouter'} ${escapeHtml(p.name)} ${p.favorite?'des':'aux'} favoris" aria-pressed="${p.favorite}">${icon('star',15)}</button></div><div class="card-content"><p class="expired-title">Abonnement expiré</p><p class="expired-message">${escapeHtml(p.statusMessage || 'Aucun renouvellement prévu pour le moment.')}</p><div class="card-bottom"><span>Suivi et recommandations arrêtés</span>${statusBadge(p)}</div></div></article>`;
  const s=p.snapshot;
  const groups=quotaGroups(p);
  let metric,label,note;
  if(s?.balances?.length) {label=escapeHtml(s.balanceLabel||'Dernier solde connu');metric=s.balances.map(resourceAmount).join('<small> / </small>');note=age(s.updatedAt);}
  else if(s?.quotaRemaining!==null&&s?.quotaRemaining!==undefined){label=escapeHtml(s.quotaLabel||'Quota restant');metric=`<span class="resource-value ${resourceClass(s.quotaRemaining,'%')}">${quotaDisplay(s.quotaRemaining,p.id)}<small>%</small></span>`;note=age(s.updatedAt);}
  else if(ollamaFree(p)){label='Limite Free';metric='<span class="unknown">—</span>';note='Usage de démarrage mensuel · 1 requête simultanée · limite chiffrée non disponible';}
  else if(p.type==='subscription'){label='Tarif renseigné';metric=p.amount===null?'<span class="unknown">—</span>':`${money(p.amount,p.currency)}`;note=p.billingCycle==='monthly'?'par mois':p.billingCycle==='yearly'?'par an':p.billingCycle==='one-time'?'paiement unique':'Périodicité à préciser';}
  else{label='Crédits restants';metric='<span class="unknown">—</span>';note='Connecte le compte ou ajoute un relevé';}
  const quota=s?.quotaRemaining;
  const hasQuota=quota!==null&&quota!==undefined;
  const subline=ollamaFree(p)?'Forfait expiré · Free':s?.resetAt?resetLabel(s.resetAt):p.type==='subscription'?(p.renewalDate?`${days(p.renewalDate)<0?'Date passée':'Échéance'} · ${shortDate(p.renewalDate)}`:'Échéance à préciser'):'';
  return `<article class="card resource-${providerResourceLevel(p)} ${resourceUnverified(p)?'resource-unverified':''} ${ollamaFree(p)&&!hasQuota?'ollama-free-unknown':''}"><button class="card-open" data-open="${p.id}" aria-label="Configurer ${escapeHtml(p.name)}"></button><div class="card-top">${logo(p)}<div class="provider-title"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(ollamaFree(p) ? 'Free · 0 $/mo' : p.plan && p.plan !== p.name ? p.plan : '')||(p.type==='subscription'?'Abonnement':'API à la consommation')}${p.active?'':' · en pause'}</p></div><button class="icon-button ${p.favorite?'selected':''}" data-favorite="${p.id}" title="${p.favorite?'Retirer des favoris':'Ajouter aux favoris'}" aria-label="${p.favorite?'Retirer':'Ajouter'} ${escapeHtml(p.name)} ${p.favorite?'des':'aux'} favoris" aria-pressed="${p.favorite}">${icon('star',15)}</button></div><div class="card-content">${ollamaFree(p)?'<p class="hint">Forfait payant expiré · usage Free suivi</p>':''}${groups.length?`<div class="metric-label">Quotas restants</div>${quotaGroupsMarkup(groups,p)}${p.id==='claude'?'<p class="hint">Hebdo Fable : disponible avec Max, non incluse avec Pro.</p>':''}`:`<div class="metric-label">${label}</div><div class="metric">${metric}</div><div class="metric-note">${note}</div><div class="quota ${hasQuota?resourceClass(quota,'%'):'resource-unknown'}"><div class="quota-label"><span>${hasQuota?'Quota restant':ollamaFree(p)?'Limite Free à vérifier':p.type==='subscription'?'Usage non renseigné':'Solde du compte'}</span><strong>${hasQuota?quotaDisplay(quota,p.id)+' %':'—'}</strong></div><div class="meter ${hasQuota?'':'empty'}">${hasQuota?`<span style="width:${quota}%"></span>`:''}</div></div>`}${p.id==='ollama'?resetMarkup(p,'Mois'):''}${ollamaReserveMarkup(p)}${resourceNotice(p)}<div class="card-bottom"><span>${groups.length?age(s?.updatedAt):subline}</span>${statusBadge(p)}</div>${p.error?`<p class="card-error">${escapeHtml(p.error)}</p>`:''}</div></article>`;
}
function subscriptions() {
  const list=state.providers.filter(p=>p.type==='subscription');
  const rows=list.map(p=>{
    const expired=p.subscriptionStatus==='expired';
    const status=ollamaFree(p)?'Free · forfait payant expiré':expired?'Expiré · désactivé':isTracked(p)?p.reviewed?'Informations vérifiées':'Informations à vérifier':'En pause';
    const date=expired?(p.renewalDate?`Fin du forfait : ${shortDate(p.renewalDate)}`:'Aucun renouvellement prévu'):shortDate(p.renewalDate);
    const dateNote=!expired&&p.renewalDate&&days(p.renewalDate)<0?'<div class="past-date">Date passée · à vérifier</div>':'';
    return `<tr class="${expired?'expired-row':''}"><td><div class="table-name">${logo(p,true)}<div><strong>${escapeHtml(p.name)}</strong><small>${status}</small>${expired?`<small class="expired-reason">${escapeHtml(p.statusMessage||'Renouvellement indisponible.')}</small>`:''}</div></div></td><td>${ollamaFree(p)?money(0,'USD'):p.amount===null?'—':money(p.amount,p.currency)}${!expired&&p.nextAmount!==null?`<div class="warning price-next">Puis ${money(p.nextAmount,p.currency)}</div>`:''}</td><td class="muted">${{unknown:'À préciser',monthly:'Mensuelle',yearly:'Annuelle','one-time':'Paiement unique'}[p.billingCycle]}</td><td class="${expired?'expired-date':p.renewalDate&&days(p.renewalDate)<0?'warning':'muted'}">${date}${dateNote}</td><td><button class="secondary" data-open="${p.id}">Modifier</button></td></tr>`;
  });
  return `${heading('BUDGET & ÉCHÉANCES','Tes abonnements.','Retrouve tes tarifs, les abonnements expirés et les prochaines échéances.')}${stats()}<div class="table-wrap"><table class="data-table"><thead><tr><th>Service</th><th>Tarif</th><th>Périodicité</th><th>Prochaine échéance</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="settings-foot">Les abonnements expirés ou en pause sont exclus du budget, de l’ordre d’utilisation. Ollama reste synchronisé en Free pour afficher sa limite et ses crédits. Leurs anciens relevés restent consultables.</p>`;
}
function connections() {
  return `${heading('SYNCHRONISATION','Connecte tes comptes.','Tes soldes et quotas, lus directement auprès des fournisseurs.',syncButton())}<div class="connection-grid">${state.providers.filter(hasConnector).map(p=>`<section class="connection-card"><div class="card-top">${logo(p)}<div class="provider-title"><h3>${escapeHtml(p.name)}</h3><p style="margin:4px 0 0;min-height:0;font-size:10px">${escapeHtml(p.connector.scope)}</p></div>${statusBadge(p)}</div><p>${escapeHtml(p.connector.description)}</p>${p.subscriptionStatus==='expired'?`<p class="warning">${escapeHtml(p.statusMessage||(ollamaFree(p)?'Forfait payant expiré · suivi Free actif':'Abonnement expiré · suivi désactivé'))}</p>`:p.error?`<p class="warning">${escapeHtml(p.error)}</p>`:''}<div class="connection-footer"><span class="muted" style="font-size:10px">${p.connected?age(p.snapshot?.updatedAt):'Connexion non configurée'}</span><button class="primary" data-open="${p.id}" data-tab="connection">${icon('plug',14)} ${p.connected?'Gérer la connexion':'Connecter'}</button></div></section>`).join('')}</div><div class="info-box">Les clés sont chiffrées par Windows et ne sont jamais incluses dans les exports. Les connexions API lisent les crédits ; Les autres fournisseurs utilisent chacun une session de compte isolée. Aucun modèle n’est appelé.</div><p class="hint">Un relevé manuel reste possible depuis la fiche d’un service déconnecté.</p><div class="manual-list">${state.providers.filter(p=>!hasConnector(p)).map(p=>`<button data-open="${p.id}" data-tab="manual">${escapeHtml(p.name)} ${icon('arrow',12)}</button>`).join('')}</div>`;
}
function graph(entries,p) {
  const currencies=[...new Set(entries.flatMap(e=>e.balances.map(b=>b.currency)))];
  const series=currencies.map(currency=>({label:`Solde · ${currency}`,points:entries.filter(e=>e.balances.some(b=>b.currency===currency)).map(e=>({t:Date.parse(e.updatedAt),v:e.balances.find(b=>b.currency===currency).remaining}))}));
  const quotas=entries.filter(e=>e.quotaRemaining!==null);
  if(quotas.length) series.push({label:'Quota restant · %',points:quotas.map(e=>({t:Date.parse(e.updatedAt),v:e.quotaRemaining}))});
  return series.map(s=>{
    const points=s.points.sort((a,b)=>a.t-b.t),lo=Math.min(...points.map(p=>p.v)),hi=Math.max(...points.map(p=>p.v));
    const first=points[0].t,last=points.at(-1).t;
    const coords=points.map(p=>({x:first===last?350:30+(p.t-first)/(last-first)*640,y:hi===lo?75:130-(p.v-lo)/(hi-lo)*105}));
    return `<section class="chart-panel"><h3>${escapeHtml(p.name)} · ${s.label} <span class="muted">(${points.length} relevé${points.length>1?'s':''})</span></h3><svg viewBox="0 0 700 155" role="img" aria-label="${escapeHtml(s.label)} : de ${points[0].v} à ${points.at(-1).v}"><path class="chart-grid" d="M30 25H670M30 78H670M30 130H670"/><polyline class="chart-line" points="${coords.map(c=>`${c.x},${c.y}`).join(' ')}"/>${coords.map((c,i)=>`<circle class="chart-point" cx="${c.x}" cy="${c.y}" r="3.5"><title>${new Date(points[i].t).toLocaleString('fr-FR')} : ${points[i].v}</title></circle>`).join('')}<text x="30" y="14" fill="#9da89b" font-size="10">${hi.toFixed(2)}</text><text x="30" y="148" fill="#9da89b" font-size="10">${lo.toFixed(2)}</text></svg><div class="chart-labels"><span>${new Date(first).toLocaleString('fr-FR')}</span><span>${new Date(last).toLocaleString('fr-FR')}</span></div></section>`;
  }).join('');
}
function history() {
  if(!historyLoaded||!Array.isArray(state.history)) {
    if(!historyLoading&&!historyError)loadHistory();
    return `${heading('AU FIL DU TEMPS','Ton historique d’usage.','Chaque synchronisation et chaque relevé manuel sont conservés.')}<div class="empty-state"><p>${escapeHtml(historyError||'Chargement de l’historique…')}</p>${historyError?'<button class="secondary" data-action="history-retry">Réessayer</button>':''}</div>`;
  }
  const cutoff=historyPeriod==='all'?0:Date.now()-Number(historyPeriod)*86400000;
  const entries=state.history.filter(e=>(historyProvider==='all'||e.providerId===historyProvider)&&Date.parse(e.updatedAt)>=cutoff);
  return `${heading('AU FIL DU TEMPS','Ton historique d’usage.','Chaque synchronisation et chaque relevé manuel sont conservés.',`<button class="secondary" data-action="export">${icon('download',15)} Exporter</button>`)}<div class="history-filters"><select id="history-provider" aria-label="Service dans l’historique"><option value="all">Tous les services</option>${state.providers.map(p=>`<option value="${p.id}" ${historyProvider===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select><select id="history-period" aria-label="Période de l’historique">${[['all','Tout l’historique'],['7','7 derniers jours'],['30','30 derniers jours']].map(([v,t])=>`<option value="${v}" ${historyPeriod===v?'selected':''}>${t}</option>`).join('')}</select></div>${entries.length?`${historyProvider!=='all'?graph(entries,state.providers.find(p=>p.id===historyProvider)):'<p class="hint">Sélectionne un service pour afficher l’évolution de ses soldes et quotas.</p>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Date du relevé</th><th>Service</th><th>Solde / quota restant</th><th>Source</th></tr></thead><tbody>${entries.slice(0,200).map(e=>`<tr><td class="muted">${new Date(e.updatedAt).toLocaleString('fr-FR')}</td><td>${escapeHtml(state.providers.find(p=>p.id===e.providerId)?.name)}</td><td>${e.balances.map(b=>money(b.remaining,b.currency)).join(' / ')}${e.quotaRemaining!==null?`${e.balances.length?' · ':''}${quotaDisplay(e.quotaRemaining,e.providerId)} %`:''}</td><td><span class="badge">${e.source==='api'?'API':'Manuel'}</span></td></tr>`).join('')}</tbody></table></div><p class="settings-foot">${entries.length} relevés · ${entries.length>200?'Les 200 plus récents sont affichés. ':''}Jusqu’à 5 000 relevés conservés. Une variation de solde peut inclure une recharge ; elle ne représente pas nécessairement une dépense.</p>`:`<div class="empty-state"><div class="empty-icon">${icon('chart',28)}</div><h2>${state.history.length?'Aucun relevé sur cette sélection':'Ton historique commence ici.'}</h2><p>Connecte un de tes comptes API, ou ajoute ton premier relevé manuel. Tu retrouveras ici l’évolution de tes soldes et quotas.</p><button class="primary" data-nav="connections">${icon('plug',15)} Voir les connexions</button></div>`}`;
}
function loadHistory() {
  if(historyLoading||(historyLoaded&&Array.isArray(state.history)))return;
  historyLoaded=false;
  if(typeof api.getHistory!=='function'){historyError='L’historique est indisponible dans cet aperçu.';return;}
  historyLoading=true;
  historyError='';
  const revision=state.historyRevision;
  let stale=false;
  api.getHistory().then(entries=>{
    if(!Array.isArray(entries))throw new Error('La réponse de l’historique est illisible.');
    if(revision!==state.historyRevision){stale=true;return;}
    state.history=entries;
    historyLoaded=true;
  }).catch(error=>{historyError=error?.message||'Impossible de charger l’historique.';}).finally(()=>{
    historyLoading=false;
    if(page==='history'){
      if(stale)loadHistory();
      else render();
    }
  });
}
function settings() {
  return `${heading('À TA MAIN','Tes préférences.','Un suivi discret, sur ton appareil.')}<form id="settings-form" class="settings-panel"><label class="settings-row"><div><strong>Apparence</strong><p>Choisis le thème du tableau de bord et du widget.</p></div><select name="theme" aria-label="Thème de l’application"><option value="light" ${state.settings.theme!=='dark'?'selected':''}>Clair</option><option value="dark" ${state.settings.theme==='dark'?'selected':''}>Sombre</option></select></label><label class="settings-row"><div><strong>Actualisation automatique</strong><p>Relire Claude chaque minute et les autres comptes toutes les 5 minutes.<br>L’application doit rester ouverte, même dans la zone de notification.</p></div><input name="autoRefresh" type="checkbox" ${state.settings.autoRefresh?'checked':''}></label><label class="settings-row"><div><strong>Notifications Windows</strong><p>Échéance vérifiée dans les 3 jours, quota inférieur à 20 %<br>ou solde USD inférieur au seuil choisi. Une alerte par jour et par motif.</p></div><input name="notifications" type="checkbox" ${state.settings.notifications?'checked':''}></label><label class="settings-row"><div><strong>Alerte de solde faible · USD</strong><p>Ce seuil s’applique uniquement aux soldes en dollars US.</p></div><input name="lowBalance" type="number" min="0" max="10000" step="0.01" value="${state.settings.lowBalance}"></label>${resourceLegend()}<button class="primary" type="submit">Enregistrer les préférences</button><p class="form-error" role="alert"></p></form><div class="settings-panel" style="margin-top:20px"><div class="section-heading"><h2>Tes données t’appartiennent</h2><span class="badge">Version 0.1.0</span></div><p class="hint">Les données et les clés chiffrées sont enregistrées localement. L’export contient ton inventaire, tes réglages et ton historique, sans les clés.</p><button class="secondary" data-action="export">${icon('download',15)} Exporter mes données</button><p class="settings-foot">Fermer la fenêtre laisse ProvidersBar accessible près de l’horloge. Pour arrêter l’application, fais un clic droit sur son icône, puis « Quitter ».</p></div>`;
}
function quickQuota(quota, label) {
  const value=quota?.remaining;
  const known=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
  return `<span class="quick-quota ${resourceClass(value,'%')}" title="${ResourceLevels.labels[ResourceLevels.level(value,'%')]}" aria-label="${escapeHtml(label)} : ${known?value+' % restants':'indisponible'}"><strong>${known?value+'<small>%</small>':'—'}</strong><span class="quick-meter">${known?`<i style="width:${value}%"></i>`:''}</span></span>`;
}
function quickPeriods(group,provider) {
  return `<div class="quick-periods">${[...group.periods].sort((a,b)=>(a.label==='Semaine'?-1:1)-(b.label==='Semaine'?-1:1)).map(p=>`<div class="quick-period ${provider.id==='claude'&&p.key==='Fable · Semaine'?'fable-weekly':''}"><span class="quick-period-label">${escapeHtml(quotaPeriodLabel(provider,p.key,p.label))}</span>${quickQuota(p.quota,`${p.groupName||group.name} · ${p.label}`)}${p.quota?.remaining===0?`<small class="quick-period-status">${escapeHtml(quotaLimitStatus(provider,p.key,p.label,p.groupName||group.name))}</small>`:''}${resetMarkup(provider,p.key,true)}</div>`).join('')}</div>`;
}
function quickAccountRow(p) {
  const s=p.snapshot;
  let groups=quotaGroups(p);
  const title=`<div class="quick-provider">${logo(p,true)}<div class="provider-title"><h3>${escapeHtml(p.name)}${ollamaFree(p)?' · Free':''}${p.error?' <span class="warning" title="Relevé à vérifier" aria-label="Relevé à vérifier">!</span>':''}</h3>${resourceNotice(p,true)}</div></div>`;
  let values;
  if(p.id==='claude'&&groups.length>1) {
    const rank=key=>key==='Semaine'?0:key==='Fable · Semaine'?1:key==='5 heures'?2:3;
    const periods=groups.flatMap(group=>group.periods.map(period=>({...period,groupName:group.name||(period.key==='Fable · Semaine'?'Fable':'Claude')}))).sort((a,b)=>rank(a.key)-rank(b.key));
    values=quickPeriods({name:'',periods},p);
  }
  else if(groups.length>1) values=groups.map(group=>`<div class="quick-subrow">${group.name?`<span class="quick-group-label">${escapeHtml(group.name)}</span>`:''}${quickPeriods(group,p)}</div>`).join('');
  else if(groups.length)values=quickPeriods(groups[0],p);
  else values=`<span class="quick-amount">${s?.balances?.length?s.balances.map(resourceAmount).join(' / '):s?.quotaRemaining!==null&&s?.quotaRemaining!==undefined?`<span class="resource-value ${resourceClass(s.quotaRemaining,'%')}">${quotaDisplay(s.quotaRemaining,p.id)} %</span>`:'—'}</span>`;
  return `<button class="quick-row resource-${providerResourceLevel(p)} ${resourceUnverified(p)?'resource-unverified':''} ${groups.length>1&&p.id!=='claude'?'grouped':''}" data-provider="${p.id}" data-action="main">${title}${values}${p.id==='ollama'?ollamaReserveMarkup(p,true)+resetMarkup(p,'Mois',true):''}</button>`;
}
let quickResizeFrame;
function fitQuickContent() {
  if(!quick||!api.fitQuick)return;
  clearTimeout(quickResizeFrame);
  quickResizeFrame=setTimeout(()=>{
    const panel=document.querySelector('.quick'),list=panel?.querySelector('.quick-list');
    if(!panel||!list)return;
    const outerHeight=el=>{const css=getComputedStyle(el);return el.getBoundingClientRect().height+parseFloat(css.marginTop)+parseFloat(css.marginBottom);};
    const rows=[...list.children],gap=parseFloat(getComputedStyle(list).rowGap)||0;
    const listHeight=rows.reduce((sum,el)=>sum+outerHeight(el),0)+Math.max(0,rows.length-1)*gap;
    const css=getComputedStyle(panel);
    const height=[...panel.children].filter(el=>el!==list).reduce((sum,el)=>sum+outerHeight(el),listHeight)+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom);
    api.fitQuick(Math.ceil(height)+2).catch(()=>{});
  });
}
const quickSizeObserver=new ResizeObserver(()=>fitQuickContent());
function renderQuick() {
  document.body.classList.add('quick-mode');
  const accounts=state.providers.filter(p=>!(p.type==='subscription'&&p.subscriptionStatus==='expired'&&!ollamaFree(p)));
  document.getElementById('app').innerHTML=`<main class="quick"><div class="quick-head">${brand}<button class="icon-button" data-action="sync" aria-label="Synchroniser" aria-busy="${syncing}" ${syncing?'disabled':''}>${icon('refresh',17)}</button></div><div class="quick-columns"><span>${accounts.length} COMPTES · RESTANT</span></div>${strategyWidget()}<div class="quick-list">${accounts.length?accounts.map(quickAccountRow).join(''):'<p class="hint">Aucun compte à afficher.</p>'}</div><div class="quick-footer"><button class="text-button" data-action="main">Ouvrir le tableau de bord ${icon('arrow',13)}</button></div></main>`;
  quickSizeObserver.disconnect();
  for(const element of document.querySelectorAll('.quick-head,.quick-columns,.quick-strategy,.quick-row,.quick-footer'))quickSizeObserver.observe(element);
  fitQuickContent();
}
function inputField(label,name,value,type='text',extra='',full=false) {return `<div class="field ${full?'full':''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></div>`;}
function selectField(label,name,value,options) {return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></div>`;}
function openDetail(id,tab='info') { dialogId=id;dialogTab=tab;renderDialog();const d=document.getElementById('detail-dialog');if(!d.open)d.showModal(); }
function claudeConnectionBody(p) {
  const direct=p.accountSession?.kind==='claude-live-local';
  const retry=p.claudeSync?.nextAttemptAt;
  return `${p.connected?`<div class="${p.error?'source-note':'connection-success'}">${direct?(p.error?'Lecture directe activée · dernier relevé conservé':'Lecture directe Claude activée · chaque minute'):'Suivi Claude Desktop activé sur ce PC'}</div>`:''}
    <p class="connection-note">${escapeHtml(p.connector.instructions)}</p>
    ${p.accountConnection?.message?`<p class="${p.accountConnection.status==='error'?'form-error':'connection-note'}" role="status">${escapeHtml(p.accountConnection.message)}</p>`:''}
    <div class="source-note">${direct?'Source : service de quotas Claude, via le compte connecté dans Claude Code. Lecture chaque minute, renouvellement automatique de la connexion et reprise après une panne. Ce suivi est périodique ; les délais imposés par Claude sont respectés.':'Source : historique local de Claude Desktop. Détection des nouveaux relevés sous 2 secondes ; Claude Desktop peut espacer ou suspendre ses mesures.'}${direct&&!state.settings.autoRefresh?'<br><strong>Actualisation automatique désactivée dans Réglages.</strong>':''}</div>
    ${p.error&&retry&&Date.parse(retry)>Date.now()?`<p class="connection-note">Prochaine tentative : ${new Date(retry).toLocaleTimeString('fr-FR')}.</p>`:''}
    ${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${direct?` (${Math.round((100-w.remaining)*100)/100} % utilisés)`:''}${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}<br>Relevé du ${new Date(p.snapshot.updatedAt).toLocaleString('fr-FR')} · ${age(p.snapshot.updatedAt)}</div>`:''}
    ${!direct?'<p class="connection-note">Activer la lecture directe autorise ProvidersBar à utiliser et renouveler la connexion Claude Code existante auprès d’Anthropic pour lire les quotas. Les jetons renouvelés sont enregistrés uniquement dans le fichier de connexion Claude Code, jamais dans les données ProvidersBar.</p><div class="form-actions"><button class="primary" data-action="claude-enable-live">Activer la lecture directe (1 min)</button></div>':''}
    <div class="form-actions"><button class="secondary" data-action="account-verify">${direct?'Actualiser les quotas Claude':'Relire le relevé Claude Desktop'}</button></div>
    <p class="form-error" id="account-account-error" role="alert"></p>
    ${p.connected?'<div class="form-actions"><button class="secondary" data-action="disconnect">Arrêter le suivi Claude</button></div>':''}
    ${p.error?`<p class="form-error">${escapeHtml(p.error)}</p>`:''}`;
}
function renderDialog() {
  const p=state.providers.find(p=>p.id===dialogId);
  const currencies=[['USD','USD · Dollar US'],['EUR','EUR · Euro'],['CNY','CNY · Yuan']];
  let body='';
  if(dialogTab==='info') {
    const subscriptionFields=p.type==='subscription'?`${selectField('Statut de l’abonnement','subscriptionStatus',subscriptionStatus(p),[['active','Actif'],['paused','En pause'],['expired',p.id==='ollama'?'Expiré · Free':'Expiré · désactivé']])}<div class="field"><label for="statusMessage">Message affiché si expiré</label><textarea name="statusMessage" id="statusMessage" maxlength="500" placeholder="Ex. Renouvellement indisponible pour ce plan.">${escapeHtml(p.statusMessage||'')}</textarea></div>${p.subscriptionStatus==='expired'?'<label class="check-row"><input type="checkbox" name="confirmRenewal">Je confirme avoir renouvelé ce forfait</label>':''}<p class="hint full status-hint">Un forfait expiré sort du budget et des recommandations. Ollama reste suivi en Free. Pour réactiver un forfait payant, confirme son renouvellement et indique une nouvelle échéance future.</p>`:'';
    body=`<form id="provider-form"><div class="fields">${inputField('Offre / formule','plan',p.plan,'text','maxlength="200" placeholder="Nom de ton offre"',true)}${subscriptionFields}${inputField(ollamaFree(p)?'Ancien tarif du forfait':p.type==='subscription'?'Tarif':'Budget de référence (facultatif)','amount',p.amount,'number','min="0" max="1000000000000" step="0.01" placeholder="Inconnu"')}${selectField('Devise','currency',p.currency,currencies)}${selectField('Périodicité','billingCycle',p.billingCycle,[['unknown','À préciser'],['monthly','Mensuelle'],['yearly','Annuelle'],['one-time','Paiement unique']])}${inputField(p.type==='subscription'&&subscriptionStatus(p)==='expired'?'Dernière échéance connue':'Prochaine échéance','renewalDate',p.renewalDate,'date')}${inputField('Prochain tarif (facultatif)','nextAmount',p.nextAmount,'number','min="0" step="0.01" placeholder="Aucun"')}${inputField('Date du changement de tarif','priceChangeDate',p.priceChangeDate,'date')}<div class="field full"><label for="notes">Notes</label><textarea name="notes" id="notes" maxlength="2000">${escapeHtml(p.notes)}</textarea></div></div><label class="check-row"><input type="checkbox" name="reviewed" ${p.reviewed?'checked':''}>J’ai vérifié les informations de cette fiche</label>${p.type==='subscription'?'':`<label class="check-row"><input type="checkbox" name="active" ${p.active?'checked':''}>Inclure ce service dans le suivi actif</label>`}<div class="form-error" role="alert"></div><div class="form-actions"><button class="secondary" type="button" data-action="close-dialog">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
  }
  if(dialogTab==='manual') {
    const s=p.snapshot, b=s?.balances.find(b=>b.currency===p.currency);
    let localReset='';if(s?.resetAt){const dt=new Date(s.resetAt);localReset=new Date(dt-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    body=p.connected?`<div class="connection-success">Ce compte est synchronisé automatiquement.</div><p class="hint">Pour saisir un solde manuel, déconnecte d’abord le compte dans l’onglet Connexion. Le dernier relevé restera dans l’historique.</p>`:`<form id="manual-form"><p class="hint">Saisis une valeur lue sur ton compte. Ce relevé sera daté et identifié comme manuel. Un champ vide reste inconnu.</p><div class="fields">${inputField('Solde restant','balance',b?.remaining??null,'number','step="0.01" placeholder="Inconnu"')}${selectField('Devise du solde','currency',p.currency,currencies)}${inputField('Quota restant (%)','quotaRemaining',s?.quotaRemaining,'number','min="0" max="100" step="0.1" placeholder="Inconnu"')}${inputField('Prochain reset (heure locale)','resetAt',localReset,'datetime-local')}</div><div class="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">Enregistrer le relevé</button></div></form>`;
  }
  if(dialogTab==='connection'&&hasConnector(p)) body=`${p.connected?'<div class="connection-success">Compte connecté · clé enregistrée et chiffrée</div>':''}<p class="connection-note">${escapeHtml(p.connector.instructions)}<br>La connexion est vérifiée avant l’enregistrement de la clé.</p>${p.snapshot?.details?.length?`<div class="source-note">${p.snapshot.details.map(d=>`${escapeHtml(d.label)} : <strong>${money(d.amount,d.currency)}</strong>`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}<form id="connection-form"><div class="field"><label for="api-key">${p.connected?'Remplacer la clé':escapeHtml(p.connector.keyLabel)}</label><input id="api-key" name="key" type="password" autocomplete="off" spellcheck="false" required maxlength="4096" placeholder="Colle ta clé ici"><small>Ta clé ne sera jamais affichée dans l’historique ou dans un export.</small></div><div class="form-error" role="alert"></div><div class="form-actions">${p.connected?'<button class="secondary" data-action="disconnect" type="button">Déconnecter</button>':''}<button class="primary" type="submit">${p.connected?'Vérifier et remplacer':'Vérifier et connecter'}</button></div></form>${p.error?`<div class="divider"></div><p class="form-error">${escapeHtml(p.error)}</p>`:''}`;
  if(dialogTab==='connection'&&p.connector?.mode==='account') {
    const prefix=(p.connector.browserAccount||p.connector.codexAccount||p.connector.localAccount)?'account':p.id==='orcarouter'?'orca':'ollama';
    const progress=p.accountConnection;
    body=`${p.connected?`<div class="${p.error?'connection-note':'connection-success'}">${p.error?'Session enregistrée · dernier relevé à vérifier':`Session ${escapeHtml(p.name)} enregistrée sur cet appareil`}</div>`:''}<p class="connection-note">${escapeHtml(p.connector.instructions)}</p>${progress?.message?`<p class="${progress.status==='error'?'form-error':'connection-note'}" role="status" id="${prefix}-connection-progress">${escapeHtml(progress.message)}</p>`:''}${p.connected&&(p.snapshot?.balances?.length||ollamaUsageCredits(p))?`<div class="source-note">${p.snapshot.balances.length?`<strong>${escapeHtml(p.snapshot.balanceLabel||'Solde du portefeuille')} : ${p.snapshot.balances.map(b=>money(b.remaining,b.currency)).join(' / ')}</strong>`:''}${p.id==='ollama'?`<br><strong>${ollamaUsageCredits(p)?.stale?'Dernier solde acheté connu':'Réserve supplémentaire'} : ${ollamaUsageCredits(p)?money(ollamaUsageCredits(p).remaining,'USD'):'—'}</strong>${ollamaUsageCredits(p)?.stale?`<br>Dernière lecture : ${age(ollamaUsageCredits(p).observedAt)}`:''}`:''}${(p.snapshot.details||[]).map(d=>`<br>${escapeHtml(d.label)} : ${money(d.amount,d.currency)}`).join('')}${p.snapshot.resetAt?`<br>Remise à zéro : ${new Date(p.snapshot.resetAt).toLocaleString('fr-FR')}`:''}<br>${age(p.snapshot.updatedAt)}</div>`:''}<p class="source-note">${p.id==='ollama'?(ollamaUsageCredits(p)?.stale?'Ollama ne fournit pas de montant plus récent ; cette valeur est le dernier solde acheté confirmé. ':'Le montant des crédits achetés est affiché avec le compte Ollama. '):''}${p.connector.codexAccount?'La session est gérée par Codex sur ce PC.':'La session reste dans un navigateur isolé de l’application.'} Aucun mot de passe n’est lu par ProvidersBar.</p><div class="form-actions"><button class="secondary" data-action="${prefix}-open">${p.connector.codexAccount?(p.connected?'Actualiser via Codex':'Connecter avec Codex'):p.connected?'Ouvrir mon compte':`Se connecter sur ${escapeHtml(p.name)}`}</button><button class="primary" data-action="${prefix}-verify">Vérifier maintenant</button></div><p class="form-error" id="${prefix}-account-error" role="alert"></p>${p.connected?'<div class="form-actions"><button class="secondary" data-action="disconnect">Déconnecter et effacer la session</button></div>':''}${p.error?`<p class="form-error">${escapeHtml(p.error)}</p>`:''}`;
  }
  if(dialogTab==='connection'&&p.id==='antigravity') body=`<p class="connection-note">${escapeHtml(p.connector.instructions)}</p>${p.accountConnection?.message?`<p class="connection-note" role="status">${escapeHtml(p.accountConnection.message)}</p>`:''}<div class="source-note">Ces quotas concernent les modèles utilisés dans Antigravity. Le pourcentage principal correspond à la limite la plus basse.<br>Antigravity 2.0 doit rester ouvert pour l’actualisation automatique.</div>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}</div>`:''}<div class="form-actions"><button class="primary" data-action="account-open">${p.connected?'Actualiser Antigravity':'Connecter Antigravity'}</button><button class="secondary" data-action="account-verify">Vérifier maintenant</button></div><p class="form-error" id="account-account-error" role="alert"></p>${p.connected?'<div class="form-actions"><button class="secondary" data-action="disconnect">Arrêter le suivi Antigravity</button></div>':''}`;
  if(dialogTab==='connection'&&p.connector?.codexAccount) body += `<p class="hint">Les limites proviennent du compte ChatGPT connecté à Codex sur ce PC. Déconnecter ici arrête seulement le suivi dans ProvidersBar.</p>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}`;
  if(dialogTab==='connection'&&p.connector?.browserAccount) body += `<p class="hint">Connecte-toi dans la fenêtre Chrome ou Edge, puis ferme-la : la vérification démarrera automatiquement. La session reste dans un profil dédié à ce fournisseur. Les mots de passe et conversations ne sont pas lus. Pour « Vérifier maintenant », laisse la fenêtre ouverte : termine le contrôle humain éventuel, puis ProvidersBar la fermera après lecture. Si le quota n’est pas accessible, le dernier relevé est conservé.</p>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}`;
  if(dialogTab==='connection'&&p.id==='ollama') body += '<p class="hint">La connexion s’ouvre dans une fenêtre Chrome ou Edge dédiée. Termine la connexion Google jusqu’au retour sur Ollama, puis ferme cette fenêtre : ProvidersBar vérifiera alors la session. Si tu utilises un lien reçu par e-mail, ouvre-le dans cette même fenêtre pour conserver la session.</p><button class="secondary" data-action="ollama-email">Alternative : connexion par email intégrée</button>';
  if(dialogTab==='connection'&&p.id==='claude') body=claudeConnectionBody(p);
  if(dialogTab==='resets'&&p.type==='subscription')body=resetForm(p);
  document.getElementById('detail-dialog').innerHTML=`<div class="dialog-head">${logo(p)}<div><h2 id="detail-title">${escapeHtml(p.name)}</h2><p>${p.type==='subscription'?'Abonnement':'Accès API'} · ${p.reviewed?'Fiche vérifiée':'Fiche à vérifier'}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Fermer la fiche">${icon('close',19)}</button></div><nav class="dialog-tabs" aria-label="Sections de la fiche">${[['info','Informations'],['manual','Relevé manuel'],...(p.type==='subscription'?[['resets','Réinitialisations']]:[]),...(hasConnector(p)?[['connection','Connexion']]:[])].map(([id,text])=>`<button class="${dialogTab===id?'active':''}" data-dialog-tab="${id}">${text}</button>`).join('')}</nav><div class="dialog-body">${body}</div>`;
}
async function runAction(action, button) {
  if(!state.desktop&&!['close-dialog','main'].includes(action)) {toast('Cette action est disponible dans l’application Windows.');return;}
  if(action==='claude-enable-live') {
    button.disabled=true;
    try {state=await api.enableClaudeLive();render();if(dialogId)renderDialog();toast('Lecture directe Claude activée.');}
    catch(error) {const node=document.getElementById('account-account-error');if(node)node.textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}
    finally {button.disabled=false;}
    return;
  }
  if(action==='close-dialog'){document.getElementById('detail-dialog').close();dialogId=null;return;}
  if(action==='main'){api.showMain();return;}
  if(action==='history-retry'){historyError='';loadHistory();render();return;}
  if(['account-open','account-verify'].includes(action)) {
    const id=dialogId; button.disabled=true;
    try {
      if(action==='account-open'){await api.openAccount(id);toast(id==='antigravity'?'Quotas Antigravity actualisés.':id==='openai'?'Connexion OpenAI en cours via Codex.':'Connecte-toi sur le site officiel, puis ferme cette fenêtre Chrome ou Edge.');}
      else {state=await api.verifyAccount(id);render();if(dialogId)renderDialog();toast(state.providers.find(p=>p.id===id).error||(id==='claude'?'Relevé Claude récupéré.':'Compte connecté. Quotas mis à jour.'));}
    } catch(error) {const message=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''); const node=document.getElementById('account-account-error');if(node)node.textContent=message;else toast(message);}
    finally{button.disabled=false;}
    return;
  }
  if(['orca-open','orca-verify','ollama-open','ollama-verify','ollama-email'].includes(action)) {
    const isOllama=action.startsWith('ollama-'), name=isOllama?'Ollama':'OrcaRouter';
    button.disabled=true;
    const errorNode=document.getElementById(`${isOllama?'ollama':'orca'}-account-error`);
    if(errorNode)errorNode.textContent='';
    try {
      if(action==='ollama-email'){await api.openOllamaEmail();toast('Utilise « Continue with email » sur Ollama.');}
      else if(action.endsWith('-open')){await (isOllama?api.openOllamaAccount():api.openOrcaAccount());toast(`Connecte-toi sur ${name}. Les usages seront récupérés automatiquement.`);}
      else {state=await (isOllama?api.verifyOllamaAccount():api.verifyOrcaAccount());render();renderDialog();toast(`${name} synchronisé.`);}
    }catch(error){if(errorNode)errorNode.textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}
    finally{button.disabled=false;}
    return;
  }
  if(action==='sync') {
    if(!state.providers.some(p=>p.connected&&isTracked(p))){toast('Connecte un compte dans Connexions pour synchroniser les soldes.');if(!quick){page='connections';render();}return;}
    syncing=true;render();
    try{state=await api.syncAll();const errors=state.providers.filter(p=>p.connected&&isTracked(p)&&p.error);toast(errors.length?`${errors.length} connexion(s) à vérifier. Les derniers relevés ont été conservés.`:'Les soldes sont à jour.');}finally{syncing=false;render();}
  }
  if(action==='strategy-settings'){page='settings';render();document.getElementById('strategy-form').scrollIntoView({block:'start'});return;}
  if(action==='disconnect'){button.disabled=true;state=await api.disconnect(dialogId);render();renderDialog();toast('Compte déconnecté. Historique conservé.');}
  if(action==='export'){if(await api.exportData())toast('Données exportées, sans les clés.');}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
    if(button.dataset.nav){page=button.dataset.nav;render();window.scrollTo(0,0);}
    else if(button.dataset.filter){filter=button.dataset.filter;render();}
    else if(button.dataset.open)openDetail(button.dataset.open,button.dataset.tab||'info');
    else if(button.dataset.dialogTab){dialogTab=button.dataset.dialogTab;renderDialog();}
    else if(button.dataset.favorite){if(!state.desktop){toast('Les favoris se modifient dans l’application Windows.');return;}const p=state.providers.find(p=>p.id===button.dataset.favorite);state=await api.updateProvider(p.id,{favorite:!p.favorite});render();}
    else if(button.dataset.action)await runAction(button.dataset.action,button);
  }catch(error){toast(error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));button.disabled=false;}
});
document.addEventListener('input',event=>{if(event.target.id==='search'){query=event.target.value;document.getElementById('provider-cards').innerHTML=filteredCards();}});
document.addEventListener('change',event=>{if(event.target.id==='history-provider'){historyProvider=event.target.value;render();}if(event.target.id==='history-period'){historyPeriod=event.target.value;render();}});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;
  const errorNode=form.querySelector('.form-error');
  if(!state.desktop){if(errorNode)errorNode.textContent='Ouvre l’application Windows pour enregistrer cette modification.';return;}
  const data=new FormData(form),get=name=>data.get(name),num=name=>get(name)===''?null:Number(get(name));
  const button=form.querySelector('button[type="submit"]'),oldLabel=button.textContent;
  button.disabled=true;button.textContent=form.id==='connection-form'?'Vérification…':'Enregistrement…';if(errorNode)errorNode.textContent='';
  try{
    if(form.id==='provider-form'){
      const provider=state.providers.find(p=>p.id===dialogId);
      const patch={plan:get('plan'),amount:num('amount'),currency:get('currency'),billingCycle:get('billingCycle'),renewalDate:get('renewalDate')||null,nextAmount:num('nextAmount'),priceChangeDate:get('priceChangeDate')||null,notes:get('notes'),reviewed:data.has('reviewed')};
      if(provider.type==='subscription') {patch.subscriptionStatus=get('subscriptionStatus');patch.statusMessage=get('statusMessage');patch.confirmRenewal=data.has('confirmRenewal');}
      else patch.active=data.has('active');
      state=await api.updateProvider(dialogId,patch);
      document.getElementById('detail-dialog').close();dialogId=null;toast('Fiche enregistrée.');
    }
    if(form.id==='resets-form'){const dates=Object.fromEntries(QuotaResets.slots(state.providers.find(p=>p.id===dialogId)).map((slot,i)=>[slot.key,get('reset-date-'+i)?{date:get('reset-date-'+i),time:get('reset-time-'+i)||null}:null]));state=await api.saveResets(dialogId,dates);renderDialog();toast('Dates de réinitialisation enregistrées.');}
    if(form.id==='manual-form'){state=await api.saveManual(dialogId,{balance:num('balance'),currency:get('currency'),quotaRemaining:num('quotaRemaining'),resetAt:get('resetAt')?new Date(get('resetAt')).toISOString():null});document.getElementById('detail-dialog').close();dialogId=null;toast('Relevé ajouté à l’historique.');}
    if(form.id==='connection-form'){state=await api.connect(dialogId,get('key'));form.reset();renderDialog();toast('Compte connecté. Le solde a été récupéré.');}
    if(form.id==='strategy-form'){state=await api.updateStrategy({enabled:data.has('strategyEnabled'),contributor:data.has('contributor'),inputTokens:num('inputTokens'),outputTokens:num('outputTokens'),cachePercent:num('cachePercent'),subscriptionModels:Object.fromEntries(UsageStrategy.buckets.map(b=>[b.id,get('model:'+b.id)])),disabledRoutes:UsageStrategy.routes.filter(r=>!data.has('route:'+r.id)).map(r=>r.id)});toast('Stratégie enregistrée.');}
    if(form.id==='settings-form'){state=await api.updateSettings({autoRefresh:data.has('autoRefresh'),notifications:data.has('notifications'),lowBalance:num('lowBalance'),theme:get('theme')});toast('Préférences enregistrées.');}
    render();
  }catch(error){if(errorNode)errorNode.textContent=error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}
  finally{button.disabled=false;button.textContent=oldLabel;}
});
document.getElementById('detail-dialog').addEventListener('close',()=>{dialogId=null;});
function receiveState(data) {
  const changedAccounts=data.providers.filter(p=>p.connector?.mode==='account').filter(after=>{
    const before=state.providers.find(p=>p.id===after.id);
    return JSON.stringify([before?.connected,before?.accountConnection,before?.error,before?.snapshot?.updatedAt])!==JSON.stringify([after.connected,after.accountConnection,after.error,after.snapshot?.updatedAt]);
  });
  const justConnected=changedAccounts.filter(after=>after.accountConnection?.status==='connected'&&state.providers.find(p=>p.id===after.id)?.accountConnection?.status!=='connected');
  const historyChanged=data.historyRevision!==state.historyRevision;
  const cachedHistory=state.history;
  state={...data,...(!historyChanged&&Array.isArray(cachedHistory)?{history:cachedHistory}:{})};
  historyLoaded=Array.isArray(state.history);
  if(historyChanged)historyError='';
  applyTheme(state.settings?.theme);
  if(page!=='settings'&&!document.querySelector('#search:focus'))render();
  if(changedAccounts.some(p=>p.id===dialogId)&&dialogTab==='connection')renderDialog();
  for(const p of justConnected)toast(p.error||(p.id==='claude'?'Relevé Claude récupéré.':`${p.name} connecté. Les usages sont à jour.`));
}
async function start(){try{state=await api.getState();historyLoaded=Array.isArray(state.history);render();api.onChange(receiveState);setInterval(()=>{if(!dialogId&&page!=='settings'&&!document.querySelector('input:focus,textarea:focus,select:focus'))render();},60000);}catch(error){document.getElementById('app').innerHTML=`<div class="loading">${escapeHtml(error.message)}</div>`;}}
start();
