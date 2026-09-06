// ================================================================
// Generic HTTPS webhook outbound sender
// ================================================================
// This connector intentionally covers the long tail of self-hosted or custom
// channel/plugin bridges without adding platform-specific dependencies. Outbound
// sends still pass Viser's pairing/allowlist and approval gates; optional inbound
// callbacks require an explicit shared token and only pass bounded text plus
// attachment metadata/text to the assistant.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { connectorInputTooLong } from "./input-policy.js";
import { chunkText } from "../utils/text.js";
const GENERIC_WEBHOOK_CHUNK_SIZE = 3900;
const GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENTS = 5;
const GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENT_TEXT_CHARS = 2000;
const GENERIC_WEBHOOK_INBOUND_MAX_METADATA_CHARS = 160;
const GENERIC_WEBHOOK_INBOUND_MAX_URL_CHARS = 2048;
const GENERIC_WEBHOOK_INBOUND_ATTACHMENT_BODY_BYTES = 1200;
export async function sendGenericWebhookMessage(config, webhookId, text, options = {}) {
    const url = resolveGenericWebhookUrl(config, webhookId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, GENERIC_WEBHOOK_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, url, {
            method: "POST",
            headers: { "content-type": "application/json; charset=UTF-8" },
            body: JSON.stringify({
                source: "viser",
                text: chunk,
                sentAt: new Date().toISOString()
            })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactGenericWebhookDetail(`Generic webhook send failed: ${response.status} ${response.statusText} ${bodyText}`, config, webhookId, chunk));
        }
    }
}
export function resolveGenericWebhookUrl(config, webhookId) {
    const id = normalizeGenericWebhookId(webhookId);
    if (!id)
        throw new Error("Generic webhook id must be a short alias such as default or ops.");
    const mapped = config.webhookUrls[id] ?? (id === "default" ? config.webhookUrl : undefined);
    if (!mapped) {
        throw new Error(`Generic webhook id '${id}' is not configured. Set ${config.webhookUrlEnv} or ${config.webhookUrlsEnv}.`);
    }
    return normalizeGenericWebhookUrl(mapped);
}
export function normalizeGenericWebhookId(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 80)
        return undefined;
    if (/^[A-Za-z0-9._-]+$/u.test(trimmed))
        return trimmed.toLowerCase();
    return undefined;
}
export function parseGenericWebhookUrlMap(value) {
    const raw = value?.trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const output = {};
            for (const [key, url] of Object.entries(parsed)) {
                const id = normalizeGenericWebhookId(key);
                if (id && typeof url === "string" && url.trim())
                    output[id] = url.trim();
            }
            return output;
        }
    }
    catch {
        // Fall back to a shell-friendly alias=url list.
    }
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const id = normalizeGenericWebhookId(part.slice(0, separator));
        const url = part.slice(separator + 1).trim();
        if (id && url)
            output[id] = url;
    }
    return output;
}
export function normalizeGenericWebhookUrl(value) {
    const trimmed = value.trim();
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("Generic webhook URL must be a valid https:// URL.");
    }
    if (url.protocol !== "https:") {
        throw new Error("Generic webhook URL must use https://.");
    }
    if (!url.hostname) {
        throw new Error("Generic webhook URL must include a hostname.");
    }
    if (url.username || url.password) {
        throw new Error("Generic webhook URL credentials are not allowed; put secrets in the path or query token issued by the receiver.");
    }
    return url.toString();
}
export function hasGenericWebhook(config) {
    return Boolean(config.webhookUrl || Object.keys(config.webhookUrls).length > 0);
}
export function normalizeGenericWebhookInboundToken(value) {
    const token = value?.trim() ?? "";
    if (token.length < 24 || token.length > 512 || /[\s\r\n\x00-\x1f\x7f]/u.test(token)) {
        throw new Error("Generic inbound webhook token must be a single opaque token of at least 24 characters.");
    }
    return token;
}
export function normalizeGenericWebhookInboundPath(value) {
    const path = value?.trim() || "/webhook/viser";
    if (!path.startsWith("/") || path.length > 120 || /[?#\s\x00-\x1f\x7f]/u.test(path)) {
        throw new Error("Generic inbound webhook path must be a clean absolute path such as /webhook/viser.");
    }
    if (path === "/" || path.startsWith("/dashboard") || path.startsWith("/canvas") || path.startsWith("/chat")) {
        throw new Error("Generic inbound webhook path must not overlap dashboard, canvas, or chat routes.");
    }
    return path;
}
export function hasGenericInboundWebhook(config) {
    return Boolean(config.inboundEnabled && config.inboundToken);
}
export function genericWebhookInboundBodyLimitBytes(config) {
    const maxInputChars = Math.max(1, config.inboundMaxInputChars ?? 4000);
    return maxInputChars
        + GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENTS * (GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENT_TEXT_CHARS + GENERIC_WEBHOOK_INBOUND_ATTACHMENT_BODY_BYTES)
        + 4000;
}
export async function handleGenericWebhookInbound(config, payload, assistant) {
    const event = normalizeGenericWebhookInboundPayload(payload, config.inboundMaxInputChars ?? 4000);
    const prompt = composeGenericWebhookInboundPrompt(event.text, event.attachments);
    const reply = await assistant.handle(prompt, `webhook:${event.sourceId}`, {
        source: "webhook",
        providerId: event.providerId
    });
    return {
        sessionId: `webhook:${event.sourceId}`,
        sourceId: event.sourceId,
        attachmentCount: event.attachments.length,
        reply
    };
}
function normalizeGenericWebhookInboundPayload(payload, maxInputChars) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : undefined;
    if (!record)
        throw new Error("Generic inbound webhook payload must be a JSON object.");
    const attachments = normalizeInboundAttachments(record.attachments);
    const text = normalizeInboundText(record.text ?? record.message ?? record.body, maxInputChars, attachments.length === 0);
    const sourceId = normalizeGenericWebhookId(typeof record.source === "string" ? record.source : typeof record.sourceId === "string" ? record.sourceId : "default") ?? "default";
    const providerId = normalizeInboundProviderId(record.providerId);
    return { text, sourceId, providerId, attachments };
}
function normalizeInboundText(value, maxInputChars, required) {
    const text = typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
    if (!text) {
        if (required)
            throw new Error("Generic inbound webhook text is required unless attachments are supplied.");
        return "Review the inbound webhook attachment context.";
    }
    if (connectorInputTooLong(text, maxInputChars))
        throw new Error(`Generic inbound webhook text must be ${maxInputChars} characters or fewer.`);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text))
        throw new Error("Generic inbound webhook text contains control characters.");
    return text;
}
function normalizeInboundProviderId(value) {
    const providerId = typeof value === "string" ? value.trim() : "";
    if (!providerId)
        return undefined;
    if (!/^[a-z0-9._-]{1,80}$/iu.test(providerId))
        throw new Error("providerId must be a safe provider id.");
    return providerId;
}
function normalizeInboundAttachments(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        throw new Error("Generic inbound webhook attachments must be an array when present.");
    if (value.length > GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENTS) {
        throw new Error(`Generic inbound webhook accepts at most ${GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENTS} attachments.`);
    }
    return value.map((item, index) => normalizeInboundAttachment(item, index));
}
function normalizeInboundAttachment(value, index) {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
    if (!record)
        throw new Error(`Generic inbound webhook attachment ${index + 1} must be a JSON object.`);
    const attachment = {};
    const name = normalizeAttachmentMetadata(record.name ?? record.filename ?? record.fileName, "name", index);
    const type = normalizeAttachmentMetadata(record.type ?? record.mimeType ?? record.contentType, "type", index);
    const url = normalizeAttachmentUrl(record.url ?? record.href, index);
    const text = normalizeAttachmentText(record.text ?? record.caption ?? record.description, index);
    const sizeBytes = normalizeAttachmentSize(record.sizeBytes ?? record.size, index);
    if (name)
        attachment.name = name;
    if (type)
        attachment.type = type;
    if (url)
        attachment.url = url;
    if (text)
        attachment.text = text;
    if (sizeBytes !== undefined)
        attachment.sizeBytes = sizeBytes;
    if (!attachment.name && !attachment.type && !attachment.url && !attachment.text && attachment.sizeBytes === undefined) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} must include name, type, url, text, or sizeBytes.`);
    }
    return attachment;
}
function normalizeAttachmentMetadata(value, field, index) {
    if (value === undefined || value === null)
        return undefined;
    const text = typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
    if (!text)
        return undefined;
    if (text.length > GENERIC_WEBHOOK_INBOUND_MAX_METADATA_CHARS || /[\x00-\x1f\x7f]/u.test(text)) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} ${field} must be a short single-line string.`);
    }
    return text;
}
function normalizeAttachmentUrl(value, index) {
    if (value === undefined || value === null)
        return undefined;
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw)
        return undefined;
    if (raw.length > GENERIC_WEBHOOK_INBOUND_MAX_URL_CHARS) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} URL is too long.`);
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error(`Generic inbound webhook attachment ${index + 1} URL must be a valid https:// URL.`);
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} URL must be a credential-free https:// URL.`);
    }
    return url.toString();
}
function normalizeAttachmentText(value, index) {
    if (value === undefined || value === null)
        return undefined;
    const text = typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
    if (!text)
        return undefined;
    if (connectorInputTooLong(text, GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENT_TEXT_CHARS)) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} text must be ${GENERIC_WEBHOOK_INBOUND_MAX_ATTACHMENT_TEXT_CHARS} characters or fewer.`);
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} text contains control characters.`);
    }
    return text;
}
function normalizeAttachmentSize(value, index) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Generic inbound webhook attachment ${index + 1} sizeBytes must be a non-negative safe integer.`);
    }
    return value;
}
function composeGenericWebhookInboundPrompt(text, attachments) {
    if (attachments.length === 0)
        return text;
    const lines = [
        text,
        "",
        "Inbound attachments supplied by the webhook (metadata/text only; Viser did not download or verify files):"
    ];
    attachments.forEach((attachment, index) => {
        lines.push(`${index + 1}. ${formatAttachmentSummary(attachment)}`);
        if (attachment.url)
            lines.push(`   url: ${attachment.url}`);
        if (attachment.text)
            lines.push(`   text: ${attachment.text}`);
    });
    return lines.join("\n");
}
function formatAttachmentSummary(attachment) {
    const parts = [
        attachment.name ? `name=${attachment.name}` : undefined,
        attachment.type ? `type=${attachment.type}` : undefined,
        attachment.sizeBytes !== undefined ? `sizeBytes=${attachment.sizeBytes}` : undefined
    ].filter(Boolean);
    return parts.length > 0 ? parts.join("; ") : "attachment";
}
export function redactGenericWebhookDetail(detail, config, webhookId, text) {
    let output = detail;
    const urls = [config.webhookUrl, ...Object.values(config.webhookUrls)];
    for (const secret of [...urls, config.inboundToken, webhookId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
