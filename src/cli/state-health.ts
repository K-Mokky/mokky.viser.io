// ================================================================
// Persistent state health and repair planning
// ================================================================
// Viser keeps state in editable JSON/JSONL files. This checker validates the
// files that can affect runtime startup. Repair is intentionally conservative:
// `--repair` defaults to dry-run; actual rewrite requires `--repair --force`.

import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  assertNoSymlinkComponentsUnderRoot,
  ensurePrivateDir,
  fileExists,
  readPrivateFileIfExists,
  writePrivateFile
} from "../utils/files.ts";
import { normalizeClipboardText, normalizeExternalUrl, normalizeSpeechText, parseBrowserTaskContent, parseCalendarEventContent, parseConnectorMessageContent, parseDesktopNotificationContent, parseMailDraftContent } from "../core/actions.ts";
import { normalizePersonalizationState } from "../core/personalization.ts";
import { nowIso } from "../utils/text.ts";
import type { ViserConfig } from "../core/types.ts";

const SESSION_WARN_BYTES = 5_000_000;
const SESSION_WARN_LINES = 1_000;
const SESSION_REPAIR_KEEP_LINES = 1_000;
const VALID_ACCESS_CONNECTORS = ["telegram", "discord", "slack", "matrix", "signal", "imessage", "whatsapp", "line", "google-chat", "webhook", "home-assistant", "teams", "mattermost", "synology-chat", "rocket-chat", "feishu", "dingtalk", "wecom", "zalo", "irc", "twitch", "ntfy", "mastodon", "nextcloud-talk", "webex", "zulip", "email", "github", "todoist", "notion", "obsidian"];
const VALID_TASK_SOURCES = ["cli", "voice", "web-chat", ...VALID_ACCESS_CONNECTORS, "test"];
const VALID_DELIVERY_KINDS = ["console", ...VALID_ACCESS_CONNECTORS];
const VALID_CONNECTOR_PREFIXES = VALID_ACCESS_CONNECTORS.map((connector) => `${connector}:`);
const VALID_ACCESS_CONNECTOR_LABEL = VALID_ACCESS_CONNECTORS.join(", ");
const VALID_TASK_SOURCE_LABEL = ["cli", "voice", "web-chat", ...VALID_ACCESS_CONNECTORS, "test"].join(", ");
const VALID_DELIVERY_KIND_LABEL = ["console", ...VALID_ACCESS_CONNECTORS].join(", ");

export type StateHealthStatus = "pass" | "warn" | "fail";
type StateFileKind = "json-array" | "json-object" | "scheduler-tasks" | "jobs-state" | "access-state" | "actions-state" | "personalization-state" | "jsonl";

export interface StateHealthItem {
  status: StateHealthStatus;
  area: string;
  path: string;
  message: string;
  next?: string;
  repair?: StateRepairPlan;
}

export interface StateHealthSummary {
  passCount: number;
  warnCount: number;
  failCount: number;
  verdict: "HEALTHY" | "REVIEW" | "BROKEN";
}

export interface StateRepairPlan {
  path: string;
  kind: StateFileKind;
  validJsonlLines?: string[];
  replacementContent?: string;
}

export interface StateRepairResult {
  path: string;
  backupPath: string;
  dryRun: boolean;
}

export interface StateHealthOptions {
  repair?: boolean;
  force?: boolean;
}

export interface StateHealthResult {
  report: string;
  summary: StateHealthSummary;
  items: StateHealthItem[];
  repairs: StateRepairResult[];
}

export async function stateHealth(config: ViserConfig, options: StateHealthOptions = {}): Promise<StateHealthResult> {
  const items = await stateHealthItems(config);
  const repairs = options.repair ? await repairState(config, items, { dryRun: !options.force }) : [];
  const summary = summarizeStateHealth(items);

  return {
    items,
    repairs,
    summary,
    report: formatStateHealthReport(items, summary, repairs, Boolean(options.repair), !options.force)
  };
}

export async function stateHealthReport(config: ViserConfig, options: StateHealthOptions = {}): Promise<string> {
  return (await stateHealth(config, options)).report;
}

