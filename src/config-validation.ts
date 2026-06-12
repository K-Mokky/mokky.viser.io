// ================================================================
// Configuration validation
// ================================================================
// User config is JSON and intentionally editable. Validate the merged shape
// before normalizing paths so mistakes fail with actionable messages instead
// of surfacing later as generic TypeErrors.

import type { PromptMode, ViserConfig } from "./core/types.ts";

export type ConfigValidationSeverity = "pass" | "warn" | "fail";

export interface ConfigValidationItem {
  severity: ConfigValidationSeverity;
  path: string;
  message: string;
  next?: string;
}

const PROMPT_MODES = new Set<PromptMode>(["stdin", "template", "argument"]);
const ACCESS_POLICIES = new Set(["pairing", "allowlist", "open"]);
const LOCAL_WEB_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const MAX_JOB_CONCURRENCY = 6;
const MAX_ASSISTANT_INPUT_CHARS = 50_000;
const MAX_CONNECTOR_MESSAGES_PER_MINUTE = 120;
const MAX_CONNECTOR_INPUT_CHARS = 20_000;
const WEB_SEARCH_PROVIDERS = new Set(["duckduckgo-html", "searxng-html", "brave-api", "tavily-api", "perplexity-api", "exa-api", "firecrawl-api", "ollama-api"]);
const WEB_FETCH_PROVIDERS = new Set(["direct-http", "firecrawl-api"]);

export function assertValidConfig(config: unknown): asserts config is ViserConfig {
  const items = configValidationItems(config);
  const failures = items.filter((item) => item.severity === "fail");
  if (failures.length === 0) return;

  throw new Error([
    "Invalid Viser config:",
    ...failures.map((item) => `- ${item.path}: ${item.message}${item.next ? ` (${item.next})` : ""}`)
  ].join("\n"));
}

export function configValidationItems(config: unknown): ConfigValidationItem[] {
  const items: ConfigValidationItem[] = [];
  if (!isPlainObject(config)) {
    return [{ severity: "fail", path: "root", message: "config must be a JSON object" }];
  }

  validateAssistant(config.assistant, config.providers, items);
  validateStorageLike("storage", config.storage, items);
  validateMemory(config.memory, items);
  validatePersonalization(config.personalization, items);
  validateSkills(config.skills, items);
  validatePlugins(config.plugins, items);
  validateTools(config.tools, items);
  validateTickSection("scheduler", config.scheduler, items);
  validateJobs(config.jobs, items);
  validateWebDashboard(config.webDashboard, items);
  validateAccess(config.access, items);
  validateActions(config.actions, items);
  validateConnectors(config.connectors, items);
  validateProviders(config.providers, items);

  if (!items.some((item) => item.severity === "fail" || item.severity === "warn")) {
    items.push({ severity: "pass", path: "config", message: "shape is valid" });
  }

  return items;
}

function validateAssistant(value: unknown, providers: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "assistant", items)) return;
  requireString(value, "assistant.name", items);
  const defaultProvider = requireString(value, "assistant.defaultProvider", items);
  const fallbackProviders = requireStringArray(value, "assistant.fallbackProviders", items);
  requireString(value, "assistant.systemPrompt", items);
  requirePositiveInteger(value, "assistant.historyLimit", items);
  const maxInputChars = requirePositiveInteger(value, "assistant.maxInputChars", items);
  if (maxInputChars !== undefined && maxInputChars > MAX_ASSISTANT_INPUT_CHARS) {
    items.push({
      severity: "fail",
      path: "assistant.maxInputChars",
      message: `must be at most ${MAX_ASSISTANT_INPUT_CHARS}`,
      next: "Keep direct CLI/MCP provider prompts bounded before launching local AI CLIs."
    });
  }
  requireString(value, "assistant.workdir", items);

  if (isPlainObject(providers)) {
    if (defaultProvider && !isPlainObject(providers[defaultProvider])) {
      items.push({
        severity: "fail",
        path: "assistant.defaultProvider",
        message: `provider '${defaultProvider}' is not configured`,
        next: `Choose one of: ${Object.keys(providers).join(", ")}`
      });
    }

    const seen = new Set<string>();
    for (const providerId of fallbackProviders ?? []) {
      if (seen.has(providerId)) {
        items.push({ severity: "warn", path: "assistant.fallbackProviders", message: `duplicate fallback provider '${providerId}'` });
      }
      seen.add(providerId);
      if (!isPlainObject(providers[providerId])) {
        items.push({
          severity: "warn",
          path: "assistant.fallbackProviders",
          message: `fallback provider '${providerId}' is not configured`,
          next: "Remove it or add a matching providers entry."
        });
      }
    }
  }
}

function validateStorageLike(path: string, value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, path, items)) return;
  requireString(value, `${path}.dir`, items);
}

function validateMemory(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "memory", items)) return;
  requireBoolean(value, "memory.enabled", items);
  requireString(value, "memory.dir", items);
  requirePositiveInteger(value, "memory.promptLimit", items);
}

function validatePersonalization(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "personalization", items)) return;
  requireBoolean(value, "personalization.enabled", items);
  requireString(value, "personalization.dir", items);
  const promptLimit = requirePositiveInteger(value, "personalization.promptLimit", items);
  const maxValueChars = requirePositiveInteger(value, "personalization.maxValueChars", items);
  if (promptLimit !== undefined && promptLimit > 100) {
    items.push({
      severity: "fail",
      path: "personalization.promptLimit",
      message: "must be at most 100",
      next: "Keep durable personalization variables bounded before prompt injection."
    });
  }
  if (maxValueChars !== undefined && maxValueChars > 5000) {
    items.push({
      severity: "fail",
      path: "personalization.maxValueChars",
      message: "must be at most 5000",
      next: "Store concise tone/personality/style settings instead of long transcripts or sensitive profile dumps."
    });
  }
}

function validateSkills(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "skills", items)) return;
  requireBoolean(value, "skills.enabled", items);
  requireStringArray(value, "skills.dirs", items);
  requirePositiveInteger(value, "skills.promptLimit", items);
}

function validatePlugins(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "plugins", items)) return;
  requireBoolean(value, "plugins.enabled", items);
  requireStringArray(value, "plugins.dirs", items);
  requirePositiveInteger(value, "plugins.promptLimit", items);
}

