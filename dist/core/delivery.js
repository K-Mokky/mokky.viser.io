// ================================================================
// Session origin and outbound delivery
// ================================================================
// Team/fix-loop/supervisor jobs append role suffixes to the originating
// messenger session. Delivery still targets the original chat.
export function originSessionId(sessionId) {
    for (const marker of [":team:", ":fix-loop:", ":supervisor:"]) {
        const index = sessionId.indexOf(marker);
        if (index > 0)
            return sessionId.slice(0, index);
    }
    return sessionId;
}
export function deliveryForSession(sessionId) {
    const origin = originSessionId(sessionId);
    if (origin.startsWith("telegram:"))
        return { kind: "telegram", targetId: origin.slice("telegram:".length) };
    if (origin.startsWith("discord:"))
        return { kind: "discord", targetId: origin.slice("discord:".length) };
    if (origin.startsWith("slack:"))
        return { kind: "slack", targetId: origin.slice("slack:".length) };
    if (origin.startsWith("matrix:"))
        return { kind: "matrix", targetId: origin.slice("matrix:".length) };
    if (origin.startsWith("signal:"))
        return { kind: "signal", targetId: origin.slice("signal:".length) };
    if (origin.startsWith("imessage:"))
        return { kind: "imessage", targetId: origin.slice("imessage:".length) };
    if (origin.startsWith("whatsapp:"))
        return { kind: "whatsapp", targetId: origin.slice("whatsapp:".length) };
    if (origin.startsWith("line:"))
        return { kind: "line", targetId: origin.slice("line:".length) };
    if (origin.startsWith("kakaotalk:"))
        return { kind: "kakaotalk", targetId: origin.slice("kakaotalk:".length) };
    if (origin.startsWith("google-chat:"))
        return { kind: "google-chat", targetId: origin.slice("google-chat:".length) };
    if (origin.startsWith("webhook:"))
        return { kind: "webhook", targetId: origin.slice("webhook:".length) };
    if (origin.startsWith("home-assistant:"))
        return { kind: "home-assistant", targetId: origin.slice("home-assistant:".length) };
    if (origin.startsWith("teams:"))
        return { kind: "teams", targetId: origin.slice("teams:".length) };
    if (origin.startsWith("mattermost:"))
        return { kind: "mattermost", targetId: origin.slice("mattermost:".length) };
    if (origin.startsWith("synology-chat:"))
        return { kind: "synology-chat", targetId: origin.slice("synology-chat:".length) };
    if (origin.startsWith("rocket-chat:"))
        return { kind: "rocket-chat", targetId: origin.slice("rocket-chat:".length) };
    if (origin.startsWith("feishu:"))
        return { kind: "feishu", targetId: origin.slice("feishu:".length) };
    if (origin.startsWith("dingtalk:"))
        return { kind: "dingtalk", targetId: origin.slice("dingtalk:".length) };
    if (origin.startsWith("wecom:"))
        return { kind: "wecom", targetId: origin.slice("wecom:".length) };
    if (origin.startsWith("zalo:"))
        return { kind: "zalo", targetId: origin.slice("zalo:".length) };
    if (origin.startsWith("irc:"))
        return { kind: "irc", targetId: origin.slice("irc:".length) };
    if (origin.startsWith("twitch:"))
        return { kind: "twitch", targetId: origin.slice("twitch:".length) };
    if (origin.startsWith("ntfy:"))
        return { kind: "ntfy", targetId: origin.slice("ntfy:".length) };
    if (origin.startsWith("mastodon:"))
        return { kind: "mastodon", targetId: origin.slice("mastodon:".length) };
    if (origin.startsWith("nextcloud-talk:"))
        return { kind: "nextcloud-talk", targetId: origin.slice("nextcloud-talk:".length) };
    if (origin.startsWith("webex:"))
        return { kind: "webex", targetId: origin.slice("webex:".length) };
    if (origin.startsWith("zulip:"))
        return { kind: "zulip", targetId: origin.slice("zulip:".length) };
    if (origin.startsWith("email:"))
        return { kind: "email", targetId: origin.slice("email:".length) };
    if (origin.startsWith("github:"))
        return { kind: "github", targetId: origin.slice("github:".length) };
    if (origin.startsWith("todoist:"))
        return { kind: "todoist", targetId: origin.slice("todoist:".length) };
    if (origin.startsWith("notion:"))
        return { kind: "notion", targetId: origin.slice("notion:".length) };
    if (origin.startsWith("obsidian:"))
        return { kind: "obsidian", targetId: origin.slice("obsidian:".length) };
    return { kind: "console" };
}
