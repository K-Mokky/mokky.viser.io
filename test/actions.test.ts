import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ActionStore,
  mailDraftToUrl,
  normalizeCalendarEventProposal,
  normalizeClipboardText,
  normalizeConnectorMessageProposal,
  normalizeDesktopNotificationProposal,
  normalizeExternalUrl,
  normalizeMailDraftProposal,
  normalizeSpeechText,
  parseConnectorMessageContent,
  parseActionProposal
} from "../src/core/actions.ts";
import type { ActionConfig } from "../src/core/types.ts";

test("parseActionProposal parses write and append proposals", () => {
  assert.deepEqual(parseActionProposal("write-file notes.txt hello world"), {
    type: "write-file",
    path: "notes.txt",
    content: "hello world"
  });
  assert.deepEqual(parseActionProposal("append-file notes.txt more"), {
    type: "append-file",
    path: "notes.txt",
    content: "more"
  });
});

test("parseActionProposal parses approved external URL automation proposals", () => {
  assert.deepEqual(parseActionProposal("open-url https://example.com/docs review docs"), {
    type: "open-url",
    path: "https://example.com/docs",
    content: "review docs"
  });
  assert.deepEqual(parseActionProposal("open-url mailto:support@example.com"), {
    type: "open-url",
    path: "mailto:support@example.com",
    content: "Open external URL after explicit approval."
  });
});

test("parseActionProposal parses approved local speech proposals", () => {
  assert.deepEqual(parseActionProposal("speak hello   world"), {
    type: "speak",
    path: "local-tts",
    content: "hello world"
  });
});

test("parseActionProposal parses approved local calendar event proposals", () => {
  const parsed = parseActionProposal("calendar-event 2026-06-01T09:00:00Z 30 Project kickoff");

  assert.equal(parsed.type, "calendar-event");
  assert.equal(parsed.path, "local-calendar");
  assert.deepEqual(JSON.parse(parsed.content), {
    start: "2026-06-01T09:00:00.000Z",
    end: "2026-06-01T09:30:00.000Z",
    durationMinutes: 30,
    title: "Project kickoff"
  });
});

test("parseActionProposal parses approved local mail draft proposals", () => {
  const parsed = parseActionProposal("mail-draft user@example.com | Hello there | Body text");

  assert.equal(parsed.type, "mail-draft");
  assert.equal(parsed.path, "mailto:user@example.com?subject=Hello+there&body=Body+text");
  assert.deepEqual(JSON.parse(parsed.content), {
    to: "user@example.com",
    subject: "Hello there",
    body: "Body text"
  });
});

test("parseActionProposal parses approved local desktop notification proposals", () => {
  const parsed = parseActionProposal("notify Build done | Viser finished the release check");

  assert.equal(parsed.type, "notify");
  assert.equal(parsed.path, "local-notification");
  assert.deepEqual(JSON.parse(parsed.content), {
    title: "Build done",
    body: "Viser finished the release check"
  });
});

test("parseActionProposal parses approved connector message proposals", () => {
  const parsed = parseActionProposal("message telegram:-100123456 | Viser finished the release check");

  assert.equal(parsed.type, "connector-message");
  assert.equal(parsed.path, "telegram:-100123456");
  assert.deepEqual(JSON.parse(parsed.content), {
    connector: "telegram",
    targetId: "-100123456",
    text: "Viser finished the release check"
  });
});

test("parseActionProposal parses approved local clipboard proposals", () => {
  assert.deepEqual(parseActionProposal("clipboard hello   world"), {
    type: "clipboard",
    path: "local-clipboard",
    content: "hello   world"
  });
  assert.deepEqual(parseActionProposal("copy hello world"), {
    type: "clipboard",
    path: "local-clipboard",
    content: "hello world"
  });
});

