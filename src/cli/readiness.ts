// ================================================================
// Readiness checklist
// ================================================================
// `doctor` explains the environment. `readiness` answers: can this config launch
// now, what is safe, and what exact step is missing?

import { AccessStore } from "../core/access.ts";
import { PluginRegistry } from "../core/plugins.ts";
import { SkillRegistry } from "../core/skills.ts";
import { validateDiscordToken, validateTelegramToken } from "../connectors/validate.ts";
import { probeCliProvider } from "../providers/health.ts";
import { commandExists } from "../utils/exec.ts";
import { ensurePrivateDir, removePrivateFileIfExists } from "../utils/files.ts";
import { isNodeVersionSupported, MIN_NODE_VERSION } from "../utils/node-version.ts";
import type { CliProviderConfig, ViserConfig } from "../core/types.ts";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export type ReadinessStatus = "pass" | "warn" | "fail";

export interface ReadinessItem {
  status: ReadinessStatus;
  area: string;
  message: string;
  next?: string;
}

export interface ReadinessOptions {
  live?: boolean;
  probeProviders?: boolean;
  probeAllProviders?: boolean;
}

export interface ReadinessSummary {
  passCount: number;
  warnCount: number;
  failCount: number;
  verdict: "READY" | "READY WITH WARNINGS" | "NOT READY";
}

export function summarizeReadiness(items: ReadinessItem[]): ReadinessSummary {
  const failCount = items.filter((item) => item.status === "fail").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  return {
    passCount: items.length - failCount - warnCount,
    warnCount,
    failCount,
    verdict: failCount > 0 ? "NOT READY" : warnCount > 0 ? "READY WITH WARNINGS" : "READY"
  };
}

export async function readinessReport(config: ViserConfig, options: ReadinessOptions = {}): Promise<string> {
  const items = await readinessItems(config, options);
  const summary = summarizeReadiness(items);

  return [
    `Viser readiness: ${summary.verdict}`,
    `summary: ${summary.passCount} pass, ${summary.warnCount} warn, ${summary.failCount} fail`,
    "",
    ...items.map(formatItem)
  ].join("\n");
}

