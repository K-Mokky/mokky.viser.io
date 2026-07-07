// ================================================================
// Security and operations audit
// ================================================================
// Readiness answers "can it run?". Audit answers "is this configuration safe
// enough to leave running?". The checks are intentionally deterministic and
// local so they can run before any provider or messenger token is available.

import { constants, readFileSync } from "node:fs";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { cwd } from "node:process";
import { homedir } from "node:os";
import { configValidationItems } from "../config-validation.ts";
import { stateHealthItems } from "./state-health.ts";
import { assertNoSymlinkComponentsUnderRoot, readJsonFile } from "../utils/files.ts";
import { parseEnvLine, readEnvFileNoFollow } from "../utils/env.ts";
import { isModelApiKeyEnvKey } from "../core/model-api-policy.ts";
import { CORE_LOCAL_CLI_ROUTES, commandBasename, configuredCoreRouteProviders } from "../core/local-cli-policy.ts";
import type { CliProviderConfig, ViserConfig } from "../core/types.ts";

export type AuditSeverity = "pass" | "warn" | "fail";

export interface AuditItem {
  severity: AuditSeverity;
  area: string;
  message: string;
  next?: string;
}

export interface AuditSummary {
  passCount: number;
  warnCount: number;
  failCount: number;
  verdict: "SAFE" | "REVIEW NEEDED" | "UNSAFE";
}

const MUTATING_SHELL_COMMANDS = new Set(["rm", "mv", "cp", "chmod", "chown", "sudo", "sh", "bash", "zsh", "python", "python3", "node", "npm", "curl"]);
const RELEASE_AUTHOR = "KMokky";
const RELEASE_ALLOWED_AUTHOR_HANDLE = "mok" + "ky";
const RELEASE_ALLOWED_AUTHOR_NAME = "Mok" + "ky";
const RELEASE_SCAN_ENTRIES = [
  ".env.example",
  ".gitignore",
  ".npmignore",
  "README.md",
  "SECURITY.md",
  "LICENSE",
  "aimake.md",
  "config",
  "package.json",
  "package-lock.json",
  "plugins",
  "skills",
  "src",
  "test",
  "tools",
  "tsconfig.json"
];
const RELEASE_SKIP_DIRS = new Set([".git", ".omx", ".viser", "node_modules"]);
const RELEASE_TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".jsonl", ".md", ".py", ".sh", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
const RELEASE_TEXT_BASENAMES = new Set(["LICENSE", ".env.example", ".gitignore", ".npmignore"]);
const RELEASE_PRIVATE_PATTERNS = [".env", ".viser", ".omx", "viser.config.json", "node_modules"];
const GENERIC_RELEASE_PATH_TOKENS = new Set([
  "app",
  "apps",
  "code",
  "dev",
  "home",
  "node_modules",
  "private",
  "project",
  "projects",
  "repo",
  "repos",
  "src",
  "test",
  "tmp",
  "users",
  "var",
  "viser",
  "work",
  "workspace"
]);
const PERSONAL_RELEASE_PATTERNS: Array<{ id: string; pattern: RegExp; next: string }> = [
  {
    id: "local-home-path",
    pattern: new RegExp(`/Users/${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
    next: "Replace local machine paths with generic fixture paths such as /Users/example or /tmp/viser-test."
  },
  {
    id: "personal-messenger-handle",
    pattern: new RegExp(`@${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
    next: "Use a generic demo handle in tests and docs."
  },
  {
    id: "personal-memory-fixture",
    pattern: new RegExp(`\\b${RELEASE_ALLOWED_AUTHOR_NAME}\\s+(?:prefers|uses)\\b`, "iu"),
    next: `Use generic user fixtures unless the line is explicit creator attribution for ${RELEASE_AUTHOR}.`
  },
  {
    id: "personal-pairing-label",
    pattern: new RegExp(`\\bpair-code\\s+telegram\\s+${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
    next: "Use a generic pairing label such as demo-user."
  }
];
const SENSITIVE_RELEASE_PATTERNS: Array<{ id: string; pattern: RegExp; next: string }> = [
  {
    id: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
    next: "Remove private key material from public files and rotate the key if it was ever committed."
  },
  {
    id: "model-api-key-literal",
    pattern: /\bsk-(?!test\b|should-not\b|example\b|redacted\b)[A-Za-z0-9_-]{20,}\b/iu,
    next: "Remove model/API keys from public files; Viser should use logged-in local provider CLIs instead."
  },
  {
    id: "github-token-literal",
    pattern: /\bgh[pousr]_(?!test\b|example\b|redacted\b)[A-Za-z0-9_]{36,}\b/iu,
    next: "Remove GitHub tokens from public files and rotate the token."
  },
  {
    id: "telegram-token-literal",
    pattern: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/u,
    next: "Remove Telegram bot tokens from public files and rotate the token."
  },
  {
    id: "discord-token-literal",
    pattern: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/u,
    next: "Remove Discord bot tokens from public files and rotate the token."
  },
  {
    id: "public-secret-env-assignment",
    pattern: /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_API_KEY|DISCORD_BOT_TOKEN|TELEGRAM_BOT_TOKEN|VISER_PROVIDER_SECRET)\s*[:=]\s*["']?(?!(?:redacted|example|demo|dummy|fake|test|placeholder|your-|secret-token|secret-value|sk-test|sk-should-not|shell-secret|tool-api-key|\[REDACTED|<|\$\{|\.\.\.)\b)[A-Za-z0-9][A-Za-z0-9._:-]{11,}/iu,
    next: "Keep real tokens and API keys in private .env files only; public examples must use placeholders."
  }
];

export function summarizeAudit(items: AuditItem[]): AuditSummary {
  const failCount = items.filter((item) => item.severity === "fail").length;
  const warnCount = items.filter((item) => item.severity === "warn").length;
  return {
    passCount: items.length - failCount - warnCount,
    warnCount,
    failCount,
    verdict: failCount > 0 ? "UNSAFE" : warnCount > 0 ? "REVIEW NEEDED" : "SAFE"
  };
}

export async function auditReport(config: ViserConfig): Promise<string> {
  const items = await auditItems(config);
  const summary = summarizeAudit(items);

  return [
    `Viser audit: ${summary.verdict}`,
    `summary: ${summary.passCount} pass, ${summary.warnCount} warn, ${summary.failCount} fail`,
    "",
    ...items.map(formatItem)
  ].join("\n");
}

export async function auditItems(config: ViserConfig): Promise<AuditItem[]> {
  const items: AuditItem[] = [];
  const configFile = await readUserConfig(config);

  auditConfigShape(config, items);
  await auditProviders(config, items);
  auditAccessAndConnectors(config, configFile, items);
  await auditEnvFile(items);
  await auditActions(config, items);
  await auditTools(config, items);
  auditStorage(config, items);
  auditScheduler(config, items);
  auditJobs(config, items);
  await auditState(config, items);
  await auditPublicRelease(items);

  return items;
}

async function auditEnvFile(items: AuditItem[]): Promise<void> {
  const configuredPath = process.env.VISER_ENV ?? ".env";
  const envPath = resolve(cwd(), configuredPath);

  try {
    await assertNoSymlinkComponentsUnderRoot(dirname(envPath), cwd());
    const info = await lstat(envPath);
    if (info.isSymbolicLink()) {
      items.push({
        severity: "fail",
        area: "env",
        message: `env file is a symlink (${displayPath(envPath)})`,
        next: "Replace it with a regular private env file; Viser intentionally refuses symlinked env files."
      });
      return;
    }
    if (!info.isFile()) {
      items.push({
        severity: "fail",
        area: "env",
        message: `env path is not a regular file (${displayPath(envPath)})`,
        next: "Use a regular private env file or remove VISER_ENV."
      });
      return;
    }

    await auditEnvModelApiKeys(envPath, items);

    const mode = info.mode & 0o777;
    if ((mode & 0o077) === 0) {
      items.push({ severity: "pass", area: "env", message: `env file permissions are private (${mode.toString(8)})` });
      return;
    }
    items.push({
      severity: "warn",
      area: "env",
      message: `env file is group/world accessible (${mode.toString(8)})`,
      next: `Run \`chmod 600 ${displayPath(envPath)}\` before storing real tokens.`
    });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      items.push({ severity: "pass", area: "env", message: `no env file found at ${displayPath(envPath)}` });
      return;
    }
    if (error instanceof Error && /symlink/i.test(error.message)) {
      items.push({
        severity: "fail",
        area: "env",
        message: `env path contains a symlink (${displayPath(envPath)})`,
        next: "Replace it with a regular private env file; Viser intentionally refuses symlinked env files."
      });
      return;
    }
    items.push({
      severity: "warn",
      area: "env",
      message: `could not inspect env file permissions (${displayPath(envPath)})`,
      next: error instanceof Error ? error.message : String(error)
    });
  }
}

