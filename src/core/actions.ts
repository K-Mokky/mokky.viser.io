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
import { fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import type { AccessConnector, ActionConfig, BrowserTaskActionConfig, BrowserTaskProvider, PendingAction } from "./types.ts";

export interface ActionStoreOptions {
  openUrl?: (url: string) => Promise<void>;
  speakText?: (text: string) => Promise<void>;
  openCalendarFile?: (path: string) => Promise<void>;
  notifyDesktop?: (notification: DesktopNotificationProposal) => Promise<void>;
  copyToClipboard?: (text: string) => Promise<void>;
  sendConnectorMessage?: (message: ConnectorMessageProposal) => Promise<void>;
  runBrowserTask?: (task: BrowserTaskProposal) => Promise<BrowserTaskResult>;
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

export interface BrowserTaskProposal {
  provider: BrowserTaskProvider;
  task: string;
  allowedDomains: string[];
  maxAgentSteps: number;
}

export interface BrowserTaskResult {
  id: string;
  sessionId?: string;
  url?: string;
  title?: string;
  text?: string;
}

interface BrowserTaskProof {
  id: string;
  actionId: string;
  provider: BrowserTaskProvider;
  allowedDomains: string[];
  maxAgentSteps: number;
  resultId: string;
  sessionId?: string;
  urlHost?: string;
  urlProtocol?: string;
  titleBytes: number;
  textBytes: number;
  createdAt: string;
}

export class ActionStore {
  private config: ActionConfig;
  private openUrl: (url: string) => Promise<void>;
  private speakText: (text: string) => Promise<void>;
  private openCalendarFile: (path: string) => Promise<void>;
  private notifyDesktop: (notification: DesktopNotificationProposal) => Promise<void>;
  private copyToClipboard: (text: string) => Promise<void>;
  private sendConnectorMessage: (message: ConnectorMessageProposal) => Promise<void>;
  private runBrowserTask: (task: BrowserTaskProposal) => Promise<BrowserTaskResult>;

  constructor(config: ActionConfig, options: ActionStoreOptions = {}) {
    this.config = config;
    this.openUrl = options.openUrl ?? openUrlWithSystem;
    this.speakText = options.speakText ?? speakTextWithSystem;
    this.openCalendarFile = options.openCalendarFile ?? openCalendarFileWithSystem;
    this.notifyDesktop = options.notifyDesktop ?? notifyDesktopWithSystem;
    this.copyToClipboard = options.copyToClipboard ?? copyTextToClipboardWithSystem;
    this.sendConnectorMessage = options.sendConnectorMessage ?? missingConnectorMessageSender;
    this.runBrowserTask = options.runBrowserTask ?? ((task) => runConfiguredBrowserTask(this.config.browserTask, task));
  }

  async propose(raw: string, source: string): Promise<PendingAction> {
    if (!this.config.enabled) throw new Error("Actions are disabled in config.");
    const proposal = parseActionProposal(raw);
    if (proposal.type === "browser-task") {
      const task = parseBrowserTaskContent(proposal.content);
      const configuredTask = normalizeBrowserTaskProposal(task.task, task.allowedDomains, task.maxAgentSteps, this.config.browserTask.provider);
      proposal.path = browserTaskTarget(configuredTask);
      proposal.content = JSON.stringify(configuredTask);
    }
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
                  : proposal.type === "browser-task"
                    ? browserTaskTarget(parseBrowserTaskContent(proposal.content))
                  : await this.resolveAllowedWritePath(proposal.path, { allowMissing: true });
    if (proposal.type === "browser-task" && !this.config.browserTask.enabled) {
      throw new Error("Browser task actions are disabled in config. Enable actions.browserTask.enabled and set BROWSER_USE_API_KEY before approving cloud browser automation.");
    }
    if (proposal.type === "browser-task") assertBrowserTaskAllowedByConfig(parseBrowserTaskContent(proposal.content), this.config.browserTask);
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

    if (action.type === "browser-task") {
      const task = parseBrowserTaskContent(action.content);
      if (browserTaskTarget(task) !== action.targetPath) {
        throw new Error("Browser task target does not match persisted content.");
      }
      const result = await this.runBrowserTask(task);
      await this.appendBrowserTaskProof(action, task, result);
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

  private async appendBrowserTaskProof(action: PendingAction, task: BrowserTaskProposal, result: BrowserTaskResult): Promise<void> {
    const resultUrl = safeBrowserTaskProofUrl(result.url);
    const proof: BrowserTaskProof = {
      id: randomUUID().slice(0, 12),
      actionId: action.id,
      provider: task.provider,
      allowedDomains: task.allowedDomains,
      maxAgentSteps: task.maxAgentSteps,
      resultId: result.id,
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      ...(resultUrl ? { urlHost: resultUrl.hostname, urlProtocol: resultUrl.protocol } : {}),
      titleBytes: Buffer.byteLength(result.title ?? "", "utf8"),
      textBytes: Buffer.byteLength(result.text ?? "", "utf8"),
      createdAt: nowIso()
    };
    await ensurePrivateDir(this.config.dir);
    await appendPrivateFile(join(this.config.dir, "browser-task-proofs.jsonl"), `${JSON.stringify(proof)}\n`);
  }
}

function safeBrowserTaskProofUrl(raw: string | undefined): URL | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    return parsed;
  } catch {
    return undefined;
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

  if (type === "connector-message" || type === "send-message" || type === "message") {
    const message = parseConnectorMessageInput(rest);
    return { type: "connector-message", path: connectorMessageTarget(message), content: JSON.stringify(message) };
  }

  if (type === "browser-task" || type === "browser-use-task") {
    const task = parseBrowserTaskInput(rest);
    return { type: "browser-task", path: browserTaskTarget(task), content: JSON.stringify(task) };
  }

  if (type !== "write-file" && type !== "append-file" && type !== "open-url") {
    throw new Error("Usage: /propose write-file <path> <content> OR /propose append-file <path> <content> OR /propose open-url <https-url|mailto-url> [note] OR /propose speak <text> OR /propose calendar-event <ISO-start> <duration-minutes> <title> OR /propose mail-draft <to> | <subject> | <body> OR /propose notify <title> | <body> OR /propose clipboard <text> OR /propose browser-task <task> | domains=<public-domain[,domain]> [| maxSteps=<1-300>] OR /propose message telegram:<chat-id>|discord:<channel-id>|slack:<channel-id>|matrix:<room-id>|signal:<recipient-id>|imessage:<handle-id>|whatsapp:<recipient-id>|line:<peer-id>|google-chat:<webhook-id>|webhook:<webhook-id>|home-assistant:<service-alias>|teams:<webhook-id>|mattermost:<webhook-id>|synology-chat:<webhook-id>|rocket-chat:<webhook-id>|feishu:<webhook-id>|dingtalk:<webhook-id>|wecom:<webhook-id>|zalo:<recipient-alias>|irc:<channel-alias>|twitch:<channel-alias>|ntfy:<topic-alias>|mastodon:<target-alias>|nextcloud-talk:<room-alias>|webex:<room-id>|zulip:<target-id>|email:<recipient-alias>|github:<issue-target-alias>|todoist:<project-alias>|notion:<page-alias>|obsidian:<note-alias> | <text>");
  }
  const { first: path, rest: content } = splitFirstToken(rest);
  if (!path) throw new Error("Action target path is required.");
  if (type === "open-url") return { type, path, content: content || "Open external URL after explicit approval." };
  if (!content) throw new Error("Action content is required.");
  return { type, path, content };
}

function splitFirstToken(input: string): { first: string; rest: string } {
  const trimmedStart = input.replace(/^\s+/u, "");
  const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(trimmedStart);
  return {
    first: match?.[1] ?? "",
    rest: (match?.[2] ?? "").trim()
  };
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
    throw new Error("Usage: /propose message telegram:<chat-id>|discord:<channel-id>|slack:<channel-id>|matrix:<room-id>|signal:<recipient-id>|imessage:<handle-id>|whatsapp:<recipient-id>|line:<peer-id>|google-chat:<webhook-id>|webhook:<webhook-id>|home-assistant:<service-alias>|teams:<webhook-id>|mattermost:<webhook-id>|synology-chat:<webhook-id>|rocket-chat:<webhook-id>|feishu:<webhook-id>|dingtalk:<webhook-id>|wecom:<webhook-id>|zalo:<recipient-alias>|irc:<channel-alias>|twitch:<channel-alias>|ntfy:<topic-alias>|mastodon:<target-alias>|nextcloud-talk:<room-alias>|webex:<room-id>|zulip:<target-id>|email:<recipient-alias>|github:<issue-target-alias>|todoist:<project-alias>|notion:<page-alias>|obsidian:<note-alias> | <text>");
  }
  return normalizeConnectorMessageProposal(parts[0], parts[1]);
}

function parseBrowserTaskInput(input: string): BrowserTaskProposal {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Browser task input is required.");
  if (trimmed.startsWith("{")) return parseBrowserTaskContent(trimmed);

  const parts = trimmed.split(/\s+\|\s+/u).map((part) => part.trim()).filter(Boolean);
  const task = parts.shift() ?? "";
  let domains: string[] = [];
  let maxAgentSteps = 25;
  let provider: BrowserTaskProvider = "browser-use-cloud";
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator <= 0) throw new Error("Browser task options must look like domains=example.com[,example.org], maxSteps=25, or provider=browserbase-session.");
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (key === "domains" || key === "alloweddomains" || key === "allowed-domains") {
      domains = value.split(",").map((domain) => domain.trim()).filter(Boolean);
    } else if (key === "maxsteps" || key === "max-agent-steps" || key === "maxagentsteps") {
      maxAgentSteps = Number(value);
    } else if (key === "provider") {
      if (!isBrowserTaskProvider(value)) {
        throw new Error("Browser task provider must be browser-use-cloud, local-cdp, browserbase-session, or firecrawl-interact.");
      }
      provider = value;
    } else {
      throw new Error(`Unsupported browser task option: ${key}`);
    }
  }
  return normalizeBrowserTaskProposal(task, domains, maxAgentSteps, provider);
}

