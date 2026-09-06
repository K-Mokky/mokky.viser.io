// ================================================================
// Mastodon/Fediverse status sender
// ================================================================
// Mastodon publishes statuses through POST /api/v1/statuses with a user
// OAuth token. Viser keeps that account token and the chosen visibility behind
// local aliases plus the same approval gate used by other outbound surfaces.
import { randomUUID } from "node:crypto";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
const MASTODON_STATUS_CHUNK_SIZE = 480;
const MASTODON_VISIBILITIES = new Set(["public", "unlisted", "private", "direct"]);
export async function sendMastodonStatus(config, targetAlias, text, options = {}) {
    const target = resolveMastodonTarget(config, targetAlias);
    const accessToken = normalizeMastodonAccessToken(config.accessToken);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, MASTODON_STATUS_CHUNK_SIZE)) {
        const body = new URLSearchParams();
        body.set("status", chunk);
        body.set("visibility", target.visibility);
        const response = await fetchWithTimeout(fetchImpl, mastodonApiUrl(target.baseUrl, "/api/v1/statuses"), {
            method: "POST",
            headers: {
                authorization: `Bearer ${accessToken}`,
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "idempotency-key": randomUUID()
            },
            body
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactMastodonDetail(`Mastodon status publish failed: ${response.status} ${response.statusText} ${bodyText}`, config, targetAlias, chunk));
        }
    }
}
export function resolveMastodonTarget(config, targetAlias) {
    const alias = normalizeMastodonTargetAlias(targetAlias);
    const visibility = config.targets[alias] ?? (alias === "default" ? config.visibility : undefined);
    if (!visibility) {
        throw new Error(`Mastodon target alias '${alias}' is not configured. Set ${config.visibilityEnv} or ${config.targetsEnv}.`);
    }
    return {
        alias,
        baseUrl: normalizeMastodonBaseUrl(config.baseUrl),
        visibility: normalizeMastodonVisibility(visibility)
    };
}
export function hasMastodonTarget(config) {
    return Boolean(config.accessToken && (config.visibility || Object.keys(config.targets).length > 0));
}
export function normalizeMastodonBaseUrl(value) {
    const raw = value?.trim();
    if (!raw)
        throw new Error("Mastodon base URL is required.");
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error("Mastodon base URL must be a valid http(s) URL.");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalMastodonHost(url.hostname))) {
        throw new Error("Mastodon base URL must use https, except localhost test servers may use http.");
    }
    if (!url.hostname)
        throw new Error("Mastodon base URL must include a hostname.");
    if (url.username || url.password)
        throw new Error("Mastodon base URL credentials are not allowed; use MASTODON_ACCESS_TOKEN.");
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
}
export function normalizeMastodonAccessToken(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Mastodon access token is required.");
    if (trimmed.length < 8 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
        throw new Error("Mastodon access token must be a single opaque token.");
    }
    return trimmed;
}
export function normalizeMastodonTargetAlias(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
        throw new Error("Mastodon target alias must be a short alias such as default, private, or ops.");
    }
    return trimmed.toLowerCase();
}
export function normalizeMastodonVisibility(value) {
    const trimmed = value?.trim().toLowerCase() || "private";
    if (!MASTODON_VISIBILITIES.has(trimmed)) {
        throw new Error("Mastodon visibility must be public, unlisted, private, or direct.");
    }
    return trimmed;
}
export function parseMastodonTargetMap(value) {
    const raw = value?.trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const output = {};
            for (const [key, visibility] of Object.entries(parsed)) {
                if (typeof visibility !== "string" || !visibility.trim())
                    continue;
                output[normalizeMastodonTargetAlias(key)] = normalizeMastodonVisibility(visibility);
            }
            return output;
        }
    }
    catch {
        // Fall through to a shell-friendly alias=visibility list.
    }
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const alias = normalizeMastodonTargetAlias(part.slice(0, separator));
        const visibility = part.slice(separator + 1).trim();
        if (alias && visibility)
            output[alias] = normalizeMastodonVisibility(visibility);
    }
    return output;
}
export function mastodonApiUrl(baseUrl, pathname) {
    const url = new URL(normalizeMastodonBaseUrl(baseUrl));
    const prefix = url.pathname.replace(/\/+$/u, "");
    url.pathname = `${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
    url.search = "";
    url.hash = "";
    return url.toString();
}
export function redactMastodonDetail(detail, config, alias, text) {
    let output = detail;
    for (const secret of [config.baseUrl, config.accessToken, alias, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function isLocalMastodonHost(hostname) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
