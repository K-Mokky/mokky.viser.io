// ================================================================
// Actionable runbook
// ================================================================
// `verify` is a gate. `next-steps` is the operator runbook: it turns the
// current readiness/audit evidence into the exact commands that make Viser
// usable from CLI, gateway, and messenger surfaces.

import { auditItems, summarizeAudit } from "./audit.ts";
import { readinessItems, summarizeReadiness, type ReadinessOptions } from "./readiness.ts";
import { providerIssueAdvice, providerSmokeCommand } from "../providers/guide.ts";
import { commandExists } from "../utils/exec.ts";
import type { AuditItem } from "./audit.ts";
import type { ReadinessItem } from "./readiness.ts";
import type { CliProviderConfig, ViserConfig } from "../core/types.ts";

export interface NextStepsOptions extends ReadinessOptions {}

export async function nextStepsReport(config: ViserConfig, options: NextStepsOptions = {}): Promise<string> {
  const readiness = await readinessItems(config, options);
  const audit = await auditItems(config);
  const readinessSummary = summarizeReadiness(readiness);
  const auditSummary = summarizeAudit(audit);
  const providerRunbook = providerSteps(config, readiness, options);
  const toolsRunbook = toolsSteps(readiness);
  const messengerRunbook = messengerSteps(config, readiness);
  const safetyRunbook = safetySteps(audit);

  return [
    "Viser next steps",
    `readiness: ${readinessSummary.verdict} (${readinessSummary.passCount} pass, ${readinessSummary.warnCount} warn, ${readinessSummary.failCount} fail)`,
    `audit: ${auditSummary.verdict} (${auditSummary.passCount} pass, ${auditSummary.warnCount} warn, ${auditSummary.failCount} fail)`,
    "",
    "1. Provider runtime",
    ...providerRunbook.map((line) => `   ${line}`),
    "",
    "2. Local tools",
    ...toolsRunbook.map((line) => `   ${line}`),
    "",
    "3. Messaging / gateway",
    ...messengerRunbook.map((line) => `   ${line}`),
    "",
    "4. Safety / persistence",
    ...safetyRunbook.map((line) => `   ${line}`),
    "",
    "5. Launch commands",
    "   - Single-command launch status: `node src/index.ts launch-status`",
    "   - No-start preflight: `node src/index.ts preflight`",
    "   - Live provider-proof preflight: `node src/index.ts preflight --live --probe-all-providers`",
    "   - CLI chat: `node src/index.ts chat`",
    "   - One-off ask: `node src/index.ts ask \"질문\"`",
    "   - Queue work: `node src/index.ts enqueue \"긴 작업\"` then `node src/index.ts run-jobs 1` or `node src/index.ts run-jobs 6 --parallel 3` for independent queued jobs",
    "   - Gateway readiness dry-run: `node src/index.ts gateway --dry-run`",
    "   - Gateway strict live provider-proof dry-run: `node src/index.ts gateway --dry-run --strict --live --probe-all-providers`",
    "   - Live provider-proof foreground gateway: `node src/index.ts gateway`",
    "   - Live provider-proof launchd service runner: `node src/index.ts service-run --live --probe-all-providers`",
    "   - Explicit live provider-proof foreground gateway: `node src/index.ts gateway --strict --live --probe-all-providers`",
    "   - Unsafe raw foreground gateway for debugging only: `node src/index.ts gateway --unsafe-skip-gate`",
    "   - macOS service helper: `node src/index.ts service status`"
  ].join("\n");
}