function validateTools(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "tools", items)) return;
  requireBoolean(value, "tools.enabled", items);
  requireStringArray(value, "tools.allowedReadRoots", items);
  requirePositiveInteger(value, "tools.maxReadBytes", items);
  const shell = value.shell;
  if (!section(shell, "tools.shell", items)) return;
  requireBoolean(shell, "tools.shell.enabled", items);
  requireStringArray(shell, "tools.shell.allowedCommands", items);
  requirePositiveInteger(shell, "tools.shell.timeoutMs", items);
  const webFetch = value.webFetch;
  if (!section(webFetch, "tools.webFetch", items)) return;
  requireBoolean(webFetch, "tools.webFetch.enabled", items);
  const webFetchProvider = requireString(webFetch, "tools.webFetch.provider", items);
  const extractMode = requireString(webFetch, "tools.webFetch.extractMode", items);
  const webFetchFirecrawlApiKeyEnv = requireString(webFetch, "tools.webFetch.firecrawlApiKeyEnv", items);
  const webFetchFirecrawlApiKey = optionalString(webFetch, "tools.webFetch.firecrawlApiKey", items);
  const maxResponseBytes = requirePositiveInteger(webFetch, "tools.webFetch.maxResponseBytes", items);
  const timeoutMs = requirePositiveInteger(webFetch, "tools.webFetch.timeoutMs", items);
  const maxRedirects = requirePositiveInteger(webFetch, "tools.webFetch.maxRedirects", items);
  const cacheTtlMs = requirePositiveInteger(webFetch, "tools.webFetch.cacheTtlMs", items);
  requireString(webFetch, "tools.webFetch.userAgent", items);
  if (webFetchProvider !== undefined && !WEB_FETCH_PROVIDERS.has(webFetchProvider)) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.provider",
      message: "must be direct-http or firecrawl-api",
      next: "Use direct-http for bounded HTTP(S) fetches or firecrawl-api for Firecrawl scrape-backed readable extraction."
    });
  }
  if (extractMode !== undefined && extractMode !== "text" && extractMode !== "markdown") {
    items.push({
      severity: "fail",
      path: "tools.webFetch.extractMode",
      message: "must be text or markdown",
      next: "Choose text for normalized plain text or markdown for lightweight link/heading/list preservation."
    });
  }
  if (maxResponseBytes !== undefined && maxResponseBytes > 2_000_000) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.maxResponseBytes",
      message: "must be at most 2000000",
      next: "Keep remote fetch responses bounded before content extraction."
    });
  }
  if (timeoutMs !== undefined && timeoutMs > 120_000) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.timeoutMs",
      message: "must be at most 120000",
      next: "Keep web fetches bounded so local tool calls cannot hang the foreground runtime."
    });
  }
  if (maxRedirects !== undefined && maxRedirects > 10) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.maxRedirects",
      message: "must be at most 10",
      next: "Keep redirect chains short and re-check every target before fetching."
    });
  }
  if (cacheTtlMs !== undefined && cacheTtlMs > 3_600_000) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.cacheTtlMs",
      message: "must be at most 3600000",
      next: "Keep public web-fetch cache entries short-lived and in-memory only."
    });
  }
  if (webFetchProvider === "firecrawl-api" && !webFetchFirecrawlApiKeyEnv?.trim() && !webFetchFirecrawlApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.firecrawlApiKeyEnv",
      message: "must be configured when tools.webFetch.provider is firecrawl-api",
      next: "Set tools.webFetch.firecrawlApiKeyEnv to FIRECRAWL_API_KEY or provide tools.webFetch.firecrawlApiKey."
    });
  }
  if (webFetchFirecrawlApiKey?.trim()) validateWebFetchFirecrawlApiKey(webFetchFirecrawlApiKey, items);
  const webSearch = value.webSearch;
  if (!section(webSearch, "tools.webSearch", items)) return;
  requireBoolean(webSearch, "tools.webSearch.enabled", items);
  const provider = requireString(webSearch, "tools.webSearch.provider", items);
  const maxResults = requirePositiveInteger(webSearch, "tools.webSearch.maxResults", items);
  const searchMaxResponseBytes = requirePositiveInteger(webSearch, "tools.webSearch.maxResponseBytes", items);
  const searchTimeoutMs = requirePositiveInteger(webSearch, "tools.webSearch.timeoutMs", items);
  const searxngBaseUrl = optionalString(webSearch, "tools.webSearch.searxngBaseUrl", items);
  const braveApiKeyEnv = requireString(webSearch, "tools.webSearch.braveApiKeyEnv", items);
  const braveApiKey = optionalString(webSearch, "tools.webSearch.braveApiKey", items);
  const tavilyApiKeyEnv = requireString(webSearch, "tools.webSearch.tavilyApiKeyEnv", items);
  const tavilyApiKey = optionalString(webSearch, "tools.webSearch.tavilyApiKey", items);
  const perplexityApiKeyEnv = requireString(webSearch, "tools.webSearch.perplexityApiKeyEnv", items);
  const perplexityApiKey = optionalString(webSearch, "tools.webSearch.perplexityApiKey", items);
  const exaApiKeyEnv = requireString(webSearch, "tools.webSearch.exaApiKeyEnv", items);
  const exaApiKey = optionalString(webSearch, "tools.webSearch.exaApiKey", items);
  const firecrawlApiKeyEnv = requireString(webSearch, "tools.webSearch.firecrawlApiKeyEnv", items);
  const firecrawlApiKey = optionalString(webSearch, "tools.webSearch.firecrawlApiKey", items);
  const ollamaBaseUrl = requireString(webSearch, "tools.webSearch.ollamaBaseUrl", items);
  const ollamaApiKeyEnv = requireString(webSearch, "tools.webSearch.ollamaApiKeyEnv", items);
  const ollamaApiKey = optionalString(webSearch, "tools.webSearch.ollamaApiKey", items);
  requireString(webSearch, "tools.webSearch.userAgent", items);
  if (provider !== undefined && !WEB_SEARCH_PROVIDERS.has(provider)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.provider",
      message: "must be duckduckgo-html, searxng-html, brave-api, tavily-api, perplexity-api, exa-api, firecrawl-api, or ollama-api",
      next: "Use DuckDuckGo HTML, a configured SearXNG HTML endpoint, Brave/Tavily/Perplexity/Exa/Firecrawl APIs, or Ollama Web Search."
    });
  }
  if (provider === "searxng-html" && !searxngBaseUrl?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.searxngBaseUrl",
      message: "must be configured when tools.webSearch.provider is searxng-html",
      next: "Set tools.webSearch.searxngBaseUrl to the HTTPS base URL of a SearXNG instance."
    });
  }
  if (searxngBaseUrl?.trim()) validateSearxngBaseUrl(searxngBaseUrl, items);
  if (provider === "brave-api" && !braveApiKeyEnv?.trim() && !braveApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.braveApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is brave-api",
      next: "Set tools.webSearch.braveApiKeyEnv to BRAVE_SEARCH_API_KEY or provide tools.webSearch.braveApiKey."
    });
  }
  if (braveApiKey?.trim()) validateBraveApiKey(braveApiKey, items);
  if (provider === "tavily-api" && !tavilyApiKeyEnv?.trim() && !tavilyApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.tavilyApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is tavily-api",
      next: "Set tools.webSearch.tavilyApiKeyEnv to TAVILY_API_KEY or provide tools.webSearch.tavilyApiKey."
    });
  }
  if (tavilyApiKey?.trim()) validateTavilyApiKey(tavilyApiKey, items);
  if (provider === "perplexity-api" && !perplexityApiKeyEnv?.trim() && !perplexityApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.perplexityApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is perplexity-api",
      next: "Set tools.webSearch.perplexityApiKeyEnv to PERPLEXITY_API_KEY or provide tools.webSearch.perplexityApiKey."
    });
  }
  if (perplexityApiKey?.trim()) validatePerplexityApiKey(perplexityApiKey, items);
  if (provider === "exa-api" && !exaApiKeyEnv?.trim() && !exaApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.exaApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is exa-api",
      next: "Set tools.webSearch.exaApiKeyEnv to EXA_API_KEY or provide tools.webSearch.exaApiKey."
    });
  }
  if (exaApiKey?.trim()) validateExaApiKey(exaApiKey, items);
  if (provider === "firecrawl-api" && !firecrawlApiKeyEnv?.trim() && !firecrawlApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.firecrawlApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is firecrawl-api",
      next: "Set tools.webSearch.firecrawlApiKeyEnv to FIRECRAWL_API_KEY or provide tools.webSearch.firecrawlApiKey."
    });
  }
  if (firecrawlApiKey?.trim()) validateFirecrawlApiKey(firecrawlApiKey, items);
  if (ollamaBaseUrl?.trim()) validateOllamaBaseUrl(ollamaBaseUrl, items);
  if (provider === "ollama-api" && isHostedOllamaBaseUrl(ollamaBaseUrl) && !ollamaApiKeyEnv?.trim() && !ollamaApiKey?.trim()) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaApiKeyEnv",
      message: "must be configured when tools.webSearch.provider is ollama-api and ollamaBaseUrl is https://ollama.com",
      next: "Set tools.webSearch.ollamaApiKeyEnv to OLLAMA_API_KEY or use the default signed-in local Ollama daemon at http://127.0.0.1:11434."
    });
  }
  if (ollamaApiKey?.trim()) validateOllamaApiKey(ollamaApiKey, items);
  if (maxResults !== undefined && maxResults > 20) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.maxResults",
      message: "must be at most 20",
      next: "Keep search result output bounded before provider handoff."
    });
  }
  if (searchMaxResponseBytes !== undefined && searchMaxResponseBytes > 2_000_000) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.maxResponseBytes",
      message: "must be at most 2000000",
      next: "Keep search result pages bounded before content extraction."
    });
  }
  if (searchTimeoutMs !== undefined && searchTimeoutMs > 120_000) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.timeoutMs",
      message: "must be at most 120000",
      next: "Keep web searches bounded so local tool calls cannot hang the foreground runtime."
    });
  }
}

function validateBraveApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.braveApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateTavilyApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.tavilyApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validatePerplexityApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.perplexityApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateExaApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.exaApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateFirecrawlApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.firecrawlApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateOllamaApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateWebFetchFirecrawlApiKey(value: string, items: ConfigValidationItem[]): void {
  const trimmed = value.trim();
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    items.push({
      severity: "fail",
      path: "tools.webFetch.firecrawlApiKey",
      message: "must be a non-empty token without whitespace"
    });
  }
}

function validateSearxngBaseUrl(value: string, items: ConfigValidationItem[]): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    items.push({
      severity: "fail",
      path: "tools.webSearch.searxngBaseUrl",
      message: "must be a valid HTTPS URL",
      next: "Example: https://searxng.example.com"
    });
    return;
  }
  if (url.protocol !== "https:") {
    items.push({
      severity: "fail",
      path: "tools.webSearch.searxngBaseUrl",
      message: "must use https",
      next: "Use a TLS-protected SearXNG endpoint."
    });
  }
  if (!url.hostname) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.searxngBaseUrl",
      message: "must include a hostname"
    });
  }
  if (url.username || url.password) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.searxngBaseUrl",
      message: "must not include URL credentials"
    });
  }
}

function validateOllamaBaseUrl(value: string, items: ConfigValidationItem[]): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaBaseUrl",
      message: "must be a valid HTTP(S) URL",
      next: "Use http://127.0.0.1:11434 for a signed-in local Ollama daemon or https://ollama.com for hosted Ollama Web Search."
    });
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaBaseUrl",
      message: "must use http or https"
    });
  }
  if (url.username || url.password) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaBaseUrl",
      message: "credentials are not allowed in Ollama base URL"
    });
  }
  if (url.search || url.hash) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaBaseUrl",
      message: "must not include query or hash"
    });
  }
  const hostname = url.hostname.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "");
  const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (url.protocol === "http:" && !isLocal) {
    items.push({
      severity: "fail",
      path: "tools.webSearch.ollamaBaseUrl",
      message: "http is only allowed for localhost Ollama daemons",
      next: "Use https for remote/self-hosted Ollama-compatible web-search endpoints."
    });
  }
}

function isHostedOllamaBaseUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    return new URL(value.trim()).hostname.toLowerCase().replace(/\.$/u, "") === "ollama.com";
  } catch {
    return false;
  }
}

function validateBrowserUseBaseUrl(value: string, items: ConfigValidationItem[]): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    items.push({
      severity: "fail",
      path: "actions.browserTask.browserUseBaseUrl",
      message: "must be a valid HTTPS URL",
      next: "Use https://api.browser-use.com for Browser Use Cloud task creation."
    });
    return;
  }
  if (url.protocol !== "https:") {
    items.push({
      severity: "fail",
      path: "actions.browserTask.browserUseBaseUrl",
      message: "must use https",
      next: "Browser Use Cloud credentials must only be sent to a TLS endpoint."
    });
  }
  if (url.username || url.password) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.browserUseBaseUrl",
      message: "must not include URL credentials"
    });
  }
  if (url.search || url.hash) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.browserUseBaseUrl",
      message: "must not include query or hash"
    });
  }
}

function validateHttpsApiBaseUrl(value: string, path: string, tlsNext: string, items: ConfigValidationItem[]): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    itemsPushBaseUrlError(items, path, "must be a valid HTTPS URL", tlsNext);
    return;
  }
  if (url.protocol !== "https:") itemsPushBaseUrlError(items, path, "must use https", tlsNext);
  if (url.username || url.password) itemsPushBaseUrlError(items, path, "must not include URL credentials");
  if (url.search || url.hash) itemsPushBaseUrlError(items, path, "must not include query or hash");
  if (url.pathname && url.pathname !== "/") itemsPushBaseUrlError(items, path, "must not include a path");
}

function itemsPushBaseUrlError(items: ConfigValidationItem[], path: string, message: string, next?: string): void {
  items.push({ severity: "fail", path, message, ...(next ? { next } : {}) });
}


function validateLocalCdpBaseUrl(value: string, items: ConfigValidationItem[]): void {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must be a valid localhost HTTP URL",
      next: "Use http://127.0.0.1:9222 for a Chrome/Chromium instance started with --remote-debugging-port=9222."
    });
    return;
  }
  if (url.protocol !== "http:") {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must use http",
      next: "Chrome DevTools Protocol discovery should stay on a loopback HTTP endpoint, not a remote TLS service."
    });
  }
  const hostname = url.hostname.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must point to localhost, 127.0.0.1, or ::1",
      next: "Do not expose CDP control to remote hosts; tunnel it to loopback if needed."
    });
  }
  if (url.username || url.password) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must not include URL credentials"
    });
  }
  if (url.search || url.hash) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must not include query or hash"
    });
  }
  if (url.pathname && url.pathname !== "/") {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpBaseUrl",
      message: "must not include a path",
      next: "Use the CDP discovery origin, for example http://127.0.0.1:9222."
    });
  }
}

function validateBrowserTaskAllowedDomain(value: string, path: string, items: ConfigValidationItem[]): void {
  const domain = value.trim().toLowerCase().replace(/\.$/u, "");
  if (!domain || domain.length > 253 || domain.includes("/") || domain.includes(":") || domain.includes("@")) {
    items.push({
      severity: "fail",
      path,
      message: `invalid browser task allowed domain: ${value}`,
      next: "Use hostnames such as example.com, not URLs, credentials, paths, ports, or localhost."
    });
    return;
  }
  if (isUnsafeBrowserTaskHost(domain)) {
    items.push({
      severity: "fail",
      path,
      message: `browser task allowed domain must be public: ${value}`,
      next: "Browser tasks must not be allowed to target localhost, private networks, .local, or internal-only hosts."
    });
  }
}

function isUnsafeBrowserTaskHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/\.$/u, "");
  if (!value || value === "localhost" || value.endsWith(".local") || value.endsWith(".lan") || value.endsWith(".internal")) return true;
  if (!value.includes(".")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function validateTickSection(path: "scheduler" | "jobs", value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, path, items)) return;
  requireBoolean(value, `${path}.enabled`, items);
  requireString(value, `${path}.dir`, items);
  requirePositiveInteger(value, `${path}.tickMs`, items);
}

function validateJobs(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "jobs", items)) return;
  requireBoolean(value, "jobs.enabled", items);
  requireString(value, "jobs.dir", items);
  requirePositiveInteger(value, "jobs.tickMs", items);
  const concurrency = requirePositiveInteger(value, "jobs.concurrency", items);
  if (concurrency !== undefined && concurrency > MAX_JOB_CONCURRENCY) {
    items.push({
      severity: "fail",
      path: "jobs.concurrency",
      message: `must be at most ${MAX_JOB_CONCURRENCY}`,
      next: "Use a small bounded value because each lane can launch a local provider CLI process."
    });
  }
}

function validateWebDashboard(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "webDashboard", items)) return;
  requireBoolean(value, "webDashboard.enabled", items);
  const host = requireString(value, "webDashboard.host", items);
  const port = requirePositiveInteger(value, "webDashboard.port", items);
  requireString(value, "webDashboard.canvasDir", items);
  const allowRemote = requireBoolean(value, "webDashboard.allowRemote", items);
  requireString(value, "webDashboard.authTokenEnv", items);
  if (value.authToken !== undefined) requireString(value, "webDashboard.authToken", items);

  if (host && !LOCAL_WEB_DASHBOARD_HOSTS.has(host) && allowRemote !== true) {
    items.push({
      severity: "fail",
      path: "webDashboard.host",
      message: "must be 127.0.0.1, localhost, or ::1 unless webDashboard.allowRemote=true",
      next: "Keep the dashboard on localhost by default; only set allowRemote=true with a strong auth token and a trusted tunnel/reverse proxy."
    });
  }

  if (port !== undefined && port > 65_535) {
    items.push({
      severity: "fail",
      path: "webDashboard.port",
      message: "must be at most 65535"
    });
  }
}