async function auditEnvModelApiKeys(envPath: string, items: AuditItem[]): Promise<void> {
  try {
    const raw = await readEnvFileNoFollow(envPath);
    if (raw === undefined) {
      items.push({ severity: "warn", area: "env", message: `could not inspect env file model API key names (${displayPath(envPath)})` });
      return;
    }

    const modelApiKeyNames = [...new Set(raw
      .split("\n")
      .map((line) => parseEnvLine(line)?.[0])
      .filter((key): key is string => typeof key === "string" && isModelApiKeyEnvKey(key)))];

    if (modelApiKeyNames.length === 0) {
      items.push({ severity: "pass", area: "env", message: "env file contains no model API key variables" });
      return;
    }

    items.push({
      severity: "fail",
      area: "env",
      message: `env file contains model API key variables (${modelApiKeyNames.join(", ")})`,
      next: "Remove GPT/Claude/Gemini model API key variables. Viser uses already logged-in local CLIs; keep only messenger transport tokens in .env."
    });
  } catch (error) {
    items.push({
      severity: "warn",
      area: "env",
      message: `could not inspect env file model API key names (${displayPath(envPath)})`,
      next: error instanceof Error ? error.message : String(error)
    });
  }
}

function auditConfigShape(config: ViserConfig, items: AuditItem[]): void {
  const validation = configValidationItems(config);
  const actionable = validation.filter((item) => item.severity !== "pass");
  if (actionable.length === 0) {
    items.push({ severity: "pass", area: "config", message: "config shape is valid" });
    return;
  }

  for (const item of actionable) {
    items.push({
      severity: item.severity,
      area: "config",
      message: `${item.path}: ${item.message}`,
      next: item.next
    });
  }
}

async function auditState(config: ViserConfig, items: AuditItem[]): Promise<void> {
  const stateItems = await stateHealthItems(config);
  const broken = stateItems.filter((item) => item.status === "fail");
  const warnings = stateItems.filter((item) => item.status === "warn");
  if (broken.length === 0 && warnings.length === 0) {
    items.push({ severity: "pass", area: "state", message: "persistent state files are readable" });
    return;
  }

  for (const item of broken) {
    items.push({
      severity: "fail",
      area: "state",
      message: `${item.area}: ${item.message}`,
      next: item.next
    });
  }
  for (const item of warnings) {
    items.push({
      severity: "warn",
      area: "state",
      message: `${item.area}: ${item.message}`,
      next: item.next
    });
  }
}

