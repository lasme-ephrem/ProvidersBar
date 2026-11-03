const OLLAMA_ORIGIN = 'https://ollama.com';
const SETTINGS_URL = OLLAMA_ORIGIN + '/settings';
const MIN_RATE_LIMIT_COOLDOWN_MS = 60000;
let rateLimitedUntil = 0;
function signInError() { return Object.assign(new Error('Session Ollama absente ou expirée. Ouvre le compte Ollama et reconnecte-toi.'), { code: 'OLLAMA_SIGNIN' }); }
function rateLimitError(retryAt) {
  return Object.assign(new Error(`Trop de demandes Ollama. Nouvelle lecture possible après ${new Date(retryAt).toLocaleTimeString('fr-FR')}.`), { code: 'OLLAMA_RATE_LIMIT', retryAt });
}
function retryAfterUntil(response, nowMs) {
  const header = response.headers?.get?.('retry-after');
  let parsed = null;
  if (typeof header === 'string' && header.trim()) {
    const value = header.trim();
    parsed = /^\d+(?:\.\d+)?$/.test(value) ? nowMs + Number(value) * 1000 : Date.parse(value);
  }
  return Math.max(nowMs + MIN_RATE_LIMIT_COOLDOWN_MS, Number.isFinite(parsed) ? parsed : 0);
}
function resetOllamaRateLimit() { rateLimitedUntil = 0; }

