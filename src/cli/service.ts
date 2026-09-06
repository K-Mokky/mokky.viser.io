// ================================================================
// Service helper
// ================================================================
// Viser can generate launchd, systemd user, and Windows Task Scheduler service
// artifacts. Installing or enabling a service is only done when the user
// explicitly runs service commands. Setup never mutates global OS state
// unexpectedly.

import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dashboardCheckReport } from "./dashboard-check.ts";
import { preflight } from "./preflight.ts";
import { assertNoSymlinkComponentsUnderRoot, PRIVATE_FILE_MODE, removePrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { runCommand } from "../utils/exec.ts";
import { nowIso } from "../utils/text.ts";
import type { ViserConfig } from "../core/types.ts";
import type { RunCommandOptions, RunCommandResult } from "../utils/exec.ts";

const REDACTED = "[REDACTED]";
const PRIVATE_DIR_MODE = 0o700;
const MAX_LOG_TAIL_BYTES = 1_000_000;
const DEFAULT_SERVICE_LOG_MAX_BYTES = 5_000_000;
const DEFAULT_SERVICE_LOG_KEEP_BYTES = 1_000_000;
const FALLBACK_SERVICE_PATHS = [
  join(homedir(), ".npm-global", "bin"),
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
];
const TRANSIENT_SERVICE_PATH_PATTERNS = [
  /\/\.codex\/tmp\//u,
  /\/codex\.system\/bootstrap\//u,
  /^\/pkg\/env\/global\/bin$/u,
  /^\/(?:private\/)?tmp(?:\/|$)/u,
  /^\/private\/var\/folders\//u
];

export interface ServicePlistOptions {
  label?: string;
  nodePath?: string;
  scriptPath?: string;
}

export interface SystemdServiceOptions {
  unitName?: string;
  nodePath?: string;
  scriptPath?: string;
}

export interface WindowsServiceOptions {
  taskUri?: string;
  powershellPath?: string;
  runnerPath?: string;
}

export interface WindowsServiceArtifacts {
  taskXmlPath: string;
  runnerPath: string;
}

export interface ServiceLogTrimResult {
  path: string;
  trimmed: boolean;
  bytesBefore: number;
  bytesAfter: number;
}

export interface ServiceGateResult {
  ok: boolean;
  report: string;
}

export interface ServiceControlOptions {
  platform?: NodeJS.Platform;
  runner?: (options: RunCommandOptions) => Promise<RunCommandResult>;
  preflightRunner?: (config: ViserConfig) => Promise<ServiceGateResult>;
}

export async function serviceCommand(args: string[], config: ViserConfig): Promise<string> {
  const command = args[0] ?? "help";
  switch (command) {
    case "plist":
      return generateLaunchdPlist(config);
    case "write-plist": {
      const target = await writeWorkspacePlist(config);
      return installInstructions(target, config);
    }
    case "systemd":
    case "unit":
    case "systemd-unit":
      return generateSystemdUserService(config);
    case "write-systemd":
    case "write-unit": {
      const target = await writeWorkspaceSystemdService(config);
      return systemdInstallInstructions(target, config);
    }
    case "windows":
    case "windows-task":
    case "task":
      return generateWindowsTaskXml(config);
    case "write-windows":
    case "write-task": {
      const artifacts = await writeWorkspaceWindowsService(config);
      return windowsInstallInstructions(artifacts, config);
    }
    case "check":
    case "doctor":
      return await serviceCheck(config);
    case "logs":
      return await serviceLogs(config, parsePositiveInt(args[1]) ?? 80);
    case "health":
    case "dashboard-check":
      return await dashboardCheckReport(config);
    case "trim-logs":
      return await serviceTrimLogs(config, parsePositiveInt(args[1]), parsePositiveInt(args[2]));
    case "install":
      return await installService(config);
    case "reinstall":
      return await reinstallService(config);
    case "uninstall":
      return await uninstallService(config);
    case "status":
      return await serviceManagerCommand(config, "status");
    case "start":
      return await serviceManagerCommand(config, "start");
    case "stop":
      return await serviceManagerCommand(config, "stop");
    case "restart": {
      const stop = await serviceManagerCommand(config, "stop");
      const start = await serviceManagerCommand(config, "start");
      return `${stop}\n\n${start}`;
    }
    default:
      return [
        "Viser service commands",
        "- service plist: print a macOS launchd plist for the strict-gated gateway",
        "- service write-plist: write the plist under .viser/launchd",
        "- service systemd: print a Linux systemd --user unit for the strict-gated gateway",
        "- service write-systemd: write the unit under .viser/systemd",
        "- service windows: print a Windows Task Scheduler XML for the strict-gated gateway",
        "- service write-windows: write Task Scheduler XML and PowerShell runner under .viser/windows",
        "- service check: run the live provider-proof no-start service gate",
        "- service install: run service check, then install/start the native launchd/systemd/Task Scheduler service",
        "- service reinstall: remove the native service registration, then install/start again",
        "- service uninstall: stop/remove the native launchd/systemd/Task Scheduler registration",
        "- service status: print native launchd/systemd/Task Scheduler status",
        "- service start|stop|restart: control the native service registration",
        "- service logs [lines]: print recent gateway stdout/stderr logs",
        "- service health: verify the live localhost dashboard/schema contract without provider calls",
        "- service trim-logs [maxBytes] [keepBytes]: trim oversized gateway stdout/stderr logs now",
        "",
        "The native launchd/systemd/Windows registrations run `node src/index.ts service-run --live --probe-all-providers` from this workspace.",
        "`service-run` validates live connector tokens and executes the strict live provider-proof preflight gate before starting the gateway."
      ].join("\n");
  }
}

export async function writeWorkspacePlist(config: ViserConfig): Promise<string> {
  const dir = join(config.storage.dir, "launchd");
  await ensurePrivateDirectory(dir, config.assistant.workdir);
  await ensurePrivateServiceLogs(config);
  const target = join(dir, `${serviceLabel(config)}.plist`);
  await writePrivateFile(target, generateLaunchdPlist(config));
  return target;
}

export async function writeWorkspaceSystemdService(config: ViserConfig): Promise<string> {
  const dir = join(config.storage.dir, "systemd");
  await ensurePrivateDirectory(dir, config.assistant.workdir);
  await ensurePrivateServiceLogs(config);
  const target = join(dir, `${systemdUnitName(config)}.service`);
  await writePrivateFile(target, generateSystemdUserService(config));
  return target;
}

export async function writeWorkspaceWindowsService(config: ViserConfig): Promise<WindowsServiceArtifacts> {
  const dir = join(config.storage.dir, "windows");
  await ensurePrivateDirectory(dir, config.assistant.workdir);
  await ensurePrivateServiceLogs(config);
  const runnerPath = join(dir, `${serviceLabel(config)}.ps1`);
  const taskXmlPath = join(dir, `${serviceLabel(config)}.task.xml`);
  await writePrivateFile(runnerPath, generateWindowsServiceRunner(config));
  await writePrivateFile(taskXmlPath, generateWindowsTaskXml(config, { runnerPath }));
  return { taskXmlPath, runnerPath };
}

export async function trimServiceLogs(
  config: ViserConfig,
  options: { maxBytes?: number; keepBytes?: number } = {}
): Promise<ServiceLogTrimResult[]> {
  const logDir = join(config.storage.dir, "logs");
  await ensurePrivateDirectory(logDir, config.assistant.workdir);
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_SERVICE_LOG_MAX_BYTES);
  const keepBytes = Math.max(1, Math.min(options.keepBytes ?? DEFAULT_SERVICE_LOG_KEEP_BYTES, maxBytes));
  return await Promise.all([
    trimServiceLogFile(join(logDir, "gateway.out.log"), maxBytes, keepBytes),
    trimServiceLogFile(join(logDir, "gateway.err.log"), maxBytes, keepBytes)
  ]);
}

