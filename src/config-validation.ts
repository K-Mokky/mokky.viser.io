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

  if (host && !LOCAL_WEB_DASHBOARD_HOSTS.has(host)) {
    items.push({
      severity: "fail",
      path: "webDashboard.host",
      message: "must be 127.0.0.1, localhost, or ::1",
      next: "Keep the dashboard on localhost; use an explicit tunnel for remote access."
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
}

function validateConnectors(value: unknown, items: ConfigValidationItem[]): void {
  if (!section(value, "connectors", items)) return;
  validateTelegram(value.telegram, items);
  validateDiscord(value.discord, items);
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
  if (!isPlainObject(value)) {
    items.push({ severity: "fail", path, message: "must be an object of string values when present" });
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
