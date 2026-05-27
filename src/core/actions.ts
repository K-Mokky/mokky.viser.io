// ================================================================
// Approval-gated local actions
// ================================================================
// Read-only tools are instant. Mutating actions are two-step: propose first,
// then approve by id. This makes Discord/Telegram use safer and creates an
// inspectable audit trail.

import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  appendPrivateFile,
  ensurePrivateDir,
  fileExists,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  assertNoSymlinkComponentsUnderRoot,
  readPrivateFileIfExists,
  writeJsonFile,
  writePrivateFile
} from "../utils/files.ts";
import { nowIso } from "../utils/text.ts";
import { commandExists, runCommand } from "../utils/exec.ts";
import type { AccessConnector, ActionConfig, PendingAction } from "./types.ts";

export interface ActionStoreOptions {
  openUrl?: (url: string) => Promise<void>;
  speakText?: (text: string) => Promise<void>;
  openCalendarFile?: (path: string) => Promise<void>;
  notifyDesktop?: (notification: DesktopNotificationProposal) => Promise<void>;
  copyToClipboard?: (text: string) => Promise<void>;
  sendConnectorMessage?: (message: ConnectorMessageProposal) => Promise<void>;
}

export interface CalendarEventProposal {
  start: string;
  end: string;
  durationMinutes: number;
  title: string;
}

export interface MailDraftProposal {
  to: string;
  subject: string;
  body: string;
}

export interface DesktopNotificationProposal {
  title: string;
  body: string;
}

export interface ConnectorMessageProposal {
  connector: AccessConnector;
  targetId: string;
  text: string;
}

export class ActionStore {
  private config: ActionConfig;
  private openUrl: (url: string) => Promise<void>;
  private speakText: (text: string) => Promise<void>;
  private openCalendarFile: (path: string) => Promise<void>;
  private notifyDesktop: (notification: DesktopNotificationProposal) => Promise<void>;
  private copyToClipboard: (text: string) => Promise<void>;
  private sendConnectorMessage: (message: ConnectorMessageProposal) => Promise<void>;

  constructor(config: ActionConfig, options: ActionStoreOptions = {}) {
    this.config = config;
    this.openUrl = options.openUrl ?? openUrlWithSystem;
    this.speakText = options.speakText ?? speakTextWithSystem;
    this.openCalendarFile = options.openCalendarFile ?? openCalendarFileWithSystem;
    this.notifyDesktop = options.notifyDesktop ?? notifyDesktopWithSystem;
    this.copyToClipboard = options.copyToClipboard ?? copyTextToClipboardWithSystem;
    this.sendConnectorMessage = options.sendConnectorMessage ?? missingConnectorMessageSender;
  }

  async propose(raw: string, source: string): Promise<PendingAction> {
    if (!this.config.enabled) throw new Error("Actions are disabled in config.");
    const proposal = parseActionProposal(raw);
    const contentBytes = Buffer.byteLength(proposal.content, "utf8");
    if (contentBytes > this.config.maxWriteBytes) {
      throw new Error(`Action content is too large (${contentBytes} > ${this.config.maxWriteBytes} bytes).`);
    }

    const id = randomUUID().slice(0, 12);
    const targetPath = proposal.type === "open-url"
      ? normalizeExternalUrl(proposal.path)
      : proposal.type === "speak"
        ? proposal.path
        : proposal.type === "calendar-event"
          ? join(this.config.dir, "calendar", `${id}.ics`)
          : proposal.type === "mail-draft"
            ? mailDraftToUrl(parseMailDraftContent(proposal.content))
            : proposal.type === "notify"
              ? proposal.path
              : proposal.type === "clipboard"
                ? proposal.path
                : proposal.type === "connector-message"
                  ? connectorMessageTarget(parseConnectorMessageContent(proposal.content))
                  : await this.resolveAllowedWritePath(proposal.path, { allowMissing: true });
    if (isFileActionType(proposal.type)) await assertNoSymlinkWritePath(targetPath, this.config.allowedWriteRoots);
    const action: PendingAction = {
      id,
      type: proposal.type,
      targetPath,
      content: proposal.content,
      status: "pending",
      source,
      createdAt: nowIso()
    };

    const actions = await this.listAll();
    actions.push(action);
    await this.writeAll(actions);
    await this.appendAudit({ event: "proposed", action: redactedAction(action) });
    return action;
  }