export function parseBrowserTaskContent(content: string): BrowserTaskProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Browser task content must be JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Browser task content must be an object.");
  const data = parsed as Record<string, unknown>;
  const domains = Array.isArray(data.allowedDomains) ? data.allowedDomains : [];
  const provider = typeof data.provider === "string" && isBrowserTaskProvider(data.provider) ? data.provider : "browser-use-cloud";
  return normalizeBrowserTaskProposal(
    typeof data.task === "string" ? data.task : "",
    domains.map((domain) => typeof domain === "string" ? domain : ""),
    typeof data.maxAgentSteps === "number" ? data.maxAgentSteps : 25,
    provider
  );
}

export function normalizeBrowserTaskProposal(task: string, allowedDomains: string[], maxAgentSteps: number, provider: BrowserTaskProvider = "browser-use-cloud"): BrowserTaskProposal {
  if (!isBrowserTaskProvider(provider)) throw new Error("Browser task provider must be browser-use-cloud, local-cdp, browserbase-session, or firecrawl-interact.");
  const normalizedTask = normalizeBrowserTaskText(task);
  const domains = [...new Set(allowedDomains.map(normalizeBrowserTaskDomain))];
  if (domains.length === 0) {
    throw new Error("Browser task must include at least one public allowed domain.");
  }
  if (!Number.isInteger(maxAgentSteps) || maxAgentSteps < 1 || maxAgentSteps > 300) {
    throw new Error("Browser task maxSteps must be an integer between 1 and 300.");
  }
  return { provider, task: normalizedTask, allowedDomains: domains, maxAgentSteps };
}

