#!/usr/bin/env node
// ================================================================
// Viser CLI entrypoint
// ================================================================
// Run with Node 22.6+ native TypeScript stripping:
//   node src/index.ts chat
// or after `npm link`:
//   viser chat

import { createInterface } from "node:readline/promises";
import { env, stdin as input, stdout as output } from "node:process";
import { resolve as resolvePath } from "node:path";
import { parseArgs, flagBool, flagString } from "./cli/args.ts";
import { auditReport } from "./cli/audit.ts";
import { createBackupReport } from "./cli/backup.ts";
import { compactBackupReport } from "./cli/compact-backups.ts";
import { configCheckReport } from "./cli/config-check.ts";
import { dashboardCheck } from "./cli/dashboard-check.ts";
import { doctorReport } from "./cli/doctor.ts";
import { envCheckReport, writeEnvTemplate } from "./cli/env-check.ts";
import { writeExampleConfig } from "./cli/init.ts";
import { nextStepsReport } from "./cli/next-steps.ts";
import { preflight } from "./cli/preflight.ts";
import { setupReport } from "./cli/setup.ts";
import { onboardReport } from "./cli/onboard.ts";
import { serviceCommand, trimServiceLogs } from "./cli/service.ts";
import { localSmoke } from "./cli/smoke.ts";
import { stateHealthReport } from "./cli/state-health.ts";
import { readinessReport } from "./cli/readiness.ts";
import { liveLaunchReadinessOptions, providerProofLaunchReadinessOptions, readinessOptionsFromFlags } from "./cli/readiness-options.ts";
import { releaseEvidenceReportResult } from "./cli/release-evidence.ts";
import { verify } from "./cli/verify.ts";
import { loadConfig } from "./config.ts";
import { AssistantRuntime } from "./core/assistant.ts";
import { mcpClientConfigReport } from "./core/mcp-client-config.ts";
import { providerGuideReport } from "./providers/guide.ts";
import { runTelegramBridge } from "./connectors/telegram.ts";
import { runDiscordBridge } from "./connectors/discord.ts";
import { runGateway } from "./connectors/gateway.ts";
import { createConnectorNotifier } from "./connectors/notifier.ts";
import { DEFAULT_WEB_DASHBOARD_HOST, DEFAULT_WEB_DASHBOARD_PORT, startWebDashboard } from "./connectors/web-dashboard.ts";
import { runMcpStdioServer } from "./connectors/mcp-server.ts";
import { AccessStore, parseConnector } from "./core/access.ts";
import { JobRunner, JobStore } from "./core/jobs.ts";
import { SchedulerRunner } from "./core/scheduler.ts";
import { loadEnvFile } from "./utils/env.ts";
import { fileExists } from "./utils/files.ts";
import type { EnvLoadResult } from "./utils/env.ts";
import type { ViserConfig } from "./core/types.ts";

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  const parsed = parseArgs(rawArgv);
  const bareInvocation = rawArgv.length === 0;

  if (parsed.command === "help" || flagBool(parsed.flags, "help")) {
    console.log(globalHelp());
    return;
  }

  const explicitEnvPath = flagString(parsed.flags, "env");
  const configuredEnvPath = explicitEnvPath ?? env.VISER_ENV;
  let envLoadResult: EnvLoadResult;
  if (configuredEnvPath) {
    env.VISER_ENV = resolvePath(configuredEnvPath);
    envLoadResult = await loadEnvFile(env.VISER_ENV, process.cwd(), { required: !allowsMissingConfiguredEnv(parsed.command) });
  } else {
    envLoadResult = await loadEnvFile(".env");
  }

  if (bareInvocation && needsFirstRunSetup()) {
    console.log(await firstRunSetupReport());
    return;
  }

  if (parsed.command === "init") {
    console.log(await writeExampleConfig(flagBool(parsed.flags, "force")));
    return;
  }

  if (parsed.command === "setup") {
    console.log(await setupReport(flagBool(parsed.flags, "force")));
    return;
  }

  if (parsed.command === "onboard" || parsed.command === "start-here" || parsed.command === "quickstart") {
    const onboardConfig = await loadConfig({ configPath: flagString(parsed.flags, "config") });
    const apply = !flagBool(parsed.flags, "check") && !flagBool(parsed.flags, "noSetup") && !flagBool(parsed.flags, "no-setup");
    console.log(await onboardReport(onboardConfig, { apply }));
    return;
  }

  const config = await loadConfig({ configPath: flagString(parsed.flags, "config") });
  const assistant = new AssistantRuntime(config);
  const access = new AccessStore(config.access);
  const providerId = flagString(parsed.flags, "provider");
  const sessionId = flagString(parsed.flags, "session") ?? `cli:${process.cwd()}`;

  switch (parsed.command) {
    case "doctor":
      console.log(doctorReport(config, envLoadResult));
      return;
    case "env-check":
    case "env":
    case "environment":
      console.log(envCheckReport(config, envLoadResult));
      return;
    case "env-init":
    case "write-env":
      console.log(await writeEnvTemplate(config, {
        outputPath: flagString(parsed.flags, "output") ?? flagString(parsed.flags, "out"),
        force: flagBool(parsed.flags, "force")
      }));
      return;
    case "config-check":
    case "validate-config":
    case "config":
      console.log(await configCheckReport(config));
      return;
    case "state-check":
    case "state-health":
    case "repair-state":
      console.log(await stateHealthReport(config, {
        repair: parsed.command === "repair-state" || flagBool(parsed.flags, "repair"),
        force: flagBool(parsed.flags, "force")
      }));
      return;
    case "next":
    case "next-steps":
    case "runbook":
    case "checklist":
      console.log(await nextStepsReport(config, readinessOptionsFromFlags(parsed.flags)));
      return;
    case "preflight":
    case "launch-check": {
      const result = await preflight(config, {
        ...readinessOptionsFromFlags(parsed.flags),
        strict: flagBool(parsed.flags, "strict")
      });
      console.log(result.report);
      if (flagBool(parsed.flags, "strict") && !result.ok) process.exitCode = 1;
      return;
    }
    case "launch-status":
    case "launch-ready":
    case "go-live": {
      const result = await preflight(config, {
        strict: true,
        live: true,
        probeAllProviders: true
      });
      console.log([
        `Viser launch status: ${result.ok ? "READY" : "BLOCKED"}`,
        "mode: single-command live launch gate (env/config/state/audit/smoke/readiness/provider/runtime/token proof)",
        "",
        result.report,
        "",
        result.ok
          ? "Next: run `node src/index.ts gateway` for foreground mode, or `node src/index.ts service install` for launchd. To resolve warnings first, run `node src/index.ts next-steps --live --probe-all-providers`."
          : "Next: run `node src/index.ts next-steps --live --probe-all-providers` and fix the blockers above."
      ].join("\n"));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "smoke":
    case "local-smoke": {
      const result = await localSmoke(config, { keepArtifacts: flagBool(parsed.flags, "keep") });
      console.log(result.report);
      if (flagBool(parsed.flags, "strict") && !result.ok) process.exitCode = 1;
      return;
    }
    case "audit":
    case "security-audit":
      console.log(await auditReport(config));
      return;
    case "release-evidence":
    case "release-report":
    case "public-release": {
      const evidence = await releaseEvidenceReportResult(config, {
        json: flagBool(parsed.flags, "json"),
        verifyOptions: readinessOptionsFromFlags(parsed.flags)
      });
      console.log(evidence.report);
      if (flagBool(parsed.flags, "strict") && (!evidence.result.ok || evidence.result.completion.status !== "proven")) {
        process.exitCode = 1;
      }
      return;
    }
    case "backup":
    case "export":
      console.log(await createBackupReport(config, {
        outputPath: flagString(parsed.flags, "output") ?? flagString(parsed.flags, "out"),
        force: flagBool(parsed.flags, "force"),
        maxFileBytes: parseOptionalNumber(flagString(parsed.flags, "maxFileBytes") ?? flagString(parsed.flags, "max-bytes"))
      }));
      return;
    case "compact-backups":
    case "retention":
    case "prune-compact-backups":
      console.log(await compactBackupReport(config, {
        delete: flagBool(parsed.flags, "delete"),
        force: flagBool(parsed.flags, "force"),
        fixPermissions: flagBool(parsed.flags, "fixPermissions")
      }));
      return;
    case "readiness":
    case "ready":
      console.log(await readinessReport(config, readinessOptionsFromFlags(parsed.flags)));
      return;
    case "verify":
    case "self-test": {
      const result = await verify(config, {
        ...readinessOptionsFromFlags(parsed.flags),
        strict: flagBool(parsed.flags, "strict")
      });
      console.log(result.report);
      if (flagBool(parsed.flags, "strict") && !result.ok) process.exitCode = 1;
      return;
    }
    case "provider-guide":
    case "provider-login":
    case "login-guide":
      console.log(await providerGuideReport(config, {
        providerId: parsed.positionals[0],
        probe: flagBool(parsed.flags, "probe"),
        timeoutMs: parseOptionalNumber(flagString(parsed.flags, "timeoutMs") ?? flagString(parsed.flags, "timeout"))
      }));
      return;
    case "providers":
      console.log(await assistant.handle("/providers", sessionId, { source: "cli" }));
      return;
    case "status":
      console.log(await assistant.handle("/status", sessionId, { source: "cli" }));
      return;
    case "dashboard":
    case "overview":
    case "home":
      console.log(await assistant.handle(flagBool(parsed.flags, "json") ? "/dashboard --json" : "/dashboard", sessionId, { source: "cli" }));
      return;
    case "dashboard-check":
    case "check-dashboard":
    case "dashboard-health": {
      const portFlag = flagString(parsed.flags, "port") ?? flagString(parsed.flags, "webDashboardPort") ?? flagString(parsed.flags, "dashboardPort");
      const timeoutFlag = flagString(parsed.flags, "timeoutMs") ?? flagString(parsed.flags, "timeout");
      const result = await dashboardCheck(config, {
        host: flagString(parsed.flags, "host") ?? flagString(parsed.flags, "webDashboardHost") ?? flagString(parsed.flags, "dashboardHost"),
        port: portFlag === undefined ? undefined : Number.parseInt(portFlag, 10),
        timeoutMs: timeoutFlag === undefined ? undefined : Number.parseInt(timeoutFlag, 10)
      });
      console.log(result.report);
      if (flagBool(parsed.flags, "strict") && !result.ok) process.exitCode = 1;
      return;
    }
    case "web-dashboard":
    case "dashboard-web":
    case "dashboard-server":
      await runWebDashboardCommand(config, sessionId, parsed.flags);
      return;
    case "mcp-client-config":
    case "mcp-config":
    case "mcp-clients":
      console.log(mcpClientConfigReport(config, {
        target: parsed.positionals[0],
        serverName: flagString(parsed.flags, "name"),
        json: flagBool(parsed.flags, "json")
      }));
      return;
    case "mcp-server":
    case "mcp":
      await runMcpStdioServer(config, assistant);
      return;
    case "reset":
      console.log(await assistant.handle("/reset", sessionId, { source: "cli" }));
      return;
    case "sessions":
      console.log(await assistant.handle(`/sessions ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "session":
    case "transcript":
      console.log(await assistant.handle(`/session ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "session-search":
    case "search-sessions":
      console.log(await assistant.handle(`/session-search ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "session-compact":
    case "compact-session":
      console.log(await assistant.handle(`/session-compact ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "skills":
      console.log(await assistant.handle("/skills", sessionId, { source: "cli" }));
      return;
    case "plugins":
      console.log(await assistant.handle("/plugins", sessionId, { source: "cli" }));
      return;
    case "plugin":
      console.log(await assistant.handle(`/plugin ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "memory":
    case "memories":
      console.log(await assistant.handle(`/memory ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "profile":
    case "memory-profile":
      console.log(await assistant.handle(`/profile ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "memory-compact":
    case "compact-memory":
      console.log(await assistant.handle(`/memory-compact ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "remember":
      console.log(await assistant.handle(`/remember ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "tools":
      console.log(await assistant.handle("/tools", sessionId, { source: "cli" }));
      return;
    case "tool":
      console.log(await assistant.handle(`/tool ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "schedule":
      console.log(await assistant.handle(`/schedule ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "schedules":
      console.log(await assistant.handle("/schedules", sessionId, { source: "cli" }));
      return;
    case "unschedule":
      console.log(await assistant.handle(`/unschedule ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "enqueue":
    case "job":
      console.log(await assistant.handle(`/enqueue ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "team":
    case "swarm":
      console.log(await assistant.handle(`/team ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "fix-loop":
    case "review-loop":
    case "autofix":
      console.log(await assistant.handle(`/fix-loop ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "supervise":
    case "supervisor":
    case "autopilot":
      console.log(await assistant.handle(`/supervise ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
      return;
    case "jobs":
    case "queue":
      console.log(await assistant.handle(`/jobs ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "run-jobs":
    case "work":
      if (await runJobsNeedsGate(config, parsed.positionals) && !await foregroundGate("run-jobs", config, parsed.flags)) return;
      console.log(await assistant.handle(`/run-jobs ${runJobsArgument(parsed.positionals, parsed.flags)}`.trim(), sessionId, { source: "cli" }));
      return;
    case "job-worker":
      {
        const jobsConfig = jobWorkerConfig(config.jobs, parsed.flags);
        if (!jobsConfig) return;
        if (jobsConfig.enabled && !await foregroundGate("job-worker", config, parsed.flags)) return;
        await new JobRunner(jobsConfig, assistant, { maxInputChars: config.assistant.maxInputChars }).loop();
      }
      return;
    case "cancel-job":
      console.log(await assistant.handle(`/cancel-job ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "delete-job":
    case "remove-job":
      console.log(await assistant.handle(`/delete-job ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "propose":
      console.log(await assistant.handle(`/propose ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "approvals":
    case "actions":
      console.log(await assistant.handle("/approvals", sessionId, { source: "cli" }));
      return;
    case "approve":
      console.log(await assistant.handle(`/approve ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "reject":
      console.log(await assistant.handle(`/reject ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "delete-action":
    case "remove-action":
      console.log(await assistant.handle(`/delete-action ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "scheduler":
      if (config.scheduler.enabled && !await foregroundGate("scheduler", config, parsed.flags)) return;
      await new SchedulerRunner(config.scheduler, assistant, createConnectorNotifier(config)).loop();
      return;
    case "service-run":
    case "gateway-service": {
      try {
        const trims = await trimServiceLogs(config);
        for (const trim of trims.filter((item) => item.trimmed)) {
          console.log(`Viser service log trimmed: ${trim.path} (${trim.bytesBefore} -> ${trim.bytesAfter} bytes)`);
        }
      } catch (error) {
        console.error(`Viser service log maintenance failed; continuing startup: ${error instanceof Error ? error.message : String(error)}`);
      }
      const gate = await preflight(config, {
        ...providerProofLaunchReadinessOptions(parsed.flags),
        strict: true
      });
      console.log(gate.report);
      if (!gate.ok) {
        console.log("Viser service-run: blocked by preflight; exiting 0 to avoid a launchd restart loop.");
        return;
      }
      await runGateway(config, assistant);
      return;
    }
    case "service":
      console.log(await serviceCommand(parsed.positionals, config));
      return;
    case "pair-code": {
      const connector = parseConnector(parsed.positionals[0] ?? "");
      if (!connector) {
        console.log("Usage: viser pair-code telegram|discord [label]");
        return;
      }
      const code = await access.createPairingCode(connector, parsed.positionals.slice(1).join(" ") || undefined);
      console.log([`Pairing code: ${code.code}`, `Connector: ${connector}`, `Expires: ${code.expiresAt}`, "Send this in the target chat:", `/pair ${code.code}`].join("\n"));
      return;
    }
    case "access":
      console.log(await access.formatAccess());
      return;
    case "allow": {
      const connector = parseConnector(parsed.positionals[0] ?? "");
      const id = parsed.positionals[1];
      if (!connector || !id) {
        console.log("Usage: viser allow telegram|discord <chat-or-channel-id> [label]");
        return;
      }
      const peer = await access.allow(connector, id, parsed.positionals.slice(2).join(" ") || undefined);
      console.log(`Allowed ${peer.connector}:${peer.id}${peer.label ? ` (${peer.label})` : ""}.`);
      return;
    }
    case "revoke": {
      const connector = parseConnector(parsed.positionals[0] ?? "");
      const id = parsed.positionals[1];
      if (!connector || !id) {
        console.log("Usage: viser revoke telegram|discord <chat-or-channel-id>");
        return;
      }
      console.log((await access.revoke(connector, id)) ? `Revoked ${connector}:${id}.` : `No access entry for ${connector}:${id}.`);
      return;
    }
    case "login":
      console.log(await providerGuideReport(config, {
        providerId: parsed.positionals[0],
        probe: flagBool(parsed.flags, "probe"),
        timeoutMs: parseOptionalNumber(flagString(parsed.flags, "timeoutMs") ?? flagString(parsed.flags, "timeout"))
      }));
      return;
    case "ask":
      await askOnce(assistant, parsed.positionals.join(" "), sessionId, providerId);
      return;
    case "chat":
      await chatLoop(assistant, sessionId, providerId);
      return;
    case "telegram":
      if (!config.connectors.telegram.botToken) {
        console.error(`Telegram token is missing. Set ${config.connectors.telegram.botTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("telegram", config, parsed.flags)) return;
      await runTelegramBridge(config.connectors.telegram, assistant, access);
      return;
    case "discord":
      if (!config.connectors.discord.botToken) {
        console.error(`Discord token is missing. Set ${config.connectors.discord.botTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("discord", config, parsed.flags)) return;
      await runDiscordBridge(config.connectors.discord, assistant, access);
      return;
    case "gateway": {
      if (flagBool(parsed.flags, "dryRun")) {
        if (flagBool(parsed.flags, "strict")) {
          const gate = await preflight(config, {
            ...liveLaunchReadinessOptions(parsed.flags),
            strict: true
          });
          console.log(gate.report);
          if (!gate.ok) process.exitCode = 1;
          return;
        }
        console.log(await readinessReport(config, readinessOptionsFromFlags(parsed.flags)));
        return;
      }
      const gatewayConfig = configWithWebDashboardFlags(config, parsed.flags);
      if (!gatewayConfig) return;
      const gatewayAssistant = gatewayConfig === config ? assistant : new AssistantRuntime(gatewayConfig);
      const unsafeSkipGate = flagBool(parsed.flags, "unsafeSkipGate") || flagBool(parsed.flags, "raw");
      if (!unsafeSkipGate) {
        const gate = await preflight(gatewayConfig, {
          ...providerProofLaunchReadinessOptions(parsed.flags),
          strict: true
        });
        console.log(gate.report);
        if (!gate.ok) {
          process.exitCode = 1;
          return;
        }
      } else if (flagBool(parsed.flags, "strict")) {
        const gate = await preflight(gatewayConfig, {
          ...liveLaunchReadinessOptions(parsed.flags),
          strict: true
        });
        console.log(gate.report);
        if (!gate.ok) {
          process.exitCode = 1;
          return;
        }
        console.warn("Viser gateway: --unsafe-skip-gate was set, but --strict still required preflight to pass.");
      } else {
        console.warn("Viser gateway: starting with --unsafe-skip-gate; provider/runtime proof was skipped.");
      }
      await runGateway(gatewayConfig, gatewayAssistant);
      return;
    }
    default:
      // Treat an unknown command as the beginning of an ask prompt. This makes
      // `viser what is my schedule?` convenient while keeping named commands.
      await askOnce(assistant, [parsed.command, ...parsed.positionals].join(" "), sessionId, providerId);
  }
}

async function askOnce(
  assistant: AssistantRuntime,
  prompt: string,
  sessionId: string,
  providerId?: string
): Promise<void> {
  const text = prompt.trim();
  if (!text) {
    console.error("No prompt provided. Example: viser ask --provider gemini \"요약해줘\"");
    process.exitCode = 1;
    return;
  }

  console.log(await assistant.handle(text, sessionId, { source: "cli", providerId }));
}

async function chatLoop(assistant: AssistantRuntime, sessionId: string, providerId?: string): Promise<void> {
  const rl = createInterface({ input, output });
  if (providerId) await assistant.handle(`/provider ${providerId}`, sessionId, { source: "cli" });
  console.log("Viser chat started. Type /help for commands or /exit to quit.");

  try {
    while (true) {
      const line = await rl.question("viser> ");
      const trimmed = line.trim();
      if (["/exit", "/quit", "exit", "quit"].includes(trimmed.toLowerCase())) break;
      const answer = await assistant.handle(trimmed, sessionId, { source: "cli" });
      console.log(`\n${answer}\n`);
    }
  } finally {
    rl.close();
  }
}

async function runWebDashboardCommand(
  config: ViserConfig,
  sessionId: string,
  flags: Record<string, string | boolean>
): Promise<void> {
  const effectiveConfig = configWithWebDashboardFlags(config, {
    ...flags,
    webDashboard: true,
    webDashboardHost: flagString(flags, "host") ?? flagString(flags, "webDashboardHost") ?? flagString(flags, "dashboardHost") ?? config.webDashboard.host,
    webDashboardPort: flagString(flags, "port") ?? flagString(flags, "webDashboardPort") ?? flagString(flags, "dashboardPort") ?? String(config.webDashboard.port)
  });
  if (!effectiveConfig) {
    console.error("Usage: viser web-dashboard [--host 127.0.0.1|localhost|::1] [--port 8787]");
    return;
  }

  const dashboardAssistant = new AssistantRuntime(effectiveConfig);
  const handle = await startWebDashboard(dashboardAssistant, {
    host: effectiveConfig.webDashboard.host,
    port: effectiveConfig.webDashboard.port,
    sessionId
  });
  console.log(`Viser web dashboard: ${handle.url}`);
  console.log("mode: read-only localhost dashboard (no provider calls, no write/action routes)");
  console.log("JSON: /dashboard.json");
  console.log("Press Ctrl+C to stop.");

  const shutdown = async () => {
    await handle.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await new Promise<void>(() => undefined);
}

function configWithWebDashboardFlags(config: ViserConfig, flags: Record<string, string | boolean>): ViserConfig | undefined {
  const requested =
    flagBool(flags, "webDashboard") ||
    flagBool(flags, "dashboard") ||
    flagBool(flags, "withDashboard");
  const host = flagString(flags, "webDashboardHost") ?? flagString(flags, "dashboardHost") ?? config.webDashboard.host ?? DEFAULT_WEB_DASHBOARD_HOST;
  const portFlag = flagString(flags, "webDashboardPort") ?? flagString(flags, "dashboardPort");
  const port = portFlag ? parseOptionalNumber(portFlag) : config.webDashboard.port ?? DEFAULT_WEB_DASHBOARD_PORT;

  if (!requested && host === config.webDashboard.host && port === config.webDashboard.port) return config;

  if (!isLocalDashboardHost(host)) {
    console.error("Usage: viser gateway [--web-dashboard] [--web-dashboard-host 127.0.0.1|localhost|::1] [--web-dashboard-port 8787]");
    console.error("Refusing to bind the read-only dashboard to a non-localhost interface. Use an explicit local tunnel if remote access is needed.");
    process.exitCode = 1;
    return undefined;
  }

  if (!port || port > 65_535) {
    console.error("Usage: viser gateway [--web-dashboard] [--web-dashboard-host 127.0.0.1|localhost|::1] [--web-dashboard-port 8787]");
    process.exitCode = 1;
    return undefined;
  }

  return {
    ...config,
    webDashboard: {
      ...config.webDashboard,
      enabled: requested ? true : config.webDashboard.enabled,
      host,
      port
    }
  };
}

function isLocalDashboardHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function globalHelp(): string {
  return [
    "Viser - local-CLI-backed personal AI assistant",
    "",
    "Usage:",
    "  viser onboard [--check]   # beginner-friendly first run",
    "  viser setup [--force]",
    "  viser init [--force]",
    "  viser doctor [--config ./viser.config.json]",
    "  viser env-check [--env ./prod.env]",
    "  viser env-init [--output ./.env] [--force]",
    "  viser config-check",
    "  viser state-check [--repair] [--force]",
    "  viser next-steps [--live] [--probe-all-providers]",
    "  viser preflight [--strict] [--live] [--probe-all-providers]",
    "  viser launch-status",
    "  viser smoke [--strict] [--keep]",
    "  viser audit",
    "  viser release-evidence [--strict] [--json] [--live] [--probe-all-providers]",
    "  viser backup [--output ./viser-backup.json]",
    "  viser compact-backups [--fix-permissions|--delete --force]",
    "  viser verify [--strict] [--live] [--probe-providers|--probe-all-providers]",
    "  viser readiness [--live] [--probe-providers|--probe-all-providers]",
    "  viser provider-guide [provider] [--probe]",
    "  viser providers",
    "  viser status",
    "  viser dashboard [--json]",
    "  viser dashboard-check [--strict] [--host 127.0.0.1] [--port 8787]",
    "  viser web-dashboard [--host 127.0.0.1] [--port 8787]",
    "  viser mcp-client-config [generic|claude-desktop|codex] [--name viser] [--json]",
    "  viser mcp-server",
    "  viser reset",
    "  viser sessions [limit]",
    "  viser session [id] [limit]",
    "  viser session-search <query>",
    "  viser session-compact [id] [max-messages]",
    "  viser skills",
    "  viser plugins",
    "  viser plugin <id> <command> \"prompt\"",
    "  viser memory [query]",
    "  viser profile [tag-limit]",
    "  viser memory-compact [max-entries]",
    "  viser remember \"stable fact #tag\"",
    "  viser tools",
    "  viser tool <tool> <args>",
    "  viser schedule every <duration> \"prompt\"",
    "  viser schedule at <ISO datetime> \"prompt\"",
    "  viser schedules",
    "  viser unschedule <id>",
    "  viser enqueue \"prompt\"",
    "  viser team \"task\"",
    "  viser fix-loop \"task\"",
    "  viser supervise \"task\"",
    "  viser jobs [pending|running|done|failed|cancelled]",
    "  viser run-jobs [limit] [--parallel <1-6>] [--unsafe-skip-gate]",
    "  viser job-worker [--parallel <1-6>] [--unsafe-skip-gate]",
    "  viser cancel-job <id>",
    "  viser delete-job <id>",
    "  viser propose write-file <path> \"content\"",
    "  viser propose open-url <https-url|mailto-url> [note]",
    "  viser propose mail-draft <to> \"|\" \"subject\" \"|\" \"body\"",
    "  viser propose speak \"text to read aloud\"",
    "  viser propose calendar-event <ISO-start> <duration-minutes> \"title\"",
    "  viser propose notify \"title\" \"|\" \"body\"",
    "  viser propose message telegram:<chat-id>|discord:<channel-id> \"|\" \"text\"",
    "  viser approvals",
    "  viser approve <id>",
    "  viser reject <id>",
    "  viser delete-action <id>",
    "  viser scheduler [--unsafe-skip-gate]",
    "  viser service-run [--live] [--probe-providers|--probe-all-providers]",
    "  viser service plist|write-plist|systemd|write-systemd|windows|write-windows|check|install|reinstall|uninstall|status|start|stop|restart|logs",
    "  viser pair-code telegram|discord [label]",
    "  viser access",
    "  viser allow telegram|discord <id> [label]",
    "  viser revoke telegram|discord <id>",
    "  viser login [provider] [--probe]",
    "  viser ask [--provider codex|gpt|gemini|claude] \"prompt\"",
    "  viser chat [--provider codex|gpt|gemini|claude]",
    "  viser telegram [--unsafe-skip-gate]",
    "  viser discord [--unsafe-skip-gate]",
    "  viser gateway [--dry-run] [--strict] [--unsafe-skip-gate] [--web-dashboard] [--live] [--probe-providers|--probe-all-providers]",
    "",
    "Global flags:",
    "  --config, -c    Path to viser.config.json",
    "  --provider, -p  Provider override for this CLI invocation",
    "  --session, -s   Session id for history isolation",
    "  --env          Path to .env file loaded before config (or set VISER_ENV)",
    "",
    "Model access rule:",
    "  Viser calls logged-in local AI CLIs (codex/claude/gemini), not LLM HTTP APIs."
  ].join("\n");
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function needsFirstRunSetup(): boolean {
  const configPath = env.VISER_CONFIG ? resolvePath(env.VISER_CONFIG) : resolvePath("viser.config.json");
  const envPath = env.VISER_ENV ? resolvePath(env.VISER_ENV) : resolvePath(".env");
  const starterSkillsPath = resolvePath(".viser", "skills");
  return !fileExists(configPath) || !fileExists(envPath) || !fileExists(starterSkillsPath);
}

async function firstRunSetupReport(): Promise<string> {
  return [
    "Viser first-run setup",
    "No command was provided and this workspace is not fully initialized yet.",
    "",
    await setupReport(false),
    "",
    "First-run setup is complete. Review `.env` for tokens or provider choices, then run `viser` again to start chat."
  ].join("\n");
}

function allowsMissingConfiguredEnv(command: string): boolean {
  return new Set(["doctor", "env-check", "env", "environment", "env-init", "write-env", "init", "setup", "onboard", "start-here", "quickstart", "help"]).has(command);
}

async function foregroundGate(
  surface: string,
  config: ViserConfig,
  flags: Record<string, string | boolean>
): Promise<boolean> {
  if (flagBool(flags, "unsafeSkipGate") || flagBool(flags, "raw")) {
    console.warn(`Viser ${surface}: starting with --unsafe-skip-gate; provider/runtime proof was skipped.`);
    return true;
  }

  const gate = await preflight(config, {
    ...providerProofLaunchReadinessOptions(flags),
    strict: true
  });
  console.log(gate.report);
  if (gate.ok) return true;

  process.exitCode = 1;
  return false;
}

async function runJobsNeedsGate(config: ViserConfig, positionals: string[]): Promise<boolean> {
  if (!config.jobs.enabled) return false;
  if (positionals.length > 1) return false;

  const explicitLimit = positionals[0];
  const parsedLimit = parseOptionalNumber(explicitLimit);
  if (explicitLimit && parsedLimit === undefined) return false;

  const pending = await new JobStore(config.jobs.dir).pending(parsedLimit ?? 1);
  return pending.length > 0;
}

function runJobsArgument(positionals: string[], flags: Record<string, string | boolean>): string {
  const args = [...positionals];
  const parallel = flagString(flags, "parallel") ?? flagString(flags, "concurrency");
  if (parallel) args.push("--parallel", parallel);
  else if (flagBool(flags, "parallel") || flagBool(flags, "concurrency")) args.push("--parallel");
  return args.join(" ");
}

function jobWorkerConfig(config: ViserConfig["jobs"], flags: Record<string, string | boolean>): ViserConfig["jobs"] | undefined {
  const parallel = flagString(flags, "parallel") ?? flagString(flags, "concurrency");
  if (!parallel && !flagBool(flags, "parallel") && !flagBool(flags, "concurrency")) return config;

  const parsed = parallel ? parseOptionalNumber(parallel) : undefined;
  if (parsed === undefined || parsed > 6) {
    console.error("Usage: viser job-worker [--parallel <1-6>] [--unsafe-skip-gate]");
    process.exitCode = 1;
    return undefined;
  }

  return { ...config, concurrency: parsed };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