function providerSteps(config: ViserConfig, readiness: ReadinessItem[], options: NextStepsOptions): string[] {
  const lines: string[] = [];
  const candidateIds = [...new Set([config.assistant.defaultProvider, ...config.assistant.fallbackProviders])];
  const candidateProviders = candidateIds
    .map((id) => config.providers[id])
    .filter((provider): provider is CliProviderConfig => Boolean(provider));
  const providerProbeItems = readiness.filter((item) => item.area === "provider-probe");
  const runtimeItem = readiness.find((item) => item.area === "provider-runtime");
  const passingProbes = providerProbeItems.filter((item) => item.status === "pass");
  const failedProbes = providerProbeItems.filter((item) => item.status !== "pass");
  const providerConfigFailures = readiness.filter((item) => item.area === "provider" && item.status !== "pass");

  if (runtimeItem?.status === "pass") {
    lines.push(`- ✅ ${runtimeItem.message}`);
  } else if (runtimeItem?.status === "fail") {
    lines.push(`- ❌ ${runtimeItem.message}`);
    if (runtimeItem.next) lines.push(`- next: ${runtimeItem.next}`);
  } else if (passingProbes.length > 0) {
    lines.push(`- ✅ provider probe passed: ${passingProbes.map((item) => item.message.split(":")[0]).join(", ")}`);
  } else if (!options.probeProviders && !options.probeAllProviders) {
    lines.push("- runtime not proven yet: run `node src/index.ts verify --live --probe-all-providers`.");
  }

  for (const item of failedProbes) {
    const providerId = item.message.split(":")[0];
    lines.push(`- fix ${providerId}: ${providerProbeAdvice(config.providers[providerId], item)}`);
  }

  for (const item of providerConfigFailures) {
    lines.push(`- ${item.status === "fail" ? "fix" : "optional"} ${item.message}${item.next ? `: ${item.next}` : ""}`);
  }

  if (candidateProviders.length > 0) {
    lines.push("- manual smoke tests in a normal terminal:");
    for (const provider of candidateProviders) {
      if (!commandExists(provider.command, { cwd: provider.cwd, pathValue: provider.env?.PATH })) {
        lines.push(`  - ${provider.id}: install/login first. ${provider.loginHint ?? ""}`.trimEnd());
        continue;
      }
      lines.push(`  - ${provider.id}: ${providerSmokeCommand(provider)}`);
    }
  }

  lines.push("- provider guide: `node src/index.ts provider-guide --probe`");
  return lines;
}

function providerProbeAdvice(provider: CliProviderConfig | undefined, item: ReadinessItem): string {
  const text = `${item.message}\n${item.next ?? ""}`;
  return providerIssueAdvice(provider, text).join("; ");
}

function toolsSteps(readiness: ReadinessItem[]): string[] {
  const lines: string[] = [];
  const skills = readiness.filter((item) => item.area === "skills");
  const plugins = readiness.filter((item) => item.area === "plugins");
  const tools = readiness.filter((item) => item.area === "tools");
  const actionableSkills = skills.filter((item) => item.status !== "pass");
  const actionablePlugins = plugins.filter((item) => item.status !== "pass");
  const actionable = tools.filter((item) => item.status !== "pass");

  if (actionableSkills.length === 0) {
    const passingSkills = skills.find((item) => item.status === "pass");
    if (passingSkills) lines.push(`- ✅ ${passingSkills.message}`);
  } else {
    for (const item of actionableSkills) {
      lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    }
    lines.push("- install starter skills with `node src/index.ts setup`, then rerun `node src/index.ts readiness`.");
  }

  if (actionablePlugins.length === 0) {
    const passingPlugins = plugins.find((item) => item.status === "pass");
    if (passingPlugins) lines.push(`- ✅ ${passingPlugins.message}`);
  } else {
    for (const item of actionablePlugins) {
      lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    }
    lines.push("- keep bundled plugins or add `plugin.json` folders, then rerun `node src/index.ts readiness`.");
  }

  if (actionable.length === 0) {
    const passing = tools.find((item) => item.status === "pass");
    lines.push(`- ✅ ${passing?.message ?? "local tools ready"}`);
  } else {
    for (const item of actionable) {
      lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    }
    lines.push("- edit `tools.shell.allowedCommands` or fix PATH, then rerun `node src/index.ts readiness`.");
  }

  lines.push("- inspect available local tools with `node src/index.ts tools`.");
  lines.push("- inspect local plugins with `node src/index.ts plugins`.");
  lines.push("- run local smoke coverage with `node src/index.ts smoke`.");
  return lines;
}

