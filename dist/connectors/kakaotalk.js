// ================================================================
// KakaoTalk Open Builder skill bridge
// ================================================================
// KakaoTalk chatbot channels invoke a Skill server with userRequest.utterance
// and expect a SkillResponse JSON object (version 2.0). Viser keeps this
// connector foreground-only and routes the reply through AssistantRuntime, so
// model access still happens only through logged-in local CLI providers.
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { chunkText } from "../utils/text.js";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.js";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.js";
import { pairedMessage, pairingRequiredMessage } from "./telegram.js";
const MAX_SKILL_BODY_BYTES = 1_000_000;
const KAKAOTALK_TEXT_CHUNK_SIZE = 1000;
const KAKAOTALK_MAX_OUTPUTS = 3;
export async function runKakaotalkBridge(config, assistant, access) {
    const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
    const handle = await startKakaotalkSkillServer(config, assistant, access, rateLimiter);
    console.log(`KakaoTalk skill bridge is running at ${handle.url}${config.webhookPath}. Press Ctrl+C to stop.`);
    await new Promise((resolve) => {
        const stop = () => {
            void handle.close().finally(resolve);
        };
        process.once("SIGINT", stop);
        process.once("SIGTERM", stop);
    });
}
export async function startKakaotalkSkillServer(config, assistant, access, rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute)) {
    const server = createServer((request, response) => {
        void handleKakaotalkHttpRequest(request, response, config, assistant, access, rateLimiter).catch((error) => {
            sendJson(response, request.method ?? "GET", 500, kakaotalkSkillResponse(`Viser error:\n${error instanceof Error ? error.message : String(error)}`));
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
export async function handleKakaotalkHttpRequest(request, response, config, assistant, access, rateLimiter) {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== config.webhookPath) {
        sendText(response, method, 404, "Not found");
        return;
    }
    if (method !== "POST") {
        response.setHeader("allow", "POST");
        sendText(response, method, 405, "Method not allowed");
        return;
    }
    if (!verifyKakaotalkRequestToken(config, request)) {
        sendText(response, method, 403, "Forbidden");
        return;
    }
    const body = await readRequestBody(request, MAX_SKILL_BODY_BYTES);
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch {
        sendJson(response, method, 400, kakaotalkSkillResponse("Invalid KakaoTalk Skill JSON."));
        return;
    }
    const reply = await handleKakaotalkSkillPayload(config, assistant, payload, access, rateLimiter);
    sendJson(response, method, 200, reply);
}
export async function handleKakaotalkSkillPayload(config, assistant, payload, access, rateLimiter) {
    const message = parseKakaotalkSkillMessage(payload);
    if (!message)
        return kakaotalkSkillResponse("KakaoTalk Skill payload did not include a text utterance.");
    const staticAllowlist = [...config.allowedUserIds, ...config.defaultUserIds].map(normalizeKakaotalkUserId).filter(Boolean);
    if (config.allowedUserIds.length > 0 && !staticAllowlist.includes(message.userId)) {
        return kakaotalkSkillResponse("This KakaoTalk user is not allowed to use this Viser instance.");
    }
    const normalized = normalizeKakaotalkInput(message.utterance);
    if (!normalized)
        return kakaotalkSkillResponse("메시지가 비어 있어요.");
    if (access && !(await access.isAllowed("kakaotalk", message.userId, staticAllowlist))) {
        const paired = await access.tryPairCommand(normalized, "kakaotalk", message.userId, `kakaotalk:${message.userId}`);
        return kakaotalkSkillResponse(paired ? pairedMessage("kakaotalk") : pairingRequiredMessage("kakaotalk"));
    }
    if (connectorInputTooLong(normalized, config.maxInputChars)) {
        return kakaotalkSkillResponse(connectorInputLimitMessage(config.maxInputChars));
    }
    const rate = rateLimiter?.check(`kakaotalk:${message.userId}`);
    if (rate && !rate.allowed) {
        return kakaotalkSkillResponse(connectorRateLimitMessage(rate.retryAfterMs));
    }
    try {
        const answer = await assistant.handle(normalized, `kakaotalk:${message.userId}`, { source: "kakaotalk" });
        return kakaotalkSkillResponse(answer);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return kakaotalkSkillResponse(`Viser error:\n${detail}`);
    }
}
export function parseKakaotalkSkillMessage(payload) {
    if (typeof payload !== "object" || payload === null)
        return undefined;
    const root = payload;
    const userRequest = root.userRequest;
    const utterance = typeof userRequest?.utterance === "string" ? userRequest.utterance : undefined;
    const userId = normalizeKakaotalkUserId(userRequest?.user?.id
        ?? userRequest?.user?.properties?.plusfriendUserKey
        ?? userRequest?.user?.properties?.appUserId);
    if (!utterance || !userId)
        return undefined;
    return {
        userId,
        utterance,
        timezone: typeof userRequest?.timezone === "string" ? userRequest.timezone : undefined,
        lang: typeof userRequest?.lang === "string" ? userRequest.lang : undefined
    };
}
export function kakaotalkSkillResponse(text) {
    const normalized = normalizeKakaotalkOutput(text);
    const chunks = chunkText(normalized, KAKAOTALK_TEXT_CHUNK_SIZE);
    const outputs = chunks.slice(0, KAKAOTALK_MAX_OUTPUTS).map((chunk) => ({ simpleText: { text: chunk } }));
    if (chunks.length > KAKAOTALK_MAX_OUTPUTS) {
        outputs[KAKAOTALK_MAX_OUTPUTS - 1] = {
            simpleText: {
                text: `${outputs[KAKAOTALK_MAX_OUTPUTS - 1].simpleText.text}\n\n…(Viser response truncated for KakaoTalk Skill output limit.)`
            }
        };
    }
    return {
        version: "2.0",
        template: {
            outputs: outputs.length ? outputs : [{ simpleText: { text: "Viser response is empty." } }]
        }
    };
}
export function normalizeKakaotalkUserId(raw) {
    const value = raw?.trim();
    if (!value || value.length > 100 || /[\s\u0000-\u001f\u007f]/u.test(value))
        return undefined;
    return value;
}
export function normalizeKakaotalkInput(content) {
    const trimmed = content.trim();
    return trimmed || undefined;
}
export function verifyKakaotalkRequestToken(config, request) {
    const expected = config.requestToken;
    if (!expected)
        return false;
    const received = bearerToken(requestHeader(request, "authorization")) ?? requestHeader(request, "x-viser-kakaotalk-token");
    return timingSafeStringEqual(received, expected);
}
function bearerToken(value) {
    const match = /^Bearer\s+(.+)$/iu.exec(value ?? "");
    return match?.[1]?.trim();
}
function timingSafeStringEqual(received, expected) {
    if (!received)
        return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}
function normalizeKakaotalkOutput(text) {
    return text.replace(/\r\n?/gu, "\n").trim() || "Viser response is empty.";
}
function requestHeader(request, name) {
    const value = request.headers[name.toLowerCase()];
    return Array.isArray(value) ? value[0] : value;
}
async function readRequestBody(request, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes)
            throw new Error("KakaoTalk Skill request body is too large.");
        chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
}
function sendJson(response, method, status, body) {
    response.statusCode = status;
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (method === "HEAD") {
        response.end();
        return;
    }
    response.end(JSON.stringify(body));
}
function sendText(response, method, status, body) {
    response.statusCode = status;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    if (method === "HEAD") {
        response.end();
        return;
    }
    response.end(body);
}
function serverUrl(server, host) {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : undefined;
    return `http://${host}:${port ?? ""}`;
}
