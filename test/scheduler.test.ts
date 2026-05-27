import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  deliveryForSession,
  parseDurationMs,
  parseScheduleInput,
  runSchedulerLoopIteration,
  scheduleFailureBackoffMs,
  ScheduleStore,
  SchedulerRunner
} from "../src/core/scheduler.ts";
import type { AssistantHandleOptions, ScheduledTask } from "../src/core/types.ts";

class FakeAssistant {
  calls: Array<{ prompt: string; sessionId: string; options: AssistantHandleOptions }> = [];
  private response: string | undefined;

  constructor(response?: string) {
    this.response = response;
  }

  async handle(prompt: string, sessionId: string, options: AssistantHandleOptions): Promise<string> {
    this.calls.push({ prompt, sessionId, options });
    if (this.response) return this.response;
    return `ran:${prompt}`;
  }
}

test("parseDurationMs parses supported duration units", () => {
  assert.equal(parseDurationMs("1m"), 60_000);
  assert.equal(parseDurationMs("2h"), 7_200_000);
});

test("parseScheduleInput derives delivery from session", () => {
  const task = parseScheduleInput("every 5m daily brief", { sessionId: "telegram:42", source: "telegram" });
  assert.equal(task.intervalMs, 300_000);
  assert.equal(task.delivery.kind, "telegram");
  assert.equal(task.delivery.targetId, "42");
});

test("deliveryForSession falls back to console", () => {
  assert.deepEqual(deliveryForSession("cli:/tmp"), { kind: "console" });
});