function validateAccess(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "access", items)) return;
  requireBoolean(value, "access.enabled", items);
  requireString(value, "access.dir", items);
  const policy = requireString(value, "access.defaultPolicy", items);
  if (policy && !ACCESS_POLICIES.has(policy)) {
    items.push({
      severity: "fail",
      path: "access.defaultPolicy",
      message: `must be one of ${[...ACCESS_POLICIES].join(", ")}`
    });
  }
  requirePositiveInteger(value, "access.pairingCodeTtlMs", items);
}

function validateActions(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "actions", items)) return;
  requireBoolean(value, "actions.enabled", items);
  requireString(value, "actions.dir", items);
  const roots = requireStringArray(value, "actions.allowedWriteRoots", items);
  if (roots && roots.length === 0) {
    items.push({ severity: "fail", path: "actions.allowedWriteRoots", message: "must contain at least one write root when actions are enabled" });
  }
  requirePositiveInteger(value, "actions.maxWriteBytes", items);
  requireBoolean(value, "actions.createBackups", items);
  validateBrowserTaskAction(value.browserTask, items);
}

function validateBrowserTaskAction(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "actions.browserTask", items)) return;
  requireBoolean(value, "actions.browserTask.enabled", items);
  const provider = requireString(value, "actions.browserTask.provider", items);
  const baseUrl = requireString(value, "actions.browserTask.browserUseBaseUrl", items);
  requireString(value, "actions.browserTask.browserUseApiKeyEnv", items);
  optionalString(value, "actions.browserTask.browserUseApiKey", items);
  const browserbaseBaseUrl = requireString(value, "actions.browserTask.browserbaseBaseUrl", items);
  requireString(value, "actions.browserTask.browserbaseApiKeyEnv", items);
  optionalString(value, "actions.browserTask.browserbaseApiKey", items);
  requireString(value, "actions.browserTask.browserbaseProjectIdEnv", items);
  optionalString(value, "actions.browserTask.browserbaseProjectId", items);
  const browserbaseSessionTimeoutSeconds = requirePositiveInteger(value, "actions.browserTask.browserbaseSessionTimeoutSeconds", items);
  requireBoolean(value, "actions.browserTask.browserbaseReleaseSession", items);
  const firecrawlBaseUrl = requireString(value, "actions.browserTask.firecrawlBaseUrl", items);
  requireString(value, "actions.browserTask.firecrawlApiKeyEnv", items);
  optionalString(value, "actions.browserTask.firecrawlApiKey", items);
  const firecrawlInteractTimeoutSeconds = requirePositiveInteger(value, "actions.browserTask.firecrawlInteractTimeoutSeconds", items);
  requireBoolean(value, "actions.browserTask.firecrawlStopSession", items);
  const firecrawlMaxResultChars = requirePositiveInteger(value, "actions.browserTask.firecrawlMaxResultChars", items);
  const localCdpBaseUrl = requireString(value, "actions.browserTask.localCdpBaseUrl", items);
  requireString(value, "actions.browserTask.localCdpBaseUrlEnv", items);
  const localCdpWaitMs = requirePositiveInteger(value, "actions.browserTask.localCdpWaitMs", items);
  const localCdpMaxContentChars = requirePositiveInteger(value, "actions.browserTask.localCdpMaxContentChars", items);
  requireBoolean(value, "actions.browserTask.localCdpCloseTab", items);
  const maxTaskChars = requirePositiveInteger(value, "actions.browserTask.maxTaskChars", items);
  const maxAgentSteps = requirePositiveInteger(value, "actions.browserTask.maxAgentSteps", items);
  const allowedDomains = requireStringArray(value, "actions.browserTask.allowedDomains", items);
  const timeoutMs = requirePositiveInteger(value, "actions.browserTask.timeoutMs", items);

  if (provider && provider !== "browser-use-cloud" && provider !== "local-cdp" && provider !== "browserbase-session" && provider !== "firecrawl-interact") {
    items.push({
      severity: "fail",
      path: "actions.browserTask.provider",
      message: "must be browser-use-cloud, local-cdp, browserbase-session, or firecrawl-interact",
      next: "Use Browser Use Cloud, Browserbase Sessions, Firecrawl Interact, or a localhost Chrome DevTools Protocol endpoint for approval-gated browser automation tasks."
    });
  }
  if (baseUrl) validateBrowserUseBaseUrl(baseUrl, items);
  if (browserbaseBaseUrl) validateHttpsApiBaseUrl(browserbaseBaseUrl, "actions.browserTask.browserbaseBaseUrl", "Browserbase session API credentials must only be sent to a TLS endpoint.", items);
  if (firecrawlBaseUrl) validateHttpsApiBaseUrl(firecrawlBaseUrl, "actions.browserTask.firecrawlBaseUrl", "Firecrawl browser-task credentials must only be sent to a TLS endpoint.", items);
  if (localCdpBaseUrl) validateLocalCdpBaseUrl(localCdpBaseUrl, items);
  if (maxTaskChars !== undefined && maxTaskChars > 50_000) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.maxTaskChars",
      message: "must be at most 50000",
      next: "Browser Use task prompts are bounded by the upstream API and should stay reviewable before approval."
    });
  }
  if (localCdpWaitMs !== undefined && localCdpWaitMs > 30_000) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpWaitMs",
      message: "must be at most 30000",
      next: "Keep local CDP page-load waits bounded so approval execution cannot hang forever."
    });
  }
  if (localCdpMaxContentChars !== undefined && localCdpMaxContentChars > 50_000) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.localCdpMaxContentChars",
      message: "must be at most 50000",
      next: "Keep local browser snapshots bounded before handing them back to Viser."
    });
  }
  if (browserbaseSessionTimeoutSeconds !== undefined && (browserbaseSessionTimeoutSeconds < 60 || browserbaseSessionTimeoutSeconds > 21_600)) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.browserbaseSessionTimeoutSeconds",
      message: "must be between 60 and 21600",
      next: "Browserbase sessions should use the provider-supported timeout range and stay bounded to avoid unnecessary usage charges."
    });
  }
  if (firecrawlInteractTimeoutSeconds !== undefined && firecrawlInteractTimeoutSeconds > 300) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.firecrawlInteractTimeoutSeconds",
      message: "must be at most 300",
      next: "Firecrawl interact execution should stay bounded before returning browser task output."
    });
  }
  if (firecrawlMaxResultChars !== undefined && firecrawlMaxResultChars > 50_000) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.firecrawlMaxResultChars",
      message: "must be at most 50000",
      next: "Keep Firecrawl interact output bounded before handing it back to Viser."
    });
  }
  if (maxAgentSteps !== undefined && maxAgentSteps > 300) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.maxAgentSteps",
      message: "must be at most 300",
      next: "Keep cloud browser automation bounded so approvals cannot run unbounded web workflows."
    });
  }
  if (timeoutMs !== undefined && timeoutMs > 120_000) {
    items.push({
      severity: "fail",
      path: "actions.browserTask.timeoutMs",
      message: "must be at most 120000",
      next: "Keep Browser Use task creation bounded so approval execution cannot hang forever."
    });
  }
  for (const domain of allowedDomains ?? []) {
    validateBrowserTaskAllowedDomain(domain, "actions.browserTask.allowedDomains", items);
  }
}

