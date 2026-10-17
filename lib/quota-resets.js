/* Dates are independent from usage readings and billing renewal dates. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuotaResets = factory();
})(globalThis, function () {
  'use strict';
  const canonical = label => label === 'Période en cours' ? '5 heures' : label;
  function slots(p) {
    if (p.type !== 'subscription') return [];
    const labels = {
      openai: ['Codex et Work · Semaine'], claude: ['Semaine', '5 heures'], zai: ['Semaine', '5 heures'],
      antigravity: ['Gemini · Semaine', 'Gemini · 5 heures', 'Claude et GPT · Semaine', 'Claude et GPT · 5 heures', 'Gemini 4 Argon · Semaine'],
      grok: ['Semaine'], ollama: ['Mois'],
    };
    const keys = [...(labels[p.id] || [])];
    for (const w of p.snapshot?.quotaWindows || []) {
      if (p.id === 'openai' && !w.label.startsWith('Codex et Work · ')) continue;
      const key = canonical(w.label);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys.map(key => {
      const parts = key.split(' · '), period = parts.pop(), group = parts.join(' · ');
      return { key, group, period };
    });
  }
  function dateValid(date) {
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  }
  function validate(p, input) {
    if (p.type !== 'subscription' || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Dates de réinitialisation invalides.');
    const allowed = slots(p).map(s => s.key), result = {};
    for (const [key, value] of Object.entries(input)) {
      if (!allowed.includes(key)) throw new Error('Limite inconnue.');
      if (value === null) continue;
      if (!value || typeof value !== 'object' || !dateValid(value.date) || (value.time != null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))) throw new Error('Date ou heure invalide.');
      const time = value.time || null;
      const local = time ? new Date(`${value.date}T${time}:00`) : null;
      if (local && (!Number.isFinite(+local) || local.getHours() !== Number(time.slice(0, 2)) || local.getMinutes() !== Number(time.slice(3)))) throw new Error('Cette heure locale n’existe pas à cette date.');
      result[key] = { date: value.date, time, at: local ? local.toISOString() : null };
    }
    return result;
  }
  function resolve(p, key, now = Date.now()) {
    const s = p.snapshot, all = slots(p), w = s?.quotaWindows?.find(w => canonical(w.label) === key);
    let at = w?.resetAt;
    // A scalar reset only identifies the limit if the provider has one slot.
    if (!at && !s?.quotaWindows?.length && all.length === 1) at = s?.resetAt;
    if (typeof at === 'string' && Number.isFinite(Date.parse(at))) {
      return { value: at, precise: true, source: s.source === 'manual' ? 'manual' : 'provider', stale: !!p.error || (!p.connected && s.source !== 'manual') || !Number.isFinite(Date.parse(s.updatedAt)) || now - Date.parse(s.updatedAt) > 600000 };
    }
    const manual = p.manualResets?.[key];
    if (manual && dateValid(manual.date)) {
      if (manual.at && Number.isFinite(Date.parse(manual.at))) return { value: manual.at, precise: true, source: 'manual', stale: false };
      return { value: manual.date, precise: false, source: 'manual', stale: false };
    }
    return null;
  }
  function expiry(date) {
    if (date.precise) return Date.parse(date.value);
    // An unknown time stays unknown all day; expire only once the local day ends.
    const d = new Date(date.value + 'T00:00:00'); d.setDate(d.getDate() + 1); return +d;
  }
  function forStrategy(p) {
    if (!p.manualResets || !p.snapshot) return p;
    const snapshot = { ...p.snapshot };
    if (snapshot.quotaWindows?.length) snapshot.quotaWindows = snapshot.quotaWindows.map(w => {
      if (w.resetAt) return w;
      const date = resolve(p, canonical(w.label));
      return date ? { ...w, resetAt: new Date(expiry(date)).toISOString() } : w;
    });
    else if (!snapshot.resetAt && slots(p).length === 1) {
      const date = resolve(p, slots(p)[0].key);
      if (date) snapshot.resetAt = new Date(expiry(date)).toISOString();
    }
    return { ...p, snapshot };
  }
  return { slots, validate, resolve, expiry, forStrategy, canonical };
});