test("ScheduleStore stores and removes tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-schedules-"));
  try {
    const store = new ScheduleStore(dir);
    const task = await store.add(exampleTask());
    assert.equal((await store.list()).length, 1);
    assert.equal(await store.remove(task.id), true);
    assert.equal((await store.list()).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ScheduleStore refuses to read symlinked scheduler state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-schedules-symlink-"));
  try {
    const schedulerDir = join(dir, "scheduler");
    const outside = join(dir, "outside-tasks.json");
    await mkdir(schedulerDir, { recursive: true });
    await writeFile(outside, "[]\n", "utf8");
    await symlink(outside, join(schedulerDir, "tasks.json"));

    const store = new ScheduleStore(schedulerDir);

    await assert.rejects(() => store.list(), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SchedulerRunner executes due tasks and disables one-time tasks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-run-"));
  try {
    const store = new ScheduleStore(dir);
    const task = await store.add({ ...exampleTask(), nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const assistant = new FakeAssistant();
    const delivered: string[] = [];
    const runner = new SchedulerRunner(
      { enabled: true, dir, tickMs: 1000 },
      assistant as any,
      async (_task: ScheduledTask, output: string) => {
        delivered.push(output);
      }
    );

    assert.equal(await runner.runOnce(), 1);
    const [stored] = await store.list();
    assert.equal(stored.id, task.id);
    assert.equal(stored.enabled, false);
    assert.equal(stored.runCount, 1);
    assert.deepEqual(delivered, ["ran:scheduled hello"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SchedulerRunner stores bounded run log output while delivering full output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-log-bound-"));
  try {
    const store = new ScheduleStore(dir);
    await store.add({ ...exampleTask(), nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const longOutput = `${"x".repeat(5000)}FULL_TAIL`;
    const assistant = new FakeAssistant(longOutput);
    const delivered: string[] = [];
    const runner = new SchedulerRunner(
      { enabled: true, dir, tickMs: 1000 },
      assistant as any,
      async (_task: ScheduledTask, output: string) => {
        delivered.push(output);
      }
    );

    assert.equal(await runner.runOnce(), 1);
    assert.deepEqual(delivered, [longOutput]);

    const raw = await readFile(join(dir, "runs.jsonl"), "utf8");
    const entry = JSON.parse(raw.trim()) as { output: string };
    assert.equal(entry.output.includes("FULL_TAIL"), false);
    assert.match(entry.output, /truncated scheduler run output at 4000 chars/);
    assert.equal(entry.output.length < longOutput.length, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SchedulerRunner retries one-time tasks after provider failure without delivery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-provider-fail-"));
  try {
    const store = new ScheduleStore(dir);
    const task = await store.add({ ...exampleTask(), nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const assistant = new FakeAssistant("All provider attempts failed.\n- codex: Operation not permitted");
    const delivered: string[] = [];
    const before = Date.now();
    const runner = new SchedulerRunner(
      { enabled: true, dir, tickMs: 1000 },
      assistant as any,
      async (_task: ScheduledTask, output: string) => {
        delivered.push(output);
      }
    );

    assert.equal(await runner.runOnce(), 1);
    const [stored] = await store.list();
    assert.equal(stored.id, task.id);
    assert.equal(stored.enabled, true);
    assert.equal(stored.runCount, 1);
    assert.match(stored.lastError ?? "", /All provider attempts failed/);
    assert.ok(stored.nextRunAt);
    assert.ok(new Date(stored.nextRunAt).getTime() >= before + 59_000);
    assert.match(await store.formatList(), /last error: All provider attempts failed/);
    assert.deepEqual(delivered, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SchedulerRunner retries one-time tasks after delivery failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-delivery-fail-"));
  try {
    const store = new ScheduleStore(dir);
    await store.add({ ...exampleTask(), nextRunAt: new Date(Date.now() - 1000).toISOString() });
    const assistant = new FakeAssistant();
    const before = Date.now();
    const runner = new SchedulerRunner(
      { enabled: true, dir, tickMs: 1000 },
      assistant as any,
      async () => {
        throw new Error("delivery unavailable");
      }
    );

    assert.equal(await runner.runOnce(), 1);
    const [stored] = await store.list();
    assert.equal(stored.enabled, true);
    assert.equal(stored.runCount, 1);
    assert.match(stored.lastError ?? "", /delivery unavailable/);
    assert.ok(stored.nextRunAt);
    assert.ok(new Date(stored.nextRunAt).getTime() >= before + 59_000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SchedulerRunner preserves recurring tasks and schedules next run after provider failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-scheduler-recurring-provider-fail-"));
  try {
    const store = new ScheduleStore(dir);
    await store.add({
      ...exampleTask(),
      intervalMs: 60_000,
      nextRunAt: new Date(Date.now() - 1000).toISOString()
    });
    const assistant = new FakeAssistant("All provider attempts failed.\n- gemini: login required");
    const delivered: string[] = [];
    const before = Date.now();
    const runner = new SchedulerRunner(
      { enabled: true, dir, tickMs: 1000 },
      assistant as any,
      async (_task: ScheduledTask, output: string) => {
        delivered.push(output);
      }
    );

    assert.equal(await runner.runOnce(), 1);
    const [stored] = await store.list();
    assert.equal(stored.enabled, true);
    assert.equal(stored.runCount, 1);
    assert.match(stored.lastError ?? "", /All provider attempts failed/);
    assert.ok(stored.nextRunAt);
    assert.ok(new Date(stored.nextRunAt).getTime() >= before + 59_000);
    assert.deepEqual(delivered, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSchedulerLoopIteration logs tick failures instead of throwing out of the loop", async () => {
  const errors: string[] = [];
  const ran = await runSchedulerLoopIteration(
    async () => {
      throw new Error("corrupt scheduler state");
    },
    (message) => errors.push(message)
  );

  assert.equal(ran, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Scheduler tick failed/);
  assert.match(errors[0], /corrupt scheduler state/);
});

test("scheduleFailureBackoffMs grows exponentially and caps", () => {
  assert.equal(scheduleFailureBackoffMs(0), 60_000);
  assert.equal(scheduleFailureBackoffMs(1), 60_000);
  assert.equal(scheduleFailureBackoffMs(2), 120_000);
  assert.equal(scheduleFailureBackoffMs(3), 240_000);
  assert.equal(scheduleFailureBackoffMs(99), 3_600_000);
});

function exampleTask(): Omit<ScheduledTask, "id" | "createdAt" | "runCount"> {
  return {
    prompt: "scheduled hello",
    sessionId: "cli:test",
    source: "test",
    enabled: true,
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    delivery: { kind: "console" }
  };
}