  async list(status?: PendingAction["status"]): Promise<PendingAction[]> {
    const actions = await this.listAll();
    return status ? actions.filter((action) => action.status === status) : actions;
  }

  async reject(id: string): Promise<boolean> {
    const actions = await this.listAll();
    const action = actions.find((item) => item.id === id);
    if (!action || action.status !== "pending") return false;
    action.status = "rejected";
    action.decidedAt = nowIso();
    action.content = redactedContent(action.content);
    await this.writeAll(actions);
    await this.appendAudit({ event: "rejected", action: redactedAction(action) });
    return true;
  }

  async removeDecided(id: string): Promise<boolean> {
    const actions = await this.listAll();
    const index = actions.findIndex((item) => item.id === id);
    const action = index >= 0 ? actions[index] : undefined;
    if (!action || action.status === "pending") return false;

    actions.splice(index, 1);
    await this.writeAll(actions);
    await this.appendAudit({ event: "removed", action: redactedAction(action) });
    return true;
  }

  async approve(id: string): Promise<PendingAction | undefined> {
    const actions = await this.listAll();
    const action = actions.find((item) => item.id === id);
    if (!action || action.status !== "pending") return undefined;

    await this.execute(action);
    action.status = "approved";
    action.decidedAt = nowIso();
    action.content = redactedContent(action.content);
    await this.writeAll(actions);
    await this.appendAudit({ event: "approved", action: redactedAction(action) });
    return action;
  }

  async format(status: PendingAction["status"] = "pending"): Promise<string> {
    const actions = await this.list(status);
    if (actions.length === 0) return `No ${status} actions.`;

    return actions
      .map((action) => {
        const preview = action.content.replace(/\s+/g, " ").slice(0, 160);
        return [
          `- [${action.id}] ${action.type} ${action.status}`,
          `  target: ${action.targetPath}`,
          `  source: ${action.source}`,
          `  created: ${action.createdAt}`,
          `  preview: ${preview}${action.content.length > 160 ? "…" : ""}`
        ].join("\n");
      })
      .join("\n");
  }

  private async execute(action: PendingAction): Promise<void> {
    if (action.type === "open-url") {
      await this.openUrl(normalizeExternalUrl(action.targetPath));
      return;
    }

    if (action.type === "speak") {
      await this.speakText(normalizeSpeechText(action.content));
      return;
    }

    if (action.type === "calendar-event") {
      await this.writeCalendarEvent(action);
      await this.openCalendarFile(action.targetPath);
      return;
    }

    if (action.type === "mail-draft") {
      await this.openUrl(mailDraftToUrl(parseMailDraftContent(action.content)));
      return;
    }

    if (action.type === "notify") {
      await this.notifyDesktop(parseDesktopNotificationContent(action.content));
      return;
    }

    if (action.type === "connector-message") {
      const message = parseConnectorMessageContent(action.content);
      if (connectorMessageTarget(message) !== action.targetPath) {
        throw new Error("Connector message target does not match persisted content.");
      }
      await this.sendConnectorMessage(message);
      return;
    }

    if (action.type === "clipboard") {
      if (action.targetPath !== "local-clipboard") throw new Error("Clipboard target must be local-clipboard.");
      await this.copyToClipboard(normalizeClipboardText(action.content));
      return;
    }

    await this.resolveAllowedWritePath(action.targetPath, { allowMissing: true });
    await ensureActionTargetDirectory(dirname(action.targetPath), this.config.allowedWriteRoots);
    await this.resolveAllowedWritePath(action.targetPath, { allowMissing: true });
    await assertNoSymlinkWritePath(action.targetPath, this.config.allowedWriteRoots);

    if (this.config.createBackups && fileExists(action.targetPath)) {
      const backupDir = join(this.config.dir, "backups", action.id);
      await ensurePrivateDir(backupDir);
      action.backupPath = join(backupDir, `${basename(action.targetPath)}.bak`);
      await copyActionBackupNoFollow(action.targetPath, action.backupPath);
    }

    await writeActionFileNoFollow(action.targetPath, action.content, action.type);
  }