function validateConnectors(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors", items)) return;
  validateTelegram(value.telegram, items);
  validateDiscord(value.discord, items);
  validateSlack(value.slack, items);
  validateMatrix(value.matrix, items);
  validateSignal(value.signal, items);
  validateImessage(value.imessage, items);
  validateWhatsapp(value.whatsapp, items);
  validateLine(value.line, items);
  validateKakaotalk(value.kakaotalk, items);
  validateWebhookSender(value.googleChat, "connectors.googleChat", "Google Chat", items);
  validateWebhookSender(value.webhook, "connectors.webhook", "generic HTTPS webhook", items);
  validateHomeAssistant(value.homeAssistant, items);
  validateWebhookSender(value.teams, "connectors.teams", "Microsoft Teams", items);
  validateWebhookSender(value.mattermost, "connectors.mattermost", "Mattermost", items);
  validateWebhookSender(value.synologyChat, "connectors.synologyChat", "Synology Chat", items);
  validateWebhookSender(value.rocketChat, "connectors.rocketChat", "Rocket.Chat", items);
  validateWebhookSender(value.feishu, "connectors.feishu", "Feishu", items);
  validateWebhookSender(value.dingtalk, "connectors.dingtalk", "DingTalk", items);
  validateWebhookSender(value.wecom, "connectors.wecom", "WeCom", items);
  validateZalo(value.zalo, items);
  validateIrc(value.irc, items);
  validateTwitch(value.twitch, items);
  validateNtfy(value.ntfy, items);
  validateMastodon(value.mastodon, items);
  validateNextcloudTalk(value.nextcloudTalk, items);
  validateWebex(value.webex, items);
  validateZulip(value.zulip, items);
  validateEmail(value.email, items);
  validateGitHub(value.github, items);
  validateTodoist(value.todoist, items);
  validateNotion(value.notion, items);
  validateObsidian(value.obsidian, items);
}

function validateTelegram(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.telegram", items)) return;
  requireBoolean(value, "connectors.telegram.enabled", items);
  requireString(value, "connectors.telegram.botTokenEnv", items);
  optionalString(value, "connectors.telegram.botToken", items);
  requireStringArray(value, "connectors.telegram.allowedChatIds", items);
  requireStringArray(value, "connectors.telegram.defaultChatIds", items);
  validateConnectorRateLimit(value, "connectors.telegram.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.telegram.maxInputChars", items);
}

function validateDiscord(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.discord", items)) return;
  requireBoolean(value, "connectors.discord.enabled", items);
  requireString(value, "connectors.discord.botTokenEnv", items);
  optionalString(value, "connectors.discord.botToken", items);
  requireString(value, "connectors.discord.prefix", items);
  requireStringArray(value, "connectors.discord.allowedChannelIds", items);
  requireStringArray(value, "connectors.discord.defaultChannelIds", items);
  validateConnectorRateLimit(value, "connectors.discord.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.discord.maxInputChars", items);
}

function validateSlack(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.slack", items)) return;
  requireBoolean(value, "connectors.slack.enabled", items);
  requireString(value, "connectors.slack.botTokenEnv", items);
  optionalString(value, "connectors.slack.botToken", items);
  requireString(value, "connectors.slack.appTokenEnv", items);
  optionalString(value, "connectors.slack.appToken", items);
  requireString(value, "connectors.slack.botUserIdEnv", items);
  optionalString(value, "connectors.slack.botUserId", items);
  requireString(value, "connectors.slack.prefix", items);
  requireStringArray(value, "connectors.slack.allowedChannelIds", items);
  requireStringArray(value, "connectors.slack.defaultChannelIds", items);
  validateConnectorRateLimit(value, "connectors.slack.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.slack.maxInputChars", items);
}

function validateMatrix(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.matrix", items)) return;
  requireBoolean(value, "connectors.matrix.enabled", items);
  requireString(value, "connectors.matrix.homeserverUrlEnv", items);
  optionalString(value, "connectors.matrix.homeserverUrl", items);
  requireString(value, "connectors.matrix.accessTokenEnv", items);
  optionalString(value, "connectors.matrix.accessToken", items);
  requireString(value, "connectors.matrix.userIdEnv", items);
  optionalString(value, "connectors.matrix.userId", items);
  requireString(value, "connectors.matrix.prefix", items);
  requireStringArray(value, "connectors.matrix.allowedRoomIds", items);
  requireStringArray(value, "connectors.matrix.defaultRoomIds", items);
  validateConnectorRateLimit(value, "connectors.matrix.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.matrix.maxInputChars", items);
  const pollTimeoutMs = requirePositiveInteger(value, "connectors.matrix.pollTimeoutMs", items);
  if (pollTimeoutMs !== undefined && pollTimeoutMs > 120_000) {
    items.push({
      severity: "fail",
      path: "connectors.matrix.pollTimeoutMs",
      message: "must be at most 120000",
      next: "Keep Matrix long-poll cycles bounded so foreground shutdown remains responsive."
    });
  }
}

function validateSignal(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.signal", items)) return;
  requireBoolean(value, "connectors.signal.enabled", items);
  requireString(value, "connectors.signal.commandEnv", items);
  requireString(value, "connectors.signal.command", items);
  requireString(value, "connectors.signal.accountEnv", items);
  optionalString(value, "connectors.signal.account", items);
  requireStringArray(value, "connectors.signal.allowedRecipientIds", items);
  requireStringArray(value, "connectors.signal.defaultRecipientIds", items);
  validateConnectorRateLimit(value, "connectors.signal.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.signal.maxInputChars", items);
  validateBoundedConnectorMs(value, "connectors.signal.pollIntervalMs", 60_000, "Keep Signal polling responsive in the foreground process.", items);
  validateBoundedConnectorMs(value, "connectors.signal.receiveTimeoutMs", 120_000, "Keep signal-cli receive calls bounded so foreground shutdown remains responsive.", items);
  validateBoundedConnectorMs(value, "connectors.signal.sendTimeoutMs", 120_000, "Keep signal-cli send calls bounded so outbound approvals cannot hang forever.", items);
}

function validateImessage(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.imessage", items)) return;
  requireBoolean(value, "connectors.imessage.enabled", items);
  requireString(value, "connectors.imessage.sqliteCommandEnv", items);
  requireString(value, "connectors.imessage.sqliteCommand", items);
  requireString(value, "connectors.imessage.osascriptCommandEnv", items);
  requireString(value, "connectors.imessage.osascriptCommand", items);
  requireString(value, "connectors.imessage.chatDbPathEnv", items);
  requireString(value, "connectors.imessage.chatDbPath", items);
  requireStringArray(value, "connectors.imessage.allowedHandleIds", items);
  requireStringArray(value, "connectors.imessage.defaultHandleIds", items);
  validateConnectorRateLimit(value, "connectors.imessage.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.imessage.maxInputChars", items);
  validateBoundedConnectorMs(value, "connectors.imessage.pollIntervalMs", 60_000, "Keep iMessage polling responsive in the foreground process.", items);
  validateBoundedConnectorMs(value, "connectors.imessage.queryTimeoutMs", 120_000, "Keep local Messages database reads bounded so foreground shutdown remains responsive.", items);
  validateBoundedConnectorMs(value, "connectors.imessage.sendTimeoutMs", 120_000, "Keep osascript sends bounded so outbound approvals cannot hang forever.", items);
}

function validateWhatsapp(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.whatsapp", items)) return;
  requireBoolean(value, "connectors.whatsapp.enabled", items);
  requireString(value, "connectors.whatsapp.accessTokenEnv", items);
  optionalString(value, "connectors.whatsapp.accessToken", items);
  requireString(value, "connectors.whatsapp.phoneNumberIdEnv", items);
  optionalString(value, "connectors.whatsapp.phoneNumberId", items);
  requireString(value, "connectors.whatsapp.verifyTokenEnv", items);
  optionalString(value, "connectors.whatsapp.verifyToken", items);
  requireString(value, "connectors.whatsapp.graphApiVersionEnv", items);
  requireString(value, "connectors.whatsapp.graphApiVersion", items);
  requireString(value, "connectors.whatsapp.webhookHost", items);
  const webhookPort = requirePositiveInteger(value, "connectors.whatsapp.webhookPort", items);
  if (webhookPort !== undefined && webhookPort > 65_535) {
    items.push({
      severity: "fail",
      path: "connectors.whatsapp.webhookPort",
      message: "must be at most 65535",
      next: "Use a valid local TCP port for the foreground WhatsApp webhook bridge."
    });
  }
  const webhookPath = requireString(value, "connectors.whatsapp.webhookPath", items);
  if (webhookPath && !webhookPath.startsWith("/")) {
    items.push({
      severity: "fail",
      path: "connectors.whatsapp.webhookPath",
      message: "must start with /",
      next: "Use a URL path such as /whatsapp/webhook for Meta webhook callbacks."
    });
  }
  requireStringArray(value, "connectors.whatsapp.allowedRecipientIds", items);
  requireStringArray(value, "connectors.whatsapp.defaultRecipientIds", items);
  validateConnectorRateLimit(value, "connectors.whatsapp.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.whatsapp.maxInputChars", items);
  validateBoundedConnectorMs(value, "connectors.whatsapp.sendTimeoutMs", 120_000, "Keep WhatsApp Graph API sends bounded so outbound approvals cannot hang forever.", items);
}

