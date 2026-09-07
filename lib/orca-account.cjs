const ORCA_ORIGIN = 'https://www.orcarouter.ai';
const EXPIRED = 'Session OrcaRouter absente ou expirée. Ouvre la connexion au compte et reconnecte-toi.';
function validateAccountRef(ref) {
  if (!ref || !Number.isSafeInteger(ref.userId) || ref.userId <= 0 || !Number.isSafeInteger(ref.workspaceId) || ref.workspaceId <= 0) throw new Error(EXPIRED);
}
function parseWallet(userBody, statusBody, ref, now = new Date()) {
  validateAccountRef(ref);
  if (userBody?.success !== true || statusBody?.success !== true) throw new Error(EXPIRED);
  const user = userBody.data, workspace = user?.active_workspace;
  if (user?.id !== ref.userId || workspace?.id !== ref.workspaceId) throw new Error('Le compte ou l’espace de travail OrcaRouter a changé. Vérifie de nouveau la connexion.');
  const quota = workspace.wallet_quota, perDollar = statusBody.data?.quota_per_unit;
  if (!Number.isSafeInteger(quota) || !Number.isSafeInteger(perDollar) || perDollar <= 0) throw new Error('Solde du portefeuille ou conversion OrcaRouter non reconnu. Aucun montant estimé ne sera affiché.');
  return { source: 'api', connectorVersion: 'orca-wallet-v1', updatedAt: now.toISOString(), quotaRemaining: null, resetAt: null,
    balanceLabel: 'Solde du portefeuille', balances: [{ currency: 'USD', remaining: quota / perDollar }] };
}
async function fetchWallet(ref, fetcher, now = new Date()) {
  validateAccountRef(ref);
  const get = async route => {
    let response;
    try {
      response = await fetcher(ORCA_ORIGIN + route, { method: 'GET', credentials: 'include', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', 'New-API-User': String(ref.userId), 'X-Workspace-Id': String(ref.workspaceId) }, signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('Connexion au portefeuille OrcaRouter impossible ou délai dépassé.'); }
    if (response.status === 401 || response.status === 403) throw new Error(EXPIRED);
    if (response.status === 429) throw new Error('Trop de demandes OrcaRouter. Réessaie dans quelques minutes.');
    if (!response.ok) throw new Error(`Portefeuille OrcaRouter indisponible (HTTP ${response.status}).`);
    try { return await response.json(); } catch { throw new Error('Réponse du portefeuille OrcaRouter illisible.'); }
  };
  const user = await get('/api/user/self');
  if (user?.success !== true) throw new Error(EXPIRED);
  return parseWallet(user, await get('/api/status'), ref, now);
}
module.exports = { ORCA_ORIGIN, fetchWallet, parseWallet, validateAccountRef };
