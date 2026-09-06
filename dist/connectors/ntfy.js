// ================================================================
// ntfy push notification sender
// ================================================================
// ntfy publishes push notifications by HTTP POSTing message text to a topic
// URL. Viser keeps the raw topic hidden behind local aliases, optional Bearer
// credentials, and the same approval gate used by the other outbound surfaces.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
const NTFY_CHUNK_SIZE = 3900;
export async function sendNtfyMessage(config, topicAlias, text, options = {}) {
    const target = resolveNtfyTopicTarget(config, topicAlias);
    const token = normalizeOptionalNtfyToken(config.token);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, NTFY_CHUNK_SIZE)) {
        const headers = {
            "content-type": "text/plain; charset=UTF-8",
            "title": "Viser",
            "cache": "no"
        };
        if (token)
            headers.authorization = `Bearer ${token}`;
        const response = await fetchWithTimeout(fetchImpl, ntfyPublishUrl(target.baseUrl, target.topic), {
            method: "POST",
            headers,
            body: chunk
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactNtfyDetail(`ntfy publish failed: ${response.status} ${response.statusText} ${bodyText}`, config, topicAlias, target.topic, chunk));
        }
    }
}
export function resolveNtfyTopicTarget(config, topicAlias) {
    const alias = normalizeNtfyTopicAlias(topicAlias);
    const topic = config.topics[alias] ?? (alias === "default" ? config.topic : undefined);
    if (!topic) {
        throw new Error(`ntfy topic alias '${alias}' is not configured. Set ${config.topicEnv} or ${config.topicsEnv}.`);
    }
    return {
        alias,
        baseUrl: normalizeNtfyBaseUrl(config.baseUrl),
        topic: parseNtfyTopicTarget(topic)
    };
}
export function hasNtfyTopic(config) {
    return Boolean(config.topic || Object.keys(config.topics).length > 0);
}
export function normalizeNtfyBaseUrl(value) {
    const raw = value?.trim() || "https://ntfy.sh";
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error("ntfy base URL must be a valid http(s) URL.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalNtfyHost(url.hostname))) {
        throw new Error("ntfy base URL must use https, except localhost test servers may use http.");
    }
    if (!url.hostname)
        throw new Error("ntfy base URL must include a hostname.");
    if (url.username || url.password)
        throw new Error("ntfy base URL credentials are not allowed; use NTFY_TOKEN for protected topics.");
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
}
export function normalizeNtfyToken(value) {
    const token = normalizeOptionalNtfyToken(value);
    if (!token)
        throw new Error("ntfy token is required for protected topics.");
    return token;
}
export function normalizeOptionalNtfyToken(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.length < 8 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
        throw new Error("ntfy token must be a single opaque token.");
    }
    return trimmed;
}
export function normalizeNtfyTopicAlias(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
        throw new Error("ntfy topic alias must be a short alias such as default, ops, or alerts.");
    }
    return trimmed.toLowerCase();
}
export function parseNtfyTopicTarget(value) {
    const raw = value.trim();
    if (!raw)
        throw new Error("ntfy topic target is required.");
    if (raw.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(raw)) {
        throw new Error("ntfy topic target must be a single safe topic name, not a URL or path.");
    }
    if (/^\./u.test(raw) || raw.includes(".."))
        throw new Error("ntfy topic target must not contain hidden or parent path segments.");
    return raw;
}
export function parseNtfyTopicMap(value) {
    const raw = value?.trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const output = {};
            for (const [key, target] of Object.entries(parsed)) {
                if (typeof target !== "string" || !target.trim())
                    continue;
                output[normalizeNtfyTopicAlias(key)] = parseNtfyTopicTarget(target);
            }
            return output;
        }
    }
    catch {
        // Fall through to a shell-friendly alias=topic list.
    }
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const alias = normalizeNtfyTopicAlias(part.slice(0, separator));
        const target = part.slice(separator + 1).trim();
        if (alias && target)
            output[alias] = parseNtfyTopicTarget(target);
    }
    return output;
}
export function redactNtfyDetail(detail, config, alias, topic, text) {
    let output = detail;
    for (const secret of [config.baseUrl, config.token, config.topic, ...Object.values(config.topics), alias, topic, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function ntfyPublishUrl(baseUrl, topic) {
    const url = new URL(baseUrl);
    const prefix = url.pathname.replace(/\/+$/u, "");
    url.pathname = `${prefix}/${encodeURIComponent(topic)}`;
    url.search = "";
    url.hash = "";
    return url.toString();
}
function isLocalNtfyHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
