// ================================================================
// Environment diagnostics
// ================================================================
// Secrets are intentionally never printed. This report explains which env file
// was considered, which keys came from the file versus the shell, and whether
// runtime-critical token variables are missing, empty, or present.
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { writePrivateFile } from "../utils/files.js";
export function envCheckReport(config, envLoad) {
    const envPath = envLoad?.path ?? process.env.VISER_ENV ?? ".env";
    const envInspection = inspectEnvFilePath(envPath);
    const envExists = envInspection.exists;
    const loaded = envLoad?.loaded ?? [];
    const skipped = envLoad?.skipped ?? [];
    const tokenKeys = [
        config.connectors.telegram.botTokenEnv,
        config.connectors.discord.botTokenEnv,
        config.connectors.slack.botTokenEnv,
        config.connectors.slack.appTokenEnv,
        config.connectors.slack.botUserIdEnv,
        config.connectors.matrix.homeserverUrlEnv,
        config.connectors.matrix.accessTokenEnv,
        config.connectors.matrix.userIdEnv,
        config.connectors.signal.accountEnv,
        config.connectors.signal.commandEnv,
        config.connectors.imessage.sqliteCommandEnv,
        config.connectors.imessage.osascriptCommandEnv,
        config.connectors.imessage.chatDbPathEnv,
        config.connectors.whatsapp.accessTokenEnv,
        config.connectors.whatsapp.phoneNumberIdEnv,
        config.connectors.whatsapp.verifyTokenEnv,
        config.connectors.whatsapp.graphApiVersionEnv,
        config.connectors.line.channelAccessTokenEnv,
        config.connectors.line.channelSecretEnv,
        config.connectors.kakaotalk.requestTokenEnv,
        config.connectors.googleChat.webhookUrlEnv,
        config.connectors.googleChat.webhookUrlsEnv,
        config.connectors.webhook.webhookUrlEnv,
        config.connectors.webhook.webhookUrlsEnv,
        config.connectors.webhook.inboundTokenEnv ?? "VISER_WEBHOOK_INBOUND_TOKEN",
        config.connectors.webhook.inboundSignatureSecretEnv ?? "VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET",
        config.connectors.homeAssistant.baseUrlEnv,
        config.connectors.homeAssistant.accessTokenEnv,
        config.connectors.homeAssistant.serviceEnv,
        config.connectors.homeAssistant.servicesEnv,
        config.connectors.teams.webhookUrlEnv,
        config.connectors.teams.webhookUrlsEnv,
        config.connectors.mattermost.webhookUrlEnv,
        config.connectors.mattermost.webhookUrlsEnv,
        config.connectors.synologyChat.webhookUrlEnv,
        config.connectors.synologyChat.webhookUrlsEnv,
        config.connectors.rocketChat.webhookUrlEnv,
        config.connectors.rocketChat.webhookUrlsEnv,
        config.connectors.feishu.webhookUrlEnv,
        config.connectors.feishu.webhookUrlsEnv,
        config.connectors.dingtalk.webhookUrlEnv,
        config.connectors.dingtalk.webhookUrlsEnv,
        config.connectors.wecom.webhookUrlEnv,
        config.connectors.wecom.webhookUrlsEnv,
        config.connectors.zalo.accessTokenEnv,
        config.connectors.zalo.recipientEnv,
        config.connectors.zalo.recipientsEnv,
        config.connectors.irc.hostEnv,
        config.connectors.irc.portEnv,
        config.connectors.irc.tlsEnv,
        config.connectors.irc.nickEnv,
        config.connectors.irc.passwordEnv,
        config.connectors.irc.channelEnv,
        config.connectors.irc.channelsEnv,
        config.connectors.twitch.accessTokenEnv,
        config.connectors.twitch.botUsernameEnv,
        config.connectors.twitch.channelEnv,
        config.connectors.twitch.channelsEnv,
        config.connectors.ntfy.baseUrlEnv,
        config.connectors.ntfy.tokenEnv,
        config.connectors.ntfy.topicEnv,
        config.connectors.ntfy.topicsEnv,
        config.connectors.mastodon.baseUrlEnv,
        config.connectors.mastodon.accessTokenEnv,
        config.connectors.mastodon.visibilityEnv,
        config.connectors.mastodon.targetsEnv,
        config.connectors.nextcloudTalk.baseUrlEnv,
        config.connectors.nextcloudTalk.usernameEnv,
        config.connectors.nextcloudTalk.appPasswordEnv,
        config.connectors.nextcloudTalk.roomTokenEnv,
        config.connectors.nextcloudTalk.roomsEnv,
        config.connectors.webex.accessTokenEnv,
        config.connectors.zulip.siteUrlEnv,
        config.connectors.zulip.botEmailEnv,
        config.connectors.zulip.apiKeyEnv,
        config.connectors.zulip.targetEnv,
        config.connectors.zulip.targetsEnv,
        config.connectors.email.sendmailCommandEnv,
        config.connectors.email.fromEnv,
        config.connectors.email.recipientEnv,
        config.connectors.email.recipientsEnv,
        config.connectors.github.tokenEnv,
        config.connectors.github.targetEnv,
        config.connectors.github.targetsEnv,
        config.connectors.notion.tokenEnv,
        config.connectors.notion.pageEnv,
        config.connectors.notion.pagesEnv,
        config.connectors.obsidian.vaultDirEnv,
        config.connectors.obsidian.noteEnv,
        config.connectors.obsidian.notesEnv,
        config.actions.browserTask.browserUseApiKeyEnv,
        config.actions.browserTask.browserbaseApiKeyEnv,
        config.actions.browserTask.browserbaseProjectIdEnv,
        config.actions.browserTask.firecrawlApiKeyEnv,
        config.actions.browserTask.localCdpBaseUrlEnv,
        config.tools.webFetch.firecrawlApiKeyEnv,
        config.tools.webSearch.braveApiKeyEnv,
        config.tools.webSearch.tavilyApiKeyEnv,
        config.tools.webSearch.perplexityApiKeyEnv,
        config.tools.webSearch.exaApiKeyEnv,
        config.tools.webSearch.firecrawlApiKeyEnv,
        config.tools.webSearch.ollamaApiKeyEnv
    ];
    const permissionNote = envInspection.note;
    return [
        "Viser env check",
        `env file: ${envPath} (${envExists ? "found" : "not found"})`,
        `loaded from env file: ${formatKeyList(loaded)}`,
        `kept from shell/pre-existing env: ${formatKeyList(skipped)}`,
        "",
        "Recognized variables:",
        formatEnvStatus("VISER_ENV", { valueMode: "plain", envLoad }),
        formatEnvStatus("VISER_CONFIG", { valueMode: "plain", envLoad }),
        formatEnvStatus("VISER_PROVIDER", { valueMode: "plain", envLoad }),
        ...[...new Set(tokenKeys)].map((key) => formatEnvStatus(key, { valueMode: "secret", envLoad })),
        "",
        "Effective config:",
        `- config path: ${config.configPath ?? "defaults only"}`,
        `- default provider: ${config.assistant.defaultProvider}`,
        `- telegram token: ${config.connectors.telegram.botToken ? "present (redacted)" : "missing or empty"}`,
        `- discord token: ${config.connectors.discord.botToken ? "present (redacted)" : "missing or empty"}`,
        `- slack bot token: ${config.connectors.slack.botToken ? "present (redacted)" : "missing or empty"}`,
        `- slack app token: ${config.connectors.slack.appToken ? "present (redacted)" : "missing or empty"}`,
        `- slack bot user id: ${config.connectors.slack.botUserId ? "present (redacted)" : "missing or empty"}`,
        `- matrix homeserver URL: ${config.connectors.matrix.homeserverUrl ? "present (redacted)" : "missing or empty"}`,
        `- matrix access token: ${config.connectors.matrix.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- matrix user id: ${config.connectors.matrix.userId ? "present (redacted)" : "missing or empty"}`,
        `- signal account: ${config.connectors.signal.account ? "present (redacted)" : "missing or empty"}`,
        `- signal-cli command: ${config.connectors.signal.command || "missing or empty"}`,
        `- imessage sqlite command: ${config.connectors.imessage.sqliteCommand || "missing or empty"}`,
        `- imessage osascript command: ${config.connectors.imessage.osascriptCommand || "missing or empty"}`,
        `- imessage chat db path: ${config.connectors.imessage.chatDbPath ? "present (redacted)" : "missing or empty"}`,
        `- whatsapp access token: ${config.connectors.whatsapp.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- whatsapp phone number id: ${config.connectors.whatsapp.phoneNumberId ? "present (redacted)" : "missing or empty"}`,
        `- whatsapp verify token: ${config.connectors.whatsapp.verifyToken ? "present (redacted)" : "missing or empty"}`,
        `- whatsapp Graph API version: ${config.connectors.whatsapp.graphApiVersion || "missing or empty"}`,
        `- LINE channel access token: ${config.connectors.line.channelAccessToken ? "present (redacted)" : "missing or empty"}`,
        `- LINE channel secret: ${config.connectors.line.channelSecret ? "present (redacted)" : "missing or empty"}`,
        `- KakaoTalk Skill token: ${config.connectors.kakaotalk.requestToken ? "present (redacted)" : "missing or empty"}`,
        `- Google Chat webhook URL: ${config.connectors.googleChat.webhookUrl || Object.keys(config.connectors.googleChat.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Generic webhook URL: ${config.connectors.webhook.webhookUrl || Object.keys(config.connectors.webhook.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Generic inbound webhook token: ${config.connectors.webhook.inboundToken ? "present (redacted)" : "missing or empty"}`,
        `- Generic inbound webhook signature secret: ${config.connectors.webhook.inboundSignatureSecret ? "present (redacted)" : "missing or empty"}`,
        `- Home Assistant base URL: ${config.connectors.homeAssistant.baseUrl ? "present (redacted)" : "missing or empty"}`,
        `- Home Assistant access token: ${config.connectors.homeAssistant.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- Home Assistant service alias: ${config.connectors.homeAssistant.service || Object.keys(config.connectors.homeAssistant.services).length ? "present (redacted)" : "missing or empty"}`,
        `- Microsoft Teams webhook URL: ${config.connectors.teams.webhookUrl || Object.keys(config.connectors.teams.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Mattermost webhook URL: ${config.connectors.mattermost.webhookUrl || Object.keys(config.connectors.mattermost.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Synology Chat webhook URL: ${config.connectors.synologyChat.webhookUrl || Object.keys(config.connectors.synologyChat.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Rocket.Chat webhook URL: ${config.connectors.rocketChat.webhookUrl || Object.keys(config.connectors.rocketChat.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Feishu webhook URL: ${config.connectors.feishu.webhookUrl || Object.keys(config.connectors.feishu.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- DingTalk webhook URL: ${config.connectors.dingtalk.webhookUrl || Object.keys(config.connectors.dingtalk.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- WeCom webhook URL: ${config.connectors.wecom.webhookUrl || Object.keys(config.connectors.wecom.webhookUrls).length ? "present (redacted)" : "missing or empty"}`,
        `- Zalo OA access token: ${config.connectors.zalo.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- Zalo recipient: ${config.connectors.zalo.recipient || Object.keys(config.connectors.zalo.recipients).length ? "present (redacted)" : "missing or empty"}`,
        `- IRC host: ${config.connectors.irc.host ? "present (redacted)" : "missing or empty"}`,
        `- IRC port: ${config.connectors.irc.port || "missing or empty"}`,
        `- IRC TLS: ${config.connectors.irc.tls ? "true" : "false"}`,
        `- IRC nick: ${config.connectors.irc.nick ? "present (redacted)" : "missing or empty"}`,
        `- IRC password: ${config.connectors.irc.password ? "present (redacted)" : "missing or empty"}`,
        `- IRC channel: ${config.connectors.irc.channel || Object.keys(config.connectors.irc.channels).length ? "present (redacted)" : "missing or empty"}`,
        `- Twitch OAuth token: ${config.connectors.twitch.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- Twitch bot username: ${config.connectors.twitch.botUsername ? "present (redacted)" : "missing or empty"}`,
        `- Twitch channel: ${config.connectors.twitch.channel || Object.keys(config.connectors.twitch.channels).length ? "present (redacted)" : "missing or empty"}`,
        `- ntfy base URL: ${config.connectors.ntfy.baseUrl ? "present (redacted)" : "missing or empty"}`,
        `- ntfy token: ${config.connectors.ntfy.token ? "present (redacted)" : "optional public topic"}`,
        `- ntfy topic: ${config.connectors.ntfy.topic || Object.keys(config.connectors.ntfy.topics).length ? "present (redacted)" : "missing or empty"}`,
        `- Mastodon base URL: ${config.connectors.mastodon.baseUrl ? "present (redacted)" : "missing or empty"}`,
        `- Mastodon access token: ${config.connectors.mastodon.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- Mastodon visibility: ${config.connectors.mastodon.visibility}`,
        `- Mastodon targets: ${Object.keys(config.connectors.mastodon.targets).length ? "present (redacted)" : "optional default visibility"}`,
        `- Nextcloud Talk base URL: ${config.connectors.nextcloudTalk.baseUrl ? "present (redacted)" : "missing or empty"}`,
        `- Nextcloud Talk username: ${config.connectors.nextcloudTalk.username ? "present (redacted)" : "missing or empty"}`,
        `- Nextcloud Talk app password: ${config.connectors.nextcloudTalk.appPassword ? "present (redacted)" : "missing or empty"}`,
        `- Nextcloud Talk room: ${config.connectors.nextcloudTalk.roomToken || Object.keys(config.connectors.nextcloudTalk.rooms).length ? "present (redacted)" : "missing or empty"}`,
        `- Webex access token: ${config.connectors.webex.accessToken ? "present (redacted)" : "missing or empty"}`,
        `- Zulip site URL: ${config.connectors.zulip.siteUrl ? "present (redacted)" : "missing or empty"}`,
        `- Zulip bot email: ${config.connectors.zulip.botEmail ? "present (redacted)" : "missing or empty"}`,
        `- Zulip API key: ${config.connectors.zulip.apiKey ? "present (redacted)" : "missing or empty"}`,
        `- Zulip target: ${config.connectors.zulip.target || Object.keys(config.connectors.zulip.targets).length ? "present (redacted)" : "missing or empty"}`,
        `- Email sendmail command: ${config.connectors.email.sendmailCommand || "missing or empty"}`,
        `- Email from: ${config.connectors.email.from ? "present (redacted)" : "missing or empty"}`,
        `- Email recipient: ${config.connectors.email.recipient || Object.keys(config.connectors.email.recipients).length ? "present (redacted)" : "missing or empty"}`,
        `- GitHub token: ${config.connectors.github.token ? "present (redacted)" : "missing or empty"}`,
        `- GitHub issue/PR target: ${config.connectors.github.target || Object.keys(config.connectors.github.targets).length ? "present (redacted)" : "missing or empty"}`,
        `- Todoist API token: ${config.connectors.todoist.token ? "present (redacted)" : "missing or empty"}`,
        `- Todoist project target: ${config.connectors.todoist.project || Object.keys(config.connectors.todoist.projects).length ? "present (redacted)" : "optional inbox/default"}`,
        `- Notion token: ${config.connectors.notion.token ? "present (redacted)" : "missing or empty"}`,
        `- Notion page target: ${config.connectors.notion.page || Object.keys(config.connectors.notion.pages).length ? "present (redacted)" : "missing or empty"}`,
        `- Obsidian vault dir: ${config.connectors.obsidian.vaultDir ? "present (redacted)" : "missing or empty"}`,
        `- Obsidian note target: ${config.connectors.obsidian.note || Object.keys(config.connectors.obsidian.notes).length ? "present (redacted)" : "missing or empty"}`,
        `- Browser task provider: ${config.actions.browserTask.provider}`,
        `- Browser Use API key: ${config.actions.browserTask.browserUseApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Browserbase API key: ${config.actions.browserTask.browserbaseApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Browserbase project ID: ${config.actions.browserTask.browserbaseProjectId ? "present (redacted)" : "optional / inferred"}`,
        `- Firecrawl browser-task API key: ${config.actions.browserTask.firecrawlApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Local CDP base URL: ${config.actions.browserTask.localCdpBaseUrl || "missing or empty"}`,
        `- Firecrawl Scrape API key: ${config.tools.webFetch.firecrawlApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Brave Search API key: ${config.tools.webSearch.braveApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Tavily Search API key: ${config.tools.webSearch.tavilyApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Perplexity Search API key: ${config.tools.webSearch.perplexityApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Exa Search API key: ${config.tools.webSearch.exaApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Firecrawl Search API key: ${config.tools.webSearch.firecrawlApiKey ? "present (redacted)" : "missing or empty"}`,
        `- Ollama Web Search base URL: ${config.tools.webSearch.ollamaBaseUrl || "missing or empty"}`,
        `- Ollama Web Search API key: ${config.tools.webSearch.ollamaApiKey ? "present (redacted)" : "optional for signed-in local daemon"}`,
        "",
        "Notes:",
        "- shell/pre-existing env values win over .env values.",
        "- empty token/account variables count as missing for runtime launch checks.",
        "- keep real transport credentials in a private .env or shell, not in viser.config.json.",
        ...(permissionNote ? [permissionNote] : []),
        "",
        "Next:",
        envExists
            ? `- edit ${shellishPath(envPath)} with real credential values if you need Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion, or run \`viser env-init --force\` to regenerate it.`
            : "- run `viser env-init` to create a private `.env` template, or run with `--env ./path/to.env`.",
        "- rerun `viser env-check` to confirm variables are detected.",
        "- rerun `viser launch-status` before foreground gateway launch."
    ].join("\n");
}
export async function writeEnvTemplate(config, options = {}) {
    const target = resolve(process.cwd(), options.outputPath ?? ".env");
    const inspection = inspectEnvFilePath(target);
    if (inspection.exists && !options.force) {
        if (inspection.unsafe) {
            throw new Error(`Env template target is unsafe; refusing to treat it as an existing safe env file: ${target}${inspection.note ? ` (${inspection.note})` : ""}`);
        }
        return `.env already exists. Use --force to overwrite or --output for another file: ${target}`;
    }
    await writePrivateFile(target, envTemplate(config));
    return `Created ${target}\nNext: fill token values if needed, then run \`viser env-check${target.endsWith("/.env") ? "" : ` --env ${shellishPath(target)}`}\`.`;
}
function envTemplate(config) {
    return [
        "# Viser runtime environment",
        "# This file is private and should stay out of git.",
        "# Viser uses logged-in local CLI providers, not model API keys.",
        `VISER_PROVIDER=${config.assistant.defaultProvider}`,
        `VISER_CONFIG=${configPathForEnv(config)}`,
        "",
        "# Optional: set this in your shell/service instead of inside this file when using a non-default env path.",
        "# VISER_ENV=./.env",
        "",
        "# Messenger bridge tokens are transport credentials only.",
        "# Leave blank if you do not use Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion.",
        `${config.connectors.telegram.botTokenEnv}=`,
        `${config.connectors.discord.botTokenEnv}=`,
        `${config.connectors.slack.botTokenEnv}=`,
        `${config.connectors.slack.appTokenEnv}=`,
        `${config.connectors.slack.botUserIdEnv}=`,
        `${config.connectors.matrix.homeserverUrlEnv}=`,
        `${config.connectors.matrix.accessTokenEnv}=`,
        `${config.connectors.matrix.userIdEnv}=`,
        `${config.connectors.signal.accountEnv}=`,
        `${config.connectors.signal.commandEnv}=${config.connectors.signal.command}`,
        `${config.connectors.imessage.sqliteCommandEnv}=${config.connectors.imessage.sqliteCommand}`,
        `${config.connectors.imessage.osascriptCommandEnv}=${config.connectors.imessage.osascriptCommand}`,
        `${config.connectors.imessage.chatDbPathEnv}=`,
        `${config.connectors.whatsapp.accessTokenEnv}=`,
        `${config.connectors.whatsapp.phoneNumberIdEnv}=`,
        `${config.connectors.whatsapp.verifyTokenEnv}=`,
        `${config.connectors.whatsapp.graphApiVersionEnv}=${config.connectors.whatsapp.graphApiVersion}`,
        `${config.connectors.line.channelAccessTokenEnv}=`,
        `${config.connectors.line.channelSecretEnv}=`,
        `${config.connectors.kakaotalk.requestTokenEnv}=`,
        `${config.connectors.googleChat.webhookUrlEnv}=`,
        `${config.connectors.googleChat.webhookUrlsEnv}=`,
        `${config.connectors.webhook.webhookUrlEnv}=`,
        `${config.connectors.webhook.webhookUrlsEnv}=`,
        `${config.connectors.webhook.inboundTokenEnv ?? "VISER_WEBHOOK_INBOUND_TOKEN"}=`,
        `${config.connectors.webhook.inboundSignatureSecretEnv ?? "VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET"}=`,
        `${config.connectors.homeAssistant.baseUrlEnv}=`,
        `${config.connectors.homeAssistant.accessTokenEnv}=`,
        `${config.connectors.homeAssistant.serviceEnv}=`,
        `${config.connectors.homeAssistant.servicesEnv}=`,
        `${config.connectors.teams.webhookUrlEnv}=`,
        `${config.connectors.teams.webhookUrlsEnv}=`,
        `${config.connectors.mattermost.webhookUrlEnv}=`,
        `${config.connectors.mattermost.webhookUrlsEnv}=`,
        `${config.connectors.synologyChat.webhookUrlEnv}=`,
        `${config.connectors.synologyChat.webhookUrlsEnv}=`,
        `${config.connectors.rocketChat.webhookUrlEnv}=`,
        `${config.connectors.rocketChat.webhookUrlsEnv}=`,
        `${config.connectors.feishu.webhookUrlEnv}=`,
        `${config.connectors.feishu.webhookUrlsEnv}=`,
        `${config.connectors.dingtalk.webhookUrlEnv}=`,
        `${config.connectors.dingtalk.webhookUrlsEnv}=`,
        `${config.connectors.wecom.webhookUrlEnv}=`,
        `${config.connectors.wecom.webhookUrlsEnv}=`,
        `${config.connectors.zalo.accessTokenEnv}=`,
        `${config.connectors.zalo.recipientEnv}=`,
        `${config.connectors.zalo.recipientsEnv}=`,
        `${config.connectors.irc.hostEnv}=`,
        `${config.connectors.irc.portEnv}=${config.connectors.irc.port}`,
        `${config.connectors.irc.tlsEnv}=${config.connectors.irc.tls ? "true" : "false"}`,
        `${config.connectors.irc.nickEnv}=`,
        `${config.connectors.irc.passwordEnv}=`,
        `${config.connectors.irc.channelEnv}=`,
        `${config.connectors.irc.channelsEnv}=`,
        `${config.connectors.twitch.accessTokenEnv}=`,
        `${config.connectors.twitch.botUsernameEnv}=`,
        `${config.connectors.twitch.channelEnv}=`,
        `${config.connectors.twitch.channelsEnv}=`,
        `${config.connectors.ntfy.baseUrlEnv}=https://ntfy.sh`,
        `${config.connectors.ntfy.tokenEnv}=`,
        `${config.connectors.ntfy.topicEnv}=`,
        `${config.connectors.ntfy.topicsEnv}=`,
        `${config.connectors.mastodon.baseUrlEnv}=`,
        `${config.connectors.mastodon.accessTokenEnv}=`,
        `${config.connectors.mastodon.visibilityEnv}=private`,
        `${config.connectors.mastodon.targetsEnv}=`,
        `${config.connectors.nextcloudTalk.baseUrlEnv}=`,
        `${config.connectors.nextcloudTalk.usernameEnv}=`,
        `${config.connectors.nextcloudTalk.appPasswordEnv}=`,
        `${config.connectors.nextcloudTalk.roomTokenEnv}=`,
        `${config.connectors.nextcloudTalk.roomsEnv}=`,
        `${config.connectors.webex.accessTokenEnv}=`,
        `${config.connectors.zulip.siteUrlEnv}=`,
        `${config.connectors.zulip.botEmailEnv}=`,
        `${config.connectors.zulip.apiKeyEnv}=`,
        `${config.connectors.zulip.targetEnv}=`,
        `${config.connectors.zulip.targetsEnv}=`,
        `${config.connectors.email.sendmailCommandEnv}=${config.connectors.email.sendmailCommand}`,
        `${config.connectors.email.fromEnv}=`,
        `${config.connectors.email.recipientEnv}=`,
        `${config.connectors.email.recipientsEnv}=`,
        `${config.connectors.github.tokenEnv}=`,
        `${config.connectors.github.targetEnv}=`,
        `${config.connectors.github.targetsEnv}=`,
        `${config.connectors.todoist.tokenEnv}=`,
        `${config.connectors.todoist.projectEnv}=`,
        `${config.connectors.todoist.projectsEnv}=`,
        `${config.connectors.notion.tokenEnv}=`,
        `${config.connectors.notion.pageEnv}=`,
        `${config.connectors.notion.pagesEnv}=`,
        `${config.connectors.obsidian.vaultDirEnv}=`,
        `${config.connectors.obsidian.noteEnv}=`,
        `${config.connectors.obsidian.notesEnv}=`,
        "",
        "# Optional browser automation credentials/endpoints.",
        `${config.actions.browserTask.browserUseApiKeyEnv}=`,
        `${config.actions.browserTask.browserbaseApiKeyEnv}=`,
        `${config.actions.browserTask.browserbaseProjectIdEnv}=`,
        `${config.actions.browserTask.localCdpBaseUrlEnv}=${config.actions.browserTask.localCdpBaseUrl}`,
        "",
        "# Optional web-search/web-fetch provider transport credential.",
        ...uniqueEnvAssignments([
            config.tools.webFetch.firecrawlApiKeyEnv,
            config.tools.webSearch.braveApiKeyEnv,
            config.tools.webSearch.tavilyApiKeyEnv,
            config.tools.webSearch.perplexityApiKeyEnv,
            config.tools.webSearch.exaApiKeyEnv,
            config.tools.webSearch.firecrawlApiKeyEnv,
            config.tools.webSearch.ollamaApiKeyEnv
        ]),
        ""
    ].join("\n");
}
function uniqueEnvAssignments(keys) {
    return [...new Set(keys.filter((key) => Boolean(key?.trim())))].map((key) => `${key}=`);
}
function formatEnvStatus(key, options) {
    const value = process.env[key];
    const source = envSource(key, options.envLoad);
    const status = value === undefined
        ? "missing"
        : value === ""
            ? "empty"
            : options.valueMode === "secret"
                ? "present (redacted)"
                : `set (${value})`;
    return `- ${key}: ${status}${source ? ` · source=${source}` : ""}`;
}
function envSource(key, envLoad) {
    if (envLoad?.loaded.includes(key))
        return "env-file";
    if (envLoad?.skipped.includes(key))
        return "shell/pre-existing";
    if (key === "VISER_ENV" && process.env.VISER_ENV)
        return "active";
    if (process.env[key] !== undefined)
        return "process";
    return undefined;
}
function formatKeyList(keys) {
    return keys.length ? keys.join(", ") : "none";
}
function inspectEnvFilePath(path) {
    const symlinkComponent = firstSymlinkParentComponentUnderRoot(path, process.cwd());
    if (symlinkComponent) {
        return {
            exists: true,
            unsafe: true,
            note: `- env path contains a symlink component (${shellishPath(symlinkComponent)}); Viser refuses to load env files through symlinked paths.`
        };
    }
    try {
        const info = lstatSync(path);
        if (info.isSymbolicLink()) {
            return { exists: true, unsafe: true, note: "- env file is a symlink; Viser refuses to load symlinked env files." };
        }
        if (!info.isFile()) {
            return { exists: true, unsafe: true, note: "- env path is not a regular file; Viser only loads regular env files." };
        }
        const mode = info.mode & 0o777;
        if ((mode & 0o077) === 0)
            return { exists: true };
        return {
            exists: true,
            note: `- env file permissions are broad (${mode.toString(8)}); run \`chmod 600 ${shellishPath(path)}\` before storing real tokens.`
        };
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return { exists: false };
        return {
            exists: true,
            unsafe: true,
            note: `- could not inspect env file permissions (${shellishPath(path)}): ${error instanceof Error ? error.message : String(error)}`
        };
    }
}
function configPathForEnv(config) {
    const configPath = config.configPath ?? resolve(process.cwd(), "viser.config.json");
    const rel = relative(realPath(process.cwd()), join(realPath(dirname(configPath)), basename(configPath)));
    if (!rel || rel.startsWith(".."))
        return configPath;
    return rel.startsWith(".") ? rel : `./${rel}`;
}
function shellishPath(path) {
    const rel = relative(realPath(process.cwd()), join(realPath(dirname(path)), basename(path)));
    return !rel || rel.startsWith("..") ? path : `./${rel}`;
}
function firstSymlinkParentComponentUnderRoot(path, root) {
    const absolutePath = resolve(path);
    const absoluteRoot = resolve(root);
    const rel = relative(absoluteRoot, absolutePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
        return undefined;
    let current = absoluteRoot;
    const parentParts = rel.split(/[\\/]/u).filter(Boolean).slice(0, -1);
    for (const part of parentParts) {
        current = join(current, part);
        try {
            if (lstatSync(current).isSymbolicLink())
                return current;
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
    return undefined;
}
function realPath(path) {
    try {
        return realpathSync(path);
    }
    catch {
        return resolve(path);
    }
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
