// ================================================================
// Local tools with a permission gate
// ================================================================
// This is the first step toward OpenClaw/Hermes-style real actions. Tools are
// intentionally explicit slash commands for now, not hidden model privileges.

import { constants } from "node:fs";
import { access, lstat, open, readdir, realpath } from "node:fs/promises";
import { basename, delimiter, join, resolve, relative, isAbsolute } from "node:path";
import { runCommand } from "../utils/exec.ts";
import type { ToolResult, ToolsConfig } from "./types.ts";

const GIT_READ_ONLY_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files"]);
const GIT_DIFF_RENDERING_SUBCOMMANDS = new Set(["log", "diff", "show"]);
const MUTATING_FIND_ACTIONS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const UNSAFE_SED_COMMAND_PATTERN = /(^|[;{}\n])\s*(?:(?:\d+|\$|\/(?:\\.|[^/])*\/)(?:,(?:\d+|\$|\/(?:\\.|[^/])*\/))?)?\s*[rRwWeE]/u;
const RAW_SHELL_BLOCKLIST = /[|;&><`]|\$\(/u;

export class ToolRunner {
  private config: ToolsConfig;

  constructor(config: ToolsConfig) {
    this.config = config;
  }

  listTools(): string {
    const shellStatus = this.config.shell.enabled ? "enabled" : "disabled";
    return [
      "Available tools",
      "- list-dir <path>: list files under an allowed read root",
      "- read-file <path>: read a text file under an allowed read root",
      `- shell <command>: run an allowlisted read-only command (${shellStatus})`,
      "",
      `Allowed read roots:\n${this.config.allowedReadRoots.map((root) => `- ${root}`).join("\n")}`
    ].join("\n");
  }

  async run(raw: string): Promise<ToolResult> {
    if (!this.config.enabled) return { ok: false, title: "tools disabled", output: "Local tools are disabled in config." };

    try {
      const [toolId, ...args] = splitCommandLine(raw);
      switch (toolId) {
        case "list-dir":
        case "ls":
          return await this.listDir(args.join(" ") || ".");
        case "read-file":
        case "cat":
          return await this.readFile(args.join(" "));
        case "shell":
          return await this.shell(args.join(" "));
        default:
          return { ok: false, title: "unknown tool", output: `Unknown tool '${toolId}'. Try /tools.` };
      }
    } catch (error) {
      return {
        ok: false,
        title: "tool error",
        output: toolErrorMessage(error)
      };
    }
  }

  private async listDir(pathInput: string): Promise<ToolResult> {
    const target = await this.resolveAllowedPath(pathInput || ".");
    const entries = await readdir(target, { withFileTypes: true });
    const lines = entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);

    return { ok: true, title: `list-dir ${target}`, output: lines.join("\n") || "(empty)" };
  }

  private async readFile(pathInput: string): Promise<ToolResult> {
    if (!pathInput.trim()) return { ok: false, title: "read-file", output: "Path is required." };

    const target = await this.resolveAllowedPath(pathInput);
    const targetInfo = await lstat(target);
    if (targetInfo.isSymbolicLink()) throw new Error(`Tool path contains a symlink: ${target}`);
    const raw = await readToolFileNoFollow(target);
    if (!raw) return { ok: false, title: `read-file ${target}`, output: "Target is not a regular file." };
    const truncated = raw.length > this.config.maxReadBytes;
    const output = raw.subarray(0, this.config.maxReadBytes).toString("utf8");
    return {
      ok: true,
      title: `read-file ${target}`,
      output: truncated ? `${output}\n\n[truncated at ${this.config.maxReadBytes} bytes]` : output
    };
  }

  private async shell(rawCommand: string): Promise<ToolResult> {
    if (!this.config.shell.enabled) return { ok: false, title: "shell disabled", output: "Shell tool is disabled." };
    if (!rawCommand.trim()) return { ok: false, title: "shell", output: "Command is required." };
    if (RAW_SHELL_BLOCKLIST.test(rawCommand)) {
      return { ok: false, title: "shell rejected", output: "Shell metacharacters are not allowed; use a single read-only command." };
    }

    const tokens = splitCommandLine(rawCommand);
    const [command, ...args] = tokens;
    if (!command) return { ok: false, title: "shell rejected", output: "Command is required." };
    const safety = isAllowedReadOnlyCommand(command, args, this.config.shell.allowedCommands);
    if (!safety.ok) return { ok: false, title: "shell rejected", output: safety.reason };
    const primaryRoot = await resolveSafeToolRoot(this.config.allowedReadRoots[0]);
    const pathSafety = await validateShellPathArguments(args, this.config.allowedReadRoots);
    if (!pathSafety.ok) return { ok: false, title: "shell rejected", output: pathSafety.reason };
    const env = toolShellRuntimeEnv(command);
    const executable = await resolveSafeShellCommand(command, primaryRoot.lexical, env.PATH);
    const safeArgs = hardenedShellArgs(command, args);

    const result = await runCommand({
      command: executable,
      args: safeArgs,
      timeoutMs: this.config.shell.timeoutMs,
      maxOutputBytes: this.config.maxReadBytes,
      cwd: primaryRoot.lexical,
      env,
      inheritEnv: false
    });

    const output = [
      result.stdout.trim(),
      result.stderr.trim(),
      outputTruncationNote(result)
    ].filter(Boolean).join("\n");
    return {
      ok: result.exitCode === 0 && !result.signal,
      title: `shell ${command}`,
      output: output || `(exit=${result.exitCode}, signal=${result.signal ?? "none"})`
    };
  }

  private async resolveAllowedPath(pathInput: string): Promise<string> {
    const candidate = isAbsolute(pathInput) ? resolve(pathInput) : resolve(this.config.allowedReadRoots[0], pathInput);

    for (const root of this.config.allowedReadRoots) {
      const resolvedRoot = resolve(root);
      if (isInside(candidate, resolvedRoot)) {
        await assertToolRootIsSafe(resolvedRoot);
        await assertNoToolPathSymlinkComponents(candidate, resolvedRoot);
        return candidate;
      }
    }

    throw new Error(`Path '${pathInput}' is outside allowed read roots.`);
  }
}

export async function readToolFileNoFollow(path: string): Promise<Buffer | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) return undefined;
    return await handle.readFile();
  } catch (error) {
    if (isNodeError(error) && ["ENOENT", "ELOOP", "EMLINK"].includes(error.code ?? "")) return undefined;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function outputTruncationNote(result: { stdoutTruncated: boolean; stderrTruncated: boolean; maxOutputBytes: number }): string {
  const notes = [];
  if (result.stdoutTruncated) notes.push(`stdout truncated at ${result.maxOutputBytes} bytes`);
  if (result.stderrTruncated) notes.push(`stderr truncated at ${result.maxOutputBytes} bytes`);
  return notes.length ? `[${notes.join("; ")}]` : "";
}

export function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/u.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function isAllowedReadOnlyCommand(
  command: string | undefined,
  args: string[],
  allowedCommands: string[]
): { ok: true } | { ok: false; reason: string } {
  if (!command) return { ok: false, reason: "Command is required." };
  if (!allowedCommands.includes(command)) return { ok: false, reason: `Command '${command}' is not allowlisted.` };

  if (command === "git") {
    if (args.some((arg) => ["-C", "-c", "--config-env", "--git-dir", "--work-tree", "--output"].includes(arg) || arg.startsWith("--config-env=") || arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--output="))) {
      return { ok: false, reason: "Git directory/worktree redirection is not allowed." };
    }
    if (args.some(isUnsafeGitRenderingOption)) {
      return { ok: false, reason: "Git external diff/textconv/filter options are not allowed." };
    }
    const subcommand = gitSubcommand(args)?.value;
    if (!subcommand || !GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
      return { ok: false, reason: `Only read-only git subcommands are allowed: ${[...GIT_READ_ONLY_SUBCOMMANDS].join(", ")}` };
    }
  }

  if (command === "find" && args.some((arg) => MUTATING_FIND_ACTIONS.has(arg))) {
    return { ok: false, reason: "Mutating find actions are not allowed." };
  }

  if (command === "find" && args.some((arg) => ["-H", "-L", "-follow"].includes(arg))) {
    return { ok: false, reason: "Symlink-following find options are not allowed." };
  }

  if (command === "grep" && (hasShortOption(args, "R") || args.includes("--dereference-recursive"))) {
    return { ok: false, reason: "Symlink-following recursive grep options are not allowed." };
  }

  if (command === "rg" && (hasShortOption(args, "L") || args.includes("--follow"))) {
    return { ok: false, reason: "Symlink-following ripgrep options are not allowed." };
  }

  if (command === "rg" && args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) {
    return { ok: false, reason: "Ripgrep preprocessor commands are not allowed." };
  }

  if (command === "ls" && (hasShortOption(args, "L") || args.includes("--dereference"))) {
    return { ok: false, reason: "Symlink-dereferencing ls options are not allowed." };
  }

  if (command === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
    return { ok: false, reason: "In-place sed editing is not allowed." };
  }

  if (command === "sed") {
    const sedSafety = validateSedReadOnlyArgs(args);
    if (!sedSafety.ok) return sedSafety;
  }

  if (args.some((arg) => ["rm", "mv", "cp", "chmod", "chown", "sudo"].includes(basename(arg)))) {
    return { ok: false, reason: "Mutating helper commands are not allowed as arguments." };
  }

  return { ok: true };
}

function isUnsafeGitRenderingOption(arg: string): boolean {
  return arg === "--ext-diff"
    || arg === "--external-diff"
    || arg === "--textconv"
    || arg === "--filters"
    || arg.startsWith("--ext-diff=")
    || arg.startsWith("--external-diff=")
    || arg.startsWith("--textconv=")
    || arg.startsWith("--filters=");
}

function gitSubcommand(args: string[]): { value: string; index: number } | undefined {
  const index = args.findIndex((arg) => !arg.startsWith("-"));
  return index >= 0 ? { value: args[index], index } : undefined;
}

function hardenedShellArgs(command: string | undefined, args: string[]): string[] {
  if (command !== "git") return args;

  const subcommand = gitSubcommand(args);
  if (!subcommand || !GIT_DIFF_RENDERING_SUBCOMMANDS.has(subcommand.value)) return args;

  const output = [...args];
  output.splice(subcommand.index + 1, 0, "--no-ext-diff", "--no-textconv");
  return output;
}

function hardenedShellEnv(command: string | undefined): Record<string, string | undefined> | undefined {
  if (command !== "git") return undefined;
  return {
    GIT_EXTERNAL_DIFF: undefined,
    GIT_PAGER: "cat",
    PAGER: "cat"
  };
}

function toolShellRuntimeEnv(command: string | undefined): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isToolHiddenEnvKey(key)) continue;
    env[key] = value;
  }
  return { ...env, ...hardenedShellEnv(command) };
}

function isToolHiddenEnvKey(key: string): boolean {
  return key.startsWith("VISER_") || /token|secret|key|password|credential/i.test(key);
}

async function resolveSafeShellCommand(command: string, shellRoot: string, pathValue = process.env.PATH ?? ""): Promise<string> {
  if (command.includes("/")) {
    const commandPath = isAbsolute(command) ? resolve(command) : resolve(shellRoot, command);
    if (!isAbsolute(command) && !isInside(commandPath, shellRoot)) {
      throw new Error(`Shell command escapes the tool root: ${commandPath}`);
    }
    await assertSafeShellCommandCandidate(commandPath, shellRoot);
    return commandPath;
  }

  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const dir = isAbsolute(entry) ? resolve(entry) : resolve(shellRoot, entry);
    const candidate = join(dir, command);
    try {
      await access(candidate, constants.X_OK);
    } catch {
      continue;
    }
    await assertSafeShellCommandCandidate(candidate, shellRoot);
    return candidate;
  }

  throw new Error(`Shell command was not found on PATH: ${command}`);
}

async function assertSafeShellCommandCandidate(commandPath: string, shellRoot: string): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const nofollowRoot = isInside(commandPath, workspaceRoot)
    ? workspaceRoot
    : isInside(commandPath, shellRoot)
      ? shellRoot
      : undefined;
  if (!nofollowRoot) return;

  await assertNoToolPathSymlinkComponents(commandPath, nofollowRoot);
  const info = await lstat(commandPath);
  if (info.isSymbolicLink()) throw new Error(`Shell command is a symlink: ${commandPath}`);
  if (!info.isFile()) throw new Error(`Shell command is not a regular file: ${commandPath}`);
}

function validateSedReadOnlyArgs(args: string[]): { ok: true } | { ok: false; reason: string } {
  const scripts: string[] = [];
  let expectsExpression = false;
  let sawExpressionOption = false;
  let consumedMainScript = false;

  for (const arg of args) {
    if (expectsExpression) {
      scripts.push(arg);
      expectsExpression = false;
      sawExpressionOption = true;
      continue;
    }

    if (arg === "-e" || arg === "--expression") {
      expectsExpression = true;
      continue;
    }

    if (arg.startsWith("-e") && arg.length > 2) {
      scripts.push(arg.slice(2));
      sawExpressionOption = true;
      continue;
    }

    if (arg.startsWith("--expression=")) {
      scripts.push(arg.slice("--expression=".length));
      sawExpressionOption = true;
      continue;
    }

    if (arg === "-f" || arg === "--file" || (arg.startsWith("-f") && arg.length > 2) || arg.startsWith("--file=")) {
      return { ok: false, reason: "Sed script files are not allowed in the shell tool." };
    }

    if (arg.startsWith("-")) continue;

    if (!sawExpressionOption && !consumedMainScript) {
      scripts.push(arg);
      consumedMainScript = true;
    }
  }

  if (expectsExpression) return { ok: false, reason: "Sed expression is missing after -e/--expression." };

  for (const script of scripts) {
    if (hasUnsafeSedScript(script)) {
      return { ok: false, reason: "Sed file read/write or execute commands are not allowed." };
    }
  }

  return { ok: true };
}

function hasUnsafeSedScript(script: string): boolean {
  return UNSAFE_SED_COMMAND_PATTERN.test(script) || hasUnsafeSedSubstitutionFlag(script);
}

function hasUnsafeSedSubstitutionFlag(script: string): boolean {
  for (let index = 0; index < script.length - 1; index += 1) {
    if (script[index] !== "s") continue;
    const delimiter = script[index + 1];
    if (!delimiter || /[\sA-Za-z0-9\\]/u.test(delimiter)) continue;

    const firstEnd = findUnescaped(script, delimiter, index + 2);
    if (firstEnd < 0) continue;
    const secondEnd = findUnescaped(script, delimiter, firstEnd + 1);
    if (secondEnd < 0) continue;

    const flagsEnd = findSedCommandBoundary(script, secondEnd + 1);
    const flags = script.slice(secondEnd + 1, flagsEnd);
    if (/[wWeE]/u.test(flags)) return true;
    index = flagsEnd;
  }

  return false;
}

function findUnescaped(value: string, needle: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === needle) return index;
  }

  return -1;
}

function findSedCommandBoundary(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === ";" || value[index] === "\n" || value[index] === "}") return index;
  }

  return value.length;
}

interface ShellAllowedRoot {
  lexical: string;
  real: string;
}

async function validateShellPathArguments(args: string[], allowedReadRoots: string[]): Promise<{ ok: true } | { ok: false; reason: string }> {
  const safeAllowedRoots = await Promise.all(allowedReadRoots.map((root) => resolveSafeToolRoot(root)));

  for (const arg of args) {
    if (!arg || arg === "--") continue;
    for (const candidate of pathCandidatesFromShellArg(arg)) {
      if (!candidate) continue;
      if (candidate.startsWith("/")) return { ok: false, reason: `Absolute paths are not allowed in shell tool arguments: ${arg}` };
      if (hasPathTraversal(candidate)) {
        return { ok: false, reason: `Path traversal is not allowed in shell tool arguments: ${arg}` };
      }

      const pathSafety = await validateExistingPathCandidate(candidate, safeAllowedRoots);
      if (!pathSafety.ok) {
        return {
          ok: false,
          reason: pathSafety.reason === "symlink"
            ? `Shell path contains a symlink: ${arg}`
            : `Shell path resolves outside allowed read roots: ${arg}`
        };
      }
    }
  }
  return { ok: true };
}

function pathCandidatesFromShellArg(arg: string): string[] {
  if (arg.startsWith("-")) {
    const equalIndex = arg.indexOf("=");
    return equalIndex >= 0 ? [arg.slice(equalIndex + 1)] : [];
  }

  return [arg];
}

function hasPathTraversal(value: string): boolean {
  return value.split(/[\\/]/u).includes("..");
}

async function resolveSafeToolRoot(root: string | undefined): Promise<ShellAllowedRoot> {
  if (!root) throw new Error("Tool allowed read root is not configured.");
  const lexical = resolve(root);
  await assertToolRootIsSafe(lexical);
  return {
    lexical,
    real: await realpath(lexical)
  };
}

async function validateExistingPathCandidate(candidate: string, allowedRoots: ShellAllowedRoot[]): Promise<{ ok: true } | { ok: false; reason: "outside" | "symlink" }> {
  const primaryRoot = allowedRoots[0];
  const resolved = resolve(primaryRoot.lexical, candidate);
  let existing: string;
  try {
    existing = await realpath(resolved);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      const symlinkSafety = await validateNoToolPathSymlinkComponents(resolved, primaryRoot.lexical);
      return symlinkSafety.ok ? { ok: true } : { ok: false, reason: "symlink" };
    }
    throw error;
  }

  if (!allowedRoots.some((root) => isInside(existing, root.real))) return { ok: false, reason: "outside" };

  const symlinkSafety = await validateNoToolPathSymlinkComponents(resolved, primaryRoot.lexical);
  return symlinkSafety.ok ? { ok: true } : { ok: false, reason: "symlink" };
}

async function assertToolRootIsSafe(path: string): Promise<void> {
  const absolutePath = resolve(path);
  const cwd = resolve(process.cwd());

  if (isInside(absolutePath, cwd)) {
    await assertNoToolPathSymlinkComponents(absolutePath, cwd);
    return;
  }

  try {
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) throw new Error(`Tool allowed read root contains a symlink: ${absolutePath}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertNoToolPathSymlinkComponents(path: string, root: string): Promise<void> {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  const relativePath = relative(absoluteRoot, absolutePath);

  let current = absoluteRoot;
  const rootExists = await assertToolPathComponentIsNotSymlink(current);
  if (!rootExists) return;

  for (const part of relativePath.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part);
    const exists = await assertToolPathComponentIsNotSymlink(current);
    if (!exists) return;
  }
}

async function assertToolPathComponentIsNotSymlink(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Tool path contains a symlink: ${path}`);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function validateNoToolPathSymlinkComponents(path: string, root: string): Promise<{ ok: true } | { ok: false }> {
  try {
    await assertNoToolPathSymlinkComponents(path, root);
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && /symlink/i.test(error.message)) return { ok: false };
    throw error;
  }
}

function hasShortOption(args: string[], option: string): boolean {
  return args.some((arg) => arg === `-${option}` || (/^-[^-]/u.test(arg) && arg.slice(1).includes(option)));
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function toolErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = isNodeError(error) ? error.code : undefined;

  if (code === "ENOENT") return `Path or command was not found. ${message}`;
  if (code === "EACCES" || code === "EPERM") return `Permission denied. ${message}`;
  if (code === "ENOTDIR") return `A path component is not a directory. ${message}`;
  if (code === "EISDIR") return `Target is a directory, not a file. ${message}`;
  return message;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
