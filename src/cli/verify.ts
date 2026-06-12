// ================================================================
// One-command verification
// ================================================================
// `readiness` and `audit` are intentionally separate. `verify` is the
// user-facing gate that combines them into a single "can I run this now?"
// report, including concrete next actions for external dependencies.

import { auditItems, summarizeAudit } from "./audit.ts";
import { readinessItems, summarizeReadiness, type ReadinessOptions } from "./readiness.ts";
import { localSmoke, type SmokeItem, type SmokeSummary } from "./smoke.ts";
import { providerIssueAdvice } from "../providers/guide.ts";
import type { AuditItem } from "./audit.ts";
import type { ReadinessItem, ReadinessSummary } from "./readiness.ts";
import type { CliProviderConfig, ViserConfig } from "../core/types.ts";

export interface VerifyOptions extends ReadinessOptions {
  strict?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  report: string;
  readiness: ReadinessSummary;
  readinessItems: ReadinessItem[];
  audit: ReturnType<typeof summarizeAudit>;
  smoke: SmokeSummary;
  smokeItems: SmokeItem[];
}

export async function verify(config: ViserConfig, options: VerifyOptions = {}): Promise<VerifyResult> {
  const [readiness, audit] = await Promise.all([
    readinessItems(config, {
      live: options.live,
      probeProviders: options.probeProviders,
      probeAllProviders: options.probeAllProviders
    }),
    auditItems(config)
  ]);
  const smoke = await localSmoke(config);
  const readinessSummary = summarizeReadiness(readiness);
  const auditSummary = summarizeAudit(audit);
  const ok = readinessSummary.failCount === 0 && auditSummary.failCount === 0 && smoke.ok;

  return {
    ok,
    readiness: readinessSummary,
    readinessItems: readiness,
    audit: auditSummary,
    smoke: smoke.summary,
    smokeItems: smoke.items,
    report: formatVerifyReport({
      readiness,
      audit,
      smoke: smoke.items,
      smokeSummary: smoke.summary,
      readinessSummary,
      auditSummary,
      strict: Boolean(options.strict),
      providers: config.providers
    })
  };
}

function formatVerifyReport(input: {
  readiness: ReadinessItem[];
  audit: AuditItem[];
  smoke: SmokeItem[];
  smokeSummary: SmokeSummary;
  readinessSummary: ReadinessSummary;
  auditSummary: ReturnType<typeof summarizeAudit>;
  strict: boolean;
  providers: Record<string, CliProviderConfig>;
}): string {
  const blockers = [
    ...input.readiness.filter((item) => item.status === "fail").map((item) => `[readiness:${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`),
    ...input.audit.filter((item) => item.severity === "fail").map((item) => `[audit:${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`),
    ...input.smoke.filter((item) => item.status === "fail").map((item) => `[smoke:${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`)
  ];
  const warnings = [
    ...input.readiness.filter((item) => item.status === "warn").map((item) => `[readiness:${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`),
    ...input.audit.filter((item) => item.severity === "warn").map((item) => `[audit:${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`)
  ];
  const runtimeProof = input.readiness
    .filter((item) => item.status === "pass" && (item.area === "provider-probe" || item.area === "provider-runtime"))
    .map((item) => `[readiness:${item.area}] ${item.message}`);
  const providerProbeRequested = input.readiness.some((item) => item.area === "provider-probe" || item.area === "provider-runtime");
  const providerRecovery = providerRecoveryAdvice(input.readiness, input.providers);
  const gatewayReady = blockers.length === 0;

  return [
    `Viser verify: ${blockers.length === 0 ? "PASS" : "BLOCKED"}`,
    `readiness: ${input.readinessSummary.verdict} (${input.readinessSummary.passCount} pass, ${input.readinessSummary.warnCount} warn, ${input.readinessSummary.failCount} fail)`,
    `audit: ${input.auditSummary.verdict} (${input.auditSummary.passCount} pass, ${input.auditSummary.warnCount} warn, ${input.auditSummary.failCount} fail)`,
    `local smoke: ${input.smokeSummary.verdict} (${input.smokeSummary.passCount} pass, ${input.smokeSummary.failCount} fail)`,
    `gateway strict gate: ${gatewayReady ? "pass" : "fail"}`,
    `strict mode: ${input.strict ? "on" : "off"}`,
    "",
    "Blockers:",
    blockers.length ? blockers.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "Warnings / external setup:",
    warnings.length ? warnings.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "Runtime proof:",
    runtimeProof.length
      ? runtimeProof.map((item) => `- ${item}`).join("\n")
      : providerProbeRequested
        ? "- no provider probe passed"
        : "- provider probe not requested",
    "",
    "Provider recovery:",
    providerRecovery.length ? providerRecovery.map((item) => `- ${item}`).join("\n") : "- none",
    "",
    "Recommended next commands:",
    ...recommendedCommands(input.readiness, input.audit).map((command) => `- ${command}`)
  ].join("\n");
}

