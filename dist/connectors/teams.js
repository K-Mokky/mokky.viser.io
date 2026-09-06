// ================================================================
// Microsoft Teams incoming webhook sender
// ================================================================
// Teams incoming webhooks are outbound notification endpoints scoped to a
// channel/workflow URL. Viser treats the URL as a secret and exposes only a
// local alias through approval-gated connector messages and scheduler delivery.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const TEAMS_CHUNK_SIZE = 3900;
export async function sendTeamsMessage(config, webhookId, text, options = {}) {
    const url = resolveTeamsWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, TEAMS_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(teamsAdaptiveCardPayload(chunk))
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactTeamsDetail(`Microsoft Teams send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveTeamsWebhookUrl(config, webhookId) {
    const id = normalizeWebhookId(webhookId);
    if (!id)
        throw new Error("Microsoft Teams webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`Microsoft Teams webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeTeamsWebhookUrl(mapped);
}
export function normalizeTeamsWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("Microsoft Teams webhook URL must be an https URL.");
    }
    if (url.protocol !== "https:")
        throw new Error("Microsoft Teams webhook URL must use https.");
    return url.toString();
}
export function parseTeamsWebhookUrlMap(value) {
    return parseWebhookUrlMap(value);
}
function teamsAdaptiveCardPayload(text) {
    return {
        type: "message",
        attachments: [
            {
                contentType: "application/vnd.microsoft.card.adaptive",
                contentUrl: null,
                content: {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    type: "AdaptiveCard",
                    version: "1.0",
                    body: [
                        {
                            type: "TextBlock",
                            text,
                            wrap: true
                        }
                    ]
                }
            }
        ]
    };
}
function redactTeamsDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
