import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mcpClientConfigData, mcpClientConfigReport } from "../src/core/mcp-client-config.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("mcpClientConfigData emits a local stdio mcpServers snippet", () => {
  const config = testConfig("/tmp/viser-mcp-client");
  const result = mcpClientConfigData(config, { target: "codex", serverName: "viser-local" });
  const server = result.clientConfig.mcpServers["viser-local"];

  assert.equal(result.target, "codex");
  assert.equal(result.serverName, "viser-local");
  assert.equal(server.command, process.execPath);
  assert.match(server.args[0], /src\/index\.ts$/);
  assert.deepEqual(server.args.slice(1), ["mcp-server"]);
  assert.equal(server.cwd, "/tmp/viser-mcp-client");
  assert.deepEqual(server.env, { VISER_CONFIG: "/tmp/viser-mcp-client/viser.config.json" });
});

test("mcpClientConfigData never copies connector tokens or provider secret env", () => {
  const config = testConfig("/tmp/viser-mcp-client-secrets");
  config.connectors.telegram.botToken = "telegram-secret-token";
  config.connectors.discord.botToken = "discord-secret-token";
  config.connectors.slack.botToken = "slack-secret-token";
  config.connectors.slack.appToken = "slack-app-secret-token";
  config.connectors.whatsapp.accessToken = "whatsapp-secret-token";
  config.connectors.whatsapp.phoneNumberId = "12345";
  config.connectors.whatsapp.verifyToken = "whatsapp-verify-token";
  config.providers.codex.env = { OPENAI_API_KEY: "sk-should-not-appear" };

  const result = mcpClientConfigData(config, { target: "claude" });
  const serialized = JSON.stringify(result);

  assert.equal(result.target, "claude-desktop");
  assert.doesNotMatch(serialized, /telegram-secret-token/);
  assert.doesNotMatch(serialized, /discord-secret-token/);
  assert.doesNotMatch(serialized, /slack-secret-token/);
  assert.doesNotMatch(serialized, /slack-app-secret-token/);
  assert.doesNotMatch(serialized, /whatsapp-secret-token/);
  assert.doesNotMatch(serialized, /whatsapp-verify-token/);
  assert.doesNotMatch(serialized, /12345/);
  assert.doesNotMatch(serialized, /sk-should-not-appear/);
  assert.doesNotMatch(serialized, /OPENAI_API_KEY/);
});

test("mcpClientConfigReport supports JSON output and invalid input usage", () => {
  const config = testConfig("/tmp/viser-mcp-client-json");
  const json = JSON.parse(mcpClientConfigReport(config, { json: true })) as { clientConfig: { mcpServers: Record<string, unknown> } };
  const invalid = mcpClientConfigReport(config, { target: "remote-marketplace" });
  const invalidName = mcpClientConfigReport(config, { serverName: "not allowed" });

  assert.ok(json.clientConfig.mcpServers.viser);
  assert.match(invalid, /Usage: viser mcp-client-config/);
  assert.match(invalid, /Unknown MCP client target/);
  assert.match(invalidName, /MCP server name must/);
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
