/* ProvidersBar — dates de réinitialisation et formulaire associé (renderer).
 * Les dates fournisseur restent prioritaires ; les compléments manuels sont identifiés.
 */
'use strict';

function resetMarkup(provider, key, compact = false) {
  const date = QuotaResets.resolve(provider, key);
  // Une date absente n'est plus répétée sur chaque fenêtre : on n'affiche rien.
  if (!date) return '';
  const value = new Date(date.precise ? date.value : date.value + 'T00:00:00');
  const display = value.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: compact ? '2-digit' : 'short',
    ...(value.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
  const time = date.precise
    ? ' à ' + value.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : '';
  const past = QuotaResets.expiry(date) <= Date.now();
  const origin = date.source === 'manual' ? ' · manuel'
    : date.stale ? (compact ? ' · ancien' : ' · dernier relevé') : '';
  const countdown = date.precise
    ? resetLabel(date.value)
      .replace(/^Réinitialisation dans /, 'dans ')
      .replace(/^Réinitialisation passée · nouveau relevé nécessaire$/, 'date passée · à vérifier')
    : past ? 'date passée · à vérifier' : 'heure non précisée';
  const title = `${key} : réinitialisation le ${display}${time}${origin} · ${countdown}`;
  const classes = ['reset-date', past ? 'is-past' : '', compact ? 'is-compact' : ''].filter(Boolean).join(' ');
  return `<span class="${classes}" title="${escapeHtml(title)}">`
    + `<span class="reset-date-value">↻ ${compact ? '' : 'Le '}${escapeHtml(display + time + origin)}</span>`
    + `${compact
      ? (past ? '<small>Date passée</small>' : '')
      : `<small>${escapeHtml(countdown)}</small>`}</span>`;
}

function resetForm(provider) {
  const slots = QuotaResets.slots(provider).map((slot, index) => {
    const manual = provider.manualResets?.[slot.key];
    const current = resetMarkup(provider, slot.key);
    const slotLabel = typeof quotaSlotLabel === 'function' ? quotaSlotLabel(provider, slot) : slot.key;
    return `<fieldset class="reset-field"><legend>${escapeHtml(slotLabel)}</legend>`
      + `${current ? `<p class="reset-current">${current}</p>` : ''}`
      + `<div class="fields">`
      + `${inputField('Date manuelle', `reset-date-${index}`, manual?.date || '', 'date')}`
      + `${inputField('Heure locale (facultative)', `reset-time-${index}`, manual?.time || '', 'time')}`
      + `</div></fieldset>`;
  }).join('');
  return '<form id="resets-form">'
    + '<p class="hint">Dates de réinitialisation des quotas, indépendantes de la facturation. '
    + 'Les dates fournies par le service ont priorité. Tu peux compléter celles qui manquent sans '
    + 'déconnecter le compte. L’heure locale est facultative ; vider la date efface la saisie manuelle.</p>'
    + `${slots}<p class="form-error" role="alert"></p>`
    + '<div class="form-actions"><button type="submit" class="primary">Enregistrer les dates</button>'
    + '</div></form>';
}
