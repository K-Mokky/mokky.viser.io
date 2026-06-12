// ================================================================
// Long-term memory store
// ================================================================
// OpenClaw/Hermes-like assistants become useful because they remember. This
// store is intentionally simple and inspectable: append-only JSONL for adds,
// full rewrite only when deleting a memory by id.
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { appendPrivateFile, ensurePrivateDir, readPrivateFileIfExists, writePrivateFile } from "../utils/files.js";
import { nowIso } from "../utils/text.js";
export class MemoryStore {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async add(text, options) {
        const entry = {
            id: randomUUID().slice(0, 12),
            text: text.trim(),
            tags: options.tags ?? [],
            source: options.source,
            createdAt: nowIso()
        };
        if (!entry.text)
            throw new Error("Cannot remember an empty value.");
        await ensurePrivateDir(this.dir);
        await appendPrivateFile(this.filePath(), `${JSON.stringify(entry)}\n`);
        return entry;
    }
    async list(limit = 50) {
        const entries = await this.readAll();
        return entries.slice(Math.max(0, entries.length - limit));
    }
    async search(query, limit = 10) {
        const entries = await this.readAll();
        const terms = parseSearchTerms(query);
        if (terms.tokens.length === 0 && terms.tags.length === 0)
            return entries.slice(-limit);
        return entries
            .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt))
            .slice(0, limit)
            .map((item) => item.entry);
    }
    async remove(id) {
        const entries = await this.readAll();
        const next = entries.filter((entry) => entry.id !== id);
        if (entries.length === next.length)
            return false;
        await ensurePrivateDir(this.dir);
        await writePrivateFile(this.filePath(), next.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
        return true;
    }
    async compact(options = {}) {
        const entries = await this.readAll();
        const beforeCount = entries.length;
        const deduped = dedupeByText(entries);
        const duplicateCount = beforeCount - deduped.length;
        const maxEntries = Math.max(0, Math.floor(options.maxEntries ?? 0));
        const trimmedCount = maxEntries > 0 && deduped.length > maxEntries ? deduped.length - maxEntries : 0;
        const compacted = trimmedCount > 0 ? deduped.slice(-maxEntries) : deduped;
        if (duplicateCount === 0 && trimmedCount === 0) {
            return { beforeCount, afterCount: beforeCount, duplicateCount: 0, trimmedCount: 0 };
        }
        await ensurePrivateDir(this.dir);
        const backupPath = join(this.dir, `entries.${fileSafeTimestamp(nowIso())}.bak.jsonl`);
        await writePrivateFile(backupPath, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""));
        await writePrivateFile(this.filePath(), compacted.map((entry) => JSON.stringify(entry)).join("\n") + (compacted.length ? "\n" : ""));
        return {
            beforeCount,
            afterCount: compacted.length,
            duplicateCount,
            trimmedCount,
            backupPath
        };
    }
    async profile(options = {}) {
        const entries = await this.readAll();
        const tagLimit = Math.max(1, Math.floor(options.tagLimit ?? 12));
        const itemLimitPerTag = Math.max(1, Math.floor(options.itemLimitPerTag ?? 5));
        const untaggedLimit = Math.max(0, Math.floor(options.untaggedLimit ?? 5));
        const byTag = new Map();
        const untagged = [];
        for (const entry of entries) {
            if (entry.tags.length === 0) {
                untagged.push(entry);
                continue;
            }
            for (const tag of entry.tags) {
                const key = tag.toLowerCase();
                const tagged = byTag.get(key) ?? [];
                tagged.push(entry);
                byTag.set(key, tagged);
            }
        }
        const groups = [...byTag.entries()]
            .map(([tag, taggedEntries]) => {
            const sorted = sortNewestFirst(taggedEntries);
            return {
                tag,
                count: taggedEntries.length,
                latestAt: sorted[0]?.createdAt,
                entries: sorted.slice(0, itemLimitPerTag)
            };
        })
            .sort((a, b) => b.count - a.count || (b.latestAt ?? "").localeCompare(a.latestAt ?? "") || a.tag.localeCompare(b.tag))
            .slice(0, tagLimit);
        return {
            totalCount: entries.length,
            generatedAt: nowIso(),
            groups,
            untagged: sortNewestFirst(untagged).slice(0, untaggedLimit)
        };
    }
    async formatProfileForPrompt(options = {}) {
        const profile = await this.profile(options);
        if (profile.totalCount === 0)
            return "(none)";
        const lines = [`total_memories: ${profile.totalCount}`];
        for (const group of profile.groups) {
            lines.push(`- #${group.tag} (${group.count})`);
            for (const entry of group.entries)
                lines.push(`  - [${entry.id}] ${entry.text}`);
        }
        if (profile.untagged.length > 0) {
            lines.push("- untagged recent");
            for (const entry of profile.untagged)
                lines.push(`  - [${entry.id}] ${entry.text}`);
        }
        return lines.join("\n");
    }
    async formatForPrompt(query, limit) {
        const entries = await this.search(query, limit);
        if (entries.length === 0)
            return "(none)";
        return entries
            .map((entry) => `- [${entry.id}] ${entry.text}${entry.tags.length ? ` #${entry.tags.join(" #")}` : ""}`)
            .join("\n");
    }
    async count() {
        return (await this.readAll()).length;
    }
    async readAll() {
        const path = this.filePath();
        const raw = await readPrivateFileIfExists(path, { dirs: [this.dir] });
        if (raw === undefined)
            return [];
        return raw
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    filePath() {
        return join(this.dir, "entries.jsonl");
    }
}
export function parseMemoryInput(input) {
    const tags = [...input.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]);
    const text = input.replace(/#[\p{L}\p{N}_-]+/gu, "").replace(/\s+/g, " ").trim();
    return { text: text || input.trim(), tags };
}
function parseSearchTerms(value) {
    const tags = [...value.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLowerCase());
    const untagged = value.replace(/#[\p{L}\p{N}_-]+/gu, " ");
    return {
        phrase: normalizeText(untagged),
        tokens: tokenize(untagged),
        tags,
        vector: buildLexicalVector(`${untagged} ${tags.join(" ")}`)
    };
}
function tokenize(value) {
    return value
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((term) => term.length >= 2);
}
function scoreEntry(entry, terms) {
    const text = normalizeText(entry.text);
    const tagSet = new Set(entry.tags.map((tag) => tag.toLowerCase()));
    const source = entry.source.toLowerCase();
    let score = 0;
    if (terms.phrase.length >= 3 && text.includes(terms.phrase))
        score += 5;
    for (const tag of terms.tags) {
        if (tagSet.has(tag))
            score += 6;
        else if ([...tagSet].some((entryTag) => entryTag.includes(tag)))
            score += 3;
    }
    for (const token of terms.tokens) {
        if (tagSet.has(token))
            score += 4;
        if (text.includes(token))
            score += 2;
        if (source.includes(token))
            score += 1;
    }
    const vectorScore = cosineSimilarity(terms.vector, buildLexicalVector(`${entry.text} ${entry.tags.join(" ")} ${entry.source}`));
    if (vectorScore >= 0.08)
        score += vectorScore * 8;
    return score;
}
const ENGLISH_STOPWORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "with"
]);
function buildLexicalVector(value) {
    const vector = new Map();
    for (const token of tokenize(value)) {
        if (ENGLISH_STOPWORDS.has(token))
            continue;
        const pieces = token.split(/[_-]+/u).filter((piece) => piece.length >= 2);
        for (const piece of [token, ...pieces])
            addTokenFeatures(vector, piece);
    }
    return vector;
}
function addTokenFeatures(vector, token) {
    addVectorWeight(vector, `tok:${token}`, 1);
    const stem = stemEnglishToken(token);
    if (stem !== token && stem.length >= 2)
        addVectorWeight(vector, `stem:${stem}`, 0.8);
    for (const ngram of charNgrams(token, 3))
        addVectorWeight(vector, `tri:${ngram}`, 0.35);
}
function stemEnglishToken(token) {
    if (!/^[a-z][a-z0-9-]*$/u.test(token) || token.length < 5)
        return token;
    if (token.endsWith("ies") && token.length > 5)
        return `${token.slice(0, -3)}y`;
    if (token.endsWith("ing") && token.length > 6)
        return token.slice(0, -3);
    if (token.endsWith("ed") && token.length > 5)
        return token.slice(0, -2);
    if (token.endsWith("es") && token.length > 5)
        return token.slice(0, -2);
    if (token.endsWith("s") && token.length > 5)
        return token.slice(0, -1);
    return token;
}
function charNgrams(value, size) {
    const chars = [...value];
    if (chars.length < size)
        return chars.length > 0 ? [value] : [];
    const grams = [];
    for (let index = 0; index <= chars.length - size; index += 1) {
        grams.push(chars.slice(index, index + size).join(""));
    }
    return grams;
}
function addVectorWeight(vector, feature, weight) {
    vector.set(feature, (vector.get(feature) ?? 0) + weight);
}
function cosineSimilarity(left, right) {
    if (left.size === 0 || right.size === 0)
        return 0;
    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;
    for (const weight of left.values())
        leftNorm += weight * weight;
    for (const weight of right.values())
        rightNorm += weight * weight;
    const [smaller, larger] = left.size <= right.size ? [left, right] : [right, left];
    for (const [feature, weight] of smaller.entries()) {
        dot += weight * (larger.get(feature) ?? 0);
    }
    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
function dedupeByText(entries) {
    const byKey = new Map();
    for (const entry of entries) {
        const key = normalizeMemoryKey(entry.text);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, cloneEntry(entry));
            continue;
        }
        const newer = entry.createdAt.localeCompare(existing.createdAt) >= 0 ? cloneEntry(entry) : existing;
        const older = newer.id === entry.id ? existing : entry;
        newer.tags = mergeTags(newer.tags, older.tags);
        byKey.set(key, newer);
    }
    return [...byKey.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
function sortNewestFirst(entries) {
    return [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function cloneEntry(entry) {
    return { ...entry, tags: [...entry.tags] };
}
function mergeTags(first, second) {
    return [...new Set([...first, ...second])].sort((a, b) => a.localeCompare(b));
}
function normalizeMemoryKey(value) {
    return normalizeText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function normalizeText(value) {
    return value.toLowerCase().replace(/\s+/g, " ").trim();
}
function fileSafeTimestamp(value) {
    return value.replace(/[:.]/g, "-");
}
