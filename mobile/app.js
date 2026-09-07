const app = document.querySelector('#app');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const extensions = {antigravity:'ico',deepseek:'ico',ollama:'png',openrouter:'png',orcarouter:'png'};
let data = null, offline = false, filter = 'all', loading = false, paired = false;
const storage = { get: () => { try { return JSON.parse(localStorage.getItem('pb-last-state')); } catch { return null; } }, save: value => { try { localStorage.setItem('pb-last-state', JSON.stringify(value)); } catch {} }, clear: () => { try { localStorage.removeItem('pb-last-state'); } catch {} } };
let messageTimer;
function message(text) { document.querySelector('#message').textContent = text; clearTimeout(messageTimer); messageTimer=setTimeout(()=>{document.querySelector('#message').textContent='';},7000); }
async function request(route, body) {
  const response = await fetch('/api/' + route, {method:body ? 'POST' : 'GET', credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(12000), ...(body ? {headers:{'Content-Type':'application/json','X-ProvidersBar':'mobile'},body:JSON.stringify(body)} : {})});
  const value = await response.json();
  if (!response.ok) { const error = new Error(value.error); error.status = response.status; throw error; }
  return value;
}
const brand = '<div class="brand"><img src="/assets/icon.png" alt="" width="28" height="28">ProvidersBar<span>MOBILE</span></div>';
function login() {
  app.innerHTML = `<main class="pairing">${brand}<div class="pair-icon">↔</div><p class="eyebrow">TON PC, À PORTÉE DE MAIN</p><h1>Retrouve tes comptes.</h1><p>Sur ton PC, ouvre ProvidersBar → Réglages → Accès mobile. Recopie le code d’accès ici.</p><form id="pair"><label for="code">Code d’accès du PC</label><input id="code" name="code" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required maxlength="64" placeholder="Colle ton code d’accès"><button class="primary" type="submit">Associer cet iPhone ou téléphone</button></form><p class="hint">Garde Tailscale connecté sur les deux appareils. Une fois associé, ajoute cette page à l’écran d’accueil depuis le menu Partager de Safari.</p></main>`;
}
function age(date) {
  if (!date) return 'Aucun relevé';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1 ? 'À l’instant' : minutes < 60 ? `Il y a ${minutes} min` : minutes < 1440 ? `Il y a ${Math.floor(minutes/60)} h` : `Il y a ${Math.floor(minutes/1440)} j`;
}
function meter(value, label) {
  const known = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  return `<div class="period"><span>${escapeHtml(label)}</span><div class="meter ${known && value <= 20 ? 'low' : ''}" role="meter" aria-label="${escapeHtml(label)} : quota restant" ${known ? `aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"` : 'aria-valuetext="Indisponible"'}>${known ? `<i style="width:${value}%"></i>` : ''}</div><strong>${known ? `${value}<small>%</small>` : '—'}</strong></div>`;
}
function quotaGroups(p) {
  const windows = p.snapshot?.quotaWindows || [], find = label => windows.find(w => w.label === label)?.remaining;
  if (!windows.length) return '';
  const group = (name, weekly, hourly, showHourly = true) => `<section class="group">${name ? `<h3>${escapeHtml(name)}</h3>` : ''}${meter(weekly,'Hebdo')}${showHourly ? meter(hourly,'5 h') : ''}</section>`;
  if (p.id === 'antigravity') return group('Gemini',find('Gemini · Semaine'),find('Gemini · 5 heures')) + group('Claude / GPT',find('Claude et GPT · Semaine'),find('Claude et GPT · 5 heures'));
  if (p.id === 'openai') return group('Codex et Work',find('Codex et Work · Semaine'),null,false);
  if (p.id === 'grok') return group('',find('Semaine'),null,false);
  if (['gemini','zai'].includes(p.id)) return group('',find('Semaine'),find('5 heures') ?? find('Période en cours'));
  return '';
}
function card(p) {
  const s = p.snapshot, groups = quotaGroups(p);
  const stale = s?.updatedAt && Date.now() - Date.parse(s.updatedAt) > 600000;
  const status = p.error ? 'À vérifier' : p.syncing ? 'Actualisation…' : offline ? 'Dernier relevé' : !p.connected ? 'Non connecté' : stale ? 'Relevé ancien' : s ? 'Synchronisé' : 'En attente';
  const money = s?.balances?.map(b => new Intl.NumberFormat('fr-FR',{style:'currency',currency:b.currency}).format(b.remaining)).join(' / ');
  return `<article class="card" data-provider="${escapeHtml(p.id)}"><header><span class="logo"><img src="/assets/providers/${escapeHtml(p.id)}.${extensions[p.id] || 'svg'}" alt=""></span><div><h2>${escapeHtml(p.name)}</h2><p>${p.type === 'api' ? 'Crédits API' : 'Abonnement'}${p.active ? '' : ' · En pause'}</p></div>${p.favorite ? '<span class="star" aria-label="Favori">☆</span>' : ''}</header>${groups || (money ? `<p class="metric-label">${escapeHtml(s.balanceLabel || 'Solde disponible')}</p><p class="amount">${escapeHtml(money)}</p>` : meter(s?.quotaRemaining,'Restant'))}<footer><span>${age(s?.updatedAt)}</span><span class="status ${p.error || stale ? 'warn' : ''}">${status}</span></footer>${p.error ? `<p class="error">${escapeHtml(p.error)}</p>` : ''}</article>`;
}
function render() {
  if (!data) return login();
  const providers = data.providers.filter(p => filter === 'all' || (filter === 'favorite' ? p.favorite : p.type === filter));
  app.innerHTML = `<main><header class="top">${brand}<button class="icon-button" data-action="logout" aria-label="Oublier cet appareil">↪</button></header><div class="connection ${offline ? 'offline' : ''}"><i></i>${offline ? 'PC injoignable · dernières données conservées' : 'Connecté à ton PC'}<span>${data.servedAt ? new Date(data.servedAt).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : ''}</span></div><section class="intro"><p class="eyebrow">TES OUTILS, AU MÊME ENDROIT</p><h1>Un œil sur tes usages.</h1><p>Les mêmes comptes. Où que tu sois.</p></section><div class="summary"><div><strong>${data.providers.length}</strong><span>comptes suivis</span></div><div><strong>${data.providers.filter(p=>p.connected).length}</strong><span>connectés</span></div><button class="primary" data-action="sync" ${offline || data.refreshing ? 'disabled' : ''}>${data.refreshing ? 'En cours…' : '↻ Actualiser'}</button></div><div class="filters" aria-label="Filtrer les comptes">${[['all','Tous'],['subscription','Abonnements'],['api','API'],['favorite','Favoris']].map(([id,label])=>`<button data-filter="${id}" aria-pressed="${filter===id}">${label}</button>`).join('')}</div><section class="cards">${providers.map(card).join('') || '<p>Aucun compte dans ce filtre.</p>'}</section><p class="footnote">Quotas restants · Lecture depuis ton PC<br>Les connexions se gèrent dans l’application Windows.</p></main>`;
}
async function load() {
  if (loading) return;
  loading = true;
  try { data = await request('state'); paired = true; offline = false; storage.save(data); render(); }
  catch (error) {
    if (error.status === 401) { paired = false; data = null; storage.clear(); login(); }
    else { offline = true; data ||= storage.get(); if (data?.providers) render(); else if (!paired) login(); message('PC injoignable. Vérifie Tailscale, ProvidersBar et la mise en veille du PC.'); }
  } finally { loading = false; }
}
document.addEventListener('submit', async event => {
  if (event.target.id !== 'pair') return;
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try { await request('login',{code:new FormData(event.target).get('code')}); message('Appareil associé.'); await load(); }
  catch (error) { message(error.message); } finally { button.disabled = false; }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.filter) { filter = button.dataset.filter; render(); return; }
  if (button.dataset.action === 'sync') {
    button.disabled = true;
    try { await request('sync',{}); message('Actualisation demandée au PC.'); await load(); }
    catch (error) { message(error.message); button.disabled = false; }
  }
  if (button.dataset.action === 'logout') {
    try { await request('logout',{}); } catch { message('PC injoignable : données locales effacées. Pour révoquer l’accès, renouvelle le code sur le PC.'); }
    paired = false; data = null; storage.clear(); login();
  }
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
setInterval(()=>{if(!document.hidden && (paired || data))load();},15000);
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(()=>{});
load();
