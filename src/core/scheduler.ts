// ================================================================
// Scheduled automation
// ================================================================
// This is the first always-on automation primitive. Tasks are durable JSON and
// execute through AssistantRuntime, so they inherit memory, skills, providers,
// and the local-CLI model access rule.

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPrivateFile, ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { nowIso } from "../utils/text.ts";
import type { AssistantRuntime } from "./assistant.ts";
import { isProviderFailureOutput } from "./provider-output.ts";
import type { AssistantHandleOptions, ScheduledDelivery, ScheduledTask, SchedulerConfig } from "./types.ts";

const SCHEDULE_FAILURE_BASE_BACKOFF_MS = 60_000;
const SCHEDULE_FAILURE_MAX_BACKOFF_MS = 60 * 60_000;
const SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS = 4_000;

export type SchedulerNotifier = (task: ScheduledTask, output: string) => Promise<void>;

export class ScheduleStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async add(task: Omit<ScheduledTask, "id" | "createdAt" | "runCount">): Promise<ScheduledTask> {
    const tasks = await this.list();
    const next: ScheduledTask = {
      ...task,
      id: randomUUID().slice(0, 12),
      createdAt: nowIso(),
      runCount: 0
    };
    tasks.push(next);
    await this.writeAll(tasks);
    return next;
  }

  async list(): Promise<ScheduledTask[]> {
    const path = this.tasksPath();
    const raw = await readPrivateFileIfExists(path, { dirs: [this.dir] });
    if (raw === undefined) return [];
    return JSON.parse(raw) as ScheduledTask[];
  }

  async remove(id: string): Promise<boolean> {
    const tasks = await this.list();
    const next = tasks.filter((task) => task.id !== id);
    if (next.length === tasks.length) return false;
    await this.writeAll(next);
    return true;
  }

  async due(now = new Date()): Promise<ScheduledTask[]> {
    return (await this.list()).filter((task) => task.enabled && task.nextRunAt && new Date(task.nextRunAt) <= now);
  }

  async recordRun(id: string, result: { ok: boolean; output: string; nextRunAt?: string; disable?: boolean }): Promise<void> {
    const tasks = await this.list();
    const task = tasks.find((item) => item.id === id);
    if (!task) return;

    task.lastRunAt = nowIso();
    task.lastError = result.ok ? undefined : result.output.slice(0, 1000);
    task.runCount += 1;
    task.nextRunAt = result.nextRunAt;
    if (result.disable) task.enabled = false;

    await this.writeAll(tasks);
    await this.appendRunLog(task, result);
  }

  async formatList(): Promise<string> {
    const tasks = await this.list();
    if (tasks.length === 0) return "No scheduled tasks yet.";

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

  private async writeAll(tasks: ScheduledTask[]): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateFile(this.tasksPath(), `${JSON.stringify(tasks, null, 2)}\n`);
  }

  private async appendRunLog(task: ScheduledTask, result: { ok: boolean; output: string }): Promise<void> {
    await ensurePrivateDir(this.dir);
    await appendPrivateFile(
      join(this.dir, "runs.jsonl"),
      `${JSON.stringify({ at: nowIso(), taskId: task.id, ok: result.ok, output: truncateRunLogOutput(result.output) })}\n`
    );
  }

  private tasksPath(): string {
    return join(this.dir, "tasks.json");
  }
}

export class SchedulerRunner {
  private store: ScheduleStore;
  private config: SchedulerConfig;
  private assistant: AssistantRuntime;
  private notifier: SchedulerNotifier;

  constructor(config: SchedulerConfig, assistant: AssistantRuntime, notifier: SchedulerNotifier = consoleNotifier) {
    this.config = config;
    this.store = new ScheduleStore(config.dir);
    this.assistant = assistant;
    this.notifier = notifier;
  }

  async runOnce(): Promise<number> {
    const due = await this.store.due();
    for (const task of due) await this.runTask(task);
    return due.length;
  }

