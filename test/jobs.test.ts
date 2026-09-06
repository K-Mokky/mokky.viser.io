import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  JobRunner,
  JobStore,
  parseJobStatus,
  providerFailureBackoffMs,
  runJobWorkerLoopIteration,
  runQueuedJobs
} from "../src/core/jobs.ts";
import type { AssistantHandleOptions } from "../src/core/types.ts";

test("JobStore enqueues, lists, starts, and finishes jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-"));
  try {
    const store = new JobStore(dir);
    const job = await store.enqueue({ prompt: "summarize this", sessionId: "test:jobs", source: "test" });

    assert.equal(job.status, "pending");
    assert.equal((await store.pending(10)).length, 1);

    const started = await store.start(job.id);
    assert.equal(started?.status, "running");
    assert.equal(started?.attempts, 1);

    await store.finish(job.id, "done");
    const done = (await store.list("done"))[0];
    assert.equal(done.result, "done");
    assert.equal((await stat(join(dir, "jobs.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(join(dir, "events.jsonl"))).mode & 0o777, 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JobStore can cancel pending jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-cancel-"));
  try {
    const store = new JobStore(dir);
    const job = await store.enqueue({ prompt: "later", sessionId: "test:jobs", source: "test" });

    assert.equal(await store.cancel(job.id), true);
    assert.equal((await store.list("cancelled"))[0].id, job.id);
    assert.equal(await store.cancel(job.id), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JobStore removes only terminal jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-remove-terminal-"));
  try {
    const store = new JobStore(dir);
    const pending = await store.enqueue({ prompt: "pending", sessionId: "test:jobs", source: "test" });
    const done = await store.enqueue({ prompt: "done", sessionId: "test:jobs", source: "test" });
    await store.start(done.id);
    await store.finish(done.id, "ok");

    assert.equal(await store.removeTerminal(pending.id), false);
    assert.equal(await store.removeTerminal(done.id), true);
    assert.ok((await store.list()).some((job) => job.id === pending.id));
    assert.ok(!(await store.list()).some((job) => job.id === done.id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JobStore refuses to read symlinked job state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-symlink-"));
  try {
    const jobsDir = join(dir, "jobs");
    const outside = join(dir, "outside-jobs.json");
    await mkdir(jobsDir, { recursive: true });
    await writeFile(outside, "[]\n", "utf8");
    await symlink(outside, join(jobsDir, "jobs.json"));

    const store = new JobStore(jobsDir);

    await assert.rejects(() => store.list(), /symlink/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("parseJobStatus accepts only known statuses", () => {
  assert.equal(parseJobStatus("pending"), "pending");
  assert.equal(parseJobStatus("wat"), undefined);
});

test("runQueuedJobs executes pending jobs through a processor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-run-"));
  try {
    const store = new JobStore(dir);
    const processor = new FakeProcessor("ok");
    await store.enqueue({ prompt: "queued", sessionId: "test:jobs", source: "test" });

    const report = await runQueuedJobs(store, processor, 1);
    assert.equal(report.ran, 1);
    assert.match(report.lines.join("\n"), /done/);
    assert.equal((await store.list("done"))[0].result, "ok:queued");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs can process pending jobs with bounded parallelism", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-parallel-"));
  try {
    const store = new JobStore(dir);
    const processor = new DelayedProcessor(25);
    await store.enqueue({ prompt: "one", sessionId: "test:jobs", source: "test" });
    await store.enqueue({ prompt: "two", sessionId: "test:jobs", source: "test" });
    await store.enqueue({ prompt: "three", sessionId: "test:jobs", source: "test" });

    const report = await runQueuedJobs(store, processor, 3, { concurrency: 2 });

    assert.equal(report.ran, 3);
    assert.match(report.lines[0], /parallelism 2/);
    assert.equal(processor.maxActive, 2);
    assert.deepEqual((await store.list("done")).map((job) => job.result), ["done:one", "done:two", "done:three"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs respects job dependencies and runs newly-ready follow-up jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-dependencies-"));
  try {
    const store = new JobStore(dir);
    const processor = new FakeProcessor("ok");
    const first = await store.enqueue({ prompt: "first", sessionId: "test:jobs", source: "test" });
    const second = await store.enqueue({ prompt: "second", sessionId: "test:jobs", source: "test", dependsOn: [first.id] });

    assert.deepEqual((await store.pending(10)).map((job) => job.id), [first.id]);
    assert.equal(await store.start(second.id), undefined);

    const report = await runQueuedJobs(store, processor, 2, { concurrency: 2 });

    assert.equal(report.ran, 2);
    assert.match(report.lines.join("\n"), /Running 1 job\(s\)/);
    assert.deepEqual((await store.list("done")).map((job) => job.id), [first.id, second.id]);
    assert.equal((await store.list("done"))[1].dependsOn?.[0], first.id);
    assert.equal(processor.inputs[0], "first");
    assert.match(processor.inputs[1], /second/);
    assert.match(processor.inputs[1], /# Completed dependency artifacts/);
    assert.match(processor.inputs[1], new RegExp(`Dependency job ${first.id}`));
    assert.match(processor.inputs[1], /artifact:\nok:first/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs truncates dependency context to the provider input limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-dependency-input-limit-"));
  try {
    const store = new JobStore(dir);
    const first = await store.enqueue({ prompt: "first", sessionId: "test:jobs", source: "test" });
    await store.start(first.id);
    await store.finish(first.id, `${"A".repeat(1000)}TAIL_SHOULD_NOT_FIT`);
    await store.enqueue({ prompt: "second", sessionId: "test:jobs", source: "test", dependsOn: [first.id] });
    const processor = new FakeProcessor("ok");

    const report = await runQueuedJobs(store, processor, 1, { maxInputChars: 260 });

    assert.equal(report.ran, 1);
    assert.equal(processor.inputs.length, 1);
    assert.ok(Array.from(processor.inputs[0]).length <= 260);
    assert.match(processor.inputs[0], /# Completed dependency artifacts/);
    assert.match(processor.inputs[0], /truncated .* job input limit/);
    assert.doesNotMatch(processor.inputs[0], /TAIL_SHOULD_NOT_FIT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs reports dependency-blocked pending jobs as not ready", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-dependency-wait-"));
  try {
    const store = new JobStore(dir);
    await store.enqueue({ prompt: "blocked", sessionId: "test:jobs", source: "test", dependsOn: ["missing-job"] });

    const report = await runQueuedJobs(store, new FakeProcessor("ok"), 1);

    assert.equal(report.ran, 0);
    assert.match(report.lines.join("\n"), /waiting for retry or dependencies/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs explains that a worker may have already processed empty queues", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-empty-hint-"));
  try {
    const store = new JobStore(dir);
    const report = await runQueuedJobs(store, new FakeProcessor("ok"), 1);

    assert.equal(report.ran, 0);
    assert.match(report.lines.join("\n"), /No pending jobs/);
    assert.match(report.lines.join("\n"), /foreground gateway\/job-worker may have already processed queued jobs/);
    assert.match(report.lines.join("\n"), /viser jobs done/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs defers provider failure text without losing pending work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-provider-fail-"));
  try {
    const store = new JobStore(dir);
    const processor = new FakeProcessor("All provider attempts failed.\n- codex: Operation not permitted", { raw: true });
    await store.enqueue({ prompt: "queued", sessionId: "test:jobs", source: "test" });

    const report = await runQueuedJobs(store, processor, 1);
    assert.equal(report.ran, 1);
    assert.match(report.lines.join("\n"), /deferred: provider unavailable/);
    const [pending] = await store.list("pending");
    assert.equal(pending.attempts, 1);
    assert.match(pending.error ?? "", /All provider attempts failed/);
    assert.ok(pending.nextAttemptAt);
    assert.match(await store.formatList("pending"), /last error: All provider attempts failed/);
    assert.match(await store.formatList("pending"), /next attempt:/);
    assert.equal((await store.list("failed")).length, 0);
    assert.equal((await store.list("done")).length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runQueuedJobs applies provider outage backoff before retrying a deferred job", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-provider-backoff-"));
  try {
    const store = new JobStore(dir);
    const processor = new FakeProcessor("All provider attempts failed.\n- codex: Operation not permitted", { raw: true });
    await store.enqueue({ prompt: "queued", sessionId: "test:jobs", source: "test" });

    const first = await runQueuedJobs(store, processor, 1);
    assert.equal(first.ran, 1);
    assert.equal(processor.calls, 1);

    const second = await runQueuedJobs(store, processor, 1);
    assert.equal(second.ran, 0);
    assert.equal(processor.calls, 1);
    assert.match(second.lines.join("\n"), /waiting for retry/);
    assert.match(second.lines.join("\n"), /Next retry:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runJobWorkerLoopIteration suppresses idle no-pending logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-idle-log-"));
  try {
    const lines: string[] = [];
    const errors: string[] = [];
    const store = new JobStore(dir);

    const ran = await runJobWorkerLoopIteration(
      store,
      new FakeProcessor("ok"),
      1,
      (message) => lines.push(message),
      (message) => errors.push(message)
    );

    assert.equal(ran, 0);
    assert.deepEqual(lines, []);
    assert.deepEqual(errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runJobWorkerLoopIteration still logs work results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-active-log-"));
  try {
    const lines: string[] = [];
    const store = new JobStore(dir);
    await store.enqueue({ prompt: "queued", sessionId: "test:jobs", source: "test" });

    const ran = await runJobWorkerLoopIteration(
      store,
      new FakeProcessor("ok"),
      1,
      (message) => lines.push(message)
    );

    assert.equal(ran, 1);
    assert.match(lines.join("\n"), /Running 1 job/);
    assert.match(lines.join("\n"), /done/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("providerFailureBackoffMs grows exponentially and caps", () => {
  assert.equal(providerFailureBackoffMs(0), 60_000);
  assert.equal(providerFailureBackoffMs(1), 60_000);
  assert.equal(providerFailureBackoffMs(2), 120_000);
  assert.equal(providerFailureBackoffMs(3), 240_000);
  assert.equal(providerFailureBackoffMs(99), 3_600_000);
});

test("JobRunner requeues running jobs before loop-less runOnce can process them later", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-requeue-"));
  try {
    const store = new JobStore(dir);
    const job = await store.enqueue({ prompt: "stuck", sessionId: "test:jobs", source: "test" });
    await store.start(job.id);
    assert.equal(await store.requeueRunning(), 1);

    const runner = new JobRunner({ enabled: true, dir, tickMs: 1000, concurrency: 1 }, new FakeProcessor("ok"));
    assert.equal(await runner.runOnce(), 1);
    assert.equal((await store.list("done"))[0].result, "ok:stuck");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("JobRunner runOnce uses configured worker concurrency by default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "viser-jobs-runner-concurrency-"));
  try {
    const store = new JobStore(dir);
    await store.enqueue({ prompt: "one", sessionId: "test:jobs", source: "test" });
    await store.enqueue({ prompt: "two", sessionId: "test:jobs", source: "test" });
    await store.enqueue({ prompt: "three", sessionId: "test:jobs", source: "test" });
    const processor = new DelayedProcessor(25);
    const runner = new JobRunner({ enabled: true, dir, tickMs: 1000, concurrency: 2 }, processor);

    assert.equal(await runner.runOnce(), 2);
    assert.equal(processor.maxActive, 2);
    assert.equal((await store.list("done")).length, 2);
    assert.equal((await store.list("pending")).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runJobWorkerLoopIteration logs storage failures instead of throwing out of the loop", async () => {
  const lines: string[] = [];
  const errors: string[] = [];
  const badStore = {
    async pending(): Promise<never> {
      throw new Error("corrupt jobs state");
    }
  } as unknown as JobStore;

  const ran = await runJobWorkerLoopIteration(
    badStore,
    new FakeProcessor("ok"),
    1,
    (message) => lines.push(message),
    (message) => errors.push(message)
  );

  assert.equal(ran, 0);
  assert.deepEqual(lines, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Job worker tick failed/);
  assert.match(errors[0], /corrupt jobs state/);
});

class FakeProcessor {
  private prefix: string;
  private raw: boolean;
  calls = 0;
  inputs: string[] = [];

  constructor(prefix: string, options: { raw?: boolean } = {}) {
    this.prefix = prefix;
    this.raw = options.raw ?? false;
  }

  async handle(input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
    this.calls += 1;
    this.inputs.push(input);
    if (this.raw) return this.prefix;
    return `${this.prefix}:${input}`;
  }
}

class DelayedProcessor {
  calls = 0;
  active = 0;
  maxActive = 0;
  private delayMs: number;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
  }

  async handle(input: string, _sessionId: string, _options?: AssistantHandleOptions): Promise<string> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.active -= 1;
    return `done:${input}`;
  }
}
