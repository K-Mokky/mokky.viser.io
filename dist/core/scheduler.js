// ================================================================
// Scheduled automation
// ================================================================
// This is the first always-on automation primitive. Tasks are durable JSON and
// execute through AssistantRuntime, so they inherit memory, skills, providers,
// and the local-CLI model access rule.
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPrivateFile, ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.js";
import { nowIso } from "../utils/text.js";
import { isProviderFailureOutput } from "./provider-output.js";
import { deliveryForSession } from "./delivery.js";
const SCHEDULE_FAILURE_BASE_BACKOFF_MS = 60_000;
const SCHEDULE_FAILURE_MAX_BACKOFF_MS = 60 * 60_000;
const SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS = 4_000;
export class ScheduleStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async add(task) {
        const tasks = await this.list();
        const next = {
            ...task,
            id: randomUUID().slice(0, 12),
            createdAt: nowIso(),
            runCount: 0
        };
        tasks.push(next);
        await this.writeAll(tasks);
        return next;
    }
    async list() {
        const path = this.tasksPath();
        const raw = await readPrivateFileIfExists(path, { dirs: [this.dir] });
        if (raw === undefined)
            return [];
        return JSON.parse(raw);
    }
    async remove(id) {
        const tasks = await this.list();
        const next = tasks.filter((task) => task.id !== id);
        if (next.length === tasks.length)
            return false;
        await this.writeAll(next);
        return true;
    }
    async due(now = new Date()) {
        return (await this.list()).filter((task) => task.enabled && task.nextRunAt && new Date(task.nextRunAt) <= now);
    }
    async recordRun(id, result) {
        const tasks = await this.list();
        const task = tasks.find((item) => item.id === id);
        if (!task)
            return;
        task.lastRunAt = nowIso();
        task.lastError = result.ok ? undefined : result.output.slice(0, 1000);
        task.runCount += 1;
        task.nextRunAt = result.nextRunAt;
        if (result.disable)
            task.enabled = false;
        await this.writeAll(tasks);
        await this.appendRunLog(task, result);
    }
    async formatList() {
        const tasks = await this.list();
        if (tasks.length === 0)
            return "No scheduled tasks yet.";
        return tasks
            .map((task) => {
            const cadence = task.intervalMs ? `every ${formatInterval(task.intervalMs)}` : "once";
            const delivery = `${task.delivery.kind}${task.delivery.targetId ? `:${task.delivery.targetId}` : ""}`;
            return [
                `- [${task.id}] ${task.enabled ? "enabled" : "disabled"} ${cadence}`,
                `  next: ${task.nextRunAt ?? "none"}`,
                `  session: ${task.sessionId}`,
                `  delivery: ${delivery}`,
                `  runs: ${task.runCount}`,
                task.lastError ? `  last error: ${task.lastError.replace(/\s+/g, " ").slice(0, 160)}` : undefined,
                `  prompt: ${task.prompt}`
            ].filter(Boolean).join("\n");
        })
            .join("\n");
    }
    async writeAll(tasks) {
        await ensurePrivateDir(this.dir);
        await writePrivateFile(this.tasksPath(), `${JSON.stringify(tasks, null, 2)}\n`);
    }
    async appendRunLog(task, result) {
        await ensurePrivateDir(this.dir);
        await appendPrivateFile(join(this.dir, "runs.jsonl"), `${JSON.stringify({ at: nowIso(), taskId: task.id, ok: result.ok, output: truncateRunLogOutput(result.output) })}\n`);
    }
    tasksPath() {
        return join(this.dir, "tasks.json");
    }
}
export class SchedulerRunner {
    store;
    config;
    assistant;
    notifier;
    constructor(config, assistant, notifier = consoleNotifier) {
        this.config = config;
        this.store = new ScheduleStore(config.dir);
        this.assistant = assistant;
        this.notifier = notifier;
    }
    async runOnce() {
        const due = await this.store.due();
        for (const task of due)
            await this.runTask(task);
        return due.length;
    }
    async loop() {
        if (!this.config.enabled) {
            console.log("Scheduler is disabled in config.");
            return;
        }
        let stopped = false;
        process.once("SIGINT", () => {
            stopped = true;
        });
        process.once("SIGTERM", () => {
            stopped = true;
        });
        console.log(`Viser scheduler is running. tick=${this.config.tickMs}ms. Press Ctrl+C to stop.`);
        while (!stopped) {
            await runSchedulerLoopIteration(() => this.runOnce());
            await delay(this.config.tickMs);
        }
    }
    async runTask(task) {
        let ok = true;
        let output = "";
        try {
            output = await this.assistant.handle(task.prompt, task.sessionId, {
                source: task.source,
                providerId: task.providerId
            });
            if (isProviderFailureOutput(output)) {
                ok = false;
            }
            else {
                await this.notifier(task, output);
            }
        }
        catch (error) {
            ok = false;
            output = error instanceof Error ? error.message : String(error);
        }
        const nextRunAt = task.intervalMs
            ? new Date(Date.now() + task.intervalMs).toISOString()
            : ok
                ? undefined
                : new Date(Date.now() + scheduleFailureBackoffMs(task.runCount + 1)).toISOString();
        await this.store.recordRun(task.id, { ok, output, nextRunAt, disable: !task.intervalMs && ok });
    }
}
export function parseScheduleInput(input, context) {
    const [mode, value, ...promptParts] = input.trim().split(/\s+/);
    const prompt = promptParts.join(" ").trim();
    if (!mode || !value || !prompt) {
        throw new Error("Usage: /schedule every <duration> <prompt> OR /schedule at <ISO datetime> <prompt>");
    }
    if (mode === "every") {
        const intervalMs = parseDurationMs(value);
        if (intervalMs < 60_000)
            throw new Error("Minimum recurring schedule interval is 1 minute.");
        return {
            prompt,
            sessionId: context.sessionId,
            source: context.source,
            providerId: context.providerId,
            enabled: true,
            intervalMs,
            nextRunAt: new Date(Date.now() + intervalMs).toISOString(),
            delivery: deliveryForSession(context.sessionId)
        };
    }
    if (mode === "at") {
        const when = new Date(value);
        if (Number.isNaN(when.valueOf()))
            throw new Error(`Invalid datetime '${value}'. Use an ISO-like value.`);
        if (when <= new Date())
            throw new Error("Scheduled time must be in the future.");
        return {
            prompt,
            sessionId: context.sessionId,
            source: context.source,
            providerId: context.providerId,
            enabled: true,
            nextRunAt: when.toISOString(),
            delivery: deliveryForSession(context.sessionId)
        };
    }
    throw new Error("Schedule mode must be 'every' or 'at'.");
}
export { deliveryForSession, originSessionId } from "./delivery.js";
export function parseDurationMs(value) {
    const match = /^(\d+)(s|m|h|d)$/u.exec(value.trim());
    if (!match)
        throw new Error("Duration must look like 10m, 2h, or 1d.");
    const amount = Number(match[1]);
    const unit = match[2];
    const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
    return amount * multiplier;
}
export function formatInterval(ms) {
    if (ms % 86_400_000 === 0)
        return `${ms / 86_400_000}d`;
    if (ms % 3_600_000 === 0)
        return `${ms / 3_600_000}h`;
    if (ms % 60_000 === 0)
        return `${ms / 60_000}m`;
    return `${Math.round(ms / 1000)}s`;
}
export function scheduleFailureBackoffMs(attempts) {
    const safeAttempts = Math.max(1, Math.floor(attempts));
    return Math.min(SCHEDULE_FAILURE_MAX_BACKOFF_MS, SCHEDULE_FAILURE_BASE_BACKOFF_MS * (2 ** (safeAttempts - 1)));
}
export async function consoleNotifier(task, output) {
    console.log(`\n[scheduled:${task.id}] ${task.prompt}\n${output}\n`);
}
export async function runSchedulerLoopIteration(runOnce, logError = console.error) {
    try {
        return await runOnce();
    }
    catch (error) {
        logError(`Scheduler tick failed; retrying next tick: ${errorMessage(error)}`);
        return 0;
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function truncateRunLogOutput(output) {
    if (output.length <= SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS)
        return output;
    return `${output.slice(0, SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS)}\n[truncated scheduler run output at ${SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS} chars; original ${output.length} chars]`;
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
