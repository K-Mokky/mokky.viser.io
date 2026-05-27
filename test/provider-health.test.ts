import test from "node:test";
import assert from "node:assert/strict";
import { probeCliProvider } from "../src/providers/health.ts";
import type { CliProviderConfig } from "../src/core/types.ts";

test("probeCliProvider reports success for a responding CLI", async () => {
  const config: CliProviderConfig = {
    id: "echo",
    command: "node",
    args: ["-e", "process.stdin.resume(); process.stdin.on('data',()=>{}); console.log('VISER_OK')"],
    promptMode: "stdin",
    timeoutMs: 5000
  };
  const result = await probeCliProvider(config, { timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.match(result.detail, /VISER_OK/);
});

test("probeCliProvider success detail keeps VISER_OK visible after verbose banners", async () => {
  const config: CliProviderConfig = {
    id: "banner",
    command: "node",
    args: [
      "-e",
      "console.log(`${'banner '.repeat(80)} VISER_OK proof-tail ${'trailer '.repeat(80)}`)"
    ],
    promptMode: "argument",
    timeoutMs: 5000
  };
  const result = await probeCliProvider(config, { timeoutMs: 5000 });

  assert.equal(result.ok, true);
  assert.match(result.detail, /VISER_OK/);
  assert.match(result.detail, /proof-tail/);
  assert.equal(result.detail.length < 180, true);
});

test("probeCliProvider reports failure for a missing CLI", async () => {
  const config: CliProviderConfig = {
    id: "missing",
    command: "definitely-not-a-real-viser-command",
    args: [],
    promptMode: "argument",
    timeoutMs: 1000
  };
  const result = await probeCliProvider(config, { timeoutMs: 1000 });
  assert.equal(result.ok, false);
  assert.match(result.detail, /Provider 'missing' failed/);
});

test("probeCliProvider requires the expected VISER_OK sentinel", async () => {
  const config: CliProviderConfig = {
    id: "wrong",
    command: "node",
    args: ["-e", "console.log('I am alive but did not answer the probe')"],
    promptMode: "argument",
    timeoutMs: 5000
  };
  const result = await probeCliProvider(config, { timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.match(result.detail, /unexpected probe response/);
  assert.match(result.detail, /VISER_OK/);
});


test("probeCliProvider detects interactive authentication prompts", async () => {
  const config: CliProviderConfig = {
    id: "auth",
    command: "node",
    args: ["-e", "console.log('Opening authentication page in your browser. Do you want to continue? [Y/n]:')"],
    promptMode: "argument",
    timeoutMs: 5000
  };
  const result = await probeCliProvider(config, { timeoutMs: 5000 });
  assert.equal(result.ok, false);
  assert.match(result.detail, /interactive input|interactive authentication/);
});
