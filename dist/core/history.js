// ================================================================
// Durable lightweight session history
// ================================================================
// JSONL keeps the storage inspectable and editable by hand. Each chat source
// gets its own file under `.viser/sessions/`.
import { basename, join } from "node:path";
import { appendPrivateFile, ensurePrivateDir, listPrivateDirIfExists, privateFileStatIfExists, readPrivateFileIfExists, removePrivateFileIfExists, writePrivateFile } from "../utils/files.js";
import { nowIso, safeId } from "../utils/text.js";
export class SessionStore {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir;
    }
    async append(sessionId, message) {
        const file = this.sessionPath(sessionId);
        await ensurePrivateDir(join(this.baseDir, "sessions"));
        await appendPrivateFile(file, `${JSON.stringify(message)}\n`);
    }
    async recent(sessionId, limit) {
        const file = this.sessionPath(sessionId);
        const raw = await this.readSessionRaw(file);
        if (raw === undefined)
            return [];
        const messages = parseMessages(raw);
        return messages.slice(Math.max(0, messages.length - limit));
    }
    async count(sessionId) {
        const file = this.sessionPath(sessionId);
        const raw = await this.readSessionRaw(file);
        return raw === undefined ? 0 : parseMessages(raw).length;
    }
    async clear(sessionId) {
        const file = this.sessionPath(sessionId);
        await removePrivateFileIfExists(file, { dirs: this.sessionDirs() });
    }
    async list(limit = 50) {
        const dir = join(this.baseDir, "sessions");
        const entries = await listPrivateDirIfExists(dir, { dirs: [this.baseDir] });
        if (!entries)
            return [];
        const files = entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
            .map((entry) => entry.name)
            .sort();
        const summaries = (await Promise.all(files.map((name) => this.summarizeFile(join(dir, name)))))
            .filter((summary) => summary !== undefined);
        return summaries
            .sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.id.localeCompare(b.id))
            .slice(0, limit);
    }
    async search(query, limit = 20) {
        const terms = tokenize(query);
        if (terms.length === 0)
            return [];
        const summaries = await this.list(Number.MAX_SAFE_INTEGER);
        const results = [];
        for (const summary of summaries) {
            const raw = await this.readSessionRaw(summary.path);
            if (raw === undefined)
                continue;
            const messages = parseMessages(raw);
            messages.forEach((message, index) => {
                const score = scoreMessage(message, terms);
                if (score <= 0)
                    return;
                results.push({
                    sessionId: summary.id,
                    message,
                    messageIndex: index,
                    score,
                    preview: previewMessage(message.content, terms)
                });
            });
        }
        return results
            .sort((a, b) => b.score - a.score || b.message.at.localeCompare(a.message.at))
            .slice(0, limit);
    }
    async transcript(sessionId, limit = 100) {
        return await this.recent(sessionId, limit);
    }
    async compact(sessionId, options = {}) {
        const file = this.sessionPath(sessionId);
        const beforeRaw = await this.readSessionRaw(file);
        if (beforeRaw === undefined) {
            return {
                sessionId,
                beforeCount: 0,
                afterCount: 0,
                trimmedCount: 0,
                beforeBytes: 0,
                afterBytes: 0
            };
        }
        const beforeBytes = Buffer.byteLength(beforeRaw, "utf8");
        const messages = parseMessages(beforeRaw);
        const beforeCount = messages.length;
        const maxMessages = Math.max(1, Math.floor(options.maxMessages ?? 500));
        if (beforeCount <= maxMessages) {
            return {
                sessionId,
                beforeCount,
                afterCount: beforeCount,
                trimmedCount: 0,
                beforeBytes,
                afterBytes: beforeBytes
            };
        }
        const compacted = messages.slice(-maxMessages);
        const backupPath = join(this.baseDir, "sessions", `${safeId(sessionId)}.${fileSafeTimestamp(nowIso())}.bak`);
        await ensurePrivateDir(join(this.baseDir, "sessions"));
        await writePrivateFile(backupPath, beforeRaw);
        await writePrivateFile(file, serializeMessages(compacted));
        const afterBytes = (await privateFileStatIfExists(file, { dirs: this.sessionDirs() }))?.size ?? 0;
        return {
            sessionId,
            beforeCount,
            afterCount: compacted.length,
            trimmedCount: beforeCount - compacted.length,
            beforeBytes,
            afterBytes,
            backupPath
        };
    }
    sessionPath(sessionId) {
        return join(this.baseDir, "sessions", `${safeId(sessionId)}.jsonl`);
    }
    async summarizeFile(path) {
        const raw = await this.readSessionRaw(path);
        if (raw === undefined)
            return undefined;
        const messages = parseMessages(raw);
        const providers = [...new Set(messages.map((message) => message.provider).filter(Boolean))].sort();
        const info = await privateFileStatIfExists(path, { dirs: this.sessionDirs() });
        if (!info)
            return undefined;
        return {
            id: basename(path, ".jsonl"),
            path,
            messageCount: messages.length,
            firstAt: messages[0]?.at,
            lastAt: messages[messages.length - 1]?.at,
            providers,
            bytes: info.size
        };
    }
    async readSessionRaw(path) {
        return await readPrivateFileIfExists(path, { dirs: this.sessionDirs() });
    }
    sessionDirs() {
        return [this.baseDir, join(this.baseDir, "sessions")];
    }
}
function parseMessages(raw) {
    return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}
function serializeMessages(messages) {
    return messages.map((message) => JSON.stringify(message)).join("\n") + (messages.length ? "\n" : "");
}
function tokenize(value) {
    return value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((term) => term.length >= 2);
}
function scoreMessage(message, terms) {
    const content = message.content.toLowerCase();
    const provider = message.provider?.toLowerCase() ?? "";
    const role = message.role.toLowerCase();
    return terms.reduce((score, term) => {
        if (content.includes(term))
            score += 3;
        if (provider.includes(term))
            score += 1;
        if (role.includes(term))
            score += 1;
        return score;
    }, 0);
}
function previewMessage(content, terms, maxLength = 180) {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength)
        return normalized;
    const lower = normalized.toLowerCase();
    const firstMatch = terms
        .map((term) => lower.indexOf(term))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, firstMatch - Math.floor(maxLength / 3));
    const slice = normalized.slice(start, start + maxLength);
    return `${start > 0 ? "…" : ""}${slice}${start + maxLength < normalized.length ? "…" : ""}`;
}
function fileSafeTimestamp(value) {
    return value.replace(/[:.]/g, "-");
}
