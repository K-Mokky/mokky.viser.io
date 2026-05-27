// ================================================================
// Scheduled task notification sink
// ================================================================
// Scheduler delivery is best-effort. If a task comes from Telegram/Discord and
// credentials are available, Viser sends the result back to that surface.
// Otherwise it falls back to console output.

import { sendDiscordMessage } from "./discord.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { AccessStore } from "../core/access.ts";
import type { ConnectorMessageProposal } from "../core/actions.ts";
import type { ScheduledTask, ViserConfig } from "../core/types.ts";
import type { SchedulerNotifier } from "../core/scheduler.ts";

export function createConnectorNotifier(config: ViserConfig): SchedulerNotifier {
  return async (task: ScheduledTask, output: string): Promise<void> => {
    if (task.delivery.kind === "telegram" && task.delivery.targetId && config.connectors.telegram.botToken) {
      await sendTelegramMessage(config.connectors.telegram.botToken, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "discord" && task.delivery.targetId && config.connectors.discord.botToken) {
      await sendDiscordMessage(config.connectors.discord.botToken, task.delivery.targetId, output);
      return;
    }

    console.log(`\n[scheduled:${task.id}] ${task.prompt}\n${output}\n`);
  };
}

export function createConnectorMessageSender(config: ViserConfig): (message: ConnectorMessageProposal) => Promise<void> {
  const access = new AccessStore(config.access);

  return async (message: ConnectorMessageProposal): Promise<void> => {
    if (message.connector === "telegram") {
      await assertConnectorTargetAllowed(access, "telegram", message.targetId, [
        ...config.connectors.telegram.allowedChatIds,
        ...config.connectors.telegram.defaultChatIds
      ]);
      if (!config.connectors.telegram.botToken) throw new Error(`Telegram token is missing. Set ${config.connectors.telegram.botTokenEnv}.`);
      await sendTelegramMessage(config.connectors.telegram.botToken, message.targetId, message.text);
      return;
    }

    await assertConnectorTargetAllowed(access, "discord", message.targetId, [
      ...config.connectors.discord.allowedChannelIds,
      ...config.connectors.discord.defaultChannelIds
    ]);
    if (!config.connectors.discord.botToken) throw new Error(`Discord token is missing. Set ${config.connectors.discord.botTokenEnv}.`);
    await sendDiscordMessage(config.connectors.discord.botToken, message.targetId, message.text);
  };
}

async function assertConnectorTargetAllowed(
  access: AccessStore,
  connector: ConnectorMessageProposal["connector"],
  targetId: string,
  staticAllowlist: string[]
): Promise<void> {
  if (await access.isAllowed(connector, targetId, staticAllowlist)) return;
  throw new Error(`Connector message target is not allowed: ${connector}:${targetId}. Pair it first or add it to the configured allow/default list.`);
}