  async loop(): Promise<void> {
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

  private async runTask(task: ScheduledTask): Promise<void> {
    let ok = true;
    let output = "";
    try {
      output = await this.assistant.handle(task.prompt, task.sessionId, {
        source: task.source,
        providerId: task.providerId
      } satisfies AssistantHandleOptions);
      if (isProviderFailureOutput(output)) {
        ok = false;
      } else {
        await this.notifier(task, output);
      }
    } catch (error) {
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

export function parseScheduleInput(
  input: string,
  context: { sessionId: string; source: ScheduledTask["source"]; providerId?: string }
): Omit<ScheduledTask, "id" | "createdAt" | "runCount"> {
  const [mode, value, ...promptParts] = input.trim().split(/\s+/);
  const prompt = promptParts.join(" ").trim();
  if (!mode || !value || !prompt) {
    throw new Error("Usage: /schedule every <duration> <prompt> OR /schedule at <ISO datetime> <prompt>");
  }

  if (mode === "every") {
    const intervalMs = parseDurationMs(value);
    if (intervalMs < 60_000) throw new Error("Minimum recurring schedule interval is 1 minute.");
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
    if (Number.isNaN(when.valueOf())) throw new Error(`Invalid datetime '${value}'. Use an ISO-like value.`);
    if (when <= new Date()) throw new Error("Scheduled time must be in the future.");
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

export function deliveryForSession(sessionId: string): ScheduledDelivery {
  if (sessionId.startsWith("telegram:")) return { kind: "telegram", targetId: sessionId.slice("telegram:".length) };
  if (sessionId.startsWith("discord:")) return { kind: "discord", targetId: sessionId.slice("discord:".length) };
  if (sessionId.startsWith("slack:")) return { kind: "slack", targetId: sessionId.slice("slack:".length) };
  if (sessionId.startsWith("matrix:")) return { kind: "matrix", targetId: sessionId.slice("matrix:".length) };
  if (sessionId.startsWith("signal:")) return { kind: "signal", targetId: sessionId.slice("signal:".length) };
  if (sessionId.startsWith("imessage:")) return { kind: "imessage", targetId: sessionId.slice("imessage:".length) };
  if (sessionId.startsWith("whatsapp:")) return { kind: "whatsapp", targetId: sessionId.slice("whatsapp:".length) };
  if (sessionId.startsWith("line:")) return { kind: "line", targetId: sessionId.slice("line:".length) };
  if (sessionId.startsWith("google-chat:")) return { kind: "google-chat", targetId: sessionId.slice("google-chat:".length) };
  if (sessionId.startsWith("webhook:")) return { kind: "webhook", targetId: sessionId.slice("webhook:".length) };
  if (sessionId.startsWith("home-assistant:")) return { kind: "home-assistant", targetId: sessionId.slice("home-assistant:".length) };
  if (sessionId.startsWith("teams:")) return { kind: "teams", targetId: sessionId.slice("teams:".length) };
  if (sessionId.startsWith("mattermost:")) return { kind: "mattermost", targetId: sessionId.slice("mattermost:".length) };
  if (sessionId.startsWith("synology-chat:")) return { kind: "synology-chat", targetId: sessionId.slice("synology-chat:".length) };
  if (sessionId.startsWith("rocket-chat:")) return { kind: "rocket-chat", targetId: sessionId.slice("rocket-chat:".length) };
  if (sessionId.startsWith("feishu:")) return { kind: "feishu", targetId: sessionId.slice("feishu:".length) };
  if (sessionId.startsWith("dingtalk:")) return { kind: "dingtalk", targetId: sessionId.slice("dingtalk:".length) };
  if (sessionId.startsWith("wecom:")) return { kind: "wecom", targetId: sessionId.slice("wecom:".length) };
  if (sessionId.startsWith("zalo:")) return { kind: "zalo", targetId: sessionId.slice("zalo:".length) };
  if (sessionId.startsWith("irc:")) return { kind: "irc", targetId: sessionId.slice("irc:".length) };
  if (sessionId.startsWith("twitch:")) return { kind: "twitch", targetId: sessionId.slice("twitch:".length) };
  if (sessionId.startsWith("ntfy:")) return { kind: "ntfy", targetId: sessionId.slice("ntfy:".length) };
  if (sessionId.startsWith("mastodon:")) return { kind: "mastodon", targetId: sessionId.slice("mastodon:".length) };
  if (sessionId.startsWith("nextcloud-talk:")) return { kind: "nextcloud-talk", targetId: sessionId.slice("nextcloud-talk:".length) };
  if (sessionId.startsWith("webex:")) return { kind: "webex", targetId: sessionId.slice("webex:".length) };
  if (sessionId.startsWith("zulip:")) return { kind: "zulip", targetId: sessionId.slice("zulip:".length) };
  if (sessionId.startsWith("email:")) return { kind: "email", targetId: sessionId.slice("email:".length) };
  if (sessionId.startsWith("github:")) return { kind: "github", targetId: sessionId.slice("github:".length) };
  if (sessionId.startsWith("todoist:")) return { kind: "todoist", targetId: sessionId.slice("todoist:".length) };
  if (sessionId.startsWith("notion:")) return { kind: "notion", targetId: sessionId.slice("notion:".length) };
  if (sessionId.startsWith("obsidian:")) return { kind: "obsidian", targetId: sessionId.slice("obsidian:".length) };
  return { kind: "console" };
}

export function parseDurationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/u.exec(value.trim());
  if (!match) throw new Error("Duration must look like 10m, 2h, or 1d.");
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}

export function formatInterval(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function scheduleFailureBackoffMs(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(SCHEDULE_FAILURE_MAX_BACKOFF_MS, SCHEDULE_FAILURE_BASE_BACKOFF_MS * (2 ** (safeAttempts - 1)));
}

export async function consoleNotifier(task: ScheduledTask, output: string): Promise<void> {
  console.log(`\n[scheduled:${task.id}] ${task.prompt}\n${output}\n`);
}

export async function runSchedulerLoopIteration(
  runOnce: () => Promise<number>,
  logError: (message: string) => void = console.error
): Promise<number> {
  try {
    return await runOnce();
  } catch (error) {
    logError(`Scheduler tick failed; retrying next tick: ${errorMessage(error)}`);
    return 0;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncateRunLogOutput(output: string): string {
  if (output.length <= SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS) return output;
  return `${output.slice(0, SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS)}\n[truncated scheduler run output at ${SCHEDULE_RUN_LOG_OUTPUT_MAX_CHARS} chars; original ${output.length} chars]`;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
