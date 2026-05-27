import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readinessItems, readinessReport, summarizeReadiness, writeReadinessProbeFileNoFollow } from "../src/cli/readiness.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("readinessItems fails when the default provider command is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "missing";
    config.providers = {
      missing: {
        id: "missing",
        command: "definitely-not-a-real-viser-command",
        args: [],
        promptMode: "argument",
        timeoutMs: 1000
      }
    };
    const items = await readinessItems(config);
    assert.ok(items.some((item) => item.status === "fail" && item.area === "provider"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessReport summarizes warnings and failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-report-"));
  try {
    const config = readyConfig(dir);
    const report = await readinessReport(config);
    assert.match(report, /Viser readiness:/);
    assert.match(report, /summary:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems fails when a persistent directory is not writable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-storage-"));
  try {
    const config = readyConfig(dir);
    const filePath = join(dir, "not-a-dir");
    await writeFile(filePath, "not a directory", "utf8");
    config.storage.dir = filePath;

    const items = await readinessItems(config);
    assert.ok(items.some((item) => item.area === "storage" && item.status === "fail"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeReadinessProbeFileNoFollow refuses existing symlink probe paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-symlink-"));
  try {
    const outside = join(dir, "outside.txt");
    const link = join(dir, "probe.tmp");
    await writeFile(outside, "outside-original\n", "utf8");
    await symlink(outside, link);

    await assert.rejects(() => writeReadinessProbeFileNoFollow(link), /exists|symlink/i);
    assert.equal(await readFile(outside, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems warns when shell tool allowlist commands are missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-tool-shell-missing-"));
  try {
    const config = readyConfig(dir);
    config.tools.shell.allowedCommands = ["definitely-not-a-real-viser-tool-command"];

    const items = await readinessItems(config);

    assert.ok(items.some((item) => item.area === "tools" && item.status === "warn" && /shell commands missing/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems resolves relative PATH entries from the shell tool read root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-tool-shell-relative-path-"));
  const oldPath = process.env.PATH;
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "tool-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'TOOL_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);
    process.env.PATH = "bin";
    const config = readyConfig(dir);
    config.tools.shell.allowedCommands = ["tool-ok"];

    const items = await readinessItems(config);

    assert.ok(items.some((item) => item.area === "tools" && item.status === "pass" && /shell commands available/.test(item.message)));
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems explains how to silence an unused missing fallback provider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-unused-fallback-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "echo";
    config.assistant.fallbackProviders = ["unused"];
    config.providers = {
      echo: {
        id: "echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      unused: {
        id: "unused",
        command: "definitely-not-a-real-viser-provider-command",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "Install the unused provider."
      }
    };

    const items = await readinessItems(config);
    const warning = items.find((item) => item.area === "provider" && item.message === "unused: definitely-not-a-real-viser-provider-command missing");

    assert.equal(warning?.status, "warn");
    assert.match(warning?.next ?? "", /Install the unused provider/);
    assert.match(warning?.next ?? "", /remove 'unused' from assistant\.fallbackProviders/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems does not warn for missing providers outside the launch fallback path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-unused-provider-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "echo";
    config.assistant.fallbackProviders = [];
    config.providers = {
      echo: {
        id: "echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      unused: {
        id: "unused",
        command: "definitely-not-a-real-viser-provider-command",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "Install the unused provider."
      }
    };

    const items = await readinessItems(config);
    const unused = items.find((item) => item.area === "provider" && item.message === "unused: definitely-not-a-real-viser-provider-command missing (not in default/fallback path)");

    assert.equal(unused?.status, "pass");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems treats disabled connectors without tokens as intentionally off", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-disabled-connectors-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "echo";
    config.assistant.fallbackProviders = [];
    config.providers = {
      echo: {
        id: "echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };
    config.connectors = {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, enabled: false, botToken: undefined },
      discord: { ...DEFAULT_CONFIG.connectors.discord, enabled: false, botToken: undefined }
    };

    const items = await readinessItems(config, { live: true, probeAllProviders: true });
    const connectorItems = items.filter((item) => ["telegram", "discord", "live"].includes(item.area));

    assert.ok(items.some((item) => item.area === "telegram" && item.status === "pass" && /disabled/.test(item.message)));
    assert.ok(items.some((item) => item.area === "discord" && item.status === "pass" && /disabled/.test(item.message)));
    assert.ok(items.some((item) => item.area === "live" && item.status === "pass" && /telegram: disabled/.test(item.message)));
    assert.ok(items.some((item) => item.area === "live" && item.status === "pass" && /discord: disabled/.test(item.message)));
    assert.ok(connectorItems.every((item) => item.status === "pass"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function readyConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills")], promptLimit: 8 },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] }
  };
}


test("readinessItems can probe the default provider when requested", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "echo";
    config.providers = {
      echo: {
        id: "echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };
    const items = await readinessItems(config, { probeProviders: true });
    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "pass"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems resolves relative provider commands from provider cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-provider-cwd-"));
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "viser-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);

    const config = readyConfig(dir);
    config.assistant.defaultProvider = "relative";
    config.assistant.fallbackProviders = [];
    config.providers = {
      relative: {
        id: "relative",
        command: "./bin/viser-ok",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        cwd: dir
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });

    assert.ok(items.some((item) => item.area === "provider" && item.status === "pass" && /command found/.test(item.message)));
    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "pass" && item.message.startsWith("relative: responded")));
    assert.ok(items.some((item) => item.area === "provider-runtime" && item.status === "pass" && /relative/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems uses explicit provider PATH for provider command lookup and probes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-provider-env-path-"));
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "viser-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);

    const config = readyConfig(dir);
    config.assistant.defaultProvider = "envpath";
    config.assistant.fallbackProviders = [];
    config.providers = {
      envpath: {
        id: "envpath",
        command: "viser-ok",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        env: {
          PATH: binDir
        }
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });

    assert.ok(items.some((item) => item.area === "provider" && item.status === "pass" && /command found/.test(item.message)));
    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "pass" && item.message.startsWith("envpath: responded")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems does not accept non-sentinel provider output as runtime proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-nonsentinel-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "wrong";
    config.assistant.fallbackProviders = [];
    config.providers = {
      wrong: {
        id: "wrong",
        command: "node",
        args: ["-e", "console.log('READY BUT NOT THE SENTINEL')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });

    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "fail" && /unexpected probe response/.test(item.next ?? "")));
    assert.ok(items.some((item) => item.area === "provider-runtime" && item.status === "fail"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems can probe every provider and accept a working fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-all-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = ["good"];
    config.providers = {
      bad: {
        id: "bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      good: {
        id: "good",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });
    const probes = items.filter((item) => item.area === "provider-probe");
    const summary = summarizeReadiness(items);

    assert.equal(probes.length, 2);
    assert.ok(probes.some((item) => item.status === "warn" && item.message.startsWith("bad: failed")));
    assert.ok(probes.some((item) => item.status === "pass" && item.message.startsWith("good: responded")));
    assert.ok(items.some((item) => item.status === "pass" && item.area === "provider-runtime" && item.message.includes("good")));
    assert.equal(summary.failCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems reports missing configured providers during all-provider proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-all-missing-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "good";
    config.assistant.fallbackProviders = [];
    config.providers = {
      good: {
        id: "good",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      missing: {
        id: "missing",
        command: "definitely-not-a-real-viser-provider-command",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "Install the missing provider."
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });
    const summary = summarizeReadiness(items);

    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "pass" && item.message.startsWith("good: responded")));
    assert.ok(items.some((item) => item.area === "provider-probe" && item.status === "warn" && item.message === "missing: command 'definitely-not-a-real-viser-provider-command' missing (not in default/fallback path)"));
    assert.ok(items.some((item) => item.area === "provider-runtime" && item.status === "pass" && /good/.test(item.message)));
    assert.equal(summary.failCount, 0);
    assert.ok(summary.warnCount >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems fails all-provider probe when no default or fallback provider responds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-probe-all-fail-"));
  try {
    const config = readyConfig(dir);
    config.assistant.defaultProvider = "bad";
    config.assistant.fallbackProviders = [];
    config.providers = {
      bad: {
        id: "bad",
        command: "node",
        args: ["-e", "console.error('NOPE'); process.exit(2)"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const items = await readinessItems(config, { probeAllProviders: true });

    assert.ok(items.some((item) => item.status === "fail" && item.area === "provider-probe" && item.message.startsWith("bad: failed")));
    assert.ok(items.some((item) => item.status === "fail" && item.area === "provider-runtime"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readinessItems treats invalid configured live connector tokens as blockers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-ready-live-token-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = readyConfig(dir);
    config.connectors.telegram.botToken = "bad-token";
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "content-type": "application/json" }
    })) as typeof fetch;

    const items = await readinessItems(config, { live: true });
    const summary = summarizeReadiness(items);

    assert.ok(items.some((item) => item.status === "fail" && item.area === "live" && /telegram: Unauthorized/.test(item.message)));
    assert.equal(summary.verdict, "NOT READY");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});
