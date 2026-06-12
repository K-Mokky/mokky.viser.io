// ================================================================
// Zulip Messages API sender
// ================================================================
// Zulip exposes an authenticated REST API for channel and direct messages.
// Viser keeps the Zulip site URL, bot email, API key, and destination specs in
// configuration/env only; approval actions and schedules reference short local
// aliases such as zulip:ops instead of raw channel/topic/email data.
import { Buffer } from "node:buffer";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId, parseWebhookUrlMap } from "./google-chat.js";
const ZULIP_CHUNK_SIZE = 3900;
export async function sendZulipMessage(config, targetId, text, options = {}) {
    const siteUrl = normalizeZulipSiteUrl(config.siteUrl);
    const botEmail = normalizeZulipBotEmail(config.botEmail);
    const apiKey = normalizeZulipApiKey(config.apiKey);
    const target = resolveZulipTarget(config, targetId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, ZULIP_CHUNK_SIZE)) {
        const body = new URLSearchParams();
        if (target.kind === "stream") {
            body.set("type", "stream");
            body.set("to", JSON.stringify(target.to));
            body.set("topic", target.topic);
        }
        else {
            body.set("type", "direct");
            body.set("to", JSON.stringify(target.to));
        }
        body.set("content", chunk);
        const response = await fetchWithTimeout(fetchImpl, `${siteUrl}/api/v1/messages`, {
            method: "POST",
            headers: {
                authorization: zulipAuthorizationHeader(botEmail, apiKey),
                "content-type": "application/x-www-form-urlencoded"
            },
            body: body.toString()
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactZulipDetail(`Zulip send failed: ${response.status} ${response.statusText} ${bodyText}`, config, targetId, target, chunk));
        }
    }
}
export function resolveZulipTarget(config, targetId) {
    const id = normalizeZulipTargetId(targetId);
    const mapped = config.targets[id] ?? (id === "default" ? config.target : undefined);
    if (!mapped) {
        throw new Error(`Zulip target id '${id}' is not configured. Set ${config.targetEnv} or ${config.targetsEnv}.`);
    }
    return parseZulipTargetSpec(mapped);
}
export function normalizeZulipTargetId(value) {
    const id = normalizeWebhookId(value);
    if (!id)
        throw new Error("Zulip target id must be a short alias such as default or ops.");
    return id;
}
export function parseZulipTargetMap(value) {
    return parseWebhookUrlMap(value);
}
export function parseZulipTargetSpec(value) {
    const trimmed = value.trim();
    const [kindRaw = "", ...rest] = trimmed.split(":");
    const kind = kindRaw.toLowerCase();
    if (kind === "stream" || kind === "channel") {
        const channel = rest[0]?.trim();
        const topic = rest.slice(1).join(":").trim();
        if (!channel)
            throw new Error("Zulip stream target must look like stream:<channel>:<topic>.");
        if (!topic)
            throw new Error("Zulip stream target requires a topic.");
        return { kind: "stream", to: normalizeZulipTargetText(channel, "Zulip channel"), topic: normalizeZulipTargetText(topic, "Zulip topic") };
    }
    if (kind === "direct" || kind === "dm" || kind === "private") {
        const recipientList = rest.join(":").trim();
        const recipients = parseZulipDirectRecipients(recipientList);
        if (recipients.length === 0)
            throw new Error("Zulip direct target must include at least one recipient email or user id.");
        return { kind: "direct", to: recipients };
    }
    throw new Error("Zulip target must look like stream:<channel>:<topic> or direct:<email-or-user-id>[|...].");
}
export function normalizeZulipSiteUrl(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Zulip site URL is required.");
    let url;
    try {
        url = new URL(trimmed);
    }
    catch {
        throw new Error("Zulip site URL must be an https://... URL.");
    }
    if (url.protocol !== "https:")
        throw new Error("Zulip site URL must use https.");
    if (url.username || url.password)
        throw new Error("Zulip site URL must not include credentials.");
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
}
export function normalizeZulipBotEmail(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Zulip bot email is required.");
    if (trimmed.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(trimmed))
        throw new Error("Zulip bot email must be a valid email address.");
    return trimmed;
}
export function normalizeZulipApiKey(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Zulip API key is required.");
    if (trimmed.length < 10 || trimmed.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Zulip API key must be a non-empty opaque token.");
    return trimmed;
}
export function zulipAuthorizationHeader(botEmail, apiKey) {
    return `Basic ${Buffer.from(`${botEmail}:${apiKey}`).toString("base64")}`;
}
export function redactZulipDetail(detail, config, targetId, target, text) {
    let output = detail;
    const targetSecrets = target?.kind === "stream" ? [target.to, target.topic] : target?.to.map(String) ?? [];
    const normalizedSiteUrl = safeNormalizedSiteUrl(config.siteUrl);
    for (const secret of [config.siteUrl, normalizedSiteUrl, config.botEmail, config.apiKey, config.target, ...Object.values(config.targets), targetId, ...targetSecrets, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function safeNormalizedSiteUrl(value) {
    try {
        return value ? normalizeZulipSiteUrl(value) : undefined;
    }
    catch {
        return undefined;
    }
}
function parseZulipDirectRecipients(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return [];
    const maybeJson = parseJsonRecipientList(trimmed);
    if (maybeJson)
        return maybeJson;
    return trimmed
        .split(/[|,]/u)
        .map((part) => normalizeZulipDirectRecipient(part.trim()))
        .filter((recipient) => recipient !== undefined);
}
function parseJsonRecipientList(value) {
    if (!value.startsWith("["))
        return undefined;
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed))
            return undefined;
        return parsed.map((item) => normalizeZulipDirectRecipient(String(item))).filter((recipient) => recipient !== undefined);
    }
    catch {
        return undefined;
    }
}
function normalizeZulipDirectRecipient(value) {
    if (!value)
        return undefined;
    if (/^[1-9]\d{0,15}$/u.test(value))
        return Number(value);
    if (value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value))
        return value;
    throw new Error("Zulip direct recipient must be a user id or email address.");
}
function normalizeZulipTargetText(value, label) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error(`${label} is required.`);
    if (trimmed.length > 200)
        throw new Error(`${label} is too long.`);
    if (/[\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error(`${label} contains control characters.`);
    return trimmed;
}
