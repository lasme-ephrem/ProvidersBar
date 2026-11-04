// Configuration ESLint (flat config) de Lasmium TOKENS-HUB.
// Philosophie : le jeu « recommended » de @eslint/js et rien d'autre — aucune
// règle de style (indentation, guillemets, longueur de ligne), donc aucun
// reformatage de masse : les diffs restent lisibles. Exécutée par
// `node scripts/lint.cjs` (npm run lint) après la vérification `node --check`.
const js = require('@eslint/js');
const globals = require('globals');

// Ajustements communs au code existant :
// - `catch {}` et `catch (error)` jamais lu sont courants et volontaires ;
// - un argument ou une variable préfixés par `_` sont délibérément ignorés ;
// - `const { signature, ...body } = pack` sert à retirer une clé : les
//   « frères » d'un rest ne sont pas des variables inutilisées.
const unusedVarsOptions = { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true };
const sharedRules = {
  'no-unused-vars': ['error', unusedVarsOptions],
  'no-empty': ['error', { allowEmptyCatch: true }],
};

// Les scripts du renderer sont chargés par des balises <script> classiques
// (renderer/index.html, sans module) et partagent un seul scope global : toute
// déclaration de premier niveau d'un script est visible des autres (voir
// renderer/CONTRAT-UI.md §1 et §2). Les deux modules lib/*.js exposent un
// global UMD quand `module` est absent. Liste groupée par fichier d'origine ;
// les variables `let` réassignées sont `writable`, le reste `readonly`.
const rendererSharedGlobals = {
  // lib/quota-resets.js, lib/resource-levels.js
  QuotaResets: 'readonly',
  ResourceLevels: 'readonly',
  // renderer/ui-core.js
  UI_ICONS: 'readonly', icon: 'readonly', FRESHNESS_MS: 'readonly', escapeHtml: 'readonly',
  money: 'readonly', quotaDisplay: 'readonly', shortDate: 'readonly', fullDateTime: 'readonly',
  relativeAge: 'readonly', age: 'readonly', freshness: 'readonly', freshnessMarkup: 'readonly',
  days: 'readonly', resetLabel: 'readonly', PROVIDER_LOGOS: 'readonly', hasConnector: 'readonly',
  isTracked: 'readonly', ollamaFree: 'readonly', subscriptionStatus: 'readonly', providerById: 'readonly',
  logo: 'readonly', resourceClass: 'readonly', levelPill: 'readonly', meterMarkup: 'readonly',
  THEME_STORAGE_KEY: 'readonly', THEME_PREFERENCES: 'readonly', themePreference: 'writable',
  systemThemeQuery: 'writable', normalizeThemePreference: 'readonly', systemPrefersDark: 'readonly',
  resolveTheme: 'readonly', applyTheme: 'readonly', watchSystemTheme: 'readonly',
  FOCUS_ATTRIBUTES: 'readonly', focusSelector: 'readonly', captureFocus: 'readonly',
  restoreFocus: 'readonly', toastTimer: 'writable', toast: 'readonly', announce: 'readonly',
  disclosureState: 'readonly',
  // renderer/reset-ui.js
  resetMarkup: 'readonly', resetForm: 'readonly',
  // renderer/views.js
  NAV_LABELS: 'readonly', brand: 'readonly', heading: 'readonly', syncButton: 'readonly', nav: 'readonly',
  shell: 'readonly', resourceLegend: 'readonly', stats: 'readonly', toolbar: 'readonly',
  filteredCards: 'readonly', overview: 'readonly', statusBadge: 'readonly', strategyLabel: 'readonly',
  healthPresentation: 'readonly', healthPanel: 'readonly', packStatusMarkup: 'readonly',
  quotaGroups: 'readonly', quotaPeriodLabel: 'readonly', displayedQuotaGroups: 'readonly',
  quotaStatusPeriods: 'readonly', allQuotaPeriodsExhausted: 'readonly', providerResourceLevel: 'readonly',
  quotaLimitStatus: 'readonly', quotaSlotLabel: 'readonly', resourceAmount: 'readonly',
  resourceUnverified: 'readonly', ollamaUsageCredits: 'readonly', ollamaReserveMarkup: 'readonly',
  resourceNotice: 'readonly', quotaGroupsMarkup: 'readonly', expiredCard: 'readonly',
  favoriteButton: 'readonly', card: 'readonly', subscriptions: 'readonly', connections: 'readonly',
  graph: 'readonly', historyPage: 'readonly', updateSection: 'readonly', settingsPage: 'readonly',
  quickFact: 'readonly', quickSubscriptionFacts: 'readonly', quickApiFacts: 'readonly',
  quickChip: 'readonly', quickDetailText: 'readonly', quickAccountRow: 'readonly', quickHeader: 'readonly',
  inputField: 'readonly', selectField: 'readonly', providerInfoBody: 'readonly',
  providerManualBody: 'readonly', quotaWindowsNote: 'readonly', providerConnectionBody: 'readonly',
  apiKeyConnectionBody: 'readonly', accountConnectionBody: 'readonly', claudeConnectionBody: 'readonly',
  antigravityConnectionBody: 'readonly', dialogTabs: 'readonly', dialogBody: 'readonly',
  dialogMarkup: 'readonly',
  // renderer/app.js — état et variables assignables (aussi par les smoke tests)
  state: 'writable', appInfo: 'writable', page: 'writable', filter: 'writable', query: 'writable',
  dialogId: 'writable', dialogTab: 'writable', historyProvider: 'writable', historyPeriod: 'writable',
  syncing: 'writable', historyLoaded: 'writable', historyLoading: 'writable', historyError: 'writable',
  erasePending: 'writable', eraseTimer: 'writable', api: 'writable', quick: 'readonly',
  PREVIEW_BANNER: 'readonly', render: 'readonly', renderDialog: 'readonly', openDetail: 'readonly',
  renderQuick: 'readonly', loadHistory: 'readonly', IPC_ERROR_PREFIX: 'readonly', runAction: 'readonly',
  searchTimer: 'writable', receiveState: 'readonly', start: 'readonly',
};

