// ================================================================
// Scheduled task notification sink
// ================================================================
// Scheduler delivery is best-effort. If a task comes from Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion and
// credentials are available, Viser sends the result back to that surface.
// Otherwise it falls back to console output.

import { sendDiscordMessage } from "./discord.ts";
import { sendDingTalkMessage, type DingTalkFetchOptions } from "./dingtalk.ts";
import { hasEmailRecipient, sendEmailMessage, type EmailRunOptions } from "./email.ts";
import { sendFeishuMessage, type FeishuFetchOptions } from "./feishu.ts";
import { hasGenericWebhook, sendGenericWebhookMessage, type GenericWebhookFetchOptions } from "./generic-webhook.ts";
import { hasGitHubCredentials, sendGitHubIssueComment, type GitHubFetchOptions } from "./github.ts";
import { sendGoogleChatMessage, type GoogleChatFetchOptions } from "./google-chat.ts";
import { callHomeAssistantService, hasHomeAssistantCredentials, hasHomeAssistantService, type HomeAssistantFetchOptions } from "./home-assistant.ts";
import { sendImessageMessage, type ImessageRunOptions } from "./imessage.ts";
import { sendLinePushMessage, type LineFetchOptions } from "./line.ts";
import { hasIrcChannel, sendIrcMessage, type IrcRunOptions } from "./irc.ts";
import { sendMattermostMessage, type MattermostFetchOptions } from "./mattermost.ts";
import { sendMatrixMessage } from "./matrix.ts";
import { hasNextcloudTalkRoom, sendNextcloudTalkMessage, type NextcloudTalkFetchOptions } from "./nextcloud-talk.ts";
import { hasNtfyTopic, sendNtfyMessage, type NtfyFetchOptions } from "./ntfy.ts";
import { hasMastodonTarget, sendMastodonStatus, type MastodonFetchOptions } from "./mastodon.ts";
import { hasTodoistCredentials, sendTodoistTask, type TodoistFetchOptions } from "./todoist.ts";
import { appendNotionPageMessage, hasNotionCredentials, type NotionFetchOptions } from "./notion.ts";
import { appendObsidianNoteMessage, hasObsidianNoteTarget } from "./obsidian.ts";
import { sendRocketChatMessage, type RocketChatFetchOptions } from "./rocket-chat.ts";
import { sendSignalMessage } from "./signal.ts";
import { sendSlackMessage } from "./slack.ts";
import { sendSynologyChatMessage, type SynologyChatFetchOptions } from "./synology-chat.ts";
import { sendTeamsMessage, type TeamsFetchOptions } from "./teams.ts";
import { hasTwitchChannel, sendTwitchMessage, type TwitchRunOptions } from "./twitch.ts";
import { sendWeComMessage, type WeComFetchOptions } from "./wecom.ts";
import { sendWebexMessage, type WebexFetchOptions } from "./webex.ts";
import { sendTelegramMessage } from "./telegram.ts";
import { sendWhatsappMessage, type WhatsappFetchOptions } from "./whatsapp.ts";
import { hasZaloRecipient, sendZaloMessage, type ZaloFetchOptions } from "./zalo.ts";
import { sendZulipMessage, type ZulipFetchOptions } from "./zulip.ts";
import { AccessStore } from "../core/access.ts";
import type { ConnectorMessageProposal } from "../core/actions.ts";
import type { ScheduledTask, ViserConfig } from "../core/types.ts";
import type { SchedulerNotifier } from "../core/scheduler.ts";
import type { SignalRunOptions } from "./signal.ts";

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

    if (task.delivery.kind === "slack" && task.delivery.targetId && config.connectors.slack.botToken) {
      await sendSlackMessage(config.connectors.slack.botToken, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "matrix" && task.delivery.targetId && config.connectors.matrix.accessToken && config.connectors.matrix.homeserverUrl) {
      await sendMatrixMessage(config.connectors.matrix.accessToken, config.connectors.matrix, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "signal" && task.delivery.targetId && config.connectors.signal.account) {
      await sendSignalMessage(config.connectors.signal, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "imessage" && task.delivery.targetId) {
      await sendImessageMessage(config.connectors.imessage, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "whatsapp" && task.delivery.targetId && config.connectors.whatsapp.accessToken && config.connectors.whatsapp.phoneNumberId) {
      await sendWhatsappMessage(config.connectors.whatsapp, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "line" && task.delivery.targetId && config.connectors.line.channelAccessToken) {
      await sendLinePushMessage(config.connectors.line, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "google-chat" && task.delivery.targetId && hasWebhook(config.connectors.googleChat)) {
      await sendGoogleChatMessage(config.connectors.googleChat, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "webhook" && task.delivery.targetId && hasGenericWebhook(config.connectors.webhook)) {
      await sendGenericWebhookMessage(config.connectors.webhook, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "home-assistant" && task.delivery.targetId && hasHomeAssistantCredentials(config.connectors.homeAssistant) && hasHomeAssistantService(config.connectors.homeAssistant)) {
      await callHomeAssistantService(config.connectors.homeAssistant, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "teams" && task.delivery.targetId && hasWebhook(config.connectors.teams)) {
      await sendTeamsMessage(config.connectors.teams, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "mattermost" && task.delivery.targetId && hasWebhook(config.connectors.mattermost)) {
      await sendMattermostMessage(config.connectors.mattermost, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "synology-chat" && task.delivery.targetId && hasWebhook(config.connectors.synologyChat)) {
      await sendSynologyChatMessage(config.connectors.synologyChat, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "rocket-chat" && task.delivery.targetId && hasWebhook(config.connectors.rocketChat)) {
      await sendRocketChatMessage(config.connectors.rocketChat, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "feishu" && task.delivery.targetId && hasWebhook(config.connectors.feishu)) {
      await sendFeishuMessage(config.connectors.feishu, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "dingtalk" && task.delivery.targetId && hasWebhook(config.connectors.dingtalk)) {
      await sendDingTalkMessage(config.connectors.dingtalk, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "wecom" && task.delivery.targetId && hasWebhook(config.connectors.wecom)) {
      await sendWeComMessage(config.connectors.wecom, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "zalo" && task.delivery.targetId && config.connectors.zalo.accessToken && hasZaloRecipient(config.connectors.zalo)) {
      await sendZaloMessage(config.connectors.zalo, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "irc" && task.delivery.targetId && config.connectors.irc.host && config.connectors.irc.nick && hasIrcChannel(config.connectors.irc)) {
      await sendIrcMessage(config.connectors.irc, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "twitch" && task.delivery.targetId && config.connectors.twitch.accessToken && config.connectors.twitch.botUsername && hasTwitchChannel(config.connectors.twitch)) {
      await sendTwitchMessage(config.connectors.twitch, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "ntfy" && task.delivery.targetId && hasNtfyTopic(config.connectors.ntfy)) {
      await sendNtfyMessage(config.connectors.ntfy, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "mastodon" && task.delivery.targetId && hasMastodonTarget(config.connectors.mastodon)) {
      await sendMastodonStatus(config.connectors.mastodon, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "nextcloud-talk" && task.delivery.targetId && hasNextcloudTalkCredentials(config.connectors.nextcloudTalk)) {
      await sendNextcloudTalkMessage(config.connectors.nextcloudTalk, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "webex" && task.delivery.targetId && config.connectors.webex.accessToken) {
      await sendWebexMessage(config.connectors.webex, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "zulip" && task.delivery.targetId && hasZulipCredentials(config.connectors.zulip)) {
      await sendZulipMessage(config.connectors.zulip, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "email" && task.delivery.targetId && config.connectors.email.from && hasEmailRecipient(config.connectors.email)) {
      await sendEmailMessage(config.connectors.email, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "github" && task.delivery.targetId && hasGitHubCredentials(config.connectors.github)) {
      await sendGitHubIssueComment(config.connectors.github, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "todoist" && task.delivery.targetId && hasTodoistCredentials(config.connectors.todoist)) {
      await sendTodoistTask(config.connectors.todoist, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "notion" && task.delivery.targetId && hasNotionCredentials(config.connectors.notion)) {
      await appendNotionPageMessage(config.connectors.notion, task.delivery.targetId, output);
      return;
    }

    if (task.delivery.kind === "obsidian" && task.delivery.targetId && hasObsidianNoteTarget(config.connectors.obsidian)) {
      await appendObsidianNoteMessage(config.connectors.obsidian, task.delivery.targetId, output);
      return;
    }

    console.log(`\n[scheduled:${task.id}] ${task.prompt}\n${output}\n`);
  };
}

export interface ConnectorMessageSenderOptions {
  signalRunner?: SignalRunOptions["runner"];
  imessageRunner?: ImessageRunOptions["runner"];
  whatsappFetch?: WhatsappFetchOptions["fetchImpl"];
  lineFetch?: LineFetchOptions["fetchImpl"];
  googleChatFetch?: GoogleChatFetchOptions["fetchImpl"];
  genericWebhookFetch?: GenericWebhookFetchOptions["fetchImpl"];
  homeAssistantFetch?: HomeAssistantFetchOptions["fetchImpl"];
  teamsFetch?: TeamsFetchOptions["fetchImpl"];
  mattermostFetch?: MattermostFetchOptions["fetchImpl"];
  synologyChatFetch?: SynologyChatFetchOptions["fetchImpl"];
  rocketChatFetch?: RocketChatFetchOptions["fetchImpl"];
  feishuFetch?: FeishuFetchOptions["fetchImpl"];
  dingTalkFetch?: DingTalkFetchOptions["fetchImpl"];
  weComFetch?: WeComFetchOptions["fetchImpl"];
  zaloFetch?: ZaloFetchOptions["fetchImpl"];
  ircRunner?: IrcRunOptions["runner"];
  twitchRunner?: TwitchRunOptions["runner"];
  ntfyFetch?: NtfyFetchOptions["fetchImpl"];
  mastodonFetch?: MastodonFetchOptions["fetchImpl"];
  nextcloudTalkFetch?: NextcloudTalkFetchOptions["fetchImpl"];
  webexFetch?: WebexFetchOptions["fetchImpl"];
  zulipFetch?: ZulipFetchOptions["fetchImpl"];
  emailRunner?: EmailRunOptions["runner"];
  githubFetch?: GitHubFetchOptions["fetchImpl"];
  todoistFetch?: TodoistFetchOptions["fetchImpl"];
  notionFetch?: NotionFetchOptions["fetchImpl"];
}

export function createConnectorMessageSender(config: ViserConfig, options: ConnectorMessageSenderOptions = {}): (message: ConnectorMessageProposal) => Promise<void> {
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

    if (message.connector === "discord") {
      await assertConnectorTargetAllowed(access, "discord", message.targetId, [
        ...config.connectors.discord.allowedChannelIds,
        ...config.connectors.discord.defaultChannelIds
      ]);
      if (!config.connectors.discord.botToken) throw new Error(`Discord token is missing. Set ${config.connectors.discord.botTokenEnv}.`);
      await sendDiscordMessage(config.connectors.discord.botToken, message.targetId, message.text);
      return;
    }

    if (message.connector === "slack") {
      await assertConnectorTargetAllowed(access, "slack", message.targetId, [
        ...config.connectors.slack.allowedChannelIds,
        ...config.connectors.slack.defaultChannelIds
      ]);
      if (!config.connectors.slack.botToken) throw new Error(`Slack token is missing. Set ${config.connectors.slack.botTokenEnv}.`);
      await sendSlackMessage(config.connectors.slack.botToken, message.targetId, message.text);
      return;
    }

    if (message.connector === "matrix") {
      await assertConnectorTargetAllowed(access, "matrix", message.targetId, [
        ...config.connectors.matrix.allowedRoomIds,
        ...config.connectors.matrix.defaultRoomIds
      ]);
      if (!config.connectors.matrix.accessToken) throw new Error(`Matrix access token is missing. Set ${config.connectors.matrix.accessTokenEnv}.`);
      if (!config.connectors.matrix.homeserverUrl) throw new Error(`Matrix homeserver URL is missing. Set ${config.connectors.matrix.homeserverUrlEnv}.`);
      await sendMatrixMessage(config.connectors.matrix.accessToken, config.connectors.matrix, message.targetId, message.text);
      return;
    }

    if (message.connector === "signal") {
      await assertConnectorTargetAllowed(access, "signal", message.targetId, [
        ...config.connectors.signal.allowedRecipientIds,
        ...config.connectors.signal.defaultRecipientIds
      ]);
      if (!config.connectors.signal.account) throw new Error(`Signal account is missing. Set ${config.connectors.signal.accountEnv}.`);
      await sendSignalMessage(config.connectors.signal, message.targetId, message.text, { runner: options.signalRunner });
      return;
    }

    if (message.connector === "imessage") {
      await assertConnectorTargetAllowed(access, "imessage", message.targetId, [
        ...config.connectors.imessage.allowedHandleIds,
        ...config.connectors.imessage.defaultHandleIds
      ]);
      await sendImessageMessage(config.connectors.imessage, message.targetId, message.text, { runner: options.imessageRunner });
      return;
    }

    if (message.connector === "whatsapp") {
      await assertConnectorTargetAllowed(access, "whatsapp", message.targetId, [
        ...config.connectors.whatsapp.allowedRecipientIds,
        ...config.connectors.whatsapp.defaultRecipientIds
      ]);
      await sendWhatsappMessage(config.connectors.whatsapp, message.targetId, message.text, { fetchImpl: options.whatsappFetch });
      return;
    }

    if (message.connector === "line") {
      await assertConnectorTargetAllowed(access, "line", message.targetId, [
        ...config.connectors.line.allowedPeerIds,
        ...config.connectors.line.defaultPeerIds
      ]);
      await sendLinePushMessage(config.connectors.line, message.targetId, message.text, { fetchImpl: options.lineFetch });
      return;
    }

    if (message.connector === "google-chat") {
      await assertConnectorTargetAllowed(access, "google-chat", message.targetId, [
        ...config.connectors.googleChat.allowedWebhookIds,
        ...config.connectors.googleChat.defaultWebhookIds
      ]);
      await sendGoogleChatMessage(config.connectors.googleChat, message.targetId, message.text, { fetchImpl: options.googleChatFetch });
      return;
    }

    if (message.connector === "webhook") {
      await assertConnectorTargetAllowed(access, "webhook", message.targetId, [
        ...config.connectors.webhook.allowedWebhookIds,
        ...config.connectors.webhook.defaultWebhookIds
      ]);
      await sendGenericWebhookMessage(config.connectors.webhook, message.targetId, message.text, { fetchImpl: options.genericWebhookFetch });
      return;
    }

    if (message.connector === "home-assistant") {
      await assertConnectorTargetAllowed(access, "home-assistant", message.targetId, [
        ...config.connectors.homeAssistant.allowedServiceIds,
        ...config.connectors.homeAssistant.defaultServiceIds
      ]);
      await callHomeAssistantService(config.connectors.homeAssistant, message.targetId, message.text, { fetchImpl: options.homeAssistantFetch });
      return;
    }

    if (message.connector === "teams") {
      await assertConnectorTargetAllowed(access, "teams", message.targetId, [
        ...config.connectors.teams.allowedWebhookIds,
        ...config.connectors.teams.defaultWebhookIds
      ]);
      await sendTeamsMessage(config.connectors.teams, message.targetId, message.text, { fetchImpl: options.teamsFetch });
      return;
    }

    if (message.connector === "mattermost") {
      await assertConnectorTargetAllowed(access, "mattermost", message.targetId, [
        ...config.connectors.mattermost.allowedWebhookIds,
        ...config.connectors.mattermost.defaultWebhookIds
      ]);
      await sendMattermostMessage(config.connectors.mattermost, message.targetId, message.text, { fetchImpl: options.mattermostFetch });
      return;
    }

    if (message.connector === "synology-chat") {
      await assertConnectorTargetAllowed(access, "synology-chat", message.targetId, [
        ...config.connectors.synologyChat.allowedWebhookIds,
        ...config.connectors.synologyChat.defaultWebhookIds
      ]);
      await sendSynologyChatMessage(config.connectors.synologyChat, message.targetId, message.text, { fetchImpl: options.synologyChatFetch });
      return;
    }

    if (message.connector === "rocket-chat") {
      await assertConnectorTargetAllowed(access, "rocket-chat", message.targetId, [
        ...config.connectors.rocketChat.allowedWebhookIds,
        ...config.connectors.rocketChat.defaultWebhookIds
      ]);
      await sendRocketChatMessage(config.connectors.rocketChat, message.targetId, message.text, { fetchImpl: options.rocketChatFetch });
      return;
    }

    if (message.connector === "feishu") {
      await assertConnectorTargetAllowed(access, "feishu", message.targetId, [
        ...config.connectors.feishu.allowedWebhookIds,
        ...config.connectors.feishu.defaultWebhookIds
      ]);
      await sendFeishuMessage(config.connectors.feishu, message.targetId, message.text, { fetchImpl: options.feishuFetch });
      return;
    }

    if (message.connector === "dingtalk") {
      await assertConnectorTargetAllowed(access, "dingtalk", message.targetId, [
        ...config.connectors.dingtalk.allowedWebhookIds,
        ...config.connectors.dingtalk.defaultWebhookIds
      ]);
      await sendDingTalkMessage(config.connectors.dingtalk, message.targetId, message.text, { fetchImpl: options.dingTalkFetch });
      return;
    }

    if (message.connector === "wecom") {
      await assertConnectorTargetAllowed(access, "wecom", message.targetId, [
        ...config.connectors.wecom.allowedWebhookIds,
        ...config.connectors.wecom.defaultWebhookIds
      ]);
      await sendWeComMessage(config.connectors.wecom, message.targetId, message.text, { fetchImpl: options.weComFetch });
      return;
    }

    if (message.connector === "zalo") {
      await assertConnectorTargetAllowed(access, "zalo", message.targetId, [
        ...config.connectors.zalo.allowedRecipientIds,
        ...config.connectors.zalo.defaultRecipientIds
      ]);
      await sendZaloMessage(config.connectors.zalo, message.targetId, message.text, { fetchImpl: options.zaloFetch });
      return;
    }

    if (message.connector === "irc") {
      await assertConnectorTargetAllowed(access, "irc", message.targetId, [
        ...config.connectors.irc.allowedChannelIds,
        ...config.connectors.irc.defaultChannelIds
      ]);
      await sendIrcMessage(config.connectors.irc, message.targetId, message.text, { runner: options.ircRunner });
      return;
    }

    if (message.connector === "twitch") {
      await assertConnectorTargetAllowed(access, "twitch", message.targetId, [
        ...config.connectors.twitch.allowedChannelIds,
        ...config.connectors.twitch.defaultChannelIds
      ]);
      await sendTwitchMessage(config.connectors.twitch, message.targetId, message.text, { runner: options.twitchRunner });
      return;
    }

    if (message.connector === "ntfy") {
      await assertConnectorTargetAllowed(access, "ntfy", message.targetId, [
        ...config.connectors.ntfy.allowedTopicIds,
        ...config.connectors.ntfy.defaultTopicIds
      ]);
      await sendNtfyMessage(config.connectors.ntfy, message.targetId, message.text, { fetchImpl: options.ntfyFetch });
      return;
    }

    if (message.connector === "mastodon") {
      await assertConnectorTargetAllowed(access, "mastodon", message.targetId, [
        ...config.connectors.mastodon.allowedTargetIds,
        ...config.connectors.mastodon.defaultTargetIds
      ]);
      await sendMastodonStatus(config.connectors.mastodon, message.targetId, message.text, { fetchImpl: options.mastodonFetch });
      return;
    }

    if (message.connector === "nextcloud-talk") {
      await assertConnectorTargetAllowed(access, "nextcloud-talk", message.targetId, [
        ...config.connectors.nextcloudTalk.allowedRoomIds,
        ...config.connectors.nextcloudTalk.defaultRoomIds
      ]);
      await sendNextcloudTalkMessage(config.connectors.nextcloudTalk, message.targetId, message.text, { fetchImpl: options.nextcloudTalkFetch });
      return;
    }

    if (message.connector === "webex") {
      await assertConnectorTargetAllowed(access, "webex", message.targetId, [
        ...config.connectors.webex.allowedRoomIds,
        ...config.connectors.webex.defaultRoomIds
      ]);
      await sendWebexMessage(config.connectors.webex, message.targetId, message.text, { fetchImpl: options.webexFetch });
      return;
    }

    if (message.connector === "zulip") {
      await assertConnectorTargetAllowed(access, "zulip", message.targetId, [
        ...config.connectors.zulip.allowedTargetIds,
        ...config.connectors.zulip.defaultTargetIds
      ]);
      await sendZulipMessage(config.connectors.zulip, message.targetId, message.text, { fetchImpl: options.zulipFetch });
      return;
    }

    if (message.connector === "email") {
      await assertConnectorTargetAllowed(access, "email", message.targetId, [
        ...config.connectors.email.allowedRecipientIds,
        ...config.connectors.email.defaultRecipientIds
      ]);
      await sendEmailMessage(config.connectors.email, message.targetId, message.text, { runner: options.emailRunner });
      return;
    }

    if (message.connector === "github") {
      await assertConnectorTargetAllowed(access, "github", message.targetId, [
        ...config.connectors.github.allowedTargetIds,
        ...config.connectors.github.defaultTargetIds
      ]);
      await sendGitHubIssueComment(config.connectors.github, message.targetId, message.text, { fetchImpl: options.githubFetch });
      return;
    }

    if (message.connector === "todoist") {
      await assertConnectorTargetAllowed(access, "todoist", message.targetId, [
        ...config.connectors.todoist.allowedProjectIds,
        ...config.connectors.todoist.defaultProjectIds
      ]);
      await sendTodoistTask(config.connectors.todoist, message.targetId, message.text, { fetchImpl: options.todoistFetch });
      return;
    }

    if (message.connector === "notion") {
      await assertConnectorTargetAllowed(access, "notion", message.targetId, [
        ...config.connectors.notion.allowedPageIds,
        ...config.connectors.notion.defaultPageIds
      ]);
      await appendNotionPageMessage(config.connectors.notion, message.targetId, message.text, { fetchImpl: options.notionFetch });
      return;
    }

    if (message.connector === "obsidian") {
      await assertConnectorTargetAllowed(access, "obsidian", message.targetId, [
        ...config.connectors.obsidian.allowedNoteIds,
        ...config.connectors.obsidian.defaultNoteIds
      ]);
      await appendObsidianNoteMessage(config.connectors.obsidian, message.targetId, message.text);
      return;
    }

    throw new Error(`Unsupported connector message target: ${message.connector}.`);
  };
}

function hasWebhook(config: { webhookUrl?: string; webhookUrls: Record<string, string> }): boolean {
  return Boolean(config.webhookUrl || Object.keys(config.webhookUrls).length > 0);
}

function hasZulipCredentials(config: { siteUrl?: string; botEmail?: string; apiKey?: string }): boolean {
  return Boolean(config.siteUrl && config.botEmail && config.apiKey);
}

function hasNextcloudTalkCredentials(config: { baseUrl?: string; username?: string; appPassword?: string; roomToken?: string; rooms: Record<string, string> }): boolean {
  return Boolean(config.baseUrl && config.username && config.appPassword && hasNextcloudTalkRoom(config));
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
