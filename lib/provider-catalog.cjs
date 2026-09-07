const { accounts } = require('./subscription-accounts.cjs');
const connectors = {
  antigravity: {
    mode: 'account', localAccount: true,
    description: 'Quotas Antigravity distincts de Gemini web : modèles Gemini et Claude/GPT, sur cinq heures et sur la semaine.',
    instructions: 'Garde Antigravity 2.0 ouvert et connecté à ton compte Google. Clique sur Connecter Antigravity pour lire ses quotas locaux. Aucune CLI à installer.',
    scope: 'Antigravity · Gemini et Claude/GPT · 5 heures et semaine',
  },
  ...Object.fromEntries(Object.entries(accounts).map(([id, config]) => [id, {
    mode: 'account', browserAccount: id !== 'openai', codexAccount: id === 'openai',
    description: id === 'openai' ? 'Limites réelles et dates de remise à zéro, lues par l’interface officielle de Codex.' : 'Connexion au compte et lecture des pourcentages de quota affichés dans les réglages d’utilisation.',
    instructions: id === 'openai' ? config.hint : `Connecte-toi sur le site officiel dans Chrome ou Edge. ${config.hint} La détection est automatique lorsque les quotas sont lisibles.`,
    scope: config.scope,
  }])),
  ollama: {
    mode: 'account',
    description: 'Crédits mensuels inclus, consommés et restants en dollars, avec leur remise à zéro.',
    instructions: 'Connecte-toi sur le site officiel Ollama dans la fenêtre Chrome ou Edge qui s’ouvre. ProvidersBar détecte la connexion et lit les crédits en dollars de ton offre, sans utiliser de clé API.',
    scope: 'Abonnement en crédits · connexion au compte · USD',
  },
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/credits',
    keyLabel: 'Clé de gestion OpenRouter',
    description: 'Crédits achetés, consommés et restants sur le compte.',
    instructions: 'Utilise une clé de gestion OpenRouter (Management key). Une clé d’inférence ordinaire ne donne pas accès au solde global.',
    scope: 'Solde du compte · USD',
  },
  deepseek: {
    endpoint: 'https://api.deepseek.com/user/balance',
    keyLabel: 'Clé API DeepSeek',
    description: 'Solde disponible du compte, dans sa devise d’origine.',
    instructions: 'Utilise une clé API de DeepSeek Platform pour lire le solde de ton compte.',
    scope: 'Solde du compte · USD / CNY',
  },
  runinfra: {
    endpoint: 'https://api.runinfra.ai/v1/credits',
    keyLabel: 'Clé API d’espace de travail RunInfra',
    description: 'Solde de l’espace de travail, crédits réservés et dépenses de la période.',
    instructions: 'Utilise une clé API d’espace de travail RunInfra créée dans Settings, sans restriction à un déploiement ou à un endpoint. Une clé limitée à un déploiement ne peut pas consulter les crédits.',
    scope: 'Solde de l’espace de travail · USD',
  },
  orcarouter: {
    mode: 'account',
    endpoint: 'https://api.orcarouter.ai/v1/dashboard/billing/subscription',
    keyLabel: 'Clé API OrcaRouter',
    description: 'Solde réel du portefeuille, lu avec ta session OrcaRouter.',
    instructions: 'Ouvre le site officiel, connecte-toi et sélectionne ton espace de travail. ProvidersBar détecte la connexion et récupère automatiquement le portefeuille. La clé API seule ne donne pas accès au portefeuille.',
    scope: 'Portefeuille · connexion au compte · USD',
  },
};

function connectionInfo(id) {
  if (!Object.hasOwn(connectors, id)) return null;
  const descriptor = connectors[id];
  if (!descriptor) return null;
  const { endpoint, ...info } = descriptor;
  return info;
}
module.exports = { connectors, connectionInfo };
