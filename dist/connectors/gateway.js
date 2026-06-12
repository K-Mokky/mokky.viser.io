// ================================================================
// Multi-channel gateway
// ================================================================
// Runs enabled messaging bridges and the scheduler from one foreground process.
// This is a small always-on control-plane step toward OpenClaw/Hermes-style
// gateways.
import { AccessStore } from "../core/access.js";
import { JobRunner } from "../core/jobs.js";
import { SchedulerRunner } from "../core/scheduler.js";
import { runDiscordBridge } from "./discord.js";
import { runImessageBridge } from "./imessage.js";
import { runKakaotalkBridge } from "./kakaotalk.js";
import { runLineBridge } from "./line.js";
import { runMatrixBridge } from "./matrix.js";
import { runSignalBridge } from "./signal.js";
import { createConnectorNotifier } from "./notifier.js";
import { runSlackBridge } from "./slack.js";
import { runTelegramBridge } from "./telegram.js";
import { runWhatsappBridge } from "./whatsapp.js";
import { startWebDashboard } from "./web-dashboard.js";
export async function runGateway(config, assistant) {
    const tasks = [];
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
            sessionId: "gateway:web-dashboard",
            canvasDir: config.webDashboard.canvasDir,
            authToken: config.webDashboard.authToken,
            genericWebhook: config.connectors.webhook
        });
        console.log(`Viser web dashboard is running. url=${handle.url} mode=read-only`);
        tasks.push(new Promise((resolve, reject) => {
            handle.server.once("close", () => resolve());
            handle.server.once("error", (error) => reject(error));
        }));
    }
    if (config.connectors.telegram.enabled || config.connectors.telegram.botToken) {
        if (config.connectors.telegram.botToken)
            tasks.push(runTelegramBridge(config.connectors.telegram, assistant, access));
        else
            console.warn(`Telegram is enabled but ${config.connectors.telegram.botTokenEnv} is missing; skipping.`);
    }
    if (config.connectors.discord.enabled || config.connectors.discord.botToken) {
        if (config.connectors.discord.botToken)
            tasks.push(runDiscordBridge(config.connectors.discord, assistant, access));
        else
            console.warn(`Discord is enabled but ${config.connectors.discord.botTokenEnv} is missing; skipping.`);
    }
    if (config.connectors.slack.enabled || config.connectors.slack.botToken) {
        if (config.connectors.slack.botToken && config.connectors.slack.appToken) {
            tasks.push(runSlackBridge(config.connectors.slack, assistant, access));
        }
        else if (!config.connectors.slack.botToken) {
            console.warn(`Slack is enabled but ${config.connectors.slack.botTokenEnv} is missing; skipping.`);
        }
        else {
            console.warn(`Slack bot token is present but ${config.connectors.slack.appTokenEnv} is missing; inbound Socket Mode is disabled.`);
        }
    }
    if (config.connectors.matrix.enabled || config.connectors.matrix.accessToken) {
        if (config.connectors.matrix.accessToken && config.connectors.matrix.homeserverUrl) {
            tasks.push(runMatrixBridge(config.connectors.matrix, assistant, access));
        }
        else if (!config.connectors.matrix.accessToken) {
            console.warn(`Matrix is enabled but ${config.connectors.matrix.accessTokenEnv} is missing; skipping.`);
        }
        else {
            console.warn(`Matrix access token is present but ${config.connectors.matrix.homeserverUrlEnv} is missing; skipping.`);
        }
    }
    if (config.connectors.signal.enabled || config.connectors.signal.account) {
        if (config.connectors.signal.account) {
            tasks.push(runSignalBridge(config.connectors.signal, assistant, access));
        }
        else {
            console.warn(`Signal is enabled but ${config.connectors.signal.accountEnv} is missing; skipping.`);
        }
    }
    if (config.connectors.imessage.enabled) {
        tasks.push(runImessageBridge(config.connectors.imessage, assistant, access));
    }
    if (config.connectors.whatsapp.enabled || config.connectors.whatsapp.accessToken) {
        if (config.connectors.whatsapp.accessToken && config.connectors.whatsapp.phoneNumberId && config.connectors.whatsapp.verifyToken) {
            tasks.push(runWhatsappBridge(config.connectors.whatsapp, assistant, access));
        }
        else if (!config.connectors.whatsapp.accessToken) {
            console.warn(`WhatsApp is enabled but ${config.connectors.whatsapp.accessTokenEnv} is missing; skipping.`);
        }
        else if (!config.connectors.whatsapp.phoneNumberId) {
            console.warn(`WhatsApp access token is present but ${config.connectors.whatsapp.phoneNumberIdEnv} is missing; skipping.`);
        }
        else {
            console.warn(`WhatsApp access token is present but ${config.connectors.whatsapp.verifyTokenEnv} is missing; inbound webhook verification is disabled.`);
        }
    }
    if (config.connectors.line.enabled || config.connectors.line.channelAccessToken) {
        if (config.connectors.line.channelAccessToken && config.connectors.line.channelSecret) {
            tasks.push(runLineBridge(config.connectors.line, assistant, access));
        }
        else if (!config.connectors.line.channelAccessToken) {
            console.warn(`LINE is enabled but ${config.connectors.line.channelAccessTokenEnv} is missing; skipping.`);
        }
        else {
            console.warn(`LINE channel access token is present but ${config.connectors.line.channelSecretEnv} is missing; inbound webhook signature verification is disabled.`);
        }
    }
    if (config.connectors.kakaotalk.enabled || config.connectors.kakaotalk.requestToken) {
        if (config.connectors.kakaotalk.requestToken) {
            tasks.push(runKakaotalkBridge(config.connectors.kakaotalk, assistant, access));
        }
        else {
            console.warn(`KakaoTalk is enabled but ${config.connectors.kakaotalk.requestTokenEnv} is missing; skipping.`);
        }
    }
    if (tasks.length === 0) {
        console.log("No gateway connectors, scheduler, job worker, or web dashboard are enabled. Set TELEGRAM_BOT_TOKEN/DISCORD_BOT_TOKEN/SLACK_BOT_TOKEN+SLACK_APP_TOKEN/MATRIX_ACCESS_TOKEN+MATRIX_HOMESERVER_URL/SIGNAL_CLI_ACCOUNT, enable iMessage, configure WhatsApp Cloud API, LINE Messaging API, KakaoTalk Open Builder Skill, Google Chat/generic Webhook/Teams/Mattermost/Rocket.Chat/Feishu/DingTalk/WeCom webhooks, Home Assistant REST service calls, Zalo OA API, IRC server, Webex Messages API, or Zulip Messages API, or enable scheduler/jobs/webDashboard in config.");
        return;
    }
    await Promise.all(tasks);
}
