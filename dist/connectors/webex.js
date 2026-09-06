// ================================================================
// Webex Messages API sender
// ================================================================
// Webex sends Markdown text into a space through the Messages REST API. Viser
// keeps the bearer token in configuration/env only and exposes room IDs through
// the same pairing and allowlist boundary as other connector-message targets.
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
const WEBEX_MESSAGES_URL = "https://webexapis.com/v1/messages";
const WEBEX_CHUNK_SIZE = 3900;
export async function sendWebexMessage(config, roomId, text, options = {}) {
    if (!config.accessToken)
        throw new Error(`Webex access token is missing. Set ${config.accessTokenEnv}.`);
    const safeRoomId = normalizeWebexRoomId(roomId);
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, WEBEX_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, WEBEX_MESSAGES_URL, {
            method: "POST",
            headers: {
                authorization: `Bearer ${config.accessToken}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({ roomId: safeRoomId, markdown: chunk })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactWebexDetail(`Webex send failed: ${response.status} ${response.statusText} ${bodyText}`, config, safeRoomId, chunk));
        }
    }
}
export function normalizeWebexRoomId(value) {
    const trimmed = value.trim();
    if (!trimmed)
        throw new Error("Webex room ID is required.");
    if (!/^[A-Za-z0-9._-]{10,512}$/u.test(trimmed)) {
        throw new Error("Webex room ID must be the opaque Webex roomId value, not a URL or webhook.");
    }
    return trimmed;
}
export function redactWebexDetail(detail, config, roomId, text) {
    let output = detail;
    for (const secret of [config.accessToken, roomId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
