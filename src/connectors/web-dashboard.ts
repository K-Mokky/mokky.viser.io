// ================================================================
// Local web dashboard
// ================================================================
// A tiny localhost-first HTTP surface for the provider-free DashboardData
// snapshot plus an explicit localhost-only WebChat page. The dashboard JSON,
// canvas, voice, and media pages remain provider-free. WebChat is separated
// behind its own same-origin token and refuses non-local requests so remote
// dashboard sharing cannot silently become a provider execution surface.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { DashboardData, GenericWebhookConnectorConfig } from "../core/types.ts";
import { genericWebhookInboundBodyLimitBytes, handleGenericWebhookInbound, normalizeGenericWebhookInboundPath, normalizeGenericWebhookInboundToken, redactGenericWebhookDetail } from "./generic-webhook.ts";
import { ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";

export const DEFAULT_WEB_DASHBOARD_HOST = "127.0.0.1";
export const DEFAULT_WEB_DASHBOARD_PORT = 8787;
export const DASHBOARD_SCHEMA_VERSION = 1;
const DEFAULT_EVENT_INTERVAL_MS = 5000;
const MIN_EVENT_INTERVAL_MS = 1000;
const MAX_EVENT_INTERVAL_MS = 60_000;
const MAX_CANVAS_BODY_BYTES = 64_000;
const MAX_CANVAS_STROKES = 200;
const MAX_CANVAS_POINTS = 160;
const MAX_WEB_CHAT_BODY_BYTES = 16_000;
const MAX_WEB_CHAT_MESSAGE_CHARS = 8_000;
const DASHBOARD_SESSION_COOKIE = "viser_dashboard_session";
const MAX_LOGIN_BODY_BYTES = 8_000;

export interface WebDashboardOptions {
  host?: string;
  port?: number;
  sessionId: string;
  canvasDir?: string;
  authToken?: string;
  genericWebhook?: GenericWebhookConnectorConfig;
}

export interface WebDashboardHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasStroke {
  id: string;
  by: string;
  color: string;
  width: number;
  points: CanvasPoint[];
  createdAt: string;
}

export interface CanvasSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  strokes: CanvasStroke[];
  persistence: {
    enabled: boolean;
    store: "memory" | "private-local-json";
  };
  limits: {
    maxStrokes: number;
    maxPointsPerStroke: number;
  };
}

export interface WebDashboardState {
  canvasToken: string;
  webChatToken: string;
  canvasStrokes: CanvasStroke[];
  canvasStorePath?: string;
  canvasWriteQueue?: Promise<void>;
  authToken?: string;
  authSessionToken?: string;
}

export interface WebDashboardStateOptions {
  authToken?: string;
}

export function createWebDashboardState(options: WebDashboardStateOptions = {}): WebDashboardState {
  return {
    canvasToken: randomUUID(),
    webChatToken: randomUUID(),
    canvasStrokes: [],
    canvasWriteQueue: Promise.resolve(),
    authToken: normalizeDashboardAuthToken(options.authToken),
    authSessionToken: options.authToken ? randomUUID() : undefined
  };
}

export async function createPersistentWebDashboardState(
  canvasDir: string,
  options: WebDashboardStateOptions = {}
): Promise<WebDashboardState> {
  await ensurePrivateDir(canvasDir);
  const canvasStorePath = join(canvasDir, "canvas.json");
  const authToken = normalizeDashboardAuthToken(options.authToken);
  return {
    canvasToken: randomUUID(),
    webChatToken: randomUUID(),
    canvasStrokes: await loadPersistedCanvasStrokes(canvasStorePath),
    canvasStorePath,
    canvasWriteQueue: Promise.resolve(),
    authToken,
    authSessionToken: authToken ? randomUUID() : undefined
  };
}

