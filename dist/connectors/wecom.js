// ================================================================
// WeCom group robot webhook sender
// ================================================================
// WeCom group robots receive text payloads through a secret webhook URL.
// Viser keeps the raw URL out of actions/schedules by resolving a local alias
// at the final approved send boundary.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const WECOM_CHUNK_SIZE = 3900;
export async function sendWeComMessage(config, webhookId, text, options = {}) {
    const url = resolveWeComWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, WECOM_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ msgtype: "text", text: { content: chunk } })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok || webhookJsonFailed(bodyText)) {
            throw new Error(redactWeComDetail(`WeCom send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveWeComWebhookUrl(config, webhookId) {
    const id = normalizeWebhookId(webhookId);
    if (!id)
        throw new Error("WeCom webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`WeCom webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeWeComWebhookUrl(mapped);
}
export function normalizeWeComWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("WeCom webhook URL must be an https://qyapi.weixin.qq.com/cgi-bin/webhook/send URL.");
    }
    if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com") {
        throw new Error("WeCom webhook URL must use https://qyapi.weixin.qq.com.");
    }
    if (url.pathname !== "/cgi-bin/webhook/send") {
        throw new Error("WeCom webhook URL must use /cgi-bin/webhook/send.");
    }
    if (!url.searchParams.get("key")) {
        throw new Error("WeCom webhook URL must include a key query parameter.");
    }
    return url.toString();
}
export function parseWeComWebhookUrlMap(value) {
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
function redactWeComDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
