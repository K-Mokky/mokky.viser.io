// ================================================================
// Local CLI model provider
// ================================================================
// The key design rule: model providers are local account-backed CLIs.
// We never call GPT/Claude/Gemini model HTTP APIs here.

import { lstat } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { delimiter } from "node:path";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { CliProviderConfig, ModelProvider, ProviderRequest, ProviderResponse } from "../core/types.ts";
import { isModelApiKeyEnvKey } from "../core/model-api-policy.ts";
import { runCommand } from "../utils/exec.ts";
import { assertNoSymlinkComponentsUnderRoot } from "../utils/files.ts";

const INTERACTIVE_AUTH_PATTERNS = [/opening authentication page/i, /do you want to continue\?/i, /press enter/i, /browser login/i, /authenticate/i];

export class CliModelProvider implements ModelProvider {
  id: string;
  label: string;
  private config: CliProviderConfig;

  constructor(config: CliProviderConfig) {
    this.id = config.id;
    this.label = config.label ?? config.id;
    this.config = config;
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const prepared = preparePrompt(this.config, request.prompt);

    try {
      const cwd = this.config.cwd ? await resolveSafeProviderCwd(this.config.cwd) : undefined;
      const env = providerRuntimeEnv(this.config.env);
      const command = await resolveSafeProviderCommand(this.config.command, cwd, env.PATH);
      const result = await runCommand({
        command,
        args: prepared.args,
        stdin: prepared.stdin,
        cwd,
        env,
        inheritEnv: false,
        timeoutMs: this.config.timeoutMs,
        maxOutputBytes: this.config.maxOutputBytes,
        abortOnOutputPatterns: INTERACTIVE_AUTH_PATTERNS
      });

      if (result.abortedReason) {
        const detail = withTruncationNote(result, redactProviderSecrets(this.config, result.stdout.trim() || result.stderr.trim() || result.abortedReason));
        throw new Error(`${this.label} required interactive input.\n${detail}`);
      }

      if (result.signal) {
        throw new Error(`${this.label} was terminated by ${result.signal}.`);
      }

      if (result.exitCode !== 0) {
        const detail = withTruncationNote(result, redactProviderSecrets(this.config, result.stderr.trim() || result.stdout.trim() || "No error output was produced."));
        throw new Error(`${this.label} exited with code ${result.exitCode}.\n${detail}`);
      }

      return {
        providerId: this.id,
        text: withTruncationNote(result, redactProviderSecrets(this.config, (result.stdout.trim() || result.stderr.trim()).trim())).trim(),
        elapsedMs: result.elapsedMs
      };
    } catch (error) {
      const hint = this.config.loginHint ? `\nLogin hint: ${this.config.loginHint}` : "";
      const message = redactProviderSecrets(this.config, error instanceof Error ? error.message : String(error));
      throw new Error(`Provider '${this.id}' failed: ${message}${hint}`);
    }
  }
}

export function preparePrompt(config: CliProviderConfig, prompt: string): { args: string[]; stdin?: string } {
  if (config.promptMode === "stdin") {
    return { args: replacePromptPlaceholders(config.args, prompt), stdin: prompt };
  }

  if (config.promptMode === "template") {
    return { args: replacePromptPlaceholders(config.args, prompt) };
  }

  return { args: [...config.args, prompt] };
}

function replacePromptPlaceholders(args: string[], prompt: string): string[] {
  return args.map((arg) => arg.replaceAll("{prompt}", prompt));
}