  private async writeCalendarEvent(action: PendingAction): Promise<void> {
    const event = parseCalendarEventContent(action.content);
    const calendarDir = join(this.config.dir, "calendar");
    await ensurePrivateDir(calendarDir);
    if (!isInsideOrSame(resolve(action.targetPath), resolve(calendarDir)) || !action.targetPath.endsWith(".ics")) {
      throw new Error("Calendar event target must be a .ics file under the private action calendar directory.");
    }
    await assertNoSymlinkWritePath(action.targetPath, [calendarDir]);
    await writePrivateFile(action.targetPath, calendarEventToIcs(event, action.id));
  }

  private async resolveAllowedWritePath(pathInput: string, options: { allowMissing: boolean }): Promise<string> {
    if (!pathInput.trim()) throw new Error("Action target path is required.");
    if (pathInput === ".." || pathInput.startsWith("../") || pathInput.includes("/../")) {
      throw new Error(`Path traversal is not allowed: ${pathInput}`);
    }

    const root = this.config.allowedWriteRoots[0];
    const candidate = isAbsolute(pathInput) ? resolve(pathInput) : resolve(root, pathInput);
    const lexicalRoots = this.config.allowedWriteRoots.map((allowedRoot) => resolve(allowedRoot));
    const matchingLexicalRoots = lexicalRoots.filter((allowedRoot) => isInsideOrSame(candidate, allowedRoot));
    if (matchingLexicalRoots.length === 0) {
      throw new Error(`Path '${pathInput}' is outside allowed write roots.`);
    }

    for (const allowedRoot of matchingLexicalRoots) await assertSafeActionWriteRoot(allowedRoot);
    const existingAnchor = await realpath(await nearestExistingParent(fileExists(candidate) || !options.allowMissing ? candidate : dirname(candidate)));

    for (const allowedRoot of matchingLexicalRoots) {
      const existingRoot = await realpath(allowedRoot);
      const rel = relative(existingRoot, existingAnchor);
      if (!rel.startsWith("..") && !isAbsolute(rel)) return candidate;
    }

    throw new Error(`Path '${pathInput}' is outside allowed write roots.`);
  }

  private async listAll(): Promise<PendingAction[]> {
    const path = this.actionsPath();
    const raw = await readPrivateFileIfExists(path, { dirs: [this.config.dir] });
    if (raw === undefined) return [];
    return JSON.parse(raw) as PendingAction[];
  }

  private async writeAll(actions: PendingAction[]): Promise<void> {
    await writeJsonFile(this.actionsPath(), actions);
  }

  private async appendAudit(entry: Record<string, unknown>): Promise<void> {
    await ensurePrivateDir(this.config.dir);
    await appendPrivateFile(join(this.config.dir, "audit.jsonl"), `${JSON.stringify({ at: nowIso(), ...entry })}\n`);
  }

  private actionsPath(): string {
    return join(this.config.dir, "actions.json");
  }
}

