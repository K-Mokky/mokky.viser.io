// ================================================================
// Multi-channel gateway
// ================================================================
// Runs enabled messaging bridges and the scheduler from one foreground process.
// This is a small always-on control-plane step toward OpenClaw/Hermes-style
// gateways.

import { AccessStore } from "../core/access.ts";
import { JobRunner } from "../core/jobs.ts";
import { SchedulerRunner } from "../core/scheduler.ts";
import { runDiscordBridge } from "./discord.ts";
import { createConnectorNotifier } from "./notifier.ts";
import { runTelegramBridge } from "./telegram.ts";
import { startWebDashboard } from "./web-dashboard.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { ViserConfig } from "../core/types.ts";

export async function runGateway(config: ViserConfig, assistant: AssistantRuntime): Promise<void> {
  const tasks: Promise<void>[] = [];
  const access = new AccessStore(config.access);

  if (config.scheduler.enabled) {
    tasks.push(new SchedulerRunner(config.scheduler, assistant, createConnectorNotifier(config)).loop());
  }

  if (config.jobs.enabled) {
    tasks.push(new JobRunner(config.jobs, assistant, { maxInputChars: config.assistant.maxInputChars }).loop());
  }

  if (config.webDashboard.enabled) {
    const handle = await startWebDashboard(assistant, {
      host: config.webDashboard.host,
      port: config.webDashboard.port,
      sessionId: "gateway:web-dashboard"
    });
    console.log(`Viser web dashboard is running. url=${handle.url} mode=read-only`);
    tasks.push(new Promise<void>((resolve, reject) => {
      handle.server.once("close", () => resolve());
      handle.server.once("error", (error) => reject(error));
    }));
  }

  if (config.connectors.telegram.enabled || config.connectors.telegram.botToken) {
    if (config.connectors.telegram.botToken) tasks.push(runTelegramBridge(config.connectors.telegram, assistant, access));
    else console.warn(`Telegram is enabled but ${config.connectors.telegram.botTokenEnv} is missing; skipping.`);
  }

  if (config.connectors.discord.enabled || config.connectors.discord.botToken) {
    if (config.connectors.discord.botToken) tasks.push(runDiscordBridge(config.connectors.discord, assistant, access));
    else console.warn(`Discord is enabled but ${config.connectors.discord.botTokenEnv} is missing; skipping.`);
  }

  if (tasks.length === 0) {
    console.log("No gateway connectors, scheduler, job worker, or web dashboard are enabled. Set TELEGRAM_BOT_TOKEN/DISCORD_BOT_TOKEN or enable scheduler/jobs/webDashboard in config.");
    return;
  }

  await Promise.all(tasks);
}