export async function startWebDashboard(
  assistant: AssistantRuntime,
  options: WebDashboardOptions
): Promise<WebDashboardHandle> {
  const host = options.host ?? DEFAULT_WEB_DASHBOARD_HOST;
  const port = options.port ?? DEFAULT_WEB_DASHBOARD_PORT;
  const sessionId = options.sessionId;
  const state = options.canvasDir
    ? await createPersistentWebDashboardState(options.canvasDir, { authToken: options.authToken })
    : createWebDashboardState({ authToken: options.authToken });
  const server = createServer((request, response) => {
    void handleWebDashboardRequest(request, response, assistant, sessionId, state, options.genericWebhook).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      sendText(response, request.method, 500, `dashboard error: ${message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    url: serverUrl(server, host),
    server,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

export async function handleWebDashboardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  assistant: AssistantRuntime,
  sessionId: string,
  state: WebDashboardState = createWebDashboardState(),
  genericWebhook?: GenericWebhookConnectorConfig
): Promise<void> {
  const method = request.method ?? "GET";
  setSecurityHeaders(response);
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "POST" && genericWebhook?.inboundEnabled && url.pathname === normalizeGenericWebhookInboundPath(genericWebhook.inboundPath)) {
    await handleGenericWebhookPost(request, response, assistant, genericWebhook);
    return;
  }

  if (url.pathname === "/login") {
    await handleDashboardLogin(request, response, method, state);
    return;
  }

  if (!isDashboardAuthorized(request, state)) {
    sendUnauthorized(response, method, state);
    return;
  }

  if (method === "POST" && url.pathname === "/canvas.json") {
    await handleCanvasPost(request, response, state);
    return;
  }

  if (method === "POST" && url.pathname === "/chat.json") {
    await handleWebChatPost(request, response, assistant, sessionId, state);
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendText(response, method, 405, "Method not allowed");
    return;
  }

  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(response, method, dashboardHtml());
    return;
  }

  if (url.pathname === "/canvas.html" || url.pathname === "/dashboard.canvas.html") {
    sendHtml(response, method, collaborativeCanvasHtml(state.canvasToken, Boolean(state.canvasStorePath)));
    return;
  }

  if (url.pathname === "/voice.html" || url.pathname === "/dashboard.voice.html") {
    sendHtml(response, method, voiceTranscriptHtml());
    return;
  }

  if (url.pathname === "/capture.html" || url.pathname === "/dashboard.capture.html") {
    sendHtml(response, method, mediaCaptureHtml());
    return;
  }

  if (url.pathname === "/chat.html" || url.pathname === "/dashboard.chat.html") {
    if (!isLocalDashboardRequest(request)) {
      sendText(response, method, 403, "WebChat is local-only. Use an SSH tunnel to 127.0.0.1 or the CLI chat surface.");
      return;
    }
    sendHtml(response, method, webChatHtml(state.webChatToken));
    return;
  }

  if (url.pathname === "/canvas.json") {
    sendJson(response, method, JSON.stringify(canvasSnapshot(state), null, 2));
    return;
  }

  if (url.pathname === "/canvas.events") {
    await sendCanvasEvents(request, response, method, state, parseEventIntervalMs(url.searchParams.get("intervalMs")));
    return;
  }

  if (url.pathname === "/dashboard.json") {
    const data = await assistant.dashboardData(sessionId);
    sendJson(response, method, JSON.stringify(data, null, 2));
    return;
  }

  if (url.pathname === "/dashboard.canvas.svg") {
    const data = await assistant.dashboardData(sessionId);
    sendSvg(response, method, dashboardCanvasSvg(data));
    return;
  }

  if (url.pathname === "/dashboard.events") {
    await sendDashboardEvents(request, response, method, assistant, sessionId, parseEventIntervalMs(url.searchParams.get("intervalMs")));
    return;
  }

  if (url.pathname === "/dashboard.schema.json") {
    sendJson(response, method, JSON.stringify(dashboardJsonSchema(), null, 2));
    return;
  }

  if (url.pathname === "/healthz") {
    sendJson(response, method, JSON.stringify({
      ok: true,
      surface: "web-dashboard",
      canvas: state.canvasStorePath ? "persistent-local" : "ephemeral-local"
    }));
    return;
  }

  sendText(response, method, 404, "Not found");
}

function serverUrl(server: Server, requestedHost: string): string {
  const address = server.address();
  if (typeof address === "object" && address) {
    return `http://${urlHost(address.address || requestedHost)}:${address.port}/`;
  }
  return `http://${urlHost(requestedHost)}:${DEFAULT_WEB_DASHBOARD_PORT}/`;
}

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function sendHtml(response: ServerResponse, method: string, body: string): void {
  send(response, method, 200, "text/html; charset=utf-8", body);
}

function sendHtmlStatus(response: ServerResponse, method: string, statusCode: number, body: string): void {
  send(response, method, statusCode, "text/html; charset=utf-8", body);
}

function sendJson(response: ServerResponse, method: string, body: string): void {
  send(response, method, 200, "application/json; charset=utf-8", body);
}

function sendSvg(response: ServerResponse, method: string, body: string): void {
  send(response, method, 200, "image/svg+xml; charset=utf-8", body);
}

function sendText(response: ServerResponse, method: string | undefined, statusCode: number, body: string): void {
  send(response, method ?? "GET", statusCode, "text/plain; charset=utf-8", body);
}

function send(response: ServerResponse, method: string, statusCode: number, contentType: string, body: string): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(method === "HEAD" ? undefined : body);
}

async function handleDashboardLogin(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  state: WebDashboardState
): Promise<void> {
  if (!state.authToken) {
    sendText(response, method, 404, "Dashboard authentication is not enabled.");
    return;
  }

  if (method === "GET" || method === "HEAD") {
    sendHtml(response, method, dashboardLoginHtml());
    return;
  }

  if (method !== "POST") {
    response.setHeader("allow", "GET, HEAD, POST");
    sendText(response, method, 405, "Method not allowed");
    return;
  }

  let body = "";
  try {
    body = await readRequestBody(request, MAX_LOGIN_BODY_BYTES);
  } catch (error) {
    sendText(response, method, 413, error instanceof Error ? error.message : String(error));
    return;
  }

  const submitted = parseDashboardLoginToken(body, requestHeader(request, "content-type"));
  if (!submitted || !safeTokenEquals(submitted, state.authToken)) {
    sendHtmlStatus(response, method, 401, dashboardLoginHtml("Invalid dashboard token."));
    return;
  }

  const sessionToken = state.authSessionToken ?? randomUUID();
  state.authSessionToken = sessionToken;
  response.statusCode = 303;
  response.setHeader("location", "/");
  response.setHeader("cache-control", "no-store");
  response.setHeader("set-cookie", dashboardSessionCookie(sessionToken, request));
  response.setHeader("content-length", "0");
  response.end();
}

function sendUnauthorized(response: ServerResponse, method: string, state: WebDashboardState): void {
  if (!state.authToken) return;
  response.setHeader("www-authenticate", "Bearer realm=\"Viser dashboard\"");
  sendHtmlStatus(response, method, 401, dashboardLoginHtml("Sign in to access the Viser dashboard."));
}

function isDashboardAuthorized(request: IncomingMessage, state: WebDashboardState): boolean {
  if (!state.authToken) return true;
  const authorization = requestHeader(request, "authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
  if (bearer && safeTokenEquals(bearer, state.authToken)) return true;

  const cookieSession = parseCookieHeader(requestHeader(request, "cookie"))[DASHBOARD_SESSION_COOKIE];
  return Boolean(cookieSession && state.authSessionToken && safeTokenEquals(cookieSession, state.authSessionToken));
}

function parseDashboardLoginToken(body: string, contentType: string | undefined): string | undefined {
  const normalized = String(contentType ?? "").toLowerCase();
  if (normalized.includes("application/json")) {
    try {
      const parsed = JSON.parse(body) as unknown;
      const record = asRecord(parsed);
      return typeof record?.token === "string" ? record.token : undefined;
    } catch {
      return undefined;
    }
  }
  const params = new URLSearchParams(body);
  return params.get("token") ?? undefined;
}

function dashboardSessionCookie(sessionToken: string, request: IncomingMessage): string {
  const secure = String(requestHeader(request, "x-forwarded-proto") ?? "").toLowerCase() === "https" ? "; Secure" : "";
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`;
}

function parseCookieHeader(value: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of String(value ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyGenericWebhookInboundSignature(config: GenericWebhookConnectorConfig, body: string, request: IncomingMessage): string | undefined {
  const secret = typeof config.inboundSignatureSecret === "string" ? config.inboundSignatureSecret.trim() : "";
  if (!secret) return undefined;

  const signature = normalizeWebhookSignature(requestHeader(request, "x-viser-webhook-signature"));
  const timestamp = normalizeWebhookSignatureTimestamp(requestHeader(request, "x-viser-webhook-timestamp"));
  if (!signature || timestamp === undefined) return "Forbidden";

  const toleranceMs = Math.max(1, config.inboundSignatureToleranceMs ?? 300_000);
  if (Math.abs(Date.now() - timestamp.timeMs) > toleranceMs) return "Forbidden";

  const expected = createHmac("sha256", secret).update(`${timestamp.raw}.${body}`).digest("hex");
  return safeTokenEquals(signature, expected) ? undefined : "Forbidden";
}

function normalizeWebhookSignature(value: string | undefined): string | undefined {
  const signature = (value ?? "").trim().toLowerCase().replace(/^sha256=/u, "");
  return /^[a-f0-9]{64}$/u.test(signature) ? signature : undefined;
}

function normalizeWebhookSignatureTimestamp(value: string | undefined): { raw: string; timeMs: number } | undefined {
  const raw = (value ?? "").trim();
  if (!/^\d{10,13}$/u.test(raw)) return undefined;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return undefined;
  return { raw, timeMs: raw.length <= 10 ? parsed * 1000 : parsed };
}

function normalizeDashboardAuthToken(value: string | undefined): string | undefined {
  const token = typeof value === "string" ? value.trim() : "";
  return token || undefined;
}

async function sendDashboardEvents(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  assistant: AssistantRuntime,
  sessionId: string,
  intervalMs: number
): Promise<void> {
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("connection", "keep-alive");
  response.setHeader("x-accel-buffering", "no");
  if (method === "HEAD") {
    response.end();
    return;
  }

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    closed = true;
    if (timer) clearInterval(timer);
  };
  request.once("close", close);
  response.once("close", close);
  response.flushHeaders?.();

  const writeSnapshot = async (): Promise<void> => {
    if (closed || response.destroyed) return;
    const data = await assistant.dashboardData(sessionId);
    response.write(`event: dashboard\ndata: ${JSON.stringify(data)}\n\n`);
  };

  await writeSnapshot();
  if (closed || response.destroyed) return;
  timer = setInterval(() => {
    void writeSnapshot().catch((error) => {
      if (!closed && !response.destroyed) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : String(error) })}\n\n`);
      }
    });
  }, intervalMs);
  timer.unref();
}

async function sendCanvasEvents(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  state: WebDashboardState,
  intervalMs: number
): Promise<void> {
  response.statusCode = 200;
  response.setHeader("content-type", "text/event-stream; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.setHeader("connection", "keep-alive");
  response.setHeader("x-accel-buffering", "no");
  if (method === "HEAD") {
    response.end();
    return;
  }

  let closed = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    closed = true;
    if (timer) clearInterval(timer);
  };
  request.once("close", close);
  response.once("close", close);
  response.flushHeaders?.();

  const writeSnapshot = (): void => {
    if (closed || response.destroyed) return;
    response.write(`event: canvas\ndata: ${JSON.stringify(canvasSnapshot(state))}\n\n`);
  };

  writeSnapshot();
  if (closed || response.destroyed) return;
  timer = setInterval(writeSnapshot, intervalMs);
  timer.unref();
}

