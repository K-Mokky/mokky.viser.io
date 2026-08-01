// ================================================================
// Todo list
// ================================================================
// A lightweight secretary-style task list. Items are durable JSON in the
// storage directory and are managed entirely locally — no provider calls.

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.ts";
import { nowIso } from "../utils/text.ts";
import type { TodoItem } from "./types.ts";

export class TodoStore {
  private dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  async add(text: string, source: string): Promise<TodoItem> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("Todo text is required. Example: /todo buy milk");
    const items = await this.list();
    const item: TodoItem = {
      id: randomUUID().slice(0, 8),
      text: trimmed,
      done: false,
      createdAt: nowIso(),
      source
    };
    items.push(item);
    await this.writeAll(items);
    return item;
  }

  async list(): Promise<TodoItem[]> {
    const raw = await readPrivateFileIfExists(this.itemsPath(), { dirs: [this.dir] });
    if (raw === undefined) return [];
    return JSON.parse(raw) as TodoItem[];
  }

  async markDone(id: string): Promise<TodoItem | undefined> {
    const items = await this.list();
    const item = items.find((entry) => entry.id === id && !entry.done);
    if (!item) return undefined;
    item.done = true;
    item.doneAt = nowIso();
    await this.writeAll(items);
    return item;
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.list();
    const next = items.filter((entry) => entry.id !== id);
    if (next.length === items.length) return false;
    await this.writeAll(next);
    return true;
  }

  async clearDone(): Promise<number> {
    const items = await this.list();
    const next = items.filter((entry) => !entry.done);
    const removed = items.length - next.length;
    if (removed > 0) await this.writeAll(next);
    return removed;
  }

  async formatList(): Promise<string> {
    const items = await this.list();
    if (items.length === 0) return "Todo list is empty. Add one with /todo <text>.";

    const open = items.filter((entry) => !entry.done);
    const done = items.filter((entry) => entry.done);
    const lines: string[] = [];
    if (open.length > 0) {
      lines.push(`Open (${open.length}):`);
      lines.push(...open.map((entry) => `- [ ] [${entry.id}] ${entry.text}`));
    }
    if (done.length > 0) {
      lines.push(`Done (${done.length}):`);
      lines.push(...done.map((entry) => `- [x] [${entry.id}] ${entry.text}`));
    }
    return lines.join("\n");
  }

  private async writeAll(items: TodoItem[]): Promise<void> {
    await ensurePrivateDir(this.dir);
    await writePrivateFile(this.itemsPath(), `${JSON.stringify(items, null, 2)}\n`);
  }

  private itemsPath(): string {
    return join(this.dir, "todos.json");
  }
}
