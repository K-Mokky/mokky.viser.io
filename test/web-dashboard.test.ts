import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssistantRuntime } from "../src/core/assistant.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { handleWebDashboardRequest } from "../src/connectors/web-dashboard.ts";
import type { ModelProvider, ProviderRequest, ProviderResponse, ViserConfig } from "../src/core/types.ts";

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
    assert.match(html.body, /<canvas id="overview"/);
    assert.equal(String(jsonResponse.headers["content-type"]).includes("application/json"), true);
    assert.equal(String(svgResponse.headers["content-type"]).includes("image/svg+xml"), true);
    assert.match(svgResponse.body, /Viser read-only dashboard canvas/);
    assert.match(svgResponse.body, /no provider calls/);
    assert.match(svgResponse.body, /pending 1/);
    assert.equal(jsonResponse.headers["cache-control"], "no-store");
    assert.equal(jsonResponse.headers["x-content-type-options"], "nosniff");
    assert.equal(String(eventsHead.headers["content-type"]).includes("text/event-stream"), true);
    assert.equal(data.assistantName, "Viser");
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.sessionId, "test:web-dashboard");
    assert.equal(data.runtime.webDashboard.enabled, true);
    assert.equal(data.runtime.webDashboard.host, "127.0.0.1");
    assert.equal(data.state.plugins.count, 0);
    assert.equal(data.capabilities.readOnly, true);
    assert.equal(data.capabilities.providerCalls, false);
    assert.equal(schema.properties.schemaVersion.const, 1);
    assert.equal(schema.properties.state.required.includes("plugins"), true);
    assert.equal(schema.properties.capabilities.properties.writeActions.const, false);
    assert.equal(data.state.jobs.pending, 1);
    assert.equal(JSON.parse(health.body).ok, true);
    assert.equal(rejected.statusCode, 405);
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

async function requestDashboard(
  method: string,
  url: string,
  assistant: AssistantRuntime,
  sessionId: string
): Promise<MockResponse> {
  const response = new MockResponse();
  const request = Object.assign(new EventEmitter(), { method, url });
  await handleWebDashboardRequest(request as any, response as any, assistant, sessionId);
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

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, "storage") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills")], promptLimit: 8 },
    plugins: { ...DEFAULT_CONFIG.plugins, dirs: [join(dir, "plugins")], promptLimit: 8 },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, "jobs") },
    webDashboard: { enabled: true, host: "127.0.0.1", port: 8787 },
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