async function assertSafeActionWriteRoot(root: string): Promise<void> {
  const absoluteRoot = resolve(root);
  const cwdRoot = resolve(process.cwd());

  if (isInsideOrSame(absoluteRoot, cwdRoot)) {
    await assertNoSymlinkComponentsUnderRoot(absoluteRoot, cwdRoot);
    return;
  }

  try {
    const info = await lstat(absoluteRoot);
    if (info.isSymbolicLink()) throw new Error(`Action write root is a symlink: ${absoluteRoot}`);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
}

export function parseActionProposal(raw: string): { type: PendingAction["type"]; path: string; content: string } {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(raw.trim());
  const type = match?.[1] ?? "";
  const rest = match?.[2] ?? "";
  const parts = rest.split(/\s+/u).filter(Boolean);
  if (type === "speak") {
    return { type, path: "local-tts", content: normalizeSpeechText(rest) };
  }
  if (type === "calendar-event") {
    const [start, durationMinutes, ...titleParts] = parts;
    return {
      type,
      path: "local-calendar",
      content: JSON.stringify(normalizeCalendarEventProposal(start, durationMinutes, titleParts.join(" ")))
    };
  }
  if (type === "mail-draft") {
    const draft = parseMailDraftInput(rest);
    return { type, path: mailDraftToUrl(draft), content: JSON.stringify(draft) };
  }
  if (type === "notify") {
    return { type, path: "local-notification", content: JSON.stringify(parseDesktopNotificationInput(rest)) };
  }
  if (type === "clipboard" || type === "copy") {
    return { type: "clipboard", path: "local-clipboard", content: normalizeClipboardText(rest) };
  }

  const [path, ...contentParts] = parts;
  if (type === "connector-message" || type === "send-message" || type === "message") {
    const message = parseConnectorMessageInput(rest);
    return { type: "connector-message", path: connectorMessageTarget(message), content: JSON.stringify(message) };
  }

  if (type !== "write-file" && type !== "append-file" && type !== "open-url") {
    throw new Error("Usage: /propose write-file <path> <content> OR /propose append-file <path> <content> OR /propose open-url <https-url|mailto-url> [note] OR /propose speak <text> OR /propose calendar-event <ISO-start> <duration-minutes> <title> OR /propose mail-draft <to> | <subject> | <body> OR /propose notify <title> | <body> OR /propose clipboard <text> OR /propose message telegram:<chat-id>|discord:<channel-id> | <text>");
  }
  if (!path) throw new Error("Action target path is required.");
  const content = contentParts.join(" ");
  if (type === "open-url") return { type, path, content: content || "Open external URL after explicit approval." };
  if (!content) throw new Error("Action content is required.");
  return { type, path, content };
}

export function normalizeSpeechText(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) throw new Error("Speech text contains control characters.");
  const value = raw.trim().replace(/\s+/gu, " ");
  if (!value) throw new Error("Speech text is required.");
  if (value.length > 500) throw new Error("Speech text is too long.");
  return value;
}

export function normalizeClipboardText(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) throw new Error("Clipboard text contains control characters.");
  const value = raw.replace(/\r\n?/gu, "\n").trim();
  if (!value) throw new Error("Clipboard text is required.");
  if (value.length > 8_000) throw new Error("Clipboard text is too long.");
  return value;
}

export function normalizeCalendarEventProposal(startRaw: string | undefined, durationRaw: string | undefined, titleRaw: string): CalendarEventProposal {
  if (!startRaw) throw new Error("Calendar event start time is required.");
  if (!durationRaw) throw new Error("Calendar event duration is required.");
  const startMs = Date.parse(startRaw);
  if (!Number.isFinite(startMs)) throw new Error("Calendar event start time must be a valid ISO datetime.");
  const durationMinutes = Number.parseInt(durationRaw, 10);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 24 * 60) {
    throw new Error("Calendar event duration must be an integer from 1 to 1440 minutes.");
  }
  const title = normalizeCalendarText(titleRaw, "Calendar event title", 120);
  const start = new Date(startMs);
  const end = new Date(startMs + durationMinutes * 60_000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    durationMinutes,
    title
  };
}

