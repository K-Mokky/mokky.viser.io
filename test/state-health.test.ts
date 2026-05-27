import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { repairState, stateHealth, stateHealthItems, stateHealthReport } from "../src/cli/state-health.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { ViserConfig } from "../src/core/types.ts";

test("stateHealthItems passes when no persistent state exists yet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-empty-"));
  try {
    const items = await stateHealthItems(stateConfig(dir));

    assert.ok(items.some((item) => item.status === "pass" && item.area === "state"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems detects corrupt JSONL state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-corrupt-jsonl-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.memory.dir, "entries.jsonl", "{\"id\":\"ok\"}\nnot-json\n");

    const items = await stateHealthItems(config);

    assert.ok(items.some((item) => item.status === "fail" && item.area === "memory" && /invalid JSONL/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems detects malformed scheduler, jobs, access, and action entries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-malformed-entries-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.scheduler.dir, "tasks.json", JSON.stringify([{ id: "bad-task", enabled: true }]));
    await writeStateFile(config.jobs.dir, "jobs.json", JSON.stringify([{ id: "bad-job", status: "pending" }]));
    await writeStateFile(config.access.dir, "access.json", JSON.stringify({ peers: [{ connector: "slack", id: "1" }], codes: [] }));
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{ id: "bad-action", type: "delete-file" }]));

    const items = await stateHealthItems(config);

    assert.ok(items.some((item) => item.status === "fail" && item.area === "scheduler" && /scheduled task at index 0/.test(item.message)));
    assert.ok(items.some((item) => item.status === "fail" && item.area === "jobs" && /queued job at index 0/.test(item.message)));
    assert.ok(items.some((item) => item.status === "fail" && item.area === "access" && /access peer at index 0/.test(item.message)));
    assert.ok(items.some((item) => item.status === "fail" && item.area === "actions" && /pending action at index 0/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates calendar event action shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-calendar-action-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "calendar-action",
      type: "calendar-event",
      targetPath: join(config.actions.dir, "calendar", "calendar-action.ics"),
      content: JSON.stringify({ start: "2026-06-01T09:00:00.000Z", durationMinutes: 30, title: "Project check" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "bad-calendar-action",
      type: "calendar-event",
      targetPath: join(config.actions.dir, "calendar", "bad-calendar-action.ics"),
      content: JSON.stringify({ start: "not-a-date", durationMinutes: 30, title: "Project check" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "actions" && /ISO datetime/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates mail draft action shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-mail-draft-action-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "mail-action",
      type: "mail-draft",
      targetPath: "mailto:user@example.com?subject=Hi&body=Body",
      content: JSON.stringify({ to: "user@example.com", subject: "Hi", body: "Body" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "approved-mail-action",
      type: "mail-draft",
      targetPath: "mailto:user@example.com?subject=Hi&body=Body",
      content: "[54 bytes]",
      status: "approved",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: "2026-01-01T00:01:00.000Z"
    }]));

    const approved = await stateHealthItems(config);
    assert.ok(!approved.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "bad-mail-action",
      type: "mail-draft",
      targetPath: "https://example.com/mail",
      content: JSON.stringify({ to: "bad address", subject: "Hi", body: "Body" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "actions" && /mailto URL|email address/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates desktop notification action shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-notify-action-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "notify-action",
      type: "notify",
      targetPath: "local-notification",
      content: JSON.stringify({ title: "Build done", body: "Viser finished checks" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "approved-notify-action",
      type: "notify",
      targetPath: "local-notification",
      content: "[54 bytes]",
      status: "approved",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: "2026-01-01T00:01:00.000Z"
    }]));

    const approved = await stateHealthItems(config);
    assert.ok(!approved.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "bad-notify-action",
      type: "notify",
      targetPath: "local-notification",
      content: JSON.stringify({ title: "", body: "Viser finished checks" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "actions" && /title/i.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates connector message action shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-connector-message-action-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "connector-message-action",
      type: "connector-message",
      targetPath: "telegram:-100123456",
      content: JSON.stringify({ connector: "telegram", targetId: "-100123456", text: "Viser finished checks" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "approved-connector-message-action",
      type: "connector-message",
      targetPath: "telegram:-100123456",
      content: "[84 bytes]",
      status: "approved",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: "2026-01-01T00:01:00.000Z"
    }]));

    const approved = await stateHealthItems(config);
    assert.ok(!approved.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "bad-connector-message-action",
      type: "connector-message",
      targetPath: "telegram:-100123456",
      content: JSON.stringify({ connector: "discord", targetId: "1234567890", text: "Viser finished checks" }),
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "actions" && /targetPath must match/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates clipboard action shape", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-clipboard-action-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "clipboard-action",
      type: "clipboard",
      targetPath: "local-clipboard",
      content: "Viser finished checks",
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "approved-clipboard-action",
      type: "clipboard",
      targetPath: "local-clipboard",
      content: "[22 bytes]",
      status: "approved",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z",
      decidedAt: "2026-01-01T00:01:00.000Z"
    }]));

    const approved = await stateHealthItems(config);
    assert.ok(!approved.some((item) => item.status === "fail" && item.area === "actions"));

    await writeStateFile(config.actions.dir, "actions.json", JSON.stringify([{
      id: "bad-clipboard-action",
      type: "clipboard",
      targetPath: "local-clipboard",
      content: `bad${String.fromCharCode(1)}`,
      status: "pending",
      source: "test",
      createdAt: "2026-01-01T00:00:00.000Z"
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "actions" && /control characters/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems validates queued job dependencies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-job-dependencies-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.jobs.dir, "jobs.json", JSON.stringify([{
      id: "dependent-job",
      prompt: "wait",
      sessionId: "test:jobs",
      source: "test",
      status: "pending",
      attempts: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      dependsOn: ["base-job"]
    }]));

    const valid = await stateHealthItems(config);
    assert.ok(!valid.some((item) => item.status === "fail" && item.area === "jobs"));

    await writeStateFile(config.jobs.dir, "jobs.json", JSON.stringify([{
      id: "bad-dependent-job",
      prompt: "wait",
      sessionId: "test:jobs",
      source: "test",
      status: "pending",
      attempts: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      dependsOn: [""]
    }]));

    const invalid = await stateHealthItems(config);
    assert.ok(invalid.some((item) => item.status === "fail" && item.area === "jobs" && /dependsOn/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair dry-run reports a plan without rewriting files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-repair-dry-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.memory.dir, "entries.jsonl", "{\"id\":\"ok\"}\nnot-json\n");

    const result = await stateHealth(config, { repair: true });
    const raw = await readFile(join(config.memory.dir, "entries.jsonl"), "utf8");

    assert.equal(result.summary.verdict, "BROKEN");
    assert.equal(result.repairs.length, 1);
    assert.equal(result.repairs[0].dryRun, true);
    assert.match(raw, /not-json/);
    assert.match(result.report, /repair mode: dry-run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair force preserves valid JSONL lines and writes a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-repair-force-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.memory.dir, "entries.jsonl", "{\"id\":\"ok\"}\nnot-json\n");

    const result = await stateHealth(config, { repair: true, force: true });
    const repaired = await readFile(join(config.memory.dir, "entries.jsonl"), "utf8");

    assert.equal(result.repairs.length, 1);
    assert.equal(result.repairs[0].dryRun, false);
    assert.equal(repaired, "{\"id\":\"ok\"}\n");
    assert.equal((await stat(result.repairs[0].backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.memory.dir, "entries.jsonl"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair refuses if a planned source becomes a symlink before backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-repair-race-symlink-"));
  try {
    const config = stateConfig(dir);
    const path = await writeStateFile(config.memory.dir, "entries.jsonl", "{\"id\":\"ok\"}\nnot-json\n");
    const items = await stateHealthItems(config);
    const outside = join(dir, "outside-memory.jsonl");
    await writeFile(outside, "outside-secret\n", "utf8");
    await rm(path);
    await symlink(outside, path);

    await assert.rejects(() => repairState(config, items, { dryRun: false }), /symlink/i);
    assert.equal(await readFile(outside, "utf8"), "outside-secret\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair force resets malformed JSON state files and writes backups", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-repair-json-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.jobs.dir, "jobs.json", JSON.stringify([{ id: "bad-job", status: "pending" }]));
    await writeStateFile(config.access.dir, "access.json", JSON.stringify({ peers: [{ connector: "slack", id: "1" }], codes: [] }));

    const result = await stateHealth(config, { repair: true, force: true });
    const repairedJobs = await readFile(join(config.jobs.dir, "jobs.json"), "utf8");
    const repairedAccess = await readFile(join(config.access.dir, "access.json"), "utf8");

    assert.equal(result.repairs.length, 2);
    assert.equal(repairedJobs, "[]\n");
    assert.deepEqual(JSON.parse(repairedAccess), { peers: [], codes: [] });
    for (const repair of result.repairs) await stat(repair.backupPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems warns when private state files are broadly readable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-permissions-"));
  try {
    const config = stateConfig(dir);
    const path = await writeStateFile(config.jobs.dir, "jobs.json", "[]\n");
    await chmod(path, 0o644);

    const items = await stateHealthItems(config);

    assert.ok(items.some((item) => item.area === "jobs" && item.status === "warn" && /group\/world accessible/.test(item.message)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair force compacts oversized session JSONL with a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-session-oversize-"));
  try {
    const config = stateConfig(dir);
    const lines = Array.from({ length: 1005 }, (_, index) => JSON.stringify({
      role: "user",
      content: `message-${index}`,
      at: `2026-01-01T00:00:00.${String(index).padStart(3, "0")}Z`
    }));
    await writeStateFile(join(config.storage.dir, "sessions"), "big.jsonl", `${lines.join("\n")}\n`);

    const warning = (await stateHealthItems(config)).find((item) => item.area === "sessions" && /large session history/.test(item.message));
    assert.equal(warning?.status, "warn");
    assert.ok(warning?.repair);

    const result = await stateHealth(config, { repair: true, force: true });
    const repaired = (await readFile(join(config.storage.dir, "sessions", "big.jsonl"), "utf8")).split("\n").filter(Boolean);

    assert.equal(result.repairs.length, 1);
    assert.equal(repaired.length, 1000);
    assert.doesNotMatch(repaired.join("\n"), /message-0"/);
    assert.match(repaired.join("\n"), /message-1004"/);
    assert.equal((await stat(result.repairs[0].backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.storage.dir, "sessions", "big.jsonl"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems warns when access state retains stale pairing data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-access-stale-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(
      config.access.dir,
      "access.json",
      JSON.stringify({
        peers: [{ connector: "telegram", id: "42", createdAt: "2026-01-01T00:00:00.000Z", source: "pair:ABCDEF12" }],
        codes: [
          { code: "ABCDEF12", connector: "telegram", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:10:00.000Z" },
          {
            code: "FEDCBA98",
            connector: "telegram",
            createdAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2999-01-01T00:10:00.000Z",
            usedAt: "2026-01-01T00:01:00.000Z"
          }
        ]
      })
    );

    const items = await stateHealthItems(config);
    const warning = items.find((item) => item.area === "access" && /stale pairing code data|legacy pair-code/.test(item.message));

    assert.equal(warning?.status, "warn");
    assert.ok(warning?.repair);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair force scrubs stale access pairing data without resetting peers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-access-clean-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(
      config.access.dir,
      "access.json",
      JSON.stringify({
        peers: [{ connector: "telegram", id: "42", createdAt: "2026-01-01T00:00:00.000Z", source: "pair:ABCDEF12" }],
        codes: [
          { code: "ABCDEF12", connector: "telegram", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:10:00.000Z" },
          { code: "1234ABCD", connector: "telegram", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2999-01-01T00:10:00.000Z" }
        ]
      })
    );

    const result = await stateHealth(config, { repair: true, force: true });
    const repaired = JSON.parse(await readFile(join(config.access.dir, "access.json"), "utf8"));

    assert.equal(result.repairs.length, 1);
    assert.equal(result.repairs[0].dryRun, false);
    assert.deepEqual(repaired.peers, [{ connector: "telegram", id: "42", createdAt: "2026-01-01T00:00:00.000Z", source: "pair" }]);
    assert.deepEqual(repaired.codes.map((code: { code: string }) => code.code), ["1234ABCD"]);
    assert.equal((await stat(result.repairs[0].backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.access.dir, "access.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealth repair force redacts decided action content without touching pending actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-actions-clean-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(
      config.actions.dir,
      "actions.json",
      JSON.stringify([
        {
          id: "approved-action",
          type: "write-file",
          targetPath: join(dir, "notes.txt"),
          content: "approved-secret-value",
          status: "approved",
          source: "test",
          createdAt: "2026-01-01T00:00:00.000Z",
          decidedAt: "2026-01-01T00:01:00.000Z"
        },
        {
          id: "pending-action",
          type: "write-file",
          targetPath: join(dir, "pending.txt"),
          content: "pending-content-required-for-approval",
          status: "pending",
          source: "test",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ])
    );

    const warning = (await stateHealthItems(config)).find((item) => item.area === "actions" && /decided action content/.test(item.message));
    assert.equal(warning?.status, "warn");

    const result = await stateHealth(config, { repair: true, force: true });
    const repaired = JSON.parse(await readFile(join(config.actions.dir, "actions.json"), "utf8")) as Array<{ id: string; content: string }>;

    assert.equal(result.repairs.length, 1);
    assert.equal(repaired.find((action) => action.id === "approved-action")?.content, "[21 bytes]");
    assert.equal(repaired.find((action) => action.id === "pending-action")?.content, "pending-content-required-for-approval");
    assert.equal((await stat(result.repairs[0].backupPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(config.actions.dir, "actions.json"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses symlinked state files without repair plans", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-symlink-"));
  try {
    const config = stateConfig(dir);
    const outside = join(dir, "outside-jobs.json");
    await writeFile(outside, "[]\n", "utf8");
    await mkdir(config.jobs.dir, { recursive: true });
    await symlink(outside, join(config.jobs.dir, "jobs.json"));

    const items = await stateHealthItems(config);
    const symlinkItem = items.find((item) => item.area === "jobs" && /symlink/.test(item.message));

    assert.equal(symlinkItem?.status, "fail");
    assert.equal(symlinkItem?.repair, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses a symlinked session directory without reading outside sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-session-dir-symlink-"));
  try {
    const config = stateConfig(dir);
    const outsideSessions = join(dir, "outside-sessions");
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(outsideSessions, { recursive: true });
    await writeFile(join(outsideSessions, "chat.jsonl"), "{\"role\":\"user\",\"content\":\"outside\"}\n", "utf8");
    await symlink(outsideSessions, join(config.storage.dir, "sessions"));

    const items = await stateHealthItems(config);
    const symlinkItem = items.find((item) => item.area === "sessions" && /state directory is a symlink/.test(item.message));

    assert.equal(symlinkItem?.status, "fail");
    assert.equal(symlinkItem?.repair, undefined);
    assert.equal(items.some((item) => item.path.endsWith("chat.jsonl")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses a symlinked storage root before checking state files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-root-symlink-"));
  try {
    const config = stateConfig(dir);
    const outsideStorage = join(dir, "outside-storage");
    await mkdir(outsideStorage, { recursive: true });
    await writeFile(join(outsideStorage, "jobs.json"), "[]\n", "utf8");
    await symlink(outsideStorage, config.storage.dir);

    const items = await stateHealthItems(config);

    assert.equal(items.length, 1);
    assert.equal(items[0].area, "state");
    assert.equal(items[0].status, "fail");
    assert.match(items[0].message, /storage directory is a symlink/);
    assert.equal(items[0].repair, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses storage roots reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-root-parent-symlink-"));
  try {
    const outsideParent = join(dir, "outside-parent");
    const linkParent = join(dir, "link-parent");
    await mkdir(join(outsideParent, ".viser", "sessions"), { recursive: true });
    await writeFile(join(outsideParent, ".viser", "sessions", "chat.jsonl"), "{\"role\":\"user\",\"content\":\"outside\"}\n", "utf8");
    await symlink(outsideParent, linkParent);

    const config = stateConfig(dir);
    const linkedStorage = join(linkParent, ".viser");
    const linkedConfig: ViserConfig = {
      ...config,
      storage: { dir: linkedStorage },
      memory: { ...config.memory, dir: join(linkedStorage, "memory") },
      scheduler: { ...config.scheduler, dir: join(linkedStorage, "scheduler") },
      jobs: { ...config.jobs, dir: join(linkedStorage, "jobs") },
      access: { ...config.access, dir: join(linkedStorage, "access") },
      actions: { ...config.actions, dir: join(linkedStorage, "actions") }
    };

    const items = await stateHealthItems(linkedConfig);

    assert.equal(items.length, 1);
    assert.equal(items[0].area, "state");
    assert.equal(items[0].status, "fail");
    assert.match(items[0].message, /symlink component/i);
    assert.equal(items.some((item) => item.path.endsWith("chat.jsonl")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses state directories reached through symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-dir-parent-symlink-"));
  try {
    const config = stateConfig(dir);
    const outsideParent = join(dir, "outside-parent");
    const linkParent = join(config.storage.dir, "link-parent");
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(join(outsideParent, "memory"), { recursive: true });
    await writeFile(join(outsideParent, "memory", "entries.jsonl"), "{\"text\":\"outside\"}\n", "utf8");
    await symlink(outsideParent, linkParent);

    const linkedConfig: ViserConfig = {
      ...config,
      memory: { ...config.memory, dir: join(linkParent, "memory") }
    };

    const items = await stateHealthItems(linkedConfig);
    const symlinkItem = items.find((item) => item.area === "memory" && /symlink component/i.test(item.message));

    assert.equal(symlinkItem?.status, "fail");
    assert.equal(symlinkItem?.repair, undefined);
    assert.equal(items.some((item) => item.path.endsWith("entries.jsonl")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthItems refuses missing state directories under symlinked parents", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-missing-dir-parent-symlink-"));
  try {
    const config = stateConfig(dir);
    const outsideParent = join(dir, "outside-parent");
    const linkParent = join(config.storage.dir, "link-parent");
    await mkdir(config.storage.dir, { recursive: true });
    await mkdir(outsideParent, { recursive: true });
    await symlink(outsideParent, linkParent);

    const linkedConfig: ViserConfig = {
      ...config,
      memory: { ...config.memory, dir: join(linkParent, "missing-memory") }
    };

    const items = await stateHealthItems(linkedConfig);
    const symlinkItem = items.find((item) => item.area === "memory" && /symlink component/i.test(item.message));

    assert.equal(symlinkItem?.status, "fail");
    assert.equal(symlinkItem?.repair, undefined);
    assert.equal(items.some((item) => item.message === "no persistent state files yet"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stateHealthReport summarizes healthy state files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-state-report-"));
  try {
    const config = stateConfig(dir);
    await writeStateFile(config.jobs.dir, "jobs.json", "[]\n");
    const report = await stateHealthReport(config);

    assert.match(report, /Viser state: HEALTHY/);
    assert.match(report, /\[jobs]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function writeStateFile(dir: string, name: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

function stateConfig(dir: string): ViserConfig {
  return {
    ...DEFAULT_CONFIG,
    assistant: { ...DEFAULT_CONFIG.assistant, workdir: dir },
    storage: { dir: join(dir, ".viser") },
    memory: { ...DEFAULT_CONFIG.memory, dir: join(dir, ".viser", "memory") },
    skills: { ...DEFAULT_CONFIG.skills, dirs: [join(dir, "skills"), join(dir, ".viser", "skills")] },
    tools: { ...DEFAULT_CONFIG.tools, allowedReadRoots: [dir] },
    scheduler: { ...DEFAULT_CONFIG.scheduler, dir: join(dir, ".viser", "scheduler") },
    jobs: { ...DEFAULT_CONFIG.jobs, dir: join(dir, ".viser", "jobs") },
    access: { ...DEFAULT_CONFIG.access, dir: join(dir, ".viser", "access") },
    actions: { ...DEFAULT_CONFIG.actions, dir: join(dir, ".viser", "actions"), allowedWriteRoots: [dir] },
    connectors: {
      telegram: { ...DEFAULT_CONFIG.connectors.telegram, allowedChatIds: [], defaultChatIds: [] },
      discord: { ...DEFAULT_CONFIG.connectors.discord, allowedChannelIds: [], defaultChannelIds: [] }
    }
  };
}
