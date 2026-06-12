// ================================================================
// iMessage bridge (macOS Messages)
// ================================================================
// iMessage has no public bot token API. Viser integrates with the local macOS
// Messages app and chat.db through no-shell subprocess calls, so inbound polling
// and outbound sends only run while the foreground Viser process is open.
import { homedir } from "node:os";
import { resolve } from "node:path";
import { runCommand } from "../utils/exec.js";
import { chunkText } from "../utils/text.js";
import { pairedMessage, pairingRequiredMessage } from "./telegram.js";
import { connectorInputLimitMessage, connectorInputTooLong } from "./input-policy.js";
import { ConnectorRateLimiter, connectorRateLimitMessage } from "./rate-limit.js";
const IMESSAGE_CHUNK_SIZE = 1800;
const IMESSAGE_QUERY_LIMIT = 50;
export async function runImessageBridge(config, assistant, access) {
    const rateLimiter = new ConnectorRateLimiter(config.maxMessagesPerMinute);
    const state = {};
    let stopped = false;
    process.once("SIGINT", () => {
        stopped = true;
    });
    process.once("SIGTERM", () => {
        stopped = true;
    });
    // Seed the cursor so enabling the foreground bridge does not replay old private
    // Messages history into the provider.
    await pollImessageMessages(config, assistant, state, access, rateLimiter, { processMessages: false });
    console.log("iMessage bridge is running through local macOS Messages. Press Ctrl+C to stop.");
    while (!stopped) {
        try {
            await pollImessageMessages(config, assistant, state, access, rateLimiter);
        }
        catch (error) {
            if (stopped)
                break;
            console.error(`iMessage poll failed; retrying: ${error instanceof Error ? error.message : String(error)}`);
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, config.pollIntervalMs));
    }
}
export async function pollImessageMessages(config, assistant, state = {}, access, rateLimiter, options = {}) {
    const runner = options.runner ?? runCommand;
    const result = await runner({
        command: config.sqliteCommand,
        args: ["-readonly", "-json", expandHome(config.chatDbPath), imessageQuery(state.lastRowId ?? 0)],
        timeoutMs: config.queryTimeoutMs,
        maxOutputBytes: 250_000,
        env: imessageRuntimeEnv(),
        inheritEnv: false
    });
    if (result.exitCode !== 0 || result.signal) {
        throw new Error(redactImessageDetail(`sqlite3 iMessage query failed: ${result.stderr || result.stdout || result.signal || result.exitCode}`, config));
    }
    const messages = parseImessageRows(result.stdout);
    for (const message of messages) {
        state.lastRowId = Math.max(state.lastRowId ?? 0, message.rowid);
        if (options.processMessages === false)
            continue;
        await handleImessageMessage(config, assistant, message, access, rateLimiter, options);
    }
    return messages.length;
}
export async function handleImessageMessage(config, assistant, message, access, rateLimiter, options = {}) {
    const handleId = normalizeImessageHandle(message.handleId);
    if (!handleId || !message.text)
        return;
    const staticAllowlist = [...config.allowedHandleIds, ...config.defaultHandleIds].map((value) => normalizeImessageHandle(value)).filter(Boolean);
    if (config.allowedHandleIds.length > 0 && !staticAllowlist.includes(handleId))
        return;
    const normalized = normalizeImessageInput(message.text);
    if (!normalized)
        return;
    if (access && !(await access.isAllowed("imessage", handleId, staticAllowlist))) {
        const paired = await access.tryPairCommand(normalized, "imessage", handleId, `imessage:${handleId}`);
        await sendImessageMessage(config, handleId, paired ? pairedMessage("imessage") : pairingRequiredMessage("imessage"), options);
        return;
    }
    if (connectorInputTooLong(normalized, config.maxInputChars)) {
        await sendImessageMessage(config, handleId, connectorInputLimitMessage(config.maxInputChars), options);
        return;
    }
    const rate = rateLimiter?.check(`imessage:${handleId}`);
    if (rate && !rate.allowed) {
        await sendImessageMessage(config, handleId, connectorRateLimitMessage(rate.retryAfterMs), options);
        return;
    }
    try {
        const answer = await assistant.handle(normalized, `imessage:${handleId}`, { source: "imessage" });
        await sendImessageMessage(config, handleId, answer, options);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await sendImessageMessage(config, handleId, `Viser error:\n${detail}`, options);
    }
}
export function normalizeImessageInput(content) {
    const trimmed = content.trim();
    return trimmed || undefined;
}
export async function sendImessageMessage(config, handleId, text, options = {}) {
    const recipient = normalizeImessageHandle(handleId);
    if (!recipient)
        throw new Error("iMessage handle id is required.");
    const runner = options.runner ?? runCommand;
    for (const chunk of chunkText(text, IMESSAGE_CHUNK_SIZE)) {
        const result = await runner({
            command: config.osascriptCommand,
            args: imessageSendArgs(recipient, chunk),
            timeoutMs: config.sendTimeoutMs,
            maxOutputBytes: 20_000,
            env: imessageRuntimeEnv(),
            inheritEnv: false
        });
        if (result.exitCode !== 0 || result.signal) {
            throw new Error(redactImessageDetail(`osascript iMessage send failed: ${result.stderr || result.stdout || result.signal || result.exitCode}`, config, recipient, chunk));
        }
    }
}
export function parseImessageRows(output) {
    const trimmed = output.trim();
    if (!trimmed)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const messages = [];
    for (const row of parsed) {
        if (typeof row !== "object" || row === null)
            continue;
        const record = row;
        const rowid = Number(record.rowid);
        const handleId = normalizeImessageHandle(record.handle_id);
        const text = typeof record.text === "string" ? record.text : undefined;
        if (!Number.isSafeInteger(rowid) || rowid <= 0 || !handleId || !text)
            continue;
        messages.push({ rowid, handleId, text, chatGuid: record.chat_guid });
    }
    return messages;
}
export function normalizeImessageHandle(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 200 || /[\u0000-\u001F\u007F]/u.test(trimmed))
        return undefined;
    if (/^\+[1-9]\d{4,19}$/u.test(trimmed))
        return trimmed;
    if (/^[1-9]\d{4,19}$/u.test(trimmed))
        return `+${trimmed}`;
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(trimmed))
        return trimmed.toLowerCase();
    return undefined;
}
function imessageQuery(afterRowId) {
    const safeRowId = Number.isSafeInteger(afterRowId) && afterRowId > 0 ? afterRowId : 0;
    return [
        "SELECT",
        "m.ROWID AS rowid,",
        "COALESCE(h.id, '') AS handle_id,",
        "COALESCE(c.guid, '') AS chat_guid,",
        "COALESCE(m.text, '') AS text",
        "FROM message m",
        "LEFT JOIN handle h ON h.ROWID = m.handle_id",
        "LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID",
        "LEFT JOIN chat c ON c.ROWID = cmj.chat_id",
        "WHERE m.is_from_me = 0",
        "AND m.text IS NOT NULL",
        `AND m.ROWID > ${safeRowId}`,
        "ORDER BY m.ROWID ASC",
        `LIMIT ${IMESSAGE_QUERY_LIMIT};`
    ].join(" ");
}
function imessageSendArgs(recipient, text) {
    return [
        "-e", "on run argv",
        "-e", "set targetAddress to item 1 of argv",
        "-e", "set messageText to item 2 of argv",
        "-e", "tell application \"Messages\"",
        "-e", "set targetService to 1st service whose service type = iMessage",
        "-e", "set targetBuddy to buddy targetAddress of targetService",
        "-e", "send messageText to targetBuddy",
        "-e", "end tell",
        "-e", "end run",
        recipient,
        text
    ];
}
function expandHome(path) {
    if (path === "~")
        return homedir();
    if (path.startsWith("~/"))
        return resolve(homedir(), path.slice(2));
    return path;
}
function redactImessageDetail(detail, config, recipient, text) {
    let output = detail;
    for (const secret of [config.chatDbPath, recipient, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function imessageRuntimeEnv() {
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
        XDG_DATA_HOME: process.env.XDG_DATA_HOME,
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME
    };
}
