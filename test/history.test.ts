import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/core/history.ts";

test("SessionStore lists saved sessions with summaries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-"));
  try {
    const store = new SessionStore(dir);
    await store.append("cli:/project", { role: "user", content: "hello", at: "2026-01-01T00:00:00.000Z", provider: "echo" });
    await store.append("cli:/project", { role: "assistant", content: "world", at: "2026-01-01T00:00:01.000Z", provider: "echo" });
    assert.equal((await stat(join(dir, "sessions"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, "sessions", "cli_project.jsonl"))).mode & 0o777, 0o600);

    const sessions = await store.list();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, "cli_project");
    assert.equal(sessions[0].messageCount, 2);
    assert.deepEqual(sessions[0].providers, ["echo"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore searches messages across sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-search-"));
  try {
    const store = new SessionStore(dir);
    await store.append("one", { role: "user", content: "daily brief about demo-campus", at: "2026-01-01T00:00:00.000Z", provider: "echo" });
    await store.append("two", { role: "assistant", content: "unrelated answer", at: "2026-01-01T00:00:01.000Z", provider: "echo" });

    const results = await store.search("demo-campus", 10);
    assert.equal(results.length, 1);
    assert.equal(results[0].sessionId, "one");
    assert.match(results[0].preview, /demo-campus/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore returns bounded transcripts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-transcript-"));
  try {
    const store = new SessionStore(dir);
    await store.append("chat", { role: "user", content: "first", at: "2026-01-01T00:00:00.000Z" });
    await store.append("chat", { role: "assistant", content: "second", at: "2026-01-01T00:00:01.000Z" });

    const transcript = await store.transcript("chat", 1);
    assert.equal(transcript.length, 1);
    assert.equal(transcript[0].content, "second");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore clear removes only regular session files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-clear-"));
  try {
    const store = new SessionStore(dir);
    await store.append("chat", { role: "user", content: "clear me", at: "2026-01-01T00:00:00.000Z" });

    await store.clear("chat");
    await store.clear("missing");

    assert.equal(await store.count("chat"), 0);
    await assert.rejects(() => readFile(join(dir, "sessions", "chat.jsonl"), "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore refuses to read symlinked session directories and files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-symlink-"));
  try {
    const outsideSessions = join(dir, "outside-sessions");
    await mkdir(join(dir, "storage"), { recursive: true });
    await mkdir(outsideSessions, { recursive: true });
    await writeFile(join(outsideSessions, "chat.jsonl"), "{\"role\":\"user\",\"content\":\"outside\",\"at\":\"2026-01-01T00:00:00.000Z\"}\n", "utf8");
    await symlink(outsideSessions, join(dir, "storage", "sessions"));

    const store = new SessionStore(join(dir, "storage"));

    await assert.rejects(() => store.list(), /symlink/i);
    await assert.rejects(() => store.recent("chat", 10), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore clear refuses symlinked session files without deleting linked files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-clear-symlink-"));
  try {
    const outside = join(dir, "outside-chat.jsonl");
    await mkdir(join(dir, "sessions"));
    await writeFile(outside, "{\"role\":\"user\",\"content\":\"outside\",\"at\":\"2026-01-01T00:00:00.000Z\"}\n", "utf8");
    await symlink(outside, join(dir, "sessions", "chat.jsonl"));

    const store = new SessionStore(dir);

    await assert.rejects(() => store.clear("chat"), /symlink/i);
    assert.match(await readFile(outside, "utf8"), /outside/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SessionStore compact keeps newest messages and writes a private backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-history-compact-"));
  try {
    const store = new SessionStore(dir);
    for (let index = 0; index < 5; index += 1) {
      await store.append("chat", { role: "user", content: `message-${index}`, at: `2026-01-01T00:00:0${index}.000Z` });
    }

    const result = await store.compact("chat", { maxMessages: 2 });
    const transcript = await store.transcript("chat", 10);

    assert.equal(result.beforeCount, 5);
    assert.equal(result.afterCount, 2);
    assert.equal(result.trimmedCount, 3);
    assert.ok(result.backupPath);
    assert.equal(transcript.map((message) => message.content).join(","), "message-3,message-4");
    assert.match(await readFile(result.backupPath!, "utf8"), /message-0/);
    assert.equal((await stat(result.backupPath!)).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "sessions", "chat.jsonl"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