function validateLine(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.line", items)) return;
  requireBoolean(value, "connectors.line.enabled", items);
  requireString(value, "connectors.line.channelAccessTokenEnv", items);
  optionalString(value, "connectors.line.channelAccessToken", items);
  requireString(value, "connectors.line.channelSecretEnv", items);
  optionalString(value, "connectors.line.channelSecret", items);
  requireString(value, "connectors.line.webhookHost", items);
  const webhookPort = requirePositiveInteger(value, "connectors.line.webhookPort", items);
  if (webhookPort !== undefined && webhookPort > 65_535) {
    items.push({
      severity: "fail",
      path: "connectors.line.webhookPort",
      message: "must be at most 65535",
      next: "Use a valid local TCP port for the foreground LINE webhook bridge."
    });
  }
  const webhookPath = requireString(value, "connectors.line.webhookPath", items);
  if (webhookPath && !webhookPath.startsWith("/")) {
    items.push({
      severity: "fail",
      path: "connectors.line.webhookPath",
      message: "must start with /",
      next: "Use a URL path such as /line/webhook for LINE webhook callbacks."
    });
  }
  requireStringArray(value, "connectors.line.allowedPeerIds", items);
  requireStringArray(value, "connectors.line.defaultPeerIds", items);
  validateConnectorRateLimit(value, "connectors.line.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.line.maxInputChars", items);
  validateBoundedConnectorMs(value, "connectors.line.sendTimeoutMs", 120_000, "Keep LINE Messaging API sends bounded so outbound approvals cannot hang forever.", items);
}

function validateKakaotalk(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.kakaotalk", items)) return;
  requireBoolean(value, "connectors.kakaotalk.enabled", items);
  requireString(value, "connectors.kakaotalk.requestTokenEnv", items);
  optionalString(value, "connectors.kakaotalk.requestToken", items);
  requireString(value, "connectors.kakaotalk.webhookHost", items);
  const webhookPort = requirePositiveInteger(value, "connectors.kakaotalk.webhookPort", items);
  if (webhookPort !== undefined && webhookPort > 65_535) {
    items.push({
      severity: "fail",
      path: "connectors.kakaotalk.webhookPort",
      message: "must be at most 65535",
      next: "Use a valid local TCP port for the foreground KakaoTalk Skill webhook bridge."
    });
  }
  const webhookPath = requireString(value, "connectors.kakaotalk.webhookPath", items);
  if (webhookPath && (!webhookPath.startsWith("/") || /[?#\s\x00-\x1f\x7f]/u.test(webhookPath))) {
    items.push({
      severity: "fail",
      path: "connectors.kakaotalk.webhookPath",
      message: "must be a clean absolute URL path",
      next: "Use a path such as /kakaotalk/skill for Kakao i Open Builder Skill callbacks."
    });
  }
  requireStringArray(value, "connectors.kakaotalk.allowedUserIds", items);
  requireStringArray(value, "connectors.kakaotalk.defaultUserIds", items);
  validateConnectorRateLimit(value, "connectors.kakaotalk.maxMessagesPerMinute", items);
  validateConnectorInputLimit(value, "connectors.kakaotalk.maxInputChars", items);
}

function validateWebhookSender(value: unknown, path: string, label: string, items: ConfigValidationItem[]): void {
  if (!section(value, path, items)) return;
  requireBoolean(value, `${path}.enabled`, items);
  requireString(value, `${path}.webhookUrlEnv`, items);
  optionalString(value, `${path}.webhookUrl`, items);
  requireString(value, `${path}.webhookUrlsEnv`, items);
  validateStringRecord(getLeaf(value, `${path}.webhookUrls`), `${path}.webhookUrls`, items);
  if (path === "connectors.webhook") {
    const inboundEnabled = getLeaf(value, `${path}.inboundEnabled`);
    if (inboundEnabled !== undefined && typeof inboundEnabled !== "boolean") {
      items.push({ severity: "fail", path: `${path}.inboundEnabled`, message: "must be a boolean when present" });
    }
    optionalString(value, `${path}.inboundTokenEnv`, items);
    optionalString(value, `${path}.inboundToken`, items);
    optionalString(value, `${path}.inboundSignatureSecretEnv`, items);
    optionalString(value, `${path}.inboundSignatureSecret`, items);
    validateBoundedConnectorMs(value, `${path}.inboundSignatureToleranceMs`, 3_600_000, "Keep generic inbound webhook signature replay windows bounded.", items);
    const inboundPath = optionalString(value, `${path}.inboundPath`, items);
    if (inboundPath && (!inboundPath.startsWith("/") || /[?#\s\x00-\x1f\x7f]/u.test(inboundPath))) {
      items.push({
        severity: "fail",
        path: `${path}.inboundPath`,
        message: "must be a clean absolute URL path",
        next: "Use a path such as /webhook/viser for generic inbound webhook callbacks."
      });
    }
    optionalPositiveInteger(value, `${path}.inboundMaxInputChars`, items);
  }
  requireStringArray(value, `${path}.allowedWebhookIds`, items);
  requireStringArray(value, `${path}.defaultWebhookIds`, items);
  validateBoundedConnectorMs(value, `${path}.sendTimeoutMs`, 120_000, `Keep ${label} webhook sends bounded so outbound approvals cannot hang forever.`, items);
}

function validateWebex(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.webex", items)) return;
  requireBoolean(value, "connectors.webex.enabled", items);
  requireString(value, "connectors.webex.accessTokenEnv", items);
  optionalString(value, "connectors.webex.accessToken", items);
  requireStringArray(value, "connectors.webex.allowedRoomIds", items);
  requireStringArray(value, "connectors.webex.defaultRoomIds", items);
  validateBoundedConnectorMs(value, "connectors.webex.sendTimeoutMs", 120_000, "Keep Webex Messages API sends bounded so outbound approvals cannot hang forever.", items);
}

function validateZalo(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.zalo", items)) return;
  requireBoolean(value, "connectors.zalo.enabled", items);
  requireString(value, "connectors.zalo.accessTokenEnv", items);
  optionalString(value, "connectors.zalo.accessToken", items);
  requireString(value, "connectors.zalo.recipientEnv", items);
  optionalString(value, "connectors.zalo.recipient", items);
  requireString(value, "connectors.zalo.recipientsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.zalo.recipients"), "connectors.zalo.recipients", items);
  requireStringArray(value, "connectors.zalo.allowedRecipientIds", items);
  requireStringArray(value, "connectors.zalo.defaultRecipientIds", items);
  validateBoundedConnectorMs(value, "connectors.zalo.sendTimeoutMs", 120_000, "Keep Zalo OA API sends bounded so outbound approvals cannot hang forever.", items);
}

function validateIrc(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.irc", items)) return;
  requireBoolean(value, "connectors.irc.enabled", items);
  requireString(value, "connectors.irc.hostEnv", items);
  optionalString(value, "connectors.irc.host", items);
  requireString(value, "connectors.irc.portEnv", items);
  const port = requirePositiveInteger(value, "connectors.irc.port", items);
  if (port !== undefined && port > 65_535) {
    items.push({
      severity: "fail",
      path: "connectors.irc.port",
      message: "must be a valid TCP port",
      next: "Use an IRC server port such as 6697 for TLS or 6667 for plaintext."
    });
  }
  requireString(value, "connectors.irc.tlsEnv", items);
  requireBoolean(value, "connectors.irc.tls", items);
  requireString(value, "connectors.irc.nickEnv", items);
  optionalString(value, "connectors.irc.nick", items);
  requireString(value, "connectors.irc.passwordEnv", items);
  optionalString(value, "connectors.irc.password", items);
  requireString(value, "connectors.irc.channelEnv", items);
  optionalString(value, "connectors.irc.channel", items);
  requireString(value, "connectors.irc.channelsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.irc.channels"), "connectors.irc.channels", items);
  requireStringArray(value, "connectors.irc.allowedChannelIds", items);
  requireStringArray(value, "connectors.irc.defaultChannelIds", items);
  validateBoundedConnectorMs(value, "connectors.irc.sendTimeoutMs", 120_000, "Keep IRC sends bounded so outbound approvals cannot hang forever.", items);
}

function validateTwitch(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.twitch", items)) return;
  requireBoolean(value, "connectors.twitch.enabled", items);
  requireString(value, "connectors.twitch.accessTokenEnv", items);
  optionalString(value, "connectors.twitch.accessToken", items);
  requireString(value, "connectors.twitch.botUsernameEnv", items);
  optionalString(value, "connectors.twitch.botUsername", items);
  requireString(value, "connectors.twitch.channelEnv", items);
  optionalString(value, "connectors.twitch.channel", items);
  requireString(value, "connectors.twitch.channelsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.twitch.channels"), "connectors.twitch.channels", items);
  requireStringArray(value, "connectors.twitch.allowedChannelIds", items);
  requireStringArray(value, "connectors.twitch.defaultChannelIds", items);
  validateBoundedConnectorMs(value, "connectors.twitch.sendTimeoutMs", 120_000, "Keep Twitch IRC sends bounded so outbound approvals cannot hang forever.", items);
}

function validateNtfy(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.ntfy", items)) return;
  requireBoolean(value, "connectors.ntfy.enabled", items);
  requireString(value, "connectors.ntfy.baseUrlEnv", items);
  requireString(value, "connectors.ntfy.baseUrl", items);
  requireString(value, "connectors.ntfy.tokenEnv", items);
  optionalString(value, "connectors.ntfy.token", items);
  requireString(value, "connectors.ntfy.topicEnv", items);
  optionalString(value, "connectors.ntfy.topic", items);
  requireString(value, "connectors.ntfy.topicsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.ntfy.topics"), "connectors.ntfy.topics", items);
  requireStringArray(value, "connectors.ntfy.allowedTopicIds", items);
  requireStringArray(value, "connectors.ntfy.defaultTopicIds", items);
  validateBoundedConnectorMs(value, "connectors.ntfy.sendTimeoutMs", 120_000, "Keep ntfy push publishes bounded so outbound approvals cannot hang forever.", items);
}