async function handleCanvasPost(
  request: IncomingMessage,
  response: ServerResponse,
  state: WebDashboardState
): Promise<void> {
  if (requestHeader(request, "x-viser-canvas-token") !== state.canvasToken) {
    sendText(response, "POST", 403, "Forbidden");
    return;
  }

  if (!String(requestHeader(request, "content-type") ?? "").toLowerCase().includes("application/json")) {
    sendText(response, "POST", 415, "Expected application/json");
    return;
  }

  let body = "";
  try {
    body = await readRequestBody(request, MAX_CANVAS_BODY_BYTES);
  } catch (error) {
    sendText(response, "POST", 413, error instanceof Error ? error.message : String(error));
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendText(response, "POST", 400, "Invalid JSON");
    return;
  }

  try {
    const patch = normalizeCanvasPatch(parsed);
    await commitCanvasPatch(state, patch);
    sendJson(response, "POST", JSON.stringify(canvasSnapshot(state), null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendText(response, "POST", message.startsWith("Canvas store") ? 500 : 400, message);
  }
}

async function handleWebChatPost(
  request: IncomingMessage,
  response: ServerResponse,
  assistant: AssistantRuntime,
  sessionId: string,
  state: WebDashboardState
): Promise<void> {
  if (!isLocalDashboardRequest(request)) {
    sendText(response, "POST", 403, "WebChat is local-only. Use an SSH tunnel to 127.0.0.1 or the CLI chat surface.");
    return;
  }

  if (requestHeader(request, "x-viser-web-chat-token") !== state.webChatToken) {
    sendText(response, "POST", 403, "Forbidden");
    return;
  }

  if (!String(requestHeader(request, "content-type") ?? "").toLowerCase().includes("application/json")) {
    sendText(response, "POST", 415, "Expected application/json");
    return;
  }

  let body = "";
  try {
    body = await readRequestBody(request, MAX_WEB_CHAT_BODY_BYTES);
  } catch (error) {
    sendText(response, "POST", 413, error instanceof Error ? error.message : String(error));
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendText(response, "POST", 400, "Invalid JSON");
    return;
  }

  try {
    const message = normalizeWebChatMessage(asRecord(parsed)?.message);
    const providerId = normalizeOptionalWebChatProvider(asRecord(parsed)?.providerId);
    const reply = await assistant.handle(message, sessionId, {
      source: "web-chat",
      providerId
    });
    sendJson(response, "POST", JSON.stringify({
      ok: true,
      sessionId,
      providerId: providerId ?? null,
      reply
    }, null, 2));
  } catch (error) {
    sendText(response, "POST", 400, `WebChat request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function handleGenericWebhookPost(
  request: IncomingMessage,
  response: ServerResponse,
  assistant: AssistantRuntime,
  config: GenericWebhookConnectorConfig
): Promise<void> {
  let token: string;
  try {
    token = normalizeGenericWebhookInboundToken(config.inboundToken);
  } catch (error) {
    sendText(response, "POST", 503, "Generic inbound webhook token is not configured.");
    return;
  }

  const submitted = requestHeader(request, "x-viser-webhook-token")
    ?? requestHeader(request, "authorization")?.match(/^Bearer\s+(.+)$/iu)?.[1]?.trim();
  if (!submitted || !safeTokenEquals(submitted, token)) {
    sendText(response, "POST", 403, "Forbidden");
    return;
  }

  if (!String(requestHeader(request, "content-type") ?? "").toLowerCase().includes("application/json")) {
    sendText(response, "POST", 415, "Expected application/json");
    return;
  }

  let body = "";
  try {
    body = await readRequestBody(request, genericWebhookInboundBodyLimitBytes(config));
  } catch (error) {
    sendText(response, "POST", 413, error instanceof Error ? error.message : String(error));
    return;
  }

  const signatureError = verifyGenericWebhookInboundSignature(config, body, request);
  if (signatureError) {
    sendText(response, "POST", 403, signatureError);
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendText(response, "POST", 400, "Invalid JSON");
    return;
  }

  try {
    const result = await handleGenericWebhookInbound(config, parsed, assistant);
    sendJson(response, "POST", JSON.stringify({
      ok: true,
      source: "webhook",
      sessionId: result.sessionId,
      sourceId: result.sourceId,
      attachmentCount: result.attachmentCount,
      reply: result.reply
    }, null, 2));
  } catch (error) {
    const message = redactGenericWebhookDetail(error instanceof Error ? error.message : String(error), config);
    sendText(response, "POST", 400, `Generic webhook request failed: ${message}`);
  }
}

async function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function requestHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isLocalDashboardRequest(request: IncomingMessage): boolean {
  const remoteAddress = request.socket?.remoteAddress;
  if (!remoteAddress) return true;
  return remoteAddress === "127.0.0.1"
    || remoteAddress === "::1"
    || remoteAddress === "::ffff:127.0.0.1"
    || remoteAddress === "localhost";
}

function normalizeWebChatMessage(value: unknown): string {
  const text = typeof value === "string" ? value.replace(/\r\n?/gu, "\n").trim() : "";
  if (!text) throw new Error("message is required");
  if (text.length > MAX_WEB_CHAT_MESSAGE_CHARS) throw new Error(`message is too long (${text.length} > ${MAX_WEB_CHAT_MESSAGE_CHARS})`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error("message contains control characters");
  return text;
}

function normalizeOptionalWebChatProvider(value: unknown): string | undefined {
  const providerId = typeof value === "string" ? value.trim() : "";
  if (!providerId) return undefined;
  if (!/^[a-z0-9._-]{1,80}$/iu.test(providerId)) throw new Error("providerId must be a safe provider id");
  return providerId;
}

type CanvasPatch = { action: "clear" } | { action: "stroke"; stroke: CanvasStroke };

async function commitCanvasPatch(state: WebDashboardState, patch: CanvasPatch): Promise<void> {
  const previous = state.canvasWriteQueue ?? Promise.resolve();
  const commit = previous.catch(() => undefined).then(async () => {
    const before = state.canvasStrokes;
    state.canvasStrokes = applyCanvasPatch(before, patch);
    try {
      await persistCanvasState(state);
    } catch (error) {
      state.canvasStrokes = before;
      throw error;
    }
  });
  state.canvasWriteQueue = commit.catch(() => undefined);
  await commit;
}

function applyCanvasPatch(strokes: CanvasStroke[], patch: CanvasPatch): CanvasStroke[] {
  if (patch.action === "clear") return [];
  return [...strokes, patch.stroke].slice(-MAX_CANVAS_STROKES);
}

async function persistCanvasState(state: WebDashboardState): Promise<void> {
  if (!state.canvasStorePath) return;
  try {
    await writePrivateFile(state.canvasStorePath, `${JSON.stringify({
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      strokes: state.canvasStrokes,
      limits: {
        maxStrokes: MAX_CANVAS_STROKES,
        maxPointsPerStroke: MAX_CANVAS_POINTS
      }
    }, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Canvas store write failed: ${message}`);
  }
}

async function loadPersistedCanvasStrokes(canvasStorePath: string): Promise<CanvasStroke[]> {
  const raw = await readPrivateFileIfExists(canvasStorePath);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Canvas store JSON is invalid: ${message}`);
  }

  const record = asRecord(parsed);
  const strokesRaw = Array.isArray(record?.strokes)
    ? record.strokes
    : Array.isArray(parsed)
      ? parsed
      : undefined;
  if (!strokesRaw) throw new Error("Canvas store must contain a strokes array.");

  return strokesRaw
    .map(normalizeStoredCanvasStroke)
    .filter((stroke): stroke is CanvasStroke => Boolean(stroke))
    .slice(-MAX_CANVAS_STROKES);
}

function normalizeStoredCanvasStroke(value: unknown): CanvasStroke | undefined {
  const input = asRecord(value);
  const pointsRaw = Array.isArray(input?.points) ? input.points : [];
  if (!input || pointsRaw.length < 2) return undefined;

  try {
    return {
      id: normalizeCanvasId(input.id),
      by: normalizeCanvasUser(input.by),
      color: normalizeCanvasColor(input.color),
      width: normalizeCanvasWidth(input.width),
      points: pointsRaw.slice(0, MAX_CANVAS_POINTS).map(normalizeCanvasPoint),
      createdAt: normalizeCanvasTimestamp(input.createdAt)
    };
  } catch {
    return undefined;
  }
}

function normalizeCanvasId(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/[^a-z0-9_-]/giu, "").slice(0, 48) : "";
  return normalized || randomUUID().slice(0, 12);
}

function normalizeCanvasPatch(value: unknown): CanvasPatch {
  const input = asRecord(value);
  if (!input) throw new Error("Canvas patch must be an object.");
  if (input.action === "clear") return { action: "clear" };

  const pointsRaw = Array.isArray(input.points) ? input.points : [];
  if (pointsRaw.length < 2) throw new Error("Canvas stroke requires at least two points.");
  if (pointsRaw.length > MAX_CANVAS_POINTS) throw new Error(`Canvas stroke has too many points (${pointsRaw.length} > ${MAX_CANVAS_POINTS}).`);

  return {
    action: "stroke",
    stroke: {
      id: randomUUID().slice(0, 12),
      by: normalizeCanvasUser(input.by),
      color: normalizeCanvasColor(input.color),
      width: normalizeCanvasWidth(input.width),
      points: pointsRaw.map(normalizeCanvasPoint),
      createdAt: new Date().toISOString()
    }
  };
}

function normalizeCanvasPoint(value: unknown): CanvasPoint {
  const point = asRecord(value);
  const x = typeof point?.x === "number" ? point.x : Number.NaN;
  const y = typeof point?.y === "number" ? point.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Canvas point coordinates must be numbers.");
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y))
  };
}

