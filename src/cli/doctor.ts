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
  rows.push(
    `- slack: bot token ${config.connectors.slack.botToken ? "present" : "missing"} (${config.connectors.slack.botTokenEnv}), app token ${config.connectors.slack.appToken ? "present" : "missing"} (${config.connectors.slack.appTokenEnv}), enabled=${config.connectors.slack.enabled}`
  );
  rows.push(
    `- matrix: homeserver ${config.connectors.matrix.homeserverUrl ? "present" : "missing"} (${config.connectors.matrix.homeserverUrlEnv}), token ${config.connectors.matrix.accessToken ? "present" : "missing"} (${config.connectors.matrix.accessTokenEnv}), enabled=${config.connectors.matrix.enabled}`
  );
  rows.push(
    `- signal: account ${config.connectors.signal.account ? "present" : "missing"} (${config.connectors.signal.accountEnv}), command=${config.connectors.signal.command || "missing"} (${config.connectors.signal.commandEnv}), enabled=${config.connectors.signal.enabled}`
  );
  rows.push(
    `- imessage: sqlite=${config.connectors.imessage.sqliteCommand || "missing"} (${config.connectors.imessage.sqliteCommandEnv}), osascript=${config.connectors.imessage.osascriptCommand || "missing"} (${config.connectors.imessage.osascriptCommandEnv}), chatDb=${config.connectors.imessage.chatDbPath ? "present" : "missing"} (${config.connectors.imessage.chatDbPathEnv}), enabled=${config.connectors.imessage.enabled}`
  );
  rows.push(
    `- whatsapp: token ${config.connectors.whatsapp.accessToken ? "present" : "missing"} (${config.connectors.whatsapp.accessTokenEnv}), phoneNumberId ${config.connectors.whatsapp.phoneNumberId ? "present" : "missing"} (${config.connectors.whatsapp.phoneNumberIdEnv}), verifyToken ${config.connectors.whatsapp.verifyToken ? "present" : "missing"} (${config.connectors.whatsapp.verifyTokenEnv}), webhook=http://${config.connectors.whatsapp.webhookHost}:${config.connectors.whatsapp.webhookPort}${config.connectors.whatsapp.webhookPath}, enabled=${config.connectors.whatsapp.enabled}`
  );
  rows.push(
    `- line: channel token ${config.connectors.line.channelAccessToken ? "present" : "missing"} (${config.connectors.line.channelAccessTokenEnv}), channel secret ${config.connectors.line.channelSecret ? "present" : "missing"} (${config.connectors.line.channelSecretEnv}), webhook=http://${config.connectors.line.webhookHost}:${config.connectors.line.webhookPort}${config.connectors.line.webhookPath}, enabled=${config.connectors.line.enabled}`
  );
  rows.push(
    `- google-chat: webhook ${config.connectors.googleChat.webhookUrl || Object.keys(config.connectors.googleChat.webhookUrls).length ? "present" : "missing"} (${config.connectors.googleChat.webhookUrlEnv}/${config.connectors.googleChat.webhookUrlsEnv}), enabled=${config.connectors.googleChat.enabled}`
  );
  rows.push(
    `- webhook: webhook ${config.connectors.webhook.webhookUrl || Object.keys(config.connectors.webhook.webhookUrls).length ? "present" : "missing"} (${config.connectors.webhook.webhookUrlEnv}/${config.connectors.webhook.webhookUrlsEnv}), enabled=${config.connectors.webhook.enabled}`
  );
  rows.push(
    `- home-assistant: base URL ${config.connectors.homeAssistant.baseUrl ? "present" : "missing"} (${config.connectors.homeAssistant.baseUrlEnv}), token ${config.connectors.homeAssistant.accessToken ? "present" : "missing"} (${config.connectors.homeAssistant.accessTokenEnv}), service ${config.connectors.homeAssistant.service || Object.keys(config.connectors.homeAssistant.services).length ? "present" : "missing"} (${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv}), enabled=${config.connectors.homeAssistant.enabled}`
  );
  rows.push(
    `- teams: webhook ${config.connectors.teams.webhookUrl || Object.keys(config.connectors.teams.webhookUrls).length ? "present" : "missing"} (${config.connectors.teams.webhookUrlEnv}/${config.connectors.teams.webhookUrlsEnv}), enabled=${config.connectors.teams.enabled}`
  );
  rows.push(
    `- mattermost: webhook ${config.connectors.mattermost.webhookUrl || Object.keys(config.connectors.mattermost.webhookUrls).length ? "present" : "missing"} (${config.connectors.mattermost.webhookUrlEnv}/${config.connectors.mattermost.webhookUrlsEnv}), enabled=${config.connectors.mattermost.enabled}`
  );
  rows.push(
    `- synology-chat: webhook ${config.connectors.synologyChat.webhookUrl || Object.keys(config.connectors.synologyChat.webhookUrls).length ? "present" : "missing"} (${config.connectors.synologyChat.webhookUrlEnv}/${config.connectors.synologyChat.webhookUrlsEnv}), enabled=${config.connectors.synologyChat.enabled}`
  );
  rows.push(
    `- rocket-chat: webhook ${config.connectors.rocketChat.webhookUrl || Object.keys(config.connectors.rocketChat.webhookUrls).length ? "present" : "missing"} (${config.connectors.rocketChat.webhookUrlEnv}/${config.connectors.rocketChat.webhookUrlsEnv}), enabled=${config.connectors.rocketChat.enabled}`
  );
  rows.push(
    `- feishu: webhook ${config.connectors.feishu.webhookUrl || Object.keys(config.connectors.feishu.webhookUrls).length ? "present" : "missing"} (${config.connectors.feishu.webhookUrlEnv}/${config.connectors.feishu.webhookUrlsEnv}), enabled=${config.connectors.feishu.enabled}`
  );
  rows.push(
    `- dingtalk: webhook ${config.connectors.dingtalk.webhookUrl || Object.keys(config.connectors.dingtalk.webhookUrls).length ? "present" : "missing"} (${config.connectors.dingtalk.webhookUrlEnv}/${config.connectors.dingtalk.webhookUrlsEnv}), enabled=${config.connectors.dingtalk.enabled}`
  );
  rows.push(
    `- wecom: webhook ${config.connectors.wecom.webhookUrl || Object.keys(config.connectors.wecom.webhookUrls).length ? "present" : "missing"} (${config.connectors.wecom.webhookUrlEnv}/${config.connectors.wecom.webhookUrlsEnv}), enabled=${config.connectors.wecom.enabled}`
  );
  rows.push(
    `- zalo: access token ${config.connectors.zalo.accessToken ? "present" : "missing"} (${config.connectors.zalo.accessTokenEnv}), recipient ${config.connectors.zalo.recipient || Object.keys(config.connectors.zalo.recipients).length ? "present" : "missing"} (${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv}), enabled=${config.connectors.zalo.enabled}`
  );
  rows.push(
    `- irc: host ${config.connectors.irc.host ? "present" : "missing"} (${config.connectors.irc.hostEnv}), port ${config.connectors.irc.port} (${config.connectors.irc.portEnv}), tls=${config.connectors.irc.tls} (${config.connectors.irc.tlsEnv}), nick ${config.connectors.irc.nick ? "present" : "missing"} (${config.connectors.irc.nickEnv}), channel ${config.connectors.irc.channel || Object.keys(config.connectors.irc.channels).length ? "present" : "missing"} (${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv}), enabled=${config.connectors.irc.enabled}`
  );
  rows.push(
    `- twitch: token ${config.connectors.twitch.accessToken ? "present" : "missing"} (${config.connectors.twitch.accessTokenEnv}), bot ${config.connectors.twitch.botUsername ? "present" : "missing"} (${config.connectors.twitch.botUsernameEnv}), channel ${config.connectors.twitch.channel || Object.keys(config.connectors.twitch.channels).length ? "present" : "missing"} (${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv}), enabled=${config.connectors.twitch.enabled}`
  );
  rows.push(
    `- ntfy: base URL ${config.connectors.ntfy.baseUrl ? "present" : "missing"} (${config.connectors.ntfy.baseUrlEnv}), token ${config.connectors.ntfy.token ? "present" : "optional"} (${config.connectors.ntfy.tokenEnv}), topic ${config.connectors.ntfy.topic || Object.keys(config.connectors.ntfy.topics).length ? "present" : "missing"} (${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv}), enabled=${config.connectors.ntfy.enabled}`
  );
  rows.push(
    `- mastodon: base URL ${config.connectors.mastodon.baseUrl ? "present" : "missing"} (${config.connectors.mastodon.baseUrlEnv}), token ${config.connectors.mastodon.accessToken ? "present" : "missing"} (${config.connectors.mastodon.accessTokenEnv}), visibility ${config.connectors.mastodon.visibility} (${config.connectors.mastodon.visibilityEnv}), targets ${Object.keys(config.connectors.mastodon.targets).length ? "present" : "default"} (${config.connectors.mastodon.targetsEnv}), enabled=${config.connectors.mastodon.enabled}`
  );
  rows.push(
    `- nextcloud-talk: base URL ${config.connectors.nextcloudTalk.baseUrl ? "present" : "missing"} (${config.connectors.nextcloudTalk.baseUrlEnv}), username ${config.connectors.nextcloudTalk.username ? "present" : "missing"} (${config.connectors.nextcloudTalk.usernameEnv}), app password ${config.connectors.nextcloudTalk.appPassword ? "present" : "missing"} (${config.connectors.nextcloudTalk.appPasswordEnv}), room ${config.connectors.nextcloudTalk.roomToken || Object.keys(config.connectors.nextcloudTalk.rooms).length ? "present" : "missing"} (${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv}), enabled=${config.connectors.nextcloudTalk.enabled}`
  );
  rows.push(
    `- webex: token ${config.connectors.webex.accessToken ? "present" : "missing"} (${config.connectors.webex.accessTokenEnv}), enabled=${config.connectors.webex.enabled}`
  );
  rows.push(
    `- zulip: site ${config.connectors.zulip.siteUrl ? "present" : "missing"} (${config.connectors.zulip.siteUrlEnv}), bot email ${config.connectors.zulip.botEmail ? "present" : "missing"} (${config.connectors.zulip.botEmailEnv}), API key ${config.connectors.zulip.apiKey ? "present" : "missing"} (${config.connectors.zulip.apiKeyEnv}), target ${config.connectors.zulip.target || Object.keys(config.connectors.zulip.targets).length ? "present" : "missing"} (${config.connectors.zulip.targetEnv}/${config.connectors.zulip.targetsEnv}), enabled=${config.connectors.zulip.enabled}`
  );
  rows.push(
    `- email: sendmail ${config.connectors.email.sendmailCommand || "missing"} (${config.connectors.email.sendmailCommandEnv}), from ${config.connectors.email.from ? "present" : "missing"} (${config.connectors.email.fromEnv}), recipient ${config.connectors.email.recipient || Object.keys(config.connectors.email.recipients).length ? "present" : "missing"} (${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv}), enabled=${config.connectors.email.enabled}`
  );
  rows.push(
    `- github: token ${config.connectors.github.token ? "present" : "missing"} (${config.connectors.github.tokenEnv}), target ${config.connectors.github.target || Object.keys(config.connectors.github.targets).length ? "present" : "missing"} (${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv}), enabled=${config.connectors.github.enabled}`
  );
  rows.push(
    `- todoist: token ${config.connectors.todoist.token ? "present" : "missing"} (${config.connectors.todoist.tokenEnv}), project ${config.connectors.todoist.project || Object.keys(config.connectors.todoist.projects).length ? "present" : "optional inbox"} (${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv}), enabled=${config.connectors.todoist.enabled}`
  );
  rows.push(
    `- notion: token ${config.connectors.notion.token ? "present" : "missing"} (${config.connectors.notion.tokenEnv}), page ${config.connectors.notion.page || Object.keys(config.connectors.notion.pages).length ? "present" : "missing"} (${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv}), enabled=${config.connectors.notion.enabled}`
  );
  rows.push(
    `- obsidian: vault ${config.connectors.obsidian.vaultDir ? "present" : "missing"} (${config.connectors.obsidian.vaultDirEnv}), note ${config.connectors.obsidian.note || Object.keys(config.connectors.obsidian.notes).length ? "present" : "missing"} (${config.connectors.obsidian.noteEnv}/${config.connectors.obsidian.notesEnv}), enabled=${config.connectors.obsidian.enabled}`
  );
  rows.push("");
  rows.push("Note: Discord/Telegram/Slack/Matrix/WhatsApp/LINE/KakaoTalk/Webex/Zulip/GitHub/Todoist/Notion tokens, Signal account, local iMessage settings, Google Chat/generic Webhook/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom webhook URLs, Home Assistant credentials, Zalo OA credentials, IRC/Twitch server credentials, Nextcloud Talk OCS credentials, Email sendmail envelope settings, Todoist project targets, Notion page targets, and Obsidian vault/note targets are transport/action credentials only; model calls still go through local CLIs.");
  rows.push("");
  rows.push("Recommended checks:");
  rows.push("- static config/state/audit: `viser config-check && viser state-check && viser audit`");
  rows.push("- full local verification: `viser verify`");
  rows.push("- provider runtime + live token proof: `viser verify --live --probe-all-providers`");
  rows.push("- single live launch verdict: `viser launch-status`");
  rows.push("- environment/token loading: `viser env-check`");
  rows.push("- no-start launch rehearsal: `viser gateway --dry-run --strict --live --probe-all-providers`");
  rows.push("- actionable recovery checklist: `viser next-steps --live --probe-all-providers`");

  return rows.join("\n");
}
