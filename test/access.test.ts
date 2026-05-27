import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccessStore, normalizeCode, parseConnector } from "../src/core/access.ts";
import type { AccessConfig } from "../src/core/types.ts";

test("normalizeCode and parseConnector normalize access inputs", () => {
  assert.equal(normalizeCode(" abcd "), "ABCD");
  assert.equal(parseConnector("telegram"), "telegram");
  assert.equal(parseConnector("slack"), undefined);
});

test("AccessStore pairs a connector id with a one-time code", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-access-"));
  try {
    const store = new AccessStore(config(dir));
    const code = await store.createPairingCode("telegram", "demo-user");
    assert.equal(await store.isAllowed("telegram", "42"), false);
    const peer = await store.pair(code.code.toLowerCase(), "telegram", "42", "@demo-user");
    assert.equal(peer?.id, "42");
    assert.equal(peer?.source, "pair");
    assert.equal(await store.isAllowed("telegram", "42"), true);
    assert.deepEqual(await store.listCodes(), []);
    assert.equal(await store.pair(code.code, "telegram", "99"), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AccessStore prunes expired pairing codes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-access-expired-"));
  try {
    const store = new AccessStore({ ...config(dir), pairingCodeTtlMs: -1 });
    const code = await store.createPairingCode("telegram", "old");

    assert.equal(await store.pair(code.code, "telegram", "42"), undefined);
    assert.deepEqual(await store.listCodes(), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AccessStore supports manual allow and revoke", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-access-manual-"));
  try {
    const store = new AccessStore(config(dir));
    await store.allow("discord", "channel-1", "general");
    assert.equal(await store.isAllowed("discord", "channel-1"), true);
    assert.equal(await store.revoke("discord", "channel-1"), true);
    assert.equal(await store.isAllowed("discord", "channel-1"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AccessStore refuses to read symlinked access state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-access-symlink-"));
  try {
    const accessDir = join(dir, "access");
    const outside = join(dir, "outside-access.json");
    await mkdir(accessDir, { recursive: true });
    await writeFile(outside, "{\"peers\":[],\"codes\":[]}\n", "utf8");
    await symlink(outside, join(accessDir, "access.json"));

    const store = new AccessStore(config(accessDir));

    await assert.rejects(() => store.listPeers(), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("AccessStore open policy allows unknown peers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-access-open-"));
  try {
    const store = new AccessStore({ ...config(dir), defaultPolicy: "open" });
    assert.equal(await store.isAllowed("telegram", "unknown"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function config(dir: string): AccessConfig {
  return {
    enabled: true,
    dir,
    defaultPolicy: "pairing",
    pairingCodeTtlMs: 600_000
  };
}
