// ================================================================
// Service helper
// ================================================================
// Viser is foreground-only. Historical native service helpers remain only for
// safe inspection, cleanup, and log/state migration of already-installed
// LaunchAgent/systemd/Task Scheduler artifacts. New background service creation
// and service-run startup are intentionally disabled.
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { dashboardCheckReport } from "./dashboard-check.js";
import { assertNoSymlinkComponentsUnderRoot, PRIVATE_FILE_MODE, removePrivateFileIfExists } from "../utils/files.js";
import { runCommand } from "../utils/exec.js";
import { nowIso } from "../utils/text.js";
const REDACTED = "[REDACTED]";
const PRIVATE_DIR_MODE = 0o700;
const MAX_LOG_TAIL_BYTES = 1_000_000;
const DEFAULT_SERVICE_LOG_MAX_BYTES = 5_000_000;
const DEFAULT_SERVICE_LOG_KEEP_BYTES = 1_000_000;
export function backgroundServiceDisabledMessage(command = "service") {
    return [
        `Viser ${command}: disabled`,
        "Viser no longer installs, starts, or runs a background service.",
        "Start Viser only in a foreground terminal window:",
        "  viser",
        "",
        "The process stops when that terminal process exits. Existing old service registrations can still be inspected or removed with:",
        "  viser service status",
        "  viser service stop",
        "  viser service uninstall"
    ].join("\n");
}
export async function serviceCommand(args, config) {
    const command = args[0] ?? "help";
    switch (command) {
        case "plist":
        case "write-plist": {
            return backgroundServiceDisabledMessage(`service ${command}`);
        }
        case "systemd":
        case "unit":
        case "systemd-unit":
        case "write-systemd":
        case "write-unit": {
            return backgroundServiceDisabledMessage(`service ${command}`);
        }
        case "windows":
        case "windows-task":
        case "task":
        case "write-windows":
        case "write-task": {
            return backgroundServiceDisabledMessage(`service ${command}`);
        }
        case "check":
        case "doctor":
            return backgroundServiceDisabledMessage(`service ${command}`);
        case "logs":
            return await serviceLogs(config, parsePositiveInt(args[1]) ?? 80);
        case "health":
        case "dashboard-check":
            return await dashboardCheckReport(config);
        case "trim-logs":
            return await serviceTrimLogs(config, parsePositiveInt(args[1]), parsePositiveInt(args[2]));
        case "install":
        case "reinstall":
        case "start":
        case "restart":
            return backgroundServiceDisabledMessage(`service ${command}`);
        case "uninstall":
            return await uninstallService(config);
        case "status":
            return await serviceManagerCommand(config, "status");
        case "stop":
            return await serviceManagerCommand(config, "stop");
        default:
            return [
                "Viser service commands",
                "- background service install/start/restart/service-run and artifact generation are disabled",
                "- service status: print legacy native launchd/systemd/Task Scheduler status",
                "- service stop: stop a legacy native service registration if one still exists",
                "- service uninstall: stop/remove a legacy native launchd/systemd/Task Scheduler registration",
                "- service logs [lines]: print recent legacy gateway stdout/stderr logs",
                "- service health: verify the live localhost dashboard/schema contract without provider calls",
                "- service trim-logs [maxBytes] [keepBytes]: trim oversized legacy gateway stdout/stderr logs now",
                "",
                "Start Viser only in a foreground terminal window:",
                "  viser"
            ].join("\n");
    }
}
export async function trimServiceLogs(config, options = {}) {
    const logDir = join(config.storage.dir, "logs");
    await ensurePrivateDirectory(logDir, config.assistant.workdir);
    const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_SERVICE_LOG_MAX_BYTES);
    const keepBytes = Math.max(1, Math.min(options.keepBytes ?? DEFAULT_SERVICE_LOG_KEEP_BYTES, maxBytes));
    return await Promise.all([
        trimServiceLogFile(join(logDir, "gateway.out.log"), maxBytes, keepBytes),
        trimServiceLogFile(join(logDir, "gateway.err.log"), maxBytes, keepBytes)
    ]);
}
export async function installService(config, options = {}) {
    void config;
    void options;
    return backgroundServiceDisabledMessage("service install");
}
export async function reinstallService(config, options = {}) {
    void config;
    void options;
    return backgroundServiceDisabledMessage("service reinstall");
}
export async function uninstallService(config, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform === "linux")
        return await uninstallSystemdService(config, options);
    if (platform === "win32")
        return await uninstallWindowsService(config, options);
    if (platform !== "darwin")
        return `Native service uninstall is not supported on ${platform}.`;
    const userPlist = userLaunchAgentPath(config);
    await assertLaunchAgentRemovalPathSafe(userPlist);
    const bootout = await runServiceCommand(options, { command: "launchctl", args: ["bootout", launchDomain(), userPlist], timeoutMs: 15_000 });
    const removed = await removeLaunchAgentPlist(userPlist);
    return formatLaunchctlResult("uninstall", bootout, [removed ? `Removed ${userPlist}` : `No LaunchAgent plist found at ${userPlist}`]);
}
export async function removeLaunchAgentPlist(path) {
    await assertLaunchAgentRemovalPathSafe(path);
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`LaunchAgent plist is a symlink; refusing to remove it: ${path}`);
        if (!info.isFile())
            throw new Error(`LaunchAgent plist path is not a regular file: ${path}`);
        return await removePrivateFileIfExists(path, { dirs: [dirname(path)] });
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
async function uninstallSystemdService(config, options) {
    const platform = options.platform ?? process.platform;
    if (platform !== "linux")
        return "Linux systemd service uninstall is only supported on Linux.";
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
async function uninstallWindowsService(config, options) {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32")
        return "Windows Task Scheduler service uninstall is only supported on Windows.";
    const result = await powershellCommand(options, windowsUnregisterTaskScript(config));
    return formatServiceCommandResult("windows task uninstall", result, [`Target ${windowsTaskUri(config)}`]);
}
async function removeSystemdUserUnit(path) {
    await assertSystemdUnitRemovalPathSafe(path);
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`systemd user unit is a symlink; refusing to remove it: ${path}`);
        if (!info.isFile())
            throw new Error(`systemd user unit path is not a regular file: ${path}`);
        return await removePrivateFileIfExists(path, { dirs: [dirname(path)] });
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
export function serviceLabel(config) {
    return `com.mokky.${config.assistant.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-")}`;
}
export function systemdUnitName(config) {
    return serviceLabel(config);
}
export function userLaunchAgentPath(config) {
    return join(homedir(), "Library", "LaunchAgents", `${serviceLabel(config)}.plist`);
}
export function userSystemdUnitPath(config) {
    return join(homedir(), ".config", "systemd", "user", `${systemdUnitName(config)}.service`);
}
export function windowsTaskPath() {
    return "\\KMokky\\";
}
export function windowsTaskName(config) {
    return config.assistant.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "Viser";
}
export function windowsTaskUri(config) {
    return `${windowsTaskPath()}${windowsTaskName(config)}`;
}
async function serviceLogs(config, lines) {
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
async function serviceTrimLogs(config, maxBytes, keepBytes) {
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
    }
    catch (error) {
        return [
            "Viser service log trim: blocked",
            error instanceof Error ? error.message : String(error)
        ].join("\n");
    }
}
async function readTail(path, lines, root) {
    try {
        await assertNoSymlinkComponentsUnderRoot(dirname(path), root);
        const info = await lstat(path);
        if (info.isSymbolicLink())
            return "(log file is a symlink; refusing to read)";
        if (!info.isFile())
            return "(log path is not a regular file)";
        const content = await readLogFileTail(path, info.size);
        const chunks = content.split(/\r?\n/);
        const tail = chunks.slice(Math.max(0, chunks.length - lines - 1)).join("\n").trimEnd();
        const truncated = info.size > MAX_LOG_TAIL_BYTES ? `[log truncated to last ${MAX_LOG_TAIL_BYTES} bytes]\n` : "";
        return tail ? `${truncated}${tail}` : "(empty)";
    }
    catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (code === "ENOENT")
            return "(log file not found yet)";
        return `(unable to read log: ${error instanceof Error ? error.message : String(error)})`;
    }
}
async function ensurePrivateDirectory(path, root) {
    await assertNoSymlinkComponentsUnderRoot(path, root);
    await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
    await assertNoSymlinkComponentsUnderRoot(path, root);
    const info = await lstat(path);
    if (info.isSymbolicLink())
        throw new Error(`Service path is a symlink; refusing to use it: ${path}`);
    if (!info.isDirectory())
        throw new Error(`Service path is not a directory: ${path}`);
    await chmod(path, PRIVATE_DIR_MODE);
}
async function assertLaunchAgentRemovalPathSafe(path) {
    await assertLaunchAgentPathComponentsSafe(dirname(path));
    try {
        const info = await lstat(dirname(path));
        if (info.isSymbolicLink())
            throw new Error(`LaunchAgents directory is a symlink; refusing to remove plist through it: ${dirname(path)}`);
        if (!info.isDirectory())
            throw new Error(`LaunchAgents path is not a directory: ${dirname(path)}`);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
async function assertSystemdUnitRemovalPathSafe(path) {
    await assertSystemdPathComponentsSafe(dirname(path));
    try {
        const info = await lstat(dirname(path));
        if (info.isSymbolicLink())
            throw new Error(`systemd user directory is a symlink; refusing to remove unit through it: ${dirname(path)}`);
        if (!info.isDirectory())
            throw new Error(`systemd user path is not a directory: ${dirname(path)}`);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
async function assertLaunchAgentPathComponentsSafe(path) {
    await assertNoSymlinkComponentsUnderRoot(path, homedir());
}
async function assertSystemdPathComponentsSafe(path) {
    await assertNoSymlinkComponentsUnderRoot(path, homedir());
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
async function trimServiceLogFile(path, maxBytes, keepBytes) {
    const handle = await open(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, PRIVATE_FILE_MODE);
    try {
        await handle.chmod(PRIVATE_FILE_MODE);
        const info = await handle.stat();
        if (!info.isFile())
            throw new Error(`Service log path is not a regular file: ${path}`);
        if (info.size <= maxBytes)
            return { path, trimmed: false, bytesBefore: info.size, bytesAfter: info.size };
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
    }
    finally {
        await handle.close();
    }
}
async function readLogFileTail(path, size) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        await handle.chmod(PRIVATE_FILE_MODE);
        const bytesToRead = Math.min(size, MAX_LOG_TAIL_BYTES);
        const start = Math.max(0, size - bytesToRead);
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
        return buffer.subarray(0, bytesRead).toString("utf8");
    }
    finally {
        await handle.close();
    }
}
async function serviceManagerCommand(config, action, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform === "darwin") {
        const launchdAction = action === "status" ? "print" : "kill";
        return await launchctlCommand(config, launchdAction, options);
    }
    if (platform === "linux") {
        const unit = `${systemdUnitName(config)}.service`;
        const args = action === "status" ? ["--user", "status", unit, "--no-pager"] : ["--user", "stop", unit];
        const result = await systemctlCommand(options, args);
        return formatServiceCommandResult(`systemd ${action}`, result);
    }
    if (platform === "win32") {
        const script = action === "status" ? windowsStatusTaskScript(config) : windowsStopTaskScript(config);
        const result = await powershellCommand(options, script);
        return formatServiceCommandResult(`windows task ${action}`, result);
    }
    return `Native service ${action} is not supported on ${platform}.`;
}
async function launchctlCommand(config, action, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== "darwin")
        return `launchd service ${action} is only supported on macOS.`;
    const labelTarget = `${launchDomain()}/${serviceLabel(config)}`;
    const args = action === "print" ? ["print", labelTarget] : ["kill", "TERM", labelTarget];
    const result = await runServiceCommand(options, { command: "launchctl", args, timeoutMs: 15_000 });
    return formatLaunchctlResult(action, result);
}
function formatLaunchctlResult(action, result, extra = []) {
    const base = formatServiceCommandResult(action, result, extra);
    const output = redactLogContent([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
    const hints = launchctlHints(output);
    return [base, ...hints].filter(Boolean).join("\n");
}
function formatServiceCommandResult(action, result, extra = []) {
    const output = redactLogContent([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
    const status = result.exitCode === 0 && !result.signal ? "ok" : "failed";
    return [`service ${action}: ${status}`, ...extra, output].filter(Boolean).join("\n");
}
async function runServiceCommand(options, command) {
    return await (options.runner ?? runCommand)(command);
}
async function systemctlCommand(options, args) {
    return await runServiceCommand(options, { command: "systemctl", args, timeoutMs: 15_000 });
}
async function powershellCommand(options, script) {
    return await runServiceCommand(options, {
        command: "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        timeoutMs: 20_000,
        maxOutputBytes: 200_000
    });
}
function windowsUnregisterTaskScript(config) {
    const taskPath = powerShellSingleQuoted(windowsTaskPath());
    const taskName = powerShellSingleQuoted(windowsTaskName(config));
    return [
        "$ErrorActionPreference = 'Continue'",
        `Stop-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} -ErrorAction SilentlyContinue`,
        `Unregister-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} -Confirm:$false -ErrorAction SilentlyContinue`
    ].join("; ");
}
function windowsStatusTaskScript(config) {
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
function windowsStopTaskScript(config) {
    const taskPath = powerShellSingleQuoted(windowsTaskPath());
    const taskName = powerShellSingleQuoted(windowsTaskName(config));
    return [
        "$ErrorActionPreference = 'Stop'",
        `Stop-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName}`,
        `Get-ScheduledTask -TaskPath ${taskPath} -TaskName ${taskName} | Format-List TaskPath,TaskName,State`
    ].join("; ");
}
function launchDomain() {
    return `gui/${typeof process.getuid === "function" ? process.getuid() : 501}`;
}
function launchctlHints(output) {
    const normalized = output.toLowerCase();
    const hints = [];
    if (normalized.includes("could not find service"))
        hints.push("next: no background service is expected; run `viser` in a foreground terminal to start Viser.");
    if (normalized.includes("service is already loaded") || normalized.includes("already bootstrapped")) {
        hints.push("next: remove the legacy background service with `viser service uninstall`.");
    }
    if (normalized.includes("bootstrap failed: 5") || normalized.includes("input/output error")) {
        hints.push("next: run `launchctl bootout ...` or `viser service uninstall`; launchctl may also require inspecting Console logs.");
    }
    return hints;
}
function parsePositiveInt(value) {
    if (!value)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function powerShellSingleQuoted(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
function redactLogContent(content) {
    let output = content;
    output = output.replace(/("(?:(?:[^"\\]|\\.)*?(?:token|secret|password|credential|api[_-]?key)(?:[^"\\]|\\.)*?)"\s*:\s*)"(?:(?:[^"\\]|\\.)*)"/giu, `$1"${REDACTED}"`);
    output = output.replace(/(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*["'])([^"'\r\n]*)/giu, `$1${REDACTED}`);
    output = output.replace(/(\b[A-Za-z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY)[A-Za-z0-9_]*\b\s*[:=]\s*)([^"'\s,}\]]+)/giu, `$1${REDACTED}`);
    output = output.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/gu, REDACTED);
    output = output.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gu, REDACTED);
    output = output.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{16,}=*/giu, `$1${REDACTED}`);
    output = output.replace(/\b(Bot\s+)[A-Za-z0-9._-]{20,}/gu, `$1${REDACTED}`);
    return output;
}