function redactProviderSecrets(config: CliProviderConfig, value: string): string {
  let output = value;
  for (const [key, secret] of Object.entries({ ...process.env, ...config.env })) {
    if (!secret || secret.length < 6 || !looksSecretLike(key)) continue;
    output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function withTruncationNote(
  result: { stdoutTruncated: boolean; stderrTruncated: boolean; maxOutputBytes: number },
  value: string
): string {
  const notes = [];
  if (result.stdoutTruncated) notes.push(`stdout truncated at ${result.maxOutputBytes} bytes`);
  if (result.stderrTruncated) notes.push(`stderr truncated at ${result.maxOutputBytes} bytes`);
  return notes.length ? `${value}\n[${notes.join("; ")}]` : value;
}

function looksSecretLike(key: string): boolean {
  return /token|secret|key|password|credential/i.test(key);
}

function providerRuntimeEnv(explicitEnv: Record<string, string> = {}): Record<string, string> {
  const modelApiKeyNames = Object.keys(explicitEnv).filter(isModelApiKeyEnvKey);
  if (modelApiKeyNames.length > 0) {
    throw new Error(`provider.env contains model API key variables (${modelApiKeyNames.join(", ")}). Viser uses logged-in local provider CLIs instead of model HTTP APIs.`);
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || isProviderHiddenEnvKey(key)) continue;
    env[key] = value;
  }
  return { ...env, ...explicitEnv };
}

function isProviderHiddenEnvKey(key: string): boolean {
  return key.startsWith("VISER_") || looksSecretLike(key);
}

async function resolveSafeProviderCwd(path: string): Promise<string> {
  const absolutePath = resolve(path);
  const cwdRoot = resolve(process.cwd());

  if (isInsideOrSame(absolutePath, cwdRoot)) {
    await assertNoSymlinkComponentsUnderRoot(absolutePath, cwdRoot);
  } else {
    const outsideInfo = await lstat(absolutePath);
    if (outsideInfo.isSymbolicLink()) throw new Error(`Provider cwd is a symlink: ${absolutePath}`);
  }

  const info = await lstat(absolutePath);
  if (info.isSymbolicLink()) throw new Error(`Provider cwd is a symlink: ${absolutePath}`);
  if (!info.isDirectory()) throw new Error(`Provider cwd is not a directory: ${absolutePath}`);
  return absolutePath;
}

async function resolveSafeProviderCommand(command: string, providerCwd?: string, pathValue = process.env.PATH ?? ""): Promise<string> {
  if (!command.includes("/")) return await resolveProviderPathCommand(command, providerCwd, pathValue);

  const commandRoot = resolve(providerCwd ?? process.cwd());
  const commandPath = isAbsolute(command) ? resolve(command) : resolve(commandRoot, command);

  if (!isAbsolute(command) && !isInsideOrSame(commandPath, commandRoot)) {
    throw new Error(`Provider command escapes its working directory: ${commandPath}`);
  }

  const workspaceRoot = resolve(process.cwd());
  const nofollowRoot = isInsideOrSame(commandPath, workspaceRoot)
    ? workspaceRoot
    : providerCwd && isInsideOrSame(commandPath, commandRoot)
      ? commandRoot
      : undefined;

  if (!nofollowRoot) return command;

  await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
  const info = await lstat(commandPath);
  if (info.isSymbolicLink()) throw new Error(`Provider command is a symlink: ${commandPath}`);
  if (!info.isFile()) throw new Error(`Provider command is not a regular file: ${commandPath}`);
  if ((info.mode & 0o111) === 0) throw new Error(`Provider command is not executable: ${commandPath}`);
  return commandPath;
}

async function resolveProviderPathCommand(command: string, providerCwd?: string, pathValue = ""): Promise<string> {
  const commandRoot = resolve(providerCwd ?? process.cwd());
  for (const entry of pathValue.split(delimiter)) {
    if (!entry) continue;
    const dir = isAbsolute(entry) ? resolve(entry) : resolve(commandRoot, entry);
    const candidate = join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
    } catch {
      continue;
    }
    await assertSafeProviderPathCandidate(candidate, commandRoot);
    return candidate;
  }
  throw new Error(`Provider command was not found on PATH: ${command}`);
}

async function assertSafeProviderPathCandidate(candidate: string, commandRoot: string): Promise<void> {
  const workspaceRoot = resolve(process.cwd());
  const nofollowRoot = isInsideOrSame(candidate, workspaceRoot)
    ? workspaceRoot
    : isInsideOrSame(candidate, commandRoot)
      ? commandRoot
      : undefined;
  if (!nofollowRoot) return;

  await assertNoSymlinkComponentsUnderRoot(candidate, nofollowRoot);
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) throw new Error(`Provider command is a symlink: ${candidate}`);
  if (!info.isFile()) throw new Error(`Provider command is not a regular file: ${candidate}`);
}

function isInsideOrSame(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export function createProviders(configs: Record<string, CliProviderConfig>): Record<string, ModelProvider> {
  const providers: Record<string, ModelProvider> = {};
  for (const [id, config] of Object.entries(configs)) {
    providers[id] = new CliModelProvider({ ...config, id: config.id || id });
  }
  return providers;
}
