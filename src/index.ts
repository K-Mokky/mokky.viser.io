#!/usr/bin/env node
// ================================================================
// Viser CLI entrypoint
// ================================================================
// Installed package entry:
//   viser
// Source-tree development entry (Node 22.6+ native TypeScript stripping):
//   node src/index.ts

import { createInterface } from "node:readline/promises";
import { env, stdin as input, stdout as output } from "node:process";
import { resolve as resolvePath } from "node:path";
import { parseArgs, flagBool, flagString } from "./cli/args.ts";
import { auditReport } from "./cli/audit.ts";
import { benchmarkReport } from "./cli/benchmark.ts";
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
import { backgroundServiceDisabledMessage, serviceCommand } from "./cli/service.ts";
import { localSmoke } from "./cli/smoke.ts";
import { stateHealthReport } from "./cli/state-health.ts";
import { readinessReport } from "./cli/readiness.ts";
import { liveLaunchReadinessOptions, providerProofLaunchReadinessOptions, readinessOptionsFromFlags } from "./cli/readiness-options.ts";
import { releaseEvidenceReportResult } from "./cli/release-evidence.ts";
import { verify } from "./cli/verify.ts";
import { voiceLoopReport } from "./cli/voice.ts";
import { loadConfig } from "./config.ts";
import { AssistantRuntime } from "./core/assistant.ts";
import { mcpClientConfigReport } from "./core/mcp-client-config.ts";
import { providerGuideReport } from "./providers/guide.ts";
import { runTelegramBridge } from "./connectors/telegram.ts";
import { runWhatsappBridge } from "./connectors/whatsapp.ts";
import { runDiscordBridge } from "./connectors/discord.ts";
import { runImessageBridge } from "./connectors/imessage.ts";
import { runLineBridge } from "./connectors/line.ts";
import { runKakaotalkBridge } from "./connectors/kakaotalk.ts";
import { runMatrixBridge } from "./connectors/matrix.ts";
import { runSignalBridge } from "./connectors/signal.ts";
import { runSlackBridge } from "./connectors/slack.ts";
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
          ? "Next: run `viser` in a terminal window for foreground mode. To resolve warnings first, run `viser next-steps --live --probe-all-providers`."
          : "Next: run `viser next-steps --live --probe-all-providers` and fix the blockers above."
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
    case "benchmark":
    case "bench":
    case "perf": {
      const report = await benchmarkReport(config, {
        json: flagBool(parsed.flags, "json"),
        live: flagBool(parsed.flags, "live"),
        providerId: flagString(parsed.flags, "provider"),
        prompt: flagString(parsed.flags, "prompt") ?? parsed.positionals.join(" "),
        iterations: parseOptionalNumber(flagString(parsed.flags, "iterations") ?? flagString(parsed.flags, "n")),
        warmup: parseOptionalNumber(flagString(parsed.flags, "warmup")),
        timeoutMs: parseOptionalNumber(flagString(parsed.flags, "timeoutMs") ?? flagString(parsed.flags, "timeout")),
        baseline: flagString(parsed.flags, "baseline"),
        hermes: flagString(parsed.flags, "hermes"),
        openclaw: flagString(parsed.flags, "openclaw"),
        save: flagBool(parsed.flags, "save"),
        artifactPath: flagString(parsed.flags, "artifact") ?? flagString(parsed.flags, "artifactPath")
      });
      console.log(report);
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
    case "curate-skills":
    case "curate-skill":
    case "learning-curator":
      console.log(await assistant.handle(`/curate-skills ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli", providerId }));
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
    case "persona":
    case "personalization":
    case "settings":
    case "global":
    case "globals":
      console.log(await assistant.handle(`/persona ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "persona-set":
    case "set-persona":
    case "set-global":
      console.log(await assistant.handle(`/persona set ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "persona-unset":
    case "unset-persona":
    case "remove-global":
      console.log(await assistant.handle(`/persona unset ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "tone":
    case "ai-tone":
      console.log(await assistant.handle(`/tone ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "personality":
    case "ai-personality":
      console.log(await assistant.handle(`/personality ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "user-style":
    case "speech-style":
      console.log(await assistant.handle(`/user-style ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "question-info":
    case "question-context":
      console.log(await assistant.handle(`/question-info ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
      return;
    case "answer-format":
      console.log(await assistant.handle(`/answer-format ${parsed.positionals.join(" ")}`.trim(), sessionId, { source: "cli" }));
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
      console.log(backgroundServiceDisabledMessage(parsed.command));
      return;
    }
    case "service":
      console.log(await serviceCommand(parsed.positionals, config));
      return;
    case "pair-code": {
      const connector = parseConnector(parsed.positionals[0] ?? "");
      if (!connector) {
        console.log("Usage: viser pair-code telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian [label]");
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
        console.log("Usage: viser allow telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian <chat-channel-room-recipient-alias-or-room-id> [label]");
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
        console.log("Usage: viser revoke telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian <chat-channel-room-recipient-alias-or-room-id>");
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
      await askOnce(assistant, parsed.positionals.join(" "), sessionId, providerId, { stream: flagBool(parsed.flags, "stream") });
      return;
    case "chat":
      await chatLoop(assistant, sessionId, providerId, { stream: flagBool(parsed.flags, "stream") });
      return;
    case "voice":
    case "voice-loop":
    case "voice-chat":
      console.log(await voiceLoopReport(config, {
        assistant,
        sessionId,
        providerId,
        proposeSpeech: flagBool(parsed.flags, "proposeSpeak") || flagBool(parsed.flags, "speak"),
        json: flagBool(parsed.flags, "json"),
        maxTurns: parseOptionalNumber(flagString(parsed.flags, "maxTurns") ?? flagString(parsed.flags, "turns"))
      }));
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
    case "slack":
      if (!config.connectors.slack.botToken) {
        console.error(`Slack bot token is missing. Set ${config.connectors.slack.botTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!config.connectors.slack.appToken) {
        console.error(`Slack app-level token is missing. Set ${config.connectors.slack.appTokenEnv} for Socket Mode.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("slack", config, parsed.flags)) return;
      await runSlackBridge(config.connectors.slack, assistant, access);
      return;
    case "matrix":
      if (!config.connectors.matrix.homeserverUrl) {
        console.error(`Matrix homeserver URL is missing. Set ${config.connectors.matrix.homeserverUrlEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!config.connectors.matrix.accessToken) {
        console.error(`Matrix access token is missing. Set ${config.connectors.matrix.accessTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("matrix", config, parsed.flags)) return;
      await runMatrixBridge(config.connectors.matrix, assistant, access);
      return;
    case "signal":
      if (!config.connectors.signal.account) {
        console.error(`Signal account is missing. Set ${config.connectors.signal.accountEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("signal", config, parsed.flags)) return;
      await runSignalBridge(config.connectors.signal, assistant, access);
      return;
    case "imessage":
      if (!await foregroundGate("imessage", config, parsed.flags)) return;
      await runImessageBridge(config.connectors.imessage, assistant, access);
      return;
    case "whatsapp":
      if (!config.connectors.whatsapp.accessToken) {
        console.error(`WhatsApp access token is missing. Set ${config.connectors.whatsapp.accessTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!config.connectors.whatsapp.phoneNumberId) {
        console.error(`WhatsApp phone number ID is missing. Set ${config.connectors.whatsapp.phoneNumberIdEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!config.connectors.whatsapp.verifyToken) {
        console.error(`WhatsApp webhook verify token is missing. Set ${config.connectors.whatsapp.verifyTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("whatsapp", config, parsed.flags)) return;
      await runWhatsappBridge(config.connectors.whatsapp, assistant, access);
      return;
    case "line":
      if (!config.connectors.line.channelAccessToken) {
        console.error(`LINE channel access token is missing. Set ${config.connectors.line.channelAccessTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!config.connectors.line.channelSecret) {
        console.error(`LINE channel secret is missing. Set ${config.connectors.line.channelSecretEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("line", config, parsed.flags)) return;
      await runLineBridge(config.connectors.line, assistant, access);
      return;
    case "kakaotalk":
      if (!config.connectors.kakaotalk.requestToken) {
        console.error(`KakaoTalk Skill shared token is missing. Set ${config.connectors.kakaotalk.requestTokenEnv}.`);
        process.exitCode = 1;
        return;
      }
      if (!await foregroundGate("kakaotalk", config, parsed.flags)) return;
      await runKakaotalkBridge(config.connectors.kakaotalk, assistant, access);
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
      await askOnce(assistant, [parsed.command, ...parsed.positionals].join(" "), sessionId, providerId, { stream: flagBool(parsed.flags, "stream") });
  }
}

async function askOnce(
  assistant: AssistantRuntime,
  prompt: string,
  sessionId: string,
  providerId?: string,
  options: { stream?: boolean } = {}
): Promise<void> {
  const text = prompt.trim();
  if (!text) {
    console.error("No prompt provided. Example: viser ask --provider gemini \"요약해줘\"");
    process.exitCode = 1;
    return;
  }

  if (!options.stream) {
    console.log(await assistant.handle(text, sessionId, { source: "cli", providerId }));
    return;
  }

  const summary = await assistant.handle(text, sessionId, {
    source: "cli",
    providerId,
    suppressProviderText: true,
    onProviderOutputChunk: (chunk) => {
      if (chunk.stream === "stdout") output.write(chunk.text);
    }
  });
  output.write(`${summary.startsWith("\n") ? "" : "\n"}${summary}\n`);
}

async function chatLoop(
  assistant: AssistantRuntime,
  sessionId: string,
  providerId?: string,
  options: { stream?: boolean } = {}
): Promise<void> {
  const rl = createInterface({ input, output });
  if (providerId) await assistant.handle(`/provider ${providerId}`, sessionId, { source: "cli" });
  console.log("Viser chat started. Type /help for commands or /exit to quit.");

  try {
    while (true) {
      const line = await rl.question("viser> ");
      const trimmed = line.trim();
      if (["/exit", "/quit", "exit", "quit"].includes(trimmed.toLowerCase())) break;
      const answer = await assistant.handle(trimmed, sessionId, {
        source: "cli",
        suppressProviderText: options.stream,
        onProviderOutputChunk: options.stream
          ? (chunk) => {
            if (chunk.stream === "stdout") output.write(chunk.text);
          }
          : undefined
      });
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
    console.error("Usage: viser web-dashboard [--host 127.0.0.1|localhost|::1] [--port 8787] [--allow-remote with VISER_DASHBOARD_TOKEN]");
    return;
  }

  const dashboardAssistant = new AssistantRuntime(effectiveConfig);
  const handle = await startWebDashboard(dashboardAssistant, {
    host: effectiveConfig.webDashboard.host,
    port: effectiveConfig.webDashboard.port,
    sessionId,
    canvasDir: effectiveConfig.webDashboard.canvasDir,
    authToken: effectiveConfig.webDashboard.authToken
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
  const allowRemote = config.webDashboard.allowRemote || flagBool(flags, "allowRemote") || flagBool(flags, "webDashboardAllowRemote") || flagBool(flags, "dashboardAllowRemote");

  if (!isLocalDashboardHost(host) && !allowRemote) {
    console.error("Usage: viser gateway [--web-dashboard] [--web-dashboard-host 127.0.0.1|localhost|::1] [--web-dashboard-port 8787] [--web-dashboard-allow-remote with VISER_DASHBOARD_TOKEN]");
    console.error("Refusing to bind the dashboard to a non-localhost interface unless allowRemote is explicit and token authentication is configured.");
    process.exitCode = 1;
    return undefined;
  }

  if (!isLocalDashboardHost(host) && allowRemote && !config.webDashboard.authToken) {
    console.error("Usage: set VISER_DASHBOARD_TOKEN before binding the dashboard to a non-localhost interface.");
    process.exitCode = 1;
    return undefined;
  }

  if (!requested && host === config.webDashboard.host && port === config.webDashboard.port && allowRemote === config.webDashboard.allowRemote) return config;

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
      allowRemote,
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
    "  viser",
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
    "  viser benchmark [--live] [--save] [--provider codex] [--iterations 5] [--hermes \"hermes ... {prompt}\"] [--openclaw \"openclaw ... {prompt}\"]",
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
    "  viser curate-skills [focus] OR curate-skills <id> \"|\" <description> [\"|\" focus]",
    "  viser plugins",
    "  viser plugin <id> <command> \"prompt\"",
    "  viser memory [query]",
    "  viser profile [tag-limit]",
    "  viser memory-compact [max-entries]",
    "  viser remember \"stable fact #tag\"",
    "  viser persona",
    "  viser persona tone|personality|user-style|question-info|answer-format \"setting\"",
    "  viser persona set <key> \"non-sensitive setting\"",
    "  viser persona-unset <key>",
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
    "  viser propose browser-task \"Go to example.com and summarize the landing page\" \"|\" \"domains=example.com\"",
    "  viser propose message telegram:<chat-id>|discord:<channel-id>|slack:<channel-id>|matrix:<room-id>|signal:<recipient-id>|imessage:<handle-id>|whatsapp:<recipient-id>|line:<peer-id>|google-chat:<webhook-id>|webhook:<webhook-id>|home-assistant:<service-alias>|teams:<webhook-id>|mattermost:<webhook-id>|synology-chat:<webhook-id>|rocket-chat:<webhook-id>|feishu:<webhook-id>|dingtalk:<webhook-id>|wecom:<webhook-id>|zalo:<recipient-alias>|irc:<channel-alias>|twitch:<channel-alias>|ntfy:<topic-alias>|mastodon:<target-alias>|nextcloud-talk:<room-alias>|webex:<room-id>|zulip:<target-id>|email:<recipient-alias> \"|\" \"text\"",
    "  viser approvals",
    "  viser approve <id>",
    "  viser reject <id>",
    "  viser delete-action <id>",
    "  viser scheduler [--unsafe-skip-gate]",
    "  viser service status|stop|uninstall|logs|health|trim-logs",
    "  viser pair-code telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian [label]",
    "  viser access",
    "  viser allow telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian <id> [label]",
    "  viser revoke telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian <id>",
    "  viser login [provider] [--probe]",
    "  viser ask [--provider codex|gpt|gemini|claude] [--stream] \"prompt\"",
    "  viser chat [--provider codex|gpt|gemini|claude] [--stream]",
    "  viser voice [--propose-speak] [--max-turns 50] < transcript-lines.txt",
    "  viser telegram [--unsafe-skip-gate]",
    "  viser discord [--unsafe-skip-gate]",
    "  viser slack [--unsafe-skip-gate]",
    "  viser matrix [--unsafe-skip-gate]",
    "  viser signal [--unsafe-skip-gate]",
    "  viser imessage [--unsafe-skip-gate]",
    "  viser whatsapp [--unsafe-skip-gate]",
    "  viser line [--unsafe-skip-gate]",
    "  viser kakaotalk [--unsafe-skip-gate]",
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
    "First-run setup is complete. Review `.env` for tokens or provider choices, then run `viser` in a terminal window to start the foreground runtime."
  ].join("\n");
}

function allowsMissingConfiguredEnv(command: string): boolean {
  return new Set(["doctor", "env-check", "env", "environment", "env-init", "write-env", "init", "setup", "help"]).has(command);
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
