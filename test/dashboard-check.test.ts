import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardCheck } from "../src/cli/dashboard-check.ts";
import { handleWebDashboardRequest } from "../src/connectors/web-dashboard.ts";
import { AssistantRuntime } from "../src/core/assistant.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
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

test("dashboardCheck validates a live read-only dashboard contract without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-dashboard-check-"));

  try {
    const provider = new EchoProvider();
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, { echo: provider });

    const result = await dashboardCheck(config, {
      timeoutMs: 1_000,
      fetchImpl: dashboardFetch(assistant, "test:dashboard-check")
    });

    assert.equal(result.ok, true);
    assert.match(result.report, /Viser dashboard check: PASS/);
    assert.match(result.report, /dashboard\.json serves schemaVersion=1 read-only capabilities/);
    assert.match(result.report, /dashboard\.schema\.json serves dashboard\.v1 contract/);
    assert.match(result.report, /dashboard\.canvas\.svg serves a read-only SVG canvas snapshot/);
    assert.equal(provider.prompts.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboardCheck blocks stale dashboard processes that lack the v1 contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-dashboard-check-stale-"));

  try {
    const config = testConfig(dir);
    const result = await dashboardCheck(config, {
      timeoutMs: 1_000,
      fetchImpl: staleDashboardFetch()
    });

    assert.equal(result.ok, false);
    assert.match(result.report, /Viser dashboard check: BLOCKED/);
    assert.match(result.report, /dashboard\.json is stale or missing schemaVersion\/capabilities/);
    assert.match(result.report, /dashboard\.schema\.json request failed: HTTP 404/);
    assert.match(result.report, /dashboard\.canvas\.svg request failed: HTTP 404/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboardCheck refuses non-localhost targets before fetching", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-dashboard-check-host-"));

  try {
    const config = testConfig(dir);
    let called = false;
    const result = await dashboardCheck(config, {
      host: "0.0.0.0",
      fetchImpl: (async () => {
        called = true;
        throw new Error("should not fetch");
      }) as typeof fetch
    });

    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(result.report, /refusing non-localhost dashboard host/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function dashboardFetch(assistant: AssistantRuntime, sessionId: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(url).pathname;
    const response = new MockResponse();
    await handleWebDashboardRequest({ method: "GET", url: pathname } as any, response as any, assistant, sessionId);
    return new Response(response.body, { status: response.statusCode, headers: response.headers as HeadersInit });
  }) as typeof fetch;
}

function staleDashboardFetch(): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const pathname = new URL(url).pathname;
    if (pathname === "/healthz") return jsonResponse(200, { ok: true, surface: "web-dashboard" });
    if (pathname === "/dashboard.json") return jsonResponse(200, { assistantName: "Viser" });
    if (pathname === "/dashboard.schema.json") return jsonResponse(404, { error: "not found" });
    return jsonResponse(404, { error: "not found" });
  }) as typeof fetch;
}

class MockResponse {
  statusCode = 200;
  headers: Record<string, string | number | readonly string[]> = {};
  body = "";

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  end(body?: string | Buffer): this {
    if (body) this.body += body.toString();
    return this;
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
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