export async function stateHealthItems(config: ViserConfig): Promise<StateHealthItem[]> {
  const items: StateHealthItem[] = [];

  if (!await isSafeStorageRoot(config.storage.dir, config.assistant.workdir, items)) return items;

  await checkSessionFiles(config.storage.dir, config.assistant.workdir, items);
  if (await isRegularStateDirectory("memory", config.memory.dir, config.assistant.workdir, items)) {
    await checkJsonlFile("memory", join(config.memory.dir, "entries.jsonl"), config.assistant.workdir, items);
  }
  if (await isRegularStateDirectory("personalization", config.personalization.dir, config.assistant.workdir, items)) {
    await checkJsonFile("personalization", join(config.personalization.dir, "settings.json"), "personalization-state", config.assistant.workdir, items);
  }
  if (await isRegularStateDirectory("scheduler", config.scheduler.dir, config.assistant.workdir, items)) {
    await checkJsonFile("scheduler", join(config.scheduler.dir, "tasks.json"), "scheduler-tasks", config.assistant.workdir, items);
    await checkJsonlFile("scheduler", join(config.scheduler.dir, "runs.jsonl"), config.assistant.workdir, items);
  }
  if (await isRegularStateDirectory("jobs", config.jobs.dir, config.assistant.workdir, items)) {
    await checkJsonFile("jobs", join(config.jobs.dir, "jobs.json"), "jobs-state", config.assistant.workdir, items);
    await checkJsonlFile("jobs", join(config.jobs.dir, "events.jsonl"), config.assistant.workdir, items);
  }
  if (await isRegularStateDirectory("access", config.access.dir, config.assistant.workdir, items)) {
    await checkJsonFile("access", join(config.access.dir, "access.json"), "access-state", config.assistant.workdir, items);
  }
  if (await isRegularStateDirectory("actions", config.actions.dir, config.assistant.workdir, items)) {
    await checkJsonFile("actions", join(config.actions.dir, "actions.json"), "actions-state", config.assistant.workdir, items);
    await checkJsonlFile("actions", join(config.actions.dir, "audit.jsonl"), config.assistant.workdir, items);
  }

  if (items.length === 0) {
    items.push({ status: "pass", area: "state", path: config.storage.dir, message: "no persistent state files yet" });
  }

  return items;
}

export function summarizeStateHealth(items: StateHealthItem[]): StateHealthSummary {
  const failCount = items.filter((item) => item.status === "fail").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  return {
    passCount: items.length - failCount - warnCount,
    warnCount,
    failCount,
    verdict: failCount > 0 ? "BROKEN" : warnCount > 0 ? "REVIEW" : "HEALTHY"
  };
}

async function checkSessionFiles(storageDir: string, workdir: string, items: StateHealthItem[]): Promise<void> {
  const dir = join(storageDir, "sessions");
  if (!await isRegularStateDirectory("sessions", dir, workdir, items)) return;

  const names = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  for (const name of names) await checkJsonlFile("sessions", join(dir, name), workdir, items, { sessionFile: true });
}

