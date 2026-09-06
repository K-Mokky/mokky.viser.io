// ================================================================
// Todoist task sender
// ================================================================
// Todoist is a productivity/task-management surface rather than a chat room.
// Viser still routes it through the same approval-gated outbound connector
// boundary: users approve `todoist:<alias>` and the connector creates one task.
import { randomUUID } from "node:crypto";
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../utils/fetch.js";
const TODOIST_SYNC_URL = "https://api.todoist.com/api/v1/sync";
const TODOIST_TASK_CONTENT_LIMIT = 500;
const TODOIST_TASK_DESCRIPTION_LIMIT = 1_500;
export async function sendTodoistTask(config, projectAlias, text, options = {}) {
    const token = normalizeTodoistToken(config.token);
    const target = resolveTodoistProjectTarget(config, projectAlias);
    const task = normalizeTodoistTaskMessage(text);
    const fetchImpl = options.fetchImpl ?? fetch;
    const uuidFactory = options.uuidFactory ?? randomUUID;
    const uuid = uuidFactory();
    const tempId = uuidFactory();
    const command = {
        type: "item_add",
        temp_id: tempId,
        uuid,
        args: {
            content: task.content,
            ...(task.description ? { description: task.description } : {}),
            ...(target.projectId ? { project_id: target.projectId } : {})
        }
    };
    const body = new URLSearchParams({ commands: JSON.stringify([command]) });
    const response = await fetchWithTimeout(fetchImpl, TODOIST_SYNC_URL, {
        method: "POST",
        headers: todoistHeaders(token),
        body
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
        throw new Error(redactTodoistDetail(`Todoist task create failed: ${response.status} ${response.statusText} ${bodyText}`, config, projectAlias, target, text));
    }
    const parsed = parseTodoistSyncResponse(bodyText);
    const status = parsed.sync_status?.[uuid];
    if (status !== "ok") {
        const detail = typeof status === "string" ? status : JSON.stringify(status ?? parsed);
        throw new Error(redactTodoistDetail(`Todoist task create failed: ${detail}`, config, projectAlias, target, text));
    }
}
export function resolveTodoistProjectTarget(config, projectAlias) {
    const alias = normalizeTodoistTargetAlias(projectAlias);
    if (alias === "inbox")
        return { alias };
    const target = config.projects[alias] ?? (alias === "default" ? config.project : undefined);
    if (!target) {
        throw new Error(`Todoist project alias '${alias}' is not configured. Set ${config.projectEnv} or ${config.projectsEnv}, or use todoist:inbox.`);
    }
    return { alias, projectId: parseTodoistProjectTarget(target) };
}
export function hasTodoistCredentials(config) {
    return Boolean(config.token);
}
export function hasTodoistProjectTarget(config) {
    return Boolean(config.project || Object.keys(config.projects).length > 0);
}
export function normalizeTodoistToken(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error("Todoist API token is required.");
    if (trimmed.length < 10 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
        throw new Error("Todoist API token must be a single opaque token.");
    }
    return trimmed;
}
export function normalizeTodoistTargetAlias(value) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
        throw new Error("Todoist project alias must be a short alias such as inbox, default, ops, or errands.");
    }
    return trimmed.toLowerCase();
}
export function parseTodoistProjectTarget(value) {
    const raw = value.trim();
    if (!raw)
        throw new Error("Todoist project target is required.");
    if (/^tmp-/iu.test(raw))
        throw new Error("Todoist project target must be a synced server project ID, not a tmp-* placeholder.");
    if (raw.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(raw)) {
        throw new Error("Todoist project target must be a numeric or base32-like project ID.");
    }
    return raw;
}
export function parseTodoistProjectMap(value) {
    const raw = value?.trim();
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            const output = {};
            for (const [key, target] of Object.entries(parsed)) {
                if (typeof target !== "string" || !target.trim())
                    continue;
                output[normalizeTodoistTargetAlias(key)] = parseTodoistProjectTarget(target);
            }
            return output;
        }
    }
    catch {
        // Fall through to a shell-friendly alias=project-id list.
    }
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const separator = part.indexOf("=");
        if (separator <= 0)
            continue;
        const alias = normalizeTodoistTargetAlias(part.slice(0, separator));
        const target = part.slice(separator + 1).trim();
        if (alias && target)
            output[alias] = parseTodoistProjectTarget(target);
    }
    return output;
}
export function todoistHeaders(token) {
    return {
        authorization: `Bearer ${token}`,
        "content-type": "application/x-www-form-urlencoded"
    };
}
export function redactTodoistDetail(detail, config, alias, target, text) {
    let output = detail;
    for (const secret of [config.token, config.project, ...Object.values(config.projects), alias, target?.projectId, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function normalizeTodoistTaskMessage(text) {
    const normalized = text.replace(/\r\n?/gu, "\n").trim();
    if (!normalized)
        throw new Error("Todoist task content is required.");
    const [firstLine = "", ...rest] = normalized.split("\n");
    const content = firstLine.trim();
    if (!content)
        throw new Error("Todoist task content is required.");
    if (content.length > TODOIST_TASK_CONTENT_LIMIT) {
        throw new Error(`Todoist task content must be ${TODOIST_TASK_CONTENT_LIMIT} characters or fewer.`);
    }
    const description = rest.join("\n").trim();
    if (description.length > TODOIST_TASK_DESCRIPTION_LIMIT) {
        throw new Error(`Todoist task description must be ${TODOIST_TASK_DESCRIPTION_LIMIT} characters or fewer.`);
    }
    return { content, ...(description ? { description } : {}) };
}
function parseTodoistSyncResponse(bodyText) {
    try {
        const parsed = JSON.parse(bodyText);
        if (typeof parsed === "object" && parsed !== null)
            return parsed;
    }
    catch {
        // Fall through to a synthetic error object.
    }
    return {};
}
