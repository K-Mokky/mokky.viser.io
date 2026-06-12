import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  installService,
  reinstallService,
  removeLaunchAgentPlist,
  serviceCommand,
  serviceLabel,
  trimServiceLogs,
  userLaunchAgentPath,
  userSystemdUnitPath
} from "../src/cli/service.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const FAKE_TELEGRAM_TOKEN = `123456:${"abcdefghijklmnopqrstuvwxyzABCDE"}`;
const FAKE_MODEL_API_KEY = `sk-${"1234567890abcdefghijklmnop"}`;
import type { RunCommandOptions, RunCommandResult } from "../src/utils/exec.ts";

test("service module no longer exports background service artifact creators", async () => {
  const serviceModule = await import("../src/cli/service.ts");
  const removedExports = [
    "generateLaunchdPlist",
    "generateSystemdUserService",
    "generateWindowsServiceRunner",
    "generateWindowsTaskXml",
    "installLaunchAgentPlist",
    "installSystemdService",
    "installSystemdUserUnit",
    "installWindowsService",
    "servicePathValue",
    "windowsRunnerPath",
    "writeWorkspacePlist",
    "writeWorkspaceSystemdService",
    "writeWorkspaceWindowsService"
  ];

  for (const name of removedExports) {
    assert.equal(name in serviceModule, false, `${name} must not be exported`);
  }
});