function messengerSteps(config: ViserConfig, readiness: ReadinessItem[]): string[] {
  const lines: string[] = [];
  const telegram = readiness.find((item) => item.area === "telegram");
  const discord = readiness.find((item) => item.area === "discord");
  const liveChecks = readiness.filter((item) => item.area === "live");
  const liveIssues = liveChecks.filter((item) => item.status !== "pass");
  const livePasses = liveChecks.filter((item) => item.status === "pass");
  const liveAccepted = livePasses.filter((item) => isAcceptedLiveToken(item.message));
  const liveDisabled = livePasses.filter((item) => isDisabledLiveToken(item.message));

  if (liveChecks.length > 0) {
    if (liveIssues.length === 0 && liveAccepted.length === liveChecks.length) {
      lines.push("- ✅ live Telegram/Discord token validation accepted configured tokens.");
    } else if (liveAccepted.length > 0) {
      lines.push(`- ✅ live token accepted: ${liveAccepted.map((item) => item.message.split(":")[0]).join(", ")}.`);
    } else if (liveIssues.length === 0 && liveDisabled.length > 0) {
      lines.push("- ℹ️ live Telegram/Discord token validation not configured; bridges are disabled or tokens are empty.");
    }
    for (const item of livePasses) lines.push(`- ${isDisabledLiveToken(item.message) ? "ℹ️" : "✅"} live token check ${item.message}`);
    for (const item of liveIssues) lines.push(`- ${statusIcon(item.status)} live token check ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    lines.push("- after changing tokens, rerun `node src/index.ts next-steps --live --probe-all-providers` or `node src/index.ts launch-status`.");
  } else if (telegram?.status === "pass" && discord?.status === "pass") {
    lines.push("- ✅ Telegram/Discord token checks passed or bridges are disabled intentionally.");
  } else {
    if (telegram?.status !== "pass") lines.push(`- Telegram: set ${config.connectors.telegram.botTokenEnv} if you want Telegram messaging.`);
    if (discord?.status !== "pass") lines.push(`- Discord: set ${config.connectors.discord.botTokenEnv} if you want Discord messaging.`);
  }

  lines.push("- .env example:");
  lines.push(`  - ${config.connectors.telegram.botTokenEnv}=...`);
  lines.push(`  - ${config.connectors.discord.botTokenEnv}=...`);
  lines.push("- after enabling a bridge, authorize chats/channels with `node src/index.ts pair-code telegram|discord [label]`.");
  lines.push("- use `node src/index.ts gateway --dry-run --strict --live --probe-all-providers` before leaving a live gateway running.");
  return lines;
}

function isAcceptedLiveToken(message: string): boolean {
  return /^(?:telegram|discord): (?:bot\b|token accepted\b)/iu.test(message);
}

function isDisabledLiveToken(message: string): boolean {
  return /^(?:telegram|discord): disabled \(no token configured\)$/iu.test(message);
}

function statusIcon(status: ReadinessItem["status"]): string {
  return status === "fail" ? "❌" : status === "warn" ? "⚠️" : "✅";
}

function safetySteps(audit: AuditItem[]): string[] {
  const lines: string[] = [];
  const blockers = audit.filter((item) => item.severity === "fail");
  const warnings = audit.filter((item) => item.severity === "warn");

  if (blockers.length === 0 && warnings.length === 0) {
    lines.push("- ✅ audit is safe.");
  } else {
    for (const item of blockers) lines.push(`- fix audit blocker [${item.area}]: ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    for (const item of warnings) lines.push(`- review audit warning [${item.area}]: ${item.message}${item.next ? ` — ${item.next}` : ""}`);
  }

  lines.push("- backup state/config with `node src/index.ts backup`.");
  lines.push("- validate editable config with `node src/index.ts config-check`.");
  lines.push("- validate persistent state with `node src/index.ts state-check`; preview repair with `node src/index.ts state-check --repair`.");
  lines.push("- prove local non-provider features with `node src/index.ts smoke`.");
  lines.push("- keep writes approval-gated: use `/propose`, inspect `/approvals`, then `/approve <id>`.");
  lines.push("- store durable preferences with `/remember ... #tag`.");
  return lines;
}