export async function installService(config: ViserConfig, options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") return await installSystemdService(config, options);
  if (platform === "win32") return await installWindowsService(config, options);
  if (platform !== "darwin") return `Native service install is not supported on ${platform}.`;

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service install: blocked",
      "No LaunchAgent was copied or bootstrapped because the live provider-proof service gate did not pass.",
      "",
      gate.report,
      "",
      "Next:",
      "- fix the blockers above",
      "- rerun `node src/index.ts service check`",
      "- then rerun `node src/index.ts service install`"
    ].join("\n");
  }

  const workspacePlist = await writeWorkspacePlist(config);
  const userPlist = userLaunchAgentPath(config);
  await installLaunchAgentPlist(workspacePlist, userPlist);
  const result = await runServiceCommand(options, { command: "launchctl", args: ["bootstrap", launchDomain(), userPlist], timeoutMs: 15_000 });
  return formatLaunchctlResult("install", result, [`Installed ${userPlist}`]);
}

export async function installLaunchAgentPlist(workspacePlist: string, userPlist: string): Promise<void> {
  await ensureLaunchAgentsDirectory(dirname(userPlist));
  await assertLaunchAgentTargetSafe(userPlist);
  await writePrivateFile(userPlist, await readLaunchAgentSource(workspacePlist));
}

export async function reinstallService(config: ViserConfig, options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") return await reinstallSystemdService(config, options);
  if (platform === "win32") return await reinstallWindowsService(config, options);
  if (platform !== "darwin") return `Native service reinstall is not supported on ${platform}.`;

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service reinstall: blocked",
      "No existing LaunchAgent was booted out because the live provider-proof service gate did not pass.",
      "",
      gate.report
    ].join("\n");
  }

  const userPlist = userLaunchAgentPath(config);
  const bootout = await runServiceCommand(options, { command: "launchctl", args: ["bootout", launchDomain(), userPlist], timeoutMs: 15_000 });
  const install = await installService(config, { ...options, preflightRunner: async () => gate });
  return [
    formatLaunchctlResult("pre-reinstall bootout", bootout, [`Target ${userPlist}`]),
    "",
    install
  ].join("\n");
}

export async function uninstallService(config: ViserConfig, options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform === "linux") return await uninstallSystemdService(config, options);
  if (platform === "win32") return await uninstallWindowsService(config, options);
  if (platform !== "darwin") return `Native service uninstall is not supported on ${platform}.`;

  const userPlist = userLaunchAgentPath(config);
  await assertLaunchAgentRemovalPathSafe(userPlist);
  const bootout = await runServiceCommand(options, { command: "launchctl", args: ["bootout", launchDomain(), userPlist], timeoutMs: 15_000 });
  const removed = await removeLaunchAgentPlist(userPlist);
  return formatLaunchctlResult("uninstall", bootout, [removed ? `Removed ${userPlist}` : `No LaunchAgent plist found at ${userPlist}`]);
}