function validateMastodon(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.mastodon", items)) return;
  requireBoolean(value, "connectors.mastodon.enabled", items);
  requireString(value, "connectors.mastodon.baseUrlEnv", items);
  optionalString(value, "connectors.mastodon.baseUrl", items);
  requireString(value, "connectors.mastodon.accessTokenEnv", items);
  optionalString(value, "connectors.mastodon.accessToken", items);
  requireString(value, "connectors.mastodon.visibilityEnv", items);
  requireString(value, "connectors.mastodon.visibility", items);
  requireString(value, "connectors.mastodon.targetsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.mastodon.targets"), "connectors.mastodon.targets", items);
  requireStringArray(value, "connectors.mastodon.allowedTargetIds", items);
  requireStringArray(value, "connectors.mastodon.defaultTargetIds", items);
  validateBoundedConnectorMs(value, "connectors.mastodon.sendTimeoutMs", 120_000, "Keep Mastodon status publishes bounded so outbound approvals cannot hang forever.", items);
}

function validateNextcloudTalk(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.nextcloudTalk", items)) return;
  requireBoolean(value, "connectors.nextcloudTalk.enabled", items);
  requireString(value, "connectors.nextcloudTalk.baseUrlEnv", items);
  optionalString(value, "connectors.nextcloudTalk.baseUrl", items);
  requireString(value, "connectors.nextcloudTalk.usernameEnv", items);
  optionalString(value, "connectors.nextcloudTalk.username", items);
  requireString(value, "connectors.nextcloudTalk.appPasswordEnv", items);
  optionalString(value, "connectors.nextcloudTalk.appPassword", items);
  requireString(value, "connectors.nextcloudTalk.roomTokenEnv", items);
  optionalString(value, "connectors.nextcloudTalk.roomToken", items);
  requireString(value, "connectors.nextcloudTalk.roomsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.nextcloudTalk.rooms"), "connectors.nextcloudTalk.rooms", items);
  requireStringArray(value, "connectors.nextcloudTalk.allowedRoomIds", items);
  requireStringArray(value, "connectors.nextcloudTalk.defaultRoomIds", items);
  validateBoundedConnectorMs(value, "connectors.nextcloudTalk.sendTimeoutMs", 120_000, "Keep Nextcloud Talk OCS sends bounded so outbound approvals cannot hang forever.", items);
}

function validateZulip(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.zulip", items)) return;
  requireBoolean(value, "connectors.zulip.enabled", items);
  requireString(value, "connectors.zulip.siteUrlEnv", items);
  optionalString(value, "connectors.zulip.siteUrl", items);
  requireString(value, "connectors.zulip.botEmailEnv", items);
  optionalString(value, "connectors.zulip.botEmail", items);
  requireString(value, "connectors.zulip.apiKeyEnv", items);
  optionalString(value, "connectors.zulip.apiKey", items);
  requireString(value, "connectors.zulip.targetEnv", items);
  optionalString(value, "connectors.zulip.target", items);
  requireString(value, "connectors.zulip.targetsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.zulip.targets"), "connectors.zulip.targets", items);
  requireStringArray(value, "connectors.zulip.allowedTargetIds", items);
  requireStringArray(value, "connectors.zulip.defaultTargetIds", items);
  validateBoundedConnectorMs(value, "connectors.zulip.sendTimeoutMs", 120_000, "Keep Zulip Messages API sends bounded so outbound approvals cannot hang forever.", items);
}

function validateEmail(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.email", items)) return;
  requireBoolean(value, "connectors.email.enabled", items);
  requireString(value, "connectors.email.sendmailCommandEnv", items);
  requireString(value, "connectors.email.sendmailCommand", items);
  requireString(value, "connectors.email.fromEnv", items);
  optionalString(value, "connectors.email.from", items);
  requireString(value, "connectors.email.recipientEnv", items);
  optionalString(value, "connectors.email.recipient", items);
  requireString(value, "connectors.email.recipientsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.email.recipients"), "connectors.email.recipients", items);
  requireStringArray(value, "connectors.email.allowedRecipientIds", items);
  requireStringArray(value, "connectors.email.defaultRecipientIds", items);
  validateBoundedConnectorMs(value, "connectors.email.sendTimeoutMs", 120_000, "Keep local sendmail sends bounded so outbound approvals cannot hang forever.", items);
}

function validateGitHub(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.github", items)) return;
  requireBoolean(value, "connectors.github.enabled", items);
  requireString(value, "connectors.github.tokenEnv", items);
  optionalString(value, "connectors.github.token", items);
  requireString(value, "connectors.github.targetEnv", items);
  optionalString(value, "connectors.github.target", items);
  requireString(value, "connectors.github.targetsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.github.targets"), "connectors.github.targets", items);
  requireStringArray(value, "connectors.github.allowedTargetIds", items);
  requireStringArray(value, "connectors.github.defaultTargetIds", items);
  validateBoundedConnectorMs(value, "connectors.github.sendTimeoutMs", 120_000, "Keep GitHub issue/PR comment sends bounded so outbound approvals cannot hang forever.", items);
}

function validateTodoist(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.todoist", items)) return;
  requireBoolean(value, "connectors.todoist.enabled", items);
  requireString(value, "connectors.todoist.tokenEnv", items);
  optionalString(value, "connectors.todoist.token", items);
  requireString(value, "connectors.todoist.projectEnv", items);
  optionalString(value, "connectors.todoist.project", items);
  requireString(value, "connectors.todoist.projectsEnv", items);
  validateStringRecord(getLeaf(value, "connectors.todoist.projects"), "connectors.todoist.projects", items);
  requireStringArray(value, "connectors.todoist.allowedProjectIds", items);
  requireStringArray(value, "connectors.todoist.defaultProjectIds", items);
  validateBoundedConnectorMs(value, "connectors.todoist.sendTimeoutMs", 120_000, "Keep Todoist task creation bounded so outbound approvals cannot hang forever.", items);
}

