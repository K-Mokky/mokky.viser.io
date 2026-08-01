import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TodoStore } from "../src/core/todos.ts";
import { formatReminderOutput, parseRemindInput } from "../src/core/scheduler.ts";

async function withStore(run: (store: TodoStore) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "viser-todos-"));
  try {
    await run(new TodoStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("TodoStore adds, completes, and removes items", async () => {
  await withStore(async (store) => {
    const item = await store.add("buy milk", "test");
    assert.equal(item.done, false);

    const done = await store.markDone(item.id);
    assert.equal(done?.done, true);
    assert.ok(done?.doneAt);

    assert.equal(await store.markDone(item.id), undefined);
    assert.equal(await store.clearDone(), 1);
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.remove("missing"), false);
  });
});

test("TodoStore rejects empty text and formats lists", async () => {
  await withStore(async (store) => {
    await assert.rejects(() => store.add("   ", "test"));
    assert.match(await store.formatList(), /empty/);

    const item = await store.add("write report", "test");
    const listed = await store.formatList();
    assert.match(listed, /\[ \] \[.+\] write report/);

    await store.markDone(item.id);
    assert.match(await store.formatList(), /\[x\]/);
  });
});

test("parseRemindInput builds one-shot reminders with connector delivery", () => {
  const task = parseRemindInput("10m drink water", { sessionId: "telegram:42", source: "telegram" });
  assert.equal(task.kind, "reminder");
  assert.equal(task.prompt, "drink water");
  assert.equal(task.intervalMs, undefined);
  assert.deepEqual(task.delivery, { kind: "telegram", targetId: "42" });
  assert.ok(task.nextRunAt && new Date(task.nextRunAt) > new Date());
});

test("parseRemindInput supports every and at modes", () => {
  const recurring = parseRemindInput("every 1h stretch", { sessionId: "cli", source: "cli" });
  assert.equal(recurring.intervalMs, 3_600_000);
  assert.equal(recurring.prompt, "stretch");

  const future = new Date(Date.now() + 3_600_000).toISOString();
  const timed = parseRemindInput(`at ${future} meeting`, { sessionId: "cli", source: "cli" });
  assert.equal(timed.nextRunAt, future);
  assert.equal(timed.prompt, "meeting");
});

test("parseRemindInput rejects bad input", () => {
  assert.throws(() => parseRemindInput("", { sessionId: "cli", source: "cli" }));
  assert.throws(() => parseRemindInput("10m", { sessionId: "cli", source: "cli" }));
  assert.throws(() => parseRemindInput("every 30s too fast", { sessionId: "cli", source: "cli" }));
  assert.throws(() => parseRemindInput("at 2000-01-01T00:00:00Z past", { sessionId: "cli", source: "cli" }));
  assert.throws(() => parseRemindInput("soon text", { sessionId: "cli", source: "cli" }));
});

test("formatReminderOutput prefixes the reminder text", () => {
  assert.equal(formatReminderOutput("drink water"), "⏰ Reminder: drink water");
});