export function parseCalendarEventContent(content: string): CalendarEventProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Calendar event content must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Calendar event content must be an object.");
  const value = parsed as Partial<CalendarEventProposal>;
  return normalizeCalendarEventProposal(String(value.start ?? ""), String(value.durationMinutes ?? ""), String(value.title ?? ""));
}

export function parseMailDraftContent(content: string): MailDraftProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Mail draft content must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Mail draft content must be an object.");
  const value = parsed as Partial<MailDraftProposal>;
  return normalizeMailDraftProposal(String(value.to ?? ""), String(value.subject ?? ""), String(value.body ?? ""));
}

export function normalizeMailDraftProposal(toRaw: string, subjectRaw: string, bodyRaw: string): MailDraftProposal {
  const to = normalizeMailRecipient(toRaw);
  const subject = normalizeMailText(subjectRaw, "Mail subject", 160, false);
  const body = normalizeMailText(bodyRaw, "Mail body", 4_000, true);
  return { to, subject, body };
}

export function normalizeDesktopNotificationProposal(titleRaw: string, bodyRaw: string): DesktopNotificationProposal {
  const title = normalizeNotificationText(titleRaw, "Notification title", 120);
  const body = normalizeNotificationText(bodyRaw, "Notification body", 500);
  return { title, body };
}

export function parseDesktopNotificationContent(content: string): DesktopNotificationProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Notification content must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Notification content must be an object.");
  const value = parsed as Partial<DesktopNotificationProposal>;
  return normalizeDesktopNotificationProposal(String(value.title ?? ""), String(value.body ?? ""));
}

export function parseConnectorMessageContent(content: string): ConnectorMessageProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Connector message content must be valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("Connector message content must be an object.");
  const value = parsed as Partial<ConnectorMessageProposal>;
  return normalizeConnectorMessageProposal(`${String(value.connector ?? "")}:${String(value.targetId ?? "")}`, String(value.text ?? ""));
}

export function normalizeConnectorMessageProposal(targetRaw: string, textRaw: string): ConnectorMessageProposal {
  const { connector, targetId } = normalizeConnectorTarget(targetRaw);
  const text = normalizeConnectorMessageText(textRaw);
  return { connector, targetId, text };
}

export function connectorMessageTarget(message: ConnectorMessageProposal): string {
  const safe = normalizeConnectorMessageProposal(`${message.connector}:${message.targetId}`, message.text);
  return `${safe.connector}:${safe.targetId}`;
}

export function mailDraftToUrl(draft: MailDraftProposal): string {
  const safe = normalizeMailDraftProposal(draft.to, draft.subject, draft.body);
  const params = new URLSearchParams({ subject: safe.subject, body: safe.body });
  const url = `mailto:${safe.to}?${params.toString()}`;
  if (url.length > 2048) throw new Error("Mail draft URL is too long.");
  return url;
}

function parseMailDraftInput(input: string): MailDraftProposal {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Mail draft input is required.");
  if (trimmed.startsWith("{")) return parseMailDraftContent(trimmed);

  const parts = trimmed.split(/\s+\|\s+/u);
  if (parts.length !== 3) {
    throw new Error("Usage: /propose mail-draft <to> | <subject> | <body>");
  }
  return normalizeMailDraftProposal(parts[0], parts[1], parts[2]);
}

function parseDesktopNotificationInput(input: string): DesktopNotificationProposal {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Notification input is required.");
  if (trimmed.startsWith("{")) return parseDesktopNotificationContent(trimmed);

  const parts = trimmed.split(/\s+\|\s+/u);
  if (parts.length !== 2) {
    throw new Error("Usage: /propose notify <title> | <body>");
  }
  return normalizeDesktopNotificationProposal(parts[0], parts[1]);
}