async function auditProviders(config: ViserConfig, items: AuditItem[]): Promise<void> {
  const providerIds = Object.keys(config.providers);
  if (!config.providers[config.assistant.defaultProvider]) {
    items.push({
      severity: "fail",
      area: "provider",
      message: `default provider '${config.assistant.defaultProvider}' is not configured`,
      next: `Choose one of: ${providerIds.join(", ")}`
    });
  } else {
    items.push({ severity: "pass", area: "provider", message: `default provider '${config.assistant.defaultProvider}' is configured` });
  }

  for (const providerId of config.assistant.fallbackProviders) {
    items.push(config.providers[providerId]
      ? { severity: "pass", area: "provider", message: `fallback provider '${providerId}' is configured` }
      : {
          severity: "warn",
          area: "provider",
          message: `fallback provider '${providerId}' is missing`,
          next: "Remove it from assistant.fallbackProviders or add a matching provider config."
        });
  }

  auditCoreLocalCliRoutes(config, items);

  for (const provider of Object.values(config.providers)) {
    items.push(...providerShapeAudit(provider));
    const cwdItem = await providerCwdAudit(provider, config.assistant.workdir);
    if (cwdItem) items.push(cwdItem);
    const commandItem = await providerCommandAudit(provider, config.assistant.workdir);
    if (commandItem) items.push(commandItem);
  }
}

function auditCoreLocalCliRoutes(config: ViserConfig, items: AuditItem[]): void {
  for (const route of CORE_LOCAL_CLI_ROUTES) {
    const providers = configuredCoreRouteProviders(config, route);
    const wrongCommandProviders = providers.filter((provider) => commandBasename(provider.command) !== route.expectedCommand);

    if (providers.length === 0) continue;

    if (providers.length > 0 && wrongCommandProviders.length === 0) {
      items.push({
        severity: "pass",
        area: "provider",
        message: `${route.label} route uses logged-in local ${route.expectedCommand} CLI`
      });
      continue;
    }

    const found = wrongCommandProviders.map((provider) => `${provider.id} via ${commandBasename(provider.command)}`).join(", ");
    items.push({
      severity: "fail",
      area: "provider",
      message: `${route.label} route must use logged-in local ${route.expectedCommand} CLI (${found})`,
      next: `Configure ${route.ids.join(" or ")} with command '${route.expectedCommand}' instead of an HTTP/API client wrapper.`
    });
  }
}

function providerShapeAudit(provider: CliProviderConfig): AuditItem[] {
  const items: AuditItem[] = [];
  if (provider.promptMode === "template" && !provider.args.some((arg) => arg.includes("{prompt}"))) {
    items.push({
      severity: "fail",
      area: "provider",
      message: `${provider.id}: template promptMode has no {prompt} argument`,
      next: "Add {prompt} to provider.args or switch promptMode."
    });
  } else {
    items.push({ severity: "pass", area: "provider", message: `${provider.id}: prompt wiring looks valid` });
  }

  if (provider.promptMode === "stdin" && !provider.args.includes("-")) {
    items.push({
      severity: "warn",
      area: "provider",
      message: `${provider.id}: stdin promptMode has no '-' marker`,
      next: "This may be valid for some CLIs, but Codex-style providers usually need a trailing '-'."
    });
  }

  const secretEnvKeys = Object.keys(provider.env ?? {}).filter(looksSecretLike);
  if (secretEnvKeys.length > 0) {
    items.push({
      severity: "warn",
      area: "provider",
      message: `${provider.id}: provider.env contains secret-looking keys (${secretEnvKeys.join(", ")})`,
      next: "Prefer shell/.env secret injection over committed config values."
    });
  }

  const modelApiKeyEnvKeys = Object.keys(provider.env ?? {}).filter(isModelApiKeyEnvKey);
  if (modelApiKeyEnvKeys.length > 0) {
    items.push({
      severity: "fail",
      area: "provider",
      message: `${provider.id}: provider.env contains model API key variables (${modelApiKeyEnvKeys.join(", ")})`,
      next: "Remove model API key env values. Viser must call already logged-in local GPT/Gemini/Claude CLIs instead of model HTTP APIs."
    });
  }

  if (provider.timeoutMs < 5_000) {
    items.push({ severity: "warn", area: "provider", message: `${provider.id}: timeout is very short (${provider.timeoutMs}ms)` });
  }

  return items;
}

async function providerCwdAudit(provider: CliProviderConfig, projectRoot: string): Promise<AuditItem | undefined> {
  if (!provider.cwd) return undefined;

  const cwdPath = resolve(provider.cwd);
  const project = resolve(projectRoot || cwd());
  const rel = relative(project, cwdPath);
  const outsideProject = rel.startsWith("..") || isAbsolute(rel);

  try {
    if (!outsideProject) await assertNoSymlinkComponentsUnderRoot(cwdPath, project);
    const info = await lstat(cwdPath);
    if (info.isSymbolicLink()) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider cwd is a symlink (${cwdPath})`,
        next: "Use a regular directory for providers.<id>.cwd."
      };
    }
    if (!info.isDirectory()) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider cwd is not a directory (${cwdPath})`,
        next: "Point providers.<id>.cwd at an existing regular directory."
      };
    }
    if (outsideProject) {
      return {
        severity: "warn",
        area: "provider",
        message: `${provider.id}: provider cwd is outside assistant workdir (${cwdPath})`,
        next: "Use this only when the provider CLI must run from an external checkout."
      };
    }
    return { severity: "pass", area: "provider", message: `${provider.id}: provider cwd is scoped under assistant workdir` };
  } catch (error) {
    if (error instanceof Error && /symlink/i.test(error.message)) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider cwd contains a symlink component (${cwdPath})`,
        next: "Use a regular directory under the assistant workdir for providers.<id>.cwd."
      };
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider cwd does not exist (${cwdPath})`,
        next: "Create the directory or remove providers.<id>.cwd."
      };
    }
    return {
      severity: "warn",
      area: "provider",
      message: `${provider.id}: could not inspect provider cwd (${cwdPath})`,
      next: error instanceof Error ? error.message : String(error)
    };
  }
}

