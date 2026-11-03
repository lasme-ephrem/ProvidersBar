const ORCA_ORIGIN = 'https://www.orcarouter.ai';
const EXPIRED = 'Session OrcaRouter absente ou expirée. Ouvre la connexion au compte et reconnecte-toi.';
const MIN_RATE_LIMIT_COOLDOWN_MS = 60000;
let rateLimitedUntil = 0;

function authError(message = EXPIRED) {
  return Object.assign(new Error(message), { code: 'ORCA_AUTH' });
}
function transientError(message) {
  return Object.assign(new Error(message), { code: 'ORCA_TRANSIENT' });
}
function rateLimitError(retryAt) {
  return Object.assign(new Error(`Trop de demandes OrcaRouter. Nouvelle lecture possible après ${new Date(retryAt).toLocaleTimeString('fr-FR')}.`), { code: 'ORCA_RATE_LIMIT', retryAt });
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
function resetOrcaRateLimit() { rateLimitedUntil = 0; }

function validateAccountRef(ref) {
  if (!ref || !Number.isSafeInteger(ref.userId) || ref.userId <= 0 || !Number.isSafeInteger(ref.workspaceId) || ref.workspaceId <= 0) throw authError();
}
function parseWallet(userBody, statusBody, ref, now = new Date()) {
  validateAccountRef(ref);
  if (userBody?.success !== true || statusBody?.success !== true) throw authError();
  const user = userBody.data, workspace = user?.active_workspace;
  if (user?.id !== ref.userId || workspace?.id !== ref.workspaceId) throw authError('Le compte ou l’espace de travail OrcaRouter a changé. Vérifie de nouveau la connexion.');
  const quota = workspace.wallet_quota, perDollar = statusBody.data?.quota_per_unit;
  if (!Number.isSafeInteger(quota) || quota < 0 || !Number.isSafeInteger(perDollar) || perDollar <= 0) throw transientError('Solde du portefeuille ou conversion OrcaRouter non reconnu. Aucun montant estimé ne sera affiché.');
  return { source: 'api', connectorVersion: 'orca-wallet-v1', updatedAt: now.toISOString(), quotaRemaining: null, resetAt: null,
    balanceLabel: 'Solde du portefeuille', balances: [{ currency: 'USD', remaining: quota / perDollar }] };
}
async function fetchWallet(ref, fetcher, now = new Date()) {
  validateAccountRef(ref);
  if (rateLimitedUntil > now.getTime()) throw rateLimitError(rateLimitedUntil);
  const get = async route => {
    let response;
    try {
      response = await fetcher(ORCA_ORIGIN + route, { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'New-API-User': String(ref.userId), 'X-Workspace-Id': String(ref.workspaceId) }, signal: AbortSignal.timeout(15000) });
    } catch { throw transientError('Connexion au portefeuille OrcaRouter impossible ou délai dépassé.'); }
    if (response.status === 401 || response.status === 403) throw authError();
    if (response.status === 429) {
      rateLimitedUntil = retryAfterUntil(response, now.getTime());
      throw rateLimitError(rateLimitedUntil);
    }
    if (!response.ok) throw transientError(`Portefeuille OrcaRouter indisponible (HTTP ${response.status}).`);
    try { return await response.json(); } catch { throw transientError('Réponse du portefeuille OrcaRouter illisible.'); }
  };
  const user = await get('/api/user/self');
  if (user?.success !== true) throw authError();
  return parseWallet(user, await get('/api/status'), ref, now);
}
module.exports = { ORCA_ORIGIN, fetchWallet, parseWallet, validateAccountRef, resetOrcaRateLimit };