function isBrowserTaskProvider(value: string): value is BrowserTaskProvider {
  return value === "browser-use-cloud" || value === "local-cdp" || value === "browserbase-session" || value === "firecrawl-interact";
}

function normalizeBrowserTaskText(raw: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)) throw new Error("Browser task contains control characters.");
  const value = raw.trim().replace(/\s+/gu, " ");
  if (!value) throw new Error("Browser task is required.");
  if (value.length > 4000) throw new Error("Browser task is too long.");
  return value;
}

function normalizeBrowserTaskDomain(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Browser task allowed domain is required.");
  let host = value;
  if (/^https?:\/\//iu.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error("Browser task allowed domain must not include credentials.");
    host = url.hostname;
  }
  const domain = host.toLowerCase().replace(/\.$/u, "");
  if (!domain || domain.length > 253 || domain.includes("/") || domain.includes(":") || domain.includes("@")) {
    throw new Error("Browser task allowed domain must be a hostname without scheme, path, port, or credentials.");
  }
  if (isUnsafeBrowserTaskHost(domain)) {
    throw new Error("Browser task allowed domain must be public; localhost, private IPs, .local, .lan, .internal, and single-label hosts are blocked.");
  }
  return domain;
}

function isUnsafeBrowserTaskHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/\.$/u, "");
  if (!value || value === "localhost" || value.endsWith(".local") || value.endsWith(".lan") || value.endsWith(".internal")) return true;
  if (!value.includes(".")) return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map((part) => Number(part));
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function browserTaskTarget(task: BrowserTaskProposal): string {
  return `${task.provider}:${task.allowedDomains.join(",")}`;
}

function normalizeConnectorTarget(raw: string): { connector: AccessConnector; targetId: string } {
  const value = raw.trim();
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("Connector message target must look like telegram:<chat-id>, discord:<channel-id>, slack:<channel-id>, matrix:<room-id>, signal:<recipient-id>, imessage:<handle-id>, whatsapp:<recipient-id>, line:<peer-id>, google-chat:<webhook-id>, webhook:<webhook-id>, home-assistant:<service-alias>, teams:<webhook-id>, mattermost:<webhook-id>, synology-chat:<webhook-id>, rocket-chat:<webhook-id>, feishu:<webhook-id>, dingtalk:<webhook-id>, wecom:<webhook-id>, zalo:<recipient-alias>, irc:<channel-alias>, twitch:<channel-alias>, ntfy:<topic-alias>, mastodon:<target-alias>, nextcloud-talk:<room-alias>, webex:<room-id>, zulip:<target-id>, email:<recipient-alias>, github:<issue-target-alias>, todoist:<project-alias>, notion:<page-alias>, or obsidian:<note-alias>.");
  }
  const connector = value.slice(0, separator);
  const targetId = value.slice(separator + 1).trim();
  if (connector !== "telegram" && connector !== "discord" && connector !== "slack" && connector !== "matrix" && connector !== "signal" && connector !== "imessage" && connector !== "whatsapp" && connector !== "line" && connector !== "google-chat" && connector !== "webhook" && connector !== "home-assistant" && connector !== "teams" && connector !== "mattermost" && connector !== "synology-chat" && connector !== "rocket-chat" && connector !== "feishu" && connector !== "dingtalk" && connector !== "wecom" && connector !== "zalo" && connector !== "irc" && connector !== "twitch" && connector !== "ntfy" && connector !== "mastodon" && connector !== "nextcloud-talk" && connector !== "webex" && connector !== "zulip" && connector !== "email" && connector !== "github" && connector !== "todoist" && connector !== "notion" && connector !== "obsidian") {
    throw new Error("Connector message target must use telegram, discord, slack, matrix, signal, imessage, whatsapp, line, google-chat, webhook, home-assistant, teams, mattermost, synology-chat, rocket-chat, feishu, dingtalk, wecom, zalo, irc, twitch, ntfy, mastodon, nextcloud-talk, webex, zulip, email, github, todoist, notion, or obsidian.");
  }
  return { connector, targetId: normalizeConnectorTargetId(connector, targetId) };
}

