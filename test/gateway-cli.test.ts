import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const execFile = promisify(execFileCallback);

test("gateway --dry-run --strict runs the no-start preflight gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-cli-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);
    const { stdout } = await runViser(["--config", configPath, "gateway", "--dry-run", "--strict", "--probe-all-providers"]);

    assert.match(stdout, /Viser preflight: PASS/);
    assert.match(stdout, /mode: check-only/);
    assert.match(stdout, /no gateway, scheduler, job worker, or connector process was started/);
    assert.match(stdout, /live connector token proof: requested/);
    assert.match(stdout, /provider runtime proof: requested/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway --dry-run --strict exits non-zero when the strict gate is blocked", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-cli-blocked-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);

    await assert.rejects(
      runViser(["--config", configPath, "gateway", "--dry-run", "--strict", "--probe-all-providers"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /Do not launch yet/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway defaults to provider-proof preflight before starting foreground workers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-default-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"], { loopsEnabled: false });
    const { stdout } = await runViser(["--config", configPath, "gateway"]);

    assert.match(stdout, /Viser preflight: PASS/);
    assert.match(stdout, /live connector token proof: requested/);
    assert.match(stdout, /provider runtime proof: requested/);
    assert.match(stdout, /No gateway connectors, scheduler, job worker, or web dashboard are enabled/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("commandless configured invocation starts the foreground gateway runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-commandless-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"], { loopsEnabled: false });
    const { stdout } = await runViser(["--config", configPath]);

    assert.match(stdout, /Viser preflight: PASS/);
    assert.match(stdout, /No gateway connectors, scheduler, job worker, or web dashboard are enabled/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway blocks by default when provider proof fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-default-blocked-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"], { loopsEnabled: false });

    await assert.rejects(
      runViser(["--config", configPath, "gateway"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /live connector token proof: requested/);
        assert.match(failure.stdout ?? "", /provider runtime proof: requested/);
        assert.doesNotMatch(failure.stdout ?? "", /No gateway connectors/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("gateway --unsafe-skip-gate keeps an explicit raw foreground escape hatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-gateway-raw-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"], { loopsEnabled: false });
    const { stderr, stdout } = await runViser(["--config", configPath, "gateway", "--unsafe-skip-gate"]);

    assert.match(stderr, /provider\/runtime proof was skipped/);
    assert.match(stdout, /No gateway connectors, scheduler, job worker, or web dashboard are enabled/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("job-worker defaults to provider-proof preflight before starting the loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-job-worker-gate-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);

    await assert.rejects(
      runViser(["--config", configPath, "job-worker"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /live connector token proof: requested/);
        assert.match(failure.stdout ?? "", /provider runtime proof: requested/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser job worker is running/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("job-worker rejects invalid parallelism before provider preflight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-job-worker-parallel-invalid-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);

    await assert.rejects(
      runViser(["--config", configPath, "job-worker", "--parallel", "99"]),
      (error) => {
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /Usage: viser job-worker/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser preflight/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("scheduler defaults to provider-proof preflight before starting the loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-gate-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);

    await assert.rejects(
      runViser(["--config", configPath, "scheduler"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /live connector token proof: requested/);
        assert.match(failure.stdout ?? "", /provider runtime proof: requested/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser scheduler is running/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("telegram command reports a missing token before starting a bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-telegram-token-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);

    await assert.rejects(
      runViser(["--config", configPath, "telegram"]),
      (error) => {
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /Telegram token is missing/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser preflight/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("slack command reports missing Socket Mode tokens before starting a bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-slack-token-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);

    await assert.rejects(
      runViser(["--config", configPath, "slack"]),
      (error) => {
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /Slack bot token is missing/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser preflight/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("whatsapp command reports missing Cloud API credentials before starting a bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-whatsapp-token-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);

    await assert.rejects(
      runViser(["--config", configPath, "whatsapp"]),
      (error) => {
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /WhatsApp access token is missing/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser preflight/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("line command reports missing Messaging API credentials before starting a bridge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-line-token-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);

    await assert.rejects(
      runViser(["--config", configPath, "line"]),
      (error) => {
        const failure = error as { code?: number; stderr?: string; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stderr ?? "", /LINE channel access token is missing/);
        assert.doesNotMatch(failure.stdout ?? "", /Viser preflight/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reset command clears the CLI session without provider access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-reset-cli-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const { stdout } = await runViser(["--config", configPath, "reset"]);

    assert.match(stdout, /history was cleared/);
    assert.doesNotMatch(stdout, /All provider attempts failed/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard command summarizes state without provider access or preflight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-dashboard-cli-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const { stdout } = await runViser(["--config", configPath, "dashboard"]);

    assert.match(stdout, /Viser dashboard/);
    assert.match(stdout, /schema: dashboard\.v1/);
    assert.match(stdout, /Runtime/);
    assert.match(stdout, /jobs: pending=0, running=0, done=0, failed=0, cancelled=0/);
    assert.match(stdout, /Final live verdict: `viser launch-status`/);
    assert.doesNotMatch(stdout, /All provider attempts failed/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dashboard --json exposes machine-readable state without provider access or preflight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-dashboard-json-cli-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const { stdout } = await runViser(["--config", configPath, "dashboard", "--json"]);
    const data = JSON.parse(stdout);

    assert.equal(data.assistantName, "Viser");
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.provider, "echo");
    assert.equal(data.capabilities.readOnly, true);
    assert.equal(data.capabilities.providerCalls, false);
    assert.equal(data.runtime.jobWorker.enabled, true);
    assert.equal(data.state.jobs.pending, 0);
    assert.equal(data.state.pendingApprovals.count, 0);
    const echoProvider = data.providers.find((provider: { id: string }) => provider.id === "echo");
    assert.equal(echoProvider?.launchRoute, true);
    assert.ok(Array.isArray(data.nextCommands));
    assert.doesNotMatch(stdout, /All provider attempts failed/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("delete-action command routes without provider access", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-delete-action-cli-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const proposed = await runViser(["--config", configPath, "propose", "write-file", "cli-action.txt", "hello"]);
    const actionId = proposed.stdout.match(/\[([a-f0-9-]+)\]/)?.[1] ?? "";
    await runViser(["--config", configPath, "reject", actionId]);
    const { stdout } = await runViser(["--config", configPath, "delete-action", actionId]);

    assert.match(stdout, /Deleted decided action/);
    assert.doesNotMatch(stdout, /All provider attempts failed/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run-jobs blocks before consuming pending jobs when provider proof fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-run-jobs-gate-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    await runViser(["--config", configPath, "enqueue", "queued work"]);

    await assert.rejects(
      runViser(["--config", configPath, "run-jobs", "1"]),
      (error) => {
        const failure = error as { code?: number; stdout?: string };
        assert.equal(failure.code, 1);
        assert.match(failure.stdout ?? "", /Viser preflight: BLOCKED/);
        assert.match(failure.stdout ?? "", /live connector token proof: requested/);
        assert.match(failure.stdout ?? "", /provider runtime proof: requested/);
        assert.doesNotMatch(failure.stdout ?? "", /\[.*\] failed/);
        return true;
      }
    );

    const { stdout } = await runViser(["--config", configPath, "jobs", "pending"]);
    assert.match(stdout, /pending attempts=0/);
    assert.match(stdout, /queued work/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run-jobs skips provider proof when there is no pending work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-run-jobs-empty-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const { stdout } = await runViser(["--config", configPath, "run-jobs", "1"]);

    assert.match(stdout, /No pending jobs/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run-jobs --unsafe-skip-gate can attempt pending work and defer provider outages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-run-jobs-raw-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    await runViser(["--config", configPath, "enqueue", "queued raw work"]);
    const { stderr, stdout } = await runViser(["--config", configPath, "run-jobs", "1", "--unsafe-skip-gate"]);
    const pending = await runViser(["--config", configPath, "jobs", "pending"]);

    assert.match(stderr, /provider\/runtime proof was skipped/);
    assert.match(stdout, /Running 1 job/);
    assert.match(stdout, /deferred: provider unavailable/);
    assert.doesNotMatch(stdout, /Viser preflight/);
    assert.match(pending.stdout, /pending attempts=1/);
    assert.match(pending.stdout, /next attempt:/);
    assert.match(pending.stdout, /last error: All provider attempts failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("run-jobs forwards bounded parallelism from CLI flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-run-jobs-parallel-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "console.log('VISER_OK')"]);
    await runViser(["--config", configPath, "enqueue", "parallel cli one"]);
    await runViser(["--config", configPath, "enqueue", "parallel cli two"]);

    const { stdout } = await runViser(["--config", configPath, "run-jobs", "2", "--parallel", "2", "--unsafe-skip-gate"]);

    assert.match(stdout, /Running 2 job\(s\) with parallelism 2/);
    assert.match(stdout, /done/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service-run is disabled and never starts the background gateway", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-run-blocked-"));
  try {
    const configPath = await writeCliConfig(dir, ["-e", "process.exit(2)"]);
    const { stdout } = await runViser(["--config", configPath, "service-run", "--probe-all-providers"]);

    assert.match(stdout, /Viser service-run: disabled/);
    assert.match(stdout, /no longer installs, starts, or runs a background service/);
    assert.match(stdout, /Start Viser only in a foreground terminal window/);
    assert.doesNotMatch(stdout, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function runViser(args: string[]) {
  const emptyEnvPath = join(tmpdir(), "viser-gateway-test-empty.env");
  await writeFile(emptyEnvPath, "", "utf8");
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    VISER_ENV: emptyEnvPath,
    TELEGRAM_BOT_TOKEN: "",
    DISCORD_BOT_TOKEN: ""
  };
  delete childEnv.VISER_CONFIG;
  delete childEnv.VISER_PROVIDER;

  return execFile(process.execPath, ["src/index.ts", ...args], {
    cwd: process.cwd(),
    timeout: 45_000,
    env: childEnv
  });
}

async function writeCliConfig(
  dir: string,
  providerArgs: string[],
  options: { loopsEnabled?: boolean } = {}
): Promise<string> {
  const loopsEnabled = options.loopsEnabled ?? true;
  const config: ViserConfig = {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, enabled: loopsEnabled, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, enabled: loopsEnabled, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] },
      slack: { ...DEFAULT_CONFIG.connectors.slack, allowedChannelIds: [], defaultChannelIds: [] },
      matrix: { ...DEFAULT_CONFIG.connectors.matrix, allowedRoomIds: [], defaultRoomIds: [] },
      signal: { ...DEFAULT_CONFIG.connectors.signal, allowedRecipientIds: [], defaultRecipientIds: [] },
      imessage: { ...DEFAULT_CONFIG.connectors.imessage, allowedHandleIds: [], defaultHandleIds: [] },
      whatsapp: { ...DEFAULT_CONFIG.connectors.whatsapp, allowedRecipientIds: [], defaultRecipientIds: [] },
      line: { ...DEFAULT_CONFIG.connectors.line, allowedPeerIds: [], defaultPeerIds: [] },
      kakaotalk: { ...DEFAULT_CONFIG.connectors.kakaotalk, allowedUserIds: [], defaultUserIds: [] },
      googleChat: { ...DEFAULT_CONFIG.connectors.googleChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      webhook: { ...DEFAULT_CONFIG.connectors.webhook, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      homeAssistant: { ...DEFAULT_CONFIG.connectors.homeAssistant, baseUrl: undefined, accessToken: undefined, service: undefined, services: {}, allowedServiceIds: [], defaultServiceIds: [] },
      teams: { ...DEFAULT_CONFIG.connectors.teams, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      mattermost: { ...DEFAULT_CONFIG.connectors.mattermost, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      synologyChat: { ...DEFAULT_CONFIG.connectors.synologyChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      rocketChat: { ...DEFAULT_CONFIG.connectors.rocketChat, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      feishu: { ...DEFAULT_CONFIG.connectors.feishu, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      dingtalk: { ...DEFAULT_CONFIG.connectors.dingtalk, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      wecom: { ...DEFAULT_CONFIG.connectors.wecom, webhookUrl: undefined, webhookUrls: {}, allowedWebhookIds: [], defaultWebhookIds: [] },
      zalo: { ...DEFAULT_CONFIG.connectors.zalo, accessToken: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      irc: { ...DEFAULT_CONFIG.connectors.irc, host: undefined, nick: undefined, password: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      twitch: { ...DEFAULT_CONFIG.connectors.twitch, enabled: false, accessToken: undefined, botUsername: undefined, channel: undefined, channels: {}, allowedChannelIds: [], defaultChannelIds: [] },
      ntfy: { ...DEFAULT_CONFIG.connectors.ntfy, enabled: false, token: undefined, topic: undefined, topics: {}, allowedTopicIds: [], defaultTopicIds: [] },
      mastodon: { ...DEFAULT_CONFIG.connectors.mastodon, enabled: false, baseUrl: undefined, accessToken: undefined, visibility: "private", targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      nextcloudTalk: { ...DEFAULT_CONFIG.connectors.nextcloudTalk, baseUrl: undefined, username: undefined, appPassword: undefined, roomToken: undefined, rooms: {}, allowedRoomIds: [], defaultRoomIds: [] },
      webex: { ...DEFAULT_CONFIG.connectors.webex, accessToken: undefined, allowedRoomIds: [], defaultRoomIds: [] },
      zulip: { ...DEFAULT_CONFIG.connectors.zulip, siteUrl: undefined, botEmail: undefined, apiKey: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      email: { ...DEFAULT_CONFIG.connectors.email, enabled: false, from: undefined, recipient: undefined, recipients: {}, allowedRecipientIds: [], defaultRecipientIds: [] },
      github: { ...DEFAULT_CONFIG.connectors.github, enabled: false, token: undefined, target: undefined, targets: {}, allowedTargetIds: [], defaultTargetIds: [] },
      todoist: { ...DEFAULT_CONFIG.connectors.todoist, enabled: false, token: undefined, project: undefined, projects: {}, allowedProjectIds: [], defaultProjectIds: [] },
      notion: { ...DEFAULT_CONFIG.connectors.notion, enabled: false, token: undefined, page: undefined, pages: {}, allowedPageIds: [], defaultPageIds: [] },
      obsidian: { ...DEFAULT_CONFIG.connectors.obsidian, enabled: false, vaultDir: undefined, note: undefined, notes: {}, allowedNoteIds: [], defaultNoteIds: [] }
    },
    providers: {
      echo: {
        id: "echo",
        label: "Echo",
        command: "node",
        args: providerArgs,
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    }
  };
  const configPath = join(dir, "viser.config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  return configPath;
}
