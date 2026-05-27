import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore, parseMemoryInput } from "../src/core/memory.ts";
import type { MemoryEntry } from "../src/core/types.ts";

test("parseMemoryInput extracts hashtags but preserves text", () => {
  assert.deepEqual(parseMemoryInput("Use TypeScript first #preference #code"), {
    text: "Use TypeScript first",
    tags: ["preference", "code"]
  });
});

test("MemoryStore adds, searches, and removes entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-"));
  try {
    const store = new MemoryStore(dir);
    const entry = await store.add("User prefers TypeScript-first architecture", { tags: ["preference"], source: "test" });
    assert.equal(await store.count(), 1);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(join(dir, "entries.jsonl"))).mode & 0o777, 0o600);
    assert.equal((await store.search("TypeScript", 10))[0].id, entry.id);
    assert.equal(await store.remove(entry.id), true);
    assert.equal(await store.count(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore search boosts exact tag matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-search-"));
  try {
    const store = new MemoryStore(dir);
    const tagged = await store.add("Use polite Korean responses", { tags: ["style"], source: "test" });
    await store.add("General project preference notes", { tags: ["project"], source: "test" });
    assert.equal((await store.search("#style", 10))[0].id, tagged.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore search uses local lexical vectors for fuzzy recall", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-vector-"));
  try {
    const store = new MemoryStore(dir);
    const target = await store.add("User prefers TypeScript-first architecture decisions", { tags: ["preference"], source: "test" });
    await store.add("Prefer concise Korean responses", { tags: ["style"], source: "test" });

    const results = await store.search("typscript", 10);

    assert.equal(results[0].id, target.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore refuses to read symlinked memory state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-symlink-"));
  try {
    const outside = join(dir, "outside-memory.jsonl");
    await mkdir(join(dir, "memory"), { recursive: true });
    await writeFile(outside, `${JSON.stringify(memory("leak", "outside secret", [], "2026-01-01T00:00:00.000Z"))}\n`, "utf8");
    await symlink(outside, join(dir, "memory", "entries.jsonl"));

    const store = new MemoryStore(join(dir, "memory"));

    await assert.rejects(() => store.list(), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore compact dedupes normalized text and writes a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-compact-"));
  try {
    await writeEntries(dir, [
      memory("old", "Use TypeScript first", ["old"], "2026-01-01T00:00:00.000Z"),
      memory("new", "use   typescript first", ["new"], "2026-01-02T00:00:00.000Z"),
      memory("keep", "Keep this", ["keep"], "2026-01-03T00:00:00.000Z")
    ]);
    const store = new MemoryStore(dir);
    const result = await store.compact();

    assert.equal(result.beforeCount, 3);
    assert.equal(result.afterCount, 2);
    assert.equal(result.duplicateCount, 1);
    assert.ok(result.backupPath?.endsWith(".bak.jsonl"));
    assert.equal(await store.count(), 2);
    const deduped = (await store.search("typescript", 10))[0];
    assert.equal(deduped.id, "new");
    assert.deepEqual(deduped.tags, ["new", "old"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore compact can keep only the newest entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-trim-"));
  try {
    await writeEntries(dir, [
      memory("one", "One", [], "2026-01-01T00:00:00.000Z"),
      memory("two", "Two", [], "2026-01-02T00:00:00.000Z"),
      memory("three", "Three", [], "2026-01-03T00:00:00.000Z")
    ]);
    const store = new MemoryStore(dir);
    const result = await store.compact({ maxEntries: 2 });

    assert.equal(result.afterCount, 2);
    assert.equal(result.trimmedCount, 1);
    assert.deepEqual((await store.list(10)).map((entry) => entry.id), ["two", "three"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore profile groups tagged memories and keeps recent untagged facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-profile-"));
  try {
    await writeEntries(dir, [
      memory("style-old", "Use Korean haeyo style", ["style"], "2026-01-01T00:00:00.000Z"),
      memory("style-new", "Prefer concise answers", ["style", "preference"], "2026-01-03T00:00:00.000Z"),
      memory("untagged", "User uses Viser locally", [], "2026-01-04T00:00:00.000Z")
    ]);
    const store = new MemoryStore(dir);
    const profile = await store.profile({ tagLimit: 5, itemLimitPerTag: 2, untaggedLimit: 1 });

    assert.equal(profile.totalCount, 3);
    assert.equal(profile.groups[0].tag, "style");
    assert.equal(profile.groups[0].count, 2);
    assert.deepEqual(profile.groups[0].entries.map((entry) => entry.id), ["style-new", "style-old"]);
    assert.equal(profile.untagged[0].id, "untagged");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MemoryStore formats a compact profile for prompts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-memory-profile-prompt-"));
  try {
    const store = new MemoryStore(dir);
    await store.add("User prefers Korean haeyo style", { tags: ["style"], source: "test" });
    const text = await store.formatProfileForPrompt({ tagLimit: 1, itemLimitPerTag: 1 });

    assert.match(text, /total_memories: 1/);
    assert.match(text, /#style/);
    assert.match(text, /Korean haeyo/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeEntries(dir: string, entries: MemoryEntry[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "entries.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
}

function memory(id: string, text: string, tags: string[], createdAt: string): MemoryEntry {
  return { id, text, tags, source: "test", createdAt };
}