export async function removeLaunchAgentPlist(path: string): Promise<boolean> {
  await assertLaunchAgentRemovalPathSafe(path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`LaunchAgent plist is a symlink; refusing to remove it: ${path}`);
    if (!info.isFile()) throw new Error(`LaunchAgent plist path is not a regular file: ${path}`);
    return await removePrivateFileIfExists(path, { dirs: [dirname(path)] });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function installSystemdService(config: ViserConfig, options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return "Linux systemd service install is only supported on Linux.";

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service install: blocked",
      "No systemd user unit was copied, reloaded, or enabled because the live provider-proof service gate did not pass.",
      "",
      gate.report,
      "",
      "Next:",
      "- fix the blockers above",
      "- rerun `node src/index.ts service check`",
      "- then rerun `node src/index.ts service install`"
    ].join("\n");
  }

  const workspaceUnit = await writeWorkspaceSystemdService(config);
  const userUnit = userSystemdUnitPath(config);
  await installSystemdUserUnit(workspaceUnit, userUnit);
  const reload = await systemctlCommand(options, ["--user", "daemon-reload"]);
  if (reload.exitCode !== 0 || reload.signal) {
    return formatServiceCommandResult("systemd daemon-reload", reload, [`Installed ${userUnit}`]);
  }

  const enable = await systemctlCommand(options, ["--user", "enable", "--now", `${systemdUnitName(config)}.service`]);
  return [
    formatServiceCommandResult("systemd daemon-reload", reload, [`Installed ${userUnit}`]),
    "",
    formatServiceCommandResult("systemd install", enable, [`Enabled ${systemdUnitName(config)}.service`])
  ].join("\n");
}

export async function installSystemdUserUnit(workspaceUnit: string, userUnit: string): Promise<void> {
  await ensureSystemdUserDirectory(dirname(userUnit));
  await assertSystemdUnitTargetSafe(userUnit);
  await writePrivateFile(userUnit, await readRegularServiceSource(workspaceUnit, "systemd workspace unit"));
}

export async function installWindowsService(config: ViserConfig, options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return "Windows Task Scheduler service install is only supported on Windows.";

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service install: blocked",
      "No Windows scheduled task was registered or started because the live provider-proof service gate did not pass.",
      "",
      gate.report,
      "",
      "Next:",
      "- fix the blockers above",
      "- rerun `node src/index.ts service check`",
      "- then rerun `node src/index.ts service install`"
    ].join("\n");
  }

  const artifacts = await writeWorkspaceWindowsService(config);
  const result = await powershellCommand(options, windowsRegisterTaskScript(artifacts, config));
  return formatServiceCommandResult("windows task install", result, [
    `Prepared ${artifacts.taskXmlPath}`,
    `Prepared ${artifacts.runnerPath}`,
    `Registered ${windowsTaskUri(config)}`
  ]);
}

async function reinstallSystemdService(config: ViserConfig, options: ServiceControlOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return "Linux systemd service reinstall is only supported on Linux.";

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service reinstall: blocked",
      "No existing systemd user unit was disabled because the live provider-proof service gate did not pass.",
      "",
      gate.report
    ].join("\n");
  }

  const disable = await systemctlCommand(options, ["--user", "disable", "--now", `${systemdUnitName(config)}.service`]);
  const install = await installSystemdService(config, { ...options, preflightRunner: async () => gate });
  return [
    formatServiceCommandResult("pre-reinstall systemd disable", disable, [`Target ${systemdUnitName(config)}.service`]),
    "",
    install
  ].join("\n");
}

async function reinstallWindowsService(config: ViserConfig, options: ServiceControlOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return "Windows Task Scheduler service reinstall is only supported on Windows.";

  const gate = await serviceGate(config, options);
  if (!gate.ok) {
    return [
      "service reinstall: blocked",
      "No existing Windows scheduled task was unregistered because the live provider-proof service gate did not pass.",
      "",
      gate.report
    ].join("\n");
  }

  const unregister = await powershellCommand(options, windowsUnregisterTaskScript(config));
  const install = await installWindowsService(config, { ...options, preflightRunner: async () => gate });
  return [
    formatServiceCommandResult("pre-reinstall windows task unregister", unregister, [`Target ${windowsTaskUri(config)}`]),
    "",
    install
  ].join("\n");
}

async function uninstallSystemdService(config: ViserConfig, options: ServiceControlOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "linux") return "Linux systemd service uninstall is only supported on Linux.";

  const unitName = `${systemdUnitName(config)}.service`;
  const userUnit = userSystemdUnitPath(config);
  await assertSystemdUnitRemovalPathSafe(userUnit);
  const disable = await systemctlCommand(options, ["--user", "disable", "--now", unitName]);
  const removed = await removeSystemdUserUnit(userUnit);
  const reload = await systemctlCommand(options, ["--user", "daemon-reload"]);
  return [
    formatServiceCommandResult("systemd uninstall", disable, [removed ? `Removed ${userUnit}` : `No systemd user unit found at ${userUnit}`]),
    "",
    formatServiceCommandResult("systemd daemon-reload", reload)
  ].join("\n");
}

async function uninstallWindowsService(config: ViserConfig, options: ServiceControlOptions): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return "Windows Task Scheduler service uninstall is only supported on Windows.";
  const result = await powershellCommand(options, windowsUnregisterTaskScript(config));
  return formatServiceCommandResult("windows task uninstall", result, [`Target ${windowsTaskUri(config)}`]);
}