async function checkJsonFile(
  area: string,
  path: string,
  kind: Exclude<StateFileKind, "jsonl">,
  workdir: string,
  items: StateHealthItem[]
): Promise<void> {
  if (!fileExists(path)) return;
  if (!await isRegularStateFile(area, path, workdir, items)) return;

  try {
    const raw = await readStateFileIfStillSafe(area, path, workdir, items);
    if (raw === undefined) return;
    const parsed = JSON.parse(raw);
    const shape = validateJsonShape(parsed, kind);
    if (!shape.ok) {
      items.push({
        status: "fail",
        area,
        path,
        message: shape.reason,
        next: "Run `viser state-check --repair` to preview a safe reset, or inspect the file manually.",
        repair: { path, kind }
      });
      return;
    }
    if (kind === "access-state") {
      const cleanup = cleanAccessState(parsed);
      if (cleanup.changed) {
        items.push({
          status: "warn",
          area,
          path,
          message: `valid JSON state; access state contains ${cleanup.reasons.join(" and ")}`,
          next: "Run `viser state-check --repair --force` to remove stale pairing codes and scrub legacy pair-code sources.",
          repair: { path, kind, replacementContent: `${JSON.stringify(cleanup.state, null, 2)}\n` }
        });
        return;
      }
    }
    if (kind === "actions-state") {
      const cleanup = cleanActionsState(parsed);
      if (cleanup.changed) {
        items.push({
          status: "warn",
          area,
          path,
          message: `valid JSON state; actions state contains ${cleanup.redactedCount} decided action content value${cleanup.redactedCount === 1 ? "" : "s"}`,
          next: "Run `viser state-check --repair --force` to redact approved/rejected action content while preserving pending actions.",
          repair: { path, kind, replacementContent: `${JSON.stringify(cleanup.state, null, 2)}\n` }
        });
        return;
      }
    }
    items.push(await stateFileItem(area, path, "valid JSON state", workdir));
  } catch (error) {
    items.push({
      status: "fail",
      area,
      path,
      message: `invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      next: "Run `viser state-check --repair` to preview quarantine/reset, or restore from backup.",
      repair: { path, kind }
    });
  }
}

async function checkJsonlFile(
  area: string,
  path: string,
  workdir: string,
  items: StateHealthItem[],
  options: { sessionFile?: boolean } = {}
): Promise<void> {
  if (!fileExists(path)) return;
  if (!await isRegularStateFile(area, path, workdir, items)) return;

  const raw = await readStateFileIfStillSafe(area, path, workdir, items);
  if (raw === undefined) return;
  const lines = raw.split("\n").filter(Boolean);
  const validLines: string[] = [];
  const invalid: Array<{ line: number; message: string }> = [];

  lines.forEach((line, index) => {
    try {
      JSON.parse(line);
      validLines.push(line);
    } catch (error) {
      invalid.push({ line: index + 1, message: error instanceof Error ? error.message : String(error) });
    }
  });

  if (invalid.length === 0) {
    const sessionWarning = options.sessionFile ? largeSessionWarning(path, raw, validLines) : undefined;
    if (sessionWarning) {
      items.push(sessionWarning);
      return;
    }
    items.push(await stateFileItem(area, path, `valid JSONL state (${validLines.length} line${validLines.length === 1 ? "" : "s"})`, workdir));
    return;
  }

  items.push({
    status: "fail",
    area,
    path,
    message: `${invalid.length} invalid JSONL line(s): ${invalid.slice(0, 3).map((item) => `line ${item.line} ${item.message}`).join("; ")}`,
    next: "Run `viser state-check --repair` to preview rewriting only valid lines, or edit the file manually.",
    repair: { path, kind: "jsonl", validJsonlLines: validLines }
  });
}

function largeSessionWarning(path: string, raw: string, validLines: string[]): StateHealthItem | undefined {
  const bytes = Buffer.byteLength(raw, "utf8");
  const tooManyLines = validLines.length > SESSION_WARN_LINES;
  const tooManyBytes = bytes > SESSION_WARN_BYTES;
  if (!tooManyLines && !tooManyBytes) return undefined;

  const sessionId = basename(path, ".jsonl");
  const repairLines = validLines.length > SESSION_REPAIR_KEEP_LINES
    ? validLines.slice(-SESSION_REPAIR_KEEP_LINES)
    : undefined;

  return {
    status: "warn",
    area: "sessions",
    path,
    message: `large session history (${validLines.length} lines, ${bytes} bytes)`,
    next: repairLines
      ? `Run \`viser state-check --repair --force\` to keep the newest ${SESSION_REPAIR_KEEP_LINES} JSONL messages with a backup, or run \`viser session-compact ${sessionId} ${SESSION_REPAIR_KEEP_LINES}\`.`
      : `Run \`viser session-compact ${sessionId} ${SESSION_REPAIR_KEEP_LINES}\` or inspect the large individual messages manually.`,
    repair: repairLines ? { path, kind: "jsonl", validJsonlLines: repairLines } : undefined
  };
}

async function isRegularStateFile(area: string, path: string, workdir: string, items: StateHealthItem[]): Promise<boolean> {
  if (!await isRegularStateDirectory(area, dirname(path), workdir, items)) return false;

  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      items.push({
        status: "fail",
        area,
        path,
        message: "state file is a symlink",
        next: "Replace it with a regular private state file under `.viser`; repair intentionally does not follow symlinks."
      });
      return false;
    }
    if (!info.isFile()) {
      items.push({
        status: "fail",
        area,
        path,
        message: "expected a regular state file",
        next: "Remove the non-file path or replace it with a valid private JSON/JSONL state file."
      });
      return false;
    }
  } catch {
    return true;
  }
  return true;
}

