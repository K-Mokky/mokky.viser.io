// ================================================================
// DingTalk custom robot webhook sender
// ================================================================
// DingTalk custom robots receive text payloads through a secret webhook URL.
// Viser keeps the raw URL out of actions/schedules by resolving a local alias
// at the final approved send boundary.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const DINGTALK_CHUNK_SIZE = 3900;
export async function sendDingTalkMessage(config, webhookId, text, options = {}) {
    const url = resolveDingTalkWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, DINGTALK_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ msgtype: "text", text: { content: chunk } })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok || webhookJsonFailed(bodyText)) {
            throw new Error(redactDingTalkDetail(`DingTalk send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveDingTalkWebhookUrl(config, webhookId) {
    const id = normalizeWebhookId(webhookId);
    if (!id)
        throw new Error("DingTalk webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`DingTalk webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeDingTalkWebhookUrl(mapped);
}
export function normalizeDingTalkWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("DingTalk webhook URL must be an https://oapi.dingtalk.com/robot/send URL.");
    }
    if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com") {
        throw new Error("DingTalk webhook URL must use https://oapi.dingtalk.com.");
    }
    if (url.pathname !== "/robot/send") {
        throw new Error("DingTalk webhook URL must use /robot/send.");
    }
    if (!url.searchParams.get("access_token")) {
        throw new Error("DingTalk webhook URL must include an access_token query parameter.");
    }
    return url.toString();
}
export function parseDingTalkWebhookUrlMap(value) {
    return parseWebhookUrlMap(value);
}
function webhookJsonFailed(bodyText) {
    if (!bodyText.trim())
        return false;
    try {
        const parsed = JSON.parse(bodyText);
        const code = typeof parsed.errcode === "number" ? parsed.errcode : parsed.code;
        return typeof code === "number" && code !== 0;
    }
    catch {
        return false;
    }
}
function redactDingTalkDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
