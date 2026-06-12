import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ViserMcpServer } from "../src/connectors/mcp-server.ts";
import { AssistantRuntime } from "../src/core/assistant.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("ViserMcpServer initializes with tools capability and lists stable tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-init-"));
  try {
    const server = new ViserMcpServer(testConfig(dir), new AssistantRuntime(testConfig(dir), {}));

    const initialized = await server.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    assert.equal(initialized?.jsonrpc, "2.0");
    assert.equal((initialized?.result as any).protocolVersion, "2025-06-18");
    assert.equal((initialized?.result as any).serverInfo.title, "Viser by KMokky");
    assert.equal((initialized?.result as any).capabilities.tools.listChanged, false);
    assert.equal((initialized?.result as any).capabilities.resources.listChanged, false);
    assert.equal((initialized?.result as any).capabilities.prompts.listChanged, false);
    assert.deepEqual(
      (listed?.result as any).tools.map((tool: { name: string }) => tool.name),
      [
        "viser_dashboard",
        "viser_status",
        "viser_memory_search",
        "viser_pending_approvals",
        "viser_web_fetch",
        "viser_web_search",
        "viser_search_files",
        "viser_propose_open_url",
        "viser_propose_mail_draft",
        "viser_propose_file_write",
        "viser_propose_calendar_event",
        "viser_propose_notification",
        "viser_propose_clipboard",
        "viser_propose_connector_message"
      ]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer exposes guarded web-search without provider calls or JavaScript execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-web-search-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = testConfig(dir);
    const server = new ViserMcpServer(config, new AssistantRuntime(config, {}));
    globalThis.fetch = async () => new Response(`
      <html><body>
        <a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fmcp">MCP Search Result</a>
        <div class="result__snippet">Useful <script>NOPE</script> context</div>
      </body></html>
    `, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

    const searched = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "viser_web_search",
        arguments: { query: "mcp search", maxResults: "3", sessionId: "mcp:test" }
      }
    });

    const text = (searched?.result as any).content[0].text;
    assert.match(text, /status: ok/);
    assert.match(text, /MCP Search Result/);
    assert.match(text, /https:\/\/example\.com\/mcp/);
    assert.match(text, /Useful context/);
    assert.doesNotMatch(text, /NOPE/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer exposes guarded local file search without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-search-files-"));
  try {
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, {});
    const server = new ViserMcpServer(config, assistant);
    await writeFile(join(dir, "notes.txt"), "alpha\nMCP_SEARCH_OK\nomega", "utf8");

    const searched = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "viser_search_files",
        arguments: { query: "MCP_SEARCH_OK", path: ".", maxMatches: "10", sessionId: "mcp:test" }
      }
    });

    const text = (searched?.result as any).content[0].text;
    assert.match(text, /status: ok/);
    assert.match(text, /notes\.txt:2: MCP_SEARCH_OK/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer exposes guarded web-fetch without provider calls or JavaScript execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-web-fetch-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = testConfig(dir);
    const server = new ViserMcpServer(config, new AssistantRuntime(config, {}));
    globalThis.fetch = async () => new Response("<html><body><h1>MCP_WEB_FETCH_OK</h1><script>NOPE</script><p>readable</p></body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" }
    });

    const fetched = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "viser_web_fetch",
        arguments: { url: "https://93.184.216.34/smoke", maxChars: "200", extractMode: "markdown", sessionId: "mcp:test" }
      }
    });
    const blocked = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "viser_web_fetch",
        arguments: { url: "http://localhost:8787/private", sessionId: "mcp:test" }
      }
    });

    const fetchedText = (fetched?.result as any).content[0].text;
    assert.match(fetchedText, /status: ok/);
    assert.match(fetchedText, /extract-mode: markdown/);
    assert.match(fetchedText, /MCP_WEB_FETCH_OK/);
    assert.match(fetchedText, /# MCP_WEB_FETCH_OK/);
    assert.match(fetchedText, /readable/);
    assert.doesNotMatch(fetchedText, /NOPE/);
    assert.match((blocked?.result as any).content[0].text, /status: failed/);
    assert.match((blocked?.result as any).content[0].text, /private\/internal hostnames/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer lists and reads MCP resources without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-resources-"));
  try {
    const config = testConfig(dir);
    config.assistant.workdir = process.cwd();
    const server = new ViserMcpServer(config, new AssistantRuntime(config, {}));

    const listed = await server.handle({ jsonrpc: "2.0", id: 1, method: "resources/list" });
    const dashboard = await server.handle({ jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri: "viser://dashboard" } });
    const readme = await server.handle({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: "viser://readme" } });

    assert.ok((listed?.result as any).resources.some((resource: { uri: string }) => resource.uri === "viser://dashboard"));
    assert.ok((listed?.result as any).resources.some((resource: { uri: string }) => resource.uri === "viser://readme"));
    assert.equal((dashboard?.result as any).contents[0].mimeType, "application/json");
    assert.equal(JSON.parse((dashboard?.result as any).contents[0].text).assistantName, "Viser");
    assert.equal((readme?.result as any).contents[0].mimeType, "text/markdown");
    assert.match((readme?.result as any).contents[0].text, /# Viser/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer lists and returns reusable MCP prompts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-prompts-"));
  try {
    const server = new ViserMcpServer(testConfig(dir), new AssistantRuntime(testConfig(dir), {}));

    const listed = await server.handle({ jsonrpc: "2.0", id: 1, method: "prompts/list" });
    const prompt = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "prompts/get",
      params: { name: "viser_safe_automation", arguments: { task: "Open docs and write notes" } }
    });

    assert.ok((listed?.result as any).prompts.some((item: { name: string }) => item.name === "viser_safe_automation"));
    assert.equal((prompt?.result as any).messages[0].role, "user");
    assert.match((prompt?.result as any).messages[0].content.text, /Open docs and write notes/);
    assert.match((prompt?.result as any).messages[0].content.text, /\/propose/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer serves dashboard and memory tools without provider calls", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-tools-"));
  try {
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, {});
    await assistant.handle("/remember Use local CLIs only #architecture", "mcp:test", { source: "test" });
    const server = new ViserMcpServer(config, assistant);

    const dashboard = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "viser_dashboard", arguments: { sessionId: "mcp:test" } }
    });
    const memory = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "viser_memory_search", arguments: { query: "local", sessionId: "mcp:test" } }
    });

    const dashboardData = JSON.parse((dashboard?.result as any).content[0].text);
    assert.equal(dashboardData.assistantName, "Viser");
    assert.equal(dashboardData.capabilities.providerCalls, false);
    assert.match((memory?.result as any).content[0].text, /local CLIs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer can stage but not execute approval-gated external actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-propose-"));
  try {
    const config = testConfig(dir);
    const assistant = new AssistantRuntime(config, {});
    const server = new ViserMcpServer(config, assistant);

    const proposed = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "viser_propose_open_url",
        arguments: { url: "https://example.com/docs", note: "review docs", sessionId: "mcp:test" }
      }
    });
    const mailDraft = await server.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "viser_propose_mail_draft",
        arguments: { to: "user@example.com", subject: "Hi", body: "Body text", sessionId: "mcp:test" }
      }
    });
    const calendar = await server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "viser_propose_calendar_event",
        arguments: { start: "2026-06-01T09:00:00Z", durationMinutes: "30", title: "Project check", sessionId: "mcp:test" }
      }
    });
    const notification = await server.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "viser_propose_notification",
        arguments: { title: "Build done", body: "Viser finished checks", sessionId: "mcp:test" }
      }
    });
    const connectorMessage = await server.handle({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "viser_propose_connector_message",
        arguments: { connector: "telegram", targetId: "-100123456", text: "Viser finished checks", sessionId: "mcp:test" }
      }
    });
    const clipboard = await server.handle({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "viser_propose_clipboard",
        arguments: { text: "Viser finished checks", sessionId: "mcp:test" }
      }
    });
    const approvals = await server.handle({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "viser_pending_approvals", arguments: { sessionId: "mcp:test" } }
    });

    assert.match((proposed?.result as any).content[0].text, /Proposed action/);
    assert.match((mailDraft?.result as any).content[0].text, /mail-draft/);
    assert.match((calendar?.result as any).content[0].text, /calendar-event/);
    assert.match((notification?.result as any).content[0].text, /notify/);
    assert.match((connectorMessage?.result as any).content[0].text, /connector-message/);
    assert.match((clipboard?.result as any).content[0].text, /clipboard/);
    assert.match((approvals?.result as any).content[0].text, /open-url pending/);
    assert.match((approvals?.result as any).content[0].text, /mail-draft pending/);
    assert.match((approvals?.result as any).content[0].text, /notify pending/);
    assert.match((approvals?.result as any).content[0].text, /connector-message pending/);
    assert.match((approvals?.result as any).content[0].text, /clipboard pending/);
    assert.match((approvals?.result as any).content[0].text, /https:\/\/example\.com\/docs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ViserMcpServer returns JSON-RPC errors for unknown tools", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-mcp-errors-"));
  try {
    const server = new ViserMcpServer(testConfig(dir), new AssistantRuntime(testConfig(dir), {}));
    const response = await server.handle({
      jsonrpc: "2.0",
      id: "bad-tool",
      method: "tools/call",
      params: { name: "unknown_tool", arguments: {} }
    });

    assert.equal(response?.id, "bad-tool");
    assert.equal(response?.error?.code, -32000);
    assert.match(response?.error?.message ?? "", /Unknown MCP tool/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  const config = structuredClone(DEFAULT_CONFIG) as ViserConfig;
  config.assistant.workdir = dir;
  config.storage.dir = join(dir, ".viser");
  config.memory.dir = join(dir, ".viser", "memory");
  config.skills = { ...config.skills, enabled: false, dirs: [] };
  config.plugins = { ...config.plugins, enabled: false, dirs: [] };
  config.scheduler.dir = join(dir, ".viser", "scheduler");
  config.jobs.dir = join(dir, ".viser", "jobs");
  config.access.dir = join(dir, ".viser", "access");
  config.actions.dir = join(dir, ".viser", "actions");
  config.actions.allowedWriteRoots = [dir];
  config.tools.allowedReadRoots = [dir];
  config.configPath = join(dir, "viser.config.json");
  return config;
}