async function isSafeStorageRoot(storageDir: string, workdir: string, items: StateHealthItem[]): Promise<boolean> {
  try {
    const info = await lstat(storageDir);
    if (info.isSymbolicLink()) {
      items.push({
        status: "fail",
        area: "state",
        path: storageDir,
        message: "storage directory is a symlink",
        next: "Replace it with a regular private `.viser` directory; state-check intentionally does not follow storage directory symlinks."
      });
      return false;
    }
    if (!info.isDirectory()) {
      items.push({
        status: "fail",
        area: "state",
        path: storageDir,
        message: "storage path is not a directory",
        next: "Remove the non-directory path or replace it with a regular private `.viser` directory."
      });
      return false;
    }
    await assertNoSymlinkComponentsUnderRoot(storageDir, workdir);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      try {
        await assertNoSymlinkComponentsUnderRoot(storageDir, workdir);
        return true;
      } catch (componentError) {
        items.push({
          status: "fail",
          area: "state",
          path: storageDir,
          message: `storage path contains a symlink component: ${errorMessage(componentError)}`,
          next: "Fix the `.viser` storage directory permissions or restore it from a known-good backup."
        });
        return false;
      }
    }
    items.push({
      status: "fail",
      area: "state",
      path: storageDir,
      message: isSymlinkError(error)
        ? `storage path contains a symlink component: ${errorMessage(error)}`
        : `could not inspect storage directory: ${errorMessage(error)}`,
      next: "Fix the `.viser` storage directory permissions or restore it from a known-good backup."
    });
    return false;
  }
}

async function isRegularStateDirectory(area: string, path: string, workdir: string, items: StateHealthItem[]): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      pushUniqueStateItem(items, {
        status: "fail",
        area,
        path,
        message: "state directory is a symlink",
        next: "Replace it with a regular private state directory under `.viser`; state-check intentionally does not follow directory symlinks."
      });
      return false;
    }
    if (!info.isDirectory()) {
      pushUniqueStateItem(items, {
        status: "fail",
        area,
        path,
        message: "expected a regular state directory",
        next: "Remove the non-directory path or replace it with a private state directory."
      });
      return false;
    }
    await assertNoSymlinkComponentsUnderRoot(path, workdir);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      try {
        await assertNoSymlinkComponentsUnderRoot(path, workdir);
      } catch (componentError) {
        pushUniqueStateItem(items, {
          status: "fail",
          area,
          path,
          message: `state path contains a symlink component: ${errorMessage(componentError)}`,
          next: "Fix the state directory permissions or restore it from a known-good backup."
        });
      }
      return false;
    }
    pushUniqueStateItem(items, {
      status: "fail",
      area,
      path,
      message: isSymlinkError(error)
        ? `state path contains a symlink component: ${errorMessage(error)}`
        : `could not inspect state directory: ${errorMessage(error)}`,
      next: "Fix the state directory permissions or restore it from a known-good backup."
    });
    return false;
  }
}

function pushUniqueStateItem(items: StateHealthItem[], item: StateHealthItem): void {
  if (items.some((existing) => existing.area === item.area && existing.path === item.path && existing.message === item.message)) return;
  items.push(item);
}

function validateJsonShape(value: unknown, kind: Exclude<StateFileKind, "jsonl">): { ok: true } | { ok: false; reason: string } {
  if (kind === "json-array") return Array.isArray(value) ? { ok: true } : { ok: false, reason: "expected a JSON array" };
  if (kind === "json-object") return isPlainObject(value) ? { ok: true } : { ok: false, reason: "expected a JSON object" };
  if (kind === "scheduler-tasks") return validateArrayItems(value, "scheduled task", validateScheduledTask);
  if (kind === "jobs-state") return validateArrayItems(value, "queued job", validateQueuedJob);
  if (kind === "actions-state") return validateArrayItems(value, "pending action", validatePendingAction);
  if (kind === "personalization-state") return validatePersonalizationState(value);
  return validateAccessState(value);
}

