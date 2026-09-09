// ================================================================
// Scheduled task notification sink
// ================================================================
// Scheduler/job delivery is best-effort. Push-capable surfaces get results when
// credentials exist and the target is already paired/allowlisted. KakaoTalk Skill
// is request/response only, so follow-ups stay on console (or a configured ntfy/telegram fallback).
import { sendDiscordMessage } from "./discord.js";
import { sendDingTalkMessage } from "./dingtalk.js";
import { sendEmailMessage } from "./email.js";
import { sendFeishuMessage } from "./feishu.js";
import { sendGenericWebhookMessage } from "./generic-webhook.js";
import { sendGitHubIssueComment } from "./github.js";
import { sendGoogleChatMessage } from "./google-chat.js";
import { callHomeAssistantService } from "./home-assistant.js";
import { sendImessageMessage } from "./imessage.js";
import { sendLinePushMessage } from "./line.js";
import { sendIrcMessage } from "./irc.js";
import { sendMattermostMessage } from "./mattermost.js";
import { sendMatrixMessage } from "./matrix.js";
import { sendNextcloudTalkMessage } from "./nextcloud-talk.js";
import { sendNtfyMessage } from "./ntfy.js";
import { sendMastodonStatus } from "./mastodon.js";
import { sendTodoistTask } from "./todoist.js";
import { appendNotionPageMessage } from "./notion.js";
import { appendObsidianNoteMessage } from "./obsidian.js";
import { sendRocketChatMessage } from "./rocket-chat.js";
import { sendSignalMessage } from "./signal.js";
import { sendSlackMessage } from "./slack.js";
import { sendSynologyChatMessage } from "./synology-chat.js";
import { sendTeamsMessage } from "./teams.js";
import { sendTwitchMessage } from "./twitch.js";
import { sendWeComMessage } from "./wecom.js";
import { sendWebexMessage } from "./webex.js";
import { sendTelegramMessage } from "./telegram.js";
import { sendWhatsappMessage } from "./whatsapp.js";
import { sendZaloMessage } from "./zalo.js";
import { sendZulipMessage } from "./zulip.js";
import { AccessStore } from "../core/access.js";
import { deliveryForSession } from "../core/delivery.js";
export function createConnectorNotifier(config) {
    const deliver = createDeliverySink(config);
    return async (task, output) => {
        await deliver(task.delivery, output, `scheduled:${task.id}`, task.prompt);
    };
}
export function createJobProgressNotifier(config) {
    const deliver = createDeliverySink(config);
    return async (job, status, output) => {
        const delivery = job.delivery ?? deliveryForSession(job.sessionId);
        await deliver(delivery, formatJobProgressMessage(job, status, output), `job:${job.id}`, job.prompt);
    };
}
function createDeliverySink(config) {
    const send = createConnectorMessageSender(config);
    return async (delivery, output, label, prompt) => {
        if (delivery.kind === "kakaotalk") {
            console.log([
                "KakaoTalk Skill is request/response and cannot push scheduled or job follow-ups.",
                "Use ntfy/telegram from that KakaoTalk session, or read console output on the Viser host.",
                `\n[${label}] ${prompt}\n${output}\n`
            ].join("\n"));
            return;
        }
        if (delivery.kind !== "console" && delivery.targetId) {
            try {
                await send({ connector: delivery.kind, targetId: delivery.targetId, text: output });
                return;
            }
            catch (error) {
                console.error(`${label} notify failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        console.log(`\n[${label}] ${prompt}\n${output}\n`);
    };
}
function formatJobProgressMessage(job, status, output) {
    const preview = job.prompt.replace(/\s+/gu, " ").slice(0, 160);
    if (status === "started")
        return `Viser job [${job.id}] started.\n${preview}`;
    if (status === "deferred")
        return `Viser job [${job.id}] deferred: provider unavailable. Retrying later.\n${preview}`;
    if (status === "failed")
        return [`Viser job [${job.id}] failed.`, preview, output ?? ""].filter(Boolean).join("\n");
    return [`Viser job [${job.id}] done.`, output ?? ""].filter(Boolean).join("\n");
}
export function createConnectorMessageSender(config, options = {}) {
    const access = new AccessStore(config.access);
    return async (message) => {
        if (message.connector === "telegram") {
            await assertConnectorTargetAllowed(access, "telegram", message.targetId, [
                ...config.connectors.telegram.allowedChatIds,
                ...config.connectors.telegram.defaultChatIds
            ]);
            if (!config.connectors.telegram.botToken)
                throw new Error(`Telegram token is missing. Set ${config.connectors.telegram.botTokenEnv}.`);
            await sendTelegramMessage(config.connectors.telegram.botToken, message.targetId, message.text);
            return;
        }
        if (message.connector === "discord") {
            await assertConnectorTargetAllowed(access, "discord", message.targetId, [
                ...config.connectors.discord.allowedChannelIds,
                ...config.connectors.discord.defaultChannelIds
            ]);
            if (!config.connectors.discord.botToken)
                throw new Error(`Discord token is missing. Set ${config.connectors.discord.botTokenEnv}.`);
            await sendDiscordMessage(config.connectors.discord.botToken, message.targetId, message.text);
            return;
        }
        if (message.connector === "slack") {
            await assertConnectorTargetAllowed(access, "slack", message.targetId, [
                ...config.connectors.slack.allowedChannelIds,
                ...config.connectors.slack.defaultChannelIds
            ]);
            if (!config.connectors.slack.botToken)
                throw new Error(`Slack token is missing. Set ${config.connectors.slack.botTokenEnv}.`);
            await sendSlackMessage(config.connectors.slack.botToken, message.targetId, message.text);
            return;
        }
        if (message.connector === "matrix") {
            await assertConnectorTargetAllowed(access, "matrix", message.targetId, [
                ...config.connectors.matrix.allowedRoomIds,
                ...config.connectors.matrix.defaultRoomIds
            ]);
            if (!config.connectors.matrix.accessToken)
                throw new Error(`Matrix access token is missing. Set ${config.connectors.matrix.accessTokenEnv}.`);
            if (!config.connectors.matrix.homeserverUrl)
                throw new Error(`Matrix homeserver URL is missing. Set ${config.connectors.matrix.homeserverUrlEnv}.`);
            await sendMatrixMessage(config.connectors.matrix.accessToken, config.connectors.matrix, message.targetId, message.text);
            return;
        }
        if (message.connector === "signal") {
            await assertConnectorTargetAllowed(access, "signal", message.targetId, [
                ...config.connectors.signal.allowedRecipientIds,
                ...config.connectors.signal.defaultRecipientIds
            ]);
            if (!config.connectors.signal.account)
                throw new Error(`Signal account is missing. Set ${config.connectors.signal.accountEnv}.`);
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
async function assertConnectorTargetAllowed(access, connector, targetId, staticAllowlist) {
    if (await access.isAllowed(connector, targetId, staticAllowlist))
        return;
    throw new Error(`Connector message target is not allowed: ${connector}:${targetId}. Pair it first or add it to the configured allow/default list.`);
}
