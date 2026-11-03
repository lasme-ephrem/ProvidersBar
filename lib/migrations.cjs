// Services explicitly removed by the owner; other records are preserved.
const removedProviderIds = new Set(['tokenrouter', 'opencode-zen', 'qwen', 'opencode-go', 'gemini']);

function removeUnusedProviders(state) {
  const providers = state.providers.filter(p => !removedProviderIds.has(p.id));
  const history = state.history.filter(entry => !removedProviderIds.has(entry.providerId));
  let strategy = state.strategy;
  const obsoleteStrategy = strategy?.subscriptionModels && Object.hasOwn(strategy.subscriptionModels, 'gemini');
  if (obsoleteStrategy) {
    const { gemini, ...subscriptionModels } = strategy.subscriptionModels;
    strategy = { ...strategy, subscriptionModels };
  }
  const changed = providers.length !== state.providers.length || history.length !== state.history.length || !!obsoleteStrategy;
  return { changed, state: changed ? { ...state, providers, history, ...(strategy ? { strategy } : {}) } : state };
}

function removeInvalidOrcaBalances(state) {
  const invalid = snapshot => snapshot?.source === 'api' && snapshot?.connectorVersion !== 'orca-wallet-v1';
  const history = state.history.filter(entry => entry.providerId !== 'orcarouter' || !invalid(entry));
  let changed = history.length !== state.history.length;
  const providers = state.providers.map(p => {
    if (p.id !== 'orcarouter' || !invalid(p.snapshot)) return p;
    changed = true;
    return { ...p, snapshot: null, error: 'Ancien relevé invalidé : le plafond de la clé OrcaRouter avait été confondu avec le solde du portefeuille.' };
  });
  return { changed, state: changed ? { ...state, providers, history } : state };
}

function removeImportMetadata(state) {
  const legacyNotes = new Set([
    'Offre exacte à préciser. Échéance importée à vérifier.',
    'Passage à 219,99 $ indiqué ; date du changement et périodicité à préciser.',
    'Échéance contradictoire : 28/09/2026 dans le tableau de droite, absente à gauche.',
    'Tarif, offre et échéance non renseignés.',
    'Montant importé : 10 $. Nature à préciser (recharge, budget ou solde).',
    'Montant importé : 20 $. Nature à préciser (recharge, budget ou solde).',
  ]);
  let changed = Object.hasOwn(state, 'importedFrom');
  const providers = state.providers.map(p => {
    if (!Object.hasOwn(p, 'importedCost')) return p;
    changed = true;
    const { importedCost, ...clean } = p;
    if (legacyNotes.has(clean.notes)) clean.notes = '';
    return clean;
  });
  if (!changed) return { changed: false, state };
  const { importedFrom, ...clean } = state;
  return { changed: true, state: { ...clean, providers } };
}

function addAntigravity(state) {
  let changed = false;
  const providers = state.providers.map(p => {
    if (p.id === 'gemini' && p.name === 'Gemini') { changed = true; return { ...p, name: 'Gemini web' }; }
    return p;
  });
  if (!providers.some(p => p.id === 'antigravity')) {
    const item = require('./seed.cjs').createSeed().providers.find(p => p.id === 'antigravity');
    providers.splice(providers.findIndex(p => p.id === 'gemini') + 1, 0, item);
    changed = true;
  }
  return { changed, state: changed ? { ...state, providers } : state };
}
function addClaude(state) {
  if (state.providers.some(p => p.id === 'claude')) return { changed: false, state };
  const providers = [...state.providers];
  const item = require('./seed.cjs').createSeed().providers.find(p => p.id === 'claude');
  const openaiIndex = providers.findIndex(p => p.id === 'openai');
  providers.splice(openaiIndex < 0 ? 0 : openaiIndex + 1, 0, item);
  return { changed: true, state: { ...state, providers } };
}
function normalizeProviderPresentation(state) {
  const names = { openai: 'OpenAI GPT', claude: 'Anthropic Claude', grok: 'xAI Grok', zai: 'Z.ai' };
  const order = ['openai', 'claude', 'grok', 'antigravity', 'zai', 'ollama'];
  const providers = state.providers.map(p => names[p.id] && p.name !== names[p.id] ? { ...p, name: names[p.id] } : p);
  providers.sort((a, b) => {
    const rank = id => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
    return rank(a.id) - rank(b.id);
  });
  const changed = providers.some((p, i) => p !== state.providers[i]);
  return { changed, state: changed ? { ...state, providers } : state };
}
// Thème : les anciens inventaires gardent leur choix explicite (`light` ou
// `dark`) ; `system` n'est appliqué qu'en l'absence de valeur valide.
const THEMES = Object.freeze(['light', 'dark', 'system']);
function normalizeThemeSettings(state) {
  const settings = state?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { changed: false, state };
  if (THEMES.includes(settings.theme)) return { changed: false, state };
  return { changed: true, state: { ...state, settings: { ...settings, theme: 'system' } } };
}
// Cooldowns 429 des clés API : initialisation non destructive. Les entrées
// valides sont conservées, les invalides écartées et le total plafonné aux 100
// échéances les plus récentes (contrat §3.2).
const MAX_API_COOLDOWNS = 100;
function addApiCooldowns(state) {
  const source = state?.apiCooldowns;
  const valid = Boolean(source) && typeof source === 'object' && !Array.isArray(source);
  if (!valid) return { changed: true, state: { ...state, apiCooldowns: {} } };
  const entries = Object.entries(source).filter(([key, until]) => typeof key === 'string' && key.length > 0 && Number.isFinite(until) && until > 0);
  const pristine = entries.length === Object.keys(source).length && entries.length <= MAX_API_COOLDOWNS;
  if (pristine) return { changed: false, state };
  entries.sort((a, b) => b[1] - a[1]);
  return { changed: true, state: { ...state, apiCooldowns: Object.fromEntries(entries.slice(0, MAX_API_COOLDOWNS)) } };
}
module.exports = { removeUnusedProviders, removeInvalidOrcaBalances, removeImportMetadata, addAntigravity, addClaude, normalizeProviderPresentation, normalizeThemeSettings, addApiCooldowns, THEMES, MAX_API_COOLDOWNS };