function validateArrayItems(
  value: unknown,
  label: string,
  validate: (value: unknown) => string | undefined
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(value)) return { ok: false, reason: "expected a JSON array" };
  for (const [index, item] of value.entries()) {
    const problem = validate(item);
    if (problem) return { ok: false, reason: `${label} at index ${index}: ${problem}` };
  }
  return { ok: true };
}

function validateScheduledTask(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "expected object";
  const requiredString = firstMissingString(value, ["id", "prompt", "sessionId", "source", "createdAt"]);
  if (requiredString) return `${requiredString} must be a string`;
  if (!VALID_TASK_SOURCES.includes(String(value.source))) return `source must be one of ${VALID_TASK_SOURCE_LABEL}`;
  if (typeof value.enabled !== "boolean") return "enabled must be a boolean";
  if (!Number.isInteger(value.runCount) || Number(value.runCount) < 0) return "runCount must be a non-negative integer";
  if (value.providerId !== undefined && typeof value.providerId !== "string") return "providerId must be a string when present";
  if (value.nextRunAt !== undefined && typeof value.nextRunAt !== "string") return "nextRunAt must be a string when present";
  if (value.lastRunAt !== undefined && typeof value.lastRunAt !== "string") return "lastRunAt must be a string when present";
  if (value.lastError !== undefined && typeof value.lastError !== "string") return "lastError must be a string when present";
  if (value.intervalMs !== undefined && (!Number.isInteger(value.intervalMs) || Number(value.intervalMs) <= 0)) {
    return "intervalMs must be a positive integer when present";
  }
  if (!isPlainObject(value.delivery)) return "delivery must be an object";
  if (!VALID_DELIVERY_KINDS.includes(String(value.delivery.kind))) return `delivery.kind must be one of ${VALID_DELIVERY_KIND_LABEL}`;
  if (value.delivery.targetId !== undefined && typeof value.delivery.targetId !== "string") return "delivery.targetId must be a string when present";
  return undefined;
}

function validateQueuedJob(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "expected object";
  const requiredString = firstMissingString(value, ["id", "prompt", "sessionId", "source", "status", "createdAt"]);
  if (requiredString) return `${requiredString} must be a string`;
  if (!VALID_TASK_SOURCES.includes(String(value.source))) return `source must be one of ${VALID_TASK_SOURCE_LABEL}`;
  if (!["pending", "running", "done", "failed", "cancelled"].includes(String(value.status))) return "status must be pending, running, done, failed, or cancelled";
  if (!Number.isInteger(value.attempts) || Number(value.attempts) < 0) return "attempts must be a non-negative integer";
  if (value.dependsOn !== undefined) {
    if (!Array.isArray(value.dependsOn)) return "dependsOn must be an array when present";
    if (value.dependsOn.length > 20) return "dependsOn must contain at most 20 ids";
    for (const [index, id] of value.dependsOn.entries()) {
      if (typeof id !== "string" || !id.trim()) return `dependsOn[${index}] must be a non-empty string`;
    }
  }
  for (const key of ["providerId", "startedAt", "finishedAt", "nextAttemptAt", "result", "error"]) {
    if (value[key] !== undefined && typeof value[key] !== "string") return `${key} must be a string when present`;
  }
  return undefined;
}