async function providerCommandAudit(provider: CliProviderConfig, projectRoot: string): Promise<AuditItem | undefined> {
  if (!provider.command.includes("/")) return await providerPathCommandAudit(provider, projectRoot);

  const project = resolve(projectRoot || cwd());
  const commandRoot = resolve(provider.cwd ?? project);
  const commandPath = isAbsolute(provider.command) ? resolve(provider.command) : resolve(commandRoot, provider.command);

  if (!isAbsolute(provider.command) && !isInsideOrSame(commandPath, commandRoot)) {
    return {
      severity: "fail",
      area: "provider",
      message: `${provider.id}: provider command escapes its working directory (${commandPath})`,
      next: "Keep relative providers.<id>.command paths inside providers.<id>.cwd or assistant.workdir."
    };
  }

  const nofollowRoot = isInsideOrSame(commandPath, project)
    ? project
    : provider.cwd && isInsideOrSame(commandPath, commandRoot)
      ? commandRoot
      : undefined;

  if (!nofollowRoot) {
    return {
      severity: "warn",
      area: "provider",
      message: `${provider.id}: provider command path is outside assistant workdir (${commandPath})`,
      next: "Use an external absolute command path only when it is intentionally managed outside this project."
    };
  }

  try {
    await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
    const info = await lstat(commandPath);
    if (info.isSymbolicLink()) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider command is a symlink (${commandPath})`,
        next: "Use a regular executable for providers.<id>.command."
      };
    }
    if (!info.isFile()) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider command is not a regular file (${commandPath})`,
        next: "Point providers.<id>.command at an executable file or use a PATH command name."
      };
    }
    if ((info.mode & 0o111) === 0) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider command is not executable (${commandPath})`,
        next: "Run chmod +x on the provider command or use an installed PATH command."
      };
    }
    return { severity: "pass", area: "provider", message: `${provider.id}: provider command path is a regular executable` };
  } catch (error) {
    if (error instanceof Error && /symlink/i.test(error.message)) {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider command contains a symlink component (${commandPath})`,
        next: "Use a regular executable path under assistant.workdir/providers.<id>.cwd."
      };
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        severity: "fail",
        area: "provider",
        message: `${provider.id}: provider command does not exist (${commandPath})`,
        next: "Install the provider command, fix providers.<id>.command, or use a PATH command name."
      };
    }
    return {
      severity: "warn",
      area: "provider",
      message: `${provider.id}: could not inspect provider command (${commandPath})`,
      next: error instanceof Error ? error.message : String(error)
    };
  }
}