function parseConnectorMessageInput(input: string): ConnectorMessageProposal {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Connector message input is required.");
  if (trimmed.startsWith("{")) return parseConnectorMessageContent(trimmed);

  const parts = trimmed.split(/\s+\|\s+/u);
  if (parts.length !== 2) {
    throw new Error("Usage: /propose message telegram:<chat-id>|discord:<channel-id> | <text>");
  }
  return normalizeConnectorMessageProposal(parts[0], parts[1]);
}

function normalizeConnectorTarget(raw: string): { connector: AccessConnector; targetId: string } {
  const value = raw.trim();
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("Connector message target must look like telegram:<chat-id> or discord:<channel-id>.");
  }
  const connector = value.slice(0, separator);
  const targetId = value.slice(separator + 1).trim();
  if (connector !== "telegram" && connector !== "discord") {
    throw new Error("Connector message target must use telegram or discord.");
  }
  return { connector, targetId: normalizeConnectorTargetId(connector, targetId) };
}

function normalizeConnectorTargetId(connector: AccessConnector, raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Connector message target id is required.");
  if (connector === "telegram" && (/^-?\d{1,32}$/u.test(value) || /^@[A-Za-z0-9_]{5,64}$/u.test(value))) return value;
  if (connector === "discord" && /^\d{5,32}$/u.test(value)) return value;
  throw new Error(connector === "telegram"
    ? "Telegram target id must be a numeric chat id or @channel username."
    : "Discord target id must be a numeric channel id.");
}

function normalizeConnectorMessageText(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) throw new Error("Connector message text contains control characters.");
  const value = raw.trim().replace(/\r\n?/gu, "\n");
  if (!value) throw new Error("Connector message text is required.");
  if (value.length > 2_000) throw new Error("Connector message text is too long.");
  return value;
}

function normalizeMailRecipient(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Mail recipient is required.");
  if (value.length > 254) throw new Error("Mail recipient is too long.");
  if (/[\s,;<>\u0000-\u001f\u007f]/u.test(value)) throw new Error("Mail recipient must be a single plain email address.");
  const [local = "", domain = ""] = value.split("@");
  if (local.length > 64 || domain.length > 253) throw new Error("Mail recipient must be a valid email address.");
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u.test(value)) {
    throw new Error("Mail recipient must be a valid email address.");
  }
  return value;
}

function normalizeMailText(raw: string, label: string, maxLength: number, allowNewline: boolean): string {
  const controlPattern = allowNewline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u;
  if (controlPattern.test(raw)) throw new Error(`${label} contains control characters.`);
  const value = allowNewline ? raw.trim() : raw.trim().replace(/\s+/gu, " ");
  if (!value) throw new Error(`${label} is required.`);
  if (value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

function normalizeCalendarText(raw: string, label: string, maxLength: number): string {
  if (/[\u0000-\u001f\u007f]/u.test(raw)) throw new Error(`${label} contains control characters.`);
  const value = raw.trim().replace(/\s+/gu, " ");
  if (!value) throw new Error(`${label} is required.`);
  if (value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

function normalizeNotificationText(raw: string, label: string, maxLength: number): string {
  if (/[\u0000-\u001f\u007f]/u.test(raw)) throw new Error(`${label} contains control characters.`);
  const value = raw.trim().replace(/\s+/gu, " ");
  if (!value) throw new Error(`${label} is required.`);
  if (value.length > maxLength) throw new Error(`${label} is too long.`);
  return value;
}

export function normalizeExternalUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("External URL is required.");
  if (value.length > 2048) throw new Error("External URL is too long.");
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("External URL contains control characters.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`External URL is invalid: ${value}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (!["http:", "https:", "mailto:"].includes(protocol)) {
    throw new Error("External URL scheme must be http, https, or mailto.");
  }
  if ((protocol === "http:" || protocol === "https:") && !parsed.hostname) {
    throw new Error("External web URL must include a hostname.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("External URL credentials are not allowed.");
  }

  return parsed.toString();
}

async function openUrlWithSystem(url: string): Promise<void> {
  const safeUrl = normalizeExternalUrl(url);
  const command = process.platform === "darwin"
    ? { command: "open", args: [safeUrl] }
    : process.platform === "win32"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", safeUrl] }
      : { command: "xdg-open", args: [safeUrl] };
  const result = await runCommand({ ...command, timeoutMs: 5_000, maxOutputBytes: 20_000 });
  if (result.exitCode !== 0 || result.signal) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`open-url action failed${output ? `: ${output}` : "."}`);
  }
}

async function speakTextWithSystem(text: string): Promise<void> {
  const safeText = normalizeSpeechText(text);
  const command: { command: string; args: string[]; env?: Record<string, string> } = process.platform === "darwin"
    ? { command: "say", args: [safeText] }
    : process.platform === "win32"
      ? {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Add-Type -AssemblyName System.Speech; $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speaker.Speak([string]$env:VISER_SPEAK_TEXT)"
          ],
          env: { VISER_SPEAK_TEXT: safeText }
        }
      : { command: "spd-say", args: [safeText] };
  const result = await runCommand({ ...command, timeoutMs: 30_000, maxOutputBytes: 20_000 });
  if (result.exitCode !== 0 || result.signal) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`speak action failed${output ? `: ${output}` : "."}`);
  }
}

