// ================================================================
// Feishu/Lark custom bot webhook sender
// ================================================================
// Feishu custom bots receive text payloads through a secret webhook URL.
// Viser keeps the raw URL out of actions/schedules by resolving a local alias
// at the final approved send boundary.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const FEISHU_CHUNK_SIZE = 3900;
export async function sendFeishuMessage(config, webhookId, text, options = {}) {
    const url = resolveFeishuWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, FEISHU_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ msg_type: "text", content: { text: chunk } })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactFeishuDetail(`Feishu send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveFeishuWebhookUrl(config, webhookId) {
    const id = normalizeWebhookId(webhookId);
    if (!id)
        throw new Error("Feishu webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`Feishu webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeFeishuWebhookUrl(mapped);
}
export function normalizeFeishuWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("Feishu webhook URL must be an https://open.feishu.cn or https://open.larksuite.com bot hook URL.");
    }
    const allowedHosts = new Set(["open.feishu.cn", "open.larksuite.com", "open.larkoffice.com"]);
    if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
        throw new Error("Feishu webhook URL must use an approved Feishu/Lark https host.");
    }
    if (!url.pathname.startsWith("/open-apis/bot/v2/hook/")) {
        throw new Error("Feishu webhook URL must use /open-apis/bot/v2/hook/.");
    }
    return url.toString();
}
export function parseFeishuWebhookUrlMap(value) {
    return parseWebhookUrlMap(value);
}
function redactFeishuDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
