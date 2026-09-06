// ================================================================
// Connector token validation
// ================================================================
// Used by readiness checks. These calls validate transport credentials only;
// model access still happens through local logged-in CLIs.
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { commandExists } from "../utils/exec.js";
import { normalizeDingTalkWebhookUrl } from "./dingtalk.js";
import { normalizeFeishuWebhookUrl } from "./feishu.js";
import { normalizeGenericWebhookInboundToken, normalizeGenericWebhookUrl } from "./generic-webhook.js";
import { githubHeaders, normalizeGitHubToken, parseGitHubIssueTarget, redactGitHubDetail } from "./github.js";
import { normalizeTodoistToken, parseTodoistProjectTarget, redactTodoistDetail, todoistHeaders } from "./todoist.js";
import { normalizeNotionToken, notionHeaders, parseNotionPageTarget, redactNotionDetail } from "./notion.js";
import { normalizeObsidianNotePath, normalizeObsidianVaultDir, redactObsidianDetail } from "./obsidian.js";
import { normalizeGoogleChatWebhookUrl } from "./google-chat.js";
import { normalizeHomeAssistantAccessToken, normalizeHomeAssistantBaseUrl, normalizeHomeAssistantServiceSpec, redactHomeAssistantDetail } from "./home-assistant.js";
import { normalizeIrcChannel, normalizeIrcHost, normalizeIrcNick, normalizeIrcPassword, normalizeIrcPort, redactIrcDetail } from "./irc.js";
import { normalizeMattermostWebhookUrl } from "./mattermost.js";
import { normalizeNextcloudTalkAppPassword, normalizeNextcloudTalkBaseUrl, normalizeNextcloudTalkRoomToken, normalizeNextcloudTalkUsername, redactNextcloudTalkDetail } from "./nextcloud-talk.js";
import { normalizeNtfyBaseUrl, normalizeOptionalNtfyToken, parseNtfyTopicTarget, redactNtfyDetail } from "./ntfy.js";
import { mastodonApiUrl, normalizeMastodonAccessToken, normalizeMastodonBaseUrl, normalizeMastodonVisibility, redactMastodonDetail } from "./mastodon.js";
import { normalizeRocketChatWebhookUrl } from "./rocket-chat.js";
import { normalizeSynologyChatWebhookUrl } from "./synology-chat.js";
import { normalizeTeamsWebhookUrl } from "./teams.js";
import { normalizeTwitchAccessToken, normalizeTwitchChannel, normalizeTwitchUsername, redactTwitchDetail } from "./twitch.js";
import { normalizeWeComWebhookUrl } from "./wecom.js";
import { normalizeZaloAccessToken, normalizeZaloUserId, redactZaloDetail } from "./zalo.js";
import { normalizeZulipApiKey, normalizeZulipBotEmail, normalizeZulipSiteUrl, redactZulipDetail, zulipAuthorizationHeader } from "./zulip.js";
export async function validateTelegramToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "telegram", detail: "missing token" };
    try {
        const response = await fetchWithTimeout(fetchImpl, `https://api.telegram.org/bot${token}/getMe`, { method: "GET" }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok || !body.ok) {
            return { ok: false, label: "telegram", detail: redactToken(body.description ?? response.statusText, token) };
        }
        return { ok: true, label: "telegram", detail: body.result?.username ? `bot @${body.result.username}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "telegram", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateDiscordToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "discord", detail: "missing token" };
    try {
        const response = await fetchWithTimeout(fetchImpl, "https://discord.com/api/v10/users/@me", {
            method: "GET",
            headers: { authorization: `Bot ${token}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "discord", detail: redactToken(body.message ?? response.statusText, token) };
        }
        return { ok: true, label: "discord", detail: body.username ? `bot ${body.username}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "discord", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateSlackToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "slack", detail: "missing token" };
    try {
        const response = await fetchWithTimeout(fetchImpl, "https://slack.com/api/auth.test", {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: "{}"
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok || !body.ok) {
            return { ok: false, label: "slack", detail: redactToken(body.error ?? response.statusText, token) };
        }
        return { ok: true, label: "slack", detail: body.user ? `bot ${body.user}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "slack", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateMatrixToken(homeserverUrl, token, fetchImpl = fetch, options = {}) {
    if (!homeserverUrl)
        return { ok: false, label: "matrix", detail: "missing homeserver URL" };
    if (!token)
        return { ok: false, label: "matrix", detail: "missing token" };
    try {
        const base = homeserverUrl.trim().replace(/\/+$/u, "");
        const response = await fetchWithTimeout(fetchImpl, `${base}/_matrix/client/v3/account/whoami`, {
            method: "GET",
            headers: { authorization: `Bearer ${token}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "matrix", detail: redactToken(body.error ?? response.statusText, token) };
        }
        return { ok: true, label: "matrix", detail: body.user_id ? `user ${body.user_id}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "matrix", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateWhatsappToken(graphApiVersion, phoneNumberId, token, fetchImpl = fetch, options = {}) {
    if (!graphApiVersion)
        return { ok: false, label: "whatsapp", detail: "missing Graph API version" };
    if (!phoneNumberId)
        return { ok: false, label: "whatsapp", detail: "missing phone number ID" };
    if (!token)
        return { ok: false, label: "whatsapp", detail: "missing token" };
    try {
        const version = graphApiVersion.trim().replace(/^\/+/u, "");
        const response = await fetchWithTimeout(fetchImpl, `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number`, {
            method: "GET",
            headers: { authorization: `Bearer ${token}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "whatsapp", detail: redactMany(body.error?.message ?? body.message ?? response.statusText, [token, phoneNumberId]) };
        }
        return { ok: true, label: "whatsapp", detail: body.id ? "phone number ID accepted" : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "whatsapp", detail: redactMany(error instanceof Error ? error.message : String(error), [token, phoneNumberId]) };
    }
}
export async function validateLineToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "line", detail: "missing channel access token" };
    try {
        const response = await fetchWithTimeout(fetchImpl, "https://api.line.me/v2/bot/info", {
            method: "GET",
            headers: { authorization: `Bearer ${token}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "line", detail: redactToken(body.message ?? response.statusText, token) };
        }
        return { ok: true, label: "line", detail: body.displayName ? `bot ${body.displayName}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "line", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export function validateGoogleChatWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "google-chat", detail: "missing webhook URL" };
    try {
        normalizeGoogleChatWebhookUrl(webhookUrl);
        return { ok: true, label: "google-chat", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "google-chat", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateGenericWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "webhook", detail: "missing webhook URL" };
    try {
        normalizeGenericWebhookUrl(webhookUrl);
        return { ok: true, label: "webhook", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "webhook", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateGenericInboundWebhookToken(token) {
    if (!token)
        return { ok: false, label: "webhook-inbound", detail: "missing inbound webhook token" };
    try {
        normalizeGenericWebhookInboundToken(token);
        return { ok: true, label: "webhook-inbound", detail: "inbound webhook token configured" };
    }
    catch (error) {
        return { ok: false, label: "webhook-inbound", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateHomeAssistantApi(baseUrl, accessToken, service, fetchImpl = fetch, options = {}) {
    const redactionConfig = {
        enabled: true,
        baseUrlEnv: "HOME_ASSISTANT_BASE_URL",
        baseUrl,
        accessTokenEnv: "HOME_ASSISTANT_ACCESS_TOKEN",
        accessToken,
        serviceEnv: "HOME_ASSISTANT_SERVICE",
        service,
        servicesEnv: "HOME_ASSISTANT_SERVICES",
        services: {},
        allowedServiceIds: [],
        defaultServiceIds: [],
        sendTimeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    };
    if (!baseUrl)
        return { ok: false, label: "home-assistant", detail: "missing base URL" };
    if (!accessToken)
        return { ok: false, label: "home-assistant", detail: "missing access token" };
    if (!service)
        return { ok: false, label: "home-assistant", detail: "missing service alias target" };
    try {
        const normalizedBaseUrl = normalizeHomeAssistantBaseUrl(baseUrl);
        normalizeHomeAssistantAccessToken(accessToken);
        normalizeHomeAssistantServiceSpec(service);
        const response = await fetchWithTimeout(fetchImpl, `${normalizedBaseUrl}/api/`, {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        if (!response.ok) {
            const bodyText = await response.text().catch(() => "");
            return { ok: false, label: "home-assistant", detail: redactHomeAssistantDetail(`${response.status} ${response.statusText} ${bodyText}`, redactionConfig) };
        }
        return { ok: true, label: "home-assistant", detail: "Home Assistant API accepted token" };
    }
    catch (error) {
        return { ok: false, label: "home-assistant", detail: redactHomeAssistantDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateTeamsWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "teams", detail: "missing webhook URL" };
    try {
        normalizeTeamsWebhookUrl(webhookUrl);
        return { ok: true, label: "teams", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "teams", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateMattermostWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "mattermost", detail: "missing webhook URL" };
    try {
        normalizeMattermostWebhookUrl(webhookUrl);
        return { ok: true, label: "mattermost", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "mattermost", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateSynologyChatWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "synology-chat", detail: "missing webhook URL" };
    try {
        normalizeSynologyChatWebhookUrl(webhookUrl);
        return { ok: true, label: "synology-chat", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "synology-chat", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateRocketChatWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "rocket-chat", detail: "missing webhook URL" };
    try {
        normalizeRocketChatWebhookUrl(webhookUrl);
        return { ok: true, label: "rocket-chat", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "rocket-chat", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateFeishuWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "feishu", detail: "missing webhook URL" };
    try {
        normalizeFeishuWebhookUrl(webhookUrl);
        return { ok: true, label: "feishu", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "feishu", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateDingTalkWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "dingtalk", detail: "missing webhook URL" };
    try {
        normalizeDingTalkWebhookUrl(webhookUrl);
        return { ok: true, label: "dingtalk", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "dingtalk", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateWeComWebhook(webhookUrl) {
    if (!webhookUrl)
        return { ok: false, label: "wecom", detail: "missing webhook URL" };
    try {
        normalizeWeComWebhookUrl(webhookUrl);
        return { ok: true, label: "wecom", detail: "webhook URL configured" };
    }
    catch (error) {
        return { ok: false, label: "wecom", detail: redactToken(error instanceof Error ? error.message : String(error), webhookUrl) };
    }
}
export function validateIrcConfig(host, port, nick, channel, password) {
    if (!host)
        return { ok: false, label: "irc", detail: "missing host" };
    if (!nick)
        return { ok: false, label: "irc", detail: "missing nick" };
    if (!channel)
        return { ok: false, label: "irc", detail: "missing channel" };
    const redactionConfig = {
        enabled: true,
        hostEnv: "IRC_HOST",
        host,
        portEnv: "IRC_PORT",
        port,
        tlsEnv: "IRC_TLS",
        tls: true,
        nickEnv: "IRC_NICK",
        nick,
        passwordEnv: "IRC_PASSWORD",
        password,
        channelEnv: "IRC_CHANNEL",
        channel,
        channelsEnv: "IRC_CHANNELS",
        channels: {},
        allowedChannelIds: [],
        defaultChannelIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeIrcHost(host);
        normalizeIrcPort(port);
        normalizeIrcNick(nick);
        normalizeIrcPassword(password);
        normalizeIrcChannel(channel);
        return { ok: true, label: "irc", detail: "host, nick, and channel configured" };
    }
    catch (error) {
        return { ok: false, label: "irc", detail: redactIrcDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateTwitchConfig(accessToken, botUsername, channel) {
    if (!accessToken)
        return { ok: false, label: "twitch", detail: "missing OAuth token" };
    if (!botUsername)
        return { ok: false, label: "twitch", detail: "missing bot username" };
    if (!channel)
        return { ok: false, label: "twitch", detail: "missing channel" };
    const redactionConfig = {
        enabled: true,
        accessTokenEnv: "TWITCH_ACCESS_TOKEN",
        accessToken,
        botUsernameEnv: "TWITCH_BOT_USERNAME",
        botUsername,
        channelEnv: "TWITCH_CHANNEL",
        channel,
        channelsEnv: "TWITCH_CHANNELS",
        channels: {},
        allowedChannelIds: [],
        defaultChannelIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeTwitchAccessToken(accessToken);
        normalizeTwitchUsername(botUsername);
        normalizeTwitchChannel(channel);
        return { ok: true, label: "twitch", detail: "OAuth token, bot username, and channel configured" };
    }
    catch (error) {
        return { ok: false, label: "twitch", detail: redactTwitchDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateNextcloudTalkConfig(baseUrl, username, appPassword, roomToken) {
    if (!baseUrl)
        return { ok: false, label: "nextcloud-talk", detail: "missing base URL" };
    if (!username)
        return { ok: false, label: "nextcloud-talk", detail: "missing username" };
    if (!appPassword)
        return { ok: false, label: "nextcloud-talk", detail: "missing app password" };
    if (!roomToken)
        return { ok: false, label: "nextcloud-talk", detail: "missing room token" };
    const redactionConfig = {
        enabled: true,
        baseUrlEnv: "NEXTCLOUD_TALK_BASE_URL",
        baseUrl,
        usernameEnv: "NEXTCLOUD_TALK_USERNAME",
        username,
        appPasswordEnv: "NEXTCLOUD_TALK_APP_PASSWORD",
        appPassword,
        roomTokenEnv: "NEXTCLOUD_TALK_ROOM_TOKEN",
        roomToken,
        roomsEnv: "NEXTCLOUD_TALK_ROOMS",
        rooms: {},
        allowedRoomIds: [],
        defaultRoomIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeNextcloudTalkBaseUrl(baseUrl);
        normalizeNextcloudTalkUsername(username);
        normalizeNextcloudTalkAppPassword(appPassword);
        normalizeNextcloudTalkRoomToken(roomToken);
        return { ok: true, label: "nextcloud-talk", detail: "base URL, user, app password, and room configured" };
    }
    catch (error) {
        return { ok: false, label: "nextcloud-talk", detail: redactNextcloudTalkDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateZaloCredentials(accessToken, recipient) {
    if (!accessToken)
        return { ok: false, label: "zalo", detail: "missing access token" };
    if (!recipient)
        return { ok: false, label: "zalo", detail: "missing recipient" };
    const redactionConfig = {
        enabled: true,
        accessTokenEnv: "ZALO_OA_ACCESS_TOKEN",
        accessToken,
        recipientEnv: "ZALO_RECIPIENT_ID",
        recipient,
        recipientsEnv: "ZALO_RECIPIENTS",
        recipients: {},
        allowedRecipientIds: [],
        defaultRecipientIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeZaloAccessToken(accessToken);
        normalizeZaloUserId(recipient);
        return { ok: true, label: "zalo", detail: "access token and recipient configured" };
    }
    catch (error) {
        return { ok: false, label: "zalo", detail: redactZaloDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export async function validateWebexToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "webex", detail: "missing token" };
    try {
        const response = await fetchWithTimeout(fetchImpl, "https://webexapis.com/v1/people/me", {
            method: "GET",
            headers: { authorization: `Bearer ${token}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            const detail = body.message ?? body.errors?.map((item) => item.description).filter(Boolean).join("; ") ?? response.statusText;
            return { ok: false, label: "webex", detail: redactToken(detail, token) };
        }
        return { ok: true, label: "webex", detail: body.displayName ? `bot ${body.displayName}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "webex", detail: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
}
export async function validateZulipToken(siteUrl, botEmail, apiKey, fetchImpl = fetch, options = {}) {
    if (!siteUrl)
        return { ok: false, label: "zulip", detail: "missing site URL" };
    if (!botEmail)
        return { ok: false, label: "zulip", detail: "missing bot email" };
    if (!apiKey)
        return { ok: false, label: "zulip", detail: "missing API key" };
    const redactionConfig = {
        enabled: true,
        siteUrlEnv: "ZULIP_SITE_URL",
        siteUrl,
        botEmailEnv: "ZULIP_BOT_EMAIL",
        botEmail,
        apiKeyEnv: "ZULIP_API_KEY",
        apiKey,
        targetEnv: "ZULIP_TARGET",
        targetsEnv: "ZULIP_TARGETS",
        targets: {},
        allowedTargetIds: [],
        defaultTargetIds: [],
        sendTimeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        const base = normalizeZulipSiteUrl(siteUrl);
        const email = normalizeZulipBotEmail(botEmail);
        const key = normalizeZulipApiKey(apiKey);
        const response = await fetchWithTimeout(fetchImpl, `${base}/api/v1/users/me`, {
            method: "GET",
            headers: { authorization: zulipAuthorizationHeader(email, key) }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok || body.result === "error") {
            return { ok: false, label: "zulip", detail: redactZulipDetail(body.msg ?? response.statusText, redactionConfig) };
        }
        return { ok: true, label: "zulip", detail: body.full_name ? `bot ${body.full_name}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "zulip", detail: redactZulipDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export async function validateGitHubToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "github", detail: "missing token" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "GITHUB_TOKEN",
        token,
        targetEnv: "GITHUB_ISSUE_TARGET",
        targetsEnv: "GITHUB_ISSUE_TARGETS",
        targets: {},
        allowedTargetIds: [],
        defaultTargetIds: [],
        sendTimeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        const safeToken = normalizeGitHubToken(token);
        const response = await fetchWithTimeout(fetchImpl, "https://api.github.com/user", {
            method: "GET",
            headers: githubHeaders(safeToken)
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "github", detail: redactGitHubDetail(body.message ?? response.statusText, redactionConfig) };
        }
        return { ok: true, label: "github", detail: body.login ? `user ${body.login}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "github", detail: redactGitHubDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateGitHubTarget(token, target) {
    if (!token)
        return { ok: false, label: "github", detail: "missing token" };
    if (!target)
        return { ok: false, label: "github", detail: "missing issue target" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "GITHUB_TOKEN",
        token,
        targetEnv: "GITHUB_ISSUE_TARGET",
        target,
        targetsEnv: "GITHUB_ISSUE_TARGETS",
        targets: {},
        allowedTargetIds: [],
        defaultTargetIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeGitHubToken(token);
        parseGitHubIssueTarget(target);
        return { ok: true, label: "github", detail: "token and issue target configured" };
    }
    catch (error) {
        return { ok: false, label: "github", detail: redactGitHubDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export async function validateTodoistToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "todoist", detail: "missing token" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "TODOIST_API_TOKEN",
        token,
        projectEnv: "TODOIST_PROJECT_ID",
        projectsEnv: "TODOIST_PROJECTS",
        projects: {},
        allowedProjectIds: [],
        defaultProjectIds: [],
        sendTimeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        const safeToken = normalizeTodoistToken(token);
        const response = await fetchWithTimeout(fetchImpl, "https://api.todoist.com/api/v1/projects", {
            method: "GET",
            headers: todoistHeaders(safeToken)
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "todoist", detail: redactTodoistDetail(body.error ?? body.message ?? response.statusText, redactionConfig) };
        }
        return { ok: true, label: "todoist", detail: "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "todoist", detail: redactTodoistDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateTodoistTarget(token, project) {
    if (!token)
        return { ok: false, label: "todoist", detail: "missing token" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "TODOIST_API_TOKEN",
        token,
        projectEnv: "TODOIST_PROJECT_ID",
        project,
        projectsEnv: "TODOIST_PROJECTS",
        projects: {},
        allowedProjectIds: [],
        defaultProjectIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeTodoistToken(token);
        if (project)
            parseTodoistProjectTarget(project);
        return { ok: true, label: "todoist", detail: project ? "token and project target configured" : "token configured for inbox target" };
    }
    catch (error) {
        return { ok: false, label: "todoist", detail: redactTodoistDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateNtfyTarget(baseUrl, token, topic) {
    if (!baseUrl)
        return { ok: false, label: "ntfy", detail: "missing base URL" };
    if (!topic)
        return { ok: false, label: "ntfy", detail: "missing topic target" };
    const redactionConfig = {
        enabled: true,
        baseUrlEnv: "NTFY_BASE_URL",
        baseUrl,
        tokenEnv: "NTFY_TOKEN",
        token,
        topicEnv: "NTFY_TOPIC",
        topic,
        topicsEnv: "NTFY_TOPICS",
        topics: {},
        allowedTopicIds: [],
        defaultTopicIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeNtfyBaseUrl(baseUrl);
        normalizeOptionalNtfyToken(token);
        parseNtfyTopicTarget(topic);
        return { ok: true, label: "ntfy", detail: token ? "base URL, token, and topic configured" : "base URL and public topic configured" };
    }
    catch (error) {
        return { ok: false, label: "ntfy", detail: redactNtfyDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export async function validateMastodonToken(baseUrl, accessToken, visibility, fetchImpl = fetch, options = {}) {
    if (!baseUrl)
        return { ok: false, label: "mastodon", detail: "missing base URL" };
    if (!accessToken)
        return { ok: false, label: "mastodon", detail: "missing access token" };
    const redactionConfig = {
        enabled: true,
        baseUrlEnv: "MASTODON_BASE_URL",
        baseUrl,
        accessTokenEnv: "MASTODON_ACCESS_TOKEN",
        accessToken,
        visibilityEnv: "MASTODON_VISIBILITY",
        visibility: "private",
        targetsEnv: "MASTODON_TARGETS",
        targets: {},
        allowedTargetIds: [],
        defaultTargetIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        const normalizedBaseUrl = normalizeMastodonBaseUrl(baseUrl);
        normalizeMastodonAccessToken(accessToken);
        normalizeMastodonVisibility(visibility);
        const response = await fetchWithTimeout(fetchImpl, mastodonApiUrl(normalizedBaseUrl, "/api/v1/accounts/verify_credentials"), {
            method: "GET",
            headers: { authorization: `Bearer ${accessToken}` }
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "mastodon", detail: redactMastodonDetail(body.error ?? response.statusText, redactionConfig) };
        }
        return { ok: true, label: "mastodon", detail: body.acct || body.username ? `account ${body.acct ?? body.username}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "mastodon", detail: redactMastodonDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export async function validateNotionToken(token, fetchImpl = fetch, options = {}) {
    if (!token)
        return { ok: false, label: "notion", detail: "missing token" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "NOTION_TOKEN",
        token,
        pageEnv: "NOTION_PAGE_ID",
        pagesEnv: "NOTION_PAGES",
        pages: {},
        allowedPageIds: [],
        defaultPageIds: [],
        sendTimeoutMs: options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        const safeToken = normalizeNotionToken(token);
        const response = await fetchWithTimeout(fetchImpl, "https://api.notion.com/v1/users/me", {
            method: "GET",
            headers: notionHeaders(safeToken)
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok) {
            return { ok: false, label: "notion", detail: redactNotionDetail(body.message ?? response.statusText, redactionConfig) };
        }
        return { ok: true, label: "notion", detail: body.name ? `bot ${body.name}` : "token accepted" };
    }
    catch (error) {
        return { ok: false, label: "notion", detail: redactNotionDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateNotionTarget(token, page) {
    if (!token)
        return { ok: false, label: "notion", detail: "missing token" };
    if (!page)
        return { ok: false, label: "notion", detail: "missing page target" };
    const redactionConfig = {
        enabled: true,
        tokenEnv: "NOTION_TOKEN",
        token,
        pageEnv: "NOTION_PAGE_ID",
        page,
        pagesEnv: "NOTION_PAGES",
        pages: {},
        allowedPageIds: [],
        defaultPageIds: [],
        sendTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS
    };
    try {
        normalizeNotionToken(token);
        parseNotionPageTarget(page);
        return { ok: true, label: "notion", detail: "token and page target configured" };
    }
    catch (error) {
        return { ok: false, label: "notion", detail: redactNotionDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateObsidianTarget(vaultDir, note) {
    if (!vaultDir)
        return { ok: false, label: "obsidian", detail: "missing vault dir" };
    if (!note)
        return { ok: false, label: "obsidian", detail: "missing note target" };
    const redactionConfig = {
        enabled: true,
        vaultDirEnv: "OBSIDIAN_VAULT_DIR",
        vaultDir,
        noteEnv: "OBSIDIAN_NOTE",
        note,
        notesEnv: "OBSIDIAN_NOTES",
        notes: {},
        allowedNoteIds: [],
        defaultNoteIds: [],
        maxMessageChars: 20_000
    };
    try {
        normalizeObsidianVaultDir(vaultDir);
        normalizeObsidianNotePath(note);
        return { ok: true, label: "obsidian", detail: "vault and note target configured" };
    }
    catch (error) {
        return { ok: false, label: "obsidian", detail: redactObsidianDetail(error instanceof Error ? error.message : String(error), redactionConfig) };
    }
}
export function validateSignalCli(command, account) {
    if (!account)
        return { ok: false, label: "signal", detail: "missing account" };
    if (!command)
        return { ok: false, label: "signal", detail: "missing command" };
    if (!commandExists(command))
        return { ok: false, label: "signal", detail: `command '${command}' missing` };
    return { ok: true, label: "signal", detail: "local signal-cli configured" };
}
export function validateImessageLocal(sqliteCommand, osascriptCommand, chatDbPath) {
    if (!chatDbPath)
        return { ok: false, label: "imessage", detail: "missing chat database path" };
    if (!sqliteCommand)
        return { ok: false, label: "imessage", detail: "missing sqlite command" };
    if (!osascriptCommand)
        return { ok: false, label: "imessage", detail: "missing osascript command" };
    if (!commandExists(sqliteCommand))
        return { ok: false, label: "imessage", detail: `command '${sqliteCommand}' missing` };
    if (!commandExists(osascriptCommand))
        return { ok: false, label: "imessage", detail: `command '${osascriptCommand}' missing` };
    try {
        accessSync(expandHome(chatDbPath), constants.R_OK);
    }
    catch {
        return { ok: false, label: "imessage", detail: "chat database path is not readable" };
    }
    return { ok: true, label: "imessage", detail: "local macOS Messages commands configured" };
}
function redactToken(detail, token) {
    return detail.split(token).join("[REDACTED]");
}
function redactMany(detail, values) {
    let output = detail;
    for (const value of values) {
        if (value)
            output = output.split(value).join("[REDACTED]");
    }
    return output;
}
function expandHome(path) {
    if (path === "~")
        return homedir();
    if (path.startsWith("~/"))
        return resolve(homedir(), path.slice(2));
    return path;
}