function normalizeCanvasUser(value: unknown): string {
  const normalized = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  if (!normalized) return "operator";
  return normalized.slice(0, 32);
}

function normalizeCanvasColor(value: unknown): string {
  const color = typeof value === "string" ? value.trim() : "";
  return /^#[0-9a-f]{6}$/iu.test(color) ? color.toLowerCase() : "#60a5fa";
}

function normalizeCanvasWidth(value: unknown): number {
  const width = typeof value === "number" ? value : 3;
  if (!Number.isFinite(width)) return 3;
  return Math.max(1, Math.min(16, Math.round(width)));
}

function normalizeCanvasTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function canvasSnapshot(state: WebDashboardState): CanvasSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    strokes: state.canvasStrokes,
    persistence: {
      enabled: Boolean(state.canvasStorePath),
      store: state.canvasStorePath ? "private-local-json" : "memory"
    },
    limits: {
      maxStrokes: MAX_CANVAS_STROKES,
      maxPointsPerStroke: MAX_CANVAS_POINTS
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseEventIntervalMs(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_EVENT_INTERVAL_MS;
  if (!Number.isFinite(parsed)) return DEFAULT_EVENT_INTERVAL_MS;
  return Math.min(MAX_EVENT_INTERVAL_MS, Math.max(MIN_EVENT_INTERVAL_MS, parsed));
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  );
}

