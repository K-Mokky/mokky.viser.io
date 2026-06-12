// ================================================================
// Actionable runbook
// ================================================================
// `verify` is a gate. `next-steps` is the operator runbook: it turns the
// current readiness/audit evidence into the exact commands that make Viser
// usable from CLI, gateway, and messenger surfaces.
import { auditItems, summarizeAudit } from "./audit.js";
import { readinessItems, summarizeReadiness } from "./readiness.js";
import { providerIssueAdvice, providerSmokeCommand } from "../providers/guide.js";
import { commandExists } from "../utils/exec.js";
export async function nextStepsReport(config, options = {}) {
    const readiness = await readinessItems(config, options);
    const audit = await auditItems(config);
    const readinessSummary = summarizeReadiness(readiness);
    const auditSummary = summarizeAudit(audit);
    const providerRunbook = providerSteps(config, readiness, options);
    const toolsRunbook = toolsSteps(readiness);
    const messengerRunbook = messengerSteps(config, readiness);
    const safetyRunbook = safetySteps(audit);
    return [
        "Viser next steps",
        `readiness: ${readinessSummary.verdict} (${readinessSummary.passCount} pass, ${readinessSummary.warnCount} warn, ${readinessSummary.failCount} fail)`,
        `audit: ${auditSummary.verdict} (${auditSummary.passCount} pass, ${auditSummary.warnCount} warn, ${auditSummary.failCount} fail)`,
        "",
        "1. Provider runtime",
        ...providerRunbook.map((line) => `   ${line}`),
        "",
        "2. Local tools",
        ...toolsRunbook.map((line) => `   ${line}`),
        "",
        "3. Messaging / gateway",
        ...messengerRunbook.map((line) => `   ${line}`),
        "",
        "4. Safety / persistence",
        ...safetyRunbook.map((line) => `   ${line}`),
        "",
        "5. Launch commands",
        "   - Single-command launch status: `viser launch-status`",
        "   - No-start preflight: `viser preflight`",
        "   - Live provider-proof preflight: `viser preflight --live --probe-all-providers`",
        "   - Foreground runtime: `viser`",
        "   - CLI chat: `viser chat`",
        "   - One-off ask: `viser ask \"질문\"`",
        "   - Queue work: `viser enqueue \"긴 작업\"` then `viser run-jobs 1` or `viser run-jobs 6 --parallel 3` for independent queued jobs",
        "   - Benchmark local/competitive performance: `viser benchmark` or `viser benchmark --live --provider <provider> --hermes \"hermes ... {prompt}\" --openclaw \"openclaw ... {prompt}\"`",
        "   - Gateway readiness dry-run: `viser gateway --dry-run`",
        "   - Gateway strict live provider-proof dry-run: `viser gateway --dry-run --strict --live --probe-all-providers`",
        "   - Live provider-proof foreground gateway: `viser gateway`",
        "   - Explicit live provider-proof foreground gateway: `viser gateway --strict --live --probe-all-providers`",
        "   - Unsafe raw foreground gateway for debugging only: `viser gateway --unsafe-skip-gate`",
        "   - Legacy service cleanup only: `viser service status` / `viser service uninstall`"
    ].join("\n");
}
function providerSteps(config, readiness, options) {
    const lines = [];
    const candidateIds = [...new Set([config.assistant.defaultProvider, ...config.assistant.fallbackProviders])];
    const candidateProviders = candidateIds
        .map((id) => config.providers[id])
        .filter((provider) => Boolean(provider));
    const providerProbeItems = readiness.filter((item) => item.area === "provider-probe");
    const runtimeItem = readiness.find((item) => item.area === "provider-runtime");
    const passingProbes = providerProbeItems.filter((item) => item.status === "pass");
    const failedProbes = providerProbeItems.filter((item) => item.status !== "pass");
    const providerConfigFailures = readiness.filter((item) => item.area === "provider" && item.status !== "pass");
    if (runtimeItem?.status === "pass") {
        lines.push(`- ✅ ${runtimeItem.message}`);
    }
    else if (runtimeItem?.status === "fail") {
        lines.push(`- ❌ ${runtimeItem.message}`);
        if (runtimeItem.next)
            lines.push(`- next: ${runtimeItem.next}`);
    }
    else if (passingProbes.length > 0) {
        lines.push(`- ✅ provider probe passed: ${passingProbes.map((item) => item.message.split(":")[0]).join(", ")}`);
    }
    else if (!options.probeProviders && !options.probeAllProviders) {
        lines.push("- runtime not proven yet: run `viser verify --live --probe-all-providers`.");
    }
    for (const item of failedProbes) {
        const providerId = item.message.split(":")[0];
        lines.push(`- fix ${providerId}: ${providerProbeAdvice(config.providers[providerId], item)}`);
    }
    for (const item of providerConfigFailures) {
        lines.push(`- ${item.status === "fail" ? "fix" : "optional"} ${item.message}${item.next ? `: ${item.next}` : ""}`);
    }
    if (candidateProviders.length > 0) {
        lines.push("- manual smoke tests in a normal terminal:");
        for (const provider of candidateProviders) {
            if (!commandExists(provider.command, { cwd: provider.cwd, pathValue: provider.env?.PATH })) {
                lines.push(`  - ${provider.id}: install/login first. ${provider.loginHint ?? ""}`.trimEnd());
                continue;
            }
            lines.push(`  - ${provider.id}: ${providerSmokeCommand(provider)}`);
        }
    }
    lines.push("- provider guide: `viser provider-guide --probe`");
    return lines;
}
function providerProbeAdvice(provider, item) {
    const text = `${item.message}\n${item.next ?? ""}`;
    return providerIssueAdvice(provider, text).join("; ");
}
function toolsSteps(readiness) {
    const lines = [];
    const skills = readiness.filter((item) => item.area === "skills");
    const plugins = readiness.filter((item) => item.area === "plugins");
    const tools = readiness.filter((item) => item.area === "tools");
    const actionableSkills = skills.filter((item) => item.status !== "pass");
    const actionablePlugins = plugins.filter((item) => item.status !== "pass");
    const actionable = tools.filter((item) => item.status !== "pass");
    if (actionableSkills.length === 0) {
        const passingSkills = skills.find((item) => item.status === "pass");
        if (passingSkills)
            lines.push(`- ✅ ${passingSkills.message}`);
    }
    else {
        for (const item of actionableSkills) {
            lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
        }
        lines.push("- install starter skills with `viser setup`, then rerun `viser readiness`.");
    }
    if (actionablePlugins.length === 0) {
        const passingPlugins = plugins.find((item) => item.status === "pass");
        if (passingPlugins)
            lines.push(`- ✅ ${passingPlugins.message}`);
    }
    else {
        for (const item of actionablePlugins) {
            lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
        }
        lines.push("- keep bundled plugins or add `plugin.json` folders, then rerun `viser readiness`.");
    }
    if (actionable.length === 0) {
        const passing = tools.find((item) => item.status === "pass");
        lines.push(`- ✅ ${passing?.message ?? "local tools ready"}`);
    }
    else {
        for (const item of actionable) {
            lines.push(`- ${item.status === "fail" ? "❌" : "⚠️"} ${item.message}${item.next ? ` — ${item.next}` : ""}`);
        }
        lines.push("- edit `tools.shell.allowedCommands` or fix PATH, then rerun `viser readiness`.");
    }
    lines.push("- inspect available local tools with `viser tools`.");
    lines.push("- inspect local plugins with `viser plugins`.");
    lines.push("- run local smoke coverage with `viser smoke`.");
    return lines;
}
function messengerSteps(config, readiness) {
    const lines = [];
    const telegram = readiness.find((item) => item.area === "telegram");
    const discord = readiness.find((item) => item.area === "discord");
    const slack = readiness.find((item) => item.area === "slack");
    const matrix = readiness.find((item) => item.area === "matrix");
    const signal = readiness.find((item) => item.area === "signal");
    const imessage = readiness.find((item) => item.area === "imessage");
    const whatsapp = readiness.find((item) => item.area === "whatsapp");
    const line = readiness.find((item) => item.area === "line");
    const kakaotalk = readiness.find((item) => item.area === "kakaotalk");
    const googleChat = readiness.find((item) => item.area === "google-chat");
    const genericWebhook = readiness.find((item) => item.area === "webhook");
    const homeAssistant = readiness.find((item) => item.area === "home-assistant");
    const teams = readiness.find((item) => item.area === "teams");
    const mattermost = readiness.find((item) => item.area === "mattermost");
    const synologyChat = readiness.find((item) => item.area === "synology-chat");
    const rocketChat = readiness.find((item) => item.area === "rocket-chat");
    const feishu = readiness.find((item) => item.area === "feishu");
    const dingTalk = readiness.find((item) => item.area === "dingtalk");
    const weCom = readiness.find((item) => item.area === "wecom");
    const zalo = readiness.find((item) => item.area === "zalo");
    const irc = readiness.find((item) => item.area === "irc");
    const twitch = readiness.find((item) => item.area === "twitch");
    const ntfy = readiness.find((item) => item.area === "ntfy");
    const mastodon = readiness.find((item) => item.area === "mastodon");
    const nextcloudTalk = readiness.find((item) => item.area === "nextcloud-talk");
    const webex = readiness.find((item) => item.area === "webex");
    const zulip = readiness.find((item) => item.area === "zulip");
    const email = readiness.find((item) => item.area === "email");
    const github = readiness.find((item) => item.area === "github");
    const todoist = readiness.find((item) => item.area === "todoist");
    const notion = readiness.find((item) => item.area === "notion");
    const obsidian = readiness.find((item) => item.area === "obsidian");
    const liveChecks = readiness.filter((item) => item.area === "live");
    const liveIssues = liveChecks.filter((item) => item.status !== "pass");
    const livePasses = liveChecks.filter((item) => item.status === "pass");
    const liveAccepted = livePasses.filter((item) => isAcceptedLiveToken(item.message));
    const liveDisabled = livePasses.filter((item) => isDisabledLiveToken(item.message));
    if (liveChecks.length > 0) {
        if (liveIssues.length === 0 && liveAccepted.length === liveChecks.length) {
            lines.push("- ✅ live Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian credential validation accepted configured transports.");
        }
        else if (liveAccepted.length > 0) {
            lines.push(`- ✅ live token accepted: ${liveAccepted.map((item) => item.message.split(":")[0]).join(", ")}.`);
        }
        else if (liveIssues.length === 0 && liveDisabled.length > 0) {
            lines.push("- ℹ️ live Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian credential validation not configured; bridges are disabled or credentials are empty.");
        }
        for (const item of livePasses)
            lines.push(`- ${isDisabledLiveToken(item.message) ? "ℹ️" : "✅"} live token check ${item.message}`);
        for (const item of liveIssues)
            lines.push(`- ${statusIcon(item.status)} live token check ${item.message}${item.next ? ` — ${item.next}` : ""}`);
        lines.push("- after changing tokens, rerun `viser next-steps --live --probe-all-providers` or `viser launch-status`.");
    }
    else if (telegram?.status === "pass" && discord?.status === "pass" && slack?.status === "pass" && matrix?.status === "pass" && signal?.status === "pass" && imessage?.status === "pass" && whatsapp?.status === "pass" && line?.status === "pass" && kakaotalk?.status === "pass" && googleChat?.status === "pass" && genericWebhook?.status === "pass" && homeAssistant?.status === "pass" && teams?.status === "pass" && mattermost?.status === "pass" && synologyChat?.status === "pass" && rocketChat?.status === "pass" && feishu?.status === "pass" && dingTalk?.status === "pass" && weCom?.status === "pass" && zalo?.status === "pass" && irc?.status === "pass" && twitch?.status === "pass" && ntfy?.status === "pass" && mastodon?.status === "pass" && nextcloudTalk?.status === "pass" && webex?.status === "pass" && zulip?.status === "pass" && email?.status === "pass" && github?.status === "pass" && todoist?.status === "pass" && notion?.status === "pass" && obsidian?.status === "pass") {
        lines.push("- ✅ Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion/Obsidian credential checks passed or bridges are disabled intentionally.");
    }
    else {
        if (telegram?.status !== "pass")
            lines.push(`- Telegram: set ${config.connectors.telegram.botTokenEnv} if you want Telegram messaging.`);
        if (discord?.status !== "pass")
            lines.push(`- Discord: set ${config.connectors.discord.botTokenEnv} if you want Discord messaging.`);
        if (slack?.status !== "pass")
            lines.push(`- Slack: set ${config.connectors.slack.botTokenEnv} and ${config.connectors.slack.appTokenEnv} if you want Slack messaging.`);
        if (matrix?.status !== "pass")
            lines.push(`- Matrix: set ${config.connectors.matrix.homeserverUrlEnv} and ${config.connectors.matrix.accessTokenEnv} if you want Matrix messaging.`);
        if (signal?.status !== "pass")
            lines.push(`- Signal: set ${config.connectors.signal.accountEnv} and optionally ${config.connectors.signal.commandEnv} if you want Signal messaging through local signal-cli.`);
        if (imessage?.status !== "pass")
            lines.push(`- iMessage: keep ${config.connectors.imessage.sqliteCommandEnv}, ${config.connectors.imessage.osascriptCommandEnv}, and ${config.connectors.imessage.chatDbPathEnv} valid if you want local macOS Messages bridging.`);
        if (whatsapp?.status !== "pass")
            lines.push(`- WhatsApp: set ${config.connectors.whatsapp.accessTokenEnv}, ${config.connectors.whatsapp.phoneNumberIdEnv}, and ${config.connectors.whatsapp.verifyTokenEnv} if you want WhatsApp Cloud API messaging.`);
        if (line?.status !== "pass")
            lines.push(`- LINE: set ${config.connectors.line.channelAccessTokenEnv} and ${config.connectors.line.channelSecretEnv} if you want LINE Messaging API webhooks and push replies.`);
        if (kakaotalk?.status !== "pass")
            lines.push(`- KakaoTalk: set ${config.connectors.kakaotalk.requestTokenEnv} if you want Kakao i Open Builder Skill webhooks.`);
        if (googleChat?.status !== "pass")
            lines.push(`- Google Chat: set ${config.connectors.googleChat.webhookUrlEnv} or ${config.connectors.googleChat.webhookUrlsEnv} if you want outbound Google Chat messages.`);
        if (genericWebhook?.status !== "pass")
            lines.push(`- Generic webhook: set ${config.connectors.webhook.webhookUrlEnv} or ${config.connectors.webhook.webhookUrlsEnv} if you want outbound custom HTTPS webhook messages.`);
        if (homeAssistant?.status !== "pass")
            lines.push(`- Home Assistant: set ${config.connectors.homeAssistant.baseUrlEnv}, ${config.connectors.homeAssistant.accessTokenEnv}, and ${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv} if you want approval-gated smart-home service calls.`);
        if (teams?.status !== "pass")
            lines.push(`- Microsoft Teams: set ${config.connectors.teams.webhookUrlEnv} or ${config.connectors.teams.webhookUrlsEnv} if you want outbound Teams messages.`);
        if (mattermost?.status !== "pass")
            lines.push(`- Mattermost: set ${config.connectors.mattermost.webhookUrlEnv} or ${config.connectors.mattermost.webhookUrlsEnv} if you want outbound Mattermost messages.`);
        if (synologyChat?.status !== "pass")
            lines.push(`- Synology Chat: set ${config.connectors.synologyChat.webhookUrlEnv} or ${config.connectors.synologyChat.webhookUrlsEnv} if you want outbound Synology Chat messages.`);
        if (rocketChat?.status !== "pass")
            lines.push(`- Rocket.Chat: set ${config.connectors.rocketChat.webhookUrlEnv} or ${config.connectors.rocketChat.webhookUrlsEnv} if you want outbound Rocket.Chat messages.`);
        if (feishu?.status !== "pass")
            lines.push(`- Feishu: set ${config.connectors.feishu.webhookUrlEnv} or ${config.connectors.feishu.webhookUrlsEnv} if you want outbound Feishu/Lark messages.`);
        if (dingTalk?.status !== "pass")
            lines.push(`- DingTalk: set ${config.connectors.dingtalk.webhookUrlEnv} or ${config.connectors.dingtalk.webhookUrlsEnv} if you want outbound DingTalk robot messages.`);
        if (weCom?.status !== "pass")
            lines.push(`- WeCom: set ${config.connectors.wecom.webhookUrlEnv} or ${config.connectors.wecom.webhookUrlsEnv} if you want outbound WeCom group robot messages.`);
        if (zalo?.status !== "pass")
            lines.push(`- Zalo: set ${config.connectors.zalo.accessTokenEnv} and ${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv} if you want outbound Zalo OA messages.`);
        if (irc?.status !== "pass")
            lines.push(`- IRC: set ${config.connectors.irc.hostEnv}, ${config.connectors.irc.nickEnv}, and ${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv} if you want outbound IRC channel messages.`);
        if (twitch?.status !== "pass")
            lines.push(`- Twitch: set ${config.connectors.twitch.accessTokenEnv}, ${config.connectors.twitch.botUsernameEnv}, and ${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv} if you want outbound Twitch chat messages.`);
        if (ntfy?.status !== "pass")
            lines.push(`- ntfy: set ${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv} and optionally ${config.connectors.ntfy.baseUrlEnv}/${config.connectors.ntfy.tokenEnv} if you want outbound push notifications.`);
        if (mastodon?.status !== "pass")
            lines.push(`- Mastodon: set ${config.connectors.mastodon.baseUrlEnv}, ${config.connectors.mastodon.accessTokenEnv}, and optionally ${config.connectors.mastodon.visibilityEnv}/${config.connectors.mastodon.targetsEnv} if you want outbound Fediverse status posts.`);
        if (nextcloudTalk?.status !== "pass")
            lines.push(`- Nextcloud Talk: set ${config.connectors.nextcloudTalk.baseUrlEnv}, ${config.connectors.nextcloudTalk.usernameEnv}, ${config.connectors.nextcloudTalk.appPasswordEnv}, and ${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv} if you want outbound Talk messages.`);
        if (webex?.status !== "pass")
            lines.push(`- Webex: set ${config.connectors.webex.accessTokenEnv} if you want outbound Webex Messages API messages.`);
        if (zulip?.status !== "pass")
            lines.push(`- Zulip: set ${config.connectors.zulip.siteUrlEnv}, ${config.connectors.zulip.botEmailEnv}, ${config.connectors.zulip.apiKeyEnv}, and ${config.connectors.zulip.targetEnv}/${config.connectors.zulip.targetsEnv} if you want outbound Zulip messages.`);
        if (email?.status !== "pass")
            lines.push(`- Email: set ${config.connectors.email.sendmailCommandEnv}, ${config.connectors.email.fromEnv}, and ${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv} if you want outbound local sendmail messages.`);
        if (github?.status !== "pass")
            lines.push(`- GitHub: set ${config.connectors.github.tokenEnv} and ${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv} if you want outbound issue/PR comments.`);
        if (todoist?.status !== "pass")
            lines.push(`- Todoist: set ${config.connectors.todoist.tokenEnv} and optionally ${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv} if you want outbound Todoist task creation.`);
        if (notion?.status !== "pass")
            lines.push(`- Notion: set ${config.connectors.notion.tokenEnv} and ${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv} if you want outbound Notion page appends.`);
        if (obsidian?.status !== "pass")
            lines.push(`- Obsidian: set ${config.connectors.obsidian.vaultDirEnv} and ${config.connectors.obsidian.noteEnv}/${config.connectors.obsidian.notesEnv} if you want outbound local Markdown note appends.`);
    }
    lines.push("- .env example:");
    lines.push(`  - ${config.connectors.telegram.botTokenEnv}=...`);
    lines.push(`  - ${config.connectors.discord.botTokenEnv}=...`);
    lines.push(`  - ${config.connectors.slack.botTokenEnv}=...`);
    lines.push(`  - ${config.connectors.slack.appTokenEnv}=...`);
    lines.push(`  - ${config.connectors.slack.botUserIdEnv}=...`);
    lines.push(`  - ${config.connectors.matrix.homeserverUrlEnv}=https://matrix.example.org`);
    lines.push(`  - ${config.connectors.matrix.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.matrix.userIdEnv}=@viser:example.org`);
    lines.push(`  - ${config.connectors.signal.accountEnv}=+15551234567`);
    lines.push(`  - ${config.connectors.signal.commandEnv}=signal-cli`);
    lines.push(`  - ${config.connectors.imessage.sqliteCommandEnv}=sqlite3`);
    lines.push(`  - ${config.connectors.imessage.osascriptCommandEnv}=osascript`);
    lines.push(`  - ${config.connectors.imessage.chatDbPathEnv}=~/Library/Messages/chat.db`);
    lines.push(`  - ${config.connectors.whatsapp.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.whatsapp.phoneNumberIdEnv}=...`);
    lines.push(`  - ${config.connectors.whatsapp.verifyTokenEnv}=...`);
    lines.push(`  - ${config.connectors.whatsapp.graphApiVersionEnv}=${config.connectors.whatsapp.graphApiVersion}`);
    lines.push(`  - ${config.connectors.line.channelAccessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.line.channelSecretEnv}=...`);
    lines.push(`  - ${config.connectors.kakaotalk.requestTokenEnv}=...`);
    lines.push(`  - ${config.connectors.googleChat.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.googleChat.webhookUrlsEnv}=ops=https://chat.googleapis.com/...`);
    lines.push(`  - ${config.connectors.webhook.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.webhook.webhookUrlsEnv}=ops=https://hooks.example.com/viser/...`);
    lines.push(`  - ${config.connectors.homeAssistant.baseUrlEnv}=https://homeassistant.example.com`);
    lines.push(`  - ${config.connectors.homeAssistant.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.homeAssistant.serviceEnv}=notify.persistent_notification`);
    lines.push(`  - ${config.connectors.homeAssistant.servicesEnv}=lights=light.turn_on`);
    lines.push(`  - ${config.connectors.teams.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.teams.webhookUrlsEnv}=ops=https://...`);
    lines.push(`  - ${config.connectors.mattermost.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.mattermost.webhookUrlsEnv}=ops=https://mattermost.example.com/hooks/...`);
    lines.push(`  - ${config.connectors.synologyChat.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.synologyChat.webhookUrlsEnv}=ops=https://chat.example.com/webapi/entry.cgi?api=SYNO.Chat.External&method=incoming&version=2&token=...`);
    lines.push(`  - ${config.connectors.rocketChat.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.rocketChat.webhookUrlsEnv}=ops=https://rocket.example.com/hooks/.../...`);
    lines.push(`  - ${config.connectors.feishu.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.feishu.webhookUrlsEnv}=ops=https://open.feishu.cn/open-apis/bot/v2/hook/...`);
    lines.push(`  - ${config.connectors.dingtalk.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.dingtalk.webhookUrlsEnv}=ops=https://oapi.dingtalk.com/robot/send?access_token=...`);
    lines.push(`  - ${config.connectors.wecom.webhookUrlEnv}=...`);
    lines.push(`  - ${config.connectors.wecom.webhookUrlsEnv}=ops=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`);
    lines.push(`  - ${config.connectors.zalo.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.zalo.recipientEnv}=zalo-user-id`);
    lines.push(`  - ${config.connectors.zalo.recipientsEnv}=ops=zalo-user-id`);
    lines.push(`  - ${config.connectors.irc.hostEnv}=irc.libera.chat`);
    lines.push(`  - ${config.connectors.irc.portEnv}=6697`);
    lines.push(`  - ${config.connectors.irc.tlsEnv}=true`);
    lines.push(`  - ${config.connectors.irc.nickEnv}=ViserBot`);
    lines.push(`  - ${config.connectors.irc.passwordEnv}=...`);
    lines.push(`  - ${config.connectors.irc.channelEnv}=#viser`);
    lines.push(`  - ${config.connectors.irc.channelsEnv}=ops=#viser-ops`);
    lines.push(`  - ${config.connectors.twitch.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.twitch.botUsernameEnv}=viserbot`);
    lines.push(`  - ${config.connectors.twitch.channelEnv}=viserchannel`);
    lines.push(`  - ${config.connectors.twitch.channelsEnv}=ops=viserchannel`);
    lines.push(`  - ${config.connectors.ntfy.baseUrlEnv}=https://ntfy.sh`);
    lines.push(`  - ${config.connectors.ntfy.tokenEnv}=`);
    lines.push(`  - ${config.connectors.ntfy.topicEnv}=viser-alerts`);
    lines.push(`  - ${config.connectors.ntfy.topicsEnv}=ops=viser-ops-alerts`);
    lines.push(`  - ${config.connectors.mastodon.baseUrlEnv}=https://mastodon.example`);
    lines.push(`  - ${config.connectors.mastodon.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.mastodon.visibilityEnv}=private`);
    lines.push(`  - ${config.connectors.mastodon.targetsEnv}=ops=unlisted`);
    lines.push(`  - ${config.connectors.nextcloudTalk.baseUrlEnv}=https://nextcloud.example.com`);
    lines.push(`  - ${config.connectors.nextcloudTalk.usernameEnv}=viser-bot`);
    lines.push(`  - ${config.connectors.nextcloudTalk.appPasswordEnv}=...`);
    lines.push(`  - ${config.connectors.nextcloudTalk.roomTokenEnv}=roomtoken`);
    lines.push(`  - ${config.connectors.nextcloudTalk.roomsEnv}=ops=roomtoken`);
    lines.push(`  - ${config.connectors.webex.accessTokenEnv}=...`);
    lines.push(`  - ${config.connectors.zulip.siteUrlEnv}=https://your-org.zulipchat.com`);
    lines.push(`  - ${config.connectors.zulip.botEmailEnv}=viser-bot@example.com`);
    lines.push(`  - ${config.connectors.zulip.apiKeyEnv}=...`);
    lines.push(`  - ${config.connectors.zulip.targetEnv}=stream:operations:alerts`);
    lines.push(`  - ${config.connectors.zulip.targetsEnv}=ops=stream:operations:alerts`);
    lines.push(`  - ${config.connectors.email.sendmailCommandEnv}=sendmail`);
    lines.push(`  - ${config.connectors.email.fromEnv}=viser@example.com`);
    lines.push(`  - ${config.connectors.email.recipientEnv}=operator@example.com`);
    lines.push(`  - ${config.connectors.email.recipientsEnv}=ops=operator@example.com`);
    lines.push(`  - ${config.connectors.github.tokenEnv}=...`);
    lines.push(`  - ${config.connectors.github.targetEnv}=owner/repo#123`);
    lines.push(`  - ${config.connectors.github.targetsEnv}=release=owner/repo#123`);
    lines.push(`  - ${config.connectors.todoist.tokenEnv}=...`);
    lines.push(`  - ${config.connectors.todoist.projectEnv}=6Jf8VQXxpwv56VQ7`);
    lines.push(`  - ${config.connectors.todoist.projectsEnv}=ops=6Jf8VQXxpwv56VQ7`);
    lines.push(`  - ${config.connectors.notion.tokenEnv}=...`);
    lines.push(`  - ${config.connectors.notion.pageEnv}=00000000-0000-0000-0000-000000000000`);
    lines.push(`  - ${config.connectors.notion.pagesEnv}=ops=00000000-0000-0000-0000-000000000000`);
    lines.push(`  - ${config.connectors.obsidian.vaultDirEnv}=~/Documents/ObsidianVault`);
    lines.push(`  - ${config.connectors.obsidian.noteEnv}=Viser.md`);
    lines.push(`  - ${config.connectors.obsidian.notesEnv}=ops=Operations/Viser.md`);
    lines.push("- after enabling a bridge, authorize chats/channels/service aliases with `viser pair-code telegram|discord|slack|matrix|signal|imessage|whatsapp|line|kakaotalk|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian [label]`.");
    lines.push("- use `viser gateway --dry-run --strict --live --probe-all-providers` before starting `viser` in a foreground terminal.");
    return lines;
}
function isAcceptedLiveToken(message) {
    return /^(?:telegram|discord|slack|matrix|signal|imessage|whatsapp|line|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian): (?:bot\b|user\b|token accepted\b|account\b|phone number ID accepted\b|webhook URL configured\b|access token and recipient configured\b|local signal-cli configured\b|local macOS Messages commands configured\b|host, nick, and channel configured|OAuth token, bot username, and channel configured|base URL and public topic configured|base URL, token, and topic configured|base URL, user, app password, and room configured|Home Assistant API accepted token\b|local sendmail command and envelope are configured\b|token and issue target configured\b|token configured for inbox target\b|token and project target configured\b|token and page target configured\b|vault and note target configured\b)/iu.test(message);
}
function isDisabledLiveToken(message) {
    return /^(?:telegram|discord|slack|matrix|signal|imessage|whatsapp|line|google-chat|webhook|home-assistant|teams|mattermost|synology-chat|rocket-chat|feishu|dingtalk|wecom|zalo|irc|twitch|ntfy|mastodon|nextcloud-talk|webex|zulip|email|github|todoist|notion|obsidian): disabled \(no token configured\)$/iu.test(message);
}
function statusIcon(status) {
    return status === "fail" ? "❌" : status === "warn" ? "⚠️" : "✅";
}
function safetySteps(audit) {
    const lines = [];
    const blockers = audit.filter((item) => item.severity === "fail");
    const warnings = audit.filter((item) => item.severity === "warn");
    if (blockers.length === 0 && warnings.length === 0) {
        lines.push("- ✅ audit is safe.");
    }
    else {
        for (const item of blockers)
            lines.push(`- fix audit blocker [${item.area}]: ${item.message}${item.next ? ` — ${item.next}` : ""}`);
        for (const item of warnings)
            lines.push(`- review audit warning [${item.area}]: ${item.message}${item.next ? ` — ${item.next}` : ""}`);
    }
    lines.push("- backup state/config with `viser backup`.");
    lines.push("- validate editable config with `viser config-check`.");
    lines.push("- validate persistent state with `viser state-check`; preview repair with `viser state-check --repair`.");
    lines.push("- prove local non-provider features with `viser smoke`.");
    lines.push("- keep writes approval-gated: use `/propose`, inspect `/approvals`, then `/approve <id>`.");
    lines.push("- store durable preferences with `/remember ... #tag`.");
    return lines;
}
