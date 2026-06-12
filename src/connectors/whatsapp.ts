// ================================================================
// WhatsApp Cloud API bridge
// ================================================================
// WhatsApp Cloud API receives inbound messages through Meta webhooks and sends
// outbound replies through Graph API /{phone-number-id}/messages. Viser keeps
// the webhook server foreground-only and preserves the same pairing, rate-limit,
// input-size, approval, and redaction boundaries as other messenger connectors.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AccessStore } from "../core/access.ts";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { WhatsappConnectorConfig } from "../core/types.ts";

const WHATSAPP_CHUNK_SIZE = 1024;
const MAX_WEBHOOK_BODY_BYTES = 1_000_000;

export interface WhatsappMessage {
  id?: string;
  from: string;
  text: string;
}

export interface WhatsappFetchOptions {
  fetchImpl?: FetchLike;
}

interface WhatsappWebhookPayload {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          id?: string;
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
}

export async function runWhatsappBridge(
  config: WhatsappConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
  const handle = await startWhatsappWebhookServer(config, assistant, access, rateLimiter);
  console.log(`WhatsApp webhook bridge is running at ${handle.url}${config.webhookPath}. Press Ctrl+C to stop.`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export interface WhatsappWebhookHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export async function startWhatsappWebhookServer(
  config: WhatsappConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute),
  options: WhatsappFetchOptions = {}
): Promise<WhatsappWebhookHandle> {
  const server = createServer((request, response) => {
    void handleWhatsappHttpRequest(request, response, config, assistant, access, rateLimiter, options).catch((error) => {
      sendText(response, request.method ?? "GET", 500, `WhatsApp webhook error: ${redactWhatsappDetail(error instanceof Error ? error.message : String(error), config)}`);
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

export async function handleWhatsappHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: WhatsappConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: WhatsappFetchOptions = {}
): Promise<void> {
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
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    sendText(response, method, 400, "Invalid JSON");
    return;
  }

  await handleWhatsappWebhookPayload(config, assistant, payload, access, rateLimiter, options);
  sendText(response, method, 200, "EVENT_RECEIVED");
}

export function verifyWhatsappWebhookChallenge(config: WhatsappConnectorConfig, params: URLSearchParams): string | undefined {
  if (params.get("hub.mode") !== "subscribe") return undefined;
  if (!config.verifyToken || params.get("hub.verify_token") !== config.verifyToken) return undefined;
  return params.get("hub.challenge") ?? "";
}

export async function handleWhatsappWebhookPayload(
  config: WhatsappConnectorConfig,
  assistant: AssistantRuntime,
  payload: unknown,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: WhatsappFetchOptions = {}
): Promise<number> {
  const messages = parseWhatsappWebhookMessages(payload);
  for (const message of messages) {
    await handleWhatsappMessage(config, assistant, message, access, rateLimiter, options);
  }
  return messages.length;
}

export async function handleWhatsappMessage(
  config: WhatsappConnectorConfig,
  assistant: AssistantRuntime,
  message: WhatsappMessage,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter,
  options: WhatsappFetchOptions = {}
): Promise<void> {
  const from = normalizeWhatsappRecipient(message.from);
  if (!from || !message.text) return;

  const staticAllowlist = [...config.allowedRecipientIds, ...config.defaultRecipientIds].map((value) => normalizeWhatsappRecipient(value)).filter(Boolean) as string[];
  if (config.allowedRecipientIds.length > 0 && !staticAllowlist.includes(from)) return;

  const normalized = normalizeWhatsappInput(message.text);
  if (!normalized) return;

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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await sendWhatsappMessage(config, from, `Viser error:\n${detail}`, options);
  }
}

export async function sendWhatsappMessage(
  config: WhatsappConnectorConfig,
  recipientId: string,
  text: string,
  options: WhatsappFetchOptions = {}
): Promise<void> {
  const token = config.accessToken;
  if (!token) throw new Error(`WhatsApp access token is missing. Set ${config.accessTokenEnv}.`);
  if (!config.phoneNumberId) throw new Error(`WhatsApp phone number ID is missing. Set ${config.phoneNumberIdEnv}.`);
  const recipient = normalizeWhatsappRecipient(recipientId);
  if (!recipient) throw new Error("WhatsApp recipient id must be an E.164 phone number.");
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

export function parseWhatsappWebhookMessages(payload: unknown): WhatsappMessage[] {
  if (typeof payload !== "object" || payload === null) return [];
  const root = payload as WhatsappWebhookPayload;
  if (root.object && root.object !== "whatsapp_business_account") return [];

  const messages: WhatsappMessage[] = [];
  for (const entry of root.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type && message.type !== "text") continue;
        const from = normalizeWhatsappRecipient(message.from);
        const text = typeof message.text?.body === "string" ? message.text.body : undefined;
        if (!from || !text) continue;
        messages.push({ id: message.id, from, text });
      }
    }
  }
  return messages;
}

export function normalizeWhatsappInput(content: string): string | undefined {
  const trimmed = content.trim();
  return trimmed || undefined;
}

export function normalizeWhatsappRecipient(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/[\s().-]+/gu, "");
  if (!trimmed || trimmed.length > 25 || /[\u0000-\u001F\u007F]/u.test(trimmed)) return undefined;
  if (/^\+[1-9]\d{4,19}$/u.test(trimmed)) return trimmed;
  if (/^[1-9]\d{4,19}$/u.test(trimmed)) return `+${trimmed}`;
  return undefined;
}

function whatsappMessagesUrl(config: WhatsappConnectorConfig): string {
  const version = config.graphApiVersion.trim().replace(/^\/+/u, "");
  return `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(config.phoneNumberId ?? "")}/messages`;
}

function redactWhatsappDetail(detail: string, config: WhatsappConnectorConfig, recipient?: string, text?: string): string {
  let output = detail;
  for (const secret of [config.accessToken, config.phoneNumberId, config.verifyToken, recipient, recipient?.replace(/^\+/u, ""), text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  let body = "";
  let bytes = 0;
  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    bytes += Buffer.byteLength(piece);
    if (bytes > maxBytes) throw new Error("WhatsApp webhook body is too large.");
    body += piece;
  }
  return body;
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
