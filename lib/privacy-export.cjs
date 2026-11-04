// Export de données nettoyé : l'export est destiné à l'utilisateur et peut être
// partagé. Il ne doit contenir aucune identité de compte, aucun état de session
// et aucun marqueur de renouvellement de jeton.
const FORBIDDEN_KEYS = new Set([
  'accountSession', // état de session (kind, identité hachée, identifiants numériques)
  'claudeSync',     // échéance/erreurs de renouvellement du jeton Claude Code
  'apiCooldowns',   // empreintes de clés API
  'identity',
  'email',
  'emailHash',
  'userId',
  'workspaceId',
]);

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    result[key] = scrub(entry);
  }
  return result;
}

// Renvoie un document autonome : { app, version, exportedAt, inventory,
// settings, manualResets, history }. L'état source n'est pas modifié.
function sanitizeStateForExport(state, { app = 'ProvidersBar', version = null, exportedAt = new Date().toISOString() } = {}) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.providers)) throw new Error('État exportable invalide.');
  const clean = scrub(state);
  const manualResets = {};
  const inventory = clean.providers.map(provider => {
    const { manualResets: resets, ...rest } = provider;
    if (resets && typeof resets === 'object' && !Array.isArray(resets) && Object.keys(resets).length) manualResets[provider.id] = resets;
    return rest;
  });
  return {
    app,
    version,
    exportedAt,
    inventory,
    settings: clean.settings ?? null,
    manualResets,
    history: Array.isArray(clean.history) ? clean.history : [],
  };
}

module.exports = { FORBIDDEN_KEYS, sanitizeStateForExport };