async function openCalendarFileWithSystem(path: string): Promise<void> {
  const command = process.platform === "darwin"
    ? { command: "open", args: [path] }
    : process.platform === "win32"
      ? { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", path] }
      : { command: "xdg-open", args: [path] };
  const result = await runCommand({ ...command, timeoutMs: 10_000, maxOutputBytes: 20_000 });
  if (result.exitCode !== 0 || result.signal) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`calendar-event action failed${output ? `: ${output}` : "."}`);
  }
}

async function notifyDesktopWithSystem(notification: DesktopNotificationProposal): Promise<void> {
  const safe = normalizeDesktopNotificationProposal(notification.title, notification.body);
  const command: { command: string; args: string[]; env?: Record<string, string> } = process.platform === "darwin"
    ? {
        command: "osascript",
        args: ["-e", `display notification ${appleScriptString(safe.body)} with title ${appleScriptString(safe.title)}`]
      }
    : process.platform === "win32"
      ? {
          command: "powershell.exe",
          args: [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            [
              "Add-Type -AssemblyName System.Windows.Forms",
              "Add-Type -AssemblyName System.Drawing",
              "$n = New-Object System.Windows.Forms.NotifyIcon",
              "$n.Icon = [System.Drawing.SystemIcons]::Information",
              "$n.BalloonTipTitle = [string]$env:VISER_NOTIFY_TITLE",
              "$n.BalloonTipText = [string]$env:VISER_NOTIFY_BODY",
              "$n.Visible = $true",
              "$n.ShowBalloonTip(5000)",
              "Start-Sleep -Milliseconds 5500",
              "$n.Dispose()"
            ].join("; ")
          ],
          env: {
            VISER_NOTIFY_TITLE: safe.title,
            VISER_NOTIFY_BODY: safe.body
          }
        }
      : { command: "notify-send", args: [safe.title, safe.body] };
  const result = await runCommand({ ...command, timeoutMs: 10_000, maxOutputBytes: 20_000 });
  if (result.exitCode !== 0 || result.signal) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`notify action failed${output ? `: ${output}` : "."}`);
  }
}

async function copyTextToClipboardWithSystem(text: string): Promise<void> {
  const safeText = normalizeClipboardText(text);
  const command = clipboardCommand(safeText);
  const result = await runCommand({ ...command, timeoutMs: 5_000, maxOutputBytes: 20_000 });
  if (result.exitCode !== 0 || result.signal) {
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
    throw new Error(`clipboard action failed${output ? `: ${output}` : "."}`);
  }
}

