// ================================================================
// LINE Messaging API bridge
// ================================================================
// LINE receives inbound text through signed webhooks and sends replies/pushes
// through the Messaging API. Viser keeps the bridge foreground-only and
// preserves the same pairing, rate-limit, input-size, approval, and redaction
// boundaries as other messenger connectors.

import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AccessStore } from "../core/access.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { LineConnectorConfig } from "../core/types.ts";

const LINE_CHUNK_SIZE = 4900;
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

export interface LineMessage {
  id?: string;
  peerId: string;
  replyToken?: string;
  text: string;
}

export interface LineFetchOptions {
  fetchImpl?: FetchLike;
}

export interface LineWebhookHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

interface LineWebhookPayload {
  events?: Array<{
    type?: string;
    replyToken?: string;
    source?: {
      type?: string;
      userId?: string;
      groupId?: string;
      roomId?: string;
    };
    message?: {
      id?: string;
      type?: string;
      text?: string;
    };
  }>;
}

export async function runLineBridge(
  config: LineConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
  const handle = await startLineWebhookServer(config, assistant, access, rateLimiter);
  console.log(`LINE webhook bridge is running at ${handle.url}${config.webhookPath}. Press Ctrl+C to stop.`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function startLineWebhookServer(
  config: LineConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute),
  options: LineFetchOptions = {}
): Promise<LineWebhookHandle> {
  const server = createServer((request, response) => {
    void handleLineHttpRequest(request, response, config, assistant, access, rateLimiter, options).catch((error) => {
      sendText(response, request.method ?? "GET", 500, `LINE webhook error: ${redactLineDetail(error instanceof Error ? error.message : String(error), config)}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(config.webhookPort, config.webhookHost, () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    url: serverUrl(server, config.webhookHost),
    server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

export async function handleLineHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: LineConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: LineFetchOptions = {}
): Promise<void> {
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

  const body = await readRequestBody(request, MAX_WEBHOOK_BODY_BYTES);
  const signature = requestHeader(request, "x-line-signature");
  if (!verifyLineSignature(config, body, signature)) {
    sendText(response, method, 403, "Forbidden");
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    sendText(response, method, 400, "Invalid JSON");
    return;
  }

  await handleLineWebhookPayload(config, assistant, payload, access, rateLimiter, options);
  sendText(response, method, 200, "OK");
}

export function verifyLineSignature(config: LineConnectorConfig, body: string, signature: string | undefined): boolean {
  if (!config.channelSecret || !signature) return false;
  const expected = createHmac("sha256", config.channelSecret).update(body).digest("base64");
  const received = Buffer.from(signature, "base64");
  const expectedBuffer = Buffer.from(expected, "base64");
  return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
}

export async function handleLineWebhookPayload(
  config: LineConnectorConfig,
  assistant: AssistantRuntime,
  payload: unknown,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: LineFetchOptions = {}
): Promise<number> {
  const messages = parseLineWebhookMessages(payload);
  for (const message of messages) {
    await handleLineMessage(config, assistant, message, access, rateLimiter, options);
  }
  return messages.length;
}

export async function handleLineMessage(
  config: LineConnectorConfig,
  assistant: AssistantRuntime,
  message: LineMessage,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: LineFetchOptions = {}
): Promise<void> {
  const peerId = normalizeLinePeerId(message.peerId);
  if (!peerId || !message.text) return;

  const staticAllowlist = [...config.allowedPeerIds, ...config.defaultPeerIds].map(normalizeLinePeerId).filter(Boolean) as string[];
  if (config.allowedPeerIds.length > 0 && !staticAllowlist.includes(peerId)) return;

  const normalized = normalizeLineInput(message.text);
  if (!normalized) return;

  if (access && !(await access.isAllowed("line", peerId, staticAllowlist))) {
    const paired = await access.tryPairCommand(normalized, "line", peerId, `line:${peerId}`);
    await sendLineResponse(config, peerId, message.replyToken, paired ? pairedMessage("line") : pairingRequiredMessage("line"), options);
    return;
  }

  if (connectorInputTooLong(normalized, config.maxInputChars)) {
    await sendLineResponse(config, peerId, message.replyToken, connectorInputLimitMessage(config.maxInputChars), options);
    return;
  }

  const rate = rateLimiter?.check(`line:${peerId}`);
  if (rate && !rate.allowed) {
    await sendLineResponse(config, peerId, message.replyToken, connectorRateLimitMessage(rate.retryAfterMs), options);
    return;
  }

  try {
    const answer = await assistant.handle(normalized, `line:${peerId}`, { source: "line" });
    await sendLineResponse(config, peerId, message.replyToken, answer, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendLineResponse(config, peerId, message.replyToken, `Viser error:\n${detail}`, options);
  }
}

export async function sendLinePushMessage(
  config: LineConnectorConfig,
  peerId: string,
  text: string,
  options: LineFetchOptions = {}
): Promise<void> {
  const safePeerId = normalizeLinePeerId(peerId);
  if (!safePeerId) throw new Error("LINE peer ID must be a userId, groupId, or roomId alias value.");
  await sendLineApiMessages(config, LINE_PUSH_URL, { to: safePeerId }, text, options, safePeerId);
}

export async function sendLineReplyMessage(
  config: LineConnectorConfig,
  replyToken: string,
  text: string,
  options: LineFetchOptions = {}
): Promise<void> {
  const safeReplyToken = normalizeLineReplyToken(replyToken);
  if (!safeReplyToken) throw new Error("LINE reply token is invalid.");
  await sendLineApiMessages(config, LINE_REPLY_URL, { replyToken: safeReplyToken }, text, options, safeReplyToken);
}

export function parseLineWebhookMessages(payload: unknown): LineMessage[] {
  if (typeof payload !== "object" || payload === null) return [];
  const root = payload as LineWebhookPayload;
  const messages: LineMessage[] = [];
  for (const event of root.events ?? []) {
    if (event.type !== "message" || event.message?.type !== "text") continue;
    const peerId = normalizeLinePeerId(event.source?.groupId ?? event.source?.roomId ?? event.source?.userId);
    const text = typeof event.message.text === "string" ? event.message.text : undefined;
    if (!peerId || !text) continue;
    messages.push({
      id: event.message.id,
      peerId,
      replyToken: normalizeLineReplyToken(event.replyToken),
      text
    });
  }
  return messages;
}

export function normalizeLineInput(content: string): string | undefined {
  const trimmed = content.trim();
  return trimmed || undefined;
}

export function normalizeLinePeerId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 128 || /[\u0000-\u001F\u007F]/u.test(trimmed)) return undefined;
  if (/^[A-Za-z0-9._-]+$/u.test(trimmed)) return trimmed;
  return undefined;
}

export function redactLineDetail(detail: string, config: LineConnectorConfig, peerId?: string, text?: string): string {
  let output = detail;
  for (const secret of [config.channelAccessToken, config.channelSecret, peerId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

async function sendLineResponse(
  config: LineConnectorConfig,
  peerId: string,
  replyToken: string | undefined,
  text: string,
  options: LineFetchOptions
): Promise<void> {
  if (replyToken) {
    await sendLineReplyMessage(config, replyToken, text, options);
    return;
  }
  await sendLinePushMessage(config, peerId, text, options);
}

async function sendLineApiMessages(
  config: LineConnectorConfig,
  url: string,
  basePayload: Record<string, string>,
  text: string,
  options: LineFetchOptions,
  redactionTarget?: string
): Promise<void> {
  if (!config.channelAccessToken) throw new Error(`LINE channel access token is missing. Set ${config.channelAccessTokenEnv}.`);
  const fetchImpl = options.fetchImpl ?? fetch;

  for (const chunk of chunkText(text, LINE_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.channelAccessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...basePayload,
        messages: [{ type: "text", text: chunk }]
      })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactLineDetail(`LINE send failed: ${response.status} ${response.statusText} ${bodyText}`, config, redactionTarget, chunk));
    }
  }
}

function normalizeLineReplyToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 256 || /[\u0000-\u001F\u007F]/u.test(trimmed)) return undefined;
  return /^[A-Za-z0-9._-]+$/u.test(trimmed) ? trimmed : undefined;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  let body = "";
  let bytes = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    bytes += Buffer.byteLength(piece);
    if (bytes > maxBytes) throw new Error("LINE webhook body is too large.");
    body += piece;
  }
  return body;
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sendText(response: ServerResponse, method: string, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(method === "HEAD" ? undefined : body);
}

function serverUrl(server: Server, requestedHost: string): string {
  const address = server.address();
  if (typeof address === "object" && address) {
    return `http://${urlHost(address.address || requestedHost)}:${address.port}`;
  }
  return `http://${urlHost(requestedHost)}:0`;
}

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
