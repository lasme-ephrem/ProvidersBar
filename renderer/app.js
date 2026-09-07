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
const providerLogos = {openai:'openai.svg',gemini:'gemini.svg',antigravity:'antigravity.ico',zai:'zai.svg',ollama:'ollama.png',grok:'grok.svg',openrouter:'openrouter.png',deepseek:'deepseek.ico',runinfra:'runinfra.svg',orcarouter:'orcarouter.png'};
const logo = (p, small=false) => `<span class="logo ${small?'small':''} provider-${escapeHtml(p.id)}" style="--provider-color:${escapeHtml(p.color)}">${providerLogos[p.id]?`<img src="../assets/providers/${providerLogos[p.id]}" alt="" draggable="false">`:escapeHtml(p.monogram)}</span>`;
const hasConnector = p => Boolean(p.connector);
let mobileInfo = null;
let state, page='overview', filter='all', query='', dialogId=null, dialogTab='info', historyProvider='all', historyPeriod='all', syncing=false, toastTimer;
let api=window.providersBar;
const quick=new URLSearchParams(location.search).get('mode')==='quick';

// The browser preview is intentionally read-only and never accepts API credentials.
if (!api) api={getState:async()=>{ const response=await fetch('/preview-state'); if(!response.ok) throw new Error('Ouvre ProvidersBar avec son lanceur Windows.'); return response.json(); },onChange:()=>()=>{},showMain:()=>location.assign('/')};
function toast(message) { const el=document.getElementById('toast'); el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500); }
function nav(id,label,name,count) { return `<button data-nav="${id}" class="${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(name)}${label}${count===undefined?'':`<span class="count">${count}</span>`}</button>`; }
function render() {
  if (quick) { renderQuick(); return; }
  const labels={overview:'Vue d’ensemble',subscriptions:'Abonnements',history:'Historique',connections:'Connexions',settings:'Réglages'};
  document.getElementById('app').innerHTML=`${state.desktop?'':'<div class="preview-banner">Aperçu en lecture seule · Ouvre l’application Windows pour enregistrer tes données et connecter tes comptes.</div>'}<div class="shell"><aside class="sidebar">${brand}<div class="workspace"><span class="workspace-avatar">P</span><div><strong>Espace personnel</strong><small>Mes outils, au même endroit</small></div></div><div class="nav-label">ESPACE DE TRAVAIL</div><nav class="nav" aria-label="Navigation principale">${nav('overview','Vue d’ensemble','grid',state.providers.length)}${nav('subscriptions','Abonnements','wallet',state.providers.filter(p=>p.type==='subscription').length)}${nav('history','Historique','chart')}${nav('connections','Connexions','plug')}</nav><div class="sidebar-bottom"><nav class="nav">${nav('settings','Réglages','settings')}</nav><div class="local-status"><span class="dot"></span>Données stockées sur cet appareil</div></div></aside><main class="main"><header class="topbar"><div class="crumb">Espace personnel <span>/</span><span>${labels[page]}</span></div><div class="top-actions"><span class="local-pill">${icon('shield',12)} Stockage local</span><span>${new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}</span></div></header><div class="content">${page==='overview'?overview():page==='subscriptions'?subscriptions():page==='history'?history():page==='connections'?connections():settings()}</div></main></div>`;
}
function heading(kicker,title,description,action='') { return `<div class="heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`; }
function syncButton() { return `<button class="primary" data-action="sync" ${syncing?'disabled':''}>${icon('refresh',15)} ${syncing?'Synchronisation…':'Synchroniser'}</button>`; }
function stats() {
  const sub=state.providers.filter(p=>p.type==='subscription'&&p.active), apiCount=state.providers.filter(p=>p.type==='api'&&p.active).length;
  const connected=state.providers.filter(p=>p.connected).length;
  const totals=Object.entries(state.summary.monthly);
  const monthly=totals.length?totals.map(([currency,value])=>money(value,currency)).join(' + '):'—';
  const next=state.providers.filter(p=>p.active&&p.renewalDate&&days(p.renewalDate)>=0).sort((a,b)=>a.renewalDate.localeCompare(b.renewalDate))[0];
  return `<section class="stats" aria-label="Chiffres clés"><div class="stat"><div class="stat-top">Services suivis ${icon('grid',15)}</div><div class="stat-value">${sub.length+apiCount}<small>services</small></div><div class="stat-note">${sub.length} abonnements · ${apiCount} accès API</div></div><div class="stat"><div class="stat-top">Abonnements / mois ${icon('wallet',15)}</div><div class="stat-value">${monthly}</div><div class="stat-note">${state.summary.unpriced?`${state.summary.unpriced} périodicités ou tarifs à préciser`:'Équivalent mensuel des tarifs renseignés'}</div></div><div class="stat"><div class="stat-top">Comptes connectés ${icon('plug',15)}</div><div class="stat-value accent">${connected}<small>/ ${state.providers.filter(hasConnector).length} disponibles</small></div><div class="stat-note">${connected?'Actualisation automatique toutes les 5 min':'3 connexions API · 7 connexions au compte'}</div></div><div class="stat"><div class="stat-top">Prochaine échéance ${icon('clock',15)}</div><div class="stat-value">${next?`${days(next.renewalDate)}<small>jours</small>`:'—'}</div><div class="stat-note">${next?`${escapeHtml(next.name)}${next.reviewed?'':' · date à vérifier'}`:'Aucune date à venir renseignée'}</div></div></section>`;
}
function toolbar() { return `<div class="toolbar"><div class="filters" role="group" aria-label="Filtrer les services">${[['all','Tous les services'],['subscription','Abonnements'],['api','API'],['favorite','Favoris']].map(([id,label])=>`<button data-filter="${id}" class="${filter===id?'active':''}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><label class="search">${icon('search',15)}<input id="search" type="search" placeholder="Rechercher un service…" aria-label="Rechercher un service" value="${escapeHtml(query)}"></label></div>`; }
function overview() { return `${heading('TOUT SOUS LES YEUX','Tes usages, en un regard.','Quotas, crédits et abonnements. Garde le fil de tes outils IA.',syncButton())}${stats()}<div class="section-heading"><h2>Mes providers <small>${state.providers.length} services</small></h2><span class="muted" style="font-size:10px">Clique sur une carte pour la configurer</span></div>${toolbar()}<section class="cards" id="provider-cards" aria-label="Mes providers">${filteredCards()}</section><div class="bottom-note"><span>${icon('shield',12)} Tes clés restent chiffrées sur cet appareil.</span><span>Aucune estimation présentée comme un solde réel.</span></div>`; }
function filteredCards() {
  const providers=state.providers.filter(p=>(filter==='all'||(filter==='favorite'?p.favorite:p.type===filter))&&p.name.toLowerCase().includes(query.toLowerCase()));
  return providers.length?providers.map(card).join(''):'<div class="empty-state" style="grid-column:1/-1"><h2>Aucun service trouvé</h2><p>Essaie un autre nom ou un autre filtre.</p></div>';
}
function statusBadge(p) {
  if(p.syncing) return '<span class="badge">Synchronisation…</span>';
  if(p.error) return `<span class="badge error">${p.connected&&p.error.includes('quota indisponible')?'Quota indisponible':'Connexion à vérifier'}</span>`;
  if(p.snapshot) {
    if(p.snapshot.source==='api'&&!p.connected) return '<span class="badge">Déconnecté · dernier relevé</span>';
    if(Date.now()-Date.parse(p.snapshot.updatedAt)>600000) return '<span class="badge warn">Relevé ancien</span>';
    return `<span class="badge ${p.snapshot.source==='api'?'live':''}">${p.snapshot.source==='api'?'Synchronisé':'Saisie manuelle'}</span>`;
  }
  return `<span class="badge">${p.connected?'Compte connecté':hasConnector(p)?'À connecter':'Saisie manuelle'}</span>`;
}
function quotaGroups(p) {
  const windows=p.snapshot?.quotaWindows;
  if(!windows?.length)return [];
  const find=label=>windows.find(w=>w.label===label);
  if(p.id==='antigravity') return [
    {name:'Gemini',periods:[{label:'5 heures',quota:find('Gemini · 5 heures')},{label:'Semaine',quota:find('Gemini · Semaine')}]},
    {name:'Claude / GPT',periods:[{label:'5 heures',quota:find('Claude et GPT · 5 heures')},{label:'Semaine',quota:find('Claude et GPT · Semaine')}]},
  ];
  if(['gemini','zai'].includes(p.id)) return [{name:'',periods:[{label:'5 heures',quota:find('5 heures')||find('Période en cours')},{label:'Semaine',quota:find('Semaine')}]}];
  if(p.id==='openai') {
    const weekly=windows.find(w=>/^Codex et Work · Semaine$/.test(w.label));
    return [{name:'Codex et Work',periods:[{label:'Semaine',quota:weekly}]}];
  }
  return [];
}
function quotaGroupsMarkup(groups) {
  return `<div class="quota-groups">${groups.map(group=>`<section class="quota-group">${group.name?`<h4>${escapeHtml(group.name)}</h4>`:''}<div class="quota-periods ${group.periods.length===1?'single':''}">${[...group.periods].sort((a,b)=>(a.label==='Semaine'?-1:1)-(b.label==='Semaine'?-1:1)).map(({label,quota})=>{
    const value=quota?.remaining;
    const known=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
    return `<div class="quota-period" ${quota?.resetAt?`title="${escapeHtml(resetLabel(quota.resetAt))}"`:''}><div class="quota-period-label">${label==='Semaine'?'Hebdo':'5 h'}</div><div class="quota-period-value">${known?`${value}<small>%</small>`:'—'}</div><div class="meter ${known?(value<=20?'low':''):'empty'}" role="meter" aria-label="${escapeHtml(group.name+' '+label)} : quota restant" ${known?`aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"`:'aria-valuetext="Indisponible"'}>${known?`<span style="width:${value}%"></span>`:''}</div></div>`;
  }).join('')}</div></section>`).join('')}</div>`;
}
function card(p) {
  const s=p.snapshot;
  const groups=quotaGroups(p);
  let metric,label,note;
  if(s?.balances?.length) {label=escapeHtml(s.balanceLabel||'Dernier solde connu');metric=s.balances.map(b=>money(b.remaining,b.currency)).join('<small> / </small>');note=age(s.updatedAt);}
  else if(s?.quotaRemaining!==null&&s?.quotaRemaining!==undefined){label=escapeHtml(s.quotaLabel||'Quota restant');metric=`${quotaDisplay(s.quotaRemaining,p.id)}<small>%</small>`;note=age(s.updatedAt);}
  else if(p.type==='subscription'){label='Tarif renseigné';metric=p.amount===null?'<span class="unknown">—</span>':`${money(p.amount,p.currency)}`;note=p.billingCycle==='monthly'?'par mois':p.billingCycle==='yearly'?'par an':p.billingCycle==='one-time'?'paiement unique':'Périodicité à préciser';}
  else{label='Crédits restants';metric='<span class="unknown">—</span>';note='Connecte le compte ou ajoute un relevé';}
  const quota=s?.quotaRemaining;
  const hasQuota=quota!==null&&quota!==undefined;
  const subline=s?.resetAt?resetLabel(s.resetAt):p.type==='subscription'?(p.renewalDate?`${days(p.renewalDate)<0?'Date passée':'Échéance'} · ${shortDate(p.renewalDate)}`:'Échéance à préciser'):'';
  return `<article class="card"><button class="card-open" data-open="${p.id}" aria-label="Configurer ${escapeHtml(p.name)}"></button><div class="card-top">${logo(p)}<div class="provider-title"><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.plan)||(p.type==='subscription'?'Abonnement':'API à la consommation')}${p.active?'':' · en pause'}</p></div><button class="icon-button ${p.favorite?'selected':''}" data-favorite="${p.id}" title="${p.favorite?'Retirer des favoris':'Ajouter aux favoris'}" aria-label="${p.favorite?'Retirer':'Ajouter'} ${escapeHtml(p.name)} ${p.favorite?'des':'aux'} favoris" aria-pressed="${p.favorite}">${icon('star',15)}</button></div><div class="card-content">${groups.length?`<div class="metric-label">Quotas restants</div>${quotaGroupsMarkup(groups)}`:`<div class="metric-label">${label}</div><div class="metric">${metric}</div><div class="metric-note">${note}</div><div class="quota"><div class="quota-label"><span>${hasQuota?'Quota restant':p.type==='subscription'?'Usage non renseigné':'Solde du compte'}</span><strong>${hasQuota?quotaDisplay(quota,p.id)+' %':'—'}</strong></div><div class="meter ${hasQuota?(quota<=20?'low':''):'empty'}">${hasQuota?`<span style="width:${quota}%"></span>`:''}</div></div>`}<div class="card-bottom"><span>${groups.length?age(s?.updatedAt):subline}</span>${statusBadge(p)}</div>${p.error?`<p class="card-error">${escapeHtml(p.error)}</p>`:''}</div></article>`;
}
function subscriptions() {
  const list=state.providers.filter(p=>p.type==='subscription');
  return `${heading('BUDGET & ÉCHÉANCES','Tes abonnements.','Retrouve tes tarifs et vérifie les prochaines échéances.')}${stats()}<div class="table-wrap"><table class="data-table"><thead><tr><th>Service</th><th>Tarif</th><th>Périodicité</th><th>Échéance renseignée</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><div class="table-name">${logo(p,true)}<div><strong>${escapeHtml(p.name)}</strong><small>${p.reviewed?'Informations vérifiées':'Informations à vérifier'}${p.active?'':' · en pause'}</small></div></div></td><td>${p.amount===null?'—':money(p.amount,p.currency)}${p.nextAmount!==null?`<div class="warning" style="font-size:10px;margin-top:5px">Puis ${money(p.nextAmount,p.currency)}</div>`:''}</td><td class="muted">${{unknown:'À préciser',monthly:'Mensuelle',yearly:'Annuelle','one-time':'Paiement unique'}[p.billingCycle]}</td><td class="${p.renewalDate&&days(p.renewalDate)<0?'warning':'muted'}">${shortDate(p.renewalDate)}${p.renewalDate&&days(p.renewalDate)<0?'<div style="font-size:10px;margin-top:4px">Date passée · à vérifier</div>':''}</td><td><button class="secondary" data-open="${p.id}">Modifier</button></td></tr>`).join('')}</tbody></table></div><p class="settings-foot">L’équivalent mensuel inclut seulement les abonnements actifs avec un tarif et une périodicité renseignés. Les devises restent séparées.</p>`;
}
function connections() {
  return `${heading('SYNCHRONISATION','Connecte tes comptes.','Tes soldes et quotas, lus directement auprès des fournisseurs.',syncButton())}<div class="connection-grid">${state.providers.filter(hasConnector).map(p=>`<section class="connection-card"><div class="card-top">${logo(p)}<div class="provider-title"><h3>${escapeHtml(p.name)}</h3><p style="margin:4px 0 0;min-height:0;font-size:10px">${escapeHtml(p.connector.scope)}</p></div>${statusBadge(p)}</div><p>${escapeHtml(p.connector.description)}</p>${p.error?`<p class="warning">${escapeHtml(p.error)}</p>`:''}<div class="connection-footer"><span class="muted" style="font-size:10px">${p.connected?age(p.snapshot?.updatedAt):'Connexion non configurée'}</span><button class="primary" data-open="${p.id}" data-tab="connection">${icon('plug',14)} ${p.connected?'Gérer la connexion':'Connecter'}</button></div></section>`).join('')}</div><div class="info-box">Les clés sont chiffrées par Windows et ne sont jamais incluses dans les exports. Les connexions API lisent les crédits ; Les six autres fournisseurs utilisent chacun une session de compte isolée. Aucun modèle n’est appelé.</div><p class="hint">Un relevé manuel reste possible depuis la fiche d’un service déconnecté.</p><div class="manual-list">${state.providers.filter(p=>!hasConnector(p)).map(p=>`<button data-open="${p.id}" data-tab="manual">${escapeHtml(p.name)} ${icon('arrow',12)}</button>`).join('')}</div>`;
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
  const cutoff=historyPeriod==='all'?0:Date.now()-Number(historyPeriod)*86400000;
  const entries=state.history.filter(e=>(historyProvider==='all'||e.providerId===historyProvider)&&Date.parse(e.updatedAt)>=cutoff);
  return `${heading('AU FIL DU TEMPS','Ton historique d’usage.','Chaque synchronisation et chaque relevé manuel sont conservés.',`<button class="secondary" data-action="export">${icon('download',15)} Exporter</button>`)}<div class="history-filters"><select id="history-provider" aria-label="Service dans l’historique"><option value="all">Tous les services</option>${state.providers.map(p=>`<option value="${p.id}" ${historyProvider===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}</select><select id="history-period" aria-label="Période de l’historique">${[['all','Tout l’historique'],['7','7 derniers jours'],['30','30 derniers jours']].map(([v,t])=>`<option value="${v}" ${historyPeriod===v?'selected':''}>${t}</option>`).join('')}</select></div>${entries.length?`${historyProvider!=='all'?graph(entries,state.providers.find(p=>p.id===historyProvider)):'<p class="hint">Sélectionne un service pour afficher l’évolution de ses soldes et quotas.</p>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Date du relevé</th><th>Service</th><th>Solde / quota restant</th><th>Source</th></tr></thead><tbody>${entries.slice(0,200).map(e=>`<tr><td class="muted">${new Date(e.updatedAt).toLocaleString('fr-FR')}</td><td>${escapeHtml(state.providers.find(p=>p.id===e.providerId)?.name)}</td><td>${e.balances.map(b=>money(b.remaining,b.currency)).join(' / ')}${e.quotaRemaining!==null?`${e.balances.length?' · ':''}${quotaDisplay(e.quotaRemaining,e.providerId)} %`:''}</td><td><span class="badge">${e.source==='api'?'API':'Manuel'}</span></td></tr>`).join('')}</tbody></table></div><p class="settings-foot">${entries.length} relevés · ${entries.length>200?'Les 200 plus récents sont affichés. ':''}Jusqu’à 5 000 relevés conservés. Une variation de solde peut inclure une recharge ; elle ne représente pas nécessairement une dépense.</p>`:`<div class="empty-state"><div class="empty-icon">${icon('chart',28)}</div><h2>${state.history.length?'Aucun relevé sur cette sélection':'Ton historique commence ici.'}</h2><p>Connecte un de tes comptes API, ou ajoute ton premier relevé manuel. Tu retrouveras ici l’évolution de tes soldes et quotas.</p><button class="primary" data-nav="connections">${icon('plug',15)} Voir les connexions</button></div>`}`;
}
function mobileSettings() {
  const m=mobileInfo;
  return `<section class="settings-panel mobile-settings" style="margin-top:20px"><div class="section-heading"><h2>Accès mobile</h2><span class="badge ${m?.enabled?'live':''}">${m?.enabled?'Activé':'Désactivé'}</span></div><p class="hint">Retrouve tes comptes sur ton iPhone, chez toi ou à l’extérieur. Le PC reste allumé, ProvidersBar ouvert et Tailscale connecté sur les deux appareils.</p><ol class="hint"><li>Installe Tailscale sur ce PC et ton iPhone, puis connecte-les au même compte.</li><li>Dans PowerShell administrateur, lance : <code>&amp; "$env:ProgramFiles\\Tailscale\\tailscale.exe" serve --bg --https=443 http://127.0.0.1:4318</code></li><li>Recopie l’adresse HTTPS affichée ci-dessous et active l’accès. Sur l’iPhone, ouvre cette adresse dans Safari et saisis le code.</li></ol><form id="mobile-form"><div class="field"><label for="mobile-origin">Adresse privée Tailscale</label><input id="mobile-origin" name="origin" type="url" placeholder="https://mon-pc.mon-reseau.ts.net" value="${escapeHtml(m?.origin||'')}"><small>Laisse vide pour tester uniquement sur ce PC.</small></div><label class="check-row"><input name="enabled" type="checkbox" ${m?.enabled?'checked':''}>Activer le tableau de bord mobile</label><div class="form-error" role="alert">${escapeHtml(m?.error||'')}</div><button type="submit" class="primary">Enregistrer l’accès mobile</button></form>${m?.enabled?`<div class="source-note"><strong>Code d’accès personnel</strong><p class="mobile-code">${escapeHtml(m.code)}</p><p class="hint">Ce code donne accès aux relevés. Il se saisit une seule fois sur le téléphone. Safari → Partager → Sur l’écran d’accueil pour installer la vue mobile.</p></div><div class="form-actions"><button class="secondary" data-action="mobile-preview">Tester sur ce PC</button><button class="secondary" data-action="mobile-rotate">Renouveler le code et révoquer les accès</button></div>`:''}<p class="hint">Les connexions et les clés restent sur le PC. Le mobile consulte les relevés et peut demander leur actualisation. Antigravity doit rester ouvert pour ses quotas.</p></section>`;
}
function settings() {
  return `${heading('À TA MAIN','Tes préférences.','Un suivi discret, sur ton appareil.')}${state.desktop?mobileSettings():''}<form id="settings-form" class="settings-panel"><label class="settings-row"><div><strong>Actualisation automatique</strong><p>Relire les soldes des comptes connectés toutes les 5 minutes.<br>L’application doit rester ouverte, même dans la zone de notification.</p></div><input name="autoRefresh" type="checkbox" ${state.settings.autoRefresh?'checked':''}></label><label class="settings-row"><div><strong>Notifications Windows</strong><p>Échéance vérifiée dans les 3 jours, quota inférieur à 20 %<br>ou solde USD inférieur au seuil choisi. Une alerte par jour et par motif.</p></div><input name="notifications" type="checkbox" ${state.settings.notifications?'checked':''}></label><label class="settings-row"><div><strong>Alerte de solde faible · USD</strong><p>Ce seuil s’applique uniquement aux soldes en dollars US.</p></div><input name="lowBalance" type="number" min="0" max="10000" step="0.01" value="${state.settings.lowBalance}"></label><button class="primary" type="submit">Enregistrer les préférences</button><p class="form-error" role="alert"></p></form><div class="settings-panel" style="margin-top:20px"><div class="section-heading"><h2>Tes données t’appartiennent</h2><span class="badge">Version 0.1.0</span></div><p class="hint">Les données et les clés chiffrées sont enregistrées localement. L’export contient ton inventaire, tes réglages et ton historique, sans les clés.</p><button class="secondary" data-action="export">${icon('download',15)} Exporter mes données</button><p class="settings-foot">Fermer la fenêtre laisse ProvidersBar accessible près de l’horloge. Pour arrêter l’application, fais un clic droit sur son icône, puis « Quitter ».</p></div>`;
}
function quickQuota(quota, label) {
  const value=quota?.remaining;
  const known=typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
  return `<span class="quick-quota" aria-label="${escapeHtml(label)} : ${known?value+' % restants':'indisponible'}"><strong>${known?value+'<small>%</small>':'—'}</strong><span class="quick-meter ${known&&value<=20?'low':''}">${known?`<i style="width:${value}%"></i>`:''}</span></span>`;
}
function quickPeriods(group) {
  return `<div class="quick-periods">${[...group.periods].sort((a,b)=>(a.label==='Semaine'?-1:1)-(b.label==='Semaine'?-1:1)).map(p=>`<div class="quick-period"><span class="quick-period-label">${p.label==='Semaine'?'Hebdo':'5 h'}</span>${quickQuota(p.quota,group.name+' · '+p.label)}</div>`).join('')}</div>`;
}
function quickAccountRow(p) {
  const s=p.snapshot;
  let groups=quotaGroups(p);
  if(p.id==='grok'&&s?.quotaWindows?.length)groups=[{name:'',periods:[{label:'Semaine',quota:s.quotaWindows.find(w=>w.label==='Semaine')}]}];
  const title=`<div class="quick-provider">${logo(p,true)}<div class="provider-title"><h3>${escapeHtml(p.name)}${p.error?' <span class="warning" title="Connexion à vérifier" aria-label="Connexion à vérifier">!</span>':''}</h3></div></div>`;
  let values;
  if(groups.length>1) values=groups.map(group=>`<div class="quick-subrow"><span class="quick-group-label">${escapeHtml(group.name)}</span>${quickPeriods(group)}</div>`).join('');
  else if(groups.length)values=quickPeriods(groups[0]);
  else values=`<span class="quick-amount">${s?.balances?.length?s.balances.map(b=>money(b.remaining,b.currency)).join(' / '):s?.quotaRemaining!==null&&s?.quotaRemaining!==undefined?quotaDisplay(s.quotaRemaining,p.id)+' %':'—'}</span>`;
  return `<button class="quick-row ${groups.length>1?'grouped':''}" data-provider="${p.id}" data-action="main">${title}${values}</button>`;
}
function renderQuick() {
  document.body.classList.add('quick-mode');
  const accounts=state.providers;
  document.getElementById('app').innerHTML=`<main class="quick"><div class="quick-head">${brand}<button class="icon-button" data-action="sync" aria-label="Synchroniser" aria-busy="${syncing}" ${syncing?'disabled':''}>${icon('refresh',17)}</button></div><div class="quick-columns"><span>${accounts.length} COMPTES · RESTANT</span></div><div class="quick-list">${accounts.length?accounts.map(quickAccountRow).join(''):'<p class="hint">Aucun compte à afficher.</p>'}</div><div class="quick-footer"><button class="text-button" data-action="main">Ouvrir le tableau de bord ${icon('arrow',13)}</button></div></main>`;
}
function inputField(label,name,value,type='text',extra='',full=false) {return `<div class="field ${full?'full':''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></div>`;}
function selectField(label,name,value,options) {return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${text}</option>`).join('')}</select></div>`;}
function openDetail(id,tab='info') { dialogId=id;dialogTab=tab;renderDialog();const d=document.getElementById('detail-dialog');if(!d.open)d.showModal(); }
function renderDialog() {
  const p=state.providers.find(p=>p.id===dialogId);
  const currencies=[['USD','USD · Dollar US'],['EUR','EUR · Euro'],['CNY','CNY · Yuan']];
  let body='';
  if(dialogTab==='info') body=`<form id="provider-form"><div class="fields">${inputField('Offre / formule','plan',p.plan,'text','maxlength="200" placeholder="Nom de ton offre"',true)}${inputField(p.type==='subscription'?'Tarif':'Budget de référence (facultatif)','amount',p.amount,'number','min="0" max="1000000000000" step="0.01" placeholder="Inconnu"')}${selectField('Devise','currency',p.currency,currencies)}${selectField('Périodicité','billingCycle',p.billingCycle,[['unknown','À préciser'],['monthly','Mensuelle'],['yearly','Annuelle'],['one-time','Paiement unique']])}${inputField('Prochaine échéance','renewalDate',p.renewalDate,'date')}${inputField('Prochain tarif (facultatif)','nextAmount',p.nextAmount,'number','min="0" step="0.01" placeholder="Aucun"')}${inputField('Date du changement de tarif','priceChangeDate',p.priceChangeDate,'date')}<div class="field full"><label for="notes">Notes</label><textarea name="notes" id="notes" maxlength="2000">${escapeHtml(p.notes)}</textarea></div></div><label class="check-row"><input type="checkbox" name="reviewed" ${p.reviewed?'checked':''}>J’ai vérifié les informations de cette fiche</label><label class="check-row"><input type="checkbox" name="active" ${p.active?'checked':''}>Inclure ce service dans le suivi actif</label><div class="form-error" role="alert"></div><div class="form-actions"><button class="secondary" type="button" data-action="close-dialog">Annuler</button><button class="primary" type="submit">Enregistrer</button></div></form>`;
  if(dialogTab==='manual') {
    const s=p.snapshot, b=s?.balances.find(b=>b.currency===p.currency);
    let localReset='';if(s?.resetAt){const dt=new Date(s.resetAt);localReset=new Date(dt-dt.getTimezoneOffset()*60000).toISOString().slice(0,16);}
    body=p.connected?`<div class="connection-success">Ce compte est synchronisé automatiquement.</div><p class="hint">Pour saisir un solde manuel, déconnecte d’abord le compte dans l’onglet Connexion. Le dernier relevé restera dans l’historique.</p>`:`<form id="manual-form"><p class="hint">Saisis une valeur lue sur ton compte. Ce relevé sera daté et identifié comme manuel. Un champ vide reste inconnu.</p><div class="fields">${inputField('Solde restant','balance',b?.remaining??null,'number','step="0.01" placeholder="Inconnu"')}${selectField('Devise du solde','currency',p.currency,currencies)}${inputField('Quota restant (%)','quotaRemaining',s?.quotaRemaining,'number','min="0" max="100" step="0.1" placeholder="Inconnu"')}${inputField('Prochain reset (heure locale)','resetAt',localReset,'datetime-local')}</div><div class="form-error" role="alert"></div><div class="form-actions"><button class="primary" type="submit">Enregistrer le relevé</button></div></form>`;
  }
  if(dialogTab==='connection'&&hasConnector(p)) body=`${p.connected?'<div class="connection-success">Compte connecté · clé enregistrée et chiffrée</div>':''}<p class="connection-note">${escapeHtml(p.connector.instructions)}<br>La connexion est vérifiée avant l’enregistrement de la clé.</p>${p.snapshot?.details?.length?`<div class="source-note">${p.snapshot.details.map(d=>`${escapeHtml(d.label)} : <strong>${money(d.amount,d.currency)}</strong>`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}<form id="connection-form"><div class="field"><label for="api-key">${p.connected?'Remplacer la clé':escapeHtml(p.connector.keyLabel)}</label><input id="api-key" name="key" type="password" autocomplete="off" spellcheck="false" required maxlength="4096" placeholder="Colle ta clé ici"><small>Ta clé ne sera jamais affichée dans l’historique ou dans un export.</small></div><div class="form-error" role="alert"></div><div class="form-actions">${p.connected?'<button class="secondary" data-action="disconnect" type="button">Déconnecter</button>':''}<button class="primary" type="submit">${p.connected?'Vérifier et remplacer':'Vérifier et connecter'}</button></div></form>${p.error?`<div class="divider"></div><p class="form-error">${escapeHtml(p.error)}</p>`:''}`;
  if(dialogTab==='connection'&&p.connector?.mode==='account') {
    const prefix=(p.connector.browserAccount||p.connector.codexAccount||p.connector.localAccount)?'account':p.id==='orcarouter'?'orca':'ollama';
    const progress=p.accountConnection;
    body=`${p.connected?`<div class="connection-success">Compte connecté · session ${escapeHtml(p.name)} enregistrée sur cet appareil</div>`:''}<p class="connection-note">${escapeHtml(p.connector.instructions)}</p>${progress?.message?`<p class="${progress.status==='error'?'form-error':'connection-note'}" role="status" id="${prefix}-connection-progress">${escapeHtml(progress.message)}</p>`:''}${p.connected&&p.snapshot?.balances?.length?`<div class="source-note"><strong>${escapeHtml(p.snapshot.balanceLabel||'Solde du portefeuille')} : ${p.snapshot.balances.map(b=>money(b.remaining,b.currency)).join(' / ')}</strong>${(p.snapshot.details||[]).map(d=>`<br>${escapeHtml(d.label)} : ${money(d.amount,d.currency)}`).join('')}${p.snapshot.resetAt?`<br>Remise à zéro : ${new Date(p.snapshot.resetAt).toLocaleString('fr-FR')}`:''}<br>${age(p.snapshot.updatedAt)}</div>`:''}<p class="source-note">${p.id==='ollama'?'Les crédits mensuels sont distincts du prix de l’abonnement et des crédits supplémentaires. ':''}${p.connector.codexAccount?'La session est gérée par Codex sur ce PC.':'La session reste dans un navigateur isolé de l’application.'} Aucun mot de passe n’est lu par ProvidersBar.</p><div class="form-actions"><button class="secondary" data-action="${prefix}-open">${p.connector.codexAccount?(p.connected?'Actualiser via Codex':'Connecter avec Codex'):p.connected?'Ouvrir mon compte':`Se connecter sur ${escapeHtml(p.name)}`}</button><button class="primary" data-action="${prefix}-verify">Vérifier maintenant</button></div><p class="form-error" id="${prefix}-account-error" role="alert"></p>${p.connected?'<div class="form-actions"><button class="secondary" data-action="disconnect">Déconnecter et effacer la session</button></div>':''}${p.error?`<p class="form-error">${escapeHtml(p.error)}</p>`:''}`;
  }
  if(dialogTab==='connection'&&p.connector?.localAccount) body=`<p class="connection-note">${escapeHtml(p.connector.instructions)}</p>${p.accountConnection?.message?`<p class="connection-note" role="status">${escapeHtml(p.accountConnection.message)}</p>`:''}<div class="source-note">Ces quotas concernent Antigravity. Gemini web est suivi séparément. Le pourcentage principal correspond à la limite la plus basse.<br>Antigravity 2.0 doit rester ouvert pour l’actualisation automatique.</div>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}</div>`:''}<div class="form-actions"><button class="primary" data-action="account-open">${p.connected?'Actualiser Antigravity':'Connecter Antigravity'}</button><button class="secondary" data-action="account-verify">Vérifier maintenant</button></div><p class="form-error" id="account-account-error" role="alert"></p>${p.connected?'<div class="form-actions"><button class="secondary" data-action="disconnect">Arrêter le suivi Antigravity</button></div>':''}`;
  if(dialogTab==='connection'&&p.connector?.codexAccount) body += `<p class="hint">Les limites proviennent du compte ChatGPT connecté à Codex sur ce PC. Déconnecter ici arrête seulement le suivi dans ProvidersBar.</p>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}`;
  if(dialogTab==='connection'&&p.connector?.browserAccount) body += `<p class="hint">Connecte-toi dans la fenêtre Chrome ou Edge, puis ferme-la : la vérification démarrera automatiquement. La session reste dans un profil dédié à ce fournisseur. Les mots de passe et conversations ne sont pas lus. Si le quota n’est pas accessible, le dernier relevé est conservé.</p>${p.snapshot?.quotaWindows?.length?`<div class="source-note">${p.snapshot.quotaWindows.map(w=>`<strong>${escapeHtml(w.label)} : ${w.remaining} % restants</strong>${w.resetAt?`<br>Remise à zéro : ${new Date(w.resetAt).toLocaleString('fr-FR')}`:''}`).join('<br>')}<br>${age(p.snapshot.updatedAt)}</div>`:''}`;
  if(dialogTab==='connection'&&p.id==='ollama') body += '<p class="hint">La connexion Google s’ouvre dans Chrome ou Edge avec un profil temporaire dédié. Seule la session Ollama est conservée dans ProvidersBar.</p><button class="secondary" data-action="ollama-email">Alternative : connexion par email intégrée</button>';
  document.getElementById('detail-dialog').innerHTML=`<div class="dialog-head">${logo(p)}<div><h2 id="detail-title">${escapeHtml(p.name)}</h2><p>${p.type==='subscription'?'Abonnement':'Accès API'} · ${p.reviewed?'Fiche vérifiée':'Fiche à vérifier'}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Fermer la fiche">${icon('close',19)}</button></div><nav class="dialog-tabs" aria-label="Sections de la fiche">${[['info','Informations'],['manual','Relevé manuel'],...(hasConnector(p)?[['connection','Connexion']]:[])].map(([id,text])=>`<button class="${dialogTab===id?'active':''}" data-dialog-tab="${id}">${text}</button>`).join('')}</nav><div class="dialog-body">${body}</div>`;
}
async function runAction(action, button) {
  if(!state.desktop&&!['close-dialog','main'].includes(action)) {toast('Cette action est disponible dans l’application Windows.');return;}
  if(action==='mobile-preview'){await api.previewMobile();return;}
  if(action==='mobile-rotate'){mobileInfo=await api.updateMobile({enabled:true,origin:mobileInfo.origin,rotate:true});render();toast('Ancien code révoqué. Associe le téléphone avec le nouveau code.');return;}
  if(action==='close-dialog'){document.getElementById('detail-dialog').close();dialogId=null;return;}
  if(action==='main'){api.showMain();return;}
  if(['account-open','account-verify'].includes(action)) {
    const id=dialogId; button.disabled=true;
    try {
      if(action==='account-open'){await api.openAccount(id);toast(id==='antigravity'?'Quotas Antigravity actualisés.':id==='openai'?'Connexion OpenAI en cours via Codex.':'Connecte-toi sur le site officiel, puis ferme cette fenêtre Chrome ou Edge.');}
      else {state=await api.verifyAccount(id);render();if(dialogId)renderDialog();toast(state.providers.find(p=>p.id===id).error||'Compte connecté. Quotas mis à jour.');}
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
    if(!state.providers.some(p=>p.connected&&p.active)){toast('Connecte un compte dans Connexions pour synchroniser les soldes.');if(!quick){page='connections';render();}return;}
    syncing=true;render();
    try{state=await api.syncAll();const errors=state.providers.filter(p=>p.connected&&p.active&&p.error);toast(errors.length?`${errors.length} connexion(s) à vérifier. Les derniers relevés ont été conservés.`:'Les soldes sont à jour.');}finally{syncing=false;render();}
  }
  if(action==='disconnect'){button.disabled=true;state=await api.disconnect(dialogId);render();renderDialog();toast('Compte déconnecté. Historique conservé.');}
  if(action==='export'){if(await api.exportData())toast('Données exportées, sans les clés.');}
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
    if(button.dataset.nav==='settings'&&api.mobileInfo)mobileInfo=await api.mobileInfo();
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
    if(form.id==='mobile-form'){mobileInfo=await api.updateMobile({enabled:data.has('enabled'),origin:get('origin').trim(),rotate:false});toast('Accès mobile mis à jour.');}
    if(form.id==='provider-form'){state=await api.updateProvider(dialogId,{plan:get('plan'),amount:num('amount'),currency:get('currency'),billingCycle:get('billingCycle'),renewalDate:get('renewalDate')||null,nextAmount:num('nextAmount'),priceChangeDate:get('priceChangeDate')||null,notes:get('notes'),reviewed:data.has('reviewed'),active:data.has('active')});document.getElementById('detail-dialog').close();dialogId=null;toast('Fiche enregistrée.');}
    if(form.id==='manual-form'){state=await api.saveManual(dialogId,{balance:num('balance'),currency:get('currency'),quotaRemaining:num('quotaRemaining'),resetAt:get('resetAt')?new Date(get('resetAt')).toISOString():null});document.getElementById('detail-dialog').close();dialogId=null;toast('Relevé ajouté à l’historique.');}
    if(form.id==='connection-form'){state=await api.connect(dialogId,get('key'));form.reset();renderDialog();toast('Compte connecté. Le solde a été récupéré.');}
    if(form.id==='settings-form'){state=await api.updateSettings({autoRefresh:data.has('autoRefresh'),notifications:data.has('notifications'),lowBalance:num('lowBalance')});toast('Préférences enregistrées.');}
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
  state=data;
  if(page!=='settings'&&!document.querySelector('#search:focus'))render();
  if(changedAccounts.some(p=>p.id===dialogId)&&dialogTab==='connection')renderDialog();
  for(const p of justConnected)toast(p.error||`${p.name} connecté. Les usages sont à jour.`);
}
async function start(){try{state=await api.getState();render();api.onChange(receiveState);setInterval(()=>{if(!dialogId&&page!=='settings'&&!document.querySelector('input:focus,textarea:focus,select:focus'))render();},60000);}catch(error){document.getElementById('app').innerHTML=`<div class="loading">${escapeHtml(error.message)}</div>`;}}
start();