function normalizeConnectorTargetId(connector: AccessConnector, raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("Connector message target id is required.");
  if (connector === "telegram" && (/^-?\d{1,32}$/u.test(value) || /^@[A-Za-z0-9_]{5,64}$/u.test(value))) return value;
  if (connector === "discord" && /^\d{5,32}$/u.test(value)) return value;
  if (connector === "slack" && /^[CDGU][A-Z0-9]{5,32}$/u.test(value)) return value;
  if (connector === "matrix" && /^[!#][^\s:/?#]+:[^\s/]{1,200}$/u.test(value)) return value;
  if (connector === "signal" && (/^\+[1-9]\d{4,19}$/u.test(value) || /^[1-9]\d{4,19}$/u.test(value))) return value.startsWith("+") ? value : `+${value}`;
  if (connector === "imessage" && (/^\+[1-9]\d{4,19}$/u.test(value) || /^[1-9]\d{4,19}$/u.test(value))) return value.startsWith("+") ? value : `+${value}`;
  if (connector === "whatsapp" && (/^\+[1-9]\d{4,19}$/u.test(value) || /^[1-9]\d{4,19}$/u.test(value))) return value.startsWith("+") ? value : `+${value}`;
  if (connector === "line" && /^[A-Za-z0-9._-]{1,128}$/u.test(value)) return value;
  if (connector === "imessage" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(value) && value.length <= 200) return value.toLowerCase();
  if ((connector === "google-chat" || connector === "webhook" || connector === "home-assistant" || connector === "teams" || connector === "mattermost" || connector === "synology-chat" || connector === "rocket-chat" || connector === "feishu" || connector === "dingtalk" || connector === "wecom" || connector === "zalo" || connector === "irc" || connector === "twitch" || connector === "ntfy" || connector === "mastodon" || connector === "nextcloud-talk" || connector === "zulip" || connector === "email" || connector === "github" || connector === "todoist" || connector === "notion" || connector === "obsidian") && /^[A-Za-z0-9._-]{1,80}$/u.test(value)) return value.toLowerCase();
  if (connector === "webex" && /^[A-Za-z0-9._-]{10,512}$/u.test(value)) return value;
  throw new Error(connector === "telegram"
    ? "Telegram target id must be a numeric chat id or @channel username."
    : connector === "discord"
      ? "Discord target id must be a numeric channel id."
      : connector === "slack"
        ? "Slack target id must be a Slack channel, group, DM, or user id such as C123456."
        : connector === "matrix"
          ? "Matrix target id must be a Matrix room id or alias such as !roomid:example.org."
          : connector === "signal"
            ? "Signal target id must be an E.164 phone number such as +15551234567."
            : connector === "imessage"
              ? "iMessage target id must be an E.164 phone number or email handle."
              : connector === "whatsapp"
                ? "WhatsApp target id must be an E.164 phone number such as +15551234567."
                : connector === "line"
                  ? "LINE target id must be a LINE userId, groupId, roomId, or configured alias value."
                  : connector === "google-chat"
                    ? "Google Chat target id must be a webhook alias such as default or ops."
                    : connector === "webhook"
                      ? "Generic webhook target id must be a webhook alias such as default or ops."
                      : connector === "home-assistant"
                      ? "Home Assistant target id must be a configured service alias such as default, notify, or lights."
                      : connector === "teams"
                      ? "Microsoft Teams target id must be a webhook alias such as default or ops."
                      : connector === "mattermost"
                        ? "Mattermost target id must be a webhook alias such as default or ops."
                        : connector === "synology-chat"
                          ? "Synology Chat target id must be a webhook alias such as default or ops."
                          : connector === "rocket-chat"
                          ? "Rocket.Chat target id must be a webhook alias such as default or ops."
                          : connector === "feishu"
                            ? "Feishu target id must be a webhook alias such as default or ops."
                            : connector === "dingtalk"
                              ? "DingTalk target id must be a webhook alias such as default or ops."
                              : connector === "wecom"
                                ? "WeCom target id must be a webhook alias such as default or ops."
                                : connector === "zalo"
                                  ? "Zalo target id must be a recipient alias such as default or ops."
                                  : connector === "irc"
                                    ? "IRC target id must be a channel alias such as default or ops."
                                    : connector === "twitch"
                                      ? "Twitch target id must be a channel alias such as default or ops."
                                      : connector === "ntfy"
                                        ? "ntfy target id must be a topic alias such as default, ops, or alerts."
                                        : connector === "mastodon"
                                        ? "Mastodon target id must be a configured alias such as default, private, or ops."
                                        : connector === "nextcloud-talk"
                                        ? "Nextcloud Talk target id must be a room alias such as default or ops."
                                        : connector === "webex"
                                          ? "Webex target id must be an opaque roomId value, not a URL or webhook."
                                          : connector === "zulip"
                                            ? "Zulip target id must be a configured alias such as default or ops."
                                            : connector === "email"
                                              ? "Email target id must be a configured alias such as default or ops."
                                              : connector === "github"
                                                ? "GitHub target id must be a configured issue/PR alias such as default or release-pr."
                                                : connector === "notion"
                                                  ? "Notion target id must be a configured page alias such as default, ops, or release-notes."
                                                  : connector === "todoist"
                                                    ? "Todoist target id must be a configured project alias such as inbox, default, ops, or errands."
                                                    : "Obsidian target id must be a configured note alias such as default, ops, or daily.");
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

function assertBrowserTaskAllowedByConfig(task: BrowserTaskProposal, config: BrowserTaskActionConfig): void {
  if (task.provider !== config.provider) {
    throw new Error(`Browser task provider ${task.provider} does not match configured provider ${config.provider}.`);
  }
  if (task.task.length > config.maxTaskChars) {
    throw new Error(`Browser task is too long (${task.task.length} > ${config.maxTaskChars}).`);
  }
  if (task.maxAgentSteps > config.maxAgentSteps) {
    throw new Error(`Browser task maxSteps exceeds configured limit (${task.maxAgentSteps} > ${config.maxAgentSteps}).`);
  }
  const allowed = new Set(config.allowedDomains.map(normalizeBrowserTaskDomain));
  if (allowed.size > 0) {
    const blocked = task.allowedDomains.filter((domain) => !allowed.has(domain));
    if (blocked.length > 0) {
      throw new Error(`Browser task domain is not in actions.browserTask.allowedDomains: ${blocked.join(", ")}`);
    }
  }
}

async function runConfiguredBrowserTask(config: BrowserTaskActionConfig, task: BrowserTaskProposal, fetchImpl: FetchLike = fetch): Promise<BrowserTaskResult> {
  if (config.provider === "local-cdp") return runLocalCdpBrowserTask(config, task, fetchImpl);
  if (config.provider === "browserbase-session") return runBrowserbaseSessionTask(config, task, fetchImpl);
  if (config.provider === "firecrawl-interact") return runFirecrawlInteractTask(config, task, fetchImpl);
  return runBrowserUseCloudTask(config, task, fetchImpl);
}

export async function runBrowserUseCloudTask(config: BrowserTaskActionConfig, task: BrowserTaskProposal, fetchImpl: FetchLike = fetch): Promise<BrowserTaskResult> {
  if (!config.enabled) throw new Error("Browser task actions are disabled in config.");
  if (config.provider !== "browser-use-cloud") throw new Error("Only Browser Use Cloud browser tasks are supported.");
  assertBrowserTaskAllowedByConfig(task, config);
  const apiKey = config.browserUseApiKey?.trim();
  if (!apiKey) throw new Error(`Browser Use API key is missing. Set ${config.browserUseApiKeyEnv}.`);
  const baseUrl = normalizeBrowserUseBaseUrl(config.browserUseBaseUrl);
  const response = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/api/v2/tasks`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-browser-use-api-key": apiKey
      },
      body: JSON.stringify({
        task: task.task,
        allowedDomains: task.allowedDomains,
        maxSteps: task.maxAgentSteps,
        sessionSettings: {
          enableRecording: false
        },
        highlightElements: false,
        vision: true,
        metadata: {
          source: "viser"
        }
      })
    },
    config.timeoutMs
  );
  const bodyText = await response.text();
  let body: unknown = undefined;
  if (bodyText.trim()) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = undefined;
    }
  }
  if (!response.ok) {
    const detail = typeof body === "object" && body && "detail" in body ? String((body as Record<string, unknown>).detail) : response.statusText;
    throw new Error(`Browser Use task creation failed (${response.status}): ${detail}`.replace(apiKey, "[REDACTED]"));
  }
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).id !== "string") {
    throw new Error("Browser Use task creation response did not include an id.");
  }
  const result = body as Record<string, unknown>;
  return {
    id: String(result.id),
    sessionId: typeof result.sessionId === "string" ? result.sessionId : undefined
  };
}

function normalizeBrowserUseBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") throw new Error("Browser Use base URL must use https.");
  if (url.username || url.password || url.search || url.hash) throw new Error("Browser Use base URL must not include credentials, query, or hash.");
  return url.toString().replace(/\/+$/u, "");
}

interface BrowserbaseSession {
  id: string;
  connectUrl: string;
}

async function createBrowserbaseSession(config: BrowserTaskActionConfig, baseUrl: string, apiKey: string, fetchImpl: FetchLike): Promise<BrowserbaseSession> {
  const body: Record<string, unknown> = {
    browserSettings: {
      timeout: config.browserbaseSessionTimeoutSeconds,
      keepAlive: false
    },
    userMetadata: {
      source: "viser"
    }
  };
  if (config.browserbaseProjectId?.trim()) body.projectId = config.browserbaseProjectId.trim();
  const response = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/v1/sessions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-api-key": apiKey
      },
      body: JSON.stringify(body)
    },
    config.timeoutMs
  );
  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Browserbase session creation failed (${response.status}): ${response.statusText}`.replace(apiKey, "[REDACTED]"));
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Browserbase session creation response was not JSON.");
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.connectUrl !== "string") {
    throw new Error("Browserbase session creation response did not include id and connectUrl.");
  }
  const connectUrl = new URL(record.connectUrl);
  if (connectUrl.protocol !== "wss:") throw new Error("Browserbase connectUrl must use wss.");
  if (connectUrl.username || connectUrl.password) throw new Error("Browserbase connectUrl must not include URL credentials.");
  return { id: record.id, connectUrl: connectUrl.toString() };
}

async function releaseBrowserbaseSession(config: BrowserTaskActionConfig, baseUrl: string, apiKey: string, sessionId: string, fetchImpl: FetchLike): Promise<void> {
  await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-api-key": apiKey
      },
      body: JSON.stringify({
        status: "REQUEST_RELEASE",
        ...(config.browserbaseProjectId?.trim() ? { projectId: config.browserbaseProjectId.trim() } : {})
      })
    },
    config.timeoutMs
  );
}