export async function readinessItems(config: ViserConfig, options: ReadinessOptions = {}): Promise<ReadinessItem[]> {
  const items: ReadinessItem[] = [];

  const supportedNode = isNodeVersionSupported();
  items.push({
    status: supportedNode ? "pass" : "fail",
    area: "node",
    message: `Node ${process.version} ${supportedNode ? `>= ${MIN_NODE_VERSION}` : `< ${MIN_NODE_VERSION}`}`,
    next: supportedNode
      ? undefined
      : `Install Node >= ${MIN_NODE_VERSION}; Viser runs TypeScript files directly through Node native stripping.`
  });
  items.push({ status: typeof fetch === "function" ? "pass" : "fail", area: "node", message: "global fetch", next: `Use Node >= ${MIN_NODE_VERSION}; Viser targets Node native TypeScript execution.` });
  items.push({ status: typeof WebSocket === "function" ? "pass" : "fail", area: "node", message: "global WebSocket", next: `Use Node >= ${MIN_NODE_VERSION} for Discord gateway support.` });

  items.push(await writableDirItem("storage", config.storage.dir));
  if (config.memory.enabled) items.push(await writableDirItem("memory", config.memory.dir));
  if (config.scheduler.enabled) items.push(await writableDirItem("scheduler", config.scheduler.dir));
  if (config.jobs.enabled) items.push(await writableDirItem("jobs", config.jobs.dir));
  if (config.access.enabled) items.push(await writableDirItem("access", config.access.dir));
  if (config.actions.enabled) items.push(await writableDirItem("actions", config.actions.dir));

  const defaultProvider = config.providers[config.assistant.defaultProvider];
  const providerCandidateIds = assistantProviderCandidateIds(config);
  const hasRunnableProviderCandidate = providerCandidateIds.some((id) => {
    const provider = config.providers[id];
    return provider ? commandExists(provider.command, providerCommandLookupOptions(provider)) : false;
  });

  if (!defaultProvider) {
    items.push({
      status: hasRunnableProviderCandidate ? "warn" : "fail",
      area: "provider",
      message: `default provider '${config.assistant.defaultProvider}' is not configured`,
      next: hasRunnableProviderCandidate
        ? "Set assistant.defaultProvider to a configured provider, or rely on configured fallback providers."
        : "Set assistant.defaultProvider to a configured provider."
    });
  } else if (!commandExists(defaultProvider.command, providerCommandLookupOptions(defaultProvider))) {
    items.push({
      status: hasRunnableProviderCandidate ? "warn" : "fail",
      area: "provider",
      message: `default provider command '${defaultProvider.command}' is missing`,
      next: hasRunnableProviderCandidate
        ? `${defaultProvider.loginHint ?? `Install ${defaultProvider.command}.`} Fallback providers can still be tried for normal requests.`
        : defaultProvider.loginHint
    });
  } else {
    items.push({ status: "pass", area: "provider", message: `default provider '${config.assistant.defaultProvider}' command found` });
  }

  for (const provider of Object.values(config.providers)) {
    if (provider.id === config.assistant.defaultProvider) continue;
    const exists = commandExists(provider.command, providerCommandLookupOptions(provider));
    const isFallbackProvider = config.assistant.fallbackProviders.includes(provider.id);
    const missingMessage = isFallbackProvider
      ? `${provider.id}: ${provider.command} missing`
      : `${provider.id}: ${provider.command} missing (not in default/fallback path)`;
    items.push({
      status: exists || !isFallbackProvider ? "pass" : "warn",
      area: "provider",
      message: exists ? `${provider.id}: ${provider.command} found` : missingMessage,
      next: exists ? undefined : missingOptionalProviderNext(provider, isFallbackProvider)
    });
  }

  items.push(...await providerProbeItems(config, options, providerCandidateIds));

  const skills = config.skills.enabled ? await new SkillRegistry(config.skills.dirs).list() : [];
  items.push({
    status: !config.skills.enabled ? "warn" : skills.length > 0 ? "pass" : "warn",
    area: "skills",
    message: config.skills.enabled ? `${skills.length} skills available` : "skills disabled",
    next: skills.length > 0 ? undefined : "Run `node src/index.ts setup` to install starter skills."
  });

  const plugins = config.plugins.enabled ? await new PluginRegistry(config.plugins.dirs).list() : [];
  items.push({
    status: !config.plugins.enabled ? "warn" : plugins.length > 0 ? "pass" : "warn",
    area: "plugins",
    message: config.plugins.enabled ? `${plugins.length} plugins available` : "plugins disabled",
    next: plugins.length > 0 ? undefined : "Keep bundled plugins in ./plugins or add plugin.json folders under .viser/plugins."
  });

  items.push(toolShellReadinessItem(config));

  const access = new AccessStore(config.access);
  const peers = await access.listPeers();
  items.push({
    status: !config.access.enabled ? "warn" : config.access.defaultPolicy === "open" ? "warn" : "pass",
    area: "access",
    message: config.access.enabled ? `policy=${config.access.defaultPolicy}, paired peers=${peers.length}` : "access disabled",
    next: config.access.defaultPolicy === "open" ? "Use pairing policy for public bots." : "Use `node src/index.ts pair-code telegram|discord` before live messaging."
  });

  items.push({
    status: config.scheduler.enabled ? "pass" : "warn",
    area: "scheduler",
    message: config.scheduler.enabled ? `enabled, tick=${config.scheduler.tickMs}ms` : "disabled"
  });
  items.push({
    status: config.actions.enabled ? "pass" : "warn",
    area: "actions",
    message: config.actions.enabled ? `approval-gated writes enabled (${config.actions.allowedWriteRoots.join(", ")})` : "write actions disabled"
  });

  addConnectorStaticChecks(items, "telegram", config.connectors.telegram.enabled, Boolean(config.connectors.telegram.botToken), config.connectors.telegram.botTokenEnv);
  addConnectorStaticChecks(items, "discord", config.connectors.discord.enabled, Boolean(config.connectors.discord.botToken), config.connectors.discord.botTokenEnv);

  if (options.live) {
    const telegram = await validateTelegramToken(config.connectors.telegram.botToken);
    items.push(liveConnectorItem(
      "telegram",
      telegram.ok,
      telegram.detail,
      Boolean(config.connectors.telegram.enabled),
      Boolean(config.connectors.telegram.botToken),
      config.connectors.telegram.botTokenEnv
    ));
    const discord = await validateDiscordToken(config.connectors.discord.botToken);
    items.push(liveConnectorItem(
      "discord",
      discord.ok,
      discord.detail,
      Boolean(config.connectors.discord.enabled),
      Boolean(config.connectors.discord.botToken),
      config.connectors.discord.botTokenEnv
    ));
  }

  return items;
}

