// ================================================================
// Durable one-off job queue
// ================================================================
// Scheduler handles time-based automation. Jobs are manual one-off work items:
// enqueue now, run later, preserve status/result for inspection. This is the
// local-first foundation for future worker/subagent lanes.
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPrivateFile, ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.js";
import { nowIso } from "../utils/text.js";
import { isProviderFailureOutput } from "./provider-output.js";
const PROVIDER_FAILURE_BASE_BACKOFF_MS = 60_000;
const PROVIDER_FAILURE_MAX_BACKOFF_MS = 60 * 60_000;
export const MAX_JOB_CONCURRENCY = 6;
export class JobStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async enqueue(input) {
        const prompt = input.prompt.trim();
        if (!prompt)
            throw new Error("Job prompt is required.");
        const dependsOn = normalizeJobDependencies(input.dependsOn);
        const jobs = await this.list();
        const job = {
            id: randomUUID().slice(0, 12),
            prompt,
            sessionId: input.sessionId,
            source: input.source,
            providerId: input.providerId,
            ...(dependsOn.length ? { dependsOn } : {}),
            status: "pending",
            attempts: 0,
            createdAt: nowIso()
        };
        jobs.push(job);
        await this.writeAll(jobs);
        await this.appendEvent("enqueued", job);
        return job;
    }
    async list(status) {
        const path = this.jobsPath();
        const raw = await readPrivateFileIfExists(path, { dirs: [this.dir] });
        if (raw === undefined)
            return [];
        const jobs = JSON.parse(raw);
        return status ? jobs.filter((job) => job.status === status) : jobs;
    }
    async pending(limit = 1, now = new Date()) {
        const max = Math.max(1, Math.floor(limit));
        const jobs = await this.list();
        const doneIds = new Set(jobs.filter((job) => job.status === "done").map((job) => job.id));
        return jobs
            .filter((job) => job.status === "pending")
            .filter((job) => !job.nextAttemptAt || new Date(job.nextAttemptAt) <= now)
            .filter((job) => dependenciesSatisfied(job, doneIds))
            .sort((a, b) => (a.nextAttemptAt ?? a.createdAt).localeCompare(b.nextAttemptAt ?? b.createdAt))
            .slice(0, max);
    }
    async cancel(id) {
        const jobs = await this.list();
        const job = jobs.find((item) => item.id === id);
        if (!job || job.status === "done" || job.status === "failed" || job.status === "cancelled")
            return false;
        job.status = "cancelled";
        job.finishedAt = nowIso();
        await this.writeAll(jobs);
        await this.appendEvent("cancelled", job);
        return true;
    }
    async removeTerminal(id) {
        const jobs = await this.list();
        const index = jobs.findIndex((item) => item.id === id);
        const job = index >= 0 ? jobs[index] : undefined;
        if (!job || !["done", "failed", "cancelled"].includes(job.status))
            return false;
        jobs.splice(index, 1);
        await this.writeAll(jobs);
        await this.appendEvent("removed", job);
        return true;
    }
    async requeueRunning() {
        const jobs = await this.list();
        let count = 0;
        for (const job of jobs) {
            if (job.status !== "running")
                continue;
            job.status = "pending";
            job.startedAt = undefined;
            job.nextAttemptAt = undefined;
            job.error = "Requeued after worker restart.";
            count += 1;
        }
        if (count === 0)
            return 0;
        await this.writeAll(jobs);
        await this.appendEvent("requeued-running", { id: "batch", status: "pending" });
        return count;
    }
    async start(id, now = new Date()) {
        const jobs = await this.list();
        const job = jobs.find((item) => item.id === id);
        if (!job || job.status !== "pending")
            return undefined;
        if (job.nextAttemptAt && new Date(job.nextAttemptAt) > now)
            return undefined;
        const doneIds = new Set(jobs.filter((item) => item.status === "done").map((item) => item.id));
        if (!dependenciesSatisfied(job, doneIds))
            return undefined;
        job.status = "running";
        job.startedAt = nowIso();
        job.finishedAt = undefined;
        job.nextAttemptAt = undefined;
        job.result = undefined;
        job.error = undefined;
        job.attempts += 1;
        await this.writeAll(jobs);
        await this.appendEvent("started", job);
        return job;
    }
    async finish(id, result) {
        await this.complete(id, { status: "done", result });
    }
    async fail(id, error) {
        await this.complete(id, { status: "failed", error });
    }
    async defer(id, error, now = new Date()) {
        const jobs = await this.list();
        const job = jobs.find((item) => item.id === id);
        if (!job)
            return;
        job.status = "pending";
        job.startedAt = undefined;
        job.finishedAt = undefined;
        job.result = undefined;
        job.error = error;
        job.nextAttemptAt = new Date(now.getTime() + providerFailureBackoffMs(job.attempts)).toISOString();
        await this.writeAll(jobs);
        await this.appendEvent("deferred", job);
    }
    async dependencyContext(ids, maxArtifactChars = 4_000) {
        const jobs = await this.list();
        const byId = new Map(jobs.map((job) => [job.id, job]));
        const sections = ids.map((id) => {
            const job = byId.get(id);
            if (!job)
                return [`## Dependency job ${id}`, "status: missing"].join("\n");
            const artifact = truncateText(job.result ?? job.error ?? "(no result)", maxArtifactChars);
            return [
                `## Dependency job ${job.id}`,
                `status: ${job.status}`,
                `session: ${job.sessionId}`,
                `provider: ${job.providerId ?? "default/fallback"}`,
                `created: ${job.createdAt}`,
                job.finishedAt ? `finished: ${job.finishedAt}` : undefined,
                `prompt preview: ${truncateSingleLine(job.prompt, 300)}`,
                "",
                "artifact:",
                artifact
            ].filter(Boolean).join("\n");
        });
        return ["# Completed dependency artifacts", ...sections].join("\n\n");
    }
    async formatList(status) {
        const jobs = await this.list(status);
        if (jobs.length === 0)
            return status ? `No ${status} jobs.` : "No jobs yet.";
        return jobs
            .map((job) => {
            const preview = (job.result ?? job.error ?? job.prompt).replace(/\s+/g, " ").slice(0, 160);
            const lastError = job.status === "pending" && job.error
                ? job.error.replace(/\s+/g, " ").slice(0, 160)
                : undefined;
            return [
                `- [${job.id}] ${job.status} attempts=${job.attempts}`,
                `  session: ${job.sessionId}`,
                `  provider: ${job.providerId ?? "default/fallback"}`,
                job.dependsOn?.length ? `  depends on: ${job.dependsOn.join(", ")}` : undefined,
                `  created: ${job.createdAt}`,
                job.nextAttemptAt ? `  next attempt: ${job.nextAttemptAt}` : undefined,
                `  prompt: ${job.prompt}`,
                lastError ? `  last error: ${lastError}${lastError.length >= 160 ? "…" : ""}` : undefined,
                job.status === "pending" ? undefined : `  preview: ${preview}${preview.length >= 160 ? "…" : ""}`
            ].filter(Boolean).join("\n");
        })
            .join("\n");
    }
    async complete(id, patch) {
        const jobs = await this.list();
        const job = jobs.find((item) => item.id === id);
        if (!job)
            return;
        job.status = patch.status;
        job.finishedAt = nowIso();
        job.result = patch.result;
        job.error = patch.error;
        await this.writeAll(jobs);
        await this.appendEvent(patch.status, job);
    }
    async writeAll(jobs) {
        await ensurePrivateDir(this.dir);
        await writePrivateFile(this.jobsPath(), `${JSON.stringify(jobs, null, 2)}\n`);
    }
    async appendEvent(event, job) {
        await ensurePrivateDir(this.dir);
        await appendPrivateFile(join(this.dir, "events.jsonl"), `${JSON.stringify({ at: nowIso(), event, jobId: job.id, status: job.status })}\n`);
    }
    jobsPath() {
        return join(this.dir, "jobs.json");
    }
}
export class JobRunner {
    store;
    config;
    processor;
    options;
    constructor(config, processor, options = {}) {
        this.config = config;
        this.store = new JobStore(config.dir);
        this.processor = processor;
        this.options = options;
    }
    async runOnce(limit = this.config.concurrency, options = {}) {
        const concurrency = options.concurrency ?? this.config.concurrency;
        const report = await runQueuedJobs(this.store, this.processor, limit, { ...this.options, ...options, concurrency });
        return report.ran;
    }
    async loop() {
        if (!this.config.enabled) {
            console.log("Job queue is disabled in config.");
            return;
        }
        try {
            const requeued = await this.store.requeueRunning();
            if (requeued > 0)
                console.log(`Requeued ${requeued} running job(s) from a previous worker session.`);
        }
        catch (error) {
            console.error(`Job worker startup recovery failed; continuing to retry on ticks: ${errorMessage(error)}`);
        }
        let stopped = false;
        process.once("SIGINT", () => {
            stopped = true;
        });
        process.once("SIGTERM", () => {
            stopped = true;
        });
        const concurrency = normalizeConcurrency(this.config.concurrency, MAX_JOB_CONCURRENCY);
        console.log(`Viser job worker is running. tick=${this.config.tickMs}ms parallelism=${concurrency}. Press Ctrl+C to stop.`);
        while (!stopped) {
            await runJobWorkerLoopIteration(this.store, this.processor, concurrency, console.log, console.error, { ...this.options, concurrency });
            await delay(this.config.tickMs);
        }
    }
}
export async function runJobWorkerLoopIteration(store, processor, limit = 1, logLine = console.log, logError = console.error, options = {}) {
    try {
        const report = await runQueuedJobs(store, processor, limit, options);
        if (!isIdleJobReport(report)) {
            for (const line of report.lines)
                logLine(line);
        }
        return report.ran;
    }
    catch (error) {
        logError(`Job worker tick failed; retrying next tick: ${errorMessage(error)}`);
        return 0;
    }
}
function isIdleJobReport(report) {
    return report.ran === 0 && report.lines.every((line) => /^No pending jobs(?: ready to run)?\.|^Hint: foreground gateway\/job-worker|^Next retry:/u.test(line));
}
export async function runQueuedJobs(store, processor, limit = 1, options = {}) {
    const maxToRun = Math.max(1, Math.floor(limit));
    const lines = [];
    let ran = 0;
    while (ran < maxToRun) {
        const pending = await store.pending(maxToRun - ran);
        if (pending.length === 0)
            break;
        const concurrency = normalizeConcurrency(options.concurrency, pending.length);
        lines.push(concurrency > 1 ? `Running ${pending.length} job(s) with parallelism ${concurrency}.` : `Running ${pending.length} job(s).`);
        const started = [];
        for (const queued of pending) {
            const job = await store.start(queued.id);
            if (!job)
                continue;
            started.push(job);
        }
        if (started.length === 0)
            break;
        ran += started.length;
        const outcomes = await mapWithConcurrency(started, concurrency, async (job) => {
            try {
                const input = await jobProcessorInput(store, job, options.maxInputChars);
                const output = await processor.handle(input, job.sessionId, {
                    source: job.source,
                    providerId: job.providerId
                });
                if (isProviderFailureOutput(output)) {
                    return { job, status: "deferred", output };
                }
                return { job, status: "done", output };
            }
            catch (error) {
                return { job, status: "failed", output: error instanceof Error ? error.message : String(error) };
            }
        });
        for (const outcome of outcomes) {
            if (outcome.status === "deferred") {
                await store.defer(outcome.job.id, outcome.output);
                lines.push(`- [${outcome.job.id}] deferred: provider unavailable`);
            }
            else if (outcome.status === "done") {
                await store.finish(outcome.job.id, outcome.output);
                lines.push(`- [${outcome.job.id}] done`);
            }
            else {
                await store.fail(outcome.job.id, outcome.output);
                lines.push(`- [${outcome.job.id}] failed: ${outcome.output}`);
            }
        }
    }
    if (ran === 0) {
        const waiting = await store.list("pending");
        if (waiting.length > 0) {
            const nextAttemptAt = waiting
                .map((job) => job.nextAttemptAt)
                .filter((value) => Boolean(value))
                .sort()[0];
            return {
                ran: 0,
                lines: [
                    `No pending jobs ready to run. ${waiting.length} pending job(s) waiting for retry or dependencies.`,
                    nextAttemptAt ? `Next retry: ${nextAttemptAt}` : undefined
                ].filter(Boolean)
            };
        }
        return {
            ran: 0,
            lines: [
                "No pending jobs.",
                "Hint: foreground gateway/job-worker may have already processed queued jobs; check `/jobs done` or `viser jobs done`."
            ]
        };
    }
    return { ran, lines };
}
export function parseJobStatus(value) {
    return ["pending", "running", "done", "failed", "cancelled"].includes(value)
        ? value
        : undefined;
}
export function providerFailureBackoffMs(attempts) {
    const safeAttempts = Math.max(1, Math.floor(attempts));
    return Math.min(PROVIDER_FAILURE_MAX_BACKOFF_MS, PROVIDER_FAILURE_BASE_BACKOFF_MS * (2 ** (safeAttempts - 1)));
}
function normalizeJobDependencies(dependsOn) {
    const output = [];
    for (const id of dependsOn ?? []) {
        const value = id.trim();
        if (!value || output.includes(value))
            continue;
        output.push(value);
    }
    if (output.length > 20)
        throw new Error("Job dependency count is too large.");
    return output;
}
function dependenciesSatisfied(job, doneIds) {
    return (job.dependsOn ?? []).every((id) => doneIds.has(id));
}
async function jobProcessorInput(store, job, maxInputChars) {
    if (!job.dependsOn?.length)
        return job.prompt;
    const separator = "\n\n";
    const dependencyContext = await store.dependencyContext(job.dependsOn);
    const rawInput = `${job.prompt}${separator}${dependencyContext}`;
    const maxChars = normalizeInputLimit(maxInputChars);
    if (maxChars === undefined || countChars(rawInput) <= maxChars)
        return rawInput;
    const promptChars = countChars(job.prompt);
    const remainingContextBudget = maxChars - promptChars - countChars(separator);
    if (remainingContextBudget <= 0)
        return job.prompt;
    return `${job.prompt}${separator}${truncateToCharBudget(dependencyContext, remainingContextBudget)}`;
}
function normalizeInputLimit(value) {
    if (!Number.isFinite(value))
        return undefined;
    return Math.max(1, Math.floor(value ?? 1));
}
function truncateText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars))}\n[truncated ${value.length - maxChars} chars]`;
}
function truncateToCharBudget(value, maxChars) {
    const chars = Array.from(value);
    if (chars.length <= maxChars)
        return value;
    const suffix = `\n[truncated ${chars.length - maxChars} chars to fit job input limit]`;
    const suffixChars = Array.from(suffix);
    if (maxChars <= suffixChars.length)
        return chars.slice(0, maxChars).join("");
    return `${chars.slice(0, maxChars - suffixChars.length).join("")}${suffix}`;
}
function countChars(value) {
    return Array.from(value).length;
}
function truncateSingleLine(value, maxChars) {
    return truncateText(value.replace(/\s+/gu, " "), maxChars).replace(/\n/gu, " ");
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeConcurrency(value, jobCount) {
    const parsed = Number.isFinite(value) ? Math.floor(value ?? 1) : 1;
    return Math.max(1, Math.min(jobCount, MAX_JOB_CONCURRENCY, parsed));
}
async function mapWithConcurrency(items, concurrency, mapper) {
    if (items.length === 0)
        return [];
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex]);
        }
    }));
    return results;
}
