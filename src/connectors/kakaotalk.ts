// ================================================================
// KakaoTalk Open Builder skill bridge
// ================================================================
// KakaoTalk chatbot channels invoke a Skill server with userRequest.utterance
// and expect a SkillResponse JSON object (version 2.0). Viser keeps this
// connector foreground-only and routes the reply through AssistantRuntime, so
// model access still happens only through logged-in local CLI providers.

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AccessStore } from "../core/access.ts";
import { chunkText } from "../utils/text.ts";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.ts";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.ts";
import { pairedMessage, pairingRequiredMessage } from "./telegram.ts";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { KakaotalkConnectorConfig } from "../core/types.ts";

const MAX_SKILL_BODY_BYTES = 1_000_000;
const KAKAOTALK_TEXT_CHUNK_SIZE = 1000;
const KAKAOTALK_MAX_OUTPUTS = 3;

export interface KakaotalkSkillMessage {
  userId: string;
  utterance: string;
  timezone?: string;
  lang?: string;
}

export interface KakaotalkSkillResponse {
  version: "2.0";
  template: {
    outputs: Array<{
      simpleText: {
        text: string;
      };
    }>;
  };
}

export interface KakaotalkWebhookHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

interface KakaotalkSkillPayload {
  userRequest?: {
    timezone?: string;
    utterance?: string;
    lang?: string;
    user?: {
      id?: string;
      properties?: {
        plusfriendUserKey?: string;
        appUserId?: string;
      };
    };
  };
}

export async function runKakaotalkBridge(
  config: KakaotalkConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore
): Promise<void> {
  const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
  const handle = await startKakaotalkSkillServer(config, assistant, access, rateLimiter);
  console.log(`KakaoTalk skill bridge is running at ${handle.url}${config.webhookPath}. Press Ctrl+C to stop.`);

  await new Promise<void>((resolve) => {
    const stop = () => {
      void handle.close().finally(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function startKakaotalkSkillServer(
  config: KakaotalkConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute)
): Promise<KakaotalkWebhookHandle> {
  const server = createServer((request, response) => {
    void handleKakaotalkHttpRequest(request, response, config, assistant, access, rateLimiter).catch((error) => {
      sendJson(response, request.method ?? "GET", 500, kakaotalkSkillResponse(`Viser error:\n${error instanceof Error ? error.message : String(error)}`));
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

export async function handleKakaotalkHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: KakaotalkConnectorConfig,
  assistant: AssistantRuntime,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
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

  if (!verifyKakaotalkRequestToken(config, request)) {
    sendText(response, method, 403, "Forbidden");
    return;
  }

  const body = await readRequestBody(request, MAX_SKILL_BODY_BYTES);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    sendJson(response, method, 400, kakaotalkSkillResponse("Invalid KakaoTalk Skill JSON."));
    return;
  }

  const reply = await handleKakaotalkSkillPayload(config, assistant, payload, access, rateLimiter);
  sendJson(response, method, 200, reply);
}

export async function handleKakaotalkSkillPayload(
  config: KakaotalkConnectorConfig,
  assistant: AssistantRuntime,
  payload: unknown,
  access?: AccessStore,
  rateLimiter?: ConnectorRateLimiter
): Promise<KakaotalkSkillResponse> {
  const message = parseKakaotalkSkillMessage(payload);
  if (!message) return kakaotalkSkillResponse("KakaoTalk Skill payload did not include a text utterance.");

  const staticAllowlist = [...config.allowedUserIds, ...config.defaultUserIds].map(normalizeKakaotalkUserId).filter(Boolean) as string[];
  if (config.allowedUserIds.length > 0 && !staticAllowlist.includes(message.userId)) {
    return kakaotalkSkillResponse("This KakaoTalk user is not allowed to use this Viser instance.");
  }

  const normalized = normalizeKakaotalkInput(message.utterance);
  if (!normalized) return kakaotalkSkillResponse("메시지가 비어 있어요.");

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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return kakaotalkSkillResponse(`Viser error:\n${detail}`);
  }
}

export function parseKakaotalkSkillMessage(payload: unknown): KakaotalkSkillMessage | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const root = payload as KakaotalkSkillPayload;
  const userRequest = root.userRequest;
  const utterance = typeof userRequest?.utterance === "string" ? userRequest.utterance : undefined;
  const userId = normalizeKakaotalkUserId(
    userRequest?.user?.id
      ?? userRequest?.user?.properties?.plusfriendUserKey
      ?? userRequest?.user?.properties?.appUserId
  );
  if (!utterance || !userId) return undefined;
  return {
    userId,
    utterance,
    timezone: typeof userRequest?.timezone === "string" ? userRequest.timezone : undefined,
    lang: typeof userRequest?.lang === "string" ? userRequest.lang : undefined
  };
}

export function kakaotalkSkillResponse(text: string): KakaotalkSkillResponse {
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

export function normalizeKakaotalkUserId(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || value.length > 100 || /[\s\u0000-\u001f\u007f]/u.test(value)) return undefined;
  return value;
}

export function normalizeKakaotalkInput(content: string): string | undefined {
  const trimmed = content.trim();
  return trimmed || undefined;
}

export function verifyKakaotalkRequestToken(config: KakaotalkConnectorConfig, request: IncomingMessage): boolean {
  const expected = config.requestToken;
  if (!expected) return false;
  const received = bearerToken(requestHeader(request, "authorization")) ?? requestHeader(request, "x-viser-kakaotalk-token");
  return timingSafeStringEqual(received, expected);
}

function bearerToken(value: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/iu.exec(value ?? "");
  return match?.[1]?.trim();
}

function timingSafeStringEqual(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeKakaotalkOutput(text: string): string {
  return text.replace(/\r\n?/gu, "\n").trim() || "Viser response is empty.";
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("KakaoTalk Skill request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, method: string, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}

function sendText(response: ServerResponse, method: string, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function serverUrl(server: Server, host: string): string {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : undefined;
  return `http://${host}:${port ?? ""}`;
}