function dashboardLoginHtml(error = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser Dashboard Login</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at top left, #172554 0, transparent 32rem), #0c111d; }
    main { width: min(440px, calc(100vw - 32px)); background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.22); border-radius: 22px; padding: 24px; box-shadow: 0 20px 45px rgba(0,0,0,.28); }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: -0.03em; }
    p { color: #9fb0c6; }
    label { display: grid; gap: 8px; color: #cbd5e1; }
    input { color: #e6edf7; background: #020617; border: 1px solid #39506f; border-radius: 14px; padding: 12px; font: inherit; }
    button { margin-top: 14px; width: 100%; border: 1px solid #60a5fa; color: #e6edf7; background: #1d4ed8; border-radius: 999px; padding: 11px 14px; cursor: pointer; font: inherit; }
    .error { color: #fb7185; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Viser Dashboard</h1>
    <p>Enter the configured local dashboard token. The token is checked locally and stored only as an HttpOnly session cookie for this browser.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
    <form method="post" action="/login">
      <label>
        <span class="mono">VISER_DASHBOARD_TOKEN</span>
        <input name="token" type="password" autocomplete="current-password" required autofocus>
      </label>
      <button type="submit">Open dashboard</button>
    </form>
  </main>
</body>
</html>`;
}

function dashboardJsonSchema(): Record<string, unknown> {
  return {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://viser.local/schemas/dashboard.v1.json",
    title: "Viser DashboardData",
    type: "object",
    additionalProperties: true,
    required: [
      "schemaVersion",
      "assistantName",
      "generatedAt",
      "sessionId",
      "provider",
      "fallbackRoute",
      "runtime",
      "state",
      "providers",
      "capabilities",
      "nextCommands"
    ],
    properties: {
      schemaVersion: { const: DASHBOARD_SCHEMA_VERSION },
      assistantName: { type: "string" },
      generatedAt: { type: "string", format: "date-time" },
      sessionId: { type: "string" },
      provider: { type: "string" },
      fallbackRoute: { type: "array", items: { type: "string" } },
      configPath: { anyOf: [{ type: "string" }, { type: "null" }] },
      storageDir: { type: "string" },
      runtime: {
        type: "object",
        required: ["scheduler", "jobWorker", "webDashboard", "tools", "actions", "connectors"],
        additionalProperties: true
      },
      state: {
        type: "object",
        required: ["currentSessionHistory", "savedSessions", "memories", "skills", "plugins", "schedules", "jobs", "pendingApprovals", "operatorActivity"],
        additionalProperties: true
      },
      providers: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "label", "command", "installed", "launchRoute"],
          additionalProperties: true
        }
      },
      capabilities: {
        type: "object",
        required: ["readOnly", "providerCalls", "writeActions", "jobExecution", "liveProviderProof"],
        properties: {
          readOnly: { const: true },
          providerCalls: { const: false },
          writeActions: { const: false },
          jobExecution: { const: false },
          liveProviderProof: { const: false }
        },
        additionalProperties: false
      },
      nextCommands: { type: "array", items: { type: "string" } }
    }
  };
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #172554 0, transparent 32rem), #0c111d; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px 48px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: start; margin-bottom: 24px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 44px); letter-spacing: -0.04em; }
    p { color: #9fb0c6; }
    button, a.button { border: 1px solid #39506f; color: #e6edf7; background: #162238; border-radius: 999px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: #60a5fa; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .card { background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 18px; box-shadow: 0 20px 45px rgba(0,0,0,.22); }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 24px; font-weight: 720; }
    .ok { color: #86efac; }
    .warn { color: #facc15; }
    .bad { color: #fb7185; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; word-break: break-all; }
    ul { margin: 10px 0 0; padding-left: 18px; color: #cbd5e1; }
    .activity-list { list-style: none; padding: 0; display: grid; gap: 10px; }
    .activity-list li { border: 1px solid rgba(148,163,184,.16); border-radius: 14px; padding: 12px; background: rgba(2,6,23,.38); }
    .activity-head { display: flex; gap: 10px; justify-content: space-between; align-items: center; color: #e6edf7; font-weight: 680; }
    .activity-detail { margin-top: 6px; color: #9fb0c6; }
    .pill { border-radius: 999px; padding: 3px 8px; border: 1px solid rgba(148,163,184,.22); font: 12px ui-monospace, monospace; }
    .pill.ok { color: #86efac; }
    .pill.warn { color: #facc15; }
    .pill.bad { color: #fb7185; }
    .pill.info { color: #60a5fa; }
    pre { overflow: auto; background: #020617; border: 1px solid rgba(148,163,184,.18); border-radius: 14px; padding: 14px; }
    canvas { display: block; width: 100%; min-height: 260px; border-radius: 14px; background: #020617; border: 1px solid rgba(148,163,184,.18); }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser Dashboard</h1>
        <p>Read-only localhost status. The collaborative canvas only updates token-protected local board state; the separate WebChat page is local-only and token-protected before it can call a provider.</p>
      </div>
      <div>
        <button id="refresh">Refresh</button>
        <a class="button" href="/dashboard.json">JSON</a>
        <a class="button" href="/dashboard.canvas.svg">SVG Canvas</a>
        <a class="button" href="/canvas.html">Collaborative Canvas</a>
        <a class="button" href="/chat.html">WebChat</a>
        <a class="button" href="/voice.html">Voice Capture</a>
        <a class="button" href="/capture.html">Camera/Screen Capture</a>
        <a class="button" href="/dashboard.schema.json">Schema</a>
      </div>
    </header>
    <section class="card" style="margin-bottom:14px">
      <div class="label">Live stream</div>
      <div id="live" class="value warn">connecting</div>
      <p>Uses local <span class="mono">/dashboard.events</span> server-sent events. Still read-only: no provider calls, no writes, no job execution.</p>
    </section>
    <section class="card" style="margin-bottom:14px">
      <div class="label">Read-only canvas overview</div>
      <canvas id="overview" width="1000" height="320" aria-label="Dashboard status canvas"></canvas>
      <p>Canvas view is rendered from the same local snapshot. It does not expose edits, provider calls, or action execution.</p>
    </section>
    <section class="grid" id="cards" aria-live="polite"></section>
    <section class="card" style="margin-top:14px">
      <div class="label">Operator activity stream</div>
      <ul id="activity" class="activity-list" aria-live="polite"></ul>
      <p>Recent approvals, jobs, scheduled work, and sessions are streamed from the local snapshot. Command hints are shown, but this page still cannot execute them.</p>
    </section>
    <section class="card" style="margin-top:14px">
      <div class="label">Next commands</div>
      <ul id="commands"></ul>
    </section>
    <section class="card" style="margin-top:14px">
      <div class="label">Raw snapshot</div>
      <pre id="raw">{}</pre>
    </section>
  </main>
  <script>
    const cards = document.getElementById('cards');
    const commands = document.getElementById('commands');
    const activity = document.getElementById('activity');
    const raw = document.getElementById('raw');
    const refresh = document.getElementById('refresh');
    const live = document.getElementById('live');
    const overview = document.getElementById('overview');

    function card(label, value, tone = '') {
      const element = document.createElement('article');
      element.className = 'card';
      const labelElement = document.createElement('div');
      labelElement.className = 'label';
      labelElement.textContent = label;
      const valueElement = document.createElement('div');
      valueElement.className = 'value ' + tone;
      valueElement.textContent = value;
      element.append(labelElement, valueElement);
      return element;
    }

    async function loadDashboard() {
      const response = await fetch('/dashboard.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('dashboard.json failed: ' + response.status);
      const data = await response.json();
      renderDashboard(data);
    }

    function renderDashboard(data) {
      const jobs = data.state.jobs;
      const schedules = data.state.schedules;
      cards.replaceChildren(
        card('Provider', data.provider, 'ok'),
        card('Jobs', 'pending ' + jobs.pending + ' · failed ' + jobs.failed, jobs.failed ? 'bad' : 'ok'),
        card('Schedules', schedules.enabledCount + ' enabled / ' + schedules.total + ' total', 'ok'),
        card('Approvals', String(data.state.pendingApprovals.count), data.state.pendingApprovals.count ? 'warn' : 'ok'),
        card('Activity', String((data.state.operatorActivity && data.state.operatorActivity.count) || 0), (data.state.operatorActivity && data.state.operatorActivity.items && data.state.operatorActivity.items.some((item) => item.tone === 'bad')) ? 'bad' : 'ok'),
        card('Memories', String(data.state.memories.count), 'ok'),
        card('Skills', String(data.state.skills.count), 'ok'),
        card('Plugins', String(data.state.plugins.count), 'ok'),
        card('Job worker', data.runtime.jobWorker.enabled ? 'parallelism ' + data.runtime.jobWorker.concurrency : 'disabled', data.runtime.jobWorker.enabled ? 'ok' : 'warn'),
        card('Providers', data.providers.map((provider) => provider.id + ':' + (provider.installed ? 'ok' : 'missing')).join(' · '), data.providers.some((provider) => provider.launchRoute && !provider.installed) ? 'bad' : 'ok')
      );
      commands.replaceChildren(...data.nextCommands.map((command) => {
        const item = document.createElement('li');
        item.textContent = command.replace(/^- /, '');
        return item;
      }));
      renderActivity(data);
      raw.textContent = JSON.stringify(data, null, 2);
      drawOverview(data);
    }

    function renderActivity(data) {
      const items = (data.state.operatorActivity && data.state.operatorActivity.items) || [];
      if (!items.length) {
        const item = document.createElement('li');
        item.textContent = 'No recent local activity.';
        activity.replaceChildren(item);
        return;
      }

      activity.replaceChildren(...items.map((entry) => {
        const item = document.createElement('li');
        const head = document.createElement('div');
        head.className = 'activity-head';
        const title = document.createElement('span');
        title.textContent = entry.title;
        const pill = document.createElement('span');
        pill.className = 'pill ' + (entry.tone || 'info');
        pill.textContent = entry.kind + ' · ' + entry.status;
        head.append(title, pill);
        const detail = document.createElement('div');
        detail.className = 'activity-detail mono';
        detail.textContent = entry.detail + (entry.at ? ' · ' + entry.at : '');
        item.append(head, detail);
        if (entry.command) {
          const command = document.createElement('div');
          command.className = 'activity-detail mono';
          command.textContent = entry.command;
          item.append(command);
        }
        return item;
      }));
    }

    function drawOverview(data) {
      if (!overview || !overview.getContext) return;
      const context = overview.getContext('2d');
      if (!context) return;
      const rect = overview.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(720, Math.floor((rect.width || 1000) * ratio));
      const height = 320 * ratio;
      if (overview.width !== width || overview.height !== height) {
        overview.width = width;
        overview.height = height;
      }
      context.clearRect(0, 0, width, height);
      context.save();
      context.scale(ratio, ratio);
      const w = width / ratio;
      const h = height / ratio;
      const gradient = context.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(1, '#172554');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
      drawNode(context, 70, 70, 'Provider', data.provider, '#86efac');
      drawNode(context, w - 250, 70, 'Approvals', String(data.state.pendingApprovals.count), data.state.pendingApprovals.count ? '#facc15' : '#86efac');
      drawNode(context, 70, h - 120, 'Jobs', 'pending ' + data.state.jobs.pending + ' / failed ' + data.state.jobs.failed, data.state.jobs.failed ? '#fb7185' : '#86efac');
      drawNode(context, w - 250, h - 120, 'Activity', ((data.state.operatorActivity && data.state.operatorActivity.count) || 0) + ' events', '#60a5fa');
      drawHub(context, w / 2, h / 2, data.runtime.webDashboard.enabled ? 'Live local dashboard' : 'Dashboard disabled');
      drawLine(context, 250, 112, w / 2 - 90, h / 2);
      drawLine(context, w - 250, 112, w / 2 + 90, h / 2);
      drawLine(context, 250, h - 78, w / 2 - 90, h / 2 + 28);
      drawLine(context, w - 250, h - 78, w / 2 + 90, h / 2 + 28);
      context.restore();
    }

    function drawLine(context, fromX, fromY, toX, toY) {
      context.strokeStyle = 'rgba(96, 165, 250, 0.36)';
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(toX, toY);
      context.stroke();
    }

    function drawNode(context, x, y, label, value, color) {
      context.fillStyle = 'rgba(15, 23, 42, 0.92)';
      context.strokeStyle = 'rgba(148, 163, 184, 0.28)';
      context.lineWidth = 1;
      roundedRect(context, x, y, 180, 84, 18);
      context.fill();
      context.stroke();
      context.fillStyle = '#94a3b8';
      context.font = '12px ui-monospace, monospace';
      context.fillText(label.toUpperCase(), x + 18, y + 28);
      context.fillStyle = color;
      context.font = '18px ui-sans-serif, system-ui, sans-serif';
      context.fillText(value, x + 18, y + 58, 144);
    }

    function drawHub(context, x, y, label) {
      context.fillStyle = 'rgba(37, 99, 235, 0.24)';
      context.strokeStyle = '#60a5fa';
      context.lineWidth = 2;
      roundedRect(context, x - 128, y - 44, 256, 88, 24);
      context.fill();
      context.stroke();
      context.fillStyle = '#e6edf7';
      context.font = '20px ui-sans-serif, system-ui, sans-serif';
      context.textAlign = 'center';
      context.fillText(label, x, y + 6, 220);
      context.textAlign = 'start';
    }

    function roundedRect(context, x, y, width, height, radius) {
      context.beginPath();
      context.moveTo(x + radius, y);
      context.arcTo(x + width, y, x + width, y + height, radius);
      context.arcTo(x + width, y + height, x, y + height, radius);
      context.arcTo(x, y + height, x, y, radius);
      context.arcTo(x, y, x + width, y, radius);
      context.closePath();
    }

    refresh.addEventListener('click', () => loadDashboard().catch((error) => {
      cards.replaceChildren(card('Dashboard error', error.message, 'bad'));
    }));
    loadDashboard().catch((error) => cards.replaceChildren(card('Dashboard error', error.message, 'bad')));
    if ('EventSource' in window) {
      const events = new EventSource('/dashboard.events');
      events.addEventListener('dashboard', (event) => {
        live.textContent = 'connected · ' + new Date().toLocaleTimeString();
        live.className = 'value ok';
        renderDashboard(JSON.parse(event.data));
      });
      events.addEventListener('error', () => {
        live.textContent = 'reconnecting';
        live.className = 'value warn';
      });
    } else {
      live.textContent = 'unsupported';
      live.className = 'value warn';
    }
  </script>
</body>
</html>`;
}

function collaborativeCanvasHtml(token: string, persistent: boolean): string {
  const persistenceCopy = persistent
    ? "Persistent localhost board shared across open dashboard tabs and restarts. It stores only normalized strokes in a private local JSON file and never calls providers, jobs, or approval actions."
    : "Ephemeral localhost board shared across open dashboard tabs. It stores only normalized strokes in memory and never calls providers, jobs, or approval actions.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser Collaborative Canvas</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top right, #1e3a8a 0, transparent 28rem), #0c111d; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: start; margin-bottom: 16px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.04em; }
    p { color: #9fb0c6; }
    a, button, input { font: inherit; }
    a.button, button { border: 1px solid #39506f; color: #e6edf7; background: #162238; border-radius: 999px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: #60a5fa; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 14px 0; }
    input[type="text"] { color: #e6edf7; background: #020617; border: 1px solid #39506f; border-radius: 999px; padding: 10px 12px; }
    input[type="color"] { width: 44px; height: 38px; border: 1px solid #39506f; border-radius: 12px; background: #020617; }
    input[type="range"] { accent-color: #60a5fa; }
    .card { background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 18px; box-shadow: 0 20px 45px rgba(0,0,0,.22); }
    canvas { display: block; width: 100%; min-height: 560px; border-radius: 14px; background: #020617; border: 1px solid rgba(148,163,184,.18); touch-action: none; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; }
    .ok { color: #86efac; }
    .warn { color: #facc15; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser Collaborative Canvas</h1>
        <p>${escapeHtml(persistenceCopy)}</p>
      </div>
      <div>
        <a class="button" href="/">Dashboard</a>
        <a class="button" href="/canvas.json">Canvas JSON</a>
      </div>
    </header>
    <section class="card">
      <div class="toolbar">
        <input id="name" type="text" value="operator" maxlength="32" aria-label="Canvas user name">
        <input id="color" type="color" value="#60a5fa" aria-label="Stroke color">
        <input id="width" type="range" min="1" max="16" value="4" aria-label="Stroke width">
        <button id="clear">Clear board</button>
        <span id="status" class="mono warn">connecting</span>
      </div>
      <canvas id="board" width="1200" height="720" aria-label="Shared Viser canvas board"></canvas>
      <p class="mono">POSTs require a same-origin <code>x-viser-canvas-token</code> header, so other websites cannot blindly write through a browser preflight.</p>
    </section>
  </main>
  <script>
    const CANVAS_TOKEN = ${JSON.stringify(token)};
    const board = document.getElementById('board');
    const status = document.getElementById('status');
    const nameInput = document.getElementById('name');
    const colorInput = document.getElementById('color');
    const widthInput = document.getElementById('width');
    const clearButton = document.getElementById('clear');
    const context = board.getContext('2d');
    let strokes = [];
    let drawing = false;
    let current = [];

    function resizeCanvas() {
      const rect = board.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(720, Math.floor((rect.width || 1000) * ratio));
      const height = Math.max(520, Math.floor((rect.height || 560) * ratio));
      if (board.width !== width || board.height !== height) {
        board.width = width;
        board.height = height;
        drawAll();
      }
    }

    function normalizedPoint(event) {
      const rect = board.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      };
    }

    function drawAll() {
      if (!context) return;
      context.clearRect(0, 0, board.width, board.height);
      context.fillStyle = '#020617';
      context.fillRect(0, 0, board.width, board.height);
      for (const stroke of strokes) drawStroke(stroke);
      if (current.length > 1) drawStroke({ color: colorInput.value, width: Number(widthInput.value), points: current });
    }

    function drawStroke(stroke) {
      if (!context || stroke.points.length < 2) return;
      context.save();
      context.strokeStyle = stroke.color || '#60a5fa';
      context.lineWidth = Math.max(1, Number(stroke.width || 3)) * (window.devicePixelRatio || 1);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * board.width;
        const y = point.y * board.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.stroke();
      context.restore();
    }

    async function postCanvas(payload) {
      const response = await fetch('/canvas.json', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-viser-canvas-token': CANVAS_TOKEN },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('canvas update failed: ' + response.status);
      applySnapshot(await response.json());
    }

    function applySnapshot(snapshot) {
      strokes = Array.isArray(snapshot.strokes) ? snapshot.strokes : [];
      const persistence = snapshot.persistence && snapshot.persistence.enabled ? 'persistent' : 'memory';
      status.textContent = 'connected · ' + persistence + ' · strokes ' + strokes.length;
      status.className = 'mono ok';
      drawAll();
    }

    board.addEventListener('pointerdown', (event) => {
      drawing = true;
      current = [normalizedPoint(event)];
      board.setPointerCapture?.(event.pointerId);
      drawAll();
    });
    board.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      current.push(normalizedPoint(event));
      if (current.length > 160) current = current.slice(-160);
      drawAll();
    });
    board.addEventListener('pointerup', async (event) => {
      if (!drawing) return;
      drawing = false;
      current.push(normalizedPoint(event));
      const points = current;
      current = [];
      if (points.length >= 2) {
        await postCanvas({ by: nameInput.value, color: colorInput.value, width: Number(widthInput.value), points }).catch((error) => {
          status.textContent = error.message;
          status.className = 'mono warn';
        });
      }
      drawAll();
    });
    clearButton.addEventListener('click', () => postCanvas({ action: 'clear' }).catch((error) => {
      status.textContent = error.message;
      status.className = 'mono warn';
    }));
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    fetch('/canvas.json', { cache: 'no-store' }).then((response) => response.json()).then(applySnapshot).catch(() => undefined);
    if ('EventSource' in window) {
      const events = new EventSource('/canvas.events');
      events.addEventListener('canvas', (event) => applySnapshot(JSON.parse(event.data)));
      events.addEventListener('error', () => {
        status.textContent = 'reconnecting';
        status.className = 'mono warn';
      });
    }
  </script>
</body>
</html>`;
}

function webChatHtml(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser WebChat</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top right, #1e3a8a 0, transparent 28rem), #0c111d; }
    main { max-width: 980px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: start; margin-bottom: 16px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.04em; }
    p { color: #9fb0c6; line-height: 1.55; }
    a, button, textarea, input { font: inherit; }
    a.button, button { border: 1px solid #39506f; color: #e6edf7; background: #162238; border-radius: 999px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: #60a5fa; }
    button[disabled] { opacity: .5; cursor: not-allowed; }
    input, textarea { box-sizing: border-box; width: 100%; color: #e6edf7; background: #020617; border: 1px solid rgba(148,163,184,.22); border-radius: 14px; padding: 12px; }
    textarea { min-height: 160px; resize: vertical; }
    .card { background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 18px; box-shadow: 0 20px 45px rgba(0,0,0,.22); margin-top: 14px; }
    .toolbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; margin-top: 12px; }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; word-break: break-word; }
    .ok { color: #86efac; }
    .warn { color: #facc15; }
    .bad { color: #fb7185; }
    #messages { display: grid; gap: 12px; margin-top: 14px; }
    .message { border: 1px solid rgba(148,163,184,.16); border-radius: 14px; padding: 12px; background: rgba(2,6,23,.38); white-space: pre-wrap; }
    .from { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser WebChat</h1>
        <p>Local browser chat for the same <code>AssistantRuntime</code> used by CLI and messaging channels. This route calls the selected local provider, but only from localhost and only with a same-origin <code>x-viser-web-chat-token</code>.</p>
      </div>
      <div>
        <a class="button" href="/">Dashboard</a>
        <a class="button" href="/dashboard.json">JSON</a>
      </div>
    </header>
    <section class="card">
      <div class="label">Provider override (optional)</div>
      <input id="provider" type="text" placeholder="codex, gemini, claude, echo..." autocomplete="off">
      <div class="label" style="margin-top:14px">Message</div>
      <textarea id="message" maxlength="${MAX_WEB_CHAT_MESSAGE_CHARS}" placeholder="Ask Viser from your local browser..."></textarea>
      <div class="toolbar">
        <div id="status" class="mono warn">ready · localhost only</div>
        <button id="send">Send</button>
      </div>
      <p class="mono">Limits: ${MAX_WEB_CHAT_MESSAGE_CHARS} characters, JSON only, local requests only. Use the CLI or approved connector-message actions for remote operation.</p>
    </section>
    <section class="card">
      <div class="label">Conversation</div>
      <div id="messages"></div>
    </section>
  </main>
  <script>
    const WEB_CHAT_TOKEN = ${JSON.stringify(token)};
    const messageInput = document.getElementById('message');
    const providerInput = document.getElementById('provider');
    const sendButton = document.getElementById('send');
    const status = document.getElementById('status');
    const messages = document.getElementById('messages');

    function addMessage(from, text) {
      const wrapper = document.createElement('article');
      wrapper.className = 'message';
      const label = document.createElement('div');
      label.className = 'from';
      label.textContent = from;
      const body = document.createElement('div');
      body.textContent = text;
      wrapper.append(label, body);
      messages.prepend(wrapper);
    }

    async function sendMessage() {
      const message = messageInput.value.trim();
      const providerId = providerInput.value.trim();
      if (!message) {
        status.textContent = 'message is required';
        status.className = 'mono bad';
        return;
      }
      sendButton.disabled = true;
      status.textContent = 'sending to local provider...';
      status.className = 'mono warn';
      addMessage('you', message);
      try {
        const response = await fetch('/chat.json', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-viser-web-chat-token': WEB_CHAT_TOKEN },
          body: JSON.stringify({ message, providerId: providerId || undefined })
        });
        const text = await response.text();
        if (!response.ok) throw new Error(text || ('chat failed: ' + response.status));
        const data = JSON.parse(text);
        addMessage('viser', data.reply || '');
        status.textContent = 'ready · session ' + data.sessionId;
        status.className = 'mono ok';
        messageInput.value = '';
      } catch (error) {
        status.textContent = error && error.message ? error.message : String(error);
        status.className = 'mono bad';
      } finally {
        sendButton.disabled = false;
      }
    }

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') sendMessage();
    });
  </script>
</body>
</html>`;
}

function voiceTranscriptHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser Voice Capture</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top right, #1e3a8a 0, transparent 28rem), #0c111d; }
    main { max-width: 980px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: start; margin-bottom: 16px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.04em; }
    p { color: #9fb0c6; line-height: 1.55; }
    a, button, textarea { font: inherit; }
    a.button, button { border: 1px solid #39506f; color: #e6edf7; background: #162238; border-radius: 999px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: #60a5fa; }
    button[disabled] { opacity: .5; cursor: not-allowed; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 14px 0; }
    .card { background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 18px; box-shadow: 0 20px 45px rgba(0,0,0,.22); margin-top: 14px; }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 22px; font-weight: 720; }
    .ok { color: #86efac; }
    .warn { color: #facc15; }
    .bad { color: #fb7185; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; word-break: break-word; }
    textarea { box-sizing: border-box; width: 100%; min-height: 260px; border-radius: 14px; padding: 14px; color: #e6edf7; background: #020617; border: 1px solid rgba(148,163,184,.22); resize: vertical; }
    code { color: #bfdbfe; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser Voice Capture</h1>
        <p>Browser-side microphone transcript capture for the existing <code>viser voice</code> loop. This page uses the Web Speech API when your browser supports it. It does not call providers, write actions, jobs, or local files.</p>
      </div>
      <div>
        <a class="button" href="/">Dashboard</a>
        <a class="button" href="/canvas.html">Canvas</a>
      </div>
    </header>

    <section class="card">
      <div class="label">SpeechRecognition status</div>
      <div id="status" class="value warn">checking browser support</div>
      <p class="mono">No provider calls happen here. Copy or download transcript lines, then run <code>viser voice --propose-speak &lt; transcript-lines.txt</code> in your local terminal.</p>
      <div class="toolbar">
        <button id="start">Start microphone</button>
        <button id="stop" disabled>Stop</button>
        <button id="copy">Copy transcript</button>
        <button id="download">Download transcript-lines.txt</button>
        <button id="clear">Clear</button>
      </div>
    </section>

    <section class="card">
      <div class="label">Live interim transcript</div>
      <p id="interim" class="mono warn">Waiting for speech...</p>
    </section>

    <section class="card">
      <div class="label">Transcript lines for Viser</div>
      <textarea id="transcript" spellcheck="false" aria-label="Transcript lines for Viser voice loop"></textarea>
      <p class="mono">Tip: say “stop voice” as the final line, or add it manually before piping this file into <code>viser voice</code>.</p>
    </section>
  </main>
  <script>
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const status = document.getElementById('status');
    const startButton = document.getElementById('start');
    const stopButton = document.getElementById('stop');
    const copyButton = document.getElementById('copy');
    const clearButton = document.getElementById('clear');
    const downloadButton = document.getElementById('download');
    const transcript = document.getElementById('transcript');
    const interim = document.getElementById('interim');
    let recognition;
    let listening = false;

    function setStatus(text, tone) {
      status.textContent = text;
      status.className = 'value ' + tone;
    }

    function appendLine(value) {
      const line = value.trim().replace(/\\s+/g, ' ');
      if (!line) return;
      transcript.value += (transcript.value.trim() ? '\\n' : '') + line;
      transcript.scrollTop = transcript.scrollHeight;
    }

    function setListening(value) {
      listening = value;
      startButton.disabled = value || !SpeechRecognition;
      stopButton.disabled = !value;
    }

    if (!SpeechRecognition) {
      setStatus('unsupported in this browser', 'bad');
      startButton.disabled = true;
      interim.textContent = 'Use browser speech APIs, OS dictation, Whisper, or another local STT tool to create transcript lines.';
    } else {
      setStatus('ready · browser-side only', 'ok');
      recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onstart = () => {
        setListening(true);
        setStatus('listening · browser microphone permission active', 'ok');
      };
      recognition.onend = () => {
        setListening(false);
        setStatus('stopped · transcript ready for viser voice', 'warn');
      };
      recognition.onerror = (event) => {
        setStatus('microphone error: ' + (event.error || 'unknown'), 'bad');
        setListening(false);
      };
      recognition.onresult = (event) => {
        let interimText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result[0] && result[0].transcript ? result[0].transcript : '';
          if (result.isFinal) appendLine(text);
          else interimText += text;
        }
        interim.textContent = interimText.trim() || 'Listening...';
      };
    }

    startButton.addEventListener('click', () => {
      if (!recognition || listening) return;
      recognition.start();
    });
    stopButton.addEventListener('click', () => {
      if (recognition && listening) recognition.stop();
    });
    clearButton.addEventListener('click', () => {
      transcript.value = '';
      interim.textContent = 'Waiting for speech...';
    });
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(transcript.value);
      setStatus('copied transcript lines', 'ok');
    });
    downloadButton.addEventListener('click', () => {
      const text = transcript.value.trim() ? transcript.value + '\\n' : '';
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'transcript-lines.txt';
      link.click();
      URL.revokeObjectURL(url);
    });
  </script>
</body>
</html>`;
}

function mediaCaptureHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viser Camera and Screen Capture</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c111d; color: #e6edf7; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at bottom left, #0f766e 0, transparent 28rem), #0c111d; }
    main { max-width: 1040px; margin: 0 auto; padding: 28px 20px 44px; }
    header { display: flex; gap: 16px; justify-content: space-between; align-items: start; margin-bottom: 16px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 42px); letter-spacing: -0.04em; }
    p { color: #9fb0c6; line-height: 1.55; }
    a, button { font: inherit; }
    a.button, button { border: 1px solid #39506f; color: #e6edf7; background: #162238; border-radius: 999px; padding: 10px 14px; text-decoration: none; cursor: pointer; }
    button:hover, a.button:hover { border-color: #5eead4; }
    button[disabled] { opacity: .5; cursor: not-allowed; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 14px 0; }
    .card { background: rgba(15, 23, 42, 0.82); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 18px; padding: 18px; box-shadow: 0 20px 45px rgba(0,0,0,.22); margin-top: 14px; }
    .label { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    .value { margin-top: 8px; font-size: 22px; font-weight: 720; }
    .ok { color: #86efac; }
    .warn { color: #facc15; }
    .bad { color: #fb7185; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; word-break: break-word; }
    video, canvas { display: block; box-sizing: border-box; width: 100%; min-height: 280px; border-radius: 14px; background: #020617; border: 1px solid rgba(148,163,184,.22); }
    canvas { margin-top: 12px; }
    code { color: #ccfbf1; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser Camera and Screen Capture</h1>
        <p>Browser-side Camera and Screen capture for local operator workflows. This page uses <code>navigator.mediaDevices.getUserMedia</code> and <code>getDisplayMedia</code> when your browser supports them. It does not call providers, upload media, write actions, run jobs, or persist captures.</p>
      </div>
      <div>
        <a class="button" href="/">Dashboard</a>
        <a class="button" href="/voice.html">Voice</a>
        <a class="button" href="/canvas.html">Canvas</a>
      </div>
    </header>

    <section class="card">
      <div class="label">MediaDevices status</div>
      <div id="status" class="value warn">checking browser support</div>
      <p class="mono">No provider calls happen here. Capture stays in this browser tab until you download a local PNG.</p>
      <div class="toolbar">
        <button id="camera">Start camera</button>
        <button id="screen">Share screen</button>
        <button id="snapshot" disabled>Capture frame</button>
        <button id="download" disabled>Download capture.png</button>
        <button id="stop" disabled>Stop stream</button>
      </div>
    </section>

    <section class="card">
      <div class="label">Live local preview</div>
      <video id="preview" autoplay muted playsinline aria-label="Local camera or screen preview"></video>
      <canvas id="capture" width="1280" height="720" aria-label="Last local capture"></canvas>
      <p class="mono">The dashboard serves only this static browser-side page; there are no provider/action/job routes for media capture.</p>
    </section>
  </main>
  <script>
    const mediaDevices = navigator.mediaDevices;
    const status = document.getElementById('status');
    const cameraButton = document.getElementById('camera');
    const screenButton = document.getElementById('screen');
    const snapshotButton = document.getElementById('snapshot');
    const downloadButton = document.getElementById('download');
    const stopButton = document.getElementById('stop');
    const preview = document.getElementById('preview');
    const capture = document.getElementById('capture');
    const context = capture.getContext('2d');
    let stream;
    let captureBlobUrl;

    function setStatus(text, tone) {
      status.textContent = text;
      status.className = 'value ' + tone;
    }

    function clearBlobUrl() {
      if (captureBlobUrl) URL.revokeObjectURL(captureBlobUrl);
      captureBlobUrl = undefined;
      downloadButton.disabled = true;
    }

    function stopStream() {
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      stream = undefined;
      preview.srcObject = null;
      snapshotButton.disabled = true;
      stopButton.disabled = true;
      setStatus('stopped · no media is persisted', 'warn');
    }

    async function attachStream(nextStream, label) {
      stopStream();
      clearBlobUrl();
      stream = nextStream;
      preview.srcObject = stream;
      snapshotButton.disabled = false;
      stopButton.disabled = false;
      setStatus(label + ' active · browser permission granted locally', 'ok');
      stream.getTracks().forEach((track) => track.addEventListener('ended', stopStream, { once: true }));
      await preview.play();
    }

    if (!mediaDevices || !mediaDevices.getUserMedia) {
      setStatus('unsupported in this browser', 'bad');
      cameraButton.disabled = true;
      screenButton.disabled = true;
    } else {
      setStatus('ready · browser-side only', 'ok');
    }

    cameraButton.addEventListener('click', async () => {
      try {
        const nextStream = await mediaDevices.getUserMedia({ audio: false, video: true });
        await attachStream(nextStream, 'camera');
      } catch (error) {
        setStatus('camera error: ' + (error && error.message ? error.message : 'unknown'), 'bad');
      }
    });

    screenButton.addEventListener('click', async () => {
      if (!mediaDevices || !mediaDevices.getDisplayMedia) {
        setStatus('screen capture unsupported in this browser', 'bad');
        return;
      }
      try {
        const nextStream = await mediaDevices.getDisplayMedia({ audio: false, video: true });
        await attachStream(nextStream, 'screen');
      } catch (error) {
        setStatus('screen capture error: ' + (error && error.message ? error.message : 'unknown'), 'bad');
      }
    });

    snapshotButton.addEventListener('click', () => {
      if (!stream || !context) return;
      const width = preview.videoWidth || 1280;
      const height = preview.videoHeight || 720;
      capture.width = width;
      capture.height = height;
      context.drawImage(preview, 0, 0, width, height);
      clearBlobUrl();
      capture.toBlob((blob) => {
        if (!blob) {
          setStatus('capture failed', 'bad');
          return;
        }
        captureBlobUrl = URL.createObjectURL(blob);
        downloadButton.disabled = false;
        setStatus('captured local PNG · ready to download', 'ok');
      }, 'image/png');
    });

    downloadButton.addEventListener('click', () => {
      if (!captureBlobUrl) return;
      const link = document.createElement('a');
      link.href = captureBlobUrl;
      link.download = 'viser-capture.png';
      link.click();
    });

    stopButton.addEventListener('click', stopStream);
    window.addEventListener('beforeunload', () => {
      stopStream();
      clearBlobUrl();
    });
  </script>
</body>
</html>`;
}

export function dashboardCanvasSvg(data: DashboardData): string {
  const width = 1000;
  const height = 360;
  const jobsTone = data.state.jobs.failed > 0 ? "#fb7185" : "#86efac";
  const approvalsTone = data.state.pendingApprovals.count > 0 ? "#facc15" : "#86efac";
  const providerTone = data.providers.some((provider) => provider.launchRoute && !provider.installed) ? "#fb7185" : "#86efac";
  const generated = new Date(data.generatedAt).toISOString();
  const providers = data.providers.map((provider) => `${provider.id}:${provider.installed ? "ok" : "missing"}`).join(" · ") || "none";
  const schedules = `${data.state.schedules.enabledCount} enabled / ${data.state.schedules.total} total`;
  const jobs = `pending ${data.state.jobs.pending} · running ${data.state.jobs.running} · failed ${data.state.jobs.failed}`;
  const approvals = `${data.state.pendingApprovals.count} pending`;
  const activity = `${data.state.operatorActivity.count} event${data.state.operatorActivity.count === 1 ? "" : "s"}`;

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <title id="title">Viser read-only dashboard canvas</title>`,
    `  <desc id="desc">Provider-free local status snapshot generated at ${escapeXml(generated)}. This SVG does not expose writes, provider calls, or job execution.</desc>`,
    `  <defs>`,
    `    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#172554"/></linearGradient>`,
    `    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="14" flood-color="#000000" flood-opacity="0.28"/></filter>`,
    `  </defs>`,
    `  <rect width="${width}" height="${height}" fill="url(#bg)"/>`,
    `  <text x="40" y="54" fill="#e6edf7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="760">Viser Dashboard</text>`,
    `  <text x="40" y="82" fill="#9fb0c6" font-family="ui-monospace, monospace" font-size="13">read-only · no provider calls · no write actions · generated ${escapeXml(generated)}</text>`,
    svgLine(245, 146, 430, 192),
    svgLine(755, 146, 570, 192),
    svgLine(245, 268, 430, 230),
    svgLine(755, 268, 570, 230),
    svgNode(40, 112, "Provider", data.provider, providerTone),
    svgNode(720, 112, "Approvals", approvals, approvalsTone),
    svgNode(40, 234, "Jobs", jobs, jobsTone),
    svgNode(720, 234, "Activity", activity, "#60a5fa"),
    svgHub(372, 168, "Local control plane", [
      `providers ${providers}`,
      `schedules ${schedules}`,
      `skills ${data.state.skills.count} · plugins ${data.state.plugins.count}`
    ]),
    `</svg>`
  ].join("\n");
}

function svgLine(fromX: number, fromY: number, toX: number, toY: number): string {
  return `  <path d="M ${fromX} ${fromY} L ${toX} ${toY}" stroke="rgba(96,165,250,0.42)" stroke-width="2" fill="none"/>`;
}

function svgNode(x: number, y: number, label: string, value: string, color: string): string {
  return [
    `  <g filter="url(#shadow)">`,
    `    <rect x="${x}" y="${y}" width="230" height="86" rx="18" fill="rgba(15,23,42,0.92)" stroke="rgba(148,163,184,0.32)"/>`,
    `    <text x="${x + 18}" y="${y + 30}" fill="#94a3b8" font-family="ui-monospace, monospace" font-size="12" letter-spacing="1.4">${escapeXml(label.toUpperCase())}</text>`,
    `    <text x="${x + 18}" y="${y + 60}" fill="${color}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="700">${escapeXml(value)}</text>`,
    `  </g>`
  ].join("\n");
}

function svgHub(x: number, y: number, title: string, lines: string[]): string {
  return [
    `  <g filter="url(#shadow)">`,
    `    <rect x="${x}" y="${y}" width="256" height="116" rx="24" fill="rgba(37,99,235,0.24)" stroke="#60a5fa" stroke-width="2"/>`,
    `    <text x="${x + 128}" y="${y + 38}" text-anchor="middle" fill="#e6edf7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="20" font-weight="760">${escapeXml(title)}</text>`,
    ...lines.map((line, index) => `    <text x="${x + 128}" y="${y + 64 + index * 18}" text-anchor="middle" fill="#cbd5e1" font-family="ui-monospace, monospace" font-size="12">${escapeXml(line)}</text>`),
    `  </g>`
  ].join("\n");
}

function escapeHtml(value: string): string {
  return escapeXml(value);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