async function providerPathCommandAudit(provider: CliProviderConfig, projectRoot: string): Promise<AuditItem | undefined> {
  const project = resolve(projectRoot || cwd());
  const commandRoot = resolve(provider.cwd ?? project);
  const pathValue = provider.env?.PATH ?? process.env.PATH ?? "";

  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const dir = isAbsolute(entry) ? resolve(entry) : resolve(commandRoot, entry);
    const commandPath = join(dir, provider.command);
    try {
      await access(commandPath, constants.X_OK);
    } catch {
      continue;
    }

    const nofollowRoot = isInsideOrSame(commandPath, project)
      ? project
      : provider.cwd && isInsideOrSame(commandPath, commandRoot)
        ? commandRoot
        : undefined;
    if (!nofollowRoot) return undefined;

    try {
      await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
      const info = await lstat(commandPath);
      if (info.isSymbolicLink()) {
        return {
          severity: "fail",
          area: "provider",
          message: `${provider.id}: provider PATH command is a symlink (${commandPath})`,
          next: "Use a regular executable in provider PATH or an external package-manager command."
        };
      }
      if (!info.isFile()) {
        return {
          severity: "fail",
          area: "provider",
          message: `${provider.id}: provider PATH command is not a regular file (${commandPath})`,
          next: "Point PATH at directories that contain regular executable files."
        };
      }
      if ((info.mode & 0o111) === 0) {
        return {
          severity: "fail",
          area: "provider",
          message: `${provider.id}: provider PATH command is not executable (${commandPath})`,
          next: "Run chmod +x on the provider command or remove it from provider PATH."
        };
      }
      return undefined;
    } catch (error) {
      if (error instanceof Error && /symlink/i.test(error.message)) {
        return {
          severity: "fail",
          area: "provider",
          message: `${provider.id}: provider PATH command contains a symlink component (${commandPath})`,
          next: "Use a regular executable path under assistant.workdir/providers.<id>.cwd or an external package-manager command."
        };
      }
      return {
        severity: "warn",
        area: "provider",
        message: `${provider.id}: could not inspect provider PATH command (${commandPath})`,
        next: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return undefined;
}

function auditAccessAndConnectors(config: ViserConfig, configFile: unknown, items: AuditItem[]): void {
  const telegramEnabled = config.connectors.telegram.enabled || Boolean(config.connectors.telegram.botToken);
  const discordEnabled = config.connectors.discord.enabled || Boolean(config.connectors.discord.botToken);
  const anyConnectorEnabled = telegramEnabled || discordEnabled;

  if (!config.access.enabled && anyConnectorEnabled) {
    items.push({
      severity: "fail",
      area: "access",
      message: "messenger connector is active while access control is disabled",
      next: "Enable access control or keep connectors disabled."
    });
  } else if (config.access.defaultPolicy === "open" && anyConnectorEnabled) {
    items.push({
      severity: "fail",
      area: "access",
      message: "access.defaultPolicy=open with an active messenger connector",
      next: "Use pairing or allowlist for public Telegram/Discord bots."
    });
  } else if (config.access.defaultPolicy === "open") {
    items.push({ severity: "warn", area: "access", message: "access.defaultPolicy=open", next: "Use pairing before enabling public connectors." });
  } else {
    items.push({ severity: "pass", area: "access", message: `access policy '${config.access.defaultPolicy}' is suitable for messenger use` });
  }

  if (config.access.pairingCodeTtlMs > 60 * 60 * 1000) {
    items.push({ severity: "warn", area: "access", message: "pairing code TTL exceeds 1 hour", next: "Short-lived pairing codes reduce takeover risk." });
  }

  if (config.connectors.discord.enabled && !config.connectors.discord.prefix.trim()) {
    items.push({ severity: "fail", area: "discord", message: "Discord prefix is empty while Discord is enabled" });
  } else {
    items.push({ severity: "pass", area: "discord", message: "Discord prefix/access shape is valid" });
  }

  if (hasPath(configFile, ["connectors", "telegram", "botToken"])) {
    items.push({
      severity: "fail",
      area: "secret",
      message: "Telegram token appears to be stored directly in viser.config.json",
      next: `Move it to ${config.connectors.telegram.botTokenEnv} or .env.`
    });
  }

  if (hasPath(configFile, ["connectors", "discord", "botToken"])) {
    items.push({
      severity: "fail",
      area: "secret",
      message: "Discord token appears to be stored directly in viser.config.json",
      next: `Move it to ${config.connectors.discord.botTokenEnv} or .env.`
    });
  }

  if (anyConnectorEnabled) {
    if (config.connectors.acknowledgeRelayToS === true) {
      items.push({ severity: "pass", area: "access", message: "messenger relay ToS/ban risk acknowledged (connectors.acknowledgeRelayToS=true)" });
    } else {
      items.push({
        severity: "warn",
        area: "access",
        message: "messenger connector relays your single-seat provider subscription to chat peers",
        next: "Relaying a personal Codex/Claude/Gemini login to other people can violate provider ToS and risk account bans; keep peers limited to yourself, then set connectors.acknowledgeRelayToS=true to acknowledge."
      });
    }
  }
}

async function auditActions(config: ViserConfig, items: AuditItem[]): Promise<void> {
  if (!config.actions.enabled) {
    items.push({ severity: "warn", area: "actions", message: "approval-gated write actions are disabled" });
    return;
  }

  items.push({ severity: "pass", area: "actions", message: "approval-gated write actions are enabled" });

  if (!config.actions.createBackups) {
    items.push({ severity: "warn", area: "actions", message: "file backups are disabled for approved writes" });
  }

  if (config.actions.maxWriteBytes > 1_000_000) {
    items.push({ severity: "warn", area: "actions", message: `maxWriteBytes is high (${config.actions.maxWriteBytes})` });
  }

  for (const root of config.actions.allowedWriteRoots) {
    items.push(writeRootAudit(root, config.assistant.workdir));
    const symlinkItem = await workspaceRootSymlinkAudit(root, config.assistant.workdir, "actions", "write root");
    if (symlinkItem) items.push(symlinkItem);
  }
}

async function auditTools(config: ViserConfig, items: AuditItem[]): Promise<void> {
  if (!config.tools.enabled) {
    items.push({ severity: "warn", area: "tools", message: "local tools are disabled" });
    return;
  }

  items.push({ severity: "pass", area: "tools", message: "local tools are enabled" });

  const dangerous = config.tools.shell.allowedCommands.filter((command) => MUTATING_SHELL_COMMANDS.has(basename(command)));
  if (dangerous.length > 0) {
    items.push({
      severity: "fail",
      area: "tools",
      message: `shell allowlist contains mutating/network-capable commands: ${dangerous.join(", ")}`,
      next: "Keep shell tools read-only; use approval-gated actions for writes."
    });
  } else {
    items.push({ severity: "pass", area: "tools", message: "shell allowlist is read-oriented" });
  }

  if (config.tools.shell.timeoutMs > 5 * 60 * 1000) {
    items.push({ severity: "warn", area: "tools", message: `shell timeout is long (${config.tools.shell.timeoutMs}ms)` });
  }

  if (config.tools.shell.enabled) {
    items.push(...await shellCommandAuditItems(config));
  }

  for (const root of config.tools.allowedReadRoots) {
    items.push(readRootAudit(root, config.assistant.workdir));
    const symlinkItem = await workspaceRootSymlinkAudit(root, config.assistant.workdir, "tools", "read root");
    if (symlinkItem) items.push(symlinkItem);
  }
}

async function shellCommandAuditItems(config: ViserConfig): Promise<AuditItem[]> {
  const items: AuditItem[] = [];
  const project = resolve(config.assistant.workdir || cwd());
  const commandRoot = resolve(config.tools.allowedReadRoots[0] ?? project);

  for (const command of config.tools.shell.allowedCommands) {
    const item = command.includes("/")
      ? await shellPathCommandAudit(command, project, commandRoot)
      : await shellPathSearchCommandAudit(command, project, commandRoot);
    if (item) items.push(item);
  }

  return items;
}

async function shellPathCommandAudit(command: string, project: string, commandRoot: string): Promise<AuditItem | undefined> {
  const commandPath = isAbsolute(command) ? resolve(command) : resolve(commandRoot, command);

  if (!isAbsolute(command) && !isInsideOrSame(commandPath, commandRoot)) {
    return {
      severity: "fail",
      area: "tools",
      message: `shell command escapes the tool read root (${commandPath})`,
      next: "Keep relative tools.shell.allowedCommands paths inside tools.allowedReadRoots[0] or use a PATH command name."
    };
  }

  const nofollowRoot = shellCommandNoFollowRoot(commandPath, project, commandRoot);
  if (!nofollowRoot) {
    return {
      severity: "warn",
      area: "tools",
      message: `shell command path is outside assistant workdir/read root (${commandPath})`,
      next: "Use an external absolute command path only when it is intentionally managed outside this project."
    };
  }

  return await inspectShellCommandPath(commandPath, nofollowRoot, "shell command");
}

async function shellPathSearchCommandAudit(command: string, project: string, commandRoot: string): Promise<AuditItem | undefined> {
  const pathValue = process.env.PATH ?? "";

  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const dir = isAbsolute(entry) ? resolve(entry) : resolve(commandRoot, entry);
    const commandPath = join(dir, command);
    try {
      await access(commandPath, constants.X_OK);
    } catch {
      continue;
    }

    const nofollowRoot = shellCommandNoFollowRoot(commandPath, project, commandRoot);
    if (!nofollowRoot) return undefined;
    return await inspectShellCommandPath(commandPath, nofollowRoot, "shell PATH command");
  }

  return undefined;
}

function shellCommandNoFollowRoot(commandPath: string, project: string, commandRoot: string): string | undefined {
  if (isInsideOrSame(commandPath, project)) return project;
  if (isInsideOrSame(commandPath, commandRoot)) return commandRoot;
  return undefined;
}

async function inspectShellCommandPath(commandPath: string, nofollowRoot: string, label: "shell command" | "shell PATH command"): Promise<AuditItem | undefined> {
  try {
    await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
    const info = await lstat(commandPath);
    if (info.isSymbolicLink()) {
      return {
        severity: "fail",
        area: "tools",
        message: `${label} is a symlink (${commandPath})`,
        next: "Use a regular executable or an external package-manager command."
      };
    }
    if (!info.isFile()) {
      return {
        severity: "fail",
        area: "tools",
        message: `${label} is not a regular file (${commandPath})`,
        next: "Point command lookup at directories that contain regular executable files."
      };
    }
    if ((info.mode & 0o111) === 0) {
      return {
        severity: "fail",
        area: "tools",
        message: `${label} is not executable (${commandPath})`,
        next: "Run chmod +x on the tool command or remove it from tools.shell.allowedCommands."
      };
    }
    return undefined;
  } catch (error) {
    if (error instanceof Error && /symlink/i.test(error.message)) {
      return {
        severity: "fail",
        area: "tools",
        message: `${label} contains a symlink component (${commandPath})`,
        next: "Use a regular executable path under assistant.workdir/tools.allowedReadRoots[0] or an external package-manager command."
      };
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        severity: "fail",
        area: "tools",
        message: `${label} does not exist (${commandPath})`,
        next: "Install the tool command, fix tools.shell.allowedCommands, or use a PATH command name."
      };
    }
    return {
      severity: "warn",
      area: "tools",
      message: `could not inspect ${label} (${commandPath})`,
      next: error instanceof Error ? error.message : String(error)
    };
  }
}

