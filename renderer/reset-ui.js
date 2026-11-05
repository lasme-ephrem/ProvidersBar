/* Lasmium TOKENS-HUB — dates de réinitialisation et formulaire associé (renderer).
 * Les dates viennent des fournisseurs ; une ancienne date manuelle reste identifiée.
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
