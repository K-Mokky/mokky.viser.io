// ================================================================
// IRC outbound connector
// ================================================================
// IRC delivery is intentionally outbound-only: approvals and schedules reference
// a short local channel alias while the IRC host, password, nick, and channel
// stay in local configuration until the final send boundary.

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { chunkText } from "../utils/text.ts";
import { normalizeWebhookId } from "./google-chat.ts";
import type { IrcConnectorConfig } from "../core/types.ts";

const IRC_CHUNK_SIZE = 350;
const DEFAULT_IRC_USER = "viser";

export interface IrcSendInput {
  host: string;
  port: number;
  tls: boolean;
  nick: string;
  password?: string;
  channel: string;
  chunks: string[];
  timeoutMs: number;
}

export interface IrcRunOptions {
  runner?: (input: IrcSendInput) => Promise<void>;
}

export async function sendIrcMessage(
  config: IrcConnectorConfig,
  channelId: string,
  text: string,
  options: IrcRunOptions = {}
): Promise<void> {
  const host = normalizeIrcHost(config.host);
  const port = normalizeIrcPort(config.port);
  const nick = normalizeIrcNick(config.nick);
  const password = normalizeIrcPassword(config.password);
  const channel = resolveIrcChannel(config, channelId);
  const chunks = chunkText(normalizeIrcMessageBody(text), IRC_CHUNK_SIZE);
  const runner = options.runner ?? runIrcSend;

  try {
    await runner({
      host,
      port,
      tls: config.tls,
      nick,
      password,
      channel,
      chunks,
      timeoutMs: config.sendTimeoutMs
    });
  } catch (error) {
    throw new Error(redactIrcDetail(`IRC send failed: ${error instanceof Error ? error.message : String(error)}`, config, channelId, channel, text));
  }
}

export function resolveIrcChannel(config: IrcConnectorConfig, channelId: string): string {
  const alias = normalizeIrcChannelAlias(channelId);
  const channel = config.channels[alias] ?? (alias === "default" ? config.channel : undefined);
  if (!channel) {
    throw new Error(`IRC channel alias '${alias}' is not configured. Set ${config.channelEnv} or ${config.channelsEnv}.`);
  }
  return normalizeIrcChannel(channel);
}

export function hasIrcChannel(config: IrcConnectorConfig): boolean {
  return Boolean(config.channel || Object.keys(config.channels).length > 0);
}

export function parseIrcChannelMap(raw: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  for (const part of (raw ?? "").split(/[,;\n]/u)) {
    const item = part.trim();
    if (!item) continue;
    const separator = item.indexOf("=");
    if (separator <= 0 || separator === item.length - 1) {
      throw new Error("IRC channel maps must look like default=#ops,alerts=#alerts.");
    }
    output[normalizeIrcChannelAlias(item.slice(0, separator))] = normalizeIrcChannel(item.slice(separator + 1));
  }
  return output;
}

export function normalizeIrcChannelAlias(value: string | undefined): string {
  const id = normalizeWebhookId(value);
  if (!id) throw new Error("IRC channel alias must be a short alias such as default or ops.");
  return id.toLowerCase();
}

export function normalizeIrcHost(value: string | undefined): string {
  const host = value?.trim() ?? "";
  if (!host) throw new Error("IRC host is required.");
  if (host.length > 253 || /[:/\\\s\x00-\x1f\x7f]/u.test(host)) {
    throw new Error("IRC host must be a plain hostname, not a URL or host:port value.");
  }
  if (!/^[A-Za-z0-9.-]+$/u.test(host) || host.startsWith(".") || host.endsWith(".")) {
    throw new Error("IRC host must be a plain DNS hostname.");
  }
  return host.toLowerCase();
}

export function normalizeIrcPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("IRC port must be an integer between 1 and 65535.");
  }
  return value;
}

export function normalizeIrcNick(value: string | undefined): string {
  const nick = value?.trim() ?? "";
  if (!nick) throw new Error("IRC nick is required.");
  if (!/^[A-Za-z`_^{|}\[\]\\][A-Za-z0-9`_^{|}\[\]\\-]{0,31}$/u.test(nick)) {
    throw new Error("IRC nick must be a valid short IRC nickname.");
  }
  return nick;
}

export function normalizeIrcPassword(value: string | undefined): string | undefined {
  const password = value?.trim();
  if (!password) return undefined;
  if (password.length > 512 || /[\r\n\x00]/u.test(password)) {
    throw new Error("IRC password must be a single opaque line.");
  }
  return password;
}

export function normalizeIrcChannel(value: string | undefined): string {
  const channel = value?.trim() ?? "";
  if (!channel) throw new Error("IRC channel is required.");
  if (!/^[#&][^\s,\x00-\x1f\x7f]{1,80}$/u.test(channel)) {
    throw new Error("IRC channel must be a channel name such as #ops.");
  }
  return channel;
}

export function redactIrcDetail(detail: string, config: IrcConnectorConfig, alias?: string, channel?: string, text?: string): string {
  let output = detail;
  for (const secret of [config.host, config.nick, config.password, config.channel, ...Object.values(config.channels), alias, channel, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

async function runIrcSend(input: IrcSendInput): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let registered = false;
    let buffer = "";
    const socket = createIrcSocket(input);
    const timer = setTimeout(() => fail(new Error("connection timed out")), input.timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const write = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    const flushMessages = (): void => {
      for (const chunk of input.chunks) write(`PRIVMSG ${input.channel} :${chunk}`);
      write("QUIT :Viser delivery complete");
      socket.end();
      done();
    };
    const handleLine = (line: string): void => {
      if (line.startsWith("PING ")) {
        write(`PONG ${line.slice(5)}`);
        return;
      }
      const code = line.match(/^[^ ]+ (\d{3}) /u)?.[1];
      if (code === "433") {
        fail(new Error("nick already in use"));
        return;
      }
      if ((code === "001" || code === "376" || code === "422") && !registered) {
        registered = true;
        flushMessages();
      }
      if (line.startsWith("ERROR ")) fail(new Error(line.slice(6).trim() || "server error"));
    };

    const register = (): void => {
      if (input.password) write(`PASS ${input.password}`);
      write(`NICK ${input.nick}`);
      write(`USER ${DEFAULT_IRC_USER} 0 * :Viser`);
    };
    socket.setEncoding("utf8");
    socket.on(input.tls ? "secureConnect" : "connect", register);
    socket.on("data", (data) => {
      buffer += String(data);
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line) handleLine(line);
    });
    socket.on("error", fail);
    socket.on("timeout", () => fail(new Error("socket timed out")));
    socket.on("end", () => {
      if (!registered) fail(new Error("server closed before registration"));
    });
  });
}

function createIrcSocket(input: IrcSendInput): Socket | TLSSocket {
  const options = { host: input.host, port: input.port, timeout: input.timeoutMs };
  return input.tls ? tlsConnect({ ...options, servername: input.host }) : netConnect(options);
}

function normalizeIrcMessageBody(raw: string): string {
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(raw)) throw new Error("IRC message contains control characters.");
  const text = raw.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trim()).filter(Boolean).join(" / ").trim();
  if (!text) throw new Error("IRC message is required.");
  if (text.length > 20_000) throw new Error("IRC message is too long.");
  return text;
}
