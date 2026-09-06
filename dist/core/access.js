// ================================================================
// Connector access control and pairing
// ================================================================
// Messaging tokens are bearer credentials. To avoid a public bot responding to
// anyone who discovers it, Viser supports one-time pairing codes and a durable
// allowlist under `.viser/access`.
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { readPrivateFileIfExists, writeJsonFile } from "../utils/files.js";
import { nowIso } from "../utils/text.js";
export class AccessStore {
    config;
    constructor(config) {
        this.config = config;
    }
    async createPairingCode(connector, label) {
        const state = await this.readState();
        state.codes = activePairingCodes(state.codes);
        const code = {
            code: randomBytes(4).toString("hex").toUpperCase(),
            connector,
            label,
            createdAt: nowIso(),
            expiresAt: new Date(Date.now() + this.config.pairingCodeTtlMs).toISOString()
        };
        state.codes.push(code);
        await this.writeState(state);
        return code;
    }
    async isAllowed(connector, id, staticAllowlist = []) {
        if (staticAllowlist.includes(id))
            return true;
        if (!this.config.enabled)
            return staticAllowlist.length === 0;
        if (this.config.defaultPolicy === "open")
            return true;
        const state = await this.readState();
        return state.peers.some((peer) => peer.connector === connector && peer.id === id);
    }
    async pair(codeValue, connector, id, label) {
        const state = await this.readState();
        const originalCodeCount = state.codes.length;
        state.codes = activePairingCodes(state.codes);
        const normalized = normalizeCode(codeValue);
        const code = state.codes.find((item) => item.code === normalized && !item.usedAt);
        if (!code) {
            if (state.codes.length !== originalCodeCount)
                await this.writeState(state);
            return undefined;
        }
        if (code.connector && code.connector !== connector) {
            if (state.codes.length !== originalCodeCount)
                await this.writeState(state);
            return undefined;
        }
        if (new Date(code.expiresAt) <= new Date()) {
            if (state.codes.length !== originalCodeCount)
                await this.writeState(state);
            return undefined;
        }
        const existing = state.peers.find((peer) => peer.connector === connector && peer.id === id);
        if (existing) {
            state.codes = state.codes.filter((item) => item !== code);
            await this.writeState(state);
            return existing;
        }
        const peer = {
            connector,
            id,
            label: label || code.label,
            createdAt: nowIso(),
            source: "pair"
        };
        state.peers.push(peer);
        state.codes = state.codes.filter((item) => item !== code);
        await this.writeState(state);
        return peer;
    }
    async allow(connector, id, label, source = "cli") {
        const state = await this.readState();
        const existing = state.peers.find((peer) => peer.connector === connector && peer.id === id);
        if (existing)
            return existing;
        const peer = { connector, id, label, createdAt: nowIso(), source };
        state.peers.push(peer);
        await this.writeState(state);
        return peer;
    }
    async revoke(connector, id) {
        const state = await this.readState();
        const next = state.peers.filter((peer) => !(peer.connector === connector && peer.id === id));
        if (next.length === state.peers.length)
            return false;
        state.peers = next;
        await this.writeState(state);
        return true;
    }
    async listPeers() {
        return (await this.readState()).peers;
    }
    async listCodes() {
        return (await this.readState()).codes;
    }
    async formatAccess() {
        const state = await this.readState();
        const peers = state.peers.length
            ? state.peers.map((peer) => `- ${peer.connector}:${peer.id}${peer.label ? ` (${peer.label})` : ""} · ${peer.createdAt}`).join("\n")
            : "(none)";
        const codes = state.codes
            .filter((code) => !code.usedAt && new Date(code.expiresAt) > new Date())
            .map((code) => `- ${code.code} ${code.connector ?? "any"} expires ${code.expiresAt}${code.label ? ` (${code.label})` : ""}`)
            .join("\n") || "(none)";
        return [
            "Access policy",
            `- enabled: ${this.config.enabled}`,
            `- defaultPolicy: ${this.config.defaultPolicy}`,
            "authorized peers:",
            peers,
            "active pairing codes:",
            codes
        ].join("\n");
    }
    async tryPairCommand(input, connector, id, label) {
        const match = /^\/?pair\s+([A-Za-z0-9_-]+)$/u.exec(input.trim());
        if (!match)
            return undefined;
        return await this.pair(match[1], connector, id, label);
    }
    async readState() {
        const path = this.statePath();
        const raw = await readPrivateFileIfExists(path, { dirs: [this.config.dir] });
        if (raw === undefined)
            return { peers: [], codes: [] };
        return JSON.parse(raw);
    }
    async writeState(state) {
        await writeJsonFile(this.statePath(), state);
    }
    statePath() {
        return join(this.config.dir, "access.json");
    }
}
function activePairingCodes(codes, now = new Date()) {
    return codes.filter((code) => !code.usedAt && new Date(code.expiresAt) > now);
}
export function normalizeCode(value) {
    return value.trim().toUpperCase();
}
export function parseConnector(value) {
    return value === "telegram"
        || value === "discord"
        || value === "slack"
        || value === "matrix"
        || value === "signal"
        || value === "imessage"
        || value === "whatsapp"
        || value === "line"
        || value === "kakaotalk"
        || value === "google-chat"
        || value === "webhook"
        || value === "home-assistant"
        || value === "teams"
        || value === "mattermost"
        || value === "synology-chat"
        || value === "rocket-chat"
        || value === "feishu"
        || value === "dingtalk"
        || value === "wecom"
        || value === "zalo"
        || value === "irc"
        || value === "twitch"
        || value === "ntfy"
        || value === "mastodon"
        || value === "nextcloud-talk"
        || value === "webex"
        || value === "zulip"
        || value === "email"
        || value === "github"
        || value === "todoist"
        || value === "notion"
        || value === "obsidian"
        ? value
        : undefined;
}