async function removeSystemdUserUnit(path: string): Promise<boolean> {
  await assertSystemdUnitRemovalPathSafe(path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`systemd user unit is a symlink; refusing to remove it: ${path}`);
    if (!info.isFile()) throw new Error(`systemd user unit path is not a regular file: ${path}`);
    return await removePrivateFileIfExists(path, { dirs: [dirname(path)] });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export function generateLaunchdPlist(config: ViserConfig, options: ServicePlistOptions = {}): string {
  const label = options.label ?? serviceLabel(config);
  const nodePath = options.nodePath ?? process.execPath;
  const scriptPath = options.scriptPath ?? join(config.assistant.workdir, "src", "index.ts");
  const logDir = join(config.storage.dir, "logs");
  const envVariables = [
    ["PATH", servicePathValue(process.env.PATH)],
    ...(config.configPath ? [["VISER_CONFIG", config.configPath]] : []),
    ...(process.env.VISER_ENV ? [["VISER_ENV", process.env.VISER_ENV]] : [])
  ];
  const envXml = envVariables
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${escapeXml(label)}</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>${escapeXml(nodePath)}</string>\n    <string>${escapeXml(scriptPath)}</string>\n    <string>service-run</string>\n    <string>--live</string>\n    <string>--probe-all-providers</string>\n  </array>\n  <key>WorkingDirectory</key>\n  <string>${escapeXml(config.assistant.workdir)}</string>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>\n  </dict>\n  <key>StandardOutPath</key>\n  <string>${escapeXml(join(logDir, "gateway.out.log"))}</string>\n  <key>StandardErrorPath</key>\n  <string>${escapeXml(join(logDir, "gateway.err.log"))}</string>\n  <key>EnvironmentVariables</key>\n  <dict>\n${envXml}\n  </dict>\n</dict>\n</plist>\n`;
}

export function generateSystemdUserService(config: ViserConfig, options: SystemdServiceOptions = {}): string {
  const unitName = options.unitName ?? systemdUnitName(config);
  const nodePath = options.nodePath ?? process.execPath;
  const scriptPath = options.scriptPath ?? join(config.assistant.workdir, "src", "index.ts");
  const logDir = join(config.storage.dir, "logs");
  const environment = [
    ["PATH", servicePathValue(process.env.PATH)],
    ...(config.configPath ? [["VISER_CONFIG", config.configPath]] : []),
    ...(process.env.VISER_ENV ? [["VISER_ENV", process.env.VISER_ENV]] : [])
  ];

  return [
    "[Unit]",
    `Description=${config.assistant.name} local-CLI assistant gateway (${unitName})`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${systemdQuote(config.assistant.workdir)}`,
    ...environment.map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`),
    `ExecStart=${[nodePath, scriptPath, "service-run", "--live", "--probe-all-providers"].map(systemdQuote).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=10",
    `StandardOutput=append:${systemdEscapePercent(join(logDir, "gateway.out.log"))}`,
    `StandardError=append:${systemdEscapePercent(join(logDir, "gateway.err.log"))}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

export function generateWindowsServiceRunner(config: ViserConfig, options: ServicePlistOptions = {}): string {
  const nodePath = options.nodePath ?? process.execPath;
  const scriptPath = options.scriptPath ?? join(config.assistant.workdir, "src", "index.ts");
  const logDir = join(config.storage.dir, "logs");
  const envVariables = [
    ["PATH", process.env.PATH ?? ""],
    ...(config.configPath ? [["VISER_CONFIG", config.configPath]] : []),
    ...(process.env.VISER_ENV ? [["VISER_ENV", process.env.VISER_ENV]] : [])
  ];

  return [
    "# Viser Windows Task Scheduler runner.",
    "# Generated artifact; inspect before registering the scheduled task.",
    "$ErrorActionPreference = 'Stop'",
    `Set-Location -LiteralPath ${powerShellSingleQuoted(config.assistant.workdir)}`,
    ...envVariables.map(([key, value]) => `$env:${key} = ${powerShellSingleQuoted(value)}`),
    `$outLog = ${powerShellSingleQuoted(join(logDir, "gateway.out.log"))}`,
    `$errLog = ${powerShellSingleQuoted(join(logDir, "gateway.err.log"))}`,
    "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outLog) | Out-Null",
    `& ${powerShellSingleQuoted(nodePath)} ${powerShellSingleQuoted(scriptPath)} 'service-run' '--live' '--probe-all-providers' 1>> $outLog 2>> $errLog`,
    "exit $LASTEXITCODE",
    ""
  ].join("\n");
}

export function generateWindowsTaskXml(config: ViserConfig, options: WindowsServiceOptions = {}): string {
  const taskUri = options.taskUri ?? windowsTaskUri(config);
  const powershellPath = options.powershellPath ?? "powershell.exe";
  const runnerPath = options.runnerPath ?? windowsRunnerPath(config);
  const argumentsText = `-NoProfile -NonInteractive -File "${runnerPath.replaceAll('"', '""')}"`;

  return `<?xml version="1.0" encoding="UTF-16"?>\n<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">\n  <RegistrationInfo>\n    <Date>${escapeXml(nowIso())}</Date>\n    <Author>KMokky</Author>\n    <URI>${escapeXml(taskUri)}</URI>\n    <Description>${escapeXml(config.assistant.name)} local-CLI assistant gateway</Description>\n  </RegistrationInfo>\n  <Triggers>\n    <LogonTrigger>\n      <Enabled>true</Enabled>\n    </LogonTrigger>\n  </Triggers>\n  <Principals>\n    <Principal id="Author">\n      <LogonType>InteractiveToken</LogonType>\n      <RunLevel>LeastPrivilege</RunLevel>\n    </Principal>\n  </Principals>\n  <Settings>\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\n    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\n    <AllowHardTerminate>true</AllowHardTerminate>\n    <StartWhenAvailable>true</StartWhenAvailable>\n    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>\n    <IdleSettings>\n      <StopOnIdleEnd>false</StopOnIdleEnd>\n      <RestartOnIdle>false</RestartOnIdle>\n    </IdleSettings>\n    <AllowStartOnDemand>true</AllowStartOnDemand>\n    <Enabled>true</Enabled>\n    <Hidden>false</Hidden>\n    <RunOnlyIfIdle>false</RunOnlyIfIdle>\n    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\n    <Priority>7</Priority>\n    <RestartOnFailure>\n      <Interval>PT1M</Interval>\n      <Count>3</Count>\n    </RestartOnFailure>\n  </Settings>\n  <Actions Context="Author">\n    <Exec>\n      <Command>${escapeXml(powershellPath)}</Command>\n      <Arguments>${escapeXml(argumentsText)}</Arguments>\n      <WorkingDirectory>${escapeXml(config.assistant.workdir)}</WorkingDirectory>\n    </Exec>\n  </Actions>\n</Task>\n`;
}

export function serviceLabel(config: ViserConfig): string {
  return `com.mokky.${config.assistant.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}

export function systemdUnitName(config: ViserConfig): string {
  return serviceLabel(config);
}

export function userLaunchAgentPath(config: ViserConfig): string {
  return join(homedir(), "Library", "LaunchAgents", `${serviceLabel(config)}.plist`);
}

export function userSystemdUnitPath(config: ViserConfig): string {
  return join(homedir(), ".config", "systemd", "user", `${systemdUnitName(config)}.service`);
}

export function windowsTaskPath(): string {
  return "\\KMokky\\";
}

export function windowsTaskName(config: ViserConfig): string {
  return config.assistant.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "Viser";
}

export function windowsTaskUri(config: ViserConfig): string {
  return `${windowsTaskPath()}${windowsTaskName(config)}`;
}

export function windowsRunnerPath(config: ViserConfig): string {
  return join(config.storage.dir, "windows", `${serviceLabel(config)}.ps1`);
}

export function servicePathValue(pathValue = ""): string {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const entry of [...pathValue.split(":"), ...FALLBACK_SERVICE_PATHS]) {
    const trimmed = entry.trim();
    if (!trimmed || isTransientServicePath(trimmed) || seen.has(trimmed)) continue;
    seen.add(trimmed);
    paths.push(trimmed);
  }
  return paths.join(":");
}

function installInstructions(target: string, config: ViserConfig): string {
  return [
    `Wrote ${target}`,
    "",
    "Before installing:",
    "  node src/index.ts service check",
    "",
    "Recommended secure install:",
    "  node src/index.ts service install",
    "",
    "Manual install (advanced; verify the destination is not a symlink first):",
    `  cp ${target} ${userLaunchAgentPath(config)}`,
    `  chmod 600 ${userLaunchAgentPath(config)}`,
    `  launchctl bootstrap ${launchDomain()} ${userLaunchAgentPath(config)}`,
    "",
    "If launchctl says the job is already loaded:",
    "  node src/index.ts service reinstall",
    "",
    "To inspect service-run output after launch:",
    "  node src/index.ts service logs",
    "",
    "To stop later:",
    `  launchctl bootout ${launchDomain()} ${userLaunchAgentPath(config)}`
  ].join("\n");
}

function systemdInstallInstructions(target: string, config: ViserConfig): string {
  const unitPath = userSystemdUnitPath(config);
  return [
    `Wrote ${target}`,
    "",
    "Before installing:",
    "  node src/index.ts service check",
    "",
    "Manual Linux systemd --user install (advanced; verify the destination is not a symlink first):",
    "  mkdir -p ~/.config/systemd/user",
    `  cp ${target} ${unitPath}`,
    `  chmod 600 ${unitPath}`,
    "  systemctl --user daemon-reload",
    `  systemctl --user enable --now ${systemdUnitName(config)}.service`,
    "",
    "To inspect service-run output after launch:",
    `  journalctl --user -u ${systemdUnitName(config)}.service -n 100 --no-pager`,
    "  node src/index.ts service logs",
    "",
    "To stop later:",
    `  systemctl --user disable --now ${systemdUnitName(config)}.service`,
    "",
    "If the unit should survive logout on Linux, enable linger explicitly:",
    "  loginctl enable-linger \"$USER\""
  ].join("\n");
}

function windowsInstallInstructions(artifacts: WindowsServiceArtifacts, config: ViserConfig): string {
  return [
    `Wrote ${artifacts.taskXmlPath}`,
    `Wrote ${artifacts.runnerPath}`,
    "",
    "Before registering:",
    "  node src/index.ts service check",
    "",
    "Manual Windows Task Scheduler install (run from PowerShell after reviewing the XML and runner):",
    `  Register-ScheduledTask -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))} -Xml (Get-Content -Raw ${powerShellSingleQuoted(artifacts.taskXmlPath)})`,
    `  Start-ScheduledTask -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))}`,
    "",
    "To inspect service-run output after launch:",
    `  Get-ScheduledTask -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))}`,
    `  Get-ScheduledTaskInfo -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))}`,
    "  node src/index.ts service logs",
    "",
    "To stop later:",
    `  Stop-ScheduledTask -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))}`,
    `  Unregister-ScheduledTask -TaskPath ${powerShellSingleQuoted(windowsTaskPath())} -TaskName ${powerShellSingleQuoted(windowsTaskName(config))} -Confirm:$false`
  ].join("\n");
}

async function serviceCheck(config: ViserConfig): Promise<string> {
  const gate = await preflight(config, { strict: true, live: true, probeAllProviders: true });
  return [
    `Viser service check: ${gate.ok ? "PASS" : "BLOCKED"}`,
    "mode: check-only (no launchd/systemd/Windows service artifact was installed or started)",
    `plist path: ${userLaunchAgentPath(config)}`,
    `workspace plist: ${join(config.storage.dir, "launchd", `${serviceLabel(config)}.plist`)}`,
    `workspace systemd unit: ${join(config.storage.dir, "systemd", `${systemdUnitName(config)}.service`)}`,
    `workspace Windows task XML: ${join(config.storage.dir, "windows", `${serviceLabel(config)}.task.xml`)}`,
    `logs: ${join(config.storage.dir, "logs", "gateway.out.log")} / ${join(config.storage.dir, "logs", "gateway.err.log")}`,
    "",
    gate.report,
    "",
    gate.ok
      ? "Next: run `node src/index.ts service write-plist`, `service write-systemd`, or `service write-windows` to inspect the OS service artifact."
      : "Next: fix the blockers above; `service install` will not be useful until this check passes."
  ].join("\n");
}

async function serviceLogs(config: ViserConfig, lines: number): Promise<string> {
  const outPath = join(config.storage.dir, "logs", "gateway.out.log");
  const errPath = join(config.storage.dir, "logs", "gateway.err.log");
  const [stdout, stderr] = await Promise.all([
    readTail(outPath, lines, config.assistant.workdir),
    readTail(errPath, lines, config.assistant.workdir)
  ]);

  return [
    `Viser service logs (last ${lines} lines)`,
    "",
    `== ${outPath} ==`,
    redactLogContent(stdout),
    "",
    `== ${errPath} ==`,
    redactLogContent(stderr)
  ].join("\n");
}

async function serviceTrimLogs(config: ViserConfig, maxBytes?: number, keepBytes?: number): Promise<string> {
  try {
    const trims = await trimServiceLogs(config, { maxBytes, keepBytes });
    return [
      "Viser service log trim",
      ...trims.map((trim) => [
        `- ${trim.path}`,
        `  status: ${trim.trimmed ? "trimmed" : "unchanged"}`,
        `  bytes: ${trim.bytesBefore} -> ${trim.bytesAfter}`
      ].join("\n"))
    ].join("\n");
  } catch (error) {
    return [
      "Viser service log trim: blocked",
      error instanceof Error ? error.message : String(error)
    ].join("\n");
  }
}

async function readTail(path: string, lines: number, root: string): Promise<string> {
  try {
    await assertNoSymlinkComponentsUnderRoot(dirname(path), root);
    const info = await lstat(path);
    if (info.isSymbolicLink()) return "(log file is a symlink; refusing to read)";
    if (!info.isFile()) return "(log path is not a regular file)";
    const content = await readLogFileTail(path, info.size);
    const chunks = content.split(/\r?\n/);
    const tail = chunks.slice(Math.max(0, chunks.length - lines - 1)).join("\n").trimEnd();
    const truncated = info.size > MAX_LOG_TAIL_BYTES ? `[log truncated to last ${MAX_LOG_TAIL_BYTES} bytes]\n` : "";
    return tail ? `${truncated}${tail}` : "(empty)";
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return "(log file not found yet)";
    return `(unable to read log: ${error instanceof Error ? error.message : String(error)})`;
  }
}

async function ensurePrivateServiceLogs(config: ViserConfig): Promise<void> {
  const logDir = join(config.storage.dir, "logs");
  await ensurePrivateDirectory(logDir, config.assistant.workdir);
  await Promise.all([
    ensurePrivateLogFile(join(logDir, "gateway.out.log")),
    ensurePrivateLogFile(join(logDir, "gateway.err.log"))
  ]);
}

async function ensurePrivateDirectory(path: string, root: string): Promise<void> {
  await assertNoSymlinkComponentsUnderRoot(path, root);
  await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  await assertNoSymlinkComponentsUnderRoot(path, root);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Service path is a symlink; refusing to use it: ${path}`);
  if (!info.isDirectory()) throw new Error(`Service path is not a directory: ${path}`);
  await chmod(path, PRIVATE_DIR_MODE);
}

