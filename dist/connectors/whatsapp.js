// ================================================================
// WhatsApp Cloud API bridge
// ================================================================
// WhatsApp Cloud API receives inbound messages through Meta webhooks and sends
// outbound replies through Graph API /{phone-number-id}/messages. Viser keeps
// the webhook server foreground-only and preserves the same pairing, rate-limit,
// input-size, approval, and redaction boundaries as other messenger connectors.
import { createServer } from "node:http";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
import { chunkText } from "../utils/text.js";
import { pairedMessage, pairingRequiredMessage } from "./telegram.js";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.js";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.js";
const WHATSAPP_CHUNK_SIZE = 1024;
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
export async function runWhatsappBridge(config, assistant, access) {
    const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
    const handle = await startWhatsappWebhookServer(config, assistant, access, rateLimiter);
    console.log(`WhatsApp webhook bridge is running at ${handle.url}${config.webhookPath}. Press Ctrl+C to stop.`);
    await new Promise((resolve) => {
        const stop = () => {
            void handle.close().finally(resolve);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
}
export async function startWhatsappWebhookServer(config, assistant, access, rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute), options = {}) {
    const server = createServer((request, response) => {
        void handleWhatsappHttpRequest(request, response, config, assistant, access, rateLimiter, options).catch((error) => {
            sendText(response, request.method ?? "GET", 500, `WhatsApp webhook error: ${redactWhatsappDetail(error instanceof Error ? error.message : String(error), config)}`);
        });
    });
    await new Promise((resolve, reject) => {
        const onError = (error) => reject(error);
        server.once("error", onError);
        server.listen(config.webhookPort, config.webhookHost, () => {
            server.off("error", onError);
            resolve();
        });
    });
    return {
        url: serverUrl(server, config.webhookHost),
        server,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    };
}
export async function handleWhatsappHttpRequest(request, response, config, assistant, access, rateLimiter, options = {}) {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== config.webhookPath) {
        sendText(response, method, 404, "Not found");
        return;
    }
    if (method === "GET" || method === "HEAD") {
        const challenge = verifyWhatsappWebhookChallenge(config, url.searchParams);
        if (challenge === undefined) {
            sendText(response, method, 403, "Forbidden");
            return;
        }
        sendText(response, method, 200, challenge);
        return;
    }
    if (method !== "POST") {
        response.setHeader("allow", "GET, HEAD, POST");
        sendText(response, method, 405, "Method not allowed");
        return;
    }
    const body = await readRequestBody(request, MAX_WEBHOOK_BODY_BYTES);
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch {
        sendText(response, method, 400, "Invalid JSON");
        return;
    }
    await handleWhatsappWebhookPayload(config, assistant, payload, access, rateLimiter, options);
    sendText(response, method, 200, "EVENT_RECEIVED");
}
export function verifyWhatsappWebhookChallenge(config, params) {
    if (params.get("hub.mode") !== "subscribe")
        return undefined;
    if (!config.verifyToken || params.get("hub.verify_token") !== config.verifyToken)
        return undefined;
    return params.get("hub.challenge") ?? "";
}
export async function handleWhatsappWebhookPayload(config, assistant, payload, access, rateLimiter, options = {}) {
    const messages = parseWhatsappWebhookMessages(payload);
    for (const message of messages) {
        await handleWhatsappMessage(config, assistant, message, access, rateLimiter, options);
    }
    return messages.length;
}
export async function handleWhatsappMessage(config, assistant, message, access, rateLimiter, options = {}) {
    const from = normalizeWhatsappRecipient(message.from);
    if (!from || !message.text)
        return;
    const staticAllowlist = [...config.allowedRecipientIds, ...config.defaultRecipientIds].map((value) => normalizeWhatsappRecipient(value)).filter(Boolean);
    if (config.allowedRecipientIds.length > 0 && !staticAllowlist.includes(from))
        return;
    const normalized = normalizeWhatsappInput(message.text);
    if (!normalized)
        return;
    if (access && !(await access.isAllowed("whatsapp", from, staticAllowlist))) {
        const paired = await access.tryPairCommand(normalized, "whatsapp", from, `whatsapp:${from}`);
        await sendWhatsappMessage(config, from, paired ? pairedMessage("whatsapp") : pairingRequiredMessage("whatsapp"), options);
        return;
    }
    if (connectorInputTooLong(normalized, config.maxInputChars)) {
        await sendWhatsappMessage(config, from, connectorInputLimitMessage(config.maxInputChars), options);
        return;
    }
    const rate = rateLimiter?.check(`whatsapp:${from}`);
    if (rate && !rate.allowed) {
        await sendWhatsappMessage(config, from, connectorRateLimitMessage(rate.retryAfterMs), options);
        return;
    }
    try {
        const answer = await assistant.handle(normalized, `whatsapp:${from}`, { source: "whatsapp" });
        await sendWhatsappMessage(config, from, answer, options);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await sendWhatsappMessage(config, from, `Viser error:\n${detail}`, options);
    }
}
export async function sendWhatsappMessage(config, recipientId, text, options = {}) {
    const token = config.accessToken;
    if (!token)
        throw new Error(`WhatsApp access token is missing. Set ${config.accessTokenEnv}.`);
    if (!config.phoneNumberId)
        throw new Error(`WhatsApp phone number ID is missing. Set ${config.phoneNumberIdEnv}.`);
    const recipient = normalizeWhatsappRecipient(recipientId);
    if (!recipient)
        throw new Error("WhatsApp recipient id must be an E.164 phone number.");
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const chunk of chunkText(text, WHATSAPP_CHUNK_SIZE)) {
        const response = await fetchWithTimeout(fetchImpl, whatsappMessagesUrl(config), {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json"
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: recipient.replace(/^\+/u, ""),
                type: "text",
                text: {
                    preview_url: false,
                    body: chunk
                }
            })
        }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
        const bodyText = await response.text().catch(() => "");
        if (!response.ok) {
            throw new Error(redactWhatsappDetail(`WhatsApp send failed: ${response.status} ${response.statusText} ${bodyText}`, config, recipient, chunk));
        }
    }
}
export function parseWhatsappWebhookMessages(payload) {
    if (typeof payload !== "object" || payload === null)
        return [];
    const root = payload;
    if (root.object && root.object !== "whatsapp_business_account")
        return [];
    const messages = [];
    for (const entry of root.entry ?? []) {
        for (const change of entry.changes ?? []) {
            for (const message of change.value?.messages ?? []) {
                if (message.type && message.type !== "text")
                    continue;
                const from = normalizeWhatsappRecipient(message.from);
                const text = typeof message.text?.body === "string" ? message.text.body : undefined;
                if (!from || !text)
                    continue;
                messages.push({ id: message.id, from, text });
            }
        }
    }
    return messages;
}
export function normalizeWhatsappInput(content) {
    const trimmed = content.trim();
    return trimmed || undefined;
}
export function normalizeWhatsappRecipient(value) {
    const trimmed = value?.trim().replace(/[\s().-]+/gu, "");
    if (!trimmed || trimmed.length > 25 || /[\u0000-\u001F\u007F]/u.test(trimmed))
        return undefined;
    if (/^\+[1-9]\d{4,19}$/u.test(trimmed))
        return trimmed;
    if (/^[1-9]\d{4,19}$/u.test(trimmed))
        return `+${trimmed}`;
    return undefined;
}
function whatsappMessagesUrl(config) {
    const version = config.graphApiVersion.trim().replace(/^\/+/u, "");
    return `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(config.phoneNumberId ?? "")}/messages`;
}
function redactWhatsappDetail(detail, config, recipient, text) {
    let output = detail;
    for (const secret of [config.accessToken, config.phoneNumberId, config.verifyToken, recipient, recipient?.replace(/^\+/u, ""), text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
async function readRequestBody(request, maxBytes) {
    let body = "";
    let bytes = 0;
    for await (const chunk of request) {
        const piece = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        bytes += Buffer.byteLength(piece);
        if (bytes > maxBytes)
            throw new Error("WhatsApp webhook body is too large.");
        body += piece;
    }
    return body;
}
function sendText(response, method, status, body) {
    response.statusCode = status;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(method === "HEAD" ? undefined : body);
}
function serverUrl(server, requestedHost) {
    const address = server.address();
    if (typeof address === "object" && address) {
        return `http://${urlHost(address.address || requestedHost)}:${address.port}`;
    }
    return `http://${urlHost(requestedHost)}:0`;
}
function urlHost(host) {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