function auditStorage(config: ViserConfig, items: AuditItem[]): void {
  for (const [area, path] of [
    ["storage", config.storage.dir],
    ["memory", config.memory.dir],
    ["scheduler", config.scheduler.dir],
    ["jobs", config.jobs.dir],
    ["access", config.access.dir],
    ["actions", config.actions.dir]
  ] as const) {
    const root = resolve(path);
    const projectRoot = resolve(config.assistant.workdir || cwd());
    const rel = relative(projectRoot, root);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      items.push({
        severity: "warn",
        area,
        message: `${area} path is outside assistant workdir (${root})`,
        next: "Keep state under the project unless you intentionally centralize Viser state."
      });
    } else {
      items.push({ severity: "pass", area, message: `${area} path stays under assistant workdir` });
    }
  }
}

function auditScheduler(config: ViserConfig, items: AuditItem[]): void {
  if (!config.scheduler.enabled) {
    items.push({ severity: "warn", area: "scheduler", message: "scheduler is disabled" });
    return;
  }

  if (config.scheduler.tickMs < 1_000) {
    items.push({ severity: "fail", area: "scheduler", message: `scheduler tick is too aggressive (${config.scheduler.tickMs}ms)` });
  } else if (config.scheduler.tickMs < 5_000) {
    items.push({ severity: "warn", area: "scheduler", message: `scheduler tick is very frequent (${config.scheduler.tickMs}ms)` });
  } else {
    items.push({ severity: "pass", area: "scheduler", message: `scheduler tick is reasonable (${config.scheduler.tickMs}ms)` });
  }
}

function auditJobs(config: ViserConfig, items: AuditItem[]): void {
  if (!config.jobs.enabled) {
    items.push({ severity: "warn", area: "jobs", message: "job queue is disabled" });
    return;
  }

  if (config.jobs.tickMs < 1_000) {
    items.push({ severity: "fail", area: "jobs", message: `job worker tick is too aggressive (${config.jobs.tickMs}ms)` });
  } else if (config.jobs.tickMs < 5_000) {
    items.push({ severity: "warn", area: "jobs", message: `job worker tick is very frequent (${config.jobs.tickMs}ms)` });
  } else {
    items.push({ severity: "pass", area: "jobs", message: `job worker tick is reasonable (${config.jobs.tickMs}ms)` });
  }

  if (config.jobs.concurrency > 6) {
    items.push({ severity: "fail", area: "jobs", message: `job worker concurrency is too high (${config.jobs.concurrency})` });
  } else if (config.jobs.concurrency > 3) {
    items.push({ severity: "warn", area: "jobs", message: `job worker concurrency is high (${config.jobs.concurrency} lanes)` });
  } else {
    items.push({ severity: "pass", area: "jobs", message: `job worker concurrency is bounded (${config.jobs.concurrency} lane(s))` });
  }
}

async function auditPublicRelease(items: AuditItem[]): Promise<void> {
  await auditPackageMetadata(items);
  await auditReleaseIgnoreFiles(items);
  await auditReleaseTextLeaks(items);
}