function clipboardCommand(text: string): { command: string; args: string[]; stdin?: string; env?: Record<string, string> } {
  if (process.platform === "darwin") return { command: "pbcopy", args: [], stdin: text };
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-Command", "Set-Clipboard -Value ([string]$env:VISER_CLIPBOARD_TEXT)"],
      env: { VISER_CLIPBOARD_TEXT: text }
    };
  }

  if (commandExists("wl-copy")) return { command: "wl-copy", args: [], stdin: text };
  if (commandExists("xclip")) return { command: "xclip", args: ["-selection", "clipboard"], stdin: text };
  if (commandExists("xsel")) return { command: "xsel", args: ["--clipboard", "--input"], stdin: text };
  throw new Error("clipboard action failed: install wl-copy, xclip, or xsel for Linux clipboard support.");
}

async function missingConnectorMessageSender(): Promise<void> {
  throw new Error("Connector message sender is not configured.");
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function calendarEventToIcs(event: CalendarEventProposal, id: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KMokky//Viser//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(id)}@viser.local`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(new Date(event.start))}`,
    `DTEND:${formatIcsUtc(new Date(event.end))}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

function formatIcsUtc(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z"
  ].join("");
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/;/gu, "\\;").replace(/,/gu, "\\,").replace(/\r?\n/gu, "\\n");
}

function foldIcsLine(line: string): string {
  const width = 74;
  if (line.length <= width) return line;
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > width) {
    parts.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  parts.push(remaining);
  return parts.join("\r\n ");
}

function isFileActionType(type: PendingAction["type"]): type is "write-file" | "append-file" {
  return type === "write-file" || type === "append-file";
}

function redactedAction(action: PendingAction): PendingAction {
  return { ...action, content: redactedContent(action.content) };
}

function redactedContent(content: string): string {
  return /^\[\d+ bytes\]$/u.test(content) ? content : `[${Buffer.byteLength(content, "utf8")} bytes]`;
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = resolve(path);
  while (!fileExists(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

async function assertNoSymlinkWritePath(path: string, allowedWriteRoots: string[]): Promise<void> {
  const absoluteTarget = resolve(path);
  const lexicalRoot = allowedWriteRoots.map((root) => resolve(root)).find((root) => isInsideOrSame(absoluteTarget, root));
  if (!lexicalRoot) return;

  await assertPathComponentIsNotSymlink(lexicalRoot);
  const parts = relative(lexicalRoot, absoluteTarget).split(/[\\/]/u).filter(Boolean);
  let current = lexicalRoot;
  for (const part of parts) {
    current = join(current, part);
    const exists = await assertPathComponentIsNotSymlink(current);
    if (!exists) return;
  }
}

async function assertPathComponentIsNotSymlink(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Action target path contains a symlink: ${path}`);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

async function ensureActionTargetDirectory(path: string, allowedWriteRoots: string[]): Promise<void> {
  await assertNoSymlinkWritePath(path, allowedWriteRoots);
  await mkdir(path, { recursive: true, mode: PRIVATE_DIR_MODE });
  await assertNoSymlinkWritePath(path, allowedWriteRoots);
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`Action target directory is a symlink: ${path}`);
  if (!info.isDirectory()) throw new Error(`Action target path parent is not a directory: ${path}`);
}

async function writeActionFileNoFollow(
  path: string,
  content: string,
  type: "write-file" | "append-file"
): Promise<void> {
  const flags = type === "write-file"
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW
    : constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW;
  const handle = await open(path, flags, PRIVATE_FILE_MODE);
  try {
    await handle.writeFile(content, "utf8");
    await handle.chmod(PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

async function copyActionBackupNoFollow(sourcePath: string, backupPath: string): Promise<void> {
  const handle = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error(`Action backup source is not a regular file: ${sourcePath}`);
    await writePrivateFile(backupPath, await handle.readFile());
  } catch (error) {
    if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
      throw new Error(`Action backup source is a symlink: ${sourcePath}`);
    }
    throw error;
  } finally {
    await handle.close();
  }
}

function isInsideOrSame(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
