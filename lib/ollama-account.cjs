const OLLAMA_ORIGIN = 'https://ollama.com';
const SETTINGS_URL = OLLAMA_ORIGIN + '/settings';
function signInError() { return Object.assign(new Error('Session Ollama absente ou expirée. Ouvre le compte Ollama et reconnecte-toi.'), { code: 'OLLAMA_SIGNIN' }); }
function parseOllamaCredits(html, now = new Date()) {
  if (typeof html !== 'string') throw new Error('Réponse Ollama illisible.');
  const safe = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const start = safe.search(/Monthly usage/i);
  if (start < 0) {
    if (/signin\.ollama\.com|type=["']password["']|Sign in to Ollama/i.test(safe)) throw signInError();
    throw new Error('Crédits mensuels Ollama non reconnus. Aucun montant ne sera déduit du tarif ou d’une jauge.');
  }
  // Restrict extraction to the monthly usage section; additional credits and
  // subscription prices must not be mistaken for included usage.
  const tail = safe.slice(start, start + 6000);
  const boundary = tail.search(/Extra usage|Additional credits|Session usage|Weekly usage|Billing history/i);
  const section = boundary >= 0 ? tail.slice(0, boundary) : tail;
  const plain = section.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&#36;|&#x24;/gi, '$').replace(/\s+/g, ' ');
  const amount = '((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?)';
  const matches = [...plain.matchAll(new RegExp('\\$' + amount + '\\s+of\\s+\\$' + amount + '\\s+used', 'gi'))];
  if (matches.length !== 1) throw new Error('Montants des crédits mensuels Ollama absents ou ambigus. Aucun solde estimé ne sera affiché.');
  const used = Number(matches[0][1].replaceAll(',', '')), total = Number(matches[0][2].replaceAll(',', ''));
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used < 0) throw new Error('Crédits mensuels Ollama invalides.');
  const remaining = Math.max(0, total - used);
  const date = section.match(/data-time=["']([^"']+)["']/i)?.[1];
  let resetAt = null;
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Date de remise à zéro Ollama non reconnue.');
    resetAt = new Date(date).toISOString();
  }
  return { source: 'api', connectorVersion: 'ollama-monthly-credits-v1', updatedAt: now.toISOString(),
    balanceLabel: 'Crédits mensuels restants', balances: [{ currency: 'USD', remaining, total, used }],
    quotaRemaining: Math.round(remaining / total * 10000) / 100, resetAt,
    details: [{ label: 'Crédits inclus dans la période', amount: total, currency: 'USD' }, { label: 'Crédits consommés dans la période', amount: used, currency: 'USD' }],
  };
}
async function fetchOllamaCredits(fetcher, now = new Date()) {
  let response;
  try { response = await fetcher(SETTINGS_URL, { method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Connexion aux usages Ollama impossible ou délai dépassé.'); }
  if ([301,302,303,307,308,401,403].includes(response.status)) throw signInError();
  if (response.status === 429) throw new Error('Trop de demandes Ollama. Réessaie dans quelques minutes.');
  if (!response.ok) throw new Error(`Usages Ollama indisponibles (HTTP ${response.status}).`);
  if (response.url && new URL(response.url).origin !== OLLAMA_ORIGIN) throw signInError();
  return parseOllamaCredits(await response.text(), now);
}
module.exports = { OLLAMA_ORIGIN, SETTINGS_URL, parseOllamaCredits, fetchOllamaCredits };
