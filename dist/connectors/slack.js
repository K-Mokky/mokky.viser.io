// ================================================================
// Slack bridge
// ================================================================
// Slack is a first-class transport surface. Socket Mode is used for foreground
// inbound events so Viser does not need to expose a public webhook while the
// model answer still comes from the local CLI-backed AssistantRuntime.
import { chunkText } from "../utils/text.js";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { pairedMessage, pairingRequiredMessage } from "./telegram.js";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.js";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.js";
const SLACK_API_BASE = "https://slack.com/api";
const SLACK_RECONNECT_DELAY_MS = 5000;
export async function runSlackBridge(config, assistant, access) {
    const botToken = config.botToken;
    if (!botToken)
        throw new Error(`Slack bot token is missing. Set ${config.botTokenEnv}.`);
    const appToken = config.appToken;
    if (!appToken)
        throw new Error(`Slack app-level token is missing. Set ${config.appTokenEnv} for Socket Mode.`);
    if (typeof WebSocket !== "function")
        throw new Error("This Node runtime does not provide WebSocket.");
    const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
    let stopped = false;
    process.once("SIGINT", () => {
        stopped = true;
    });
    process.once("SIGTERM", () => {
        stopped = true;
    });
    console.log("Slack bridge is running in Socket Mode. Press Ctrl+C to stop.");
    while (!stopped) {
        try {
            await connectSlackSocket(appToken, botToken, config, assistant, () => stopped, access, rateLimiter);
        }
        catch (error) {
            if (stopped)
                break;
            console.error(error instanceof Error ? error.message : error);
            await new Promise((resolve) => setTimeout(resolve, SLACK_RECONNECT_DELAY_MS));
        }
    }
}
async function connectSlackSocket(appToken, botToken, config, assistant, shouldStop, access, rateLimiter) {
    const url = await openSlackSocket(appToken);
    await new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        const ack = (envelopeId) => {
            if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ envelope_id: envelopeId }));
        };
        socket.addEventListener("message", (event) => {
            void (async () => {
                const envelope = JSON.parse(String(event.data));
                if (envelope.envelope_id)
                    ack(envelope.envelope_id);
                if (envelope.type !== "events_api" || envelope.payload?.type !== "event_callback" || !envelope.payload.event)
                    return;
                await handleSlackEvent(botToken, config, assistant, envelope.payload.event, access, rateLimiter);
            })().catch((error) => {
                reject(error instanceof Error ? error : new Error(String(error)));
                try {
                    socket.close();
                }
                catch {
                    // The rejection above carries the failure.
                }
            });
        });
        socket.addEventListener("error", () => reject(new Error("Slack socket error.")));
        socket.addEventListener("close", () => {
            if (shouldStop())
                resolve();
            else
                reject(new Error("Slack socket closed; reconnecting."));
        });
    });
}
async function openSlackSocket(appToken, options = {}) {
    const response = await slackApiCall(appToken, "apps.connections.open", {}, options);
    if (!response.url)
        throw new Error("Slack Socket Mode did not return a websocket URL.");
    return response.url;
}
export async function handleSlackEvent(token, config, assistant, event, access, rateLimiter) {
    if (event.type !== "message" || !event.text || !event.channel || event.bot_id || event.subtype)
        return;
    const staticAllowlist = [...config.allowedChannelIds, ...config.defaultChannelIds];
    if (config.allowedChannelIds.length > 0 && !staticAllowlist.includes(event.channel))
        return;
    const normalized = normalizeSlackInput(event.text, config.prefix, config.botUserId, event.channel_type === "im");
    if (!normalized)
        return;
    if (access && !(await access.isAllowed("slack", event.channel, staticAllowlist))) {
        const label = event.user ? `slack-user:${event.user}` : `slack:${event.channel}`;
        const paired = await access.tryPairCommand(normalized, "slack", event.channel, label);
        await sendSlackMessage(token, event.channel, paired ? pairedMessage("slack") : pairingRequiredMessage("slack"));
        return;
    }
    if (connectorInputTooLong(normalized, config.maxInputChars)) {
        await sendSlackMessage(token, event.channel, connectorInputLimitMessage(config.maxInputChars));
        return;
    }
    const rate = rateLimiter?.check(`slack:${event.channel}`);
    if (rate && !rate.allowed) {
        await sendSlackMessage(token, event.channel, connectorRateLimitMessage(rate.retryAfterMs));
        return;
    }
    try {
        const answer = await assistant.handle(normalized, `slack:${event.channel}`, { source: "slack" });
        await sendSlackMessage(token, event.channel, answer);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await sendSlackMessage(token, event.channel, `Viser error:\n${detail}`);
    }
}
export function normalizeSlackInput(content, prefix, botUserId, isDirectMessage) {
    const trimmed = content.trim();
    const mention = botUserId ? `<@${botUserId}>` : undefined;
    if (!trimmed)
        return undefined;
    if (isDirectMessage)
        return trimmed;
    if (trimmed.startsWith(prefix))
        return trimmed.slice(prefix.length).trim() || "/help";
    if (mention && trimmed.startsWith(mention))
        return trimmed.slice(mention.length).trim() || "/help";
    return undefined;
}
export async function sendSlackMessage(token, channelId, text, options = {}) {
    for (const chunk of chunkText(text, 3900)) {
        await slackApiCall(token, "chat.postMessage", { channel: channelId, text: chunk }, options);
    }
}
export async function slackApiCall(token, method, payload, options = {}) {
    try {
        const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `${SLACK_API_BASE}/${method}`, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify(payload)
        }, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const body = (await response.json().catch(() => ({})));
        if (!response.ok || !body.ok) {
            throw new Error(`Slack ${method} failed: ${body.error ?? response.statusText}`);
        }
        return body;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactToken(message, token));
    }
}
function redactToken(detail, token) {
    return detail.split(token).join("[REDACTED]");
}