async function auditPackageMetadata(items: AuditItem[]): Promise<void> {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(resolve(cwd(), "package.json"), "utf8")) as Record<string, unknown>;
  } catch (error) {
    items.push({
      severity: "warn",
      area: "public-release",
      message: "could not inspect package.json release metadata",
      next: error instanceof Error ? error.message : String(error)
    });
    return;
  }

  const packageProblems: string[] = [];
  if (pkg.name !== "viser") packageProblems.push("package name is not 'viser'");
  if (pkg.author !== RELEASE_AUTHOR) packageProblems.push(`author is not '${RELEASE_AUTHOR}'`);
  if (pkg.private === true) packageProblems.push("package is marked private");
  if (typeof pkg.license !== "string" || !pkg.license || pkg.license === "UNLICENSED") {
    packageProblems.push("open-source license metadata is missing");
  }

  const files = Array.isArray(pkg.files) ? pkg.files.filter((item): item is string => typeof item === "string") : [];
  const privateFileEntries = files.filter((entry) => RELEASE_PRIVATE_PATTERNS.some((pattern) => entry === pattern || entry.startsWith(`${pattern}/`)));
  if (privateFileEntries.length > 0) packageProblems.push(`package files include private entries (${privateFileEntries.join(", ")})`);

  if (packageProblems.length === 0) {
    items.push({ severity: "pass", area: "public-release", message: "package metadata is open-source ready" });
  } else {
    items.push({
      severity: "fail",
      area: "public-release",
      message: packageProblems.join("; "),
      next: "Keep Viser public metadata limited to project identity and creator attribution, with private runtime state excluded."
    });
  }
}

async function auditReleaseIgnoreFiles(items: AuditItem[]): Promise<void> {
  const gitignore = await readTextIfExists(resolve(cwd(), ".gitignore"));
  const npmignore = await readTextIfExists(resolve(cwd(), ".npmignore"));
  const missing: string[] = [];

  if (!gitignore) {
    missing.push(".gitignore");
  } else {
    for (const pattern of [".env", ".viser/", ".omx/", ".npmrc", "viser.config.json", "node_modules/"]) {
      if (!hasIgnoreLine(gitignore, pattern)) missing.push(`.gitignore:${pattern}`);
    }
  }

  if (!npmignore) {
    missing.push(".npmignore");
  } else {
    for (const pattern of [".env", ".viser/", ".omx/", ".npmrc", "viser.config.json"]) {
      if (!hasIgnoreLine(npmignore, pattern)) missing.push(`.npmignore:${pattern}`);
    }
  }

  if (missing.length === 0) {
    items.push({ severity: "pass", area: "public-release", message: "release ignore files exclude private runtime state" });
  } else {
    items.push({
      severity: "fail",
      area: "public-release",
      message: `release ignore coverage is incomplete (${missing.join(", ")})`,
      next: "Ensure GitHub/npm publication excludes .env, .viser/, .omx/, node_modules/, and local config files."
    });
  }
}

async function auditReleaseTextLeaks(items: AuditItem[]): Promise<void> {
  const leaks = await scanPublicReleaseFiles(cwd());
  if (leaks.length === 0) {
    items.push({ severity: "pass", area: "public-release", message: "public text files contain no known personal/local or token-like identifiers" });
    return;
  }

  const preview = leaks.slice(0, 5).map((leak) => `${leak.path}:${leak.line} ${leak.id}`).join("; ");
  const next = [...new Set(leaks.map((leak) => leak.next))].slice(0, 3).join(" ");
  items.push({
    severity: "fail",
    area: "public-release",
    message: `public text files contain personal/local or token-like identifiers (${preview}${leaks.length > 5 ? `; +${leaks.length - 5} more` : ""})`,
    next
  });
}

interface ReleaseLeak {
  path: string;
  line: number;
  id: string;
  next: string;
}

async function scanPublicReleaseFiles(root: string): Promise<ReleaseLeak[]> {
  const leaks: ReleaseLeak[] = [];
  const patterns = releaseLeakPatternsForRoot(root);
  for (const entry of RELEASE_SCAN_ENTRIES) {
    await scanReleasePath(resolve(root, entry), root, leaks, patterns);
  }
  return leaks;
}

export function releaseLeakPatternsForRoot(root: string, homeRoot = homedir()): Array<{ id: string; pattern: RegExp; next: string }> {
  return [...PERSONAL_RELEASE_PATTERNS, ...SENSITIVE_RELEASE_PATTERNS, ...localWorkspaceTokenPatterns(root, homeRoot)];
}

function localWorkspaceTokenPatterns(root: string, homeRoot: string): Array<{ id: string; pattern: RegExp; next: string }> {
  const resolvedRoot = resolve(root);
  const home = resolve(homeRoot);
  const rel = relative(home, resolvedRoot);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return [];

  const identity = projectPublicIdentityTokens(resolvedRoot);
  const tokens = new Set(
    rel
      .split(/[\\/]+/u)
      .map((part) => part.trim())
      .filter((part) => isSensitiveLocalPathToken(part) && !identity.has(part.toLowerCase()))
  );

  return [...tokens].map((token) => ({
    id: "local-workspace-token",
    pattern: new RegExp(`\\b${escapeRegExp(token)}\\b`, "iu"),
    next: "Replace private local workspace path fragments with generic fixture names such as demo-workspace or example-project."
  }));
}

