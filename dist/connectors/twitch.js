// ================================================================
// Twitch chat outbound connector
// ================================================================
// Twitch delivery is intentionally outbound-only. Viser uses Twitch IRC over
// TLS with a short local channel alias, while the OAuth token and bot username
// stay in local configuration until the final approved send boundary.
import { connect as tlsConnect } from "node:tls";
import { chunkText } from "../utils/text.js";
import { normalizeWebhookId } from "./google-chat.js";
const TWITCH_IRC_HOST = "irc.chat.twitch.tv";
const TWITCH_IRC_PORT = 6697;
const TWITCH_CHUNK_SIZE = 350;
export async function sendTwitchMessage(config, channelId, text, options = {}) {
    const accessToken = normalizeTwitchAccessToken(config.accessToken);
    const botUsername = normalizeTwitchUsername(config.botUsername);
    const channel = resolveTwitchChannel(config, channelId);
    const chunks = chunkText(normalizeTwitchMessageBody(text), TWITCH_CHUNK_SIZE);
    const runner = options.runner ?? runTwitchSend;
    try {
        await runner({
            accessToken,
            botUsername,
            channel,
            chunks,
            timeoutMs: config.sendTimeoutMs
        });
    }
    catch (error) {
        throw new Error(redactTwitchDetail(`Twitch send failed: ${error instanceof Error ? error.message : String(error)}`, config, channelId, channel, text));
    }
}
export function resolveTwitchChannel(config, channelId) {
    const alias = normalizeTwitchChannelAlias(channelId);
    const channel = config.channels[alias] ?? (alias === "default" ? config.channel : undefined);
    if (!channel) {
        throw new Error(`Twitch channel alias '${alias}' is not configured. Set ${config.channelEnv} or ${config.channelsEnv}.`);
    }
    return normalizeTwitchChannel(channel);
}
export function hasTwitchChannel(config) {
    return Boolean(config.channel || Object.keys(config.channels).length > 0);
}
export function parseTwitchChannelMap(raw) {
    const output = {};
    for (const part of (raw ?? "").split(/[,;\n]/u)) {
        const item = part.trim();
        if (!item)
            continue;
        const separator = item.indexOf("=");
        if (separator <= 0 || separator === item.length - 1) {
            throw new Error("Twitch channel maps must look like default=viser_channel,alerts=#alerts.");
        }
        output[normalizeTwitchChannelAlias(item.slice(0, separator))] = normalizeTwitchChannel(item.slice(separator + 1));
    }
    return output;
}
export function normalizeTwitchChannelAlias(value) {
    const id = normalizeWebhookId(value);
    if (!id)
        throw new Error("Twitch channel alias must be a short alias such as default or ops.");
    return id.toLowerCase();
}
export function normalizeTwitchUsername(value) {
    const username = value?.trim().replace(/^@/u, "").toLowerCase() ?? "";
    if (!username)
        throw new Error("Twitch bot username is required.");
    if (!/^[a-z0-9_]{3,25}$/u.test(username)) {
        throw new Error("Twitch username must be a 3-25 character login name.");
    }
    return username;
}
export function normalizeTwitchAccessToken(value) {
    const raw = value?.trim() ?? "";
    if (!raw)
        throw new Error("Twitch OAuth token is required.");
    const token = raw.replace(/^oauth:/iu, "");
    if (token.length < 10 || token.length > 2048 || /[\s\r\n\x00-\x1f\x7f]/u.test(token)) {
        throw new Error("Twitch OAuth token must be a single opaque token line.");
    }
    return token;
}
export function normalizeTwitchChannel(value) {
    const raw = value?.trim().replace(/^#/u, "").toLowerCase() ?? "";
    if (!raw)
        throw new Error("Twitch channel is required.");
    if (!/^[a-z0-9_]{3,25}$/u.test(raw)) {
        throw new Error("Twitch channel must be a Twitch login name, with or without leading #.");
    }
    return `#${raw}`;
}
export function redactTwitchDetail(detail, config, alias, channel, text) {
    let output = detail;
    const configuredBotUsername = config.botUsername?.trim().replace(/^@/u, "").toLowerCase();
    const configuredChannel = config.channel?.trim().replace(/^#/u, "").toLowerCase();
    for (const secret of [
        config.accessToken,
        config.accessToken?.replace(/^oauth:/iu, ""),
        config.botUsername,
        configuredBotUsername,
        config.channel,
        configuredChannel,
        ...Object.values(config.channels),
        alias,
        channel,
        channel?.replace(/^#/u, ""),
        text
    ]) {
        if (secret)
            output = output.split(secret).join("[REDACTED]");
    }
    return output;
}
async function runTwitchSend(input) {
    await new Promise((resolve, reject) => {
        let settled = false;
        let authenticated = false;
        let joined = false;
        let buffer = "";
        const socket = tlsConnect({
            host: TWITCH_IRC_HOST,
            port: TWITCH_IRC_PORT,
            servername: TWITCH_IRC_HOST,
            timeout: input.timeoutMs
        });
        const timer = setTimeout(() => fail(new Error("connection timed out")), input.timeoutMs);
        const cleanup = () => {
            clearTimeout(timer);
            socket.removeAllListeners();
            socket.destroy();
        };
        const done = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const write = (line) => {
            socket.write(`${line}\r\n`);
        };
        const join = () => {
            if (joined)
                return;
            joined = true;
            write(`JOIN ${input.channel}`);
        };
        const flushMessages = () => {
            for (const chunk of input.chunks)
                write(`PRIVMSG ${input.channel} :${chunk}`);
            write("QUIT :Viser delivery complete");
            socket.end();
            done();
        };
        const handleLine = (line) => {
            if (line.startsWith("PING ")) {
                write(`PONG ${line.slice(5)}`);
                return;
            }
            if (/Login authentication failed|Improperly formatted auth|invalid oauth token/iu.test(line)) {
                fail(new Error("authentication failed"));
                return;
            }
            const code = line.match(/^[^ ]+ (\d{3}) /u)?.[1];
            if ((code === "001" || code === "376" || code === "422") && !authenticated) {
                authenticated = true;
                join();
                return;
            }
            if (line.includes(` JOIN ${input.channel}`) || code === "366") {
                flushMessages();
            }
            if (line.startsWith("ERROR "))
                fail(new Error(line.slice(6).trim() || "server error"));
        };
        socket.setEncoding("utf8");
        socket.on("secureConnect", () => {
            write(`PASS oauth:${input.accessToken}`);
            write(`NICK ${input.botUsername}`);
        });
        socket.on("data", (data) => {
            buffer += String(data);
            const lines = buffer.split(/\r?\n/u);
            buffer = lines.pop() ?? "";
            for (const line of lines)
                if (line)
                    handleLine(line);
        });
        socket.on("error", fail);
        socket.on("timeout", () => fail(new Error("socket timed out")));
        socket.on("end", () => {
            if (!settled)
                fail(new Error("server closed before delivery"));
        });
    });
}
function normalizeTwitchMessageBody(raw) {
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(raw))
        throw new Error("Twitch message contains control characters.");
    const text = raw.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join(" / ").trim();
    if (!text)
        throw new Error("Twitch message is required.");
    if (text.length > 20_000)
        throw new Error("Twitch message is too long.");
    return text;
}