function validateNotion(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.notion", items)) return;
  requireBoolean(value, "connectors.notion.enabled", items);
  requireString(value, "connectors.notion.tokenEnv", items);
  optionalString(value, "connectors.notion.token", items);
  requireString(value, "connectors.notion.pageEnv", items);
  optionalString(value, "connectors.notion.page", items);
  requireString(value, "connectors.notion.pagesEnv", items);
  validateStringRecord(getLeaf(value, "connectors.notion.pages"), "connectors.notion.pages", items);
  requireStringArray(value, "connectors.notion.allowedPageIds", items);
  requireStringArray(value, "connectors.notion.defaultPageIds", items);
  validateBoundedConnectorMs(value, "connectors.notion.sendTimeoutMs", 120_000, "Keep Notion page appends bounded so outbound approvals cannot hang forever.", items);
}

function validateObsidian(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.obsidian", items)) return;
  requireBoolean(value, "connectors.obsidian.enabled", items);
  requireString(value, "connectors.obsidian.vaultDirEnv", items);
  optionalString(value, "connectors.obsidian.vaultDir", items);
  requireString(value, "connectors.obsidian.noteEnv", items);
  optionalString(value, "connectors.obsidian.note", items);
  requireString(value, "connectors.obsidian.notesEnv", items);
  validateStringRecord(getLeaf(value, "connectors.obsidian.notes"), "connectors.obsidian.notes", items);
  requireStringArray(value, "connectors.obsidian.allowedNoteIds", items);
  requireStringArray(value, "connectors.obsidian.defaultNoteIds", items);
  validateConnectorInputLimit(value, "connectors.obsidian.maxMessageChars", items);
}

function validateHomeAssistant(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors.homeAssistant", items)) return;
  requireBoolean(value, "connectors.homeAssistant.enabled", items);
  requireString(value, "connectors.homeAssistant.baseUrlEnv", items);
  optionalString(value, "connectors.homeAssistant.baseUrl", items);
  requireString(value, "connectors.homeAssistant.accessTokenEnv", items);
  optionalString(value, "connectors.homeAssistant.accessToken", items);
  requireString(value, "connectors.homeAssistant.serviceEnv", items);
  optionalString(value, "connectors.homeAssistant.service", items);
  requireString(value, "connectors.homeAssistant.servicesEnv", items);
  validateStringRecord(getLeaf(value, "connectors.homeAssistant.services"), "connectors.homeAssistant.services", items);
  requireStringArray(value, "connectors.homeAssistant.allowedServiceIds", items);
  requireStringArray(value, "connectors.homeAssistant.defaultServiceIds", items);
  validateBoundedConnectorMs(value, "connectors.homeAssistant.sendTimeoutMs", 120_000, "Keep Home Assistant REST service calls bounded so outbound approvals cannot hang forever.", items);
}

function validateBoundedConnectorMs(
  value: Record<string, unknown>,
  path: string,
  maxMs: number,
  next: string,
  items: ConfigValidationItem[]
): void {
  const timeout = requirePositiveInteger(value, path, items);
  if (timeout !== undefined && timeout > maxMs) {
    items.push({
      severity: "fail",
      path,
      message: `must be at most ${maxMs}`,
      next
    });
  }
}

function validateConnectorRateLimit(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): void {
  const rateLimit = requirePositiveInteger(value, path, items);
  if (rateLimit !== undefined && rateLimit > MAX_CONNECTOR_MESSAGES_PER_MINUTE) {
    items.push({
      severity: "fail",
      path,
      message: `must be at most ${MAX_CONNECTOR_MESSAGES_PER_MINUTE}`,
      next: "Keep public messenger abuse limits bounded so one chat cannot flood provider CLI calls."
    });
  }
}

function validateConnectorInputLimit(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): void {
  const maxInputChars = requirePositiveInteger(value, path, items);
  if (maxInputChars !== undefined && maxInputChars > MAX_CONNECTOR_INPUT_CHARS) {
    items.push({
      severity: "fail",
      path,
      message: `must be at most ${MAX_CONNECTOR_INPUT_CHARS}`,
      next: "Keep public messenger inputs bounded before they are handed to a local provider CLI."
    });
  }
}

function validateProviders(value: unknown, items: ConfigValidationItem[]): void {
  if (!isPlainObject(value)) {
    items.push({ severity: "fail", path: "providers", message: "must be an object keyed by provider id" });
    return;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    items.push({ severity: "fail", path: "providers", message: "must contain at least one provider" });
    return;
  }

  for (const [providerId, provider] of entries) {
    const path = `providers.${providerId}`;
    if (!section(provider, path, items)) continue;
    const nestedId = optionalString(provider, `${path}.id`, items);
    if (nestedId && nestedId !== providerId) {
      items.push({ severity: "warn", path: `${path}.id`, message: `differs from provider key '${providerId}'; key is used as the canonical id` });
    }
    optionalString(provider, `${path}.label`, items);
    requireString(provider, `${path}.command`, items);
    const args = requireStringArray(provider, `${path}.args`, items);
    const promptMode = requireString(provider, `${path}.promptMode`, items);
    if (promptMode && !PROMPT_MODES.has(promptMode as PromptMode)) {
      items.push({ severity: "fail", path: `${path}.promptMode`, message: "must be stdin, template, or argument" });
    }
    if (promptMode === "template" && args && !args.some((arg) => arg.includes("{prompt}"))) {
      items.push({ severity: "fail", path: `${path}.args`, message: "template promptMode requires a {prompt} argument" });
    }
    requirePositiveInteger(provider, `${path}.timeoutMs`, items);
    optionalPositiveInteger(provider, `${path}.maxOutputBytes`, items);
    optionalString(provider, `${path}.cwd`, items);
    validateOptionalStringRecord(provider.env, `${path}.env`, items);
    optionalString(provider, `${path}.loginHint`, items);
  }
}

function section(value: unknown, path: string, items: ConfigValidationItem[]): value is Record<string, unknown> {
  if (isPlainObject(value)) return true;
  items.push({ severity: "fail", path, message: "must be an object" });
  return false;
}

function requireString(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): string | undefined {
  const raw = getLeaf(value, path);
  if (typeof raw === "string" && raw.trim()) return raw;
  items.push({ severity: "fail", path, message: "must be a non-empty string" });
  return undefined;
}

function optionalString(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): string | undefined {
  const raw = getLeaf(value, path);
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return raw;
  items.push({ severity: "fail", path, message: "must be a string when present" });
  return undefined;
}

function requireBoolean(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): boolean | undefined {
  const raw = getLeaf(value, path);
  if (typeof raw === "boolean") return raw;
  items.push({ severity: "fail", path, message: "must be a boolean" });
  return undefined;
}

function requirePositiveInteger(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): number | undefined {
  const raw = getLeaf(value, path);
  if (Number.isInteger(raw) && (raw as number) > 0) return raw as number;
  items.push({ severity: "fail", path, message: "must be a positive integer" });
  return undefined;
}

function optionalPositiveInteger(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): number | undefined {
  const raw = getLeaf(value, path);
  if (raw === undefined) return undefined;
  if (Number.isInteger(raw) && (raw as number) > 0) return raw as number;
  items.push({ severity: "fail", path, message: "must be a positive integer when present" });
  return undefined;
}

function requireStringArray(value: Record<string, unknown>, path: string, items: ConfigValidationItem[]): string[] | undefined {
  const raw = getLeaf(value, path);
  if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) return raw;
  items.push({ severity: "fail", path, message: "must be an array of strings" });
  return undefined;
}

function validateOptionalStringRecord(value: unknown, path: string, items: ConfigValidationItem[]): void {
  if (value === undefined) return;
  validateStringRecord(value, path, items, "must be an object of string values when present");
}

function validateStringRecord(value: unknown, path: string, items: ConfigValidationItem[], objectMessage = "must be an object of string values"): void {
  if (!isPlainObject(value)) {
    items.push({ severity: "fail", path, message: objectMessage });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      items.push({ severity: "fail", path: `${path}.${key}`, message: "must be a string" });
    }
  }
}

function getLeaf(value: Record<string, unknown>, path: string): unknown {
  const key = path.split(".").at(-1);
  return key ? value[key] : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