function usageCredits(safe) {
  const start = safe.search(/Usage credits/i);
  if (start < 0) return null;
  const tail = safe.slice(start, start + 6000);
  const boundary = tail.slice('Usage credits'.length).search(/Billing history|Payment methods|Invoices|Subscription settings/i);
  const section = boundary < 0 ? tail : tail.slice(0, 'Usage credits'.length + boundary);
  const plain = section.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&#36;|&#x24;/gi, '$').replace(/\s+/g, ' ');
  const amount = '((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?)';
  const matches = [
    ...plain.matchAll(new RegExp('\\$' + amount + '\\s+Current balance\\b', 'gi')),
    ...plain.matchAll(new RegExp('\\bCurrent balance\\s+\\$' + amount, 'gi')),
  ];
  // The current settings header displays the purchased balance immediately
  // after its plan badge, without the former "Current balance" caption. Keep
  // the match before the add-funds controls; model spend and top-up presets
  // further down the screen are unrelated to the remaining balance.
  if (!matches.length) {
    const header = plain.match(new RegExp('^\\s*Usage credits\\s+(?:Free|Pro|Max|Team)\\s+\\$' + amount + '\\s+(?:Add usage credits to pay as you go|Add funds|Auto-reload)\\b', 'i'));
    if (header) matches.push(header);
  }
  if (matches.length !== 1) return null;
  const remaining = Number(matches[0][1].replaceAll(',', ''));
  return Number.isFinite(remaining) && remaining >= 0 ? { currency: 'USD', remaining } : null;
}
function lastKnownUsageCredits(snapshot, history = []) {
  const valid = value => value?.currency === 'USD' && typeof value.remaining === 'number' && Number.isFinite(value.remaining) && value.remaining >= 0;
  if (valid(snapshot?.usageCredits)) {
    return { ...snapshot.usageCredits, observedAt: snapshot.usageCredits.observedAt || snapshot.usageCredits.updatedAt || snapshot.updatedAt || null, stale: Boolean(snapshot.usageCredits.stale) };
  }
  const previous = history.find(entry => entry?.providerId === 'ollama' && valid(entry.usageCredits));
  if (!previous) return null;
  return { ...previous.usageCredits, observedAt: previous.usageCredits.observedAt || previous.usageCredits.updatedAt || previous.updatedAt || null, stale: true };
}
function parseOllamaCredits(html, now = new Date(), { assumeFree = false } = {}) {
  if (typeof html !== 'string') throw new Error('Réponse Ollama illisible.');
  const safe = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const plainPage = safe.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&#36;|&#x24;/gi, '$').replace(/\s+/g, ' ');
  const start = safe.search(/Monthly usage|Included usage|Usage included|Cloud usage/i);
  if (/\b(?:sign in|log in|continue with (?:google|email)|verify your email)\b/i.test(plainPage)) throw signInError();
  const heading = (start < 0 ? plainPage : safe.slice(Math.max(0, start - 250), start + 600)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const explicitFree = /\b(?:Included usage|Usage included|Cloud usage|Usage credits)\s*Free\b|\bFree plan\b/i.test(heading);
  const free = explicitFree || assumeFree;
  if (start < 0) {
    // A Free fallback still needs recognizable account usage content.
    const reserve = usageCredits(safe);
    if (free && (explicitFree || reserve)) return { source: 'api', connectorVersion: 'ollama-monthly-credits-v1', updatedAt: now.toISOString(), planTier: 'free', balanceLabel: 'Limite Free à vérifier', balances: [], usageCredits: reserve, quotaRemaining: null, resetAt: null, details: [] };
    throw new Error('Crédits mensuels Ollama non reconnus. Aucun montant ne sera déduit du tarif ou d’une jauge.');
  }
  // Restrict extraction to the monthly usage section; additional credits and
  // subscription prices must not be mistaken for included usage.
  const tail = safe.slice(start, start + 6000);
  const boundary = tail.search(/Usage credits|Extra usage|Additional credits|Session usage|Weekly usage|Billing history/i);
  const section = boundary >= 0 ? tail.slice(0, boundary) : tail;
  const plain = section.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&#36;|&#x24;/gi, '$').replace(/\s+/g, ' ');
  const amount = '((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?)';
  const planTier = heading.match(/(?:Included usage|Usage included|Cloud usage)\s*(Free|Pro|Max|Team)\b/i)?.[1]?.toLowerCase() || (free ? 'free' : 'paid');
  const matches = [...plain.matchAll(new RegExp('\\$' + amount + '\\s+of\\s+\\$' + amount + '\\s+used', 'gi'))];
  let usedMatch = matches[0]?.[1], totalMatch = matches[0]?.[2];
  if (matches.length === 0 && !free) {
    const usedAmounts = [...plain.matchAll(new RegExp('\\$' + amount + '\\s+used\\b', 'gi'))];
    const includedAmounts = [...plain.matchAll(new RegExp('\\b(?:includes?|included)\\s+\\$' + amount + '\\s+(?:of\\s+)?(?:monthly\\s+)?usage(?:\\s+credits)?\\b', 'gi'))];
    if (usedAmounts.length === 1 && includedAmounts.length === 1) {
      usedMatch = usedAmounts[0][1];
      totalMatch = includedAmounts[0][1];
    } else if (usedAmounts.length === 1 && ['pro','max','team'].includes(planTier)) {
      const tierAllowance = plain.match(new RegExp('\\b' + planTier + '\\s*[—–:-]\\s*\\$' + amount, 'i'));
      if (tierAllowance) { usedMatch = usedAmounts[0][1]; totalMatch = tierAllowance[1]; }
    }
  }
  if ((matches.length !== 1 && !(usedMatch && totalMatch)) && !free) throw new Error('Montants des crédits mensuels Ollama absents ou ambigus. Aucun solde estimé ne sera affiché.');
  if (matches.length > 1) throw new Error('Montants des crédits mensuels Ollama ambigus.');
  const used = usedMatch ? Number(usedMatch.replaceAll(',', '')) : null, total = totalMatch ? Number(totalMatch.replaceAll(',', '')) : null;
  if (usedMatch && totalMatch && (!Number.isFinite(used) || !Number.isFinite(total) || total < 0 || used < 0 || (total === 0 && !free))) throw new Error('Crédits mensuels Ollama invalides.');
  const hasAmount = total !== null && total > 0 && (!assumeFree || explicitFree);
  const remaining = hasAmount ? Math.max(0, total - used) : null;
  const freePercent = !hasAmount && free ? [...plain.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*%\s*(used|remaining)\b/gi)] : [];
  const freeQuota = freePercent.length === 1 && Number(freePercent[0][1]) <= 100
    ? Math.round((freePercent[0][2].toLowerCase() === 'used' ? 100 - Number(freePercent[0][1]) : Number(freePercent[0][1])) * 100) / 100 : null;
  const date = section.match(/data-time=["']([^"']+)["']/i)?.[1];
  let resetAt = null;
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error('Date de remise à zéro Ollama non reconnue.');
    resetAt = new Date(date).toISOString();
  }
  return { source: 'api', connectorVersion: 'ollama-monthly-credits-v1', updatedAt: now.toISOString(),
    planTier, balanceLabel: free ? 'Usage Free restant' : 'Crédits mensuels restants', balances: hasAmount ? [{ currency: 'USD', remaining, total, used }] : [],
    usageCredits: usageCredits(safe),
    quotaRemaining: hasAmount ? Math.round(remaining / total * 10000) / 100 : freeQuota, resetAt,
    details: hasAmount ? [{ label: 'Crédits inclus dans la période', amount: total, currency: 'USD' }, { label: 'Crédits consommés dans la période', amount: used, currency: 'USD' }] : [],
  };
}
async function fetchOllamaCredits(fetcher, now = new Date(), options = {}) {
  if (rateLimitedUntil > now.getTime()) throw rateLimitError(rateLimitedUntil);
  let response;
  try { response = await fetcher(SETTINGS_URL, { method: 'GET', credentials: 'include', redirect: 'manual', cache: 'no-store', headers: { Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error('Connexion aux usages Ollama impossible ou délai dépassé.'), { code: 'OLLAMA_TRANSIENT' }); }
  if ([301,302,303,307,308,401,403].includes(response.status)) throw signInError();
  if (response.status === 429) {
    rateLimitedUntil = retryAfterUntil(response, now.getTime());
    throw rateLimitError(rateLimitedUntil);
  }
  if (!response.ok) throw Object.assign(new Error(`Usages Ollama indisponibles (HTTP ${response.status}).`), { code: 'OLLAMA_TRANSIENT' });
  if (response.url) {
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== OLLAMA_ORIGIN || finalUrl.pathname.startsWith('/auth/')) throw signInError();
  }
  try { return parseOllamaCredits(await response.text(), now, options); }
  catch (error) {
    // A format change is not an authentication failure: the session must be kept
    // so the next automatic cycle can retry instead of asking for a new login.
    if (!error.code) error.code = 'OLLAMA_TRANSIENT';
    throw error;
  }
}
module.exports = { OLLAMA_ORIGIN, SETTINGS_URL, parseOllamaCredits, fetchOllamaCredits, lastKnownUsageCredits, resetOllamaRateLimit };
