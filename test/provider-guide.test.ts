import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { providerGuideReport, providerSmokeCommand } from "../src/providers/guide.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { CliProviderConfig, ViserConfig } from "../src/core/types.ts";

test("providerSmokeCommand formats stdin providers as a pipe", () => {
  const provider: CliProviderConfig = {
    id: "stdin",
    command: "codex",
    args: ["exec", "-"],
    promptMode: "stdin",
    timeoutMs: 1000
  };

  assert.equal(
    providerSmokeCommand(provider, "VISER OK"),
    "printf '%s\\n' 'VISER OK' | codex exec -"
  );
});

test("providerSmokeCommand mirrors runtime template placeholder replacement", () => {
  const provider: CliProviderConfig = {
    id: "template",
    command: "ai-cli",
    args: ["--prompt={prompt}", "--label", "smoke"],
    promptMode: "template",
    timeoutMs: 1000
  };

  assert.equal(
    providerSmokeCommand(provider, "VISER OK"),
    "ai-cli '--prompt=VISER OK' --label smoke"
  );
});

test("providerSmokeCommand scopes manual smoke tests to provider cwd", () => {
  const provider: CliProviderConfig = {
    id: "relative",
    command: "./bin/ai-cli",
    args: [],
    promptMode: "argument",
    timeoutMs: 1000,
    cwd: "/tmp/provider cwd"
  };

  assert.equal(
    providerSmokeCommand(provider, "VISER OK"),
    "(cd '/tmp/provider cwd' && ./bin/ai-cli 'VISER OK')"
  );
});

test("providerGuideReport shows install, smoke, and skipped probe guidance", async () => {
  const report = await providerGuideReport(guideConfig());

  assert.match(report, /Viser provider login guide/);
  assert.match(report, /## echo: Echo/);
  assert.match(report, /installed: yes/);
  assert.match(report, /manual smoke test:/);
  assert.match(report, /probe: skipped/i);
});

test("providerGuideReport can probe a configured provider", async () => {
  const report = await providerGuideReport(guideConfig(), { providerId: "echo", probe: true, timeoutMs: 5000 });

  assert.match(report, /## echo: Echo/);
  assert.match(report, /Viser probe: pass/);
  assert.match(report, /VISER_OK/);
});

test("providerGuideReport classifies sandbox and permission failures", async () => {
  const config = guideConfig();
  config.providers.blocked = {
    id: "blocked",
    label: "Blocked",
    command: "node",
    args: ["-e", "console.error('Operation not permitted'); process.exit(1)"],
    promptMode: "argument",
    timeoutMs: 5000
  };

  const report = await providerGuideReport(config, { providerId: "blocked", probe: true, timeoutMs: 5000 });

  assert.match(report, /Viser probe: fail/);
  assert.match(report, /detected issue: sandbox\/permission failure/);
  assert.match(report, /manual smoke test:/);
  assert.match(report, /viser verify --live --probe-all-providers/);
  assert.match(report, /viser launch-status/);
});

test("providerGuideReport classifies interactive login prompts", async () => {
  const config = guideConfig();
  config.providers.login = {
    id: "login",
    label: "Login",
    command: "node",
    args: ["-e", "console.log('Opening authentication page in your browser. Do you want to continue? [Y/n]:'); setInterval(() => {}, 1000)"],
    promptMode: "argument",
    timeoutMs: 5000
  };

  const report = await providerGuideReport(config, { providerId: "login", probe: true, timeoutMs: 5000 });

  assert.match(report, /Viser probe: fail/);
  assert.match(report, /detected issue: interactive login required/);
  assert.match(report, /complete the browser\/account login flow/);
});

test("providerGuideReport probes relative provider commands from provider cwd", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-provider-guide-cwd-"));
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "viser-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);

    const config = guideConfig();
    config.assistant.defaultProvider = "relative";
    config.providers = {
      relative: {
        id: "relative",
        label: "Relative",
        command: "./bin/viser-ok",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        cwd: dir
      }
    };

    const report = await providerGuideReport(config, { providerId: "relative", probe: true, timeoutMs: 5000 });

    assert.match(report, /## relative: Relative/);
    assert.match(report, /installed: yes/);
    assert.match(report, /manual smoke test: \(cd /);
    assert.match(report, /Viser probe: pass/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("providerGuideReport uses explicit provider PATH for command lookup and probes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-provider-guide-env-path-"));
  try {
    const binDir = join(dir, "bin");
    const commandPath = join(binDir, "viser-ok");
    await mkdir(binDir, { recursive: true });
    await writeFile(commandPath, "#!/bin/sh\nprintf 'VISER_OK\\n'\n", "utf8");
    await chmod(commandPath, 0o700);

    const config = guideConfig();
    config.assistant.defaultProvider = "envpath";
    config.providers = {
      envpath: {
        id: "envpath",
        label: "EnvPath",
        command: "viser-ok",
        args: [],
        promptMode: "argument",
        timeoutMs: 5000,
        env: {
          PATH: binDir
        }
      }
    };

    const report = await providerGuideReport(config, { providerId: "envpath", probe: true, timeoutMs: 5000 });

    assert.match(report, /## envpath: EnvPath/);
    assert.match(report, /installed: yes/);
    assert.match(report, /Viser probe: pass/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("providerGuideReport reports unknown provider ids", async () => {
  const report = await providerGuideReport(guideConfig(), { providerId: "missing" });

  assert.match(report, /Unknown provider 'missing'/);
  assert.match(report, /echo/);
});

test("providerGuideReport probes providers sequentially to avoid overlapping interactive CLIs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-provider-guide-seq-"));
  try {
    const logPath = join(dir, "probe.log");
    const config = guideConfig();
    config.assistant.defaultProvider = "slow";
    config.providers = {
      slow: {
        id: "slow",
        label: "Slow",
        command: "node",
        args: [
          "-e",
          "const fs=require('fs'); const p=process.argv[1]; fs.appendFileSync(p,'start-slow\\n'); setTimeout(()=>{fs.appendFileSync(p,'end-slow\\n'); console.log('VISER_OK');},120);",
          logPath
        ],
        promptMode: "argument",
        timeoutMs: 5000
      },
      fast: {
        id: "fast",
        label: "Fast",
        command: "node",
        args: [
          "-e",
          "const fs=require('fs'); const p=process.argv[1]; fs.appendFileSync(p,'start-fast\\n'); console.log('VISER_OK');",
          logPath
        ],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };

    const report = await providerGuideReport(config, { probe: true, timeoutMs: 5000 });
    const events = (await readFile(logPath, "utf8")).trim().split(/\r?\n/);

    assert.match(report, /## slow: Slow/);
    assert.match(report, /## fast: Fast/);
    assert.deepEqual(events, ["start-slow", "end-slow", "start-fast"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function guideConfig(): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo" },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
}