test("normalizeExternalUrl allows only safe external URL schemes", () => {
  assert.equal(normalizeExternalUrl("https://example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeExternalUrl("mailto:support@example.com"), "mailto:support@example.com");
  assert.throws(() => normalizeExternalUrl("file:///etc/passwd"), /scheme/);
  assert.throws(() => normalizeExternalUrl("javascript:alert(1)"), /scheme/);
  assert.throws(() => normalizeExternalUrl("https://user:pass@example.com"), /credentials/);
});

test("normalizeSpeechText keeps local TTS bounded", () => {
  assert.equal(normalizeSpeechText("  hello\nworld  "), "hello world");
  assert.throws(() => normalizeSpeechText(""), /required/);
  assert.throws(() => normalizeSpeechText(`hello${String.fromCharCode(0)}world`), /control/);
  assert.throws(() => normalizeSpeechText("x".repeat(501)), /too long/);
});

test("normalizeCalendarEventProposal keeps local calendar imports bounded", () => {
  assert.deepEqual(normalizeCalendarEventProposal("2026-06-01T09:00:00Z", "45", "  project   review  "), {
    start: "2026-06-01T09:00:00.000Z",
    end: "2026-06-01T09:45:00.000Z",
    durationMinutes: 45,
    title: "project review"
  });
  assert.throws(() => normalizeCalendarEventProposal("not-a-date", "30", "title"), /ISO/);
  assert.throws(() => normalizeCalendarEventProposal("2026-06-01T09:00:00Z", "0", "title"), /duration/);
  assert.throws(() => normalizeCalendarEventProposal("2026-06-01T09:00:00Z", "30", ""), /title/i);
  assert.throws(() => normalizeCalendarEventProposal("2026-06-01T09:00:00Z", "30", `bad${String.fromCharCode(1)}`), /control/);
});

test("normalizeMailDraftProposal keeps local mail drafts bounded", () => {
  assert.deepEqual(normalizeMailDraftProposal(" USER+test@example.com ", "  hi   there ", " body\nline "), {
    to: "USER+test@example.com",
    subject: "hi there",
    body: "body\nline"
  });
  assert.equal(
    mailDraftToUrl({ to: "user@example.com", subject: "Hi", body: "Line one\nLine two" }),
    "mailto:user@example.com?subject=Hi&body=Line+one%0ALine+two"
  );
  assert.throws(() => normalizeMailDraftProposal("bad address", "s", "b"), /single plain email|valid email/);
  assert.throws(() => normalizeMailDraftProposal("user?subject=x@example.com", "s", "b"), /valid email/);
  assert.throws(() => normalizeMailDraftProposal("user@example.com", "", "b"), /subject/i);
  assert.throws(() => normalizeMailDraftProposal("user@example.com", "s", ""), /body/i);
  assert.throws(() => normalizeMailDraftProposal("user@example.com", `bad${String.fromCharCode(1)}`, "body"), /control/);
  assert.throws(() => mailDraftToUrl({ to: "user@example.com", subject: "Hi", body: "x".repeat(2_100) }), /too long/);
});

test("normalizeDesktopNotificationProposal keeps desktop notifications bounded", () => {
  assert.deepEqual(normalizeDesktopNotificationProposal("  Build   done ", " Viser finished   checks "), {
    title: "Build done",
    body: "Viser finished checks"
  });
  assert.throws(() => normalizeDesktopNotificationProposal("", "body"), /title/i);
  assert.throws(() => normalizeDesktopNotificationProposal("title", ""), /body/i);
  assert.throws(() => normalizeDesktopNotificationProposal(`bad${String.fromCharCode(1)}`, "body"), /control/);
  assert.throws(() => normalizeDesktopNotificationProposal("title", "x".repeat(501)), /too long/);
});

test("normalizeConnectorMessageProposal keeps outbound messenger messages bounded", () => {
  assert.deepEqual(normalizeConnectorMessageProposal(" telegram:-100123456 ", " hello\r\nworld "), {
    connector: "telegram",
    targetId: "-100123456",
    text: "hello\nworld"
  });
  assert.deepEqual(parseConnectorMessageContent(JSON.stringify({
    connector: "discord",
    targetId: "1234567890",
    text: "ship it"
  })), {
    connector: "discord",
    targetId: "1234567890",
    text: "ship it"
  });
  assert.throws(() => normalizeConnectorMessageProposal("slack:123", "hello"), /telegram or discord/);
  assert.throws(() => normalizeConnectorMessageProposal("telegram:not a chat", "hello"), /Telegram target/);
  assert.throws(() => normalizeConnectorMessageProposal("discord:abc", "hello"), /Discord target/);
  assert.throws(() => normalizeConnectorMessageProposal("telegram:123", ""), /text/i);
  assert.throws(() => normalizeConnectorMessageProposal("telegram:123", `bad${String.fromCharCode(1)}`), /control/);
  assert.throws(() => normalizeConnectorMessageProposal("telegram:123", "x".repeat(2_001)), /too long/);
});

test("normalizeClipboardText keeps local clipboard copies bounded", () => {
  assert.equal(normalizeClipboardText("  hello\r\nworld  "), "hello\nworld");
  assert.throws(() => normalizeClipboardText(""), /required/);
  assert.throws(() => normalizeClipboardText(`bad${String.fromCharCode(1)}`), /control/);
  assert.throws(() => normalizeClipboardText("x".repeat(8_001)), /too long/);
});

test("ActionStore requires approval before executing writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-"));
  try {
    const store = new ActionStore(config(dir));
    const action = await store.propose("write-file notes.txt hello", "test");
    assert.equal((await store.list("pending")).length, 1);
    await assert.rejects(readFile(join(dir, "notes.txt"), "utf8"));

    const approved = await store.approve(action.id);
    assert.equal(approved?.status, "approved");
    assert.equal(await readFile(join(dir, "notes.txt"), "utf8"), "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before opening external URLs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-open-url-"));
  const opened: string[] = [];
  try {
    const store = new ActionStore(config(dir), { openUrl: async (url) => { opened.push(url); } });
    const action = await store.propose("open-url https://example.com/docs check docs", "test");

    assert.equal(action.type, "open-url");
    assert.equal(action.targetPath, "https://example.com/docs");
    assert.equal(opened.length, 0);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(opened, ["https://example.com/docs"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before speaking local text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-speak-"));
  const spoken: string[] = [];
  try {
    const store = new ActionStore(config(dir), { speakText: async (text) => { spoken.push(text); } });
    const action = await store.propose("speak hello from Viser", "test");

    assert.equal(action.type, "speak");
    assert.equal(action.targetPath, "local-tts");
    assert.deepEqual(spoken, []);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(spoken, ["hello from Viser"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before creating and opening calendar event imports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-calendar-"));
  const opened: string[] = [];
  try {
    const store = new ActionStore(config(dir), { openCalendarFile: async (path) => { opened.push(path); } });
    const action = await store.propose("calendar-event 2026-06-01T09:00:00Z 30 Project kickoff", "test");

    assert.equal(action.type, "calendar-event");
    assert.match(action.targetPath, /\.ics$/);
    assert.deepEqual(opened, []);
    await assert.rejects(readFile(action.targetPath, "utf8"));

    const approved = await store.approve(action.id);
    const ics = await readFile(action.targetPath, "utf8");

    assert.equal(approved?.status, "approved");
    assert.deepEqual(opened, [action.targetPath]);
    assert.match(ics, /BEGIN:VCALENDAR/);
    assert.match(ics, /DTSTART:20260601T090000Z/);
    assert.match(ics, /DTEND:20260601T093000Z/);
    assert.match(ics, /SUMMARY:Project kickoff/);
    assert.equal((await stat(action.targetPath)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before opening local mail drafts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-mail-draft-"));
  const opened: string[] = [];
  try {
    const store = new ActionStore(config(dir), { openUrl: async (url) => { opened.push(url); } });
    const action = await store.propose("mail-draft user@example.com | Hello | Body text", "test");

    assert.equal(action.type, "mail-draft");
    assert.equal(action.targetPath, "mailto:user@example.com?subject=Hello&body=Body+text");
    assert.deepEqual(opened, []);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(opened, ["mailto:user@example.com?subject=Hello&body=Body+text"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before showing desktop notifications", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-notify-"));
  const notifications: Array<{ title: string; body: string }> = [];
  try {
    const store = new ActionStore(config(dir), { notifyDesktop: async (notification) => { notifications.push(notification); } });
    const action = await store.propose("notify Build done | Viser finished checks", "test");

    assert.equal(action.type, "notify");
    assert.equal(action.targetPath, "local-notification");
    assert.deepEqual(notifications, []);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(notifications, [{ title: "Build done", body: "Viser finished checks" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before sending connector messages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-connector-message-"));
  const sent: Array<{ connector: string; targetId: string; text: string }> = [];
  try {
    const store = new ActionStore(config(dir), { sendConnectorMessage: async (message) => { sent.push(message); } });
    const action = await store.propose("message discord:1234567890 | Viser finished checks", "test");

    assert.equal(action.type, "connector-message");
    assert.equal(action.targetPath, "discord:1234567890");
    assert.deepEqual(sent, []);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(sent, [{ connector: "discord", targetId: "1234567890", text: "Viser finished checks" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore requires approval before copying to local clipboard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-clipboard-"));
  const copied: string[] = [];
  try {
    const store = new ActionStore(config(dir), { copyToClipboard: async (text) => { copied.push(text); } });
    const action = await store.propose("clipboard Viser finished checks", "test");

    assert.equal(action.type, "clipboard");
    assert.equal(action.targetPath, "local-clipboard");
    assert.deepEqual(copied, []);
    assert.equal((await store.list("pending")).length, 1);

    const approved = await store.approve(action.id);

    assert.equal(approved?.status, "approved");
    assert.deepEqual(copied, ["Viser finished checks"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe external URL automation proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-open-url-block-"));
  try {
    const store = new ActionStore(config(dir), { openUrl: async () => { throw new Error("should not open"); } });

    await assert.rejects(() => store.propose("open-url file:///etc/passwd", "test"), /scheme/);
    await assert.rejects(() => store.propose("open-url https://user:pass@example.com", "test"), /credentials/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe local speech proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-speak-block-"));
  try {
    const store = new ActionStore(config(dir), { speakText: async () => { throw new Error("should not speak"); } });

    await assert.rejects(() => store.propose("speak", "test"), /required/);
    await assert.rejects(() => store.propose(`speak hello${String.fromCharCode(1)}world`, "test"), /control/);
    await assert.rejects(() => store.propose(`speak ${"x".repeat(501)}`, "test"), /too long/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe local calendar event proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-calendar-block-"));
  try {
    const store = new ActionStore(config(dir), { openCalendarFile: async () => { throw new Error("should not open"); } });

    await assert.rejects(() => store.propose("calendar-event not-a-date 30 Planning", "test"), /ISO/);
    await assert.rejects(() => store.propose("calendar-event 2026-06-01T09:00:00Z 0 Planning", "test"), /duration/);
    await assert.rejects(() => store.propose("calendar-event 2026-06-01T09:00:00Z 30", "test"), /title/i);
    await assert.rejects(() => store.propose(`calendar-event 2026-06-01T09:00:00Z 30 bad${String.fromCharCode(1)}`, "test"), /control/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe local mail draft proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-mail-draft-block-"));
  try {
    const store = new ActionStore(config(dir), { openUrl: async () => { throw new Error("should not open"); } });

    await assert.rejects(() => store.propose("mail-draft bad address | Hello | Body", "test"), /email|recipient/);
    await assert.rejects(() => store.propose("mail-draft user@example.com |  | Body", "test"), /Usage|subject/);
    await assert.rejects(() => store.propose(`mail-draft user@example.com | Hi | bad${String.fromCharCode(1)}`, "test"), /control/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe desktop notification proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-notify-block-"));
  try {
    const store = new ActionStore(config(dir), { notifyDesktop: async () => { throw new Error("should not notify"); } });

    await assert.rejects(() => store.propose("notify", "test"), /required/);
    await assert.rejects(() => store.propose("notify Title only", "test"), /Usage/);
    await assert.rejects(() => store.propose(`notify bad${String.fromCharCode(1)} | body`, "test"), /control/);
    await assert.rejects(() => store.propose(`notify Title | ${"x".repeat(501)}`, "test"), /too long/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe connector message proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-connector-message-block-"));
  try {
    const store = new ActionStore(config(dir), { sendConnectorMessage: async () => { throw new Error("should not send"); } });

    await assert.rejects(() => store.propose("message", "test"), /required|Usage/);
    await assert.rejects(() => store.propose("message slack:123 | hello", "test"), /telegram or discord/);
    await assert.rejects(() => store.propose("message telegram:not-a-chat | hello", "test"), /Telegram target/);
    await assert.rejects(() => store.propose(`message telegram:123 | bad${String.fromCharCode(1)}`, "test"), /control/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks unsafe local clipboard proposals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-clipboard-block-"));
  try {
    const store = new ActionStore(config(dir), { copyToClipboard: async () => { throw new Error("should not copy"); } });

    await assert.rejects(() => store.propose("clipboard", "test"), /required/);
    await assert.rejects(() => store.propose(`clipboard bad${String.fromCharCode(1)}`, "test"), /control/);
    await assert.rejects(() => store.propose(`clipboard ${"x".repeat(8_001)}`, "test"), /too long/);
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore minimizes decided action content in state and audit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-minimize-"));
  try {
    const store = new ActionStore(config(dir));
    const approved = await store.propose("write-file notes.txt super-secret-value", "test");
    const rejected = await store.propose("write-file rejected.txt reject-secret-value", "test");

    await store.approve(approved.id);
    await store.reject(rejected.id);

    const actionsRaw = await readFile(join(dir, ".viser", "actions", "actions.json"), "utf8");
    const auditRaw = await readFile(join(dir, ".viser", "actions", "audit.jsonl"), "utf8");
    const actions = JSON.parse(actionsRaw) as Array<{ id: string; content: string; status: string }>;

    assert.equal(await readFile(join(dir, "notes.txt"), "utf8"), "super-secret-value");
    assert.doesNotMatch(actionsRaw, /super-secret-value|reject-secret-value/);
    assert.doesNotMatch(auditRaw, /super-secret-value|reject-secret-value/);
    assert.deepEqual(actions.map((action) => action.status).sort(), ["approved", "rejected"]);
    assert.ok(actions.every((action) => /^\[\d+ bytes\]$/.test(action.content)));
    assert.match(auditRaw, /\[\d+ bytes\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore removes only decided action records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-remove-decided-"));
  try {
    const store = new ActionStore(config(dir));
    const pending = await store.propose("write-file pending.txt wait", "test");
    const rejected = await store.propose("write-file rejected.txt no", "test");
    await store.reject(rejected.id);

    assert.equal(await store.removeDecided(pending.id), false);
    assert.equal(await store.removeDecided(rejected.id), true);
    assert.ok((await store.list()).some((action) => action.id === pending.id));
    assert.ok(!(await store.list()).some((action) => action.id === rejected.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore blocks path traversal and creates backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-safe-"));
  try {
    const store = new ActionStore(config(dir));
    await assert.rejects(() => store.propose("write-file ../evil.txt nope", "test"), /Path traversal/);

    await writeFile(join(dir, "notes.txt"), "old", "utf8");
    const action = await store.propose("write-file notes.txt new", "test");
    const approved = await store.approve(action.id);
    assert.equal(await readFile(join(dir, "notes.txt"), "utf8"), "new");
    assert.ok(approved?.backupPath);
    assert.equal(await readFile(approved!.backupPath!, "utf8"), "old");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore stores overwrite backups with private permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-backup-mode-"));
  try {
    const store = new ActionStore(config(dir));
    const target = join(dir, "notes.txt");
    await writeFile(target, "private old value", "utf8");
    await chmod(target, 0o644);

    const action = await store.propose("write-file notes.txt replacement", "test");
    const approved = await store.approve(action.id);

    assert.ok(approved?.backupPath);
    assert.equal(await readFile(approved!.backupPath!, "utf8"), "private old value");
    assert.equal((await stat(approved!.backupPath!)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore writes approved action targets with private permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-target-mode-"));
  try {
    const store = new ActionStore(config(dir));

    const created = await store.propose("write-file created.txt created-secret", "test");
    await store.approve(created.id);
    assert.equal((await stat(join(dir, "created.txt"))).mode & 0o777, 0o600);

    const existing = join(dir, "existing.txt");
    await writeFile(existing, "old\n", "utf8");
    await chmod(existing, 0o644);
    const appended = await store.propose("append-file existing.txt appended-secret", "test");
    await store.approve(appended.id);

    assert.equal(await readFile(existing, "utf8"), "old\nappended-secret");
    assert.equal((await stat(existing)).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore creates missing target directories privately without chmodding existing directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-target-dir-mode-"));
  try {
    const store = new ActionStore(config(dir));

    const nested = await store.propose("write-file nested/private/notes.txt nested-secret", "test");
    await store.approve(nested.id);
    assert.equal(await readFile(join(dir, "nested", "private", "notes.txt"), "utf8"), "nested-secret");
    assert.equal((await stat(join(dir, "nested"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, "nested", "private"))).mode & 0o777, 0o700);

    const existingDir = join(dir, "existing-dir");
    await mkdir(existingDir);
    await chmod(existingDir, 0o755);
    const existing = await store.propose("write-file existing-dir/notes.txt existing-secret", "test");
    await store.approve(existing.id);

    assert.equal(await readFile(join(existingDir, "notes.txt"), "utf8"), "existing-secret");
    assert.equal((await stat(existingDir)).mode & 0o777, 0o755);
    assert.equal((await stat(join(existingDir, "notes.txt"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore refuses to write through symlink targets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-symlink-target-"));
  try {
    const store = new ActionStore(config(dir));
    await writeFile(join(dir, "victim.txt"), "old-secret", "utf8");
    await symlink(join(dir, "victim.txt"), join(dir, "notes.txt"));

    await assert.rejects(() => store.propose("write-file notes.txt replacement", "test"), /symlink/i);
    assert.equal(await readFile(join(dir, "victim.txt"), "utf8"), "old-secret");
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore refuses to write through symlink path components", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-symlink-parent-"));
  try {
    const store = new ActionStore(config(dir));
    await mkdir(join(dir, "real-dir"));
    await symlink(join(dir, "real-dir"), join(dir, "link-dir"));

    await assert.rejects(() => store.propose("write-file link-dir/notes.txt replacement", "test"), /symlink/i);
    await assert.rejects(() => readFile(join(dir, "real-dir", "notes.txt"), "utf8"));
    assert.equal((await store.list("pending")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore refuses absolute paths through external symlinks into the write root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-external-symlink-root-"));
  try {
    const workspace = join(dir, "workspace");
    const workspaceLink = join(dir, "workspace-link");
    await mkdir(workspace);
    await symlink(workspace, workspaceLink);

    const store = new ActionStore(config(workspace));

    await assert.rejects(
      () => store.propose(`write-file ${join(workspaceLink, "notes.txt")} replacement`, "test"),
      /outside allowed write roots/
    );
    assert.equal((await store.list("pending")).length, 0);
    await assert.rejects(() => readFile(join(workspace, "notes.txt"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore refuses allowed write roots reached through workspace symlink components", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".viser-actions-root-nofollow-"));
  try {
    const outsideRoot = join(dir, "outside-root");
    const outsideWrite = join(outsideRoot, "write-root");
    const rootLink = join(dir, "root-link");
    await mkdir(outsideWrite, { recursive: true });
    await symlink(outsideRoot, rootLink);

    const store = new ActionStore({
      ...config(dir),
      allowedWriteRoots: [join(rootLink, "write-root")]
    });

    await assert.rejects(() => store.propose("write-file notes.txt replacement", "test"), /symlink/i);
    assert.equal((await store.list("pending")).length, 0);
    await assert.rejects(() => readFile(join(outsideWrite, "notes.txt"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ActionStore refuses to read symlinked action state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-actions-state-symlink-"));
  try {
    const actionDir = join(dir, ".viser", "actions");
    const outside = join(dir, "outside-actions.json");
    await mkdir(actionDir, { recursive: true });
    await writeFile(outside, "[]\n", "utf8");
    await symlink(outside, join(actionDir, "actions.json"));

    const store = new ActionStore(config(dir));

    await assert.rejects(() => store.list(), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function config(dir: string): ActionConfig {
  return {
    enabled: true,
    dir: join(dir, ".viser", "actions"),
    allowedWriteRoots: [dir],
    maxWriteBytes: 1000,
    createBackups: true
  };
}