test("service artifact commands are disabled and do not create workspace service files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-artifacts-disabled-"));
  try {
    const config = serviceConfig(dir);
    const commands = ["plist", "write-plist", "systemd", "write-systemd", "windows", "write-windows"];

    for (const command of commands) {
      const report = await serviceCommand([command], config);
      assert.match(report, new RegExp(`Viser service ${command}: disabled`));
      assert.match(report, /foreground terminal window/);
    }

    await assert.rejects(() => readFile(join(config.storage.dir, "launchd", `${serviceLabel(config)}.plist`), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(join(config.storage.dir, "systemd", `${serviceLabel(config)}.service`), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(join(config.storage.dir, "windows", `${serviceLabel(config)}.task.xml`), "utf8"), /ENOENT/);
    await assert.rejects(() => readFile(join(config.storage.dir, "windows", `${serviceLabel(config)}.ps1`), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install and reinstall commands never call native service managers or preflight gates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-install-disabled-"));
  try {
    const config = serviceConfig(dir);
    const calls: RunCommandOptions[] = [];
    let preflightCalls = 0;
    const options = {
      platform: "linux" as const,
      preflightRunner: async () => {
        preflightCalls += 1;
        return { ok: true, report: "gate ok" };
      },
      runner: async (command: RunCommandOptions) => {
        calls.push(command);
        return commandResult(`unexpected ${command.command}`);
      }
    };

    const installReport = await installService(config, options);
    const reinstallReport = await reinstallService(config, options);

    assert.deepEqual(calls, []);
    assert.equal(preflightCalls, 0);
    assert.match(installReport, /Viser service install: disabled/);
    assert.match(reinstallReport, /Viser service reinstall: disabled/);
    await assert.rejects(() => readFile(userSystemdUnitPath(config), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeLaunchAgentPlist removes only regular private plist files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-remove-plist-"));
  try {
    const launchAgents = join(dir, "LaunchAgents");
    const userPlist = join(launchAgents, "com.mokky.viser.plist");
    await mkdir(launchAgents);
    await writeFile(userPlist, "<plist>safe</plist>\n", "utf8");

    assert.equal(await removeLaunchAgentPlist(userPlist), true);
    await assert.rejects(() => readFile(userPlist, "utf8"), /ENOENT/);
    assert.equal(await removeLaunchAgentPlist(userPlist), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeLaunchAgentPlist refuses symlinked plist targets without deleting linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-remove-plist-symlink-"));
  try {
    const launchAgents = join(dir, "LaunchAgents");
    const outside = join(dir, "outside.plist");
    const userPlist = join(launchAgents, "com.mokky.viser.plist");
    await mkdir(launchAgents);
    await writeFile(outside, "outside-original\n", "utf8");
    await symlink(outside, userPlist);

    await assert.rejects(() => removeLaunchAgentPlist(userPlist), /symlink/i);
    assert.equal(await readFile(outside, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeLaunchAgentPlist refuses symlinked LaunchAgents directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-remove-dir-symlink-"));
  try {
    const realLaunchAgents = join(dir, "real-launchagents");
    const linkLaunchAgents = join(dir, "LaunchAgents");
    const outsidePlist = join(realLaunchAgents, "com.mokky.viser.plist");
    await mkdir(realLaunchAgents);
    await writeFile(outsidePlist, "outside-original\n", "utf8");
    await symlink(realLaunchAgents, linkLaunchAgents);

    await assert.rejects(() => removeLaunchAgentPlist(join(linkLaunchAgents, "com.mokky.viser.plist")), /symlink/i);
    assert.equal(await readFile(outsidePlist, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removeLaunchAgentPlist refuses symlinked LaunchAgents parent components under HOME", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-remove-parent-symlink-"));
  const originalHome = process.env.HOME;
  try {
    const home = join(dir, "home");
    const outsideLibrary = join(dir, "outside-library");
    const outsideLaunchAgents = join(outsideLibrary, "LaunchAgents");
    const outsidePlist = join(outsideLaunchAgents, "com.mokky.viser.plist");
    await mkdir(home);
    await mkdir(outsideLaunchAgents, { recursive: true });
    await writeFile(outsidePlist, "outside-original\n", "utf8");
    await symlink(outsideLibrary, join(home, "Library"));
    process.env.HOME = home;

    await assert.rejects(
      () => removeLaunchAgentPlist(join(home, "Library", "LaunchAgents", "com.mokky.viser.plist")),
      /symlink/i
    );
    assert.equal(await readFile(outsidePlist, "utf8"), "outside-original\n");
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test("service help exposes legacy cleanup commands and says background services are disabled", async () => {
  const report = await serviceCommand(["help"], serviceConfig("/tmp/viser-test"));

  assert.match(report, /background service install\/start\/restart\/service-run and artifact generation are disabled/);
  assert.match(report, /service status/);
  assert.match(report, /service stop/);
  assert.match(report, /service uninstall/);
  assert.match(report, /service logs \[lines]/);
  assert.match(report, /service health/);
  assert.match(report, /service trim-logs/);
  assert.match(report, /viser/);
});

test("service check is disabled instead of preparing background startup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-check-"));
  try {
    const report = await serviceCommand(["check"], serviceRuntimeConfig(dir));

    assert.match(report, /Viser service check: disabled/);
    assert.match(report, /foreground terminal window/);
    assert.doesNotMatch(report, /Viser preflight/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service logs prints recent stdout and stderr or a missing-log message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-logs-"));
  try {
    const config = serviceConfig(dir);
    let report = await serviceCommand(["logs", "2"], config);
    assert.match(report, /log file not found yet/);

    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "gateway.out.log"), "out-1\nout-2\nout-3\n", "utf8");
    await writeFile(join(logDir, "gateway.err.log"), "err-1\nerr-2\nerr-3\n", "utf8");

    report = await serviceCommand(["logs", "2"], config);
    assert.doesNotMatch(report, /out-1/);
    assert.match(report, /out-2/);
    assert.match(report, /out-3/);
    assert.doesNotMatch(report, /err-1/);
    assert.match(report, /err-2/);
    assert.match(report, /err-3/);
    assert.equal((await stat(join(logDir, "gateway.out.log"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(logDir, "gateway.err.log"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service logs refuse symlinked log files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-logs-symlink-"));
  try {
    const config = serviceConfig(dir);
    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(dir, "outside.log"), "outside-secret-value\n", "utf8");
    await symlink(join(dir, "outside.log"), join(logDir, "gateway.out.log"));

    const report = await serviceCommand(["logs", "10"], config);

    assert.match(report, /symlink; refusing to read/);
    assert.doesNotMatch(report, /outside-secret-value/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service logs refuse symlinked service storage parents without leaking outside logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-logs-storage-symlink-"));
  try {
    const config = serviceConfig(dir);
    const outsideLogDir = join(dir, "outside-storage", "logs");
    await mkdir(outsideLogDir, { recursive: true });
    await writeFile(join(outsideLogDir, "gateway.out.log"), "outside-secret-value\n", "utf8");
    await writeFile(join(outsideLogDir, "gateway.err.log"), "outside-error-secret\n", "utf8");
    await symlink(join(dir, "outside-storage"), config.storage.dir);

    const report = await serviceCommand(["logs", "10"], config);

    assert.match(report, /symlink/i);
    assert.doesNotMatch(report, /outside-secret-value/);
    assert.doesNotMatch(report, /outside-error-secret/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service logs redact token-like secrets before printing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-logs-redact-"));
  try {
    const config = serviceConfig(dir);
    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(
      join(logDir, "gateway.out.log"),
      [
        `TELEGRAM_BOT_TOKEN=${FAKE_TELEGRAM_TOKEN}`,
        `{"apiKey":"${FAKE_MODEL_API_KEY}","safe":"visible"}`
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(logDir, "gateway.err.log"),
      [
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
        "Bot MTAabcdefghijklmnopqrstuvwxyz012345"
      ].join("\n"),
      "utf8"
    );

    const report = await serviceCommand(["logs", "10"], config);

    assert.match(report, /\[REDACTED]/);
    assert.match(report, /"safe":"visible"/);
    assert.doesNotMatch(report, new RegExp(escapeRegExp(FAKE_TELEGRAM_TOKEN)));
    assert.doesNotMatch(report, new RegExp(escapeRegExp(FAKE_MODEL_API_KEY)));
    assert.doesNotMatch(report, /abcdefghijklmnopqrstuvwxyz012345/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trimServiceLogs trims oversized private logs and preserves tails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-log-trim-"));
  try {
    const config = serviceConfig(dir);
    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "gateway.out.log"), `${"old-line\n".repeat(20)}recent-tail\n`, "utf8");
    await writeFile(join(logDir, "gateway.err.log"), "small\n", "utf8");

    const results = await trimServiceLogs(config, { maxBytes: 80, keepBytes: 40 });
    const out = await readFile(join(logDir, "gateway.out.log"), "utf8");
    const err = await readFile(join(logDir, "gateway.err.log"), "utf8");

    assert.equal(results.find((item) => item.path.endsWith("gateway.out.log"))?.trimmed, true);
    assert.equal(results.find((item) => item.path.endsWith("gateway.err.log"))?.trimmed, false);
    assert.match(out, /viser log trimmed/);
    assert.match(out, /recent-tail/);
    assert.doesNotMatch(out, /^old-line\nold-line\nold-line/u);
    assert.equal(err, "small\n");
    assert.equal((await stat(join(logDir, "gateway.out.log"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(logDir, "gateway.err.log"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("service trim-logs command trims oversized logs on demand", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-log-trim-command-"));
  try {
    const config = serviceConfig(dir);
    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(logDir, "gateway.out.log"), `${"old-line\n".repeat(20)}recent-tail\n`, "utf8");
    await writeFile(join(logDir, "gateway.err.log"), "small\n", "utf8");

    const report = await serviceCommand(["trim-logs", "80", "40"], config);
    const out = await readFile(join(logDir, "gateway.out.log"), "utf8");

    assert.match(report, /Viser service log trim/);
    assert.match(report, /gateway\.out\.log/);
    assert.match(report, /status: trimmed/);
    assert.match(report, /gateway\.err\.log/);
    assert.match(report, /status: unchanged/);
    assert.match(out, /recent-tail/);
    assert.doesNotMatch(out, /^old-line\nold-line\nold-line/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trimServiceLogs refuses symlinked log files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-log-trim-symlink-"));
  try {
    const config = serviceConfig(dir);
    const logDir = join(config.storage.dir, "logs");
    await mkdir(logDir, { recursive: true });
    await writeFile(join(dir, "outside.log"), "outside-secret\n", "utf8");
    await symlink(join(dir, "outside.log"), join(logDir, "gateway.out.log"));

    await assert.rejects(() => trimServiceLogs(config, { maxBytes: 1, keepBytes: 1 }), /ELOOP|too many symbolic links|symlink/i);
    assert.equal(await readFile(join(dir, "outside.log"), "utf8"), "outside-secret\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("trimServiceLogs refuses symlinked service storage parents without modifying outside logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-log-trim-storage-symlink-"));
  try {
    const config = serviceConfig(dir);
    const outsideLogDir = join(dir, "outside-storage", "logs");
    const outsideLog = join(outsideLogDir, "gateway.out.log");
    await mkdir(outsideLogDir, { recursive: true });
    await writeFile(outsideLog, "outside-secret\n", "utf8");
    await symlink(join(dir, "outside-storage"), config.storage.dir);

    await assert.rejects(() => trimServiceLogs(config, { maxBytes: 1, keepBytes: 1 }), /symlink/i);
    assert.equal(await readFile(outsideLog, "utf8"), "outside-secret\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("userLaunchAgentPath targets the user's LaunchAgents directory", () => {
  assert.match(userLaunchAgentPath(serviceConfig("/tmp/viser-test")), /LaunchAgents\/com\.mokky\.viser\.plist$/);
});

function serviceConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    configPath: join(dir, "viser.config.json")
  };
}

function serviceRuntimeConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, defaultProvider: "echo", fallbackProviders: [], workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    personalization: { ...DEFAULT_CONFIG.personalization, dir: join(dir, ".viser", "personalization") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir], shell: { ...DEFAULT_CONFIG.tools.shell } },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
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
        args: ["-e", "console.log('VISER_OK')"],
        promptMode: "argument",
        timeoutMs: 5000,
        loginHint: "No login needed for test provider."
      }
    },
    configPath: join(dir, "viser.config.json")
  };
}

function commandResult(stdout = ""): RunCommandResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    signal: null,
    elapsedMs: 1,
    maxOutputBytes: 200_000,
    stdoutTruncated: false,
    stderrTruncated: false
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