async function ensureLaunchAgentsDirectory(path: string): Promise<void> {
  await assertLaunchAgentPathComponentsSafe(path);
  await mkdir(path, { recursive: true });
  await assertLaunchAgentPathComponentsSafe(path);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`LaunchAgents directory is a symlink; refusing to install: ${path}`);
  if (!info.isDirectory()) throw new Error(`LaunchAgents path is not a directory: ${path}`);
}

async function ensureSystemdUserDirectory(path: string): Promise<void> {
  await assertSystemdPathComponentsSafe(path);
  await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  await assertSystemdPathComponentsSafe(path);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`systemd user directory is a symlink; refusing to install: ${path}`);
  if (!info.isDirectory()) throw new Error(`systemd user path is not a directory: ${path}`);
}

async function assertLaunchAgentTargetSafe(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`LaunchAgent plist is a symlink; refusing to replace it: ${path}`);
    if (!info.isFile()) throw new Error(`LaunchAgent plist path is not a regular file: ${path}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertSystemdUnitTargetSafe(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`systemd user unit is a symlink; refusing to replace it: ${path}`);
    if (!info.isFile()) throw new Error(`systemd user unit path is not a regular file: ${path}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertLaunchAgentRemovalPathSafe(path: string): Promise<void> {
  await assertLaunchAgentPathComponentsSafe(dirname(path));
  try {
    const info = await lstat(dirname(path));
    if (info.isSymbolicLink()) throw new Error(`LaunchAgents directory is a symlink; refusing to remove plist through it: ${dirname(path)}`);
    if (!info.isDirectory()) throw new Error(`LaunchAgents path is not a directory: ${dirname(path)}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertSystemdUnitRemovalPathSafe(path: string): Promise<void> {
  await assertSystemdPathComponentsSafe(dirname(path));
  try {
    const info = await lstat(dirname(path));
    if (info.isSymbolicLink()) throw new Error(`systemd user directory is a symlink; refusing to remove unit through it: ${dirname(path)}`);
    if (!info.isDirectory()) throw new Error(`systemd user path is not a directory: ${dirname(path)}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertLaunchAgentPathComponentsSafe(path: string): Promise<void> {
  await assertNoSymlinkComponentsUnderRoot(path, homedir());
}

async function assertSystemdPathComponentsSafe(path: string): Promise<void> {
  await assertNoSymlinkComponentsUnderRoot(path, homedir());
}

async function readLaunchAgentSource(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`LaunchAgent workspace plist is a symlink; refusing to install: ${path}`);
  if (!info.isFile()) throw new Error(`LaunchAgent workspace plist is not a regular file: ${path}`);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openInfo = await handle.stat();
    if (!openInfo.isFile()) throw new Error(`LaunchAgent workspace plist is not a regular file: ${path}`);
    return await handle.readFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new Error(`LaunchAgent workspace plist is a symlink; refusing to install: ${path}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

async function readRegularServiceSource(path: string, label: string): Promise<Buffer> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`${label} is a symlink; refusing to install: ${path}`);
  if (!info.isFile()) throw new Error(`${label} is not a regular file: ${path}`);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openInfo = await handle.stat();
    if (!openInfo.isFile()) throw new Error(`${label} is not a regular file: ${path}`);
    return await handle.readFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ELOOP") {
      throw new Error(`${label} is a symlink; refusing to install: ${path}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

async function ensurePrivateLogFile(path: string): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

async function trimServiceLogFile(path: string, maxBytes: number, keepBytes: number): Promise<ServiceLogTrimResult> {
  const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Service log path is not a regular file: ${path}`);
    if (info.size <= maxBytes) return { path, trimmed: false, bytesBefore: info.size, bytesAfter: info.size };

    const bytesToRead = Math.min(info.size, keepBytes);
    const start = Math.max(0, info.size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    const note = Buffer.from(`[viser log trimmed at ${nowIso()}; kept last ${bytesRead} of ${info.size} bytes]\n`, "utf8");
    const next = Buffer.concat([note, buffer.subarray(0, bytesRead)]);
    await handle.truncate(0);
    await handle.write(next, 0, next.length, 0);
    await handle.truncate(next.length);
    await handle.chmod(PRIVATE_FILE_MODE);
    return { path, trimmed: true, bytesBefore: info.size, bytesAfter: next.length };
  } finally {
    await handle.close();
  }
}

async function readLogFileTail(path: string, size: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.chmod(PRIVATE_FILE_MODE);
    const bytesToRead = Math.min(size, MAX_LOG_TAIL_BYTES);
    const start = Math.max(0, size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function serviceManagerCommand(config: ViserConfig, action: "status" | "start" | "stop", options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    const launchdAction = action === "status" ? "print" : action === "start" ? "kickstart" : "kill";
    return await launchctlCommand(config, launchdAction, options);
  }
  if (platform === "linux") {
    const unit = `${systemdUnitName(config)}.service`;
    const args = action === "status"
      ? ["--user", "status", unit, "--no-pager"]
      : action === "start"
        ? ["--user", "start", unit]
        : ["--user", "stop", unit];
    const result = await systemctlCommand(options, args);
    return formatServiceCommandResult(`systemd ${action}`, result);
  }
  if (platform === "win32") {
    const script = action === "status"
      ? windowsStatusTaskScript(config)
      : action === "start"
        ? windowsStartTaskScript(config)
        : windowsStopTaskScript(config);
    const result = await powershellCommand(options, script);
    return formatServiceCommandResult(`windows task ${action}`, result);
  }
  return `Native service ${action} is not supported on ${platform}.`;
}

async function launchctlCommand(config: ViserConfig, action: "print" | "kickstart" | "kill", options: ServiceControlOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") return `launchd service ${action} is only supported on macOS.`;
  const labelTarget = `${launchDomain()}/${serviceLabel(config)}`;
  const args = action === "print" ? ["print", labelTarget] : action === "kickstart" ? ["kickstart", "-k", labelTarget] : ["kill", "TERM", labelTarget];
  const result = await runServiceCommand(options, { command: "launchctl", args, timeoutMs: 15_000 });
  return formatLaunchctlResult(action, result);
}

function formatLaunchctlResult(action: string, result: { stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }, extra: string[] = []): string {
  const base = formatServiceCommandResult(action, result, extra);
  const output = redactLogContent([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
  const hints = launchctlHints(output);
  return [base, ...hints].filter(Boolean).join("\n");
}

function formatServiceCommandResult(action: string, result: { stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null }, extra: string[] = []): string {
  const output = redactLogContent([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
  const status = result.exitCode === 0 && !result.signal ? "ok" : "failed";
  return [`service ${action}: ${status}`, ...extra, output].filter(Boolean).join("\n");
}

async function serviceGate(config: ViserConfig, options: ServiceControlOptions): Promise<ServiceGateResult> {
  if (options.preflightRunner) return await options.preflightRunner(config);
  return await preflight(config, { strict: true, live: true, probeAllProviders: true });
}

async function runServiceCommand(options: ServiceControlOptions, command: RunCommandOptions): Promise<RunCommandResult> {
  return await (options.runner ?? runCommand)(command);
}

async function systemctlCommand(options: ServiceControlOptions, args: string[]): Promise<RunCommandResult> {
  return await runServiceCommand(options, { command: "systemctl", args, timeoutMs: 15_000 });
}

async function powershellCommand(options: ServiceControlOptions, script: string): Promise<RunCommandResult> {
  return await runServiceCommand(options, {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs: 20_000,
    maxOutputBytes: 200_000
  });
}

function windowsRegisterTaskScript(artifacts: WindowsServiceArtifacts, config: ViserConfig): string {
  const taskPath = powerShellSingleQuoted(windowsTaskPath());
  const taskName = powerShellSingleQuoted(windowsTaskName(config));
  const taskXmlPath = powerShellSingleQuoted(artifacts.taskXmlPath);
  return [
    "$ErrorActionPreference = 'Stop'",
    `$xml = Get-Content -Raw -LiteralPath ${taskXmlPath}`,
    `Register-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} -Xml $xml -Force | Out-Null`,
    `Start-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName}`,
    `Get-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} | Format-List TaskPath,TaskName,State`
  ].join("; ");
}

function windowsUnregisterTaskScript(config: ViserConfig): string {
  const taskPath = powerShellSingleQuoted(windowsTaskPath());
  const taskName = powerShellSingleQuoted(windowsTaskName(config));
  return [
    "$ErrorActionPreference = 'Continue'",
    `Stop-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} -ErrorAction SilentlyContinue`,
    `Unregister-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} -Confirm:$false -ErrorAction SilentlyContinue`
  ].join("; ");
}

function windowsStatusTaskScript(config: ViserConfig): string {
  const taskPath = powerShellSingleQuoted(windowsTaskPath());
  const taskName = powerShellSingleQuoted(windowsTaskName(config));
  return [
    "$ErrorActionPreference = 'Stop'",
    `$task = Get-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName}`,
    `$info = Get-ScheduledTaskInfo -TaskPath ${taskPath} -TaskName ${taskName}`,
    "$task | Format-List TaskPath,TaskName,State",
    "$info | Format-List LastRunTime,LastTaskResult,NextRunTime,NumberOfMissedRuns"
  ].join("; ");
}

function windowsStartTaskScript(config: ViserConfig): string {
  return windowsTaskControlScript(config, "Start-ScheduledTask");
}

function windowsStopTaskScript(config: ViserConfig): string {
  return windowsTaskControlScript(config, "Stop-ScheduledTask");
}

function windowsTaskControlScript(config: ViserConfig, command: "Start-ScheduledTask" | "Stop-ScheduledTask"): string {
  const taskPath = powerShellSingleQuoted(windowsTaskPath());
  const taskName = powerShellSingleQuoted(windowsTaskName(config));
  return [
    "$ErrorActionPreference = 'Stop'",
    `${command} -TaskPath ${taskPath} -TaskName ${taskName}`,
    `Get-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} | Format-List TaskPath,TaskName,State`
  ].join("; ");
}

function launchDomain(): string {
  return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}

function isTransientServicePath(path: string): boolean {
  return TRANSIENT_SERVICE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function launchctlHints(output: string): string[] {
  const normalized = output.toLowerCase();
  const hints: string[] = [];
  if (normalized.includes("could not find service")) hints.push("next: node src/index.ts service install");
  if (normalized.includes("service is already loaded") || normalized.includes("already bootstrapped")) {
    hints.push("next: node src/index.ts service reinstall");
  }
  if (normalized.includes("bootstrap failed: 5") || normalized.includes("input/output error")) {
    hints.push("next: run `launchctl bootout ...` or `node src/index.ts service reinstall`; launchctl may also require inspecting Console logs.");
  }
  return hints;
}

function parsePositiveInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function systemdQuote(value: string): string {
  return `"${systemdEscapePercent(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function systemdEscapePercent(value: string): string {
  return value.replaceAll("%", "%%");
}

function powerShellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function redactLogContent(content: string): string {
  let output = content;

  output = output.replace(
    /("(?:(?:[^"\\]|\\.)*?(?:token|secret|password|credential|api[_-]?key)(?:[^"\\]|\\.)*?)"\s*:\s*)"(?:(?:[^"\\]|\\.)*)"/giu,
    `$1"${REDACTED}"`
  );
  output = output.replace(
    /(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*["'])([^"'\r\n]*)/giu,
    `$1${REDACTED}`
  );
  output = output.replace(
    /(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*)([^"'\s,}\]]+)/giu,
    `$1${REDACTED}`
  );
  output = output.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu, REDACTED);
  output = output.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, REDACTED);
  output = output.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/giu, `$1${REDACTED}`);
  output = output.replace(/\b(Bot\s+)[A-Za-z0-9._-]{20,}/gu, `$1${REDACTED}`);

  return output;
}