function normalizeBrowserbaseBaseUrl(raw: string): string {
  return normalizeHttpsApiBaseUrl(raw, "Browserbase base URL");
}

function normalizeFirecrawlBaseUrl(raw: string): string {
  return normalizeHttpsApiBaseUrl(raw, "Firecrawl base URL");
}

function normalizeHttpsApiBaseUrl(raw: string, label: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== "https:") throw new Error(`${label} must use https.`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} must not include credentials, query, or hash.`);
  if (url.pathname && url.pathname !== "/") throw new Error(`${label} must not include a path.`);
  return url.toString().replace(/\/+$/u, "");
}

async function createFirecrawlScrape(config: BrowserTaskActionConfig, baseUrl: string, apiKey: string, startUrl: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/v2/scrape`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        url: startUrl,
        formats: ["markdown"],
        onlyMainContent: true,
        removeBase64Images: true,
        blockAds: true
      })
    },
    config.timeoutMs
  );
  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Firecrawl scrape for browser task failed (${response.status}): ${response.statusText}`.replace(apiKey, "[REDACTED]"));
  }
  const scrapeId = firecrawlScrapeId(parsed);
  if (!scrapeId) throw new Error("Firecrawl scrape response did not include data.metadata.scrapeId.");
  return scrapeId;
}

async function interactWithFirecrawlScrape(config: BrowserTaskActionConfig, baseUrl: string, apiKey: string, scrapeId: string, prompt: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/v2/scrape/${encodeURIComponent(scrapeId)}/interact`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        prompt,
        timeout: config.firecrawlInteractTimeoutSeconds,
        origin: "viser"
      })
    },
    Math.max(config.timeoutMs, config.firecrawlInteractTimeoutSeconds * 1000)
  );
  const parsed = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Firecrawl interact browser task failed (${response.status}): ${response.statusText}`.replace(apiKey, "[REDACTED]"));
  }
  return boundedText(firecrawlInteractText(parsed), config.firecrawlMaxResultChars);
}

async function stopFirecrawlInteractSession(config: BrowserTaskActionConfig, baseUrl: string, apiKey: string, scrapeId: string, fetchImpl: FetchLike): Promise<void> {
  await fetchWithTimeout(
    fetchImpl,
    `${baseUrl}/v2/scrape/${encodeURIComponent(scrapeId)}/interact`,
    {
      method: "DELETE",
      headers: {
        "authorization": `Bearer ${apiKey}`
      }
    },
    config.timeoutMs
  );
}

function firecrawlScrapeId(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const data = (parsed as Record<string, unknown>).data;
  if (!data || typeof data !== "object") return undefined;
  const metadata = (data as Record<string, unknown>).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const record = metadata as Record<string, unknown>;
  return typeof record.scrapeId === "string" ? record.scrapeId : typeof record.scrape_id === "string" ? record.scrape_id : undefined;
}

function firecrawlInteractText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const record = parsed as Record<string, unknown>;
  const parts = [record.output, record.result, record.stdout, record.stderr, record.error]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.join("\n").trim();
}

function boundedText(raw: string, maxChars: number): string {
  return raw.replace(/\s+/gu, " ").trim().slice(0, Math.max(1, Math.floor(maxChars)));
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const bodyText = await response.text();
  if (!bodyText.trim()) return undefined;
  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

interface CdpWebSocketLike {
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown; error?: unknown }) => void, options?: { once?: boolean }): void;
  send(data: string): void;
  close(): void;
}

type CdpWebSocketFactory = (url: string) => CdpWebSocketLike;

interface LocalCdpTarget {
  id: string;
  webSocketDebuggerUrl: string;
}

interface LocalCdpSnapshot {
  title: string;
  url: string;
  text: string;
}

export async function runLocalCdpBrowserTask(
  config: BrowserTaskActionConfig,
  task: BrowserTaskProposal,
  fetchImpl: FetchLike = fetch,
  webSocketFactory: CdpWebSocketFactory = (url) => new WebSocket(url)
): Promise<BrowserTaskResult> {
  if (!config.enabled) throw new Error("Browser task actions are disabled in config.");
  if (config.provider !== "local-cdp") throw new Error("Only local CDP browser tasks are supported by this provider branch.");
  assertBrowserTaskAllowedByConfig(task, config);
  const baseUrl = normalizeLocalCdpBaseUrl(config.localCdpBaseUrl);
  const startUrl = browserTaskStartUrl(task);
  const target = await createLocalCdpTarget(baseUrl, startUrl, fetchImpl, config.timeoutMs);
  const connection = await CdpConnection.connect(target.webSocketDebuggerUrl, config.timeoutMs, webSocketFactory);
  try {
    const snapshot = await captureCdpSnapshot(connection, startUrl, config.localCdpWaitMs, config.localCdpMaxContentChars);
    return {
      id: target.id,
      sessionId: target.id,
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.text
    };
  } finally {
    if (config.localCdpCloseTab) await connection.send("Page.close").catch(() => undefined);
    connection.close();
  }
}

export async function runBrowserbaseSessionTask(
  config: BrowserTaskActionConfig,
  task: BrowserTaskProposal,
  fetchImpl: FetchLike = fetch,
  webSocketFactory: CdpWebSocketFactory = (url) => new WebSocket(url)
): Promise<BrowserTaskResult> {
  if (!config.enabled) throw new Error("Browser task actions are disabled in config.");
  if (config.provider !== "browserbase-session") throw new Error("Only Browserbase session browser tasks are supported by this provider branch.");
  assertBrowserTaskAllowedByConfig(task, config);
  const apiKey = config.browserbaseApiKey?.trim();
  if (!apiKey) throw new Error(`Browserbase API key is missing. Set ${config.browserbaseApiKeyEnv}.`);
  const baseUrl = normalizeBrowserbaseBaseUrl(config.browserbaseBaseUrl);
  const startUrl = browserTaskStartUrl(task);
  const session = await createBrowserbaseSession(config, baseUrl, apiKey, fetchImpl);
  let connection: CdpConnection | undefined;
  try {
    connection = await CdpConnection.connect(session.connectUrl, config.timeoutMs, webSocketFactory);
    const snapshot = await captureCdpSnapshot(connection, startUrl, config.localCdpWaitMs, config.localCdpMaxContentChars);
    return {
      id: session.id,
      sessionId: session.id,
      url: snapshot.url,
      title: snapshot.title,
      text: snapshot.text
    };
  } finally {
    connection?.close();
    if (config.browserbaseReleaseSession) {
      await releaseBrowserbaseSession(config, baseUrl, apiKey, session.id, fetchImpl).catch(() => undefined);
    }
  }
}

export async function runFirecrawlInteractTask(config: BrowserTaskActionConfig, task: BrowserTaskProposal, fetchImpl: FetchLike = fetch): Promise<BrowserTaskResult> {
  if (!config.enabled) throw new Error("Browser task actions are disabled in config.");
  if (config.provider !== "firecrawl-interact") throw new Error("Only Firecrawl interact browser tasks are supported by this provider branch.");
  assertBrowserTaskAllowedByConfig(task, config);
  const apiKey = config.firecrawlApiKey?.trim();
  if (!apiKey) throw new Error(`Firecrawl browser-task API key is missing. Set ${config.firecrawlApiKeyEnv}.`);
  const baseUrl = normalizeFirecrawlBaseUrl(config.firecrawlBaseUrl);
  const startUrl = browserTaskStartUrl(task);
  const scrapeId = await createFirecrawlScrape(config, baseUrl, apiKey, startUrl, fetchImpl);
  try {
    const text = await interactWithFirecrawlScrape(config, baseUrl, apiKey, scrapeId, task.task, fetchImpl);
    return {
      id: scrapeId,
      sessionId: scrapeId,
      url: startUrl,
      text
    };
  } finally {
    if (config.firecrawlStopSession) {
      await stopFirecrawlInteractSession(config, baseUrl, apiKey, scrapeId, fetchImpl).catch(() => undefined);
    }
  }
}

async function captureCdpSnapshot(connection: CdpConnection, startUrl: string, waitMs: number, maxContentChars: number): Promise<LocalCdpSnapshot> {
  await connection.send("Page.enable");
  await connection.send("Runtime.enable");
  await connection.send("Page.navigate", { url: startUrl });
  await Promise.race([
    connection.waitForEvent("Page.loadEventFired", waitMs),
    sleep(Math.max(1, waitMs))
  ]).catch(() => undefined);
  const evaluated = await connection.send("Runtime.evaluate", {
    expression: localCdpSnapshotExpression(maxContentChars),
    returnByValue: true,
    awaitPromise: true
  });
  return parseLocalCdpSnapshot(evaluated);
}

class CdpConnection {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private eventWaiters = new Map<string, Array<{ resolve: (value: unknown) => void; timeout: NodeJS.Timeout }>>();
  private socket: CdpWebSocketLike;
  private timeoutMs: number;

  private constructor(socket: CdpWebSocketLike, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
    socket.addEventListener("close", () => this.rejectAll(new Error("local CDP websocket closed before command completed")));
    socket.addEventListener("error", (event) => this.rejectAll(new Error(`local CDP websocket error: ${String(event.error ?? "unknown")}`)));
  }

  static async connect(url: string, timeoutMs: number, factory: CdpWebSocketFactory): Promise<CdpConnection> {
    const socket = factory(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`local CDP websocket open timed out after ${timeoutMs}ms`)), Math.max(1, timeoutMs));
      timer.unref?.();
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(`local CDP websocket error: ${String(event.error ?? "unknown")}`));
      }, { once: true });
    });
    return new CdpConnection(socket, timeoutMs);
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = params ? { id, method, params } : { id, method };
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`local CDP command timed out: ${method}`));
      }, Math.max(1, this.timeoutMs));
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
    });
    this.socket.send(JSON.stringify(payload));
    return promise;
  }

  waitForEvent(method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const waiters = this.eventWaiters.get(method) ?? [];
        this.eventWaiters.set(method, waiters.filter((waiter) => waiter.resolve !== resolve));
        resolve(undefined);
      }, Math.max(1, timeoutMs));
      timeout.unref?.();
      const waiters = this.eventWaiters.get(method) ?? [];
      waiters.push({ resolve, timeout });
      this.eventWaiters.set(method, waiters);
    });
  }

  close(): void {
    this.socket.close();
    this.rejectAll(new Error("local CDP websocket closed"));
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const record = message as Record<string, unknown>;
    if (typeof record.id === "number") {
      const pending = this.pending.get(record.id);
      if (!pending) return;
      this.pending.delete(record.id);
      clearTimeout(pending.timeout);
      if (record.error) pending.reject(new Error(`local CDP command failed: ${JSON.stringify(record.error)}`));
      else pending.resolve(record.result);
      return;
    }
    if (typeof record.method === "string") {
      const waiters = this.eventWaiters.get(record.method) ?? [];
      this.eventWaiters.delete(record.method);
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(record.params);
      }
    }
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

async function createLocalCdpTarget(baseUrl: string, startUrl: string, fetchImpl: FetchLike, timeoutMs: number): Promise<LocalCdpTarget> {
  const targetUrl = `${baseUrl}/json/new?${encodeURIComponent(startUrl)}`;
  let response = await fetchWithTimeout(fetchImpl, targetUrl, { method: "PUT" }, timeoutMs);
  if (response.status === 404 || response.status === 405) {
    response = await fetchWithTimeout(fetchImpl, targetUrl, { method: "GET" }, timeoutMs);
  }
  const bodyText = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    throw new Error(`local CDP target creation failed (${response.status}): ${response.statusText}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("local CDP target creation response was not JSON.");
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.webSocketDebuggerUrl !== "string") {
    throw new Error("local CDP target creation response did not include id and webSocketDebuggerUrl.");
  }
  return {
    id: record.id,
    webSocketDebuggerUrl: record.webSocketDebuggerUrl
  };
}