async function providerProbeItems(
  config: ViserConfig,
  options: ReadinessOptions,
  providerCandidateIds: string[]
): Promise<ReadinessItem[]> {
  if (!options.probeProviders && !options.probeAllProviders) return [];

  const allMode = Boolean(options.probeAllProviders);
  const providers = allMode
    ? Object.values(config.providers)
    : config.providers[config.assistant.defaultProvider]
      ? [config.providers[config.assistant.defaultProvider]]
      : [];
  const providerAvailability = uniqueProviders(providers).map((provider) => ({
    provider,
    installed: commandExists(provider.command, providerCommandLookupOptions(provider)),
    routable: providerCandidateIds.includes(provider.id)
  }));
  const installedProviders = providerAvailability.filter((entry) => entry.installed).map((entry) => entry.provider);
  const items: ReadinessItem[] = [];

  if (installedProviders.length === 0) {
    if (allMode) {
      for (const entry of providerAvailability.filter((item) => !item.installed)) {
        items.push(missingProviderProbeItem(entry.provider, entry.routable, false));
      }
    }
    return allMode
      ? [
          ...items,
          {
            status: "fail",
            area: "provider-runtime",
            message: "no configured provider command is installed",
            next: "Install/login at least one default or fallback provider, then rerun `node src/index.ts provider-guide --probe`."
          }
        ]
      : [];
  }

  const results: Array<{ provider: CliProviderConfig; ok: boolean; detail: string; elapsedMs: number; routable: boolean }> = [];
  for (const provider of installedProviders) {
    const probe = await probeCliProvider(provider);
    results.push({
      provider,
      ok: probe.ok,
      detail: probe.detail,
      elapsedMs: probe.elapsedMs,
      routable: providerCandidateIds.includes(provider.id)
    });
  }

  const usableRoutableProviders = results
    .filter((result) => result.routable && result.ok)
    .map((result) => result.provider.id);
  const hasUsableRoutableProvider = usableRoutableProviders.length > 0;

  if (allMode) {
    for (const entry of providerAvailability.filter((item) => !item.installed)) {
      items.push(missingProviderProbeItem(entry.provider, entry.routable, hasUsableRoutableProvider));
    }
  }

  for (const result of results) {
    const status: ReadinessStatus = result.ok
      ? "pass"
      : allMode && hasUsableRoutableProvider
        ? "warn"
        : result.routable
          ? "fail"
          : "warn";

    items.push({
      status,
      area: "provider-probe",
      message: `${result.provider.id}: ${result.ok ? "responded" : "failed"} in ${result.elapsedMs}ms${result.ok ? ` (${result.detail})` : ""}${result.routable ? "" : " (not in default/fallback path)"}`,
      next: result.ok ? undefined : `${result.detail}; run \`node src/index.ts provider-guide ${result.provider.id} --probe\` for provider-specific setup.`
    });
  }

  if (allMode) {
    items.push({
      status: hasUsableRoutableProvider ? "pass" : "fail",
      area: "provider-runtime",
      message: hasUsableRoutableProvider
        ? `usable default/fallback provider(s): ${usableRoutableProviders.join(", ")}`
        : "no default/fallback provider responded successfully",
      next: hasUsableRoutableProvider
        ? undefined
        : "Fix a default/fallback provider login, or add a passing provider to assistant.fallbackProviders."
    });
  }

  return items;
}

function missingProviderProbeItem(provider: CliProviderConfig, routable: boolean, hasUsableRoutableProvider: boolean): ReadinessItem {
  const status: ReadinessStatus = hasUsableRoutableProvider
    ? "warn"
    : routable
      ? "fail"
      : "warn";

  return {
    status,
    area: "provider-probe",
    message: `${provider.id}: command '${provider.command}' missing${routable ? "" : " (not in default/fallback path)"}`,
    next: `${provider.loginHint ?? `Install ${provider.command}.`} Then run \`node src/index.ts provider-guide ${provider.id} --probe\`.`
  };
}

function assistantProviderCandidateIds(config: ViserConfig): string[] {
  return [...new Set([config.assistant.defaultProvider, ...config.assistant.fallbackProviders])];
}

function providerCommandLookupOptions(provider: CliProviderConfig): { cwd?: string; pathValue?: string } {
  return { cwd: provider.cwd, pathValue: provider.env?.PATH };
}

