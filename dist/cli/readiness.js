// ================================================================
// Readiness checklist
// ================================================================
// `doctor` explains the environment. `readiness` answers: can this config launch
// now, what is safe, and what exact step is missing?
import { AccessStore } from "../core/access.js";
import { PluginRegistry } from "../core/plugins.js";
import { SkillRegistry } from "../core/skills.js";
import { validateDingTalkWebhook, validateDiscordToken, validateFeishuWebhook, validateGenericInboundWebhookToken, validateGenericWebhook, validateGitHubTarget, validateGitHubToken, validateTodoistTarget, validateTodoistToken, validateNotionTarget, validateNotionToken, validateNtfyTarget, validateMastodonToken, validateObsidianTarget, validateGoogleChatWebhook, validateHomeAssistantApi, validateImessageLocal, validateIrcConfig, validateLineToken, validateMattermostWebhook, validateMatrixToken, validateNextcloudTalkConfig, validateRocketChatWebhook, validateSignalCli, validateSlackToken, validateSynologyChatWebhook, validateTeamsWebhook, validateTelegramToken, validateTwitchConfig, validateWeComWebhook, validateWebexToken, validateWhatsappToken, validateZaloCredentials, validateZulipToken } from "../connectors/validate.js";
import { probeCliProvider } from "../providers/health.js";
import { commandExists } from "../utils/exec.js";
import { ensurePrivateDir, removePrivateFileIfExists } from "../utils/files.js";
import { isNodeVersionSupported, MIN_NODE_VERSION } from "../utils/node-version.js";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const LOCAL_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export function summarizeReadiness(items) {
    const failCount = items.filter((item) => item.status === "fail").length;
    const warnCount = items.filter((item) => item.status === "warn").length;
    return {
        passCount: items.length - failCount - warnCount,
        warnCount,
        failCount,
        verdict: failCount > 0 ? "NOT READY" : warnCount > 0 ? "READY WITH WARNINGS" : "READY"
    };
}
export async function readinessReport(config, options = {}) {
    const items = await readinessItems(config, options);
    const summary = summarizeReadiness(items);
    return [
        `Viser readiness: ${summary.verdict}`,
        `summary: ${summary.passCount} pass, ${summary.warnCount} warn, ${summary.failCount} fail`,
        "",
        ...items.map(formatItem)
    ].join("\n");
}
export async function readinessItems(config, options = {}) {
    const items = [];
    const supportedNode = isNodeVersionSupported();
    items.push({
        status: supportedNode ? "pass" : "fail",
        area: "node",
        message: `Node ${process.version} ${supportedNode ? `>= ${MIN_NODE_VERSION}` : `< ${MIN_NODE_VERSION}`}`,
        next: supportedNode
            ? undefined
            : `Install Node >= ${MIN_NODE_VERSION}; Viser runs TypeScript files directly through Node native stripping.`
    });
    items.push({ status: typeof fetch === "function" ? "pass" : "fail", area: "node", message: "global fetch", next: `Use Node >= ${MIN_NODE_VERSION}; Viser targets Node native TypeScript execution.` });
    items.push({ status: typeof WebSocket === "function" ? "pass" : "fail", area: "node", message: "global WebSocket", next: `Use Node >= ${MIN_NODE_VERSION} for Discord gateway support.` });
    items.push(await writableDirItem("storage", config.storage.dir));
    if (config.memory.enabled)
        items.push(await writableDirItem("memory", config.memory.dir));
    if (config.personalization.enabled)
        items.push(await writableDirItem("personalization", config.personalization.dir));
    if (config.scheduler.enabled)
        items.push(await writableDirItem("scheduler", config.scheduler.dir));
    if (config.jobs.enabled)
        items.push(await writableDirItem("jobs", config.jobs.dir));
    if (config.access.enabled)
        items.push(await writableDirItem("access", config.access.dir));
    if (config.actions.enabled)
        items.push(await writableDirItem("actions", config.actions.dir));
    if (config.webDashboard.enabled)
        items.push(await writableDirItem("web-dashboard", config.webDashboard.canvasDir));
    if (config.webDashboard.enabled)
        items.push(webDashboardAuthReadinessItem(config));
    const defaultProvider = config.providers[config.assistant.defaultProvider];
    const providerCandidateIds = assistantProviderCandidateIds(config);
    const hasRunnableProviderCandidate = providerCandidateIds.some((id) => {
        const provider = config.providers[id];
        return provider ? commandExists(provider.command, providerCommandLookupOptions(provider)) : false;
    });
    if (!defaultProvider) {
        items.push({
            status: hasRunnableProviderCandidate ? "warn" : "fail",
            area: "provider",
            message: `default provider '${config.assistant.defaultProvider}' is not configured`,
            next: hasRunnableProviderCandidate
                ? "Set assistant.defaultProvider to a configured provider, or rely on configured fallback providers."
                : "Set assistant.defaultProvider to a configured provider."
        });
    }
    else if (!commandExists(defaultProvider.command, providerCommandLookupOptions(defaultProvider))) {
        items.push({
            status: hasRunnableProviderCandidate ? "warn" : "fail",
            area: "provider",
            message: `default provider command '${defaultProvider.command}' is missing`,
            next: hasRunnableProviderCandidate
                ? `${defaultProvider.loginHint ?? `Install ${defaultProvider.command}.`} Fallback providers can still be tried for normal requests.`
                : defaultProvider.loginHint
        });
    }
    else {
        items.push({ status: "pass", area: "provider", message: `default provider '${config.assistant.defaultProvider}' command found` });
    }
    for (const provider of Object.values(config.providers)) {
        if (provider.id === config.assistant.defaultProvider)
            continue;
        const exists = commandExists(provider.command, providerCommandLookupOptions(provider));
        const isFallbackProvider = config.assistant.fallbackProviders.includes(provider.id);
        const missingMessage = isFallbackProvider
            ? `${provider.id}: ${provider.command} missing`
            : `${provider.id}: ${provider.command} missing (not in default/fallback path)`;
        items.push({
            status: exists || !isFallbackProvider ? "pass" : "warn",
            area: "provider",
            message: exists ? `${provider.id}: ${provider.command} found` : missingMessage,
            next: exists ? undefined : missingOptionalProviderNext(provider, isFallbackProvider)
        });
    }
    items.push(...await providerProbeItems(config, options, providerCandidateIds));
    const skills = config.skills.enabled ? await new SkillRegistry(config.skills.dirs).list() : [];
    items.push({
        status: !config.skills.enabled ? "warn" : skills.length > 0 ? "pass" : "warn",
        area: "skills",
        message: config.skills.enabled ? `${skills.length} skills available` : "skills disabled",
        next: skills.length > 0 ? undefined : "Run `viser setup` to install starter skills."
    });
    const plugins = config.plugins.enabled ? await new PluginRegistry(config.plugins.dirs).list() : [];
    items.push({
        status: !config.plugins.enabled ? "warn" : plugins.length > 0 ? "pass" : "warn",
        area: "plugins",
        message: config.plugins.enabled ? `${plugins.length} plugins available` : "plugins disabled",
        next: plugins.length > 0 ? undefined : "Keep bundled plugins in ./plugins or add plugin.json folders under .viser/plugins."
    });
    items.push(toolShellReadinessItem(config));
    const access = new AccessStore(config.access);
    const peers = await access.listPeers();
    items.push({
        status: !config.access.enabled ? "warn" : config.access.defaultPolicy === "open" ? "warn" : "pass",
        area: "access",
        message: config.access.enabled ? `policy=${config.access.defaultPolicy}, paired peers=${peers.length}` : "access disabled",
        next: config.access.defaultPolicy === "open" ? "Use pairing policy for public bots." : "Use `viser pair-code telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian` before live messaging."
    });
    items.push({
        status: config.scheduler.enabled ? "pass" : "warn",
        area: "scheduler",
        message: config.scheduler.enabled ? `enabled, tick=${config.scheduler.tickMs}ms` : "disabled"
    });
    items.push({
        status: config.actions.enabled ? "pass" : "warn",
        area: "actions",
        message: config.actions.enabled ? `approval-gated writes enabled (${config.actions.allowedWriteRoots.join(", ")})` : "write actions disabled"
    });
    addConnectorStaticChecks(items, "telegram", config.connectors.telegram.enabled, Boolean(config.connectors.telegram.botToken), config.connectors.telegram.botTokenEnv);
    addConnectorStaticChecks(items, "discord", config.connectors.discord.enabled, Boolean(config.connectors.discord.botToken), config.connectors.discord.botTokenEnv);
    addConnectorStaticChecks(items, "slack", config.connectors.slack.enabled, Boolean(config.connectors.slack.botToken), config.connectors.slack.botTokenEnv);
    addConnectorStaticChecks(items, "matrix", config.connectors.matrix.enabled, Boolean(config.connectors.matrix.accessToken && config.connectors.matrix.homeserverUrl), `${config.connectors.matrix.homeserverUrlEnv}/${config.connectors.matrix.accessTokenEnv}`);
    addConnectorStaticChecks(items, "signal", config.connectors.signal.enabled, Boolean(config.connectors.signal.account && commandExists(config.connectors.signal.command)), `${config.connectors.signal.accountEnv}/${config.connectors.signal.commandEnv}`);
    addConnectorStaticChecks(items, "imessage", config.connectors.imessage.enabled, Boolean(config.connectors.imessage.enabled && commandExists(config.connectors.imessage.sqliteCommand) && commandExists(config.connectors.imessage.osascriptCommand)), `${config.connectors.imessage.sqliteCommandEnv}/${config.connectors.imessage.osascriptCommandEnv}/${config.connectors.imessage.chatDbPathEnv}`);
    addConnectorStaticChecks(items, "whatsapp", config.connectors.whatsapp.enabled, Boolean(config.connectors.whatsapp.accessToken && config.connectors.whatsapp.phoneNumberId && config.connectors.whatsapp.verifyToken), `${config.connectors.whatsapp.accessTokenEnv}/${config.connectors.whatsapp.phoneNumberIdEnv}/${config.connectors.whatsapp.verifyTokenEnv}`);
    addConnectorStaticChecks(items, "line", config.connectors.line.enabled, Boolean(config.connectors.line.channelAccessToken && config.connectors.line.channelSecret), `${config.connectors.line.channelAccessTokenEnv}/${config.connectors.line.channelSecretEnv}`);
    addConnectorStaticChecks(items, "kakaotalk", config.connectors.kakaotalk.enabled, Boolean(config.connectors.kakaotalk.requestToken), config.connectors.kakaotalk.requestTokenEnv);
    addConnectorStaticChecks(items, "google-chat", config.connectors.googleChat.enabled, hasWebhook(config.connectors.googleChat), `${config.connectors.googleChat.webhookUrlEnv}/${config.connectors.googleChat.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "webhook", config.connectors.webhook.enabled, hasWebhook(config.connectors.webhook), `${config.connectors.webhook.webhookUrlEnv}/${config.connectors.webhook.webhookUrlsEnv}`);
    if (config.connectors.webhook.inboundEnabled) {
        const inbound = validateGenericInboundWebhookToken(config.connectors.webhook.inboundToken);
        if (!config.webDashboard.enabled) {
            items.push({
                status: "fail",
                area: "webhook-inbound",
                message: "enabled but web dashboard server is disabled",
                next: "Enable webDashboard for the foreground HTTP server or disable connectors.webhook.inboundEnabled."
            });
        }
        else {
            addConnectorStaticChecks(items, "webhook-inbound", true, inbound.ok, config.connectors.webhook.inboundTokenEnv ?? "VISER_WEBHOOK_INBOUND_TOKEN");
        }
    }
    addConnectorStaticChecks(items, "home-assistant", config.connectors.homeAssistant.enabled, Boolean(config.connectors.homeAssistant.baseUrl && config.connectors.homeAssistant.accessToken && hasHomeAssistantService(config.connectors.homeAssistant)), `${config.connectors.homeAssistant.baseUrlEnv}/${config.connectors.homeAssistant.accessTokenEnv}/${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv}`);
    addConnectorStaticChecks(items, "teams", config.connectors.teams.enabled, hasWebhook(config.connectors.teams), `${config.connectors.teams.webhookUrlEnv}/${config.connectors.teams.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "mattermost", config.connectors.mattermost.enabled, hasWebhook(config.connectors.mattermost), `${config.connectors.mattermost.webhookUrlEnv}/${config.connectors.mattermost.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "synology-chat", config.connectors.synologyChat.enabled, hasWebhook(config.connectors.synologyChat), `${config.connectors.synologyChat.webhookUrlEnv}/${config.connectors.synologyChat.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "rocket-chat", config.connectors.rocketChat.enabled, hasWebhook(config.connectors.rocketChat), `${config.connectors.rocketChat.webhookUrlEnv}/${config.connectors.rocketChat.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "feishu", config.connectors.feishu.enabled, hasWebhook(config.connectors.feishu), `${config.connectors.feishu.webhookUrlEnv}/${config.connectors.feishu.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "dingtalk", config.connectors.dingtalk.enabled, hasWebhook(config.connectors.dingtalk), `${config.connectors.dingtalk.webhookUrlEnv}/${config.connectors.dingtalk.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "wecom", config.connectors.wecom.enabled, hasWebhook(config.connectors.wecom), `${config.connectors.wecom.webhookUrlEnv}/${config.connectors.wecom.webhookUrlsEnv}`);
    addConnectorStaticChecks(items, "zalo", config.connectors.zalo.enabled, Boolean(config.connectors.zalo.accessToken && hasZaloRecipient(config.connectors.zalo)), `${config.connectors.zalo.accessTokenEnv}/${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv}`);
    addConnectorStaticChecks(items, "irc", config.connectors.irc.enabled, Boolean(config.connectors.irc.host && config.connectors.irc.nick && hasIrcChannel(config.connectors.irc)), `${config.connectors.irc.hostEnv}/${config.connectors.irc.portEnv}/${config.connectors.irc.tlsEnv}/${config.connectors.irc.nickEnv}/${config.connectors.irc.passwordEnv}/${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv}`);
    addConnectorStaticChecks(items, "twitch", config.connectors.twitch.enabled, Boolean(config.connectors.twitch.accessToken && config.connectors.twitch.botUsername && hasTwitchChannel(config.connectors.twitch)), `${config.connectors.twitch.accessTokenEnv}/${config.connectors.twitch.botUsernameEnv}/${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv}`);
    addConnectorStaticChecks(items, "ntfy", config.connectors.ntfy.enabled, hasNtfyTopic(config.connectors.ntfy), `${config.connectors.ntfy.baseUrlEnv}/${config.connectors.ntfy.tokenEnv}/${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv}`);
    addConnectorStaticChecks(items, "mastodon", config.connectors.mastodon.enabled, Boolean(config.connectors.mastodon.baseUrl && config.connectors.mastodon.accessToken), `${config.connectors.mastodon.baseUrlEnv}/${config.connectors.mastodon.accessTokenEnv}/${config.connectors.mastodon.visibilityEnv}/${config.connectors.mastodon.targetsEnv}`);
    addConnectorStaticChecks(items, "nextcloud-talk", config.connectors.nextcloudTalk.enabled, Boolean(config.connectors.nextcloudTalk.baseUrl && config.connectors.nextcloudTalk.username && config.connectors.nextcloudTalk.appPassword && hasNextcloudTalkRoom(config.connectors.nextcloudTalk)), `${config.connectors.nextcloudTalk.baseUrlEnv}/${config.connectors.nextcloudTalk.usernameEnv}/${config.connectors.nextcloudTalk.appPasswordEnv}/${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv}`);
    addConnectorStaticChecks(items, "webex", config.connectors.webex.enabled, Boolean(config.connectors.webex.accessToken), config.connectors.webex.accessTokenEnv);
    addConnectorStaticChecks(items, "zulip", config.connectors.zulip.enabled, hasZulipCredentials(config.connectors.zulip) && hasZulipTarget(config.connectors.zulip), `${config.connectors.zulip.siteUrlEnv}/${config.connectors.zulip.botEmailEnv}/${config.connectors.zulip.apiKeyEnv}/${config.connectors.zulip.targetEnv}/${config.connectors.zulip.targetsEnv}`);
    addConnectorStaticChecks(items, "email", config.connectors.email.enabled, Boolean(config.connectors.email.from && hasEmailRecipient(config.connectors.email) && commandExists(config.connectors.email.sendmailCommand)), `${config.connectors.email.sendmailCommandEnv}/${config.connectors.email.fromEnv}/${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv}`);
    addConnectorStaticChecks(items, "github", config.connectors.github.enabled, Boolean(config.connectors.github.token && hasGitHubTarget(config.connectors.github)), `${config.connectors.github.tokenEnv}/${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv}`);
    addConnectorStaticChecks(items, "todoist", config.connectors.todoist.enabled, Boolean(config.connectors.todoist.token), `${config.connectors.todoist.tokenEnv}/${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv}`);
    addConnectorStaticChecks(items, "notion", config.connectors.notion.enabled, Boolean(config.connectors.notion.token && hasNotionPage(config.connectors.notion)), `${config.connectors.notion.tokenEnv}/${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv}`);
    addConnectorStaticChecks(items, "obsidian", config.connectors.obsidian.enabled, Boolean(config.connectors.obsidian.vaultDir && hasObsidianNote(config.connectors.obsidian)), `${config.connectors.obsidian.vaultDirEnv}/${config.connectors.obsidian.noteEnv}/${config.connectors.obsidian.notesEnv}`);
    if (options.live) {
        const telegram = await validateTelegramToken(config.connectors.telegram.botToken);
        items.push(liveConnectorItem("telegram", telegram.ok, telegram.detail, Boolean(config.connectors.telegram.enabled), Boolean(config.connectors.telegram.botToken), config.connectors.telegram.botTokenEnv));
        const discord = await validateDiscordToken(config.connectors.discord.botToken);
        items.push(liveConnectorItem("discord", discord.ok, discord.detail, Boolean(config.connectors.discord.enabled), Boolean(config.connectors.discord.botToken), config.connectors.discord.botTokenEnv));
        const slack = await validateSlackToken(config.connectors.slack.botToken);
        items.push(liveConnectorItem("slack", slack.ok, slack.detail, Boolean(config.connectors.slack.enabled), Boolean(config.connectors.slack.botToken), config.connectors.slack.botTokenEnv));
        const matrix = await validateMatrixToken(config.connectors.matrix.homeserverUrl, config.connectors.matrix.accessToken);
        items.push(liveConnectorItem("matrix", matrix.ok, matrix.detail, Boolean(config.connectors.matrix.enabled), Boolean(config.connectors.matrix.accessToken && config.connectors.matrix.homeserverUrl), `${config.connectors.matrix.homeserverUrlEnv}/${config.connectors.matrix.accessTokenEnv}`));
        const signal = validateSignalCli(config.connectors.signal.command, config.connectors.signal.account);
        items.push(liveConnectorItem("signal", signal.ok, signal.detail, Boolean(config.connectors.signal.enabled), Boolean(config.connectors.signal.account), `${config.connectors.signal.accountEnv}/${config.connectors.signal.commandEnv}`));
        const imessage = validateImessageLocal(config.connectors.imessage.sqliteCommand, config.connectors.imessage.osascriptCommand, config.connectors.imessage.chatDbPath);
        items.push(liveConnectorItem("imessage", imessage.ok, imessage.detail, Boolean(config.connectors.imessage.enabled), Boolean(config.connectors.imessage.enabled), `${config.connectors.imessage.sqliteCommandEnv}/${config.connectors.imessage.osascriptCommandEnv}/${config.connectors.imessage.chatDbPathEnv}`));
        const whatsapp = await validateWhatsappToken(config.connectors.whatsapp.graphApiVersion, config.connectors.whatsapp.phoneNumberId, config.connectors.whatsapp.accessToken);
        items.push(liveConnectorItem("whatsapp", whatsapp.ok, whatsapp.detail, Boolean(config.connectors.whatsapp.enabled), Boolean(config.connectors.whatsapp.accessToken && config.connectors.whatsapp.phoneNumberId), `${config.connectors.whatsapp.accessTokenEnv}/${config.connectors.whatsapp.phoneNumberIdEnv}`));
        const line = await validateLineToken(config.connectors.line.channelAccessToken);
        items.push(liveConnectorItem("line", line.ok, line.detail, Boolean(config.connectors.line.enabled), Boolean(config.connectors.line.channelAccessToken && config.connectors.line.channelSecret), `${config.connectors.line.channelAccessTokenEnv}/${config.connectors.line.channelSecretEnv}`));
        items.push(liveConnectorItem("kakaotalk", Boolean(config.connectors.kakaotalk.requestToken), config.connectors.kakaotalk.requestToken ? "shared Skill token configured" : "missing KakaoTalk Skill shared token", Boolean(config.connectors.kakaotalk.enabled), Boolean(config.connectors.kakaotalk.requestToken), config.connectors.kakaotalk.requestTokenEnv));
        const googleChat = validateGoogleChatWebhook(firstWebhookUrl(config.connectors.googleChat));
        items.push(liveConnectorItem("google-chat", googleChat.ok, googleChat.detail, Boolean(config.connectors.googleChat.enabled), hasWebhook(config.connectors.googleChat), `${config.connectors.googleChat.webhookUrlEnv}/${config.connectors.googleChat.webhookUrlsEnv}`));
        const genericWebhook = validateGenericWebhook(firstWebhookUrl(config.connectors.webhook));
        items.push(liveConnectorItem("webhook", genericWebhook.ok, genericWebhook.detail, Boolean(config.connectors.webhook.enabled), hasWebhook(config.connectors.webhook), `${config.connectors.webhook.webhookUrlEnv}/${config.connectors.webhook.webhookUrlsEnv}`));
        const homeAssistant = await validateHomeAssistantApi(config.connectors.homeAssistant.baseUrl, config.connectors.homeAssistant.accessToken, firstHomeAssistantService(config.connectors.homeAssistant));
        items.push(liveConnectorItem("home-assistant", homeAssistant.ok, homeAssistant.detail, Boolean(config.connectors.homeAssistant.enabled), Boolean(config.connectors.homeAssistant.baseUrl && config.connectors.homeAssistant.accessToken && hasHomeAssistantService(config.connectors.homeAssistant)), `${config.connectors.homeAssistant.baseUrlEnv}/${config.connectors.homeAssistant.accessTokenEnv}/${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv}`));
        const teams = validateTeamsWebhook(firstWebhookUrl(config.connectors.teams));
        items.push(liveConnectorItem("teams", teams.ok, teams.detail, Boolean(config.connectors.teams.enabled), hasWebhook(config.connectors.teams), `${config.connectors.teams.webhookUrlEnv}/${config.connectors.teams.webhookUrlsEnv}`));
        const mattermost = validateMattermostWebhook(firstWebhookUrl(config.connectors.mattermost));
        items.push(liveConnectorItem("mattermost", mattermost.ok, mattermost.detail, Boolean(config.connectors.mattermost.enabled), hasWebhook(config.connectors.mattermost), `${config.connectors.mattermost.webhookUrlEnv}/${config.connectors.mattermost.webhookUrlsEnv}`));
        const synologyChat = validateSynologyChatWebhook(firstWebhookUrl(config.connectors.synologyChat));
        items.push(liveConnectorItem("synology-chat", synologyChat.ok, synologyChat.detail, Boolean(config.connectors.synologyChat.enabled), hasWebhook(config.connectors.synologyChat), `${config.connectors.synologyChat.webhookUrlEnv}/${config.connectors.synologyChat.webhookUrlsEnv}`));
        const rocketChat = validateRocketChatWebhook(firstWebhookUrl(config.connectors.rocketChat));
        items.push(liveConnectorItem("rocket-chat", rocketChat.ok, rocketChat.detail, Boolean(config.connectors.rocketChat.enabled), hasWebhook(config.connectors.rocketChat), `${config.connectors.rocketChat.webhookUrlEnv}/${config.connectors.rocketChat.webhookUrlsEnv}`));
        const feishu = validateFeishuWebhook(firstWebhookUrl(config.connectors.feishu));
        items.push(liveConnectorItem("feishu", feishu.ok, feishu.detail, Boolean(config.connectors.feishu.enabled), hasWebhook(config.connectors.feishu), `${config.connectors.feishu.webhookUrlEnv}/${config.connectors.feishu.webhookUrlsEnv}`));
        const dingTalk = validateDingTalkWebhook(firstWebhookUrl(config.connectors.dingtalk));
        items.push(liveConnectorItem("dingtalk", dingTalk.ok, dingTalk.detail, Boolean(config.connectors.dingtalk.enabled), hasWebhook(config.connectors.dingtalk), `${config.connectors.dingtalk.webhookUrlEnv}/${config.connectors.dingtalk.webhookUrlsEnv}`));
        const weCom = validateWeComWebhook(firstWebhookUrl(config.connectors.wecom));
        items.push(liveConnectorItem("wecom", weCom.ok, weCom.detail, Boolean(config.connectors.wecom.enabled), hasWebhook(config.connectors.wecom), `${config.connectors.wecom.webhookUrlEnv}/${config.connectors.wecom.webhookUrlsEnv}`));
        const zalo = validateZaloCredentials(config.connectors.zalo.accessToken, firstZaloRecipient(config.connectors.zalo));
        items.push(liveConnectorItem("zalo", zalo.ok, zalo.detail, Boolean(config.connectors.zalo.enabled), Boolean(config.connectors.zalo.accessToken && hasZaloRecipient(config.connectors.zalo)), `${config.connectors.zalo.accessTokenEnv}/${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv}`));
        const irc = validateIrcConfig(config.connectors.irc.host, config.connectors.irc.port, config.connectors.irc.nick, firstIrcChannel(config.connectors.irc), config.connectors.irc.password);
        items.push(liveConnectorItem("irc", irc.ok, irc.detail, Boolean(config.connectors.irc.enabled), Boolean(config.connectors.irc.host && config.connectors.irc.nick && hasIrcChannel(config.connectors.irc)), `${config.connectors.irc.hostEnv}/${config.connectors.irc.portEnv}/${config.connectors.irc.tlsEnv}/${config.connectors.irc.nickEnv}/${config.connectors.irc.passwordEnv}/${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv}`));
        const twitch = validateTwitchConfig(config.connectors.twitch.accessToken, config.connectors.twitch.botUsername, firstTwitchChannel(config.connectors.twitch));
        items.push(liveConnectorItem("twitch", twitch.ok, twitch.detail, Boolean(config.connectors.twitch.enabled), Boolean(config.connectors.twitch.accessToken && config.connectors.twitch.botUsername && hasTwitchChannel(config.connectors.twitch)), `${config.connectors.twitch.accessTokenEnv}/${config.connectors.twitch.botUsernameEnv}/${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv}`));
        const ntfy = validateNtfyTarget(config.connectors.ntfy.baseUrl, config.connectors.ntfy.token, firstNtfyTopic(config.connectors.ntfy));
        items.push(liveConnectorItem("ntfy", ntfy.ok, ntfy.detail, Boolean(config.connectors.ntfy.enabled), hasNtfyTopic(config.connectors.ntfy), `${config.connectors.ntfy.baseUrlEnv}/${config.connectors.ntfy.tokenEnv}/${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv}`));
        const mastodon = await validateMastodonToken(config.connectors.mastodon.baseUrl, config.connectors.mastodon.accessToken, config.connectors.mastodon.visibility);
        items.push(liveConnectorItem("mastodon", mastodon.ok, mastodon.detail, Boolean(config.connectors.mastodon.enabled), Boolean(config.connectors.mastodon.baseUrl && config.connectors.mastodon.accessToken), `${config.connectors.mastodon.baseUrlEnv}/${config.connectors.mastodon.accessTokenEnv}/${config.connectors.mastodon.visibilityEnv}/${config.connectors.mastodon.targetsEnv}`));
        const nextcloudTalk = validateNextcloudTalkConfig(config.connectors.nextcloudTalk.baseUrl, config.connectors.nextcloudTalk.username, config.connectors.nextcloudTalk.appPassword, firstNextcloudTalkRoom(config.connectors.nextcloudTalk));
        items.push(liveConnectorItem("nextcloud-talk", nextcloudTalk.ok, nextcloudTalk.detail, Boolean(config.connectors.nextcloudTalk.enabled), Boolean(config.connectors.nextcloudTalk.baseUrl && config.connectors.nextcloudTalk.username && config.connectors.nextcloudTalk.appPassword && hasNextcloudTalkRoom(config.connectors.nextcloudTalk)), `${config.connectors.nextcloudTalk.baseUrlEnv}/${config.connectors.nextcloudTalk.usernameEnv}/${config.connectors.nextcloudTalk.appPasswordEnv}/${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv}`));
        const webex = await validateWebexToken(config.connectors.webex.accessToken);
        items.push(liveConnectorItem("webex", webex.ok, webex.detail, Boolean(config.connectors.webex.enabled), Boolean(config.connectors.webex.accessToken), config.connectors.webex.accessTokenEnv));
        const zulip = await validateZulipToken(config.connectors.zulip.siteUrl, config.connectors.zulip.botEmail, config.connectors.zulip.apiKey);
        items.push(liveConnectorItem("zulip", zulip.ok, zulip.detail, Boolean(config.connectors.zulip.enabled), hasZulipCredentials(config.connectors.zulip), `${config.connectors.zulip.siteUrlEnv}/${config.connectors.zulip.botEmailEnv}/${config.connectors.zulip.apiKeyEnv}`));
        const emailReady = Boolean(config.connectors.email.from && hasEmailRecipient(config.connectors.email) && commandExists(config.connectors.email.sendmailCommand));
        items.push(liveConnectorItem("email", emailReady, emailReady ? "local sendmail command and envelope are configured" : "missing local sendmail command, from address, or recipient alias", Boolean(config.connectors.email.enabled), Boolean(config.connectors.email.from && hasEmailRecipient(config.connectors.email)), `${config.connectors.email.sendmailCommandEnv}/${config.connectors.email.fromEnv}/${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv}`));
        const github = config.connectors.github.token && hasGitHubTarget(config.connectors.github)
            ? await validateGitHubToken(config.connectors.github.token)
            : validateGitHubTarget(config.connectors.github.token, firstGitHubTarget(config.connectors.github));
        items.push(liveConnectorItem("github", github.ok, github.detail, Boolean(config.connectors.github.enabled), Boolean(config.connectors.github.token || hasGitHubTarget(config.connectors.github)), `${config.connectors.github.tokenEnv}/${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv}`));
        const todoist = config.connectors.todoist.token
            ? await validateTodoistToken(config.connectors.todoist.token)
            : validateTodoistTarget(config.connectors.todoist.token, firstTodoistProject(config.connectors.todoist));
        items.push(liveConnectorItem("todoist", todoist.ok, todoist.detail, Boolean(config.connectors.todoist.enabled), Boolean(config.connectors.todoist.token), `${config.connectors.todoist.tokenEnv}/${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv}`));
        const notion = config.connectors.notion.token && hasNotionPage(config.connectors.notion)
            ? await validateNotionToken(config.connectors.notion.token)
            : validateNotionTarget(config.connectors.notion.token, firstNotionPage(config.connectors.notion));
        items.push(liveConnectorItem("notion", notion.ok, notion.detail, Boolean(config.connectors.notion.enabled), Boolean(config.connectors.notion.token || hasNotionPage(config.connectors.notion)), `${config.connectors.notion.tokenEnv}/${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv}`));
        const obsidian = validateObsidianTarget(config.connectors.obsidian.vaultDir, firstObsidianNote(config.connectors.obsidian));
        items.push(liveConnectorItem("obsidian", obsidian.ok, obsidian.detail, Boolean(config.connectors.obsidian.enabled), Boolean(config.connectors.obsidian.vaultDir || hasObsidianNote(config.connectors.obsidian)), `${config.connectors.obsidian.vaultDirEnv}/${config.connectors.obsidian.noteEnv}/${config.connectors.obsidian.notesEnv}`));
    }
    return items;
}
function hasWebhook(config) {
    return Boolean(config.webhookUrl || Object.keys(config.webhookUrls).length > 0);
}
function firstWebhookUrl(config) {
    return config.webhookUrl ?? Object.values(config.webhookUrls)[0];
}
function hasHomeAssistantService(config) {
    return Boolean(config.service || Object.keys(config.services).length > 0);
}
function firstHomeAssistantService(config) {
    return config.service ?? Object.values(config.services)[0];
}
function hasZulipCredentials(config) {
    return Boolean(config.siteUrl && config.botEmail && config.apiKey);
}
function hasZulipTarget(config) {
    return Boolean(config.target || Object.keys(config.targets).length > 0);
}
function hasEmailRecipient(config) {
    return Boolean(config.recipient || Object.keys(config.recipients).length > 0);
}
function hasGitHubTarget(config) {
    return Boolean(config.target || Object.keys(config.targets).length > 0);
}
function firstGitHubTarget(config) {
    return config.target ?? Object.values(config.targets)[0];
}
function firstTodoistProject(config) {
    return config.project ?? Object.values(config.projects)[0];
}
function hasNotionPage(config) {
    return Boolean(config.page || Object.keys(config.pages).length > 0);
}
function firstNotionPage(config) {
    return config.page ?? Object.values(config.pages)[0];
}
function hasObsidianNote(config) {
    return Boolean(config.note || Object.keys(config.notes).length > 0);
}
function firstObsidianNote(config) {
    return config.note ?? Object.values(config.notes)[0];
}
function hasIrcChannel(config) {
    return Boolean(config.channel || Object.keys(config.channels).length > 0);
}
function firstIrcChannel(config) {
    return config.channel ?? Object.values(config.channels)[0];
}
function hasTwitchChannel(config) {
    return Boolean(config.channel || Object.keys(config.channels).length > 0);
}
function firstTwitchChannel(config) {
    return config.channel ?? Object.values(config.channels)[0];
}
function hasNtfyTopic(config) {
    return Boolean(config.topic || Object.keys(config.topics).length > 0);
}
function firstNtfyTopic(config) {
    return config.topic ?? Object.values(config.topics)[0];
}
function hasNextcloudTalkRoom(config) {
    return Boolean(config.roomToken || Object.keys(config.rooms).length > 0);
}
function firstNextcloudTalkRoom(config) {
    return config.roomToken ?? Object.values(config.rooms)[0];
}
function hasZaloRecipient(config) {
    return Boolean(config.recipient || Object.keys(config.recipients).length > 0);
}
function firstZaloRecipient(config) {
    return config.recipient ?? Object.values(config.recipients)[0];
}
async function providerProbeItems(config, options, providerCandidateIds) {
    if (!options.probeProviders && !options.probeAllProviders)
        return [];
    const allMode = Boolean(options.probeAllProviders);
    const providers = allMode
        ? Object.values(config.providers)
        : config.providers[config.assistant.defaultProvider]
            ? [config.providers[config.assistant.defaultProvider]]
            : [];
    const providerAvailability = uniqueProviders(providers).map((provider) => ({
        provider,
        installed: commandExists(provider.command, providerCommandLookupOptions(provider)),
        routable: providerCandidateIds.includes(provider.id)
    }));
    const installedProviders = providerAvailability.filter((entry) => entry.installed).map((entry) => entry.provider);
    const items = [];
    if (installedProviders.length === 0) {
        if (allMode) {
            for (const entry of providerAvailability.filter((item) => !item.installed)) {
                items.push(missingProviderProbeItem(entry.provider, entry.routable, false));
            }
        }
        return allMode
            ? [
                ...items,
                {
                    status: "fail",
                    area: "provider-runtime",
                    message: "no configured provider command is installed",
                    next: "Install/login at least one default or fallback provider, then rerun `viser provider-guide --probe`."
                }
            ]
            : [];
    }
    const results = [];
    for (const provider of installedProviders) {
        const probe = await probeCliProvider(provider);
        results.push({
            provider,
            ok: probe.ok,
            detail: probe.detail,
            elapsedMs: probe.elapsedMs,
            routable: providerCandidateIds.includes(provider.id)
        });
    }
    const usableRoutableProviders = results
        .filter((result) => result.routable && result.ok)
        .map((result) => result.provider.id);
    const hasUsableRoutableProvider = usableRoutableProviders.length > 0;
    if (allMode) {
        for (const entry of providerAvailability.filter((item) => !item.installed)) {
            items.push(missingProviderProbeItem(entry.provider, entry.routable, hasUsableRoutableProvider));
        }
    }
    for (const result of results) {
        const status = result.ok
            ? "pass"
            : allMode && hasUsableRoutableProvider
                ? "warn"
                : result.routable
                    ? "fail"
                    : "warn";
        items.push({
            status,
            area: "provider-probe",
            message: `${result.provider.id}: ${result.ok ? "responded" : "failed"} in ${result.elapsedMs}ms${result.ok ? ` (${result.detail})` : ""}${result.routable ? "" : " (not in default/fallback path)"}`,
            next: result.ok ? undefined : `${result.detail}; run \`viser provider-guide ${result.provider.id} --probe\` for provider-specific setup.`
        });
    }
    if (allMode) {
        items.push({
            status: hasUsableRoutableProvider ? "pass" : "fail",
            area: "provider-runtime",
            message: hasUsableRoutableProvider
                ? `usable default/fallback provider(s): ${usableRoutableProviders.join(", ")}`
                : "no default/fallback provider responded successfully",
            next: hasUsableRoutableProvider
                ? undefined
                : "Fix a default/fallback provider login, or add a passing provider to assistant.fallbackProviders."
        });
    }
    return items;
}
function missingProviderProbeItem(provider, routable, hasUsableRoutableProvider) {
    const status = hasUsableRoutableProvider
        ? "warn"
        : routable
            ? "fail"
            : "warn";
    return {
        status,
        area: "provider-probe",
        message: `${provider.id}: command '${provider.command}' missing${routable ? "" : " (not in default/fallback path)"}`,
        next: `${provider.loginHint ?? `Install ${provider.command}.`} Then run \`viser provider-guide ${provider.id} --probe\`.`
    };
}
function assistantProviderCandidateIds(config) {
    return [...new Set([config.assistant.defaultProvider, ...config.assistant.fallbackProviders])];
}
function providerCommandLookupOptions(provider) {
    return { cwd: provider.cwd, pathValue: provider.env?.PATH };
}
function missingOptionalProviderNext(provider, isFallbackProvider) {
    const installHint = provider.loginHint ?? `Install ${provider.command}, then rerun \`viser readiness\`.`;
    const silenceHint = isFallbackProvider
        ? `If you do not want this fallback, remove '${provider.id}' from assistant.fallbackProviders.`
        : `If this provider is unused, remove providers.${provider.id} from config.`;
    return `${installHint} ${silenceHint}`;
}
function uniqueProviders(providers) {
    const seen = new Set();
    return providers.filter((provider) => {
        if (seen.has(provider.id))
            return false;
        seen.add(provider.id);
        return true;
    });
}
function toolShellReadinessItem(config) {
    if (!config.tools.enabled) {
        return {
            status: "warn",
            area: "tools",
            message: "local tools disabled",
            next: "Enable tools when you want the assistant to inspect local files explicitly."
        };
    }
    if (!config.tools.shell.enabled) {
        return {
            status: "warn",
            area: "tools",
            message: "shell tool disabled",
            next: "Enable tools.shell when read-only local shell checks should be available."
        };
    }
    if (config.tools.shell.allowedCommands.length === 0) {
        return {
            status: "warn",
            area: "tools",
            message: "shell tool has no allowlisted commands",
            next: "Add read-only commands such as pwd, ls, cat, grep, rg, find, wc, or git."
        };
    }
    const commandRoot = config.tools.allowedReadRoots[0] ?? config.assistant.workdir;
    const missing = config.tools.shell.allowedCommands.filter((command) => !commandExists(command, { cwd: commandRoot }));
    if (missing.length > 0) {
        return {
            status: "warn",
            area: "tools",
            message: `shell commands missing: ${missing.join(", ")}`,
            next: "Install the missing read-only command(s), remove them from tools.shell.allowedCommands, or fix PATH before launch."
        };
    }
    return {
        status: "pass",
        area: "tools",
        message: `shell commands available (${config.tools.shell.allowedCommands.length})`
    };
}
function addConnectorStaticChecks(items, name, enabled, hasToken, envName) {
    if (enabled && !hasToken) {
        items.push({ status: "fail", area: name, message: "enabled but token is missing", next: `Set ${envName} or disable ${name}.` });
        return;
    }
    if (!enabled && !hasToken) {
        items.push({ status: "pass", area: name, message: "disabled (no token configured)" });
        return;
    }
    items.push({ status: "pass", area: name, message: hasToken ? "token present" : "disabled" });
}
function liveConnectorItem(name, ok, detail, enabled, hasToken, envName) {
    const configured = enabled || hasToken;
    if (!configured) {
        return {
            status: "pass",
            area: "live",
            message: `${name}: disabled (no token configured)`
        };
    }
    return {
        status: ok ? "pass" : configured ? "fail" : "warn",
        area: "live",
        message: `${name}: ${detail}`,
        next: ok
            ? undefined
            : hasToken
                ? `Check ${envName}; the configured token was rejected by ${name}.`
                : `Set ${envName}.`
    };
}
async function writableDirItem(area, dir) {
    const probePath = join(dir, `.viser-readiness-${randomUUID()}.tmp`);
    try {
        await ensurePrivateDir(dir);
        await writeReadinessProbeFileNoFollow(probePath);
        await removePrivateFileIfExists(probePath, { dirs: [dir] });
        return { status: "pass", area, message: `writable (${dir})` };
    }
    catch (error) {
        return {
            status: "fail",
            area,
            message: `not writable (${dir})`,
            next: error instanceof Error ? error.message : String(error)
        };
    }
}
function webDashboardAuthReadinessItem(config) {
    const remoteHost = !LOCAL_DASHBOARD_HOSTS.has(config.webDashboard.host);
    if (!remoteHost) {
        return {
            status: "pass",
            area: "web-dashboard-auth",
            message: config.webDashboard.authToken ? "local dashboard auth token is configured" : "localhost dashboard does not require remote auth"
        };
    }
    if (!config.webDashboard.allowRemote) {
        return {
            status: "fail",
            area: "web-dashboard-auth",
            message: "non-local dashboard host requires webDashboard.allowRemote=true",
            next: "Use localhost by default, or set allowRemote=true with VISER_DASHBOARD_TOKEN behind a trusted tunnel/reverse proxy."
        };
    }
    if (!config.webDashboard.authToken || config.webDashboard.authToken.length < 16) {
        return {
            status: "fail",
            area: "web-dashboard-auth",
            message: "remote dashboard requires a strong VISER_DASHBOARD_TOKEN",
            next: `Set ${config.webDashboard.authTokenEnv || "VISER_DASHBOARD_TOKEN"} to a high-entropy token before binding outside localhost.`
        };
    }
    return {
        status: "pass",
        area: "web-dashboard-auth",
        message: "remote dashboard auth token is configured"
    };
}
export async function writeReadinessProbeFileNoFollow(path) {
    let handle;
    try {
        handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        await handle.writeFile("ok\n", "utf8");
        await handle.chmod(0o600);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "EEXIST") {
            throw new Error(`Readiness probe path already exists; refusing to overwrite it: ${path}`);
        }
        if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
            throw new Error(`Readiness probe path is a symlink; refusing to write it: ${path}`);
        }
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
function formatItem(item) {
    const prefix = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
    const next = item.next && item.status !== "pass" ? `\n   next: ${item.next}` : "";
    return `${prefix} [${item.area}] ${item.message}${next}`;
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
