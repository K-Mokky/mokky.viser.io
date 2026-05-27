// ================================================================
// Model API key policy
// ================================================================
// Viser uses logged-in local provider CLIs. These helpers keep audit and
// runtime checks aligned so GPT/Gemini/Claude model API keys do not become a
// supported execution path.

const MODEL_API_KEY_ENV_KEYS = new Set([
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "LLM_API_KEY",
  "MODEL_API_KEY"
]);
const MODEL_API_KEY_ENV_PATTERN = /^(?:OPENAI|ANTHROPIC|CLAUDE|GEMINI|GOOGLE(?:_GENERATIVE_AI)?|LLM|MODEL)[A-Z0-9_]*API[_-]?KEY$/iu;

export function isModelApiKeyEnvKey(key: string): boolean {
  const normalized = key.trim().toUpperCase();
  return MODEL_API_KEY_ENV_KEYS.has(normalized) || MODEL_API_KEY_ENV_PATTERN.test(normalized);
}
