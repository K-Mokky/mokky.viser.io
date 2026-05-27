// ================================================================
// Doctor checks
// ================================================================
// These checks focus on local prerequisites: Node features, provider CLIs,
// config discovery, memory/skills/tools paths, and messenger tokens.

import { commandExists } from "../utils/exec.ts";
import { nodeVersionLabel } from "../utils/node-version.ts";
import type { EnvLoadResult } from "../utils/env.ts";
import type { ViserConfig } from "../core/types.ts";

export function doctorReport(config: ViserConfig, envLoad?: EnvLoadResult): string {
  const rows: string[] = [];
  rows.push("Viser doctor");
  rows.push(`- node: ${nodeVersionLabel()}`);
  rows.push(`- fetch: ${typeof fetch === "function" ? "ok" : "missing"}`);
  rows.push(`- WebSocket: ${typeof WebSocket === "function" ? "ok" : "missing"}`);
  rows.push(`- config: ${config.configPath ?? "defaults only"}`);
  if (envLoad) {
    const status = envLoad.missing ? "missing" : "found";
    rows.push(`- env file: ${envLoad.path} (${status}; loaded ${envLoad.loaded.length}, shell/pre-existing ${envLoad.skipped.length})`);
  }
  rows.push(`- storage: ${config.storage.dir}`);
  rows.push(`- memory: ${config.memory.enabled ? config.memory.dir : "disabled"}`);
  rows.push(`- skills: ${config.skills.enabled ? config.skills.dirs.join(", ") : "disabled"}`);
  rows.push(`- tools: ${config.tools.enabled ? "enabled" : "disabled"}`);
  rows.push(`- scheduler: ${config.scheduler.enabled ? `${config.scheduler.dir} (tick ${config.scheduler.tickMs}ms)` : "disabled"}`);
  rows.push(`- actions: ${config.actions.enabled ? `${config.actions.dir} (write roots: ${config.actions.allowedWriteRoots.join(", ")})` : "disabled"}`);
  rows.push(`- access: ${config.access.enabled ? `${config.access.dir} (${config.access.defaultPolicy})` : "disabled"}`);
  rows.push("");
  rows.push("Providers (local account-backed CLIs):");

  for (const provider of Object.values(config.providers)) {
    const installed = commandExists(provider.command, { cwd: provider.cwd, pathValue: provider.env?.PATH });
    rows.push(`- ${provider.id}: ${installed ? "ok" : "missing"} · command=${provider.command}`);
    if (!installed && provider.loginHint) rows.push(`  hint: ${provider.loginHint}`);
  }

  rows.push("");
  rows.push("Messenger bridges:");
  rows.push(
    `- telegram: token ${config.connectors.telegram.botToken ? "present" : "missing"} (${config.connectors.telegram.botTokenEnv}), enabled=${config.connectors.telegram.enabled}`
  );
  rows.push(
    `- discord: token ${config.connectors.discord.botToken ? "present" : "missing"} (${config.connectors.discord.botTokenEnv}), enabled=${config.connectors.discord.enabled}`
  );
  rows.push("");
  rows.push("Note: Discord/Telegram tokens are transport credentials only; model calls still go through local CLIs.");
  rows.push("");
  rows.push("Recommended checks:");
  rows.push("- static config/state/audit: `node src/index.ts config-check && node src/index.ts state-check && node src/index.ts audit`");
  rows.push("- full local verification: `node src/index.ts verify`");
  rows.push("- provider runtime + live token proof: `node src/index.ts verify --live --probe-all-providers`");
  rows.push("- single live launch verdict: `node src/index.ts launch-status`");
  rows.push("- environment/token loading: `node src/index.ts env-check`");
  rows.push("- no-start launch rehearsal: `node src/index.ts gateway --dry-run --strict --live --probe-all-providers`");
  rows.push("- actionable recovery checklist: `node src/index.ts next-steps --live --probe-all-providers`");

  return rows.join("\n");
}
