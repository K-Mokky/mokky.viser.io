// ================================================================
// Safe subprocess runner for logged-in AI CLIs
// ================================================================
// Providers are invoked without a shell. This avoids shell expansion and keeps
// the assistant from accidentally turning a prompt into a local command.
import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync } from "node:fs";
import { delimiter, isAbsolute, join, relative, resolve } from "node:path";
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;
export async function runCommand(options) {
    const started = Date.now();
    const maxOutputBytes = Math.max(1, options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
    return await new Promise((resolve, reject) => {
        const child = spawn(options.command, options.args, {
            cwd: options.cwd,
            env: commandEnv(options),
            shell: false,
            stdio: ["pipe", "pipe", "pipe"]
        });
        const stdout = [];
        const stderr = [];
        const stdoutLimit = createOutputLimiter(stdout, maxOutputBytes);
        const stderrLimit = createOutputLimiter(stderr, maxOutputBytes);
        let settled = false;
        let abortedReason;
        const abortIfMatched = (text) => {
            if (abortedReason || !options.abortOnOutputPatterns)
                return;
            const matched = options.abortOnOutputPatterns.find((pattern) => pattern.test(text));
            if (!matched)
                return;
            abortedReason = `aborted after output matched ${matched}`;
            child.kill("SIGTERM");
        };
        const timeout = setTimeout(() => {
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 1500).unref();
        }, options.timeoutMs);
        timeout.unref();
        child.stdout.on("data", (chunk) => {
            const captured = stdoutLimit.push(chunk);
            if (captured.length > 0)
                options.onStdoutChunk?.(captured.toString("utf8"));
            abortIfMatched(chunk.toString("utf8"));
        });
        child.stderr.on("data", (chunk) => {
            const captured = stderrLimit.push(chunk);
            if (captured.length > 0)
                options.onStderrChunk?.(captured.toString("utf8"));
            abortIfMatched(chunk.toString("utf8"));
        });
        child.on("error", (error) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.stdin.on("error", (error) => {
            if (isBenignStdinClose(error))
                return;
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        });
        child.on("close", (exitCode, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            resolve({
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
                exitCode,
                signal,
                elapsedMs: Date.now() - started,
                maxOutputBytes,
                stdoutTruncated: stdoutLimit.truncated(),
                stderrTruncated: stderrLimit.truncated(),
                abortedReason
            });
        });
        if (options.stdin)
            child.stdin.end(options.stdin);
        else
            child.stdin.end();
    });
}
function isBenignStdinClose(error) {
    return error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED";
}
function commandEnv(options) {
    const output = options.inheritEnv === false ? {} : { ...process.env };
    for (const [key, value] of Object.entries(options.env ?? {})) {
        if (value === undefined)
            delete output[key];
        else
            output[key] = value;
    }
    return output;
}
function createOutputLimiter(buffers, maxBytes) {
    let capturedBytes = 0;
    let truncated = false;
    return {
        push(chunk) {
            if (capturedBytes >= maxBytes) {
                truncated = true;
                return Buffer.alloc(0);
            }
            const remaining = maxBytes - capturedBytes;
            if (chunk.length <= remaining) {
                buffers.push(chunk);
                capturedBytes += chunk.length;
                return chunk;
            }
            const captured = chunk.subarray(0, remaining);
            buffers.push(captured);
            capturedBytes = maxBytes;
            truncated = true;
            return captured;
        },
        truncated: () => truncated
    };
}
export function commandExists(command, options = {}) {
    if (command.includes("/")) {
        const root = resolve(options.cwd ?? process.cwd());
        const commandPath = isAbsolute(command) ? resolve(command) : resolve(root, command);
        if (!isAbsolute(command) && !isInsideOrSame(commandPath, root))
            return false;
        const workspaceRoot = resolve(process.cwd());
        const nofollowRoot = isInsideOrSame(commandPath, workspaceRoot)
            ? workspaceRoot
            : isInsideOrSame(commandPath, root)
                ? root
                : undefined;
        return executableCommandCandidateExists(commandPath, nofollowRoot);
    }
    const pathValue = options.pathValue ?? process.env.PATH ?? "";
    const root = resolve(options.cwd ?? process.cwd());
    const workspaceRoot = resolve(process.cwd());
    for (const dir of pathValue.split(delimiter)) {
        if (!dir)
            continue;
        const lookupDir = isAbsolute(dir) ? resolve(dir) : resolve(root, dir);
        const commandPath = join(lookupDir, command);
        try {
            accessSync(commandPath, constants.X_OK);
        }
        catch {
            // Keep scanning PATH entries.
            continue;
        }
        const nofollowRoot = isInsideOrSame(commandPath, workspaceRoot)
            ? workspaceRoot
            : isInsideOrSame(commandPath, root)
                ? root
                : undefined;
        return executableCommandCandidateExists(commandPath, nofollowRoot);
    }
    return false;
}
function executableCommandCandidateExists(path, nofollowRoot) {
    if (nofollowRoot && !hasNoSymlinkComponentsUnderRoot(path, nofollowRoot))
        return false;
    try {
        accessSync(path, constants.X_OK);
        const info = lstatSync(path);
        if (info.isSymbolicLink())
            return !nofollowRoot;
        return info.isFile();
    }
    catch {
        return false;
    }
}
function hasNoSymlinkComponentsUnderRoot(path, root) {
    const absolutePath = resolve(path);
    const absoluteRoot = resolve(root);
    const rel = relative(absoluteRoot, absolutePath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
        return true;
    let current = absoluteRoot;
    for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
        current = join(current, part);
        try {
            if (lstatSync(current).isSymbolicLink())
                return false;
        }
        catch (error) {
            if (isNodeError(error) && error.code === "ENOENT")
                return true;
            return false;
        }
    }
    return true;
}
function isInsideOrSame(child, parent) {
    const rel = relative(parent, child);
    return !rel.startsWith("..") && !isAbsolute(rel);
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
