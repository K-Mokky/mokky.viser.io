// ================================================================
// Email connector (local sendmail)
// ================================================================
// Email is delivered through a local sendmail-compatible command. Viser does
// not store SMTP credentials or call an email API here; outbound delivery still
// runs only after the normal connector-message approval gate.
import { runCommand } from "../utils/exec.js";
import { chunkText } from "../utils/text.js";
const EMAIL_CHUNK_SIZE = 8_000;
const MAX_EMAIL_HEADER_LENGTH = 200;
export function parseEmailRecipientMap(raw) {
    const output = {};
    for (const part of raw.split(/[,\n;]/u)) {
        const item = part.trim();
        if (!item)
            continue;
        const separator = item.indexOf("=");
        if (separator <= 0 || separator === item.length - 1) {
            throw new Error("Email recipient maps must look like alias=user@example.com,ops=ops@example.com.");
        }
        const alias = normalizeEmailTargetId(item.slice(0, separator));
        output[alias] = normalizeEmailAddress(item.slice(separator + 1));
    }
    return output;
}
export async function sendEmailMessage(config, targetId, text, options = {}) {
    const from = normalizeEmailAddress(config.from);
    const recipient = resolveEmailRecipient(config, targetId);
    const runner = options.runner ?? runCommand;
    const chunks = chunkText(normalizeEmailBody(text), EMAIL_CHUNK_SIZE);
    for (const [index, chunk] of chunks.entries()) {
        const subject = chunks.length > 1 ? `Viser message (${index + 1}/${chunks.length})` : "Viser message";
        const result = await runner({
            command: config.sendmailCommand,
            args: ["-t"],
            stdin: emailMessage({ from, to: recipient, subject, body: chunk }),
            timeoutMs: config.sendTimeoutMs,
            maxOutputBytes: 20_000,
            env: emailRuntimeEnv(),
            inheritEnv: false
        });
        if (result.exitCode !== 0 || result.signal) {
            throw new Error(redactEmailDetail(`sendmail failed: ${result.stderr || result.stdout || result.signal || result.exitCode}`, config, recipient, chunk));
        }
    }
}
export function resolveEmailRecipient(config, targetId) {
    const alias = normalizeEmailTargetId(targetId);
    const recipient = config.recipients[alias] ?? (alias === "default" ? config.recipient : undefined);
    if (!recipient) {
        throw new Error(`Email recipient alias '${alias}' is not configured. Set ${config.recipientEnv}/${config.recipientsEnv}.`);
    }
    return normalizeEmailAddress(recipient);
}
export function hasEmailRecipient(config) {
    return Boolean(config.recipient || Object.keys(config.recipients).length > 0);
}
export function normalizeEmailTargetId(raw) {
    const value = raw.trim().toLowerCase();
    if (!/^[a-z0-9._-]{1,80}$/u.test(value))
        throw new Error("Email target id must be a configured alias such as default or ops.");
    return value;
}
export function normalizeEmailAddress(raw) {
    const value = raw?.trim() ?? "";
    if (!value)
        throw new Error("Email address is required.");
    if (value.length > 254)
        throw new Error("Email address is too long.");
    if (/[\s,;<>\u0000-\u001f\u007f]/u.test(value))
        throw new Error("Email address must be a single plain address.");
    const [local = "", domain = ""] = value.split("@");
    if (local.length > 64 || domain.length > 253)
        throw new Error("Email address must be valid.");
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/u.test(value)) {
        throw new Error("Email address must be valid.");
    }
    return value;
}
function normalizeEmailBody(raw) {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw))
        throw new Error("Email body contains control characters.");
    const value = raw.replace(/\r\n?/gu, "\n").trim();
    if (!value)
        throw new Error("Email body is required.");
    if (value.length > 20_000)
        throw new Error("Email body is too long.");
    return value;
}
function emailMessage(input) {
    return [
        `From: ${headerValue(input.from)}`,
        `To: ${headerValue(input.to)}`,
        `Subject: ${headerValue(input.subject)}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=UTF-8",
        "Content-Transfer-Encoding: 8bit",
        "",
        input.body,
        ""
    ].join("\n");
}
function headerValue(raw) {
    const value = raw.replace(/[\r\n]/gu, " ").replace(/\s+/gu, " ").trim();
    if (!value)
        throw new Error("Email header value is required.");
    if (value.length > MAX_EMAIL_HEADER_LENGTH)
        throw new Error("Email header value is too long.");
    return value;
}
function redactEmailDetail(detail, config, recipient, text) {
    let output = detail;
    for (const secret of [config.from, config.recipient, ...Object.values(config.recipients), recipient, text]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
function emailRuntimeEnv() {
    return {
        PATH: process.env.PATH,
        HOME: process.env.HOME
    };
}