function validatePendingAction(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "expected object";
  const requiredString = firstMissingString(value, ["id", "type", "targetPath", "content", "status", "source", "createdAt"]);
  if (requiredString) return `${requiredString} must be a string`;
  if (!["write-file", "append-file", "open-url", "speak", "calendar-event", "mail-draft", "notify", "clipboard", "connector-message", "browser-task"].includes(String(value.type))) return "type must be write-file, append-file, open-url, speak, calendar-event, mail-draft, notify, clipboard, connector-message, or browser-task";
  const status = String(value.status);
  if (!["pending", "approved", "rejected"].includes(status)) return "status must be pending, approved, or rejected";
  const redactedDecidedContent = status !== "pending" && /^\[\d+ bytes\]$/u.test(String(value.content));
  if (value.type === "open-url") {
    try {
      normalizeExternalUrl(String(value.targetPath));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  if (value.type === "speak") {
    if (value.targetPath !== "local-tts") return "speak targetPath must be local-tts";
    if (!redactedDecidedContent) {
      try {
        normalizeSpeechText(String(value.content));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "calendar-event") {
    if (!String(value.targetPath).endsWith(".ics")) return "calendar-event targetPath must be an .ics file";
    if (!redactedDecidedContent) {
      try {
        parseCalendarEventContent(String(value.content));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "mail-draft") {
    if (!String(value.targetPath).startsWith("mailto:")) return "mail-draft targetPath must be a mailto URL";
    try {
      normalizeExternalUrl(String(value.targetPath));
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (!redactedDecidedContent) {
      try {
        parseMailDraftContent(String(value.content));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "notify") {
    if (value.targetPath !== "local-notification") return "notify targetPath must be local-notification";
    if (!redactedDecidedContent) {
      try {
        parseDesktopNotificationContent(String(value.content));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "clipboard") {
    if (value.targetPath !== "local-clipboard") return "clipboard targetPath must be local-clipboard";
    if (!redactedDecidedContent) {
      try {
        normalizeClipboardText(String(value.content));
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "connector-message") {
    if (!VALID_CONNECTOR_PREFIXES.some((prefix) => String(value.targetPath).startsWith(prefix))) {
      return `connector-message targetPath must start with one of ${VALID_CONNECTOR_PREFIXES.join(", ")}`;
    }
    if (!redactedDecidedContent) {
      try {
        const message = parseConnectorMessageContent(String(value.content));
        if (`${message.connector}:${message.targetId}` !== String(value.targetPath)) return "connector-message targetPath must match content connector and targetId";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.type === "browser-task") {
    if (!/^(?:browser-use-cloud|local-cdp|browserbase-session|firecrawl-interact):/u.test(String(value.targetPath))) return "browser-task targetPath must start with browser-use-cloud:, local-cdp:, browserbase-session:, or firecrawl-interact:";
    if (!redactedDecidedContent) {
      try {
        const task = parseBrowserTaskContent(String(value.content));
        if (`${task.provider}:${task.allowedDomains.join(",")}` !== String(value.targetPath)) return "browser-task targetPath must match content provider and allowed domains";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  if (value.decidedAt !== undefined && typeof value.decidedAt !== "string") return "decidedAt must be a string when present";
  if (value.backupPath !== undefined && typeof value.backupPath !== "string") return "backupPath must be a string when present";
  return undefined;
}

function validatePersonalizationState(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: "expected personalization state object" };
  if (value.version !== undefined && value.version !== 1) return { ok: false, reason: "personalization version must be 1 when present" };
  if (value.updatedAt !== undefined && typeof value.updatedAt !== "string") return { ok: false, reason: "updatedAt must be a string when present" };
  if (!Array.isArray(value.settings)) return { ok: false, reason: "expected personalization state with settings[]" };
  try {
    normalizePersonalizationState(value);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  for (const [index, setting] of value.settings.entries()) {
    if (!isPlainObject(setting)) return { ok: false, reason: `personalization setting at index ${index}: expected object` };
    const missing = firstMissingString(setting, ["key", "value", "source", "createdAt", "updatedAt"]);
    if (missing) return { ok: false, reason: `personalization setting at index ${index}: ${missing} must be a string` };
  }
  return { ok: true };
}

function validateAccessState(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: "expected access state object" };
  if (!Array.isArray(value.peers) || !Array.isArray(value.codes)) {
    return { ok: false, reason: "expected access state with peers[] and codes[]" };
  }

  for (const [index, peer] of value.peers.entries()) {
    const problem = validateAccessPeer(peer);
    if (problem) return { ok: false, reason: `access peer at index ${index}: ${problem}` };
  }
  for (const [index, code] of value.codes.entries()) {
    const problem = validatePairingCode(code);
    if (problem) return { ok: false, reason: `pairing code at index ${index}: ${problem}` };
  }

  return { ok: true };
}

function validateAccessPeer(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "expected object";
  const requiredString = firstMissingString(value, ["connector", "id", "createdAt", "source"]);
  if (requiredString) return `${requiredString} must be a string`;
  if (!VALID_ACCESS_CONNECTORS.includes(String(value.connector))) return `connector must be one of ${VALID_ACCESS_CONNECTOR_LABEL}`;
  if (value.label !== undefined && typeof value.label !== "string") return "label must be a string when present";
  return undefined;
}

function validatePairingCode(value: unknown): string | undefined {
  if (!isPlainObject(value)) return "expected object";
  const requiredString = firstMissingString(value, ["code", "createdAt", "expiresAt"]);
  if (requiredString) return `${requiredString} must be a string`;
  if (value.connector !== undefined && !VALID_ACCESS_CONNECTORS.includes(String(value.connector))) return `connector must be one of ${VALID_ACCESS_CONNECTOR_LABEL} when present`;
  if (value.label !== undefined && typeof value.label !== "string") return "label must be a string when present";
  if (value.usedAt !== undefined && typeof value.usedAt !== "string") return "usedAt must be a string when present";
  return undefined;
}

export async function repairState(
  config: ViserConfig,
  items: StateHealthItem[],
  options: { dryRun: boolean }
): Promise<StateRepairResult[]> {
  const plans = items
    .filter((item) => (item.status === "fail" || item.status === "warn") && item.repair)
    .map((item) => item.repair as StateRepairPlan);
  const repairDir = join(config.storage.dir, "repairs", fileSafeTimestamp(nowIso()));
  const results: StateRepairResult[] = [];

  for (const plan of plans) {
    const backupPath = join(repairDir, `${safeFileName(plan.path)}.bak`);
    results.push({ path: plan.path, backupPath, dryRun: options.dryRun });
    if (options.dryRun) continue;

    await assertNoSymlinkComponentsUnderRoot(repairDir, config.assistant.workdir);
    await ensurePrivateDir(repairDir);
    await writePrivateFile(backupPath, await readRepairSourceFile(plan.path, config.assistant.workdir));
    await assertNoSymlinkComponentsUnderRoot(plan.path, config.assistant.workdir);
    await writePrivateFile(plan.path, repairedContent(plan));
  }

  return results;
}

function repairedContent(plan: StateRepairPlan): string {
  if (plan.replacementContent !== undefined) return plan.replacementContent;
  if (plan.kind === "jsonl") {
    const lines = plan.validJsonlLines ?? [];
    return lines.length ? `${lines.join("\n")}\n` : "";
  }
  if (["json-array", "scheduler-tasks", "jobs-state", "actions-state"].includes(plan.kind)) return "[]\n";
  if (plan.kind === "access-state") return `${JSON.stringify({ peers: [], codes: [] }, null, 2)}\n`;
  if (plan.kind === "personalization-state") return `${JSON.stringify({ version: 1, settings: [] }, null, 2)}\n`;
  return "{}\n";
}

function formatStateHealthReport(
  items: StateHealthItem[],
  summary: StateHealthSummary,
  repairs: StateRepairResult[],
  repairRequested: boolean,
  dryRun: boolean
): string {
  return [
    `Viser state: ${summary.verdict}`,
    `summary: ${summary.passCount} pass, ${summary.warnCount} warn, ${summary.failCount} fail`,
    repairRequested ? `repair mode: ${dryRun ? "dry-run (add --force to write repaired files)" : "applied"}` : undefined,
    "",
    ...items.map(formatItem),
    ...(repairs.length
      ? [
          "",
          "Repair plan:",
          ...repairs.map((repair) => `- ${repair.dryRun ? "would repair" : "repaired"} ${repair.path}\n  backup: ${repair.backupPath}`)
        ]
      : [])
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatItem(item: StateHealthItem): string {
  const prefix = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
  const next = item.next && item.status !== "pass" ? `\n   next: ${item.next}` : "";
  return `${prefix} [${item.area}] ${item.message}\n   path: ${item.path}${next}`;
}

async function stateFileItem(area: string, path: string, message: string, workdir: string): Promise<StateHealthItem> {
  try {
    await assertNoSymlinkComponentsUnderRoot(path, workdir);
    const mode = (await lstat(path)).mode & 0o777;
    if ((mode & 0o077) === 0) return { status: "pass", area, path, message };
    return {
      status: "warn",
      area,
      path,
      message: `${message}; permissions are group/world accessible (${mode.toString(8)})`,
      next: `Run \`chmod 600 ${path}\` because Viser state can contain private conversations, memory, jobs, or access data.`
    };
  } catch (error) {
    return {
      status: isSymlinkError(error) ? "fail" : "warn",
      area,
      path,
      message: isSymlinkError(error)
        ? `${message}; state path contains a symlink component`
        : `${message}; could not inspect file permissions`,
      next: errorMessage(error)
    };
  }
}

async function readStateFileIfStillSafe(area: string, path: string, workdir: string, items: StateHealthItem[]): Promise<string | undefined> {
  try {
    await assertNoSymlinkComponentsUnderRoot(path, workdir);
    return await readPrivateFileIfExists(path, { dirs: [dirname(path)] });
  } catch (error) {
    items.push({
      status: "fail",
      area,
      path,
      message: `could not safely read state file: ${error instanceof Error ? error.message : String(error)}`,
      next: "Replace it with a regular private state file under `.viser`; state-check intentionally does not follow symlinks."
    });
    return undefined;
  }
}

async function readRepairSourceFile(path: string, workdir: string): Promise<string> {
  await assertNoSymlinkComponentsUnderRoot(path, workdir);
  const raw = await readPrivateFileIfExists(path, { dirs: [dirname(path)] });
  if (raw === undefined) throw new Error(`State repair source disappeared before backup: ${path}`);
  return raw;
}

function safeFileName(path: string): string {
  return basename(path).replace(/[^A-Za-z0-9._-]+/g, "_");
}

function fileSafeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function cleanAccessState(value: unknown): {
  changed: boolean;
  state: Record<string, unknown>;
  reasons: string[];
} {
  if (!isPlainObject(value) || !Array.isArray(value.peers) || !Array.isArray(value.codes)) {
    return { changed: false, state: {}, reasons: [] };
  }

  const now = new Date();
  let scrubbedPeerSources = 0;
  const peers = value.peers.map((peer) => {
    if (!isPlainObject(peer) || typeof peer.source !== "string" || !/^pair:[A-F0-9]{8}$/iu.test(peer.source)) return peer;
    scrubbedPeerSources += 1;
    return { ...peer, source: "pair" };
  });

  const codes = value.codes.filter((code) => {
    if (!isPlainObject(code)) return true;
    if (typeof code.usedAt === "string" && code.usedAt.trim()) return false;
    if (typeof code.expiresAt !== "string") return true;
    return new Date(code.expiresAt) > now;
  });

  const removedCodes = value.codes.length - codes.length;
  const reasons = [
    removedCodes ? "expired/used pairing code data" : undefined,
    scrubbedPeerSources ? "legacy pair-code peer sources" : undefined
  ].filter((reason): reason is string => reason !== undefined);

  return {
    changed: reasons.length > 0,
    state: { ...value, peers, codes },
    reasons
  };
}

function cleanActionsState(value: unknown): {
  changed: boolean;
  state: unknown[];
  redactedCount: number;
} {
  if (!Array.isArray(value)) return { changed: false, state: [], redactedCount: 0 };

  let redactedCount = 0;
  const actions = value.map((action) => {
    if (!isPlainObject(action)) return action;
    if (action.status !== "approved" && action.status !== "rejected") return action;
    if (typeof action.content !== "string") return action;
    if (/^\[\d+ bytes\]$/u.test(action.content)) return action;

    redactedCount += 1;
    return { ...action, content: `[${Buffer.byteLength(action.content, "utf8")} bytes]` };
  });

  return {
    changed: redactedCount > 0,
    state: actions,
    redactedCount
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstMissingString(value: Record<string, unknown>, keys: string[]): string | undefined {
  return keys.find((key) => typeof value[key] !== "string" || !String(value[key]).trim());
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isSymlinkError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("symlink");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
