const rows = [
  ['openai', 'OpenAI', 'subscription', 'O', '#a5b8aa', true],
  ['gemini', 'Gemini web', 'subscription', 'G', '#91a8ff', true],
  ['antigravity', 'Antigravity', 'subscription', 'A', '#9bbff5', true],
  ['zai', 'Z.ai Token Plan', 'subscription', 'Z', '#9cafeb', true],
  ['ollama', 'Ollama', 'subscription', 'O', '#c9c3b9', true],
  ['grok', 'Grok', 'subscription', 'X', '#bcbcc9', false],
  ['openrouter', 'OpenRouter', 'api', '↗', '#9caaf7', true],
  ['deepseek', 'DeepSeek Platform', 'api', 'D', '#8aaaff', true],
  ['runinfra', 'RunInfra', 'api', 'R', '#efa793', false],
  ['orcarouter', 'OrcaRouter', 'api', 'OR', '#94c6d4', false],
];

function createSeed() {
  return {
    version: 1,
    providers: rows.map(([id, name, type, monogram, color, favorite]) => ({
      id, name, type, amount: null, renewalDate: null, monogram, color, notes: '', favorite,
      currency: 'USD', billingCycle: 'unknown', plan: '', reviewed: false, active: true,
      nextAmount: null, priceChangeDate: null,
      snapshot: null, error: null, lastAttempt: null,
    })),
    settings: { autoRefresh: true, notifications: false, lowBalance: 5 },
    history: [],
  };
}
module.exports = { createSeed };
