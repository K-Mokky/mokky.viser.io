import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantRuntime } from "../src/core/assistant.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createPersistentWebDashboardState, createWebDashboardState, handleWebDashboardRequest, type WebDashboardState } from "../src/connectors/web-dashboard.ts";
import type { GenericWebhookConnectorConfig, ModelProvider, ProviderRequest, ProviderResponse, ViserConfig } from "../src/core/types.ts";

class EchoProvider implements ModelProvider {
  id = "echo";
  label = "Echo";
  prompts: string[] = [];

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.prompts.push(request.prompt);
    return { text: `echo:${request.providerId}`, providerId: request.providerId, elapsedMs: 5 };
  }
}

test("web dashboard serves read-only HTML and dashboard JSON without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    await assistant.handle("/enqueue queued dashboard work", "test:web-dashboard", { source: "test" });

    const html = await requestDashboard("GET", "/", assistant, "test:web-dashboard");
    const jsonResponse = await requestDashboard("GET", "/dashboard.json", assistant, "test:web-dashboard");
    const data = JSON.parse(jsonResponse.body);
    const svgResponse = await requestDashboard("GET", "/dashboard.canvas.svg", assistant, "test:web-dashboard");
    const schemaResponse = await requestDashboard("GET", "/dashboard.schema.json", assistant, "test:web-dashboard");
    const schema = JSON.parse(schemaResponse.body);
    const eventsHead = await requestDashboard("HEAD", "/dashboard.events", assistant, "test:web-dashboard");
    const health = await requestDashboard("GET", "/healthz", assistant, "test:web-dashboard");
    const rejected = await requestDashboard("POST", "/dashboard.json", assistant, "test:web-dashboard");

    assert.match(html.body, /Viser Dashboard/);
    assert.match(html.body, /dashboard\.events/);
    assert.match(html.body, /dashboard\.canvas\.svg/);
    assert.match(html.body, /canvas\.html/);
    assert.match(html.body, /chat\.html/);
    assert.match(html.body, /voice\.html/);
    assert.match(html.body, /capture\.html/);
    assert.match(html.body, /<canvas id="overview"/);
    assert.match(html.body, /Operator activity stream/);
    assert.equal(String(jsonResponse.headers["content-type"]).includes("application/json"), true);
    assert.equal(String(svgResponse.headers["content-type"]).includes("image/svg+xml"), true);
    assert.match(svgResponse.body, /Viser read-only dashboard canvas/);
    assert.match(svgResponse.body, /no provider calls/);
    assert.match(svgResponse.body, /pending 1/);
    assert.match(svgResponse.body, /ACTIVITY/);
    assert.equal(jsonResponse.headers["cache-control"], "no-store");
    assert.equal(jsonResponse.headers["x-content-type-options"], "nosniff");
    assert.equal(String(eventsHead.headers["content-type"]).includes("text/event-stream"), true);
    assert.equal(data.assistantName, "Viser");
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.sessionId, "test:web-dashboard");
    assert.equal(data.runtime.webDashboard.enabled, true);
    assert.equal(data.runtime.webDashboard.host, "127.0.0.1");
    assert.equal(data.runtime.webDashboard.canvasPersistence, "private-local-json");
    assert.equal(data.state.plugins.count, 0);
    assert.equal(data.capabilities.readOnly, true);
    assert.equal(data.capabilities.providerCalls, false);
    assert.equal(schema.properties.schemaVersion.const, 1);
    assert.equal(schema.properties.state.required.includes("plugins"), true);
    assert.equal(schema.properties.state.required.includes("operatorActivity"), true);
    assert.equal(schema.properties.capabilities.properties.writeActions.const, false);
    assert.equal(data.state.jobs.pending, 1);
    assert.equal(data.state.jobs.recent[0].status, "pending");
    assert.equal(data.state.operatorActivity.count > 0, true);
    assert.equal(data.state.operatorActivity.items.some((item: { kind: string }) => item.kind === "job"), true);
    assert.equal(JSON.parse(health.body).ok, true);
    assert.equal(rejected.statusCode, 405);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard serves localhost-only WebChat with a same-origin token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-chat-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const state = createWebDashboardState();

    const html = await requestDashboard("GET", "/chat.html", assistant, "test:web-dashboard-chat", { state });
    const rejectedToken = await requestDashboard("POST", "/chat.json", assistant, "test:web-dashboard-chat", {
      state,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello from browser" })
    });
    const rejectedRemote = await requestDashboard("GET", "/chat.html", assistant, "test:web-dashboard-chat", {
      state,
      remoteAddress: "203.0.113.10"
    });
    const accepted = await requestDashboard("POST", "/chat.json", assistant, "test:web-dashboard-chat", {
      state,
      headers: { "content-type": "application/json", "x-viser-web-chat-token": state.webChatToken },
      body: JSON.stringify({ message: "hello from browser", providerId: "echo" })
    });

    assert.equal(html.statusCode, 200);
    assert.match(html.body, /Viser WebChat/);
    assert.match(html.body, /x-viser-web-chat-token/);
    assert.equal(rejectedToken.statusCode, 403);
    assert.equal(rejectedRemote.statusCode, 403);
    const payload = JSON.parse(accepted.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.sessionId, "test:web-dashboard-chat");
    assert.match(payload.reply, /echo:echo/);
    assert.equal(provider.prompts.length, 1);
    assert.match(provider.prompts[0], /hello from browser/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard serves browser-side voice capture without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-voice-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const response = await requestDashboard("GET", "/voice.html", assistant, "test:web-dashboard-voice");

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Viser Voice Capture/);
    assert.match(response.body, /SpeechRecognition/);
    assert.match(response.body, /viser voice --propose-speak/);
    assert.match(response.body, /does not call providers/);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard serves browser-side camera and screen capture without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-capture-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const response = await requestDashboard("GET", "/capture.html", assistant, "test:web-dashboard-capture");

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Viser Camera and Screen Capture/);
    assert.match(response.body, /getUserMedia/);
    assert.match(response.body, /getDisplayMedia/);
    assert.match(response.body, /does not call providers/);
    assert.match(response.body, /no provider\/action\/job routes/);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard serves a token-protected collaborative canvas without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-canvas-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const state = createWebDashboardState();

    const html = await requestDashboard("GET", "/canvas.html", assistant, "test:web-dashboard-canvas", { state });
    const empty = await requestDashboard("GET", "/canvas.json", assistant, "test:web-dashboard-canvas", { state });
    const rejected = await requestDashboard("POST", "/canvas.json", assistant, "test:web-dashboard-canvas", {
      state,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    });
    const accepted = await requestDashboard("POST", "/canvas.json", assistant, "test:web-dashboard-canvas", {
      state,
      headers: { "content-type": "application/json", "x-viser-canvas-token": state.canvasToken },
      body: JSON.stringify({ by: "operator", color: "#ff00aa", width: 5, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    });
    const eventStream = await requestDashboard("GET", "/canvas.events?intervalMs=60000", assistant, "test:web-dashboard-canvas", { state });

    assert.match(html.body, /Viser Collaborative Canvas/);
    assert.match(html.body, /x-viser-canvas-token/);
    assert.equal(JSON.parse(empty.body).strokes.length, 0);
    assert.equal(JSON.parse(empty.body).persistence.enabled, false);
    assert.equal(rejected.statusCode, 403);
    const snapshot = JSON.parse(accepted.body);
    assert.equal(snapshot.strokes.length, 1);
    assert.equal(snapshot.strokes[0].by, "operator");
    assert.equal(snapshot.strokes[0].color, "#ff00aa");
    assert.equal(snapshot.strokes[0].points.length, 2);
    assert.match(eventStream.body, /event: canvas/);
    assert.match(eventStream.body, /operator/);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard persists collaborative canvas strokes in a private local store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-canvas-store-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const canvasDir = join(dir, "dashboard-canvas");
    const state = await createPersistentWebDashboardState(canvasDir);

    const health = await requestDashboard("GET", "/healthz", assistant, "test:web-dashboard-canvas-store", { state });
    const accepted = await requestDashboard("POST", "/canvas.json", assistant, "test:web-dashboard-canvas-store", {
      state,
      headers: { "content-type": "application/json", "x-viser-canvas-token": state.canvasToken },
      body: JSON.stringify({ by: "operator", color: "#ff00aa", width: 5, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    });
    const persistedRaw = await readFile(join(canvasDir, "canvas.json"), "utf8");
    const restartedState = await createPersistentWebDashboardState(canvasDir);
    const restarted = await requestDashboard("GET", "/canvas.json", assistant, "test:web-dashboard-canvas-store", { state: restartedState });

    const snapshot = JSON.parse(accepted.body);
    const persisted = JSON.parse(persistedRaw);
    const restartedSnapshot = JSON.parse(restarted.body);
    assert.equal(JSON.parse(health.body).canvas, "persistent-local");
    assert.equal(snapshot.persistence.enabled, true);
    assert.equal(snapshot.persistence.store, "private-local-json");
    assert.equal(persisted.strokes.length, 1);
    assert.equal(restartedSnapshot.strokes.length, 1);
    assert.equal(restartedSnapshot.strokes[0].by, "operator");
    assert.equal(restartedSnapshot.persistence.enabled, true);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard can require token auth before exposing remote-capable canvas routes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-auth-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const state = await createPersistentWebDashboardState(join(dir, "dashboard-canvas"), {
      authToken: "dashboard-secret-token-123456"
    });

    const denied = await requestDashboard("GET", "/canvas.html", assistant, "test:web-dashboard-auth", { state });
    const bearer = await requestDashboard("GET", "/canvas.html", assistant, "test:web-dashboard-auth", {
      state,
      headers: { authorization: "Bearer dashboard-secret-token-123456" }
    });
    const login = await requestDashboard("POST", "/login", assistant, "test:web-dashboard-auth", {
      state,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "token=dashboard-secret-token-123456"
    });
    const cookie = String(login.headers["set-cookie"]).split(";", 1)[0];
    const accepted = await requestDashboard("POST", "/canvas.json", assistant, "test:web-dashboard-auth", {
      state,
      headers: {
        "content-type": "application/json",
        "x-viser-canvas-token": state.canvasToken,
        cookie
      },
      body: JSON.stringify({ by: "remote-operator", color: "#60a5fa", width: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    });

    assert.equal(denied.statusCode, 401);
    assert.match(denied.body, /Viser Dashboard Login/);
    assert.equal(bearer.statusCode, 200);
    assert.match(bearer.body, /Persistent localhost board/);
    assert.equal(login.statusCode, 303);
    assert.match(cookie, /viser_dashboard_session=/);
    assert.equal(JSON.parse(accepted.body).strokes[0].by, "remote-operator");
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard auth still requires the canvas write token for mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-auth-canvas-token-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const state = createWebDashboardState({ authToken: "dashboard-secret-token-123456" });

    const rejected = await requestDashboard("POST", "/canvas.json", assistant, "test:web-dashboard-auth-canvas-token", {
      state,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer dashboard-secret-token-123456"
      },
      body: JSON.stringify({ by: "operator", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
    });

    assert.equal(rejected.statusCode, 403);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard event stream sends a live read-only snapshot without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-events-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const response = await requestDashboard("GET", "/dashboard.events?intervalMs=60000", assistant, "test:web-dashboard-events");

    assert.equal(response.statusCode, 200);
    assert.equal(String(response.headers["content-type"]).includes("text/event-stream"), true);
    const eventText = response.body;
    const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "));
    assert.match(eventText, /event: dashboard/);
    assert.ok(dataLine);
    assert.equal(JSON.parse(dataLine.slice("data: ".length)).assistantName, "Viser");
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard routes token-protected generic inbound webhooks to AssistantRuntime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-webhook-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const genericWebhook = genericInboundWebhookConfig();

    const forbidden = await requestDashboard("POST", "/webhook/viser", assistant, "test:webhook", {
      genericWebhook,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "ops", text: "queue status" })
    });
    const accepted = await requestDashboard("POST", "/webhook/viser", assistant, "test:webhook", {
      genericWebhook,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${genericWebhook.inboundToken}`
      },
      body: JSON.stringify({
        source: "ops",
        text: "queue status",
        providerId: "echo",
        attachments: [
          { name: "queue.txt", type: "text/plain", text: "blocked=2" }
        ]
      })
    });

    assert.equal(forbidden.statusCode, 403);
    assert.equal(accepted.statusCode, 200);
    const payload = JSON.parse(accepted.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.sessionId, "webhook:ops");
    assert.equal(payload.sourceId, "ops");
    assert.equal(payload.attachmentCount, 1);
    assert.match(payload.reply, /echo:echo/);
    assert.equal(provider.prompts.length, 1);
    assert.match(provider.prompts[0], /queue status/);
    assert.match(provider.prompts[0], /queue\.txt/);
    assert.match(provider.prompts[0], /blocked=2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("web dashboard can require signed generic inbound webhook bodies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-web-dashboard-webhook-signature-"));

  try {
    const provider = new EchoProvider();
    const assistant = new AssistantRuntime(testConfig(dir), { echo: provider });
    const genericWebhook = {
      ...genericInboundWebhookConfig(),
      inboundSignatureSecret: "abcdefghijklmnopqrstuvwxyz012345",
      inboundSignatureToleranceMs: 300_000
    };
    const body = JSON.stringify({ source: "ops", text: "signed queue status", providerId: "echo" });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", genericWebhook.inboundSignatureSecret).update(`${timestamp}.${body}`).digest("hex");

    const missingSignature = await requestDashboard("POST", "/webhook/viser", assistant, "test:webhook", {
      genericWebhook,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${genericWebhook.inboundToken}`
      },
      body
    });
    const accepted = await requestDashboard("POST", "/webhook/viser", assistant, "test:webhook", {
      genericWebhook,
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${genericWebhook.inboundToken}`,
        "x-viser-webhook-timestamp": timestamp,
        "x-viser-webhook-signature": `sha256=${signature}`
      },
      body
    });

    assert.equal(missingSignature.statusCode, 403);
    assert.equal(accepted.statusCode, 200);
    assert.match(JSON.parse(accepted.body).reply, /echo:echo/);
    assert.equal(provider.prompts.length, 1);
    assert.match(provider.prompts[0], /signed queue status/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function requestDashboard(
  method: string,
  url: string,
  assistant: AssistantRuntime,
  sessionId: string,
  options: { state?: WebDashboardState; genericWebhook?: GenericWebhookConnectorConfig; headers?: Record<string, string>; body?: string; remoteAddress?: string } = {}
): Promise<MockResponse> {
  const response = new MockResponse();
  const request = Object.assign(new EventEmitter(), {
    method,
    url,
    headers: Object.fromEntries(Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])),
    socket: { remoteAddress: options.remoteAddress ?? "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (options.body !== undefined) yield Buffer.from(options.body);
    }
  });
  await handleWebDashboardRequest(request as any, response as any, assistant, sessionId, options.state, options.genericWebhook);
  request.emit("close");
  response.emit("close");
  return response;
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string | number | readonly string[]> = {};
  body = "";
  destroyed = false;

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  write(body?: string | Buffer): boolean {
    if (body) this.body += body.toString();
    return true;
  }

  flushHeaders(): void {
    // no-op for tests
  }

  end(body?: string | Buffer): this {
    if (body) this.body += body.toString();
    return this;
  }
}

function genericInboundWebhookConfig(): GenericWebhookConnectorConfig {
  return {
    ...DEFAULT_CONFIG.connectors.webhook,
    inboundEnabled: true,
    inboundToken: "abcdefghijklmnopqrstuvwxyz",
    inboundPath: "/webhook/viser",
    inboundMaxInputChars: 4000
  };
}

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, "storage") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills")], promptLimit: 8 },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins")], promptLimit: 8 },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, "jobs") },
    webDashboard: { ...DEFAULT_CONFIG.webDashboard, enabled: true, host: "127.0.0.1", port: 8787, canvasDir: join(dir, "dashboard") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, "actions"), allowedWriteRoots: [dir] },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "echo",
        args: ["{prompt}"],
        promptMode: "template",
        timeoutMs: 1000
      }
    }
  };
}
