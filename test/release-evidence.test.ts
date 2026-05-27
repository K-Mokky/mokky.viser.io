import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { releaseEvidence, releaseEvidenceReport } from "../src/cli/release-evidence.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("releaseEvidenceReport summarizes public release readiness without local paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-"));
  try {
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir: process.cwd() });

    assert.match(report, /Viser public release evidence: READY/);
    assert.match(report, /safe-to-paste: yes/);
    assert.match(report, /creator: KMokky/);
    assert.match(report, /Logged-in local CLI providers only/);
    assert.match(report, /Goal completion audit:/);
    assert.match(report, /status: UNPROVEN/);
    assert.match(report, /\[messenger\] Run `node src\/index\.ts release-evidence --strict --live --probe-all-providers`/);
    assert.match(report, /Objective evidence matrix:/);
    assert.match(report, /\[assistant-core\] OpenClaw\/Hermes-like local CLI assistant core works end-to-end/);
    assert.match(report, /\[local-cli-no-model-api\] GPT\/Codex, Gemini, and Claude use logged-in local CLIs instead of model API keys/);
    assert.match(report, /\[open-source-privacy\] GitHub\/npm public release excludes private runtime state and sensitive personal data/);
    assert.match(report, /\[objective\] GPT\/Codex route uses exact logged-in local codex CLI provider/);
    assert.match(report, /\[security\] prompt guard blocks high-risk injection before provider handoff/);
    assert.match(report, /\[messenger-outbound\] approval-gated Telegram\/Discord outbound messages use connector senders/);
    assert.match(report, /\[telegram\] Telegram handler routes an allowed chat through AssistantRuntime and Bot API send/);
    assert.match(report, /\[discord\] Discord handler routes an allowed channel through AssistantRuntime and REST send/);
    assert.match(report, /\[objective\] Telegram connector source is present/);
    assert.match(report, /\[objective\] prompt injection guard source is present/);
    assert.match(report, /\[public-example\] \.env\.example excludes model API key variables/);
    assert.match(report, /\[public-example\] config example provider env excludes model API key variables/);
    assert.match(report, /\[security-doc\] SECURITY\.md documents local CLI model access and no model API key boundary/);
    assert.match(report, /\[security-doc\] SECURITY\.md documents prompt-injection defenses/);
    assert.match(report, /\[security-doc\] SECURITY\.md tells reporters not to disclose tokens or private state/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md limits public identity to Viser and KMokky creator credit/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md identifies local runtime state that must stay private/);
    assert.match(report, /\[privacy-doc\] PRIVACY\.md tells users not to publish tokens, handles, emails, or local paths/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md tells contributors to preserve local CLI model access/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md tells contributors not to commit private data/);
    assert.match(report, /\[contributing-doc\] CONTRIBUTING\.md lists required verification commands/);
    assert.match(report, /\[github-template\] \.github\/ISSUE_TEMPLATE\/bug_report\.yml is present/);
    assert.match(report, /\[github-template\] GitHub bug report template warns against private data disclosure/);
    assert.match(report, /\[github-template\] GitHub PR template preserves local CLI\/no model API boundary/);
    assert.match(report, /\[github-template\] GitHub PR template lists release verification commands/);
    assert.match(report, /\[release-ignore\] \.gitignore excludes \.omx\//);
    assert.match(report, /\[release-ignore\] \.gitignore excludes \.npmrc/);
    assert.match(report, /\[release-ignore\] \.npmignore excludes \.npmrc/);
    assert.match(report, /package: viser@0\.1\.0/);
    assert.match(report, /node src\/index\.ts release-evidence/);
    assert.match(report, /node src\/index\.ts release-evidence --strict --live --probe-all-providers/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(dir)));
    assert.doesNotMatch(report, /\/Users\/[^/\s]+/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidenceReport can emit safe machine-readable JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-json-"));
  try {
    const parsed = JSON.parse(await releaseEvidenceReport(testConfig(dir), { rootDir: process.cwd(), json: true })) as {
      ok: boolean;
      safeToPaste: boolean;
      creator: string;
      modelAccessRule: string;
      package: { filesCount: number };
      providers: Array<{ command: string }>;
      verification: {
        proof: { live: boolean; probeProviders: boolean; probeAllProviders: boolean };
        smokeChecks: Array<{ area: string; status: string; message: string }>;
        proofChecks: Array<{ area: string; status: string; message: string }>;
      };
      checks: Array<{ area: string; message: string; status: string }>;
      objectiveMatrix: Array<{ id: string; status: string; evidence: string[]; remaining: string[] }>;
      completion: { status: string; blockers: string[]; remainingProof: string[] };
    };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.safeToPaste, true);
    assert.equal(parsed.creator, "KMokky");
    assert.match(parsed.modelAccessRule, /local CLI/);
    assert.equal(parsed.package.filesCount, 12);
    assert.deepEqual(parsed.verification.proof, { live: false, probeProviders: false, probeAllProviders: false });
    assert.deepEqual(parsed.verification.proofChecks, []);
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "security"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "messenger-outbound"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "telegram"));
    assert.ok(parsed.verification.smokeChecks.some((check) => check.status === "pass" && check.area === "discord"));
    assert.ok(parsed.providers.every((provider) => !provider.command.includes("/")));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "objective" && /Gemini route/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "public-example" && /\.env\.example excludes model API key variables/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "public-example" && /config example provider env excludes model API key variables/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include SECURITY\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include PRIVACY\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include CONTRIBUTING\.md/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "package" && /package files include assets/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.gitignore excludes \.omx\//.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.gitignore excludes \.npmrc/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "release-ignore" && /\.npmignore excludes \.npmrc/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /local CLI model access/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /prompt-injection defenses/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "security-doc" && /tokens or private state/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /public identity/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /runtime state/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "privacy-doc" && /tokens, handles, emails, or local paths/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /local CLI model access/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /private data/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "contributing-doc" && /verification commands/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /bug_report\.yml is present/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /bug report template warns/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /PR template preserves local CLI\/no model API/.test(check.message)));
    assert.ok(parsed.checks.some((check) => check.status === "pass" && check.area === "github-template" && /PR template lists release verification/.test(check.message)));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "assistant-core" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "messenger" && item.status === "pass" && item.remaining.some((remaining) => /real connector token validation/.test(remaining))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "local-cli-no-model-api" && item.status === "pass" && item.remaining.some((remaining) => /logged-in CLI runtime proof/.test(remaining))));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "prompt-injection-security" && item.status === "pass"));
    assert.ok(parsed.objectiveMatrix.some((item) => item.id === "open-source-privacy" && item.status === "pass"));
    assert.equal(parsed.completion.status, "unproven");
    assert.deepEqual(parsed.completion.blockers, []);
    assert.ok(parsed.completion.remainingProof.some((remaining) => /^\[messenger\]/.test(remaining)));
    assert.ok(parsed.completion.remainingProof.some((remaining) => /^\[local-cli-no-model-api\]/.test(remaining)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence blocks unsafe package metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-blocked-"));
  try {
    const rootDir = join(dir, "repo");
    await mkdir(rootDir, { recursive: true });
    await writeFile(join(rootDir, "package.json"), JSON.stringify({
      name: "viser-private",
      version: "0.0.0",
      private: true,
      author: "Someone",
      license: "UNLICENSED",
      bin: {},
      files: [".env", "src"]
    }), "utf8");
    await writeFile(join(rootDir, ".npmignore"), "", "utf8");

    const result = await releaseEvidence(testConfig(dir), { rootDir });
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir });

    assert.equal(result.ok, false);
    assert.ok(result.checks.some((check) => check.status === "fail" && /private=false/.test(check.message)));
    assert.ok(result.checks.some((check) => check.status === "fail" && /exclude \.env/.test(check.message)));
    assert.match(report, /Viser public release evidence: BLOCKED/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(rootDir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence blocks model API keys in public examples", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-public-example-"));
  try {
    const rootDir = join(dir, "repo");
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeFile(join(rootDir, "package.json"), JSON.stringify({
      name: "viser",
      version: "0.1.0",
      private: false,
      author: "KMokky",
      license: "MIT",
      bin: { viser: "./src/index.ts" },
      files: [".env.example", "README.md", "SECURITY.md", "PRIVACY.md", "CONTRIBUTING.md", "assets", "config", "plugins", "skills", "src", "tools", "tsconfig.json"]
    }), "utf8");
    await writeFile(join(rootDir, ".npmignore"), ".viser/\n.omx/\n.env\nviser.config.json\n", "utf8");
    await writeFile(join(rootDir, ".env.example"), "OPENAI_API_KEY=sk-example\nTELEGRAM_BOT_TOKEN=\n", "utf8");
    await writeFile(join(rootDir, "config", "viser.config.example.json"), JSON.stringify({
      providers: {
        codex: {
          command: "codex",
          env: { ANTHROPIC_API_KEY: "not-used" }
        }
      }
    }), "utf8");

    const result = await releaseEvidence(testConfig(dir), { rootDir });
    const report = await releaseEvidenceReport(testConfig(dir), { rootDir });

    assert.equal(result.ok, false);
    assert.equal(
      result.checks.find((check) => check.message === ".env.example excludes model API key variables")?.status,
      "fail"
    );
    assert.equal(
      result.checks.find((check) => check.message === "config example provider env excludes model API key variables")?.status,
      "fail"
    );
    assert.match(report, /Viser public release evidence: BLOCKED/);
    assert.doesNotMatch(report, /sk-example/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(rootDir)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence requires exact local CLI command basenames for objective routes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-route-"));
  try {
    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, command: "codex-api-wrapper" };

    const result = await releaseEvidence(config, { rootDir: process.cwd() });

    assert.equal(result.ok, false);
    assert.equal(
      result.checks.find((check) => /GPT\/Codex route uses exact logged-in local codex CLI provider/.test(check.message))?.status,
      "fail"
    );
    assert.equal(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.status, "fail");
    assert.equal(result.completion.status, "unproven");
    assert.ok(result.completion.blockers.some((blocker) => /local-cli-no-model-api/.test(blocker)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence can include live all-provider local CLI proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-live-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");
    await writeProbeCli(binDir, "claude");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };

    const result = await releaseEvidence(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.verification.proof, { live: true, probeProviders: false, probeAllProviders: true });
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "provider-probe" && check.message === "gpt: responded through local CLI probe"));
    assert.ok(result.verification.proofChecks.some((check) => check.status === "pass" && check.area === "live" && check.message === "telegram: disabled (no token configured)"));
    assert.match(report, /ℹ️ \[live\] telegram: disabled \(no token configured\)/);
    assert.equal(result.verification.readiness.failCount, 0);
    assert.deepEqual(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.remaining, []);
    assert.ok(result.objectiveMatrix.find((item) => item.id === "messenger")?.remaining.some((remaining) => /telegram live token was not accepted/.test(remaining)));
    assert.ok(result.objectiveMatrix.find((item) => item.id === "messenger")?.remaining.some((remaining) => /discord live token was not accepted/.test(remaining)));
    assert.equal(result.completion.status, "unproven");
    assert.ok(result.completion.remainingProof.some((remaining) => /telegram live token was not accepted/.test(remaining) && /TELEGRAM_BOT_TOKEN/.test(remaining)));
    assert.ok(result.completion.remainingProof.some((remaining) => /discord live token was not accepted/.test(remaining) && /DISCORD_BOT_TOKEN/.test(remaining)));
    assert.ok(result.recommendedCommands.includes("node src/index.ts release-evidence --strict --live --probe-all-providers"));
    assert.ok(result.recommendedCommands.includes("node src/index.ts release-evidence --live --probe-all-providers"));
    assert.ok(result.recommendedCommands.includes("node src/index.ts next-steps --live --probe-all-providers"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence surfaces missing configured provider commands during all-provider proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-missing-provider-"));
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };

    const result = await releaseEvidence(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });

    const claudeProof = result.verification.proofChecks.find((check) => check.status === "warn" && check.area === "provider-probe" && /claude: command 'claude' missing/.test(check.message));
    assert.ok(claudeProof);
    assert.match(claudeProof.next ?? "", /provider-guide claude --probe/);
    assert.equal(result.objectiveMatrix.find((item) => item.id === "local-cli-no-model-api")?.status, "fail");
    assert.ok(result.completion.blockers.some((blocker) => /local-cli-no-model-api/.test(blocker)));
    assert.ok(result.completion.remainingProof.some((proof) => /Claude live provider probe did not pass/.test(proof) && /provider-guide claude --probe/.test(proof)));
    assert.match(report, /⚠️ \[provider-probe\] claude: command 'claude' missing/);
    assert.match(report, /next: .*provider-guide claude --probe/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence redacts live connector identities in safe-to-paste proof checks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-live-redact-"));
  const originalFetch = globalThis.fetch;
  try {
    const config = testConfig(dir);
    config.providers = {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      }
    };
    config.assistant.defaultProvider = "echo";
    config.assistant.fallbackProviders = [];
    config.connectors.telegram = {
      ...config.connectors.telegram,
      enabled: true,
      botToken: "123456:telegram-live-secret",
      botTokenEnv: "TELEGRAM_BOT_TOKEN"
    };
    config.connectors.discord = {
      ...config.connectors.discord,
      enabled: true,
      botToken: "discord-live-secret-token",
      botTokenEnv: "DISCORD_BOT_TOKEN"
    };

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({
          ok: true,
          result: { username: "private_viser_bot" }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("discord.com")) {
        return new Response(JSON.stringify({ username: "private-discord-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const report = await releaseEvidenceReport(config, {
      rootDir: process.cwd(),
      json: true,
      verifyOptions: { live: true, probeProviders: true }
    });
    const parsed = JSON.parse(report) as {
      verification: { proofChecks: Array<{ area: string; status: string; message: string }> };
      objectiveMatrix: Array<{ id: string; status: string; remaining: string[] }>;
    };

    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "telegram: live token accepted"));
    assert.ok(parsed.verification.proofChecks.some((check) => check.area === "live" && check.message === "discord: live token accepted"));
    assert.deepEqual(parsed.objectiveMatrix.find((item) => item.id === "messenger")?.remaining, []);
    assert.doesNotMatch(report, /private_viser_bot/);
    assert.doesNotMatch(report, /private-discord-bot/);
    assert.doesNotMatch(report, /telegram-live-secret|discord-live-secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test("releaseEvidence marks objective completion proven only when live provider and connector proof are present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-release-evidence-complete-"));
  const originalFetch = globalThis.fetch;
  try {
    const binDir = join(dir, "bin");
    await mkdir(binDir, { recursive: true });
    await writeProbeCli(binDir, "codex");
    await writeProbeCli(binDir, "gemini");
    await writeProbeCli(binDir, "claude");

    const config = testConfig(dir);
    config.providers.gpt = { ...config.providers.gpt, env: { PATH: binDir } };
    config.providers.gemini = { ...config.providers.gemini, env: { PATH: binDir } };
    config.providers.claude = { ...config.providers.claude, env: { PATH: binDir } };
    config.connectors.telegram = {
      ...config.connectors.telegram,
      enabled: true,
      botToken: "123456:telegram-live-secret",
      botTokenEnv: "TELEGRAM_BOT_TOKEN"
    };
    config.connectors.discord = {
      ...config.connectors.discord,
      enabled: true,
      botToken: "discord-live-secret-token",
      botTokenEnv: "DISCORD_BOT_TOKEN"
    };

    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        return new Response(JSON.stringify({ ok: true, result: { username: "private_viser_bot" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.includes("discord.com")) {
        return new Response(JSON.stringify({ username: "private-discord-bot" }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const result = await releaseEvidence(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });
    const report = await releaseEvidenceReport(config, {
      rootDir: process.cwd(),
      verifyOptions: { live: true, probeAllProviders: true }
    });

    assert.equal(result.ok, true);
    assert.equal(result.completion.status, "proven");
    assert.deepEqual(result.completion.blockers, []);
    assert.deepEqual(result.completion.remainingProof, []);
    assert.match(report, /status: PROVEN/);
    assert.doesNotMatch(report, /private_viser_bot|private-discord-bot|telegram-live-secret|discord-live-secret-token/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

function testConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell } },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] }
    },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000
      },
      gpt: {
        id: "gpt",
        label: "GPT through Codex CLI",
        command: "codex",
        args: ["exec", "-"],
        promptMode: "stdin",
        timeoutMs: 5000
      },
      gemini: {
        id: "gemini",
        label: "Gemini CLI",
        command: "gemini",
        args: ["--prompt", "{prompt}"],
        promptMode: "template",
        timeoutMs: 5000
      },
      claude: {
        id: "claude",
        label: "Claude Code CLI",
        command: "claude",
        args: ["-p", "{prompt}"],
        promptMode: "template",
        timeoutMs: 5000
      }
    }
  };
}

async function writeProbeCli(binDir: string, name: string): Promise<void> {
  const path = join(binDir, name);
  await writeFile(path, "#!/bin/sh\nprintf '%s\\n' VISER_OK\n", "utf8");
  await chmod(path, 0o755);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
