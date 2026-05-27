// ================================================================
// Environment diagnostics
// ================================================================
// Secrets are intentionally never printed. This report explains which env file
// was considered, which keys came from the file versus the shell, and whether
// runtime-critical token variables are missing, empty, or present.

import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writePrivateFile } from "../utils/files.ts";
import type { EnvLoadResult } from "../utils/env.ts";
import type { ViserConfig } from "../core/types.ts";

export interface EnvTemplateOptions {
  outputPath?: string;
  force?: boolean;
}

export function envCheckReport(config: ViserConfig, envLoad?: EnvLoadResult): string {
  const envPath = envLoad?.path ?? process.env.VISER_ENV ?? ".env";
  const envInspection = inspectEnvFilePath(envPath);
  const envExists = envInspection.exists;
  const loaded = envLoad?.loaded ?? [];
  const skipped = envLoad?.skipped ?? [];
  const tokenKeys = [
    config.connectors.telegram.botTokenEnv,
    config.connectors.discord.botTokenEnv
  ];
  const permissionNote = envInspection.note;

  return [
    "Viser env check",
    `env file: ${envPath} (${envExists ? "found" : "not found"})`,
    `loaded from env file: ${formatKeyList(loaded)}`,
    `kept from shell/pre-existing env: ${formatKeyList(skipped)}`,
    "",
    "Recognized variables:",
    formatEnvStatus("VISER_ENV", { valueMode: "plain", envLoad }),
    formatEnvStatus("VISER_CONFIG", { valueMode: "plain", envLoad }),
    formatEnvStatus("VISER_PROVIDER", { valueMode: "plain", envLoad }),
    ...[...new Set(tokenKeys)].map((key) => formatEnvStatus(key, { valueMode: "secret", envLoad })),
    "",
    "Effective config:",
    `- config path: ${config.configPath ?? "defaults only"}`,
    `- default provider: ${config.assistant.defaultProvider}`,
    `- telegram token: ${config.connectors.telegram.botToken ? "present (redacted)" : "missing or empty"}`,
    `- discord token: ${config.connectors.discord.botToken ? "present (redacted)" : "missing or empty"}`,
    "",
    "Notes:",
    "- shell/pre-existing env values win over .env values.",
    "- empty token variables count as missing for runtime launch checks.",
    "- keep real tokens in a private .env or shell, not in viser.config.json.",
    ...(permissionNote ? [permissionNote] : []),
    "",
    "Next:",
    envExists
      ? `- edit ${shellishPath(envPath)} with real token values if you need Telegram/Discord, or run \`node src/index.ts env-init --force\` to regenerate it.`
      : "- run `node src/index.ts env-init` to create a private `.env` template, or run with `--env ./path/to.env`.",
    "- rerun `node src/index.ts env-check` to confirm variables are detected.",
    "- rerun `node src/index.ts launch-status` before gateway/service launch."
  ].join("\n");
}

export async function writeEnvTemplate(config: ViserConfig, options: EnvTemplateOptions = {}): Promise<string> {
  const target = resolve(process.cwd(), options.outputPath ?? ".env");
  const inspection = inspectEnvFilePath(target);
  if (inspection.exists && !options.force) {
    if (inspection.unsafe) {
      throw new Error(`Env template target is unsafe; refusing to treat it as an existing safe env file: ${target}${inspection.note ? ` (${inspection.note})` : ""}`);
    }
    return `.env already exists. Use --force to overwrite or --output for another file: ${target}`;
  }

  await writePrivateFile(target, envTemplate(config));
  return `Created ${target}\nNext: fill token values if needed, then run \`node src/index.ts env-check${target.endsWith("/.env") ? "" : ` --env ${shellishPath(target)}`}\`.`;
}

function envTemplate(config: ViserConfig): string {
  return [
    "# Viser runtime environment",
    "# This file is private and should stay out of git.",
    "# Viser uses logged-in local CLI providers, not model API keys.",
    `VISER_PROVIDER=${config.assistant.defaultProvider}`,
    `VISER_CONFIG=${configPathForEnv(config)}`,
    "",
    "# Optional: set this in your shell/service instead of inside this file when using a non-default env path.",
    "# VISER_ENV=./.env",
    "",
    "# Messenger bridge tokens are transport credentials only.",
    "# Leave blank if you do not use Telegram/Discord.",
    `${config.connectors.telegram.botTokenEnv}=`,
    `${config.connectors.discord.botTokenEnv}=`,
    ""
  ].join("\n");
}

function formatEnvStatus(
  key: string,
  options: { valueMode: "plain" | "secret"; envLoad?: EnvLoadResult }
): string {
  const value = process.env[key];
  const source = envSource(key, options.envLoad);
  const status = value === undefined
    ? "missing"
    : value === ""
      ? "empty"
      : options.valueMode === "secret"
        ? "present (redacted)"
        : `set (${value})`;
  return `- ${key}: ${status}${source ? ` · source=${source}` : ""}`;
}

function envSource(key: string, envLoad?: EnvLoadResult): string | undefined {
  if (envLoad?.loaded.includes(key)) return "env-file";
  if (envLoad?.skipped.includes(key)) return "shell/pre-existing";
  if (key === "VISER_ENV" && process.env.VISER_ENV) return "active";
  if (process.env[key] !== undefined) return "process";
  return undefined;
}

function formatKeyList(keys: string[]): string {
  return keys.length ? keys.join(", ") : "none";
}

interface EnvFileInspection {
  exists: boolean;
  note?: string;
  unsafe?: boolean;
}

function inspectEnvFilePath(path: string): EnvFileInspection {
  const symlinkComponent = firstSymlinkParentComponentUnderRoot(path, process.cwd());
  if (symlinkComponent) {
    return {
      exists: true,
      unsafe: true,
      note: `- env path contains a symlink component (${shellishPath(symlinkComponent)}); Viser refuses to load env files through symlinked paths.`
    };
  }

  try {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      return { exists: true, unsafe: true, note: "- env file is a symlink; Viser refuses to load symlinked env files." };
    }
    if (!info.isFile()) {
      return { exists: true, unsafe: true, note: "- env path is not a regular file; Viser only loads regular env files." };
    }
    const mode = info.mode & 0o777;
    if ((mode & 0o077) === 0) return { exists: true };
    return {
      exists: true,
      note: `- env file permissions are broad (${mode.toString(8)}); run \`chmod 600 ${shellishPath(path)}\` before storing real tokens.`
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { exists: false };
    return {
      exists: true,
      unsafe: true,
      note: `- could not inspect env file permissions (${shellishPath(path)}): ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function configPathForEnv(config: ViserConfig): string {
  const configPath = config.configPath ?? resolve(process.cwd(), "viser.config.json");
  const rel = relative(realPath(process.cwd()), join(realPath(dirname(configPath)), basename(configPath)));
  if (!rel || rel.startsWith("..")) return configPath;
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function shellishPath(path: string): string {
  const rel = relative(realPath(process.cwd()), join(realPath(dirname(path)), basename(path)));
  return !rel || rel.startsWith("..") ? path : `./${rel}`;
}

function firstSymlinkParentComponentUnderRoot(path: string, root: string): string | undefined {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  const rel = relative(absoluteRoot, absolutePath);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;

  let current = absoluteRoot;
  const parentParts = rel.split(/[\\/]/u).filter(Boolean).slice(0, -1);
  for (const part of parentParts) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) return current;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }
  return undefined;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