function providerRecoveryAdvice(readiness: ReadinessItem[], providers: Record<string, CliProviderConfig>): string[] {
  return readiness
    .filter((item) => item.area === "provider-probe" && item.status !== "pass")
    .map((item) => {
      const providerId = providerIdFromProbeMessage(item.message);
      const provider = providerId ? providers[providerId] : undefined;
      const label = provider?.id ?? providerId ?? "provider";
      const detail = `${item.message}${item.next ? `\n${item.next}` : ""}`;
      return `${label}: ${providerIssueAdvice(provider, detail).join("; ")}`;
    });
}

function providerIdFromProbeMessage(message: string): string | undefined {
  return /^([^:]+):/.exec(message)?.[1];
}

function recommendedCommands(readiness: ReadinessItem[], audit: AuditItem[]): string[] {
  const commands = new Set<string>();

  commands.add("viser config-check");
  commands.add("viser state-check");
  commands.add("viser audit");
  commands.add("viser readiness");
  commands.add("viser smoke");
  commands.add("viser benchmark");
  commands.add("viser preflight");
  commands.add("viser preflight --live --probe-all-providers");
  commands.add("viser launch-status");
  commands.add("viser next-steps --live --probe-all-providers");
  commands.add("viser gateway --dry-run");
  commands.add("viser gateway --dry-run --strict");
  commands.add("viser gateway --dry-run --strict --live --probe-all-providers");
  commands.add("viser gateway");

  if (readiness.some((item) => (item.area === "provider-probe" || item.area === "provider-runtime") && item.status !== "pass")) {
    commands.add("viser provider-guide --probe");
  } else {
    commands.add("viser provider-guide");
  }

  if (readiness.some((item) => item.area === "telegram" || item.area === "discord" || item.area === "slack" || item.area === "matrix" || item.area === "signal" || item.area === "imessage" || item.area === "whatsapp" || item.area === "line" || item.area === "google-chat" || item.area === "webhook" || item.area === "home-assistant" || item.area === "teams" || item.area === "mattermost" || item.area === "synology-chat" || item.area === "rocket-chat" || item.area === "feishu" || item.area === "dingtalk" || item.area === "wecom" || item.area === "zalo" || item.area === "irc" || item.area === "twitch" || item.area === "nextcloud-talk" || item.area === "webex" || item.area === "zulip" || item.area === "email" || item.area === "github" || item.area === "todoist" || item.area === "notion" || item.area === "obsidian" || item.area === "live")) {
    commands.add("viser pair-code telegram|discord|slack|matrix|signal|imessage|whatsapp|line|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian");
  }

  if (audit.some((item) => item.severity !== "pass")) {
    commands.add("edit viser.config.json, then rerun viser audit");
  }

  commands.add("viser gateway --strict --live --probe-all-providers");
  commands.add("viser backup");
  commands.add("viser release-evidence");
  return [...commands];
}
