// ================================================================
// Synology Chat incoming webhook sender
// ================================================================
// Synology Chat is a bundled OpenClaw channel surface. Viser supports it as an
// approval-gated outbound connector through local aliases only, so action and
// scheduler records never need to contain raw webhook tokens.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const SYNOLOGY_CHAT_CHUNK_SIZE = 3900;
export async function sendSynologyChatMessage(config, webhookId, text, options = {}) {
    const url = resolveSynologyChatWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, SYNOLOGY_CHAT_CHUNK_SIZE)) {
        const body = new URLSearchParams({ payload: JSON.stringify({ text: chunk }) });
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
            body
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok || synologyChatRejected(bodyText)) {
            throw new Error(redactSynologyChatDetail(`Synology Chat send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveSynologyChatWebhookUrl(config, webhookId) {
    const id = normalizeWebhookId(webhookId);
    if (!id)
        throw new Error("Synology Chat webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`Synology Chat webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeSynologyChatWebhookUrl(mapped);
}
export function normalizeSynologyChatWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("Synology Chat webhook URL must be a valid https URL.");
    }
    if (url.protocol !== "https:")
        throw new Error("Synology Chat webhook URL must use https.");
    if (!url.hostname)
        throw new Error("Synology Chat webhook URL must include a hostname.");
    if (url.username || url.password)
        throw new Error("Synology Chat webhook URL credentials are not allowed.");
    if (url.searchParams.get("api") !== "SYNO.Chat.External") {
        throw new Error("Synology Chat webhook URL must include api=SYNO.Chat.External.");
    }
    if (url.searchParams.get("method") !== "incoming") {
        throw new Error("Synology Chat webhook URL must include method=incoming.");
    }
    if (!url.searchParams.get("token")) {
        throw new Error("Synology Chat webhook URL must include the Synology-issued token query parameter.");
    }
    return url.toString();
}
export function parseSynologyChatWebhookUrlMap(value) {
    return parseWebhookUrlMap(value);
}
function synologyChatRejected(bodyText) {
    const trimmed = bodyText.trim();
    if (!trimmed)
        return false;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.success === false || Boolean(parsed.error);
    }
    catch {
        return false;
    }
}
function redactSynologyChatDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