// The project's own published identity (package name and repository owner/name)
// legitimately appears in onboarding docs, so it must not be flagged as a leaked
// private local workspace token.
function projectPublicIdentityTokens(root: string): Set<string> {
  const tokens = new Set<string>();
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      name?: unknown;
      repository?: unknown;
    };
    if (typeof pkg.name === "string" && pkg.name.trim()) tokens.add(pkg.name.trim().toLowerCase());

    const repoUrl =
      typeof pkg.repository === "string"
        ? pkg.repository
        : pkg.repository && typeof pkg.repository === "object" && typeof (pkg.repository as { url?: unknown }).url === "string"
          ? (pkg.repository as { url: string }).url
          : undefined;
    if (repoUrl) {
      const cleaned = repoUrl.replace(/\.git$/iu, "").replace(/[#?].*$/u, "");
      const segments = cleaned.split(/[\\/]+/u).map((part) => part.trim()).filter(Boolean);
      for (const segment of segments.slice(-2)) {
        const lower = segment.toLowerCase();
        if (lower && !lower.includes(":") && lower.length >= 2) tokens.add(lower);
      }
    }
  } catch {
    // No readable package.json under this root: contribute no identity allowlist.
  }
  return tokens;
}

function isSensitiveLocalPathToken(value: string): boolean {
  const lower = value.toLowerCase();
  if (value.length < 4) return false;
  if (!/[a-z]/iu.test(value)) return false;
  if (GENERIC_RELEASE_PATH_TOKENS.has(lower)) return false;
  if (lower === RELEASE_ALLOWED_AUTHOR_HANDLE.toLowerCase()) return false;
  if (lower === RELEASE_ALLOWED_AUTHOR_NAME.toLowerCase()) return false;
  if (lower === RELEASE_AUTHOR.toLowerCase()) return false;
  return true;
}

async function scanReleasePath(
  path: string,
  root: string,
  leaks: ReleaseLeak[],
  patterns: Array<{ id: string; pattern: RegExp; next: string }>
): Promise<void> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  const name = basename(path);
  if (info.isDirectory()) {
    if (RELEASE_SKIP_DIRS.has(name)) return;
    const entries = await readdir(path);
    for (const entry of entries) await scanReleasePath(join(path, entry), root, leaks, patterns);
    return;
  }

  if (info.isSymbolicLink()) {
    leaks.push({
      path: displayReleasePath(path, root),
      line: 1,
      id: "public-symlink",
      next: "Replace public release symlinks with regular files before publishing."
    });
    return;
  }

  if (!info.isFile() || !isReleaseTextFile(path)) return;
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/u);
  lines.forEach((line, index) => {
    for (const leak of patterns) {
      if (leak.pattern.test(line)) {
        leaks.push({
          path: displayReleasePath(path, root),
          line: index + 1,
          id: leak.id,
          next: leak.next
        });
      }
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isReleaseTextFile(path: string): boolean {
  const name = basename(path);
  return RELEASE_TEXT_BASENAMES.has(name) || RELEASE_TEXT_EXTENSIONS.has(extname(path));
}

function displayReleasePath(path: string, root: string): string {
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function hasIgnoreLine(content: string, pattern: string): boolean {
  return content.split(/\r?\n/u).some((line) => line.trim() === pattern);
}

function writeRootAudit(root: string, projectRoot: string): AuditItem {
  const resolved = resolve(root);
  const project = resolve(projectRoot || cwd());
  if (resolved === dirname(resolved)) {
    return { severity: "fail", area: "actions", message: "write root points at filesystem root", next: "Never allow writes to '/'." };
  }
  if (resolved === homedir()) {
    return { severity: "warn", area: "actions", message: "write root points at the home directory", next: "Prefer a project-specific write root." };
  }
  const rel = relative(project, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return {
      severity: "warn",
      area: "actions",
      message: `write root is outside assistant workdir (${resolved})`,
      next: "Use this only for intentionally managed external folders."
    };
  }
  return { severity: "pass", area: "actions", message: `write root is scoped under assistant workdir (${resolved})` };
}

function readRootAudit(root: string, projectRoot: string): AuditItem {
  const resolved = resolve(root);
  const project = resolve(projectRoot || cwd());
  if (resolved === dirname(resolved)) {
    return { severity: "fail", area: "tools", message: "read root points at filesystem root", next: "Do not expose '/' to tool reads." };
  }
  const rel = relative(project, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { severity: "warn", area: "tools", message: `read root is outside assistant workdir (${resolved})` };
  }
  return { severity: "pass", area: "tools", message: `read root is scoped under assistant workdir (${resolved})` };
}

function isInsideOrSame(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

async function workspaceRootSymlinkAudit(
  root: string,
  projectRoot: string,
  area: "actions" | "tools",
  label: "write root" | "read root"
): Promise<AuditItem | undefined> {
  const resolved = resolve(root);
  const project = resolve(projectRoot || cwd());
  const rel = relative(project, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) return undefined;

  try {
    await assertNoSymlinkComponentsUnderRoot(resolved, project);
    return undefined;
  } catch (error) {
    if (error instanceof Error && /symlink/i.test(error.message)) {
      return {
        severity: "fail",
        area,
        message: `${label} contains a symlink component (${resolved})`,
        next: `Use a regular directory under the assistant workdir for the ${label}.`
      };
    }
    return {
      severity: "warn",
      area,
      message: `could not inspect ${label} symlink safety (${resolved})`,
      next: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readUserConfig(config: ViserConfig): Promise<unknown> {
  if (!config.configPath) return undefined;
  try {
    return await readJsonFile(config.configPath);
  } catch {
    return undefined;
  }
}

function hasPath(value: unknown, path: string[]): boolean {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !(key in current)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== undefined && current !== null && current !== "";
}

function looksSecretLike(key: string): boolean {
  return /token|secret|key|password|credential/i.test(key);
}

function displayPath(path: string): string {
  const rel = relative(cwd(), path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? `./${rel}` : path;
}

function formatItem(item: AuditItem): string {
  const prefix = item.severity === "pass" ? "✅" : item.severity === "warn" ? "⚠️" : "❌";
  const next = item.next && item.severity !== "pass" ? `\n   next: ${item.next}` : "";
  return `${prefix} [${item.area}] ${item.message}${next}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
