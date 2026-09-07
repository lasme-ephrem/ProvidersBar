// Services explicitly removed by the owner; other records are preserved.
const removedProviderIds = new Set(['tokenrouter', 'opencode-zen', 'qwen', 'opencode-go']);

function removeUnusedProviders(state) {
  const providers = state.providers.filter(p => !removedProviderIds.has(p.id));
  const history = state.history.filter(entry => !removedProviderIds.has(entry.providerId));
  const changed = providers.length !== state.providers.length || history.length !== state.history.length;
  return { changed, state: changed ? { ...state, providers, history } : state };
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
module.exports = { removeUnusedProviders, removeInvalidOrcaBalances, removeImportMetadata, addAntigravity };
