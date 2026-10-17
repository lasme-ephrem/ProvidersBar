function resetMarkup(p, key, compact = false) {
  const date = QuotaResets.resolve(p, key);
  if (!date) return `<span class="reset-date ${compact ? 'compact' : ''}">↻ Date non fournie</span>`;
  const value = new Date(date.precise ? date.value : date.value + 'T00:00:00');
  const display = value.toLocaleDateString('fr-FR', { day: 'numeric', month: compact ? '2-digit' : 'short', ...(value.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  const time = date.precise ? ' à ' + value.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  const past = QuotaResets.expiry(date) <= Date.now();
  const origin = date.source === 'manual' ? ' · manuel' : date.stale ? compact ? ' · ancien' : ' · dernier relevé' : '';
  const countdown = date.precise ? resetLabel(date.value).replace(/^Reset dans /, 'dans ').replace(/^Reset passé · nouveau relevé nécessaire$/, 'date passée · à vérifier') : past ? 'date passée · à vérifier' : 'heure non précisée';
  return `<span class="reset-date ${compact ? 'compact' : ''} ${past ? 'warning' : ''}" title="${escapeHtml(key + ' : réinitialisation le ' + display + time + origin + ' · ' + countdown)}"><span>↻ ${compact ? '' : 'Le '}${escapeHtml(display + time + origin)}</span>${compact ? past ? '<small>Date passée</small>' : '' : `<small>${escapeHtml(countdown)}</small>`}</span>`;
}
function resetForm(p) {
  return `<form id="resets-form"><p class="hint">Dates de réinitialisation des quotas, indépendantes de la facturation. Les dates fournies par le service ont priorité. Tu peux compléter celles qui manquent sans déconnecter le compte. L’heure locale est facultative ; vider la date efface la saisie manuelle.</p>${QuotaResets.slots(p).map((slot, index) => {
    const manual = p.manualResets?.[slot.key];
    return `<section class="reset-field"><h3>${escapeHtml(slot.key)}</h3>${resetMarkup(p, slot.key)}<div class="fields">${inputField('Date manuelle', 'reset-date-' + index, manual?.date || '', 'date')}${inputField('Heure locale (facultative)', 'reset-time-' + index, manual?.time || '', 'time')}</div></section>`;
  }).join('')}<p class="form-error" role="alert"></p><div class="form-actions"><button class="primary" type="submit">Enregistrer les dates</button></div></form>`;
}
