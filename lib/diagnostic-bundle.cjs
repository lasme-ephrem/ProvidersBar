'use strict';

// Bundle de diagnostic local : versions, santé, packs, erreurs et réglages
// utiles. Aucune clé, aucun solde, aucun jeton, aucun chemin absolu.

const pathDefault = require('node:path');

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function buildDiagnosticBundle({
  app = {},
  state,
  packs = [],
  packErrors = [],
  backups = [],
  now = new Date(),
  platform = process.platform,
  versions = {},
  path = pathDefault,
} = {}) {
  const providers = Array.isArray(state?.providers) ? state.providers : [];
  return {
    format: 'lasmium-diagnostic',
    formatVersion: 1,
    generatedAt: new Date(now).toISOString(),
    application: {
      name: app.name || 'Lasmium TOKENS-HUB',
      version: app.version || null,
      electron: app.electron || versions.electron || null,
      node: versions.node || null,
      packaged: safeBoolean(app.packaged),
      platform,
    },
    settings: {
      autoRefresh: safeBoolean(state?.settings?.autoRefresh),
      notifications: safeBoolean(state?.settings?.notifications),
      lowBalance: Number.isFinite(state?.settings?.lowBalance) ? state.settings.lowBalance : null,
      theme: typeof state?.settings?.theme === 'string' ? state.settings.theme : null,
    },
    inventory: {
      providers: providers.length,
      connected: providers.filter(provider => provider.connected).length,
      active: providers.filter(provider => provider.active !== false).length,
      historyCount: Array.isArray(state?.history) ? state.history.length : 0,
    },
    providers: providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      connected: safeBoolean(provider.connected),
      active: provider.active !== false,
      subscriptionStatus: provider.subscriptionStatus || null,
      lastAttempt: provider.lastAttempt || null,
      error: provider.error ? String(provider.error).slice(0, 240) : null,
      health: provider.health ? {
        state: provider.health.state,
        strategy: provider.health.strategy,
        stale: provider.health.stale,
        lastSuccessAt: provider.health.lastSuccessAt,
        lastFailureAt: provider.health.lastFailureAt,
        failures: provider.health.failures,
        parserVersion: provider.health.parserVersion,
        error: provider.health.error ? {
          code: provider.health.error.code,
          message: provider.health.error.message,
          retryAt: provider.health.error.retryAt,
        } : null,
      } : null,
    })),
    connectorPacks: Array.isArray(packs) ? packs.map(pack => ({
      provider: pack.provider,
      version: pack.version,
      parserVersion: pack.parserVersion || null,
      endpointHost: (() => {
        try { return new URL(pack.endpoint).host; } catch { return null; }
      })(),
    })) : [],
    connectorPackErrors: Array.isArray(packErrors) ? packErrors.map(error => ({
      file: path.basename(String(error.file || '')),
      provider: error.provider || null,
      reason: String(error.reason || '').slice(0, 240),
    })) : [],
    backups: Array.isArray(backups) ? backups.slice(0, 10) : [],
  };
}

module.exports = { buildDiagnosticBundle };
