/* Pure, shared recommendation engine. No network, credentials or inference calls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UsageStrategy = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const resetDates = typeof module === 'object' && module.exports ? require('./quota-resets.js') : globalThis.QuotaResets;
  const checkedAt = '2026-09-12';
  const models = {
    astra: { name: 'GPT-6 Astra', quality: 53 }, sol: { name: 'GPT-5.6 Sol', quality: 47 },
    opus55: { name: 'Claude Opus 5.5', quality: 54 },
    glm: { name: 'GLM-5.3', quality: 45 }, kimi: { name: 'Kimi K3', quality: 44 },
    grok: { name: 'Grok 4.6', quality: 44 }, glmFlash: { name: 'GLM-5.3 Flash', quality: 42 },
    geminiFlash: { name: 'Gemini 3.8 Flash', quality: 41 }, argon: { name: 'Gemini 4 Argon', quality: null }, deepseekFlash: { name: 'DeepSeek V4.1 Flash', quality: 40 },
    qwenFlash: { name: 'Qwen3.8 Flash', quality: null }, luna: { name: 'GPT-5.6 Luna', quality: 38 },
    muse: { name: 'Muse Spark 1.3', quality: 48 }, contributor: { name: 'Muse Spark 1.3 Contributor', quality: null },
    opus: { name: 'Claude Opus 4.6 Thinking', quality: 32 }, minimax: { name: 'MiniMax M3', quality: 30 },
    step: { name: 'Step3.7 Flash', quality: 19 }, unknown: { name: 'Modèle à préciser', quality: null },
  };
  const buckets = [
    { id: 'openai', providerId: 'openai', label: 'Codex et Work', model: 'astra', choices: ['astra', 'sol', 'luna'], prefix: 'Codex et Work · ' },
    { id: 'claude', providerId: 'claude', label: 'Claude Pro', model: 'opus55', choices: ['opus55'], required: ['5 heures', 'Semaine'] },
    { id: 'zai', providerId: 'zai', label: 'Plan Z.ai', model: 'glm', choices: ['glm', 'glmFlash'], required: ['5 heures', 'Semaine'] },
    { id: 'ollama', providerId: 'ollama', label: 'Crédits mensuels inclus', model: 'glm', choices: ['glm', 'kimi', 'glmFlash', 'deepseekFlash', 'minimax'], wallet: true },
    { id: 'grok', providerId: 'grok', label: 'Grok', model: 'grok', choices: ['grok'], prefix: 'Semaine', required: ['Semaine'] },
    { id: 'grok-bot', providerId: 'grok', label: 'Grok Bot', model: 'grok', choices: ['grok'], prefix: 'Grok Bot · ', required: ['Grok Bot · Semaine'], observedOnly: true },
    { id: 'antigravity-gemini', providerId: 'antigravity', label: 'Antigravity · Gemini', model: 'geminiFlash', choices: ['geminiFlash'], prefix: 'Gemini · ', required: ['Gemini · 5 heures', 'Gemini · Semaine'] },
    { id: 'antigravity-claude', providerId: 'antigravity', label: 'Antigravity · Claude/GPT', model: 'opus', choices: ['opus'], prefix: 'Claude et GPT · ', required: ['Claude et GPT · 5 heures', 'Claude et GPT · Semaine'] },
    { id: 'antigravity-argon', providerId: 'antigravity', label: 'Antigravity · Argon', model: 'argon', choices: ['argon'], prefix: 'Gemini 4 Argon · ', required: ['Gemini 4 Argon · Semaine'] },
  ];
  // Prices per 1M tokens. Cache writes and tools are outside this text-only estimate.
  const routes = [];
  function route(providerId, model, input, output, cache, extra = {}) {
    routes.push({ id: `${providerId}:${model}`, providerId, model, input, output, cache, ...extra });
  }
  route('orcarouter', 'glmFlash', .075, .25, .017);
  route('runinfra', 'glmFlash', .10, .40, .01);
  route('openrouter', 'glmFlash', .15, .50, .03);
  for (const p of ['orcarouter', 'openrouter']) {
    route(p, 'qwenFlash', .15, .47, p === 'orcarouter' ? .018 : .016);
    route(p, 'deepseekFlash', .15, .60, .003, { peak: true });
    route(p, 'luna', .20, 1.20, .02, { longContext: true });
    route(p, 'geminiFlash', .75, 3.75, .075, { promotional: true });
  }
  route('deepseek', 'deepseekFlash', .15, .60, .003, { peak: true });
  route('openrouter', 'muse', 1.25, 4.25, .15);
  route('openrouter', 'contributor', .10, .20, .002, { consent: true });
  route('openrouter', 'minimax', .30, 1.20, .06, { optional: true });
  route('openrouter', 'step', .20, 1.15, .04, { optional: true });

  function defaults() {
    return { enabled: true, contributor: false, inputTokens: 10000, outputTokens: 2000, cachePercent: 0,
      subscriptionModels: Object.fromEntries(buckets.map(b => [b.id, b.model])),
      disabledRoutes: routes.filter(r => r.optional).map(r => r.id) };
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Stratégie invalide.');
    const allowed = Object.keys(defaults());
    if (Object.keys(input).some(k => !allowed.includes(k))) throw new Error('Réglage de stratégie inconnu.');
    const result = defaults();
    for (const key of ['enabled', 'contributor']) if (key in input) {
      if (typeof input[key] !== 'boolean') throw new Error('Option invalide.');
      result[key] = input[key];
    }
    for (const [key, min, max] of [['inputTokens', 1, 1000000], ['outputTokens', 1, 1000000], ['cachePercent', 0, 100]]) if (key in input) {
      if (!Number.isFinite(input[key]) || input[key] < min || input[key] > max) throw new Error('Profil de coût invalide.');
      result[key] = input[key];
    }
    if ('subscriptionModels' in input) {
      if (!input.subscriptionModels || typeof input.subscriptionModels !== 'object' || Array.isArray(input.subscriptionModels)) throw new Error('Modèles invalides.');
      for (const [id, model] of Object.entries(input.subscriptionModels)) {
        const bucket = buckets.find(b => b.id === id);
        if (!bucket || ![...bucket.choices, 'unknown', 'off'].includes(model)) throw new Error('Modèle non reconnu pour ce quota.');
        result.subscriptionModels[id] = model;
      }
    }
    if ('disabledRoutes' in input) {
      if (!Array.isArray(input.disabledRoutes) || input.disabledRoutes.some(id => !routes.some(r => r.id === id))) throw new Error('Route API invalide.');
      result.disabledRoutes = [...new Set(input.disabledRoutes)];
    }
    return result;
  }
  function settings(input) { try { return validate(input || {}); } catch { return defaults(); } }
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const percent = n => finite(n) && n >= 0 && n <= 100;
  function baseAvailability(p, now) {
    if (p?.subscriptionStatus === 'expired') return { status: 'disabled', reason: p.statusMessage || 'Abonnement expiré' };
    if (p?.subscriptionStatus === 'paused') return { status: 'disabled', reason: 'Service en pause' };
    if (!p || !p.active) return { status: 'disabled', reason: 'Service en pause' };
    if (p.error) return { status: 'unknown', reason: 'Connexion à vérifier' };
    const s = p.snapshot;
    if (!s) return { status: 'unknown', reason: 'Aucun relevé disponible' };
    if (s.source !== 'manual' && !p.connected) return { status: 'unknown', reason: 'Compte déconnecté' };
    const age = now - Date.parse(s.updatedAt);
    if (!Number.isFinite(age) || age < -60000 || age > 600000) return { status: 'unknown', reason: 'Relevé ancien · synchroniser' };
    return null;
  }
  function quotaAvailability(p, bucket, now) {
    const unavailable = baseAvailability(p, now);
    if (unavailable) return unavailable;
    const s = p.snapshot;
    if (bucket.wallet) {
      if (s.connectorVersion !== 'ollama-monthly-credits-v1') return { status: 'unknown', reason: 'Crédits inclus non identifiés' };
      if (s.resetAt && Date.parse(s.resetAt) <= now) return { status: 'unknown', reason: 'Renouvellement passé · synchroniser' };
      const balance = s.balances?.find(b => b.currency === 'USD')?.remaining;
      if (!finite(balance)) return { status: 'unknown', reason: 'Crédits inclus inconnus' };
      return { status: balance > 0 ? 'ready' : 'blocked', reason: balance > 0 ? 'Crédits mensuels inclus disponibles' : 'Crédits mensuels inclus épuisés', resetAt: s.resetAt || null };
    }
    let windows = (s.quotaWindows || []).filter(w => !bucket.prefix || w.label.startsWith(bucket.prefix));
    // A separate Fable/Sonnet allowance cannot block the selected Opus model.
    if (bucket.id === 'claude') windows = windows.filter(w => !w.label.includes(' · ') || w.label === 'Opus · Semaine');
    // A manual aggregate can identify one quota, never both Antigravity groups.
    if (!windows.length && !bucket.id.startsWith('antigravity-') && (!s.quotaWindows?.length || s.source === 'manual')) {
      windows = [{ label: 'Quota déclaré', remaining: s.quotaRemaining, resetAt: s.resetAt }];
      if (s.source !== 'manual' && bucket.required) return { status: 'unknown', reason: 'Fenêtres de quota manquantes' };
    }
    if (windows.some(w => w.resetAt && (!Number.isFinite(Date.parse(w.resetAt)) || Date.parse(w.resetAt) <= now))) return { status: 'unknown', reason: 'Renouvellement passé · synchroniser' };
    const zero = windows.find(w => percent(w.remaining) && w.remaining === 0);
    if (zero) return { status: 'blocked', reason: `${zero.label} épuisé`, resetAt: zero.resetAt || null };
    const manual = s.source === 'manual' && windows.length === 1 && windows[0].label === 'Quota déclaré';
    if (!windows.length || windows.some(w => !percent(w.remaining)) || (!manual && bucket.required?.some(label => !windows.some(w => w.label === label))) || (!manual && bucket.current && !windows.some(w => ['5 heures', 'Période en cours'].includes(w.label)))) return { status: 'unknown', reason: 'Quota incomplet · vérifier les limites' };
    const resets = windows.map(w => Date.parse(w.resetAt)).filter(t => Number.isFinite(t) && t > now);
    return { status: 'ready', remaining: Math.min(...windows.map(w => w.remaining)), resetAt: resets.length ? new Date(Math.min(...resets)).toISOString() : null,
      reason: `${Math.min(...windows.map(w => w.remaining))} % au minimum sur les limites relevées${manual ? ' · saisie manuelle' : ''}` };
  }
  function estimate(route, config, now) {
    const date = new Date(now), hour = date.getUTCHours(), day = date.getUTCDay();
    const peak = route.peak && day > 0 && day < 6 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
    const promoEnded = route.promotional && now >= Date.parse('2027-01-01T00:00:00Z');
    const long = route.longContext && config.inputTokens > 272000;
    const inputMultiplier = peak || promoEnded || long ? 2 : 1;
    const outputMultiplier = peak || promoEnded ? 2 : long ? 1.5 : 1;
    const cached = config.cachePercent / 100;
    const cost = (config.inputTokens * ((1 - cached) * route.input + cached * route.cache) * inputMultiplier + config.outputTokens * route.output * outputMultiplier) / 1e6;
    return { cost, input: route.input * inputMultiplier, output: route.output * outputMultiplier, cache: route.cache * inputMultiplier,
      priceNote: peak ? 'Heures pleines' : route.peak ? 'Heures creuses' : long ? 'Contexte long' : promoEnded ? 'Promotion terminée' : '' };
  }
  function recommend(providers, input, now = Date.now()) {
    providers = providers.map(p => resetDates.forStrategy(p));
    const config = settings(input);
    const subscriptions = buckets.filter(bucket => {
      const p = providers.find(p => p.id === bucket.providerId);
      return p?.active && !['expired', 'paused'].includes(p.subscriptionStatus) && (!bucket.observedOnly || p.snapshot?.quotaWindows?.some(w => w.label.startsWith(bucket.prefix)));
    }).map(bucket => {
      const p = providers.find(p => p.id === bucket.providerId), model = config.subscriptionModels[bucket.id];
      let availability = quotaAvailability(p, bucket, now);
      if (model === 'off') availability = { status: 'disabled', reason: 'Exclu de la stratégie' };
      else if (model === 'unknown' && availability.status === 'ready') availability = { status: 'unknown', reason: 'Choisir le modèle accessible dans ce compte' };
      return { ...bucket, model, modelName: models[model]?.name || 'Exclu', providerName: p?.name || bucket.providerId,
        kind: 'subscription', labelOrKind: bucket.label, quality: models[model]?.quality, ...availability };
    });
    const api = routes.map(route => {
      const p = providers.find(p => p.id === route.providerId), price = estimate(route, config, now);
      let availability = baseAvailability(p, now);
      if (!availability) {
        const balance = p.snapshot.balances?.find(b => b.currency === 'USD')?.remaining;
        availability = !finite(balance) ? { status: 'unknown', reason: 'Solde USD inconnu' } : balance <= 0 ? { status: 'blocked', reason: 'Portefeuille épuisé' } : balance < price.cost ? { status: 'blocked', reason: 'Solde inférieur au coût estimé' } : { status: 'ready', reason: 'Solde disponible · coût estimé le plus bas parmi les routes retenues' };
      }
      if (config.disabledRoutes.includes(route.id) || (route.consent && !config.contributor)) availability = { status: 'disabled', reason: route.consent && !config.contributor ? 'Accord Contributor non donné' : 'Route exclue' };
      return { ...route, ...price, ...availability, kind: 'api', labelOrKind: 'API', modelName: models[route.model].name, quality: models[route.model].quality, providerName: p?.name || route.providerId };
    });
    const readySubscriptions = subscriptions.filter(x => x.status === 'ready').sort((a, b) => (b.quality ?? -1) - (a.quality ?? -1) || (Date.parse(a.resetAt) || Infinity) - (Date.parse(b.resetAt) || Infinity) || a.id.localeCompare(b.id));
    // Wallet indicators show actual remaining USD credits, independently of
    // model prices, token profiles or the selected inference routes.
    const wallets = providers.filter(p => p.type === 'api' && !baseAvailability(p, now)).map(p => ({
      providerId: p.id, providerName: p.name, kind: 'api', status: 'ready',
      balance: p.snapshot.balances?.find(b => b.currency === 'USD')?.remaining,
    })).filter(p => finite(p.balance) && p.balance > 0)
      .sort((a, b) => b.balance - a.balance || a.providerId.localeCompare(b.providerId));
    const uncertainSubscriptions = subscriptions.filter(s => s.status === 'unknown');
    const queue = readySubscriptions;
    const reviewFirst = !readySubscriptions.length && uncertainSubscriptions.length > 0;
    return { enabled: config.enabled, config, subscriptions, api, apiProviders: wallets, queue, recommended: config.enabled && !reviewFirst ? queue[0] || null : null,
      reviewFirst, checkedAt, pricesOld: now - Date.parse(checkedAt) > 30 * 86400000,
      uncertainSubscriptions, remaining: queue.slice(1), mode: !config.enabled ? 'paused' : reviewFirst ? 'verify' : queue.length ? queue[0].kind : 'empty' };
  }
  return { models, buckets, routes, defaults, settings, validate, recommend, checkedAt };
});
