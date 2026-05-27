import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateLaunchdPlist,
  generateSystemdUserService,
  generateWindowsServiceRunner,
  generateWindowsTaskXml,
  installLaunchAgentPlist,
  installService,
  removeLaunchAgentPlist,
  serviceCommand,
  servicePathValue,
  trimServiceLogs,
  userLaunchAgentPath,
  userSystemdUnitPath,
  windowsTaskUri,
  writeWorkspaceSystemdService,
  writeWorkspaceWindowsService,
  writeWorkspacePlist
} from "../src/cli/service.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

const FAKE_TELEGRAM_TOKEN = `123456:${"abcdefghijklmnopqrstuvwxyzABCDE"}`;
const FAKE_MODEL_API_KEY = `sk-${"1234567890abcdefghijklmnop"}`;
import type { RunCommandOptions, RunCommandResult } from "../src/utils/exec.ts";

test("generateLaunchdPlist points launchd at the restart-safe service runner", () => {
  const config = serviceConfig("/tmp/viser-test");
  const plist = generateLaunchdPlist(config, { nodePath: "/usr/local/bin/node" });
  assert.match(plist, /<string>service-run<\/string>/);
  assert.match(plist, /<string>--live<\/string>/);
  assert.match(plist, /<string>--probe-all-providers<\/string>/);
  assert.doesNotMatch(plist, /<string>gateway<\/string>/);
  assert.doesNotMatch(plist, /<string>--strict<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>/);
  assert.match(plist, /<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(plist, /VISER_CONFIG/);
  assert.match(plist, /<key>PATH<\/key>/);
});

test("generateLaunchdPlist preserves an explicit VISER_ENV for launchd", () => {
  const original = process.env.VISER_ENV;
  try {
    process.env.VISER_ENV = "/tmp/viser-test/prod.env";
    const plist = generateLaunchdPlist(serviceConfig("/tmp/viser-test"), { nodePath: "/usr/local/bin/node" });

    assert.match(plist, /<key>VISER_ENV<\/key>/);
    assert.match(plist, /<string>\/tmp\/viser-test\/prod\.env<\/string>/);
  } finally {
    if (original === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = original;
  }
});

test("generateLaunchdPlist omits VISER_CONFIG when running with defaults only", () => {
  const dir = "/tmp/viser-default-service";
  const config: ViserConfig = {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") }
  };

  const plist = generateLaunchdPlist(config, { nodePath: "/usr/local/bin/node" });

  assert.doesNotMatch(plist, /<key>VISER_CONFIG<\/key>/);
  assert.doesNotMatch(plist, /viser\.config\.json/);
  assert.match(plist, /<key>PATH<\/key>/);
});

test("generateLaunchdPlist preserves the loaded config path when one exists", () => {
  const config = serviceConfig("/tmp/viser-config-service");
  const plist = generateLaunchdPlist(config, { nodePath: "/usr/local/bin/node" });

  assert.match(plist, /<key>VISER_CONFIG<\/key>/);
  assert.match(plist, /<string>\/tmp\/viser-config-service\/viser\.config\.json<\/string>/);
});

test("generateLaunchdPlist filters transient sandbox paths from launchd PATH", () => {
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = [
      "/Users/example/.codex/tmp/arg0/bin",
      "/pkg/env/global/bin",
      "/private/tmp/viser-bin",
      "/opt/homebrew/bin",
      "/opt/homebrew/bin",
      "/usr/bin"
    ].join(":");

    const plist = generateLaunchdPlist(serviceConfig("/tmp/viser-test"), { nodePath: "/usr/local/bin/node" });
    const pathValue = servicePathValue(process.env.PATH);

    assert.doesNotMatch(plist, /\.codex\/tmp/);
    assert.doesNotMatch(plist, /\/pkg\/env\/global\/bin/);
    assert.doesNotMatch(plist, /\/private\/tmp\/viser-bin/);
    assert.match(plist, /\/opt\/homebrew\/bin/);
    assert.match(plist, /\/usr\/bin/);
    assert.equal(pathValue.split(":").filter((entry) => entry === "/opt/homebrew/bin").length, 1);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test("generateSystemdUserService points systemd at the restart-safe service runner", () => {
  const originalEnv = process.env.VISER_ENV;
  try {
    process.env.VISER_ENV = "/tmp/viser-systemd/prod.env";
    const config = serviceConfig("/tmp/viser-systemd");
    const unit = generateSystemdUserService(config, { nodePath: "/usr/bin/node" });

    assert.match(userSystemdUnitPath(config), /\.config\/systemd\/user\/com\.mokky\.viser\.service$/);
    assert.match(unit, /^\[Unit\]/m);
    assert.match(unit, /^\[Service\]/m);
    assert.match(unit, /^\[Install\]/m);
    assert.match(unit, /ExecStart="\/usr\/bin\/node" "\/tmp\/viser-systemd\/src\/index\.ts" "service-run" "--live" "--probe-all-providers"/);
    assert.match(unit, /Restart=on-failure/);
    assert.match(unit, /Environment="VISER_CONFIG=\/tmp\/viser-systemd\/viser\.config\.json"/);
    assert.match(unit, /Environment="VISER_ENV=\/tmp\/viser-systemd\/prod\.env"/);
    assert.match(unit, /StandardOutput=append:\/tmp\/viser-systemd\/\.viser\/logs\/gateway\.out\.log/);
    assert.doesNotMatch(unit, /<plist/);
  } finally {
    if (originalEnv === undefined) delete process.env.VISER_ENV;
    else process.env.VISER_ENV = originalEnv;
  }
});

test("writeWorkspaceSystemdService writes the user service unit under storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-systemd-"));
  try {
    const config = serviceConfig(dir);
    const path = await writeWorkspaceSystemdService(config);
    assert.equal(path.endsWith(".service"), true);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.match(await readFile(path, "utf8"), /ExecStart=.*service-run/);

    const report = await serviceCommand(["write-systemd"], config);
    assert.match(report, /Manual Linux systemd --user install/);
    assert.match(report, /node src\/index.ts service check/);
    assert.match(report, /systemctl --user daemon-reload/);
    assert.match(report, /systemctl --user enable --now com\.mokky\.viser\.service/);
    assert.match(report, /loginctl enable-linger/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkspaceSystemdService refuses symlinked service directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-systemd-symlink-"));
  try {
    const config = serviceConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(join(dir, "outside-systemd"));
    await symlink(join(dir, "outside-systemd"), join(config.storage.dir, "systemd"));

    await assert.rejects(() => writeWorkspaceSystemdService(config), /symlink/);
    await assert.rejects(() => readFile(join(dir, "outside-systemd", "com.mokky.viser.service"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installService installs Linux systemd user units after the live gate passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-systemd-install-"));
  const originalHome = process.env.HOME;
  try {
    const home = join(dir, "home");
    await mkdir(home, { recursive: true });
    process.env.HOME = home;
    const config = serviceConfig(dir);
    const calls: RunCommandOptions[] = [];

    const report = await installService(config, {
      platform: "linux",
      preflightRunner: async () => ({ ok: true, report: "gate ok" }),
      runner: async (command) => {
        calls.push(command);
        return commandResult(`ran ${command.command} ${command.args.join(" ")}`);
      }
    });

    const userUnit = userSystemdUnitPath(config);
    assert.equal(userUnit.startsWith(home), true);
    assert.match(await readFile(userUnit, "utf8"), /service-run/);
    assert.equal((await stat(userUnit)).mode & 0o777, 0o600);
    assert.deepEqual(calls.map((call) => [call.command, call.args]), [
      ["systemctl", ["--user", "daemon-reload"]],
      ["systemctl", ["--user", "enable", "--now", "com.mokky.viser.service"]]
    ]);
    assert.match(report, /service systemd install: ok/);
    assert.match(report, /Installed .*com\.mokky\.viser\.service/);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test("installService does not copy Linux systemd units when the live gate blocks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-systemd-blocked-"));
  const originalHome = process.env.HOME;
  try {
    const home = join(dir, "home");
    await mkdir(home, { recursive: true });
    process.env.HOME = home;
    const config = serviceConfig(dir);
    let called = false;

    const report = await installService(config, {
      platform: "linux",
      preflightRunner: async () => ({ ok: false, report: "gate blocked" }),
      runner: async (command) => {
        called = true;
        return commandResult(`unexpected ${command.command}`);
      }
    });

    assert.equal(called, false);
    assert.match(report, /service install: blocked/);
    assert.match(report, /gate blocked/);
    await assert.rejects(() => readFile(userSystemdUnitPath(config), "utf8"), /ENOENT/);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test("generateWindowsTaskXml points Task Scheduler at a restart-safe PowerShell runner", () => {
  const config = serviceConfig("C:/viser-windows");
  const xml = generateWindowsTaskXml(config, {
    powershellPath: "powershell.exe",
    runnerPath: "C:/viser-windows/.viser/windows/com.mokky.viser.ps1"
  });
  const runner = generateWindowsServiceRunner(config, { nodePath: "C:/Program Files/nodejs/node.exe" });

  assert.equal(windowsTaskUri(config), "\\KMokky\\Viser");
  assert.match(xml, /<Task version="1\.4"/);
  assert.match(xml, /<Author>KMokky<\/Author>/);
  assert.match(xml, /<URI>\\KMokky\\Viser<\/URI>/);
  assert.match(xml, /<LogonTrigger>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<Command>powershell\.exe<\/Command>/);
  assert.match(xml, /-NoProfile -NonInteractive -File &quot;C:\/viser-windows\/\.viser\/windows\/com\.mokky\.viser\.ps1&quot;/);
  assert.match(runner, /service-run' '--live' '--probe-all-providers'/);
  assert.match(runner, /\$env:VISER_CONFIG = 'C:\/viser-windows\/viser\.config\.json'/);
  assert.match(runner, /gateway\.out\.log/);
  assert.match(runner, /gateway\.err\.log/);
});

test("writeWorkspaceWindowsService writes Task Scheduler XML and runner under storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-windows-"));
  try {
    const config = serviceConfig(dir);
    const artifacts = await writeWorkspaceWindowsService(config);
    assert.equal(artifacts.taskXmlPath.endsWith(".task.xml"), true);
    assert.equal(artifacts.runnerPath.endsWith(".ps1"), true);
    assert.equal((await stat(artifacts.taskXmlPath)).mode & 0o777, 0o600);
    assert.equal((await stat(artifacts.runnerPath)).mode & 0o777, 0o600);
    assert.match(await readFile(artifacts.taskXmlPath, "utf8"), /<LogonTrigger>/);
    assert.match(await readFile(artifacts.runnerPath, "utf8"), /service-run' '--live' '--probe-all-providers'/);

    const report = await serviceCommand(["write-windows"], config);
    assert.match(report, /Manual Windows Task Scheduler install/);
    assert.match(report, /Register-ScheduledTask/);
    assert.match(report, /Start-ScheduledTask/);
    assert.match(report, /node src\/index.ts service check/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkspaceWindowsService refuses symlinked service directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-windows-symlink-"));
  try {
    const config = serviceConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(join(dir, "outside-windows"));
    await symlink(join(dir, "outside-windows"), join(config.storage.dir, "windows"));

    await assert.rejects(() => writeWorkspaceWindowsService(config), /symlink/);
    await assert.rejects(() => readFile(join(dir, "outside-windows", "com.mokky.viser.task.xml"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installService registers Windows Task Scheduler tasks after the live gate passes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-windows-install-"));
  try {
    const config = serviceConfig(dir);
    const calls: RunCommandOptions[] = [];

    const report = await installService(config, {
      platform: "win32",
      preflightRunner: async () => ({ ok: true, report: "gate ok" }),
      runner: async (command) => {
        calls.push(command);
        return commandResult(`ran ${command.command}`);
      }
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "powershell.exe");
    assert.match(calls[0].args.join("\n"), /Register-ScheduledTask/);
    assert.match(calls[0].args.join("\n"), /Start-ScheduledTask/);
    assert.match(await readFile(join(config.storage.dir, "windows", "com.mokky.viser.task.xml"), "utf8"), /<LogonTrigger>/);
    assert.match(await readFile(join(config.storage.dir, "windows", "com.mokky.viser.ps1"), "utf8"), /service-run/);
    assert.match(report, /service windows task install: ok/);
    assert.match(report, /Registered \\KMokky\\Viser/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkspacePlist writes the launchd plist under storage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-"));
  try {
    const config = serviceConfig(dir);
    const path = await writeWorkspacePlist(config);
    assert.equal(path.endsWith(".plist"), true);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.storage.dir, "logs"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(config.storage.dir, "logs", "gateway.out.log"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.storage.dir, "logs", "gateway.err.log"))).mode & 0o777, 0o600);
    const report = await serviceCommand(["write-plist"], config);
    assert.match(report, /Before installing:/);
    assert.match(report, /Recommended secure install:/);
    assert.match(report, /node src\/index.ts service check/);
    assert.match(report, /destination is not a symlink/);
    assert.match(report, /chmod 600/);
    assert.match(report, /node src\/index.ts service reinstall/);
    assert.match(report, /node src\/index.ts service logs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkspacePlist refuses symlinked service directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-symlink-dir-"));
  try {
    const config = serviceConfig(dir);
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(join(dir, "outside-logs"));
    await symlink(join(dir, "outside-logs"), join(config.storage.dir, "logs"));

    await assert.rejects(() => writeWorkspacePlist(config), /symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkspacePlist refuses symlinked service storage parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-storage-symlink-"));
  try {
    const config = serviceConfig(dir);
    const outsideStorage = join(dir, "outside-storage");
    await mkdir(outsideStorage);
    await symlink(outsideStorage, config.storage.dir);

    await assert.rejects(() => writeWorkspacePlist(config), /symlink/i);
    await assert.rejects(() => readFile(join(outsideStorage, "launchd", "com.mokky.viser.plist"), "utf8"), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installLaunchAgentPlist writes private plists and refuses symlink targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-install-plist-"));
  try {
    const workspacePlist = join(dir, "workspace.plist");
    const launchAgents = join(dir, "LaunchAgents");
    const userPlist = join(launchAgents, "com.mokky.viser.plist");
    await writeFile(workspacePlist, "<plist>safe</plist>\n", "utf8");

    await installLaunchAgentPlist(workspacePlist, userPlist);
    assert.equal(await readFile(userPlist, "utf8"), "<plist>safe</plist>\n");
    assert.equal((await stat(userPlist)).mode & 0o777, 0o600);

    const outside = join(dir, "outside.plist");
    await rm(userPlist);
    await writeFile(outside, "outside-original\n", "utf8");
    await symlink(outside, userPlist);

    await assert.rejects(() => installLaunchAgentPlist(workspacePlist, userPlist), /symlink/);
    assert.equal(await readFile(outside, "utf8"), "outside-original\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installLaunchAgentPlist refuses symlinked LaunchAgents directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-install-dir-"));
  try {
    const workspacePlist = join(dir, "workspace.plist");
    const realLaunchAgents = join(dir, "real-launchagents");
    const linkLaunchAgents = join(dir, "LaunchAgents");
    await writeFile(workspacePlist, "<plist>safe</plist>\n", "utf8");
    await mkdir(realLaunchAgents);
    await symlink(realLaunchAgents, linkLaunchAgents);

    await assert.rejects(() => installLaunchAgentPlist(workspacePlist, join(linkLaunchAgents, "com.mokky.viser.plist")), /symlink/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installLaunchAgentPlist refuses symlinked LaunchAgents parent components under HOME", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-install-parent-symlink-"));
  const originalHome = process.env.HOME;
  try {
    const home = join(dir, "home");
    const outsideLibrary = join(dir, "outside-library");
    const workspacePlist = join(dir, "workspace.plist");
    await mkdir(home);
    await mkdir(outsideLibrary);
    await writeFile(workspacePlist, "<plist>safe</plist>\n", "utf8");
    await symlink(outsideLibrary, join(home, "Library"));
    process.env.HOME = home;

    await assert.rejects(
      () => installLaunchAgentPlist(workspacePlist, join(home, "Library", "LaunchAgents", "com.mokky.viser.plist")),
      /symlink/i
    );
    await assert.rejects(() => readFile(join(outsideLibrary, "LaunchAgents", "com.mokky.viser.plist"), "utf8"), /ENOENT/);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test("installLaunchAgentPlist refuses symlinked workspace plist sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-install-source-symlink-"));
  try {
    const outsideSource = join(dir, "outside-source.plist");
    const workspacePlist = join(dir, "workspace.plist");
    const userPlist = join(dir, "LaunchAgents", "com.mokky.viser.plist");
    await writeFile(outsideSource, "<plist>outside</plist>\n", "utf8");
    await symlink(outsideSource, workspacePlist);

    await assert.rejects(() => installLaunchAgentPlist(workspacePlist, userPlist), /symlink/i);
    await assert.rejects(() => readFile(userPlist, "utf8"), /ENOENT/);
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

test("service help exposes check, reinstall, and logs recovery commands", async () => {
  const report = await serviceCommand(["help"], serviceConfig("/tmp/viser-test"));

  assert.match(report, /service check/);
  assert.match(report, /service systemd/);
  assert.match(report, /service write-systemd/);
  assert.match(report, /service windows/);
  assert.match(report, /service write-windows/);
  assert.match(report, /service reinstall/);
  assert.match(report, /service logs \[lines]/);
  assert.match(report, /service health/);
  assert.match(report, /service trim-logs/);
});

test("service check runs the provider-proof no-start gate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-service-check-"));
  try {
    const report = await serviceCommand(["check"], serviceRuntimeConfig(dir));

    assert.match(report, /Viser service check: PASS/);
    assert.match(report, /mode: check-only/);
    assert.match(report, /Viser preflight: PASS/);
    assert.match(report, /service write-windows/);
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