function browserTaskStartUrl(task: BrowserTaskProposal): string {
  const explicitUrls = task.task.match(/https?:\/\/[^\s"'<>]+/giu) ?? [];
  for (const candidate of explicitUrls) {
    try {
      const url = new URL(candidate);
      const host = normalizeBrowserTaskDomain(url.hostname);
      if (url.protocol === "https:" && task.allowedDomains.includes(host)) return url.toString();
    } catch {
      // Keep scanning for a safe explicit URL.
    }
  }
  return `https://${task.allowedDomains[0]}/`;
}

function localCdpSnapshotExpression(maxChars: number): string {
  const limit = Math.max(1, Math.min(50_000, Math.floor(maxChars)));
  return `(() => {
    const clean = (value, max = ${limit}) => String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, max);
    const body = document.body ? document.body.innerText : document.documentElement ? document.documentElement.textContent : "";
    return {
      title: clean(document.title, 500),
      url: String(location.href),
      text: clean(body, ${limit})
    };
  })()`;
}

function parseLocalCdpSnapshot(evaluated: unknown): LocalCdpSnapshot {
  if (!evaluated || typeof evaluated !== "object") throw new Error("local CDP evaluate result was not an object.");
  const outer = evaluated as Record<string, unknown>;
  const remoteObject = outer.result;
  if (!remoteObject || typeof remoteObject !== "object") throw new Error("local CDP evaluate result did not include a remote object.");
  const value = (remoteObject as Record<string, unknown>).value;
  if (!value || typeof value !== "object") throw new Error("local CDP evaluate result did not include a by-value snapshot.");
  const snapshot = value as Record<string, unknown>;
  return {
    title: typeof snapshot.title === "string" ? snapshot.title : "",
    url: typeof snapshot.url === "string" ? snapshot.url : "",
    text: typeof snapshot.text === "string" ? snapshot.text : ""
  };
}

function normalizeLocalCdpBaseUrl(raw: string): string {
  const url = new URL(raw.trim());
  const hostname = url.hostname.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
  if (url.protocol !== "http:") throw new Error("local CDP base URL must use http.");
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") throw new Error("local CDP base URL must point to localhost, 127.0.0.1, or ::1.");
  if (url.username || url.password || url.search || url.hash) throw new Error("local CDP base URL must not include credentials, query, or hash.");
  if (url.pathname && url.pathname !== "/") throw new Error("local CDP base URL must not include a path.");
  return url.toString().replace(/\/+$/u, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(1, ms)));
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