function missingOptionalProviderNext(provider: CliProviderConfig, isFallbackProvider: boolean): string {
  const installHint = provider.loginHint ?? `Install ${provider.command}, then rerun \`node src/index.ts readiness\`.`;
  const silenceHint = isFallbackProvider
    ? `If you do not want this fallback, remove '${provider.id}' from assistant.fallbackProviders.`
    : `If this provider is unused, remove providers.${provider.id} from config.`;
  return `${installHint} ${silenceHint}`;
}

function uniqueProviders(providers: CliProviderConfig[]): CliProviderConfig[] {
  const seen = new Set<string>();
  return providers.filter((provider) => {
    if (seen.has(provider.id)) return false;
    seen.add(provider.id);
    return true;
  });
}

function toolShellReadinessItem(config: ViserConfig): ReadinessItem {
  if (!config.tools.enabled) {
    return {
      status: "warn",
      area: "tools",
      message: "local tools disabled",
      next: "Enable tools when you want the assistant to inspect local files explicitly."
    };
  }

  if (!config.tools.shell.enabled) {
    return {
      status: "warn",
      area: "tools",
      message: "shell tool disabled",
      next: "Enable tools.shell when read-only local shell checks should be available."
    };
  }

  if (config.tools.shell.allowedCommands.length === 0) {
    return {
      status: "warn",
      area: "tools",
      message: "shell tool has no allowlisted commands",
      next: "Add read-only commands such as pwd, ls, cat, grep, rg, find, wc, or git."
    };
  }

  const commandRoot = config.tools.allowedReadRoots[0] ?? config.assistant.workdir;
  const missing = config.tools.shell.allowedCommands.filter((command) => !commandExists(command, { cwd: commandRoot }));
  if (missing.length > 0) {
    return {
      status: "warn",
      area: "tools",
      message: `shell commands missing: ${missing.join(", ")}`,
      next: "Install the missing read-only command(s), remove them from tools.shell.allowedCommands, or fix PATH before launch."
    };
  }

  return {
    status: "pass",
    area: "tools",
    message: `shell commands available (${config.tools.shell.allowedCommands.length})`
  };
}

function addConnectorStaticChecks(items: ReadinessItem[], name: string, enabled: boolean, hasToken: boolean, envName: string): void {
  if (enabled && !hasToken) {
    items.push({ status: "fail", area: name, message: "enabled but token is missing", next: `Set ${envName} or disable ${name}.` });
    return;
  }

  if (!enabled && !hasToken) {
    items.push({ status: "pass", area: name, message: "disabled (no token configured)" });
    return;
  }

  items.push({ status: "pass", area: name, message: hasToken ? "token present" : "disabled" });
}

function liveConnectorItem(
  name: string,
  ok: boolean,
  detail: string,
  enabled: boolean,
  hasToken: boolean,
  envName: string
): ReadinessItem {
  const configured = enabled || hasToken;
  if (!configured) {
    return {
      status: "pass",
      area: "live",
      message: `${name}: disabled (no token configured)`
    };
  }

  return {
    status: ok ? "pass" : configured ? "fail" : "warn",
    area: "live",
    message: `${name}: ${detail}`,
    next: ok
      ? undefined
      : hasToken
        ? `Check ${envName}; the configured token was rejected by ${name}.`
        : `Set ${envName}.`
  };
}

async function writableDirItem(area: string, dir: string): Promise<ReadinessItem> {
  const probePath = join(dir, `.viser-readiness-${randomUUID()}.tmp`);

  try {
    await ensurePrivateDir(dir);
    await writeReadinessProbeFileNoFollow(probePath);
    await removePrivateFileIfExists(probePath, { dirs: [dir] });
    return { status: "pass", area, message: `writable (${dir})` };
  } catch (error) {
    return {
      status: "fail",
      area,
      message: `not writable (${dir})`,
      next: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function writeReadinessProbeFileNoFollow(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    await handle.writeFile("ok\n", "utf8");
    await handle.chmod(0o600);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new Error(`Readiness probe path already exists; refusing to overwrite it: ${path}`);
    }
    if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
      throw new Error(`Readiness probe path is a symlink; refusing to write it: ${path}`);
    }
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function formatItem(item: ReadinessItem): string {
  const prefix = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
  const next = item.next && item.status !== "pass" ? `\n   next: ${item.next}` : "";
  return `${prefix} [${item.area}] ${item.message}${next}`;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