// Fonctions sérialisées puis exécutées dans une page Chromium (page.evaluate
// des smoke tests Playwright, lecteur DOM des comptes) : elles utilisent les
// globals du navigateur et le contrat du renderer (CONTRAT-UI.md §2).
const pageContractGlobals = {
  state: 'writable', page: 'writable', filter: 'writable', query: 'writable',
  render: 'readonly', renderQuick: 'readonly', receiveState: 'readonly', statusBadge: 'readonly',
  openDetail: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.local/',
      '.npm-cache/',
      '.claude/',
      'data/',
      'test-results/',
      'docs/',
      'assets/',
      'fixtures/',
      'tests/fixtures/',
      // Temporaire : retiré après le découpage de views.js en vues séparées.
      'renderer/views.js',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024 },
    rules: sharedRules,
  },
  {
    // Processus principal, preload, lib/, scripts/ et tests/ : CommonJS sous Node.
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['lib/subscription-accounts.cjs', 'scripts/smoke*.cjs', 'scripts/verify-connections.cjs'],
    languageOptions: { globals: { ...globals.browser, ...pageContractGlobals } },
  },
  {
    // Modules partagés main/renderer : UMD, exécutés sous Node (tests) et dans
    // le renderer (balise <script>).
    files: ['lib/quota-resets.js', 'lib/resource-levels.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['renderer/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...rendererSharedGlobals } },
    rules: {
      // Les déclarations de premier niveau sont l'« API » partagée entre
      // scripts : seules les variables locales sont contrôlées.
      'no-unused-vars': ['error', { ...unusedVarsOptions, vars: 'local' }],
      // Chaque script déclare lui-même les globals partagés listés ci-dessus.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
];
