// ================================================================
// Read-only local web dashboard
// ================================================================
// A tiny localhost-only HTTP surface for the provider-free DashboardData
// snapshot. It intentionally exposes no write/action/provider routes.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AssistantRuntime } from "../core/assistant.ts";
import type { DashboardData } from "../core/types.ts";

export const DEFAULT_WEB_DASHBOARD_HOST = "127.0.0.1";
export const DEFAULT_WEB_DASHBOARD_PORT = 8787;
export const DASHBOARD_SCHEMA_VERSION = 1;
const DEFAULT_EVENT_INTERVAL_MS = 5000;
const MIN_EVENT_INTERVAL_MS = 1000;
const MAX_EVENT_INTERVAL_MS = 60_000;

export interface WebDashboardOptions {
  host?: string;
  port?: number;
  sessionId: string;
}

export interface WebDashboardHandle {
  url: string;
  server: Server;
  close(): Promise<void>;
}

export async function startWebDashboard(
  assistant: AssistantRuntime,
  options: WebDashboardOptions
): Promise<WebDashboardHandle> {
  const host = options.host ?? DEFAULT_WEB_DASHBOARD_HOST;
  const port = options.port ?? DEFAULT_WEB_DASHBOARD_PORT;
  const sessionId = options.sessionId;
  const server = createServer((request, response) => {
    void handleWebDashboardRequest(request, response, assistant, sessionId).catch((error) => {
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
  sessionId: string
): Promise<void> {
  const method = request.method ?? "GET";
  setSecurityHeaders(response);

  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendText(response, method, 405, "Method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    sendHtml(response, method, dashboardHtml());
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
    sendJson(response, method, JSON.stringify({ ok: true, surface: "web-dashboard" }));
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
    "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
  );
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
        required: ["currentSessionHistory", "savedSessions", "memories", "skills", "plugins", "schedules", "jobs", "pendingApprovals"],
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
    pre { overflow: auto; background: #020617; border: 1px solid rgba(148,163,184,.18); border-radius: 14px; padding: 14px; }
    canvas { display: block; width: 100%; min-height: 260px; border-radius: 14px; background: #020617; border: 1px solid rgba(148,163,184,.18); }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Viser Dashboard</h1>
        <p>Read-only localhost status. Provider calls and write actions are not exposed here.</p>
      </div>
      <div>
        <button id="refresh">Refresh</button>
        <a class="button" href="/dashboard.json">JSON</a>
        <a class="button" href="/dashboard.canvas.svg">SVG Canvas</a>
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
      raw.textContent = JSON.stringify(data, null, 2);
      drawOverview(data);
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
      drawNode(context, w - 250, h - 120, 'Memory', data.state.memories.count + ' memories', '#60a5fa');
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
    svgNode(720, 234, "Memory", `${data.state.memories.count} memories`, "#60a5fa"),
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

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
