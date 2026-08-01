import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TodoStore } from "../src/core/todos.ts";
import { formatReminderOutput, parseNaturalReminder, parseRemindInput } from "../src/core/scheduler.ts";
import { TelegramOffsetStore } from "../src/connectors/telegram.ts";

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

test("parseNaturalReminder detects Korean and English reminder phrases", () => {
  assert.deepEqual(parseNaturalReminder("10분 뒤에 물 마시라고 알려줘"), { delayMs: 600_000, text: "물 마시" });
  assert.deepEqual(parseNaturalReminder("2시간 후 회의 알려줘"), { delayMs: 7_200_000, text: "회의" });
  assert.deepEqual(parseNaturalReminder("remind me in 10 minutes to drink water"), { delayMs: 600_000, text: "drink water" });
  assert.deepEqual(parseNaturalReminder("Remind me in 2h about the meeting"), { delayMs: 7_200_000, text: "the meeting" });
});

test("parseNaturalReminder leaves ordinary messages alone", () => {
  assert.equal(parseNaturalReminder("what is the capital of France?"), undefined);
  assert.equal(parseNaturalReminder("10분 뒤에 뭐 하지"), undefined);
  assert.equal(parseNaturalReminder("remind me why this failed"), undefined);
  assert.equal(parseNaturalReminder(""), undefined);
});

test("TelegramOffsetStore persists and validates offsets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-tg-offset-"));
  try {
    const store = new TelegramOffsetStore(dir);
    assert.equal(await store.read(), undefined);
    await store.write(42);
    assert.equal(await store.read(), 42);

    const fresh = new TelegramOffsetStore(dir);
    assert.equal(await fresh.read(), 42);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
