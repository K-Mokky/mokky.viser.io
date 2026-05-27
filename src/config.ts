// ================================================================
// Configuration loading and defaults
// ================================================================
// Viser works out of the box with sane defaults. A local `viser.config.json`
// can override any section without needing code changes.

import { lstatSync } from "node:fs";
import { cwd, env } from "node:process";
import { resolve } from "node:path";
import { assertNoSymlinkComponentsUnderRoot, readJsonFile } from "./utils/files.ts";
import { assertValidConfig } from "./config-validation.ts";
import type { ViserConfig } from "./core/types.ts";

export const DEFAULT_CONFIG: ViserConfig = {
  assistant: {
    name: "Viser",
    defaultProvider: "codex",
    fallbackProviders: ["gemini", "claude", "gpt"],
    systemPrompt:
      "You are Viser, a local-first CLI assistant created by KMokky. Be concise, practical, and ask before destructive actions.",
    historyLimit: 12,
    maxInputChars: 12_000,
    workdir: "."
  },
  storage: {
    dir: ".viser"
  },
  memory: {
    enabled: true,
    dir: ".viser/memory",
    promptLimit: 12
  },
  skills: {
    enabled: true,
    dirs: ["skills", ".viser/skills"],
    promptLimit: 8
  },
  plugins: {
    enabled: true,
    dirs: ["plugins", ".viser/plugins"],
    promptLimit: 8
  },
  tools: {
    enabled: true,
    allowedReadRoots: ["."],
    maxReadBytes: 20_000,
    shell: {
      enabled: true,
      allowedCommands: ["pwd", "ls", "cat", "sed", "grep", "rg", "find", "wc", "git"],
      timeoutMs: 30_000
    }
  },
  scheduler: {
    enabled: true,
    dir: ".viser/scheduler",
    tickMs: 15_000
  },
  jobs: {
    enabled: true,
    dir: ".viser/jobs",
    tickMs: 15_000,
    concurrency: 1
  },
  webDashboard: {
    enabled: false,
    host: "127.0.0.1",
    port: 8787
  },
  access: {
    enabled: true,
    dir: ".viser/access",
    defaultPolicy: "pairing",
    pairingCodeTtlMs: 10 * 60 * 1000
  },
  actions: {
    enabled: true,
    dir: ".viser/actions",
    allowedWriteRoots: ["."],
    maxWriteBytes: 50_000,
    createBackups: true
  },
  connectors: {
    telegram: {
      enabled: false,
      botTokenEnv: "TELEGRAM_BOT_TOKEN",
      allowedChatIds: [],
      defaultChatIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    },
    discord: {
      enabled: false,
      botTokenEnv: "DISCORD_BOT_TOKEN",
      prefix: "!viser",
      allowedChannelIds: [],
      defaultChannelIds: [],
      maxMessagesPerMinute: 20,
      maxInputChars: 4000
    }
  },
  providers: {
    codex: {
      id: "codex",
      label: "OpenAI Codex CLI",
      command: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-"
      ],
      promptMode: "stdin",
      timeoutMs: 600_000,
      loginHint: "Run `codex login` once in your terminal, then use this provider."
    },
    gpt: {
      id: "gpt",
      label: "GPT through Codex CLI",
      command: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "-"
      ],
      promptMode: "stdin",
      timeoutMs: 600_000,
      loginHint: "Run `codex login`; this alias routes GPT-style requests through the logged-in Codex CLI."
    },
    gemini: {
      id: "gemini",
      label: "Gemini CLI",
      command: "gemini",
      args: ["--prompt", "{prompt}", "--approval-mode", "plan"],
      promptMode: "template",
      timeoutMs: 600_000,
      loginHint: "Run `gemini` interactively once and complete the browser login."
    },
    claude: {
      id: "claude",
      label: "Claude Code CLI",
      command: "claude",
      args: ["-p", "{prompt}"],
      promptMode: "template",
      timeoutMs: 600_000,
      loginHint: "Install Claude Code, then run `claude` once and complete account login."
    }
  }
};

export interface LoadConfigOptions {
  configPath?: string;
  baseDir?: string;
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ViserConfig> {
  const baseDir = options.baseDir ?? cwd();
  const configPath = findConfigPath(baseDir, options.configPath);
  if (configPath) await assertNoSymlinkComponentsUnderRoot(configPath, baseDir);
  const userConfig = configPath ? await readJsonFile<Partial<ViserConfig>>(configPath) : {};
  const merged = deepMerge(DEFAULT_CONFIG, userConfig) as ViserConfig;

  assertValidConfig(merged);

  // Environment variables are convenient for secrets and runtime switching.
  if (env.VISER_PROVIDER) merged.assistant.defaultProvider = env.VISER_PROVIDER;

  assertValidConfig(merged);

  const telegramEnvName = merged.connectors.telegram.botTokenEnv;
  const discordEnvName = merged.connectors.discord.botTokenEnv;
  if (telegramEnvName && env[telegramEnvName]) merged.connectors.telegram.botToken = env[telegramEnvName];
  if (discordEnvName && env[discordEnvName]) merged.connectors.discord.botToken = env[discordEnvName];

  assertValidConfig(merged);

  merged.assistant.workdir = resolve(baseDir, merged.assistant.workdir);
  merged.storage.dir = resolve(baseDir, merged.storage.dir);
  merged.memory.dir = resolve(baseDir, merged.memory.dir);
  merged.skills.dirs = merged.skills.dirs.map((dir) => resolve(baseDir, dir));
  merged.plugins.dirs = merged.plugins.dirs.map((dir) => resolve(baseDir, dir));
  merged.tools.allowedReadRoots = merged.tools.allowedReadRoots.map((dir) => resolve(baseDir, dir));
  merged.scheduler.dir = resolve(baseDir, merged.scheduler.dir);
  merged.jobs.dir = resolve(baseDir, merged.jobs.dir);
  merged.access.dir = resolve(baseDir, merged.access.dir);
  merged.actions.dir = resolve(baseDir, merged.actions.dir);
  merged.actions.allowedWriteRoots = merged.actions.allowedWriteRoots.map((dir) => resolve(baseDir, dir));
  merged.configPath = configPath;

  // Keep provider ids consistent even when a user omits the nested `id` field.
  for (const [id, provider] of Object.entries(merged.providers)) {
    provider.id = provider.id || id;
    if (provider.cwd) provider.cwd = resolve(baseDir, provider.cwd);
  }

  return merged;
}

export function findConfigPath(baseDir: string, explicitPath?: string): string | undefined {
  const envPath = env.VISER_CONFIG;
  if (explicitPath) return resolve(baseDir, explicitPath);
  if (envPath) return resolve(baseDir, envPath);

  const defaultPath = resolve(baseDir, "viser.config.json");
  if (pathExistsOrIsSymlink(defaultPath)) return defaultPath;

  return undefined;
}

export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) return clonePlain((override ?? base) as T);

  const output = clonePlain(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(override)) {
    const current = output[key];
    output[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : clonePlain(value);
  }

  return output as T;
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clonePlain(item)) as T;
  if (!isPlainObject(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) output[key] = clonePlain(child);
  return output as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathExistsOrIsSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
