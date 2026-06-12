// ================================================================
// Security and operations audit
// ================================================================
// Readiness answers "can it run?". Audit answers "is this configuration safe
// enough to leave running?". The checks are intentionally deterministic and
// local so they can run before any provider or messenger token is available.
import { constants } from "node:fs";
import { access, lstat, readFile, readdir } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { cwd } from "node:process";
import { homedir } from "node:os";
import { configValidationItems } from "../config-validation.js";
import { stateHealthItems } from "./state-health.js";
import { assertNoSymlinkComponentsUnderRoot, readJsonFile, readPrivateFileIfExists } from "../utils/files.js";
import { parseEnvLine, readEnvFileNoFollow } from "../utils/env.js";
import { isModelApiKeyEnvKey } from "../core/model-api-policy.js";
import { CORE_LOCAL_CLI_ROUTES, commandBasename, configuredCoreRouteProviders } from "../core/local-cli-policy.js";
import { normalizePersonalizationState, personalizationSensitivityReasons } from "../core/personalization.js";
const MUTATING_SHELL_COMMANDS = new Set(["rm", "mv", "cp", "chmod", "chown", "sudo", "sh", "bash", "zsh", "python", "python3", "node", "npm", "curl"]);
const LOCAL_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const RELEASE_AUTHOR = "KMokky";
const RELEASE_ALLOWED_AUTHOR_HANDLE = "mok" + "ky";
const RELEASE_ALLOWED_AUTHOR_NAME = "Mok" + "ky";
const RELEASE_SCAN_ENTRIES = [
    ".env.example",
    ".gitignore",
    ".npmignore",
    "README.md",
    "SECURITY.md",
    "LICENSE",
    "aimake.md",
    "config",
    "package.json",
    "package-lock.json",
    "plugins",
    "skills",
    "src",
    "test",
    "tools",
    "tsconfig.json"
];
const RELEASE_SKIP_DIRS = new Set([".git", ".omx", ".viser", "node_modules"]);
const RELEASE_TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".jsonl", ".md", ".py", ".sh", ".ts", ".tsx", ".txt", ".yml", ".yaml"]);
const RELEASE_TEXT_BASENAMES = new Set(["LICENSE", ".env.example", ".gitignore", ".npmignore"]);
const RELEASE_PRIVATE_PATTERNS = [".env", ".viser", ".omx", "viser.config.json", "node_modules"];
const GENERIC_RELEASE_PATH_TOKENS = new Set([
    "app",
    "apps",
    "code",
    "dev",
    "home",
    "node_modules",
    "private",
    "project",
    "projects",
    "repo",
    "repos",
    "src",
    "test",
    "tmp",
    "users",
    "var",
    "viser",
    "work",
    "workspace"
]);
const PERSONAL_RELEASE_PATTERNS = [
    {
        id: "local-home-path",
        pattern: new RegExp(`/Users/${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
        next: "Replace local machine paths with generic fixture paths such as /Users/example or /tmp/viser-test."
    },
    {
        id: "personal-messenger-handle",
        pattern: new RegExp(`@${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
        next: "Use a generic demo handle in tests and docs."
    },
    {
        id: "personal-memory-fixture",
        pattern: new RegExp(`\\b${RELEASE_ALLOWED_AUTHOR_NAME}\\s+(?:prefers|uses)\\b`, "iu"),
        next: `Use generic user fixtures unless the line is explicit creator attribution for ${RELEASE_AUTHOR}.`
    },
    {
        id: "personal-pairing-label",
        pattern: new RegExp(`\\bpair-code\\s+telegram\\s+${RELEASE_ALLOWED_AUTHOR_HANDLE}\\b`, "iu"),
        next: "Use a generic pairing label such as demo-user."
    }
];
const SENSITIVE_RELEASE_PATTERNS = [
    {
        id: "private-key-block",
        pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
        next: "Remove private key material from public files and rotate the key if it was ever committed."
    },
    {
        id: "model-api-key-literal",
        pattern: /\bsk-(?!test\b|should-not\b|example\b|redacted\b)[A-Za-z0-9_-]{20,}\b/iu,
        next: "Remove model/API keys from public files; Viser should use logged-in local provider CLIs instead."
    },
    {
        id: "github-token-literal",
        pattern: /\bgh[pousr]_(?!test\b|example\b|redacted\b)[A-Za-z0-9_]{36,}\b/iu,
        next: "Remove GitHub tokens from public files and rotate the token."
    },
    {
        id: "notion-token-literal",
        pattern: /\b(?:secret|ntn)_(?!test\b|example\b|redacted\b)[A-Za-z0-9_-]{20,}\b/iu,
        next: "Remove Notion tokens from public files and rotate the token."
    },
    {
        id: "telegram-token-literal",
        pattern: /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/u,
        next: "Remove Telegram bot tokens from public files and rotate the token."
    },
    {
        id: "discord-token-literal",
        pattern: /\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/u,
        next: "Remove Discord bot tokens from public files and rotate the token."
    },
    {
        id: "slack-token-literal",
        pattern: /\bx(?:oxb|app)-[A-Za-z0-9-]{20,}\b/u,
        next: "Remove Slack bot/app tokens from public files and rotate the token."
    },
    {
        id: "matrix-token-literal",
        pattern: /\bsyt_[A-Za-z0-9_=-]{20,}\b/u,
        next: "Remove Matrix access tokens from public files and rotate the token."
    },
    {
        id: "public-secret-env-assignment",
        pattern: /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GOOGLE_API_KEY|DISCORD_BOT_TOKEN|TELEGRAM_BOT_TOKEN|SLACK_BOT_TOKEN|SLACK_APP_TOKEN|MATRIX_ACCESS_TOKEN|SIGNAL_CLI_ACCOUNT|IMESSAGE_CHAT_DB|WHATSAPP_ACCESS_TOKEN|WHATSAPP_PHONE_NUMBER_ID|WHATSAPP_VERIFY_TOKEN|KAKAOTALK_SKILL_TOKEN|GOOGLE_CHAT_WEBHOOK_URL|GOOGLE_CHAT_WEBHOOKS|VISER_WEBHOOK_URL|VISER_WEBHOOKS|VISER_WEBHOOK_INBOUND_TOKEN|HOME_ASSISTANT_BASE_URL|HOME_ASSISTANT_ACCESS_TOKEN|HOME_ASSISTANT_SERVICE|HOME_ASSISTANT_SERVICES|TEAMS_WEBHOOK_URL|TEAMS_WEBHOOKS|MATTERMOST_WEBHOOK_URL|MATTERMOST_WEBHOOKS|SYNOLOGY_CHAT_WEBHOOK_URL|SYNOLOGY_CHAT_WEBHOOKS|ROCKET_CHAT_WEBHOOK_URL|ROCKET_CHAT_WEBHOOKS|FEISHU_WEBHOOK_URL|FEISHU_WEBHOOKS|DINGTALK_WEBHOOK_URL|DINGTALK_WEBHOOKS|WECOM_WEBHOOK_URL|WECOM_WEBHOOKS|ZALO_OA_ACCESS_TOKEN|ZALO_RECIPIENT_ID|ZALO_RECIPIENTS|IRC_HOST|IRC_PORT|IRC_TLS|IRC_NICK|IRC_PASSWORD|IRC_CHANNEL|IRC_CHANNELS|TWITCH_ACCESS_TOKEN|TWITCH_BOT_USERNAME|TWITCH_CHANNEL|TWITCH_CHANNELS|NTFY_BASE_URL|NTFY_TOKEN|NTFY_TOPIC|NTFY_TOPICS|MASTODON_BASE_URL|MASTODON_ACCESS_TOKEN|MASTODON_VISIBILITY|MASTODON_TARGETS|NEXTCLOUD_TALK_BASE_URL|NEXTCLOUD_TALK_USERNAME|NEXTCLOUD_TALK_APP_PASSWORD|NEXTCLOUD_TALK_ROOM_TOKEN|NEXTCLOUD_TALK_ROOMS|WEBEX_ACCESS_TOKEN|ZULIP_SITE_URL|ZULIP_BOT_EMAIL|ZULIP_API_KEY|ZULIP_TARGET|ZULIP_TARGETS|NOTION_TOKEN|NOTION_PAGE_ID|NOTION_PAGES|BRAVE_SEARCH_API_KEY|TAVILY_API_KEY|PERPLEXITY_API_KEY|EXA_API_KEY|FIRECRAWL_API_KEY|OLLAMA_API_KEY|BROWSER_USE_API_KEY|BROWSERBASE_API_KEY|VISER_DASHBOARD_TOKEN|VISER_PROVIDER_SECRET)\s*[:=]\s*["']?(?!(?:redacted|example|demo|dummy|fake|test|placeholder|your-|secret-token|secret-value|sk-test|sk-should-not|shell-secret|tool-api-key|\[REDACTED|<|\$\{|\.\.\.)\b)[A-Za-z0-9+~/][A-Za-z0-9._:+~/ -]{10,}/iu,
        next: "Keep real tokens and API keys in private .env files only; public examples must use placeholders."
    }
];
export function summarizeAudit(items) {
    const failCount = items.filter((item) => item.severity === "fail").length;
    const warnCount = items.filter((item) => item.severity === "warn").length;
    return {
        passCount: items.length - failCount - warnCount,
        warnCount,
        failCount,
        verdict: failCount > 0 ? "UNSAFE" : warnCount > 0 ? "REVIEW NEEDED" : "SAFE"
    };
}
export async function auditReport(config) {
    const items = await auditItems(config);
    const summary = summarizeAudit(items);
    return [
        `Viser audit: ${summary.verdict}`,
        `summary: ${summary.passCount} pass, ${summary.warnCount} warn, ${summary.failCount} fail`,
        "",
        ...items.map(formatItem)
    ].join("\n");
}
export async function auditItems(config) {
    const items = [];
    const configFile = await readUserConfig(config);
    auditConfigShape(config, items);
    await auditProviders(config, items);
    auditAccessAndConnectors(config, configFile, items);
    await auditEnvFile(items);
    await auditActions(config, items);
    await auditTools(config, items);
    auditStorage(config, items);
    auditWebDashboard(config, items);
    auditScheduler(config, items);
    auditJobs(config, items);
    await auditState(config, items);
    await auditPersonalization(config, items);
    await auditPublicRelease(items);
    return items;
}
async function auditEnvFile(items) {
    const configuredPath = process.env.VISER_ENV ?? ".env";
    const envPath = resolve(cwd(), configuredPath);
    try {
        await assertNoSymlinkComponentsUnderRoot(dirname(envPath), cwd());
        const info = await lstat(envPath);
        if (info.isSymbolicLink()) {
            items.push({
                severity: "fail",
                area: "env",
                message: `env file is a symlink (${displayPath(envPath)})`,
                next: "Replace it with a regular private env file; Viser intentionally refuses symlinked env files."
            });
            return;
        }
        if (!info.isFile()) {
            items.push({
                severity: "fail",
                area: "env",
                message: `env path is not a regular file (${displayPath(envPath)})`,
                next: "Use a regular private env file or remove VISER_ENV."
            });
            return;
        }
        await auditEnvModelApiKeys(envPath, items);
        const mode = info.mode & 0o777;
        if ((mode & 0o077) === 0) {
            items.push({ severity: "pass", area: "env", message: `env file permissions are private (${mode.toString(8)})` });
            return;
        }
        items.push({
            severity: "warn",
            area: "env",
            message: `env file is group/world accessible (${mode.toString(8)})`,
            next: `Run \`chmod 600 ${displayPath(envPath)}\` before storing real tokens.`
        });
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            items.push({ severity: "pass", area: "env", message: `no env file found at ${displayPath(envPath)}` });
            return;
        }
        if (error instanceof Error && /symlink/i.test(error.message)) {
            items.push({
                severity: "fail",
                area: "env",
                message: `env path contains a symlink (${displayPath(envPath)})`,
                next: "Replace it with a regular private env file; Viser intentionally refuses symlinked env files."
            });
            return;
        }
        items.push({
            severity: "warn",
            area: "env",
            message: `could not inspect env file permissions (${displayPath(envPath)})`,
            next: error instanceof Error ? error.message : String(error)
        });
    }
}
async function auditEnvModelApiKeys(envPath, items) {
    try {
        const raw = await readEnvFileNoFollow(envPath);
        if (raw === undefined) {
            items.push({ severity: "warn", area: "env", message: `could not inspect env file model API key names (${displayPath(envPath)})` });
            return;
        }
        const modelApiKeyNames = [...new Set(raw
                .split("\n")
                .map((line) => parseEnvLine(line)?.[0])
                .filter((key) => typeof key === "string" && isModelApiKeyEnvKey(key)))];
        if (modelApiKeyNames.length === 0) {
            items.push({ severity: "pass", area: "env", message: "env file contains no model API key variables" });
            return;
        }
        items.push({
            severity: "fail",
            area: "env",
            message: `env file contains model API key variables (${modelApiKeyNames.join(", ")})`,
            next: "Remove GPT/Claude/Gemini model API key variables. Viser uses already logged-in local CLIs; keep only messenger transport tokens in .env."
        });
    }
    catch (error) {
        items.push({
            severity: "warn",
            area: "env",
            message: `could not inspect env file model API key names (${displayPath(envPath)})`,
            next: error instanceof Error ? error.message : String(error)
        });
    }
}
function auditConfigShape(config, items) {
    const validation = configValidationItems(config);
    const actionable = validation.filter((item) => item.severity !== "pass");
    if (actionable.length === 0) {
        items.push({ severity: "pass", area: "config", message: "config shape is valid" });
        return;
    }
    for (const item of actionable) {
        items.push({
            severity: item.severity,
            area: "config",
            message: `${item.path}: ${item.message}`,
            next: item.next
        });
    }
}
async function auditState(config, items) {
    const stateItems = await stateHealthItems(config);
    const broken = stateItems.filter((item) => item.status === "fail");
    const warnings = stateItems.filter((item) => item.status === "warn");
    if (broken.length === 0 && warnings.length === 0) {
        items.push({ severity: "pass", area: "state", message: "persistent state files are readable" });
        return;
    }
    for (const item of broken) {
        items.push({
            severity: "fail",
            area: "state",
            message: `${item.area}: ${item.message}`,
            next: item.next
        });
    }
    for (const item of warnings) {
        items.push({
            severity: "warn",
            area: "state",
            message: `${item.area}: ${item.message}`,
            next: item.next
        });
    }
}
async function auditPersonalization(config, items) {
    if (!config.personalization.enabled) {
        items.push({ severity: "warn", area: "personalization", message: "personalization settings are disabled" });
        return;
    }
    const path = join(config.personalization.dir, "settings.json");
    let raw;
    try {
        const maybeRaw = await readPrivateFileIfExists(path, { dirs: [config.personalization.dir] });
        if (maybeRaw === undefined) {
            items.push({ severity: "pass", area: "personalization", message: "no personalization state saved yet" });
            return;
        }
        raw = maybeRaw;
    }
    catch (error) {
        items.push({
            severity: "warn",
            area: "personalization",
            message: "could not inspect personalization state",
            next: error instanceof Error ? error.message : String(error)
        });
        return;
    }
    try {
        const state = normalizePersonalizationState(JSON.parse(raw));
        const unsafe = state.settings
            .map((setting) => ({ setting, reasons: personalizationSensitivityReasons(`${setting.key}\n${setting.value}`) }))
            .filter((item) => item.reasons.length > 0);
        if (unsafe.length === 0) {
            items.push({ severity: "pass", area: "personalization", message: `${state.settings.length} non-sensitive global setting(s) stored` });
            return;
        }
        items.push({
            severity: "fail",
            area: "personalization",
            message: `personalization state contains sensitive-looking values (${unsafe.slice(0, 5).map((item) => `${item.setting.key}:${item.reasons.join("+")}`).join(", ")})`,
            next: "Remove secrets/personal identifiers from .viser/personalization/settings.json with `viser persona unset <key>` or `viser persona clear --force`."
        });
    }
    catch (error) {
        items.push({
            severity: "fail",
            area: "personalization",
            message: "personalization state is invalid JSON",
            next: error instanceof Error ? error.message : String(error)
        });
    }
}
async function auditProviders(config, items) {
    const providerIds = Object.keys(config.providers);
    if (!config.providers[config.assistant.defaultProvider]) {
        items.push({
            severity: "fail",
            area: "provider",
            message: `default provider '${config.assistant.defaultProvider}' is not configured`,
            next: `Choose one of: ${providerIds.join(", ")}`
        });
    }
    else {
        items.push({ severity: "pass", area: "provider", message: `default provider '${config.assistant.defaultProvider}' is configured` });
    }
    for (const providerId of config.assistant.fallbackProviders) {
        items.push(config.providers[providerId]
            ? { severity: "pass", area: "provider", message: `fallback provider '${providerId}' is configured` }
            : {
                severity: "warn",
                area: "provider",
                message: `fallback provider '${providerId}' is missing`,
                next: "Remove it from assistant.fallbackProviders or add a matching provider config."
            });
    }
    auditCoreLocalCliRoutes(config, items);
    for (const provider of Object.values(config.providers)) {
        items.push(...providerShapeAudit(provider));
        const cwdItem = await providerCwdAudit(provider, config.assistant.workdir);
        if (cwdItem)
            items.push(cwdItem);
        const commandItem = await providerCommandAudit(provider, config.assistant.workdir);
        if (commandItem)
            items.push(commandItem);
    }
}
function auditCoreLocalCliRoutes(config, items) {
    for (const route of CORE_LOCAL_CLI_ROUTES) {
        const providers = configuredCoreRouteProviders(config, route);
        const wrongCommandProviders = providers.filter((provider) => commandBasename(provider.command) !== route.expectedCommand);
        if (providers.length === 0)
            continue;
        if (providers.length > 0 && wrongCommandProviders.length === 0) {
            items.push({
                severity: "pass",
                area: "provider",
                message: `${route.label} route uses logged-in local ${route.expectedCommand} CLI`
            });
            continue;
        }
        const found = wrongCommandProviders.map((provider) => `${provider.id} via ${commandBasename(provider.command)}`).join(", ");
        items.push({
            severity: "fail",
            area: "provider",
            message: `${route.label} route must use logged-in local ${route.expectedCommand} CLI (${found})`,
            next: `Configure ${route.ids.join(" or ")} with command '${route.expectedCommand}' instead of an HTTP/API client wrapper.`
        });
    }
}
function providerShapeAudit(provider) {
    const items = [];
    if (provider.promptMode === "template" && !provider.args.some((arg) => arg.includes("{prompt}"))) {
        items.push({
            severity: "fail",
            area: "provider",
            message: `${provider.id}: template promptMode has no {prompt} argument`,
            next: "Add {prompt} to provider.args or switch promptMode."
        });
    }
    else {
        items.push({ severity: "pass", area: "provider", message: `${provider.id}: prompt wiring looks valid` });
    }
    if (provider.promptMode === "stdin" && !provider.args.includes("-")) {
        items.push({
            severity: "warn",
            area: "provider",
            message: `${provider.id}: stdin promptMode has no '-' marker`,
            next: "This may be valid for some CLIs, but Codex-style providers usually need a trailing '-'."
        });
    }
    const secretEnvKeys = Object.keys(provider.env ?? {}).filter(looksSecretLike);
    if (secretEnvKeys.length > 0) {
        items.push({
            severity: "warn",
            area: "provider",
            message: `${provider.id}: provider.env contains secret-looking keys (${secretEnvKeys.join(", ")})`,
            next: "Prefer shell/.env secret injection over committed config values."
        });
    }
    const modelApiKeyEnvKeys = Object.keys(provider.env ?? {}).filter(isModelApiKeyEnvKey);
    if (modelApiKeyEnvKeys.length > 0) {
        items.push({
            severity: "fail",
            area: "provider",
            message: `${provider.id}: provider.env contains model API key variables (${modelApiKeyEnvKeys.join(", ")})`,
            next: "Remove model API key env values. Viser must call already logged-in local GPT/Gemini/Claude CLIs instead of model HTTP APIs."
        });
    }
    if (provider.timeoutMs < 5_000) {
        items.push({ severity: "warn", area: "provider", message: `${provider.id}: timeout is very short (${provider.timeoutMs}ms)` });
    }
    return items;
}
async function providerCwdAudit(provider, projectRoot) {
    if (!provider.cwd)
        return undefined;
    const cwdPath = resolve(provider.cwd);
    const project = resolve(projectRoot || cwd());
    const rel = relative(project, cwdPath);
    const outsideProject = rel.startsWith("..") || isAbsolute(rel);
    try {
        if (!outsideProject)
            await assertNoSymlinkComponentsUnderRoot(cwdPath, project);
        const info = await lstat(cwdPath);
        if (info.isSymbolicLink()) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider cwd is a symlink (${cwdPath})`,
                next: "Use a regular directory for providers.<id>.cwd."
            };
        }
        if (!info.isDirectory()) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider cwd is not a directory (${cwdPath})`,
                next: "Point providers.<id>.cwd at an existing regular directory."
            };
        }
        if (outsideProject) {
            return {
                severity: "warn",
                area: "provider",
                message: `${provider.id}: provider cwd is outside assistant workdir (${cwdPath})`,
                next: "Use this only when the provider CLI must run from an external checkout."
            };
        }
        return { severity: "pass", area: "provider", message: `${provider.id}: provider cwd is scoped under assistant workdir` };
    }
    catch (error) {
        if (error instanceof Error && /symlink/i.test(error.message)) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider cwd contains a symlink component (${cwdPath})`,
                next: "Use a regular directory under the assistant workdir for providers.<id>.cwd."
            };
        }
        if (isNodeError(error) && error.code === "ENOENT") {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider cwd does not exist (${cwdPath})`,
                next: "Create the directory or remove providers.<id>.cwd."
            };
        }
        return {
            severity: "warn",
            area: "provider",
            message: `${provider.id}: could not inspect provider cwd (${cwdPath})`,
            next: error instanceof Error ? error.message : String(error)
        };
    }
}
async function providerCommandAudit(provider, projectRoot) {
    if (!provider.command.includes("/"))
        return await providerPathCommandAudit(provider, projectRoot);
    const project = resolve(projectRoot || cwd());
    const commandRoot = resolve(provider.cwd ?? project);
    const commandPath = isAbsolute(provider.command) ? resolve(provider.command) : resolve(commandRoot, provider.command);
    if (!isAbsolute(provider.command) && !isInsideOrSame(commandPath, commandRoot)) {
        return {
            severity: "fail",
            area: "provider",
            message: `${provider.id}: provider command escapes its working directory (${commandPath})`,
            next: "Keep relative providers.<id>.command paths inside providers.<id>.cwd or assistant.workdir."
        };
    }
    const nofollowRoot = isInsideOrSame(commandPath, project)
        ? project
        : provider.cwd && isInsideOrSame(commandPath, commandRoot)
            ? commandRoot
            : undefined;
    if (!nofollowRoot) {
        return {
            severity: "warn",
            area: "provider",
            message: `${provider.id}: provider command path is outside assistant workdir (${commandPath})`,
            next: "Use an external absolute command path only when it is intentionally managed outside this project."
        };
    }
    try {
        await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
        const info = await lstat(commandPath);
        if (info.isSymbolicLink()) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider command is a symlink (${commandPath})`,
                next: "Use a regular executable for providers.<id>.command."
            };
        }
        if (!info.isFile()) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider command is not a regular file (${commandPath})`,
                next: "Point providers.<id>.command at an executable file or use a PATH command name."
            };
        }
        if ((info.mode & 0o111) === 0) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider command is not executable (${commandPath})`,
                next: "Run chmod +x on the provider command or use an installed PATH command."
            };
        }
        return { severity: "pass", area: "provider", message: `${provider.id}: provider command path is a regular executable` };
    }
    catch (error) {
        if (error instanceof Error && /symlink/i.test(error.message)) {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider command contains a symlink component (${commandPath})`,
                next: "Use a regular executable path under assistant.workdir/providers.<id>.cwd."
            };
        }
        if (isNodeError(error) && error.code === "ENOENT") {
            return {
                severity: "fail",
                area: "provider",
                message: `${provider.id}: provider command does not exist (${commandPath})`,
                next: "Install the provider command, fix providers.<id>.command, or use a PATH command name."
            };
        }
        return {
            severity: "warn",
            area: "provider",
            message: `${provider.id}: could not inspect provider command (${commandPath})`,
            next: error instanceof Error ? error.message : String(error)
        };
    }
}
async function providerPathCommandAudit(provider, projectRoot) {
    const project = resolve(projectRoot || cwd());
    const commandRoot = resolve(provider.cwd ?? project);
    const pathValue = provider.env?.PATH ?? process.env.PATH ?? "";
    for (const entry of pathValue.split(delimiter)) {
        if (!entry)
            continue;
        const dir = isAbsolute(entry) ? resolve(entry) : resolve(commandRoot, entry);
        const commandPath = join(dir, provider.command);
        try {
            await access(commandPath, constants.X_OK);
        }
        catch {
            continue;
        }
        const nofollowRoot = isInsideOrSame(commandPath, project)
            ? project
            : provider.cwd && isInsideOrSame(commandPath, commandRoot)
                ? commandRoot
                : undefined;
        if (!nofollowRoot)
            return undefined;
        try {
            await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
            const info = await lstat(commandPath);
            if (info.isSymbolicLink()) {
                return {
                    severity: "fail",
                    area: "provider",
                    message: `${provider.id}: provider PATH command is a symlink (${commandPath})`,
                    next: "Use a regular executable in provider PATH or an external package-manager command."
                };
            }
            if (!info.isFile()) {
                return {
                    severity: "fail",
                    area: "provider",
                    message: `${provider.id}: provider PATH command is not a regular file (${commandPath})`,
                    next: "Point PATH at directories that contain regular executable files."
                };
            }
            if ((info.mode & 0o111) === 0) {
                return {
                    severity: "fail",
                    area: "provider",
                    message: `${provider.id}: provider PATH command is not executable (${commandPath})`,
                    next: "Run chmod +x on the provider command or remove it from provider PATH."
                };
            }
            return undefined;
        }
        catch (error) {
            if (error instanceof Error && /symlink/i.test(error.message)) {
                return {
                    severity: "fail",
                    area: "provider",
                    message: `${provider.id}: provider PATH command contains a symlink component (${commandPath})`,
                    next: "Use a regular executable path under assistant.workdir/providers.<id>.cwd or an external package-manager command."
                };
            }
            return {
                severity: "warn",
                area: "provider",
                message: `${provider.id}: could not inspect provider PATH command (${commandPath})`,
                next: error instanceof Error ? error.message : String(error)
            };
        }
    }
    return undefined;
}
function auditAccessAndConnectors(config, configFile, items) {
    const telegramEnabled = config.connectors.telegram.enabled || Boolean(config.connectors.telegram.botToken);
    const discordEnabled = config.connectors.discord.enabled || Boolean(config.connectors.discord.botToken);
    const slackEnabled = config.connectors.slack.enabled || Boolean(config.connectors.slack.botToken);
    const matrixEnabled = config.connectors.matrix.enabled || Boolean(config.connectors.matrix.accessToken);
    const signalEnabled = config.connectors.signal.enabled || Boolean(config.connectors.signal.account);
    const imessageEnabled = config.connectors.imessage.enabled;
    const whatsappEnabled = config.connectors.whatsapp.enabled || Boolean(config.connectors.whatsapp.accessToken);
    const lineEnabled = config.connectors.line.enabled || Boolean(config.connectors.line.channelAccessToken);
    const kakaotalkEnabled = config.connectors.kakaotalk.enabled || Boolean(config.connectors.kakaotalk.requestToken);
    const googleChatEnabled = config.connectors.googleChat.enabled || hasConfiguredWebhook(config.connectors.googleChat);
    const genericWebhookEnabled = config.connectors.webhook.enabled || hasConfiguredWebhook(config.connectors.webhook);
    const homeAssistantEnabled = config.connectors.homeAssistant.enabled || hasHomeAssistantCredentials(config.connectors.homeAssistant);
    const teamsEnabled = config.connectors.teams.enabled || hasConfiguredWebhook(config.connectors.teams);
    const mattermostEnabled = config.connectors.mattermost.enabled || hasConfiguredWebhook(config.connectors.mattermost);
    const synologyChatEnabled = config.connectors.synologyChat.enabled || hasConfiguredWebhook(config.connectors.synologyChat);
    const rocketChatEnabled = config.connectors.rocketChat.enabled || hasConfiguredWebhook(config.connectors.rocketChat);
    const feishuEnabled = config.connectors.feishu.enabled || hasConfiguredWebhook(config.connectors.feishu);
    const dingTalkEnabled = config.connectors.dingtalk.enabled || hasConfiguredWebhook(config.connectors.dingtalk);
    const weComEnabled = config.connectors.wecom.enabled || hasConfiguredWebhook(config.connectors.wecom);
    const zaloEnabled = config.connectors.zalo.enabled || hasZaloCredentials(config.connectors.zalo);
    const ircEnabled = config.connectors.irc.enabled || hasIrcCredentials(config.connectors.irc);
    const twitchEnabled = config.connectors.twitch.enabled || hasTwitchCredentials(config.connectors.twitch);
    const ntfyEnabled = config.connectors.ntfy.enabled || hasNtfyTarget(config.connectors.ntfy);
    const mastodonEnabled = config.connectors.mastodon.enabled || hasMastodonCredentials(config.connectors.mastodon);
    const nextcloudTalkEnabled = config.connectors.nextcloudTalk.enabled || hasNextcloudTalkCredentials(config.connectors.nextcloudTalk);
    const webexEnabled = config.connectors.webex.enabled || Boolean(config.connectors.webex.accessToken);
    const zulipEnabled = config.connectors.zulip.enabled || hasZulipCredentials(config.connectors.zulip);
    const emailEnabled = config.connectors.email.enabled || hasEmailEnvelope(config.connectors.email);
    const githubEnabled = config.connectors.github.enabled || hasGitHubCredentials(config.connectors.github);
    const todoistEnabled = config.connectors.todoist.enabled || hasTodoistCredentials(config.connectors.todoist);
    const notionEnabled = config.connectors.notion.enabled || hasNotionCredentials(config.connectors.notion);
    const obsidianEnabled = config.connectors.obsidian.enabled || hasObsidianTarget(config.connectors.obsidian);
    const anyConnectorEnabled = telegramEnabled || discordEnabled || slackEnabled || matrixEnabled || signalEnabled || imessageEnabled || whatsappEnabled || lineEnabled || kakaotalkEnabled || googleChatEnabled || genericWebhookEnabled || homeAssistantEnabled || teamsEnabled || mattermostEnabled || synologyChatEnabled || rocketChatEnabled || feishuEnabled || dingTalkEnabled || weComEnabled || zaloEnabled || ircEnabled || twitchEnabled || ntfyEnabled || mastodonEnabled || nextcloudTalkEnabled || webexEnabled || zulipEnabled || emailEnabled || githubEnabled || todoistEnabled || notionEnabled || obsidianEnabled;
    if (!config.access.enabled && anyConnectorEnabled) {
        items.push({
            severity: "fail",
            area: "access",
            message: "messenger connector is active while access control is disabled",
            next: "Enable access control or keep connectors disabled."
        });
    }
    else if (config.access.defaultPolicy === "open" && anyConnectorEnabled) {
        items.push({
            severity: "fail",
            area: "access",
            message: "access.defaultPolicy=open with an active messenger connector",
            next: "Use pairing or allowlist for public Telegram/Discord/Slack/Matrix/Signal/iMessage/WhatsApp/LINE/KakaoTalk/Google Chat/generic Webhook/Home Assistant/Teams/Mattermost/Synology Chat/Rocket.Chat/Feishu/DingTalk/WeCom/Zalo/IRC/Twitch/ntfy/Mastodon/Nextcloud Talk/Webex/Zulip/Email/GitHub/Todoist/Notion connectors."
        });
    }
    else if (config.access.defaultPolicy === "open") {
        items.push({ severity: "warn", area: "access", message: "access.defaultPolicy=open", next: "Use pairing before enabling public connectors." });
    }
    else {
        items.push({ severity: "pass", area: "access", message: `access policy '${config.access.defaultPolicy}' is suitable for messenger use` });
    }
    if (config.access.pairingCodeTtlMs > 60 * 60 * 1000) {
        items.push({ severity: "warn", area: "access", message: "pairing code TTL exceeds 1 hour", next: "Short-lived pairing codes reduce takeover risk." });
    }
    if (config.connectors.discord.enabled && !config.connectors.discord.prefix.trim()) {
        items.push({ severity: "fail", area: "discord", message: "Discord prefix is empty while Discord is enabled" });
    }
    else {
        items.push({ severity: "pass", area: "discord", message: "Discord prefix/access shape is valid" });
    }
    if (config.connectors.slack.enabled && !config.connectors.slack.prefix.trim()) {
        items.push({ severity: "fail", area: "slack", message: "Slack prefix is empty while Slack is enabled" });
    }
    else {
        items.push({ severity: "pass", area: "slack", message: "Slack prefix/access shape is valid" });
    }
    if (config.connectors.matrix.enabled && !config.connectors.matrix.prefix.trim()) {
        items.push({ severity: "fail", area: "matrix", message: "Matrix prefix is empty while Matrix is enabled" });
    }
    else {
        items.push({ severity: "pass", area: "matrix", message: "Matrix prefix/access shape is valid" });
    }
    if (config.connectors.signal.enabled && !config.connectors.signal.account) {
        items.push({
            severity: "fail",
            area: "signal",
            message: "Signal is enabled without a local signal-cli account",
            next: `Set ${config.connectors.signal.accountEnv} or disable Signal.`
        });
    }
    else {
        items.push({ severity: "pass", area: "signal", message: "Signal account/access shape is valid" });
    }
    if (config.connectors.imessage.enabled && (!config.connectors.imessage.sqliteCommand.trim() || !config.connectors.imessage.osascriptCommand.trim() || !config.connectors.imessage.chatDbPath.trim())) {
        items.push({
            severity: "fail",
            area: "imessage",
            message: "iMessage is enabled without local Messages command configuration",
            next: `Set ${config.connectors.imessage.sqliteCommandEnv}/${config.connectors.imessage.osascriptCommandEnv}/${config.connectors.imessage.chatDbPathEnv} or disable iMessage.`
        });
    }
    else {
        items.push({ severity: "pass", area: "imessage", message: "iMessage local command/access shape is valid" });
    }
    if (config.connectors.whatsapp.enabled && (!config.connectors.whatsapp.accessToken || !config.connectors.whatsapp.phoneNumberId || !config.connectors.whatsapp.verifyToken)) {
        items.push({
            severity: "fail",
            area: "whatsapp",
            message: "WhatsApp is enabled without Cloud API token, phone number ID, or webhook verify token",
            next: `Set ${config.connectors.whatsapp.accessTokenEnv}/${config.connectors.whatsapp.phoneNumberIdEnv}/${config.connectors.whatsapp.verifyTokenEnv} or disable WhatsApp.`
        });
    }
    else {
        items.push({ severity: "pass", area: "whatsapp", message: "WhatsApp Cloud API access shape is valid" });
    }
    if (config.connectors.line.enabled && (!config.connectors.line.channelAccessToken || !config.connectors.line.channelSecret)) {
        items.push({
            severity: "fail",
            area: "line",
            message: "LINE is enabled without a channel access token or channel secret",
            next: `Set ${config.connectors.line.channelAccessTokenEnv}/${config.connectors.line.channelSecretEnv} or disable LINE.`
        });
    }
    else {
        items.push({ severity: "pass", area: "line", message: "LINE Messaging API access shape is valid" });
    }
    if (config.connectors.kakaotalk.enabled && !config.connectors.kakaotalk.requestToken) {
        items.push({
            severity: "fail",
            area: "kakaotalk",
            message: "KakaoTalk is enabled without a shared Skill request token",
            next: `Set ${config.connectors.kakaotalk.requestTokenEnv} or disable KakaoTalk.`
        });
    }
    else {
        items.push({ severity: "pass", area: "kakaotalk", message: "KakaoTalk Open Builder Skill access shape is valid" });
    }
    if (config.connectors.googleChat.enabled && !hasConfiguredWebhook(config.connectors.googleChat)) {
        items.push({
            severity: "fail",
            area: "google-chat",
            message: "Google Chat is enabled without an incoming webhook URL",
            next: `Set ${config.connectors.googleChat.webhookUrlEnv}/${config.connectors.googleChat.webhookUrlsEnv} or disable Google Chat.`
        });
    }
    else {
        items.push({ severity: "pass", area: "google-chat", message: "Google Chat webhook access shape is valid" });
    }
    if (config.connectors.webhook.enabled && !hasConfiguredWebhook(config.connectors.webhook)) {
        items.push({
            severity: "fail",
            area: "webhook",
            message: "Generic webhook is enabled without an HTTPS webhook URL",
            next: `Set ${config.connectors.webhook.webhookUrlEnv}/${config.connectors.webhook.webhookUrlsEnv} or disable generic Webhook.`
        });
    }
    else {
        items.push({ severity: "pass", area: "webhook", message: "Generic HTTPS webhook access shape is valid" });
    }
    if (config.connectors.webhook.inboundEnabled && !isStrongSharedSecret(config.connectors.webhook.inboundToken)) {
        items.push({
            severity: "fail",
            area: "webhook-inbound",
            message: "Generic inbound webhook is enabled without a strong shared token",
            next: `Set ${config.connectors.webhook.inboundTokenEnv ?? "VISER_WEBHOOK_INBOUND_TOKEN"} to a high-entropy token or disable connectors.webhook.inboundEnabled.`
        });
    }
    else if (config.connectors.webhook.inboundEnabled && !config.webDashboard.enabled) {
        items.push({
            severity: "fail",
            area: "webhook-inbound",
            message: "Generic inbound webhook is enabled but the web dashboard server is disabled",
            next: "Enable webDashboard for the foreground HTTP server or disable connectors.webhook.inboundEnabled."
        });
    }
    else if (config.connectors.webhook.inboundEnabled) {
        items.push({ severity: "pass", area: "webhook-inbound", message: "Generic inbound webhook requires a strong shared token" });
    }
    if (config.connectors.webhook.inboundSignatureSecret && !isStrongSharedSecret(config.connectors.webhook.inboundSignatureSecret)) {
        items.push({
            severity: "fail",
            area: "webhook-inbound",
            message: "Generic inbound webhook signature secret is too weak",
            next: `Set ${config.connectors.webhook.inboundSignatureSecretEnv ?? "VISER_WEBHOOK_INBOUND_SIGNATURE_SECRET"} to a high-entropy secret or remove it.`
        });
    }
    else if (config.connectors.webhook.inboundEnabled && config.connectors.webhook.inboundSignatureSecret) {
        items.push({ severity: "pass", area: "webhook-inbound", message: "Generic inbound webhook signature secret is strong" });
    }
    if (config.connectors.homeAssistant.enabled && !hasHomeAssistantCredentials(config.connectors.homeAssistant)) {
        items.push({
            severity: "fail",
            area: "home-assistant",
            message: "Home Assistant is enabled without base URL, access token, or a configured service alias",
            next: `Set ${config.connectors.homeAssistant.baseUrlEnv}/${config.connectors.homeAssistant.accessTokenEnv}/${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv} or disable Home Assistant.`
        });
    }
    else {
        items.push({ severity: "pass", area: "home-assistant", message: "Home Assistant service-call access shape is valid" });
    }
    if (config.connectors.teams.enabled && !hasConfiguredWebhook(config.connectors.teams)) {
        items.push({
            severity: "fail",
            area: "teams",
            message: "Microsoft Teams is enabled without an incoming webhook URL",
            next: `Set ${config.connectors.teams.webhookUrlEnv}/${config.connectors.teams.webhookUrlsEnv} or disable Teams.`
        });
    }
    else {
        items.push({ severity: "pass", area: "teams", message: "Microsoft Teams webhook access shape is valid" });
    }
    if (config.connectors.mattermost.enabled && !hasConfiguredWebhook(config.connectors.mattermost)) {
        items.push({
            severity: "fail",
            area: "mattermost",
            message: "Mattermost is enabled without an incoming webhook URL",
            next: `Set ${config.connectors.mattermost.webhookUrlEnv}/${config.connectors.mattermost.webhookUrlsEnv} or disable Mattermost.`
        });
    }
    else {
        items.push({ severity: "pass", area: "mattermost", message: "Mattermost webhook access shape is valid" });
    }
    if (config.connectors.synologyChat.enabled && !hasConfiguredWebhook(config.connectors.synologyChat)) {
        items.push({
            severity: "fail",
            area: "synology-chat",
            message: "Synology Chat is enabled without an incoming webhook URL",
            next: `Set ${config.connectors.synologyChat.webhookUrlEnv}/${config.connectors.synologyChat.webhookUrlsEnv} or disable Synology Chat.`
        });
    }
    else {
        items.push({ severity: "pass", area: "synology-chat", message: "Synology Chat webhook access shape is valid" });
    }
    if (config.connectors.rocketChat.enabled && !hasConfiguredWebhook(config.connectors.rocketChat)) {
        items.push({
            severity: "fail",
            area: "rocket-chat",
            message: "Rocket.Chat is enabled without an incoming webhook URL",
            next: `Set ${config.connectors.rocketChat.webhookUrlEnv}/${config.connectors.rocketChat.webhookUrlsEnv} or disable Rocket.Chat.`
        });
    }
    else {
        items.push({ severity: "pass", area: "rocket-chat", message: "Rocket.Chat webhook access shape is valid" });
    }
    if (config.connectors.feishu.enabled && !hasConfiguredWebhook(config.connectors.feishu)) {
        items.push({
            severity: "fail",
            area: "feishu",
            message: "Feishu is enabled without a custom bot webhook URL",
            next: `Set ${config.connectors.feishu.webhookUrlEnv}/${config.connectors.feishu.webhookUrlsEnv} or disable Feishu.`
        });
    }
    else {
        items.push({ severity: "pass", area: "feishu", message: "Feishu webhook access shape is valid" });
    }
    if (config.connectors.dingtalk.enabled && !hasConfiguredWebhook(config.connectors.dingtalk)) {
        items.push({
            severity: "fail",
            area: "dingtalk",
            message: "DingTalk is enabled without a custom robot webhook URL",
            next: `Set ${config.connectors.dingtalk.webhookUrlEnv}/${config.connectors.dingtalk.webhookUrlsEnv} or disable DingTalk.`
        });
    }
    else {
        items.push({ severity: "pass", area: "dingtalk", message: "DingTalk webhook access shape is valid" });
    }
    if (config.connectors.wecom.enabled && !hasConfiguredWebhook(config.connectors.wecom)) {
        items.push({
            severity: "fail",
            area: "wecom",
            message: "WeCom is enabled without a group robot webhook URL",
            next: `Set ${config.connectors.wecom.webhookUrlEnv}/${config.connectors.wecom.webhookUrlsEnv} or disable WeCom.`
        });
    }
    else {
        items.push({ severity: "pass", area: "wecom", message: "WeCom webhook access shape is valid" });
    }
    if (config.connectors.zalo.enabled && !hasZaloCredentials(config.connectors.zalo)) {
        items.push({
            severity: "fail",
            area: "zalo",
            message: "Zalo is enabled without an OA access token and recipient alias",
            next: `Set ${config.connectors.zalo.accessTokenEnv} and ${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv} or disable Zalo.`
        });
    }
    else {
        items.push({ severity: "pass", area: "zalo", message: "Zalo OA access shape is valid" });
    }
    if (config.connectors.irc.enabled && !hasIrcCredentials(config.connectors.irc)) {
        items.push({
            severity: "fail",
            area: "irc",
            message: "IRC is enabled without host, nick, and channel alias",
            next: `Set ${config.connectors.irc.hostEnv}/${config.connectors.irc.nickEnv}/${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv} or disable IRC.`
        });
    }
    else {
        items.push({ severity: "pass", area: "irc", message: "IRC access shape is valid" });
    }
    if (config.connectors.twitch.enabled && !hasTwitchCredentials(config.connectors.twitch)) {
        items.push({
            severity: "fail",
            area: "twitch",
            message: "Twitch is enabled without OAuth token, bot username, and channel alias",
            next: `Set ${config.connectors.twitch.accessTokenEnv}/${config.connectors.twitch.botUsernameEnv}/${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv} or disable Twitch.`
        });
    }
    else {
        items.push({ severity: "pass", area: "twitch", message: "Twitch IRC access shape is valid" });
    }
    if (config.connectors.ntfy.enabled && !hasNtfyTarget(config.connectors.ntfy)) {
        items.push({
            severity: "fail",
            area: "ntfy",
            message: "ntfy is enabled without a topic alias",
            next: `Set ${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv} or disable ntfy.`
        });
    }
    else {
        items.push({ severity: "pass", area: "ntfy", message: "ntfy push access shape is valid" });
    }
    if (config.connectors.mastodon.enabled && !hasMastodonCredentials(config.connectors.mastodon)) {
        items.push({
            severity: "fail",
            area: "mastodon",
            message: "Mastodon is enabled without base URL and access token",
            next: `Set ${config.connectors.mastodon.baseUrlEnv}/${config.connectors.mastodon.accessTokenEnv} or disable Mastodon.`
        });
    }
    else {
        items.push({ severity: "pass", area: "mastodon", message: "Mastodon status access shape is valid" });
    }
    if (config.connectors.nextcloudTalk.enabled && !hasNextcloudTalkCredentials(config.connectors.nextcloudTalk)) {
        items.push({
            severity: "fail",
            area: "nextcloud-talk",
            message: "Nextcloud Talk is enabled without base URL, username, app password, and room alias",
            next: `Set ${config.connectors.nextcloudTalk.baseUrlEnv}/${config.connectors.nextcloudTalk.usernameEnv}/${config.connectors.nextcloudTalk.appPasswordEnv}/${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv} or disable Nextcloud Talk.`
        });
    }
    else {
        items.push({ severity: "pass", area: "nextcloud-talk", message: "Nextcloud Talk OCS access shape is valid" });
    }
    if (config.connectors.webex.enabled && !config.connectors.webex.accessToken) {
        items.push({
            severity: "fail",
            area: "webex",
            message: "Webex is enabled without a Messages API access token",
            next: `Set ${config.connectors.webex.accessTokenEnv} or disable Webex.`
        });
    }
    else {
        items.push({ severity: "pass", area: "webex", message: "Webex Messages API access shape is valid" });
    }
    if (config.connectors.zulip.enabled && (!hasZulipCredentials(config.connectors.zulip) || !hasZulipTarget(config.connectors.zulip))) {
        items.push({
            severity: "fail",
            area: "zulip",
            message: "Zulip is enabled without site URL, bot email, API key, or target alias configuration",
            next: `Set ${config.connectors.zulip.siteUrlEnv}/${config.connectors.zulip.botEmailEnv}/${config.connectors.zulip.apiKeyEnv}/${config.connectors.zulip.targetEnv}/${config.connectors.zulip.targetsEnv} or disable Zulip.`
        });
    }
    else {
        items.push({ severity: "pass", area: "zulip", message: "Zulip Messages API access shape is valid" });
    }
    if (config.connectors.email.enabled && (!config.connectors.email.from || !hasEmailEnvelope(config.connectors.email) || !config.connectors.email.sendmailCommand.trim())) {
        items.push({
            severity: "fail",
            area: "email",
            message: "Email is enabled without local sendmail command, from address, or recipient alias configuration",
            next: `Set ${config.connectors.email.sendmailCommandEnv}/${config.connectors.email.fromEnv}/${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv} or disable Email.`
        });
    }
    else {
        items.push({ severity: "pass", area: "email", message: "Email local sendmail access shape is valid" });
    }
    if (config.connectors.github.enabled && !hasGitHubCredentials(config.connectors.github)) {
        items.push({
            severity: "fail",
            area: "github",
            message: "GitHub is enabled without token and issue/PR target alias configuration",
            next: `Set ${config.connectors.github.tokenEnv}/${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv} or disable GitHub.`
        });
    }
    else {
        items.push({ severity: "pass", area: "github", message: "GitHub issue/PR comment access shape is valid" });
    }
    if (config.connectors.todoist.enabled && !hasTodoistCredentials(config.connectors.todoist)) {
        items.push({
            severity: "fail",
            area: "todoist",
            message: "Todoist is enabled without an API token",
            next: `Set ${config.connectors.todoist.tokenEnv}/${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv} or disable Todoist.`
        });
    }
    else {
        items.push({ severity: "pass", area: "todoist", message: "Todoist task-create access shape is valid" });
    }
    if (config.connectors.notion.enabled && !hasNotionCredentials(config.connectors.notion)) {
        items.push({
            severity: "fail",
            area: "notion",
            message: "Notion is enabled without token and page alias configuration",
            next: `Set ${config.connectors.notion.tokenEnv}/${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv} or disable Notion.`
        });
    }
    else {
        items.push({ severity: "pass", area: "notion", message: "Notion page append access shape is valid" });
    }
    if (config.connectors.obsidian.enabled && !hasObsidianTarget(config.connectors.obsidian)) {
        items.push({
            severity: "fail",
            area: "obsidian",
            message: "Obsidian is enabled without vault and note alias configuration",
            next: `Set ${config.connectors.obsidian.vaultDirEnv}/${config.connectors.obsidian.noteEnv}/${config.connectors.obsidian.notesEnv} or disable Obsidian.`
        });
    }
    else {
        items.push({ severity: "pass", area: "obsidian", message: "Obsidian local note append access shape is valid" });
    }
    if (hasPath(configFile, ["connectors", "telegram", "botToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Telegram token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.telegram.botTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "discord", "botToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Discord token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.discord.botTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "slack", "botToken"]) || hasPath(configFile, ["connectors", "slack", "appToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Slack token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.slack.botTokenEnv}/${config.connectors.slack.appTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "matrix", "accessToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Matrix token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.matrix.accessTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "signal", "account"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Signal account appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.signal.accountEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "whatsapp", "accessToken"]) || hasPath(configFile, ["connectors", "whatsapp", "phoneNumberId"]) || hasPath(configFile, ["connectors", "whatsapp", "verifyToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "WhatsApp credential appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.whatsapp.accessTokenEnv}/${config.connectors.whatsapp.phoneNumberIdEnv}/${config.connectors.whatsapp.verifyTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "line", "channelAccessToken"]) || hasPath(configFile, ["connectors", "line", "channelSecret"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "LINE credential appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.line.channelAccessTokenEnv}/${config.connectors.line.channelSecretEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "kakaotalk", "requestToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "KakaoTalk Skill shared token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.kakaotalk.requestTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "googleChat", "webhookUrl"]) || hasPath(configFile, ["connectors", "googleChat", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Google Chat webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.googleChat.webhookUrlEnv}/${config.connectors.googleChat.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "webhook", "webhookUrl"]) || hasPath(configFile, ["connectors", "webhook", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Generic webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.webhook.webhookUrlEnv}/${config.connectors.webhook.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "webhook", "inboundToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Generic inbound webhook token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.webhook.inboundTokenEnv ?? "VISER_WEBHOOK_INBOUND_TOKEN"} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "homeAssistant", "baseUrl"])
        || hasPath(configFile, ["connectors", "homeAssistant", "accessToken"])
        || hasPath(configFile, ["connectors", "homeAssistant", "service"])
        || hasPath(configFile, ["connectors", "homeAssistant", "services"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Home Assistant URL, token, or service alias appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.homeAssistant.baseUrlEnv}/${config.connectors.homeAssistant.accessTokenEnv}/${config.connectors.homeAssistant.serviceEnv}/${config.connectors.homeAssistant.servicesEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "teams", "webhookUrl"]) || hasPath(configFile, ["connectors", "teams", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Microsoft Teams webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.teams.webhookUrlEnv}/${config.connectors.teams.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "mattermost", "webhookUrl"]) || hasPath(configFile, ["connectors", "mattermost", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Mattermost webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.mattermost.webhookUrlEnv}/${config.connectors.mattermost.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "synologyChat", "webhookUrl"]) || hasPath(configFile, ["connectors", "synologyChat", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Synology Chat webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.synologyChat.webhookUrlEnv}/${config.connectors.synologyChat.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "rocketChat", "webhookUrl"]) || hasPath(configFile, ["connectors", "rocketChat", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Rocket.Chat webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.rocketChat.webhookUrlEnv}/${config.connectors.rocketChat.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "feishu", "webhookUrl"]) || hasPath(configFile, ["connectors", "feishu", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Feishu webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.feishu.webhookUrlEnv}/${config.connectors.feishu.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "dingtalk", "webhookUrl"]) || hasPath(configFile, ["connectors", "dingtalk", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "DingTalk webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.dingtalk.webhookUrlEnv}/${config.connectors.dingtalk.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "wecom", "webhookUrl"]) || hasPath(configFile, ["connectors", "wecom", "webhookUrls"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "WeCom webhook URL appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.wecom.webhookUrlEnv}/${config.connectors.wecom.webhookUrlsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "zalo", "accessToken"]) || hasPath(configFile, ["connectors", "zalo", "recipient"]) || hasPath(configFile, ["connectors", "zalo", "recipients"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Zalo OA token or recipient appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.zalo.accessTokenEnv}/${config.connectors.zalo.recipientEnv}/${config.connectors.zalo.recipientsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "irc", "host"]) || hasPath(configFile, ["connectors", "irc", "nick"]) || hasPath(configFile, ["connectors", "irc", "password"]) || hasPath(configFile, ["connectors", "irc", "channel"]) || hasPath(configFile, ["connectors", "irc", "channels"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "IRC host, password, nick, or channel appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.irc.hostEnv}/${config.connectors.irc.nickEnv}/${config.connectors.irc.passwordEnv}/${config.connectors.irc.channelEnv}/${config.connectors.irc.channelsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "twitch", "accessToken"]) || hasPath(configFile, ["connectors", "twitch", "botUsername"]) || hasPath(configFile, ["connectors", "twitch", "channel"]) || hasPath(configFile, ["connectors", "twitch", "channels"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Twitch OAuth token, username, or channel appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.twitch.accessTokenEnv}/${config.connectors.twitch.botUsernameEnv}/${config.connectors.twitch.channelEnv}/${config.connectors.twitch.channelsEnv} or .env.`
        });
    }
    const ntfyBaseUrl = getPathValue(configFile, ["connectors", "ntfy", "baseUrl"]);
    const hasPrivateNtfyBaseUrl = typeof ntfyBaseUrl === "string" && normalizeNtfyBaseUrlForAudit(ntfyBaseUrl) !== "https://ntfy.sh";
    if (hasPrivateNtfyBaseUrl || hasPath(configFile, ["connectors", "ntfy", "token"]) || hasPath(configFile, ["connectors", "ntfy", "topic"]) || hasPath(configFile, ["connectors", "ntfy", "topics"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "non-default ntfy base URL, token, or topic appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.ntfy.baseUrlEnv}/${config.connectors.ntfy.tokenEnv}/${config.connectors.ntfy.topicEnv}/${config.connectors.ntfy.topicsEnv} or .env.`
        });
    }
    const hasDirectMastodonBaseUrl = hasPath(configFile, ["connectors", "mastodon", "baseUrl"]);
    const hasDirectMastodonAccessToken = hasPath(configFile, ["connectors", "mastodon", "accessToken"]);
    const hasDirectMastodonTargets = hasPath(configFile, ["connectors", "mastodon", "targets"]);
    const hasDirectMastodonVisibility = hasPath(configFile, ["connectors", "mastodon", "visibility"]);
    const hasActiveMastodonRoute = Boolean(config.connectors.mastodon.enabled ||
        config.connectors.mastodon.baseUrl ||
        config.connectors.mastodon.accessToken ||
        Object.keys(config.connectors.mastodon.targets).length ||
        config.connectors.mastodon.allowedTargetIds.length ||
        config.connectors.mastodon.defaultTargetIds.length);
    if (hasDirectMastodonBaseUrl || hasDirectMastodonAccessToken || hasDirectMastodonTargets || (hasDirectMastodonVisibility && hasActiveMastodonRoute)) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Mastodon URL, access token, visibility, or target aliases appear to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.mastodon.baseUrlEnv}/${config.connectors.mastodon.accessTokenEnv}/${config.connectors.mastodon.visibilityEnv}/${config.connectors.mastodon.targetsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "nextcloudTalk", "baseUrl"]) || hasPath(configFile, ["connectors", "nextcloudTalk", "username"]) || hasPath(configFile, ["connectors", "nextcloudTalk", "appPassword"]) || hasPath(configFile, ["connectors", "nextcloudTalk", "roomToken"]) || hasPath(configFile, ["connectors", "nextcloudTalk", "rooms"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Nextcloud Talk URL, username, app password, or room token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.nextcloudTalk.baseUrlEnv}/${config.connectors.nextcloudTalk.usernameEnv}/${config.connectors.nextcloudTalk.appPasswordEnv}/${config.connectors.nextcloudTalk.roomTokenEnv}/${config.connectors.nextcloudTalk.roomsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "webex", "accessToken"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Webex token appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.webex.accessTokenEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "zulip", "siteUrl"]) || hasPath(configFile, ["connectors", "zulip", "botEmail"]) || hasPath(configFile, ["connectors", "zulip", "apiKey"]) || hasPath(configFile, ["connectors", "zulip", "target"]) || hasPath(configFile, ["connectors", "zulip", "targets"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Zulip credential or target appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.zulip.siteUrlEnv}/${config.connectors.zulip.botEmailEnv}/${config.connectors.zulip.apiKeyEnv}/${config.connectors.zulip.targetEnv}/${config.connectors.zulip.targetsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "email", "from"]) || hasPath(configFile, ["connectors", "email", "recipient"]) || hasPath(configFile, ["connectors", "email", "recipients"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Email address or recipient alias appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.email.fromEnv}/${config.connectors.email.recipientEnv}/${config.connectors.email.recipientsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "github", "token"]) || hasPath(configFile, ["connectors", "github", "target"]) || hasPath(configFile, ["connectors", "github", "targets"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "GitHub token or issue target appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.github.tokenEnv}/${config.connectors.github.targetEnv}/${config.connectors.github.targetsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "todoist", "token"]) || hasPath(configFile, ["connectors", "todoist", "project"]) || hasPath(configFile, ["connectors", "todoist", "projects"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Todoist token or project target appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.todoist.tokenEnv}/${config.connectors.todoist.projectEnv}/${config.connectors.todoist.projectsEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webFetch", "firecrawlApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Firecrawl web-fetch API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webFetch.firecrawlApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "braveApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Brave Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.braveApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "tavilyApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Tavily Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.tavilyApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "perplexityApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Perplexity Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.perplexityApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "exaApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Exa Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.exaApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "firecrawlApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Firecrawl Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.firecrawlApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["tools", "webSearch", "ollamaApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Ollama Web Search API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.tools.webSearch.ollamaApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["actions", "browserTask", "browserUseApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Browser Use API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.actions.browserTask.browserUseApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["actions", "browserTask", "browserbaseApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Browserbase API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.actions.browserTask.browserbaseApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["actions", "browserTask", "firecrawlApiKey"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Firecrawl browser-task API key appears to be stored directly in viser.config.json",
            next: `Move it to ${config.actions.browserTask.firecrawlApiKeyEnv} or .env.`
        });
    }
    if (hasPath(configFile, ["connectors", "notion", "token"]) || hasPath(configFile, ["connectors", "notion", "page"]) || hasPath(configFile, ["connectors", "notion", "pages"])) {
        items.push({
            severity: "fail",
            area: "secret",
            message: "Notion token or page target appears to be stored directly in viser.config.json",
            next: `Move it to ${config.connectors.notion.tokenEnv}/${config.connectors.notion.pageEnv}/${config.connectors.notion.pagesEnv} or .env.`
        });
    }
}
function hasConfiguredWebhook(config) {
    return Boolean(config.webhookUrl || Object.keys(config.webhookUrls).length > 0);
}
function hasHomeAssistantCredentials(config) {
    return Boolean(config.baseUrl && config.accessToken && (config.service || Object.keys(config.services).length > 0));
}
function hasIrcCredentials(config) {
    return Boolean(config.host && config.nick && (config.channel || Object.keys(config.channels).length > 0));
}
function hasTwitchCredentials(config) {
    return Boolean(config.accessToken && config.botUsername && (config.channel || Object.keys(config.channels).length > 0));
}
function hasNtfyTarget(config) {
    return Boolean(config.topic || Object.keys(config.topics).length > 0);
}
function hasMastodonCredentials(config) {
    return Boolean(config.baseUrl && config.accessToken);
}
function hasNextcloudTalkCredentials(config) {
    return Boolean(config.baseUrl && config.username && config.appPassword && (config.roomToken || Object.keys(config.rooms).length > 0));
}
function hasZulipCredentials(config) {
    return Boolean(config.siteUrl && config.botEmail && config.apiKey);
}
function hasZaloCredentials(config) {
    return Boolean(config.accessToken && (config.recipient || Object.keys(config.recipients).length > 0));
}
function hasZulipTarget(config) {
    return Boolean(config.target || Object.keys(config.targets).length > 0);
}
function hasEmailEnvelope(config) {
    return Boolean(config.recipient || Object.keys(config.recipients).length > 0);
}
function hasGitHubCredentials(config) {
    return Boolean(config.token && (config.target || Object.keys(config.targets).length > 0));
}
function hasTodoistCredentials(config) {
    return Boolean(config.token);
}
function hasNotionCredentials(config) {
    return Boolean(config.token && (config.page || Object.keys(config.pages).length > 0));
}
function hasObsidianTarget(config) {
    return Boolean(config.vaultDir && (config.note || Object.keys(config.notes).length > 0));
}
async function auditActions(config, items) {
    if (!config.actions.enabled) {
        items.push({ severity: "warn", area: "actions", message: "approval-gated write actions are disabled" });
        return;
    }
    items.push({ severity: "pass", area: "actions", message: "approval-gated write actions are enabled" });
    if (!config.actions.createBackups) {
        items.push({ severity: "warn", area: "actions", message: "file backups are disabled for approved writes" });
    }
    if (config.actions.maxWriteBytes > 1_000_000) {
        items.push({ severity: "warn", area: "actions", message: `maxWriteBytes is high (${config.actions.maxWriteBytes})` });
    }
    for (const root of config.actions.allowedWriteRoots) {
        items.push(writeRootAudit(root, config.assistant.workdir));
        const symlinkItem = await workspaceRootSymlinkAudit(root, config.assistant.workdir, "actions", "write root");
        if (symlinkItem)
            items.push(symlinkItem);
    }
}
async function auditTools(config, items) {
    if (!config.tools.enabled) {
        items.push({ severity: "warn", area: "tools", message: "local tools are disabled" });
        return;
    }
    items.push({ severity: "pass", area: "tools", message: "local tools are enabled" });
    const dangerous = config.tools.shell.allowedCommands.filter((command) => MUTATING_SHELL_COMMANDS.has(basename(command)));
    if (dangerous.length > 0) {
        items.push({
            severity: "fail",
            area: "tools",
            message: `shell allowlist contains mutating/network-capable commands: ${dangerous.join(", ")}`,
            next: "Keep shell tools read-only; use approval-gated actions for writes."
        });
    }
    else {
        items.push({ severity: "pass", area: "tools", message: "shell allowlist is read-oriented" });
    }
    if (config.tools.shell.timeoutMs > 5 * 60 * 1000) {
        items.push({ severity: "warn", area: "tools", message: `shell timeout is long (${config.tools.shell.timeoutMs}ms)` });
    }
    if (config.tools.shell.enabled) {
        items.push(...await shellCommandAuditItems(config));
    }
    if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "browser-use-cloud" && !config.actions.browserTask.browserUseApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "actions",
            message: "Browser Use cloud browser-task action is enabled without an API key",
            next: `Set ${config.actions.browserTask.browserUseApiKeyEnv} in a private env file or disable actions.browserTask.enabled, or choose provider=local-cdp for localhost CDP automation.`
        });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "browser-use-cloud") {
        items.push({ severity: "pass", area: "actions", message: "Browser Use cloud browser-task action has a redacted API key configured" });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "local-cdp") {
        items.push({ severity: "pass", area: "actions", message: "local CDP browser-task action uses a localhost DevTools endpoint and no cloud API key" });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "browserbase-session" && !config.actions.browserTask.browserbaseApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "actions",
            message: "Browserbase session browser-task action is enabled without an API key",
            next: `Set ${config.actions.browserTask.browserbaseApiKeyEnv} in a private env file or disable actions.browserTask.enabled.`
        });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "browserbase-session") {
        items.push({ severity: "pass", area: "actions", message: "Browserbase session browser-task action has a redacted API key configured" });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "firecrawl-interact" && !config.actions.browserTask.firecrawlApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "actions",
            message: "Firecrawl interact browser-task action is enabled without an API key",
            next: `Set ${config.actions.browserTask.firecrawlApiKeyEnv} in a private env file or disable actions.browserTask.enabled.`
        });
    }
    else if (config.actions.browserTask.enabled && config.actions.browserTask.provider === "firecrawl-interact") {
        items.push({ severity: "pass", area: "actions", message: "Firecrawl interact browser-task action has a redacted API key configured" });
    }
    else {
        items.push({ severity: "pass", area: "actions", message: "Browser task action is disabled by default" });
    }
    if (config.tools.webFetch.provider === "firecrawl-api" && !config.tools.webFetch.firecrawlApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Firecrawl web-fetch provider is selected without an API key",
            next: `Set ${config.tools.webFetch.firecrawlApiKeyEnv} in a private env file or choose direct-http.`
        });
    }
    else if (config.tools.webFetch.provider === "firecrawl-api") {
        items.push({ severity: "pass", area: "tools", message: "Firecrawl web-fetch provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "brave-api" && !config.tools.webSearch.braveApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Brave web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.braveApiKeyEnv} in a private env file or choose duckduckgo-html/searxng-html/tavily-api/perplexity-api/exa-api/firecrawl-api/ollama-api.`
        });
    }
    else if (config.tools.webSearch.provider === "brave-api") {
        items.push({ severity: "pass", area: "tools", message: "Brave web-search provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "tavily-api" && !config.tools.webSearch.tavilyApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Tavily web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.tavilyApiKeyEnv} in a private env file or choose duckduckgo-html/searxng-html/brave-api/perplexity-api/exa-api/firecrawl-api/ollama-api.`
        });
    }
    else if (config.tools.webSearch.provider === "tavily-api") {
        items.push({ severity: "pass", area: "tools", message: "Tavily web-search provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "perplexity-api" && !config.tools.webSearch.perplexityApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Perplexity web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.perplexityApiKeyEnv} in a private env file or choose duckduckgo-html/searxng-html/brave-api/tavily-api/exa-api/firecrawl-api/ollama-api.`
        });
    }
    else if (config.tools.webSearch.provider === "perplexity-api") {
        items.push({ severity: "pass", area: "tools", message: "Perplexity web-search provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "exa-api" && !config.tools.webSearch.exaApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Exa web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.exaApiKeyEnv} in a private env file or choose duckduckgo-html/searxng-html/brave-api/tavily-api/perplexity-api/firecrawl-api/ollama-api.`
        });
    }
    else if (config.tools.webSearch.provider === "exa-api") {
        items.push({ severity: "pass", area: "tools", message: "Exa web-search provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "firecrawl-api" && !config.tools.webSearch.firecrawlApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Firecrawl web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.firecrawlApiKeyEnv} in a private env file or choose duckduckgo-html/searxng-html/brave-api/tavily-api/perplexity-api/exa-api/ollama-api.`
        });
    }
    else if (config.tools.webSearch.provider === "firecrawl-api") {
        items.push({ severity: "pass", area: "tools", message: "Firecrawl web-search provider has a redacted API key configured" });
    }
    if (config.tools.webSearch.provider === "ollama-api" && isHostedOllamaBaseUrlForAudit(config.tools.webSearch.ollamaBaseUrl) && !config.tools.webSearch.ollamaApiKey?.trim()) {
        items.push({
            severity: "fail",
            area: "tools",
            message: "Hosted Ollama web-search provider is selected without an API key",
            next: `Set ${config.tools.webSearch.ollamaApiKeyEnv} in a private env file or point ollamaBaseUrl at a signed-in local daemon.`
        });
    }
    else if (config.tools.webSearch.provider === "ollama-api") {
        items.push({
            severity: "pass",
            area: "tools",
            message: isHostedOllamaBaseUrlForAudit(config.tools.webSearch.ollamaBaseUrl)
                ? "Hosted Ollama web-search provider has a redacted API key configured"
                : "Local Ollama web-search provider uses the configured daemon without a model API key"
        });
    }
    for (const root of config.tools.allowedReadRoots) {
        items.push(readRootAudit(root, config.assistant.workdir));
        const symlinkItem = await workspaceRootSymlinkAudit(root, config.assistant.workdir, "tools", "read root");
        if (symlinkItem)
            items.push(symlinkItem);
    }
}
async function shellCommandAuditItems(config) {
    const items = [];
    const project = resolve(config.assistant.workdir || cwd());
    const commandRoot = resolve(config.tools.allowedReadRoots[0] ?? project);
    for (const command of config.tools.shell.allowedCommands) {
        const item = command.includes("/")
            ? await shellPathCommandAudit(command, project, commandRoot)
            : await shellPathSearchCommandAudit(command, project, commandRoot);
        if (item)
            items.push(item);
    }
    return items;
}
async function shellPathCommandAudit(command, project, commandRoot) {
    const commandPath = isAbsolute(command) ? resolve(command) : resolve(commandRoot, command);
    if (!isAbsolute(command) && !isInsideOrSame(commandPath, commandRoot)) {
        return {
            severity: "fail",
            area: "tools",
            message: `shell command escapes the tool read root (${commandPath})`,
            next: "Keep relative tools.shell.allowedCommands paths inside tools.allowedReadRoots[0] or use a PATH command name."
        };
    }
    const nofollowRoot = shellCommandNoFollowRoot(commandPath, project, commandRoot);
    if (!nofollowRoot) {
        return {
            severity: "warn",
            area: "tools",
            message: `shell command path is outside assistant workdir/read root (${commandPath})`,
            next: "Use an external absolute command path only when it is intentionally managed outside this project."
        };
    }
    return await inspectShellCommandPath(commandPath, nofollowRoot, "shell command");
}
async function shellPathSearchCommandAudit(command, project, commandRoot) {
    const pathValue = process.env.PATH ?? "";
    for (const entry of pathValue.split(delimiter)) {
        if (!entry)
            continue;
        const dir = isAbsolute(entry) ? resolve(entry) : resolve(commandRoot, entry);
        const commandPath = join(dir, command);
        try {
            await access(commandPath, constants.X_OK);
        }
        catch {
            continue;
        }
        const nofollowRoot = shellCommandNoFollowRoot(commandPath, project, commandRoot);
        if (!nofollowRoot)
            return undefined;
        return await inspectShellCommandPath(commandPath, nofollowRoot, "shell PATH command");
    }
    return undefined;
}
function shellCommandNoFollowRoot(commandPath, project, commandRoot) {
    if (isInsideOrSame(commandPath, project))
        return project;
    if (isInsideOrSame(commandPath, commandRoot))
        return commandRoot;
    return undefined;
}
async function inspectShellCommandPath(commandPath, nofollowRoot, label) {
    try {
        await assertNoSymlinkComponentsUnderRoot(commandPath, nofollowRoot);
        const info = await lstat(commandPath);
        if (info.isSymbolicLink()) {
            return {
                severity: "fail",
                area: "tools",
                message: `${label} is a symlink (${commandPath})`,
                next: "Use a regular executable or an external package-manager command."
            };
        }
        if (!info.isFile()) {
            return {
                severity: "fail",
                area: "tools",
                message: `${label} is not a regular file (${commandPath})`,
                next: "Point command lookup at directories that contain regular executable files."
            };
        }
        if ((info.mode & 0o111) === 0) {
            return {
                severity: "fail",
                area: "tools",
                message: `${label} is not executable (${commandPath})`,
                next: "Run chmod +x on the tool command or remove it from tools.shell.allowedCommands."
            };
        }
        return undefined;
    }
    catch (error) {
        if (error instanceof Error && /symlink/i.test(error.message)) {
            return {
                severity: "fail",
                area: "tools",
                message: `${label} contains a symlink component (${commandPath})`,
                next: "Use a regular executable path under assistant.workdir/tools.allowedReadRoots[0] or an external package-manager command."
            };
        }
        if (isNodeError(error) && error.code === "ENOENT") {
            return {
                severity: "fail",
                area: "tools",
                message: `${label} does not exist (${commandPath})`,
                next: "Install the tool command, fix tools.shell.allowedCommands, or use a PATH command name."
            };
        }
        return {
            severity: "warn",
            area: "tools",
            message: `could not inspect ${label} (${commandPath})`,
            next: error instanceof Error ? error.message : String(error)
        };
    }
}
function auditStorage(config, items) {
    const statePaths = [
        ["storage", config.storage.dir],
        ["memory", config.memory.dir],
        ["personalization", config.personalization.dir],
        ["scheduler", config.scheduler.dir],
        ["jobs", config.jobs.dir],
        ["access", config.access.dir],
        ["actions", config.actions.dir]
    ];
    if (config.webDashboard.enabled)
        statePaths.push(["web-dashboard", config.webDashboard.canvasDir]);
    for (const [area, path] of statePaths) {
        const root = resolve(path);
        const projectRoot = resolve(config.assistant.workdir || cwd());
        const rel = relative(projectRoot, root);
        if (rel.startsWith("..") || isAbsolute(rel)) {
            items.push({
                severity: "warn",
                area,
                message: `${area} path is outside assistant workdir (${root})`,
                next: "Keep state under the project unless you intentionally centralize Viser state."
            });
        }
        else {
            items.push({ severity: "pass", area, message: `${area} path stays under assistant workdir` });
        }
    }
}
function auditWebDashboard(config, items) {
    if (!config.webDashboard.enabled)
        return;
    const remoteHost = !LOCAL_DASHBOARD_HOSTS.has(config.webDashboard.host);
    if (!remoteHost) {
        items.push({
            severity: "pass",
            area: "web-dashboard",
            message: config.webDashboard.authToken
                ? "localhost dashboard has optional token authentication configured"
                : "dashboard is bound to localhost"
        });
        return;
    }
    if (!config.webDashboard.allowRemote) {
        items.push({
            severity: "fail",
            area: "web-dashboard",
            message: "non-local dashboard host is configured without allowRemote",
            next: "Keep webDashboard.host on localhost or explicitly set allowRemote=true with a strong token."
        });
        return;
    }
    if (!config.webDashboard.authToken || config.webDashboard.authToken.length < 16) {
        items.push({
            severity: "fail",
            area: "web-dashboard",
            message: "remote dashboard is missing a strong auth token",
            next: `Set ${config.webDashboard.authTokenEnv || "VISER_DASHBOARD_TOKEN"} before exposing dashboard routes outside localhost.`
        });
        return;
    }
    items.push({
        severity: "pass",
        area: "web-dashboard",
        message: "remote dashboard requires token authentication"
    });
}
function auditScheduler(config, items) {
    if (!config.scheduler.enabled) {
        items.push({ severity: "warn", area: "scheduler", message: "scheduler is disabled" });
        return;
    }
    if (config.scheduler.tickMs < 1_000) {
        items.push({ severity: "fail", area: "scheduler", message: `scheduler tick is too aggressive (${config.scheduler.tickMs}ms)` });
    }
    else if (config.scheduler.tickMs < 5_000) {
        items.push({ severity: "warn", area: "scheduler", message: `scheduler tick is very frequent (${config.scheduler.tickMs}ms)` });
    }
    else {
        items.push({ severity: "pass", area: "scheduler", message: `scheduler tick is reasonable (${config.scheduler.tickMs}ms)` });
    }
}
function auditJobs(config, items) {
    if (!config.jobs.enabled) {
        items.push({ severity: "warn", area: "jobs", message: "job queue is disabled" });
        return;
    }
    if (config.jobs.tickMs < 1_000) {
        items.push({ severity: "fail", area: "jobs", message: `job worker tick is too aggressive (${config.jobs.tickMs}ms)` });
    }
    else if (config.jobs.tickMs < 5_000) {
        items.push({ severity: "warn", area: "jobs", message: `job worker tick is very frequent (${config.jobs.tickMs}ms)` });
    }
    else {
        items.push({ severity: "pass", area: "jobs", message: `job worker tick is reasonable (${config.jobs.tickMs}ms)` });
    }
    if (config.jobs.concurrency > 6) {
        items.push({ severity: "fail", area: "jobs", message: `job worker concurrency is too high (${config.jobs.concurrency})` });
    }
    else if (config.jobs.concurrency > 3) {
        items.push({ severity: "warn", area: "jobs", message: `job worker concurrency is high (${config.jobs.concurrency} lanes)` });
    }
    else {
        items.push({ severity: "pass", area: "jobs", message: `job worker concurrency is bounded (${config.jobs.concurrency} lane(s))` });
    }
}
async function auditPublicRelease(items) {
    await auditPackageMetadata(items);
    await auditReleaseIgnoreFiles(items);
    await auditReleaseTextLeaks(items);
}
async function auditPackageMetadata(items) {
    let pkg;
    try {
        pkg = JSON.parse(await readFile(resolve(cwd(), "package.json"), "utf8"));
    }
    catch (error) {
        items.push({
            severity: "warn",
            area: "public-release",
            message: "could not inspect package.json release metadata",
            next: error instanceof Error ? error.message : String(error)
        });
        return;
    }
    const packageProblems = [];
    if (pkg.name !== "viser")
        packageProblems.push("package name is not 'viser'");
    if (pkg.author !== RELEASE_AUTHOR)
        packageProblems.push(`author is not '${RELEASE_AUTHOR}'`);
    if (pkg.private === true)
        packageProblems.push("package is marked private");
    if (typeof pkg.license !== "string" || !pkg.license || pkg.license === "UNLICENSED") {
        packageProblems.push("open-source license metadata is missing");
    }
    const files = Array.isArray(pkg.files) ? pkg.files.filter((item) => typeof item === "string") : [];
    const privateFileEntries = files.filter((entry) => RELEASE_PRIVATE_PATTERNS.some((pattern) => entry === pattern || entry.startsWith(`${pattern}/`)));
    if (privateFileEntries.length > 0)
        packageProblems.push(`package files include private entries (${privateFileEntries.join(", ")})`);
    if (packageProblems.length === 0) {
        items.push({ severity: "pass", area: "public-release", message: "package metadata is open-source ready" });
    }
    else {
        items.push({
            severity: "fail",
            area: "public-release",
            message: packageProblems.join("; "),
            next: "Keep Viser public metadata limited to project identity and creator attribution, with private runtime state excluded."
        });
    }
}
async function auditReleaseIgnoreFiles(items) {
    const gitignore = await readTextIfExists(resolve(cwd(), ".gitignore"));
    const npmignore = await readTextIfExists(resolve(cwd(), ".npmignore"));
    const missing = [];
    if (!gitignore) {
        missing.push(".gitignore");
    }
    else {
        for (const pattern of [".env", ".viser/", ".omx/", ".npmrc", "viser.config.json", "node_modules/"]) {
            if (!hasIgnoreLine(gitignore, pattern))
                missing.push(`.gitignore:${pattern}`);
        }
    }
    if (!npmignore) {
        missing.push(".npmignore");
    }
    else {
        for (const pattern of [".env", ".viser/", ".omx/", ".npmrc", "viser.config.json"]) {
            if (!hasIgnoreLine(npmignore, pattern))
                missing.push(`.npmignore:${pattern}`);
        }
    }
    if (missing.length === 0) {
        items.push({ severity: "pass", area: "public-release", message: "release ignore files exclude private runtime state" });
    }
    else {
        items.push({
            severity: "fail",
            area: "public-release",
            message: `release ignore coverage is incomplete (${missing.join(", ")})`,
            next: "Ensure GitHub/npm publication excludes .env, .viser/, .omx/, node_modules/, and local config files."
        });
    }
}
async function auditReleaseTextLeaks(items) {
    const leaks = await scanPublicReleaseFiles(cwd());
    if (leaks.length === 0) {
        items.push({ severity: "pass", area: "public-release", message: "public text files contain no known personal/local or token-like identifiers" });
        return;
    }
    const preview = leaks.slice(0, 5).map((leak) => `${leak.path}:${leak.line} ${leak.id}`).join("; ");
    const next = [...new Set(leaks.map((leak) => leak.next))].slice(0, 3).join(" ");
    items.push({
        severity: "fail",
        area: "public-release",
        message: `public text files contain personal/local or token-like identifiers (${preview}${leaks.length > 5 ? `; +${leaks.length - 5} more` : ""})`,
        next
    });
}
async function scanPublicReleaseFiles(root) {
    const leaks = [];
    const patterns = releaseLeakPatternsForRoot(root);
    for (const entry of RELEASE_SCAN_ENTRIES) {
        await scanReleasePath(resolve(root, entry), root, leaks, patterns);
    }
    return leaks;
}
export function releaseLeakPatternsForRoot(root, homeRoot = homedir()) {
    return [...PERSONAL_RELEASE_PATTERNS, ...SENSITIVE_RELEASE_PATTERNS, ...localWorkspaceTokenPatterns(root, homeRoot)];
}
function localWorkspaceTokenPatterns(root, homeRoot) {
    const resolvedRoot = resolve(root);
    const home = resolve(homeRoot);
    const rel = relative(home, resolvedRoot);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
        return [];
    const tokens = new Set(rel
        .split(/[\\/]+/u)
        .map((part) => part.trim())
        .filter((part) => isSensitiveLocalPathToken(part)));
    return [...tokens].map((token) => ({
        id: "local-workspace-token",
        pattern: new RegExp(`\\b${escapeRegExp(token)}\\b`, "iu"),
        next: "Replace private local workspace path fragments with generic fixture names such as demo-workspace or example-project."
    }));
}
function isSensitiveLocalPathToken(value) {
    const lower = value.toLowerCase();
    if (value.length < 4)
        return false;
    if (!/[a-z]/iu.test(value))
        return false;
    if (GENERIC_RELEASE_PATH_TOKENS.has(lower))
        return false;
    if (lower === RELEASE_ALLOWED_AUTHOR_HANDLE.toLowerCase())
        return false;
    if (lower === RELEASE_ALLOWED_AUTHOR_NAME.toLowerCase())
        return false;
    if (lower === RELEASE_AUTHOR.toLowerCase())
        return false;
    return true;
}
async function scanReleasePath(path, root, leaks, patterns) {
    let info;
    try {
        info = await lstat(path);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
    const name = basename(path);
    if (info.isDirectory()) {
        if (RELEASE_SKIP_DIRS.has(name))
            return;
        const entries = await readdir(path);
        for (const entry of entries)
            await scanReleasePath(join(path, entry), root, leaks, patterns);
        return;
    }
    if (info.isSymbolicLink()) {
        leaks.push({
            path: displayReleasePath(path, root),
            line: 1,
            id: "public-symlink",
            next: "Replace public release symlinks with regular files before publishing."
        });
        return;
    }
    if (!info.isFile() || !isReleaseTextFile(path))
        return;
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/u);
    lines.forEach((line, index) => {
        for (const leak of patterns) {
            if (leak.pattern.test(line)) {
                leaks.push({
                    path: displayReleasePath(path, root),
                    line: index + 1,
                    id: leak.id,
                    next: leak.next
                });
            }
        }
    });
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
function isReleaseTextFile(path) {
    const name = basename(path);
    return RELEASE_TEXT_BASENAMES.has(name) || RELEASE_TEXT_EXTENSIONS.has(extname(path));
}
function displayReleasePath(path, root) {
    const rel = relative(root, path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}
async function readTextIfExists(path) {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
function hasIgnoreLine(content, pattern) {
    return content.split(/\r?\n/u).some((line) => line.trim() === pattern);
}
function writeRootAudit(root, projectRoot) {
    const resolved = resolve(root);
    const project = resolve(projectRoot || cwd());
    if (resolved === dirname(resolved)) {
        return { severity: "fail", area: "actions", message: "write root points at filesystem root", next: "Never allow writes to '/'." };
    }
    if (resolved === homedir()) {
        return { severity: "warn", area: "actions", message: "write root points at the home directory", next: "Prefer a project-specific write root." };
    }
    const rel = relative(project, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        return {
            severity: "warn",
            area: "actions",
            message: `write root is outside assistant workdir (${resolved})`,
            next: "Use this only for intentionally managed external folders."
        };
    }
    return { severity: "pass", area: "actions", message: `write root is scoped under assistant workdir (${resolved})` };
}
function readRootAudit(root, projectRoot) {
    const resolved = resolve(root);
    const project = resolve(projectRoot || cwd());
    if (resolved === dirname(resolved)) {
        return { severity: "fail", area: "tools", message: "read root points at filesystem root", next: "Do not expose '/' to tool reads." };
    }
    const rel = relative(project, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
        return { severity: "warn", area: "tools", message: `read root is outside assistant workdir (${resolved})` };
    }
    return { severity: "pass", area: "tools", message: `read root is scoped under assistant workdir (${resolved})` };
}
function isInsideOrSame(child, parent) {
    const rel = relative(parent, child);
    return !rel.startsWith("..") && !isAbsolute(rel);
}
async function workspaceRootSymlinkAudit(root, projectRoot, area, label) {
    const resolved = resolve(root);
    const project = resolve(projectRoot || cwd());
    const rel = relative(project, resolved);
    if (rel.startsWith("..") || isAbsolute(rel))
        return undefined;
    try {
        await assertNoSymlinkComponentsUnderRoot(resolved, project);
        return undefined;
    }
    catch (error) {
        if (error instanceof Error && /symlink/i.test(error.message)) {
            return {
                severity: "fail",
                area,
                message: `${label} contains a symlink component (${resolved})`,
                next: `Use a regular directory under the assistant workdir for the ${label}.`
            };
        }
        return {
            severity: "warn",
            area,
            message: `could not inspect ${label} symlink safety (${resolved})`,
            next: error instanceof Error ? error.message : String(error)
        };
    }
}
async function readUserConfig(config) {
    if (!config.configPath)
        return undefined;
    try {
        return await readJsonFile(config.configPath);
    }
    catch {
        return undefined;
    }
}
function hasPath(value, path) {
    let current = value;
    for (const key of path) {
        if (typeof current !== "object" || current === null || !(key in current))
            return false;
        current = current[key];
    }
    if (current === undefined || current === null || current === "")
        return false;
    if (Array.isArray(current))
        return current.length > 0;
    if (typeof current === "object")
        return Object.keys(current).length > 0;
    return true;
}
function getPathValue(value, path) {
    let current = value;
    for (const key of path) {
        if (typeof current !== "object" || current === null || !(key in current))
            return undefined;
        current = current[key];
    }
    return current;
}
function normalizeNtfyBaseUrlForAudit(value) {
    return value.trim().replace(/\/+$/u, "");
}
function isHostedOllamaBaseUrlForAudit(value) {
    if (!value?.trim())
        return false;
    try {
        return new URL(value.trim()).hostname.toLowerCase().replace(/\.$/u, "") === "ollama.com";
    }
    catch {
        return false;
    }
}
function looksSecretLike(key) {
    return /token|secret|key|password|credential/i.test(key);
}
function isStrongSharedSecret(value) {
    const token = value?.trim() ?? "";
    return token.length >= 24 && token.length <= 512 && !/[\s\r\n\x00-\x1f\x7f]/u.test(token);
}
function displayPath(path) {
    const rel = relative(cwd(), path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? `./${rel}` : path;
}
function formatItem(item) {
    const prefix = item.severity === "pass" ? "✅" : item.severity === "warn" ? "⚠️" : "❌";
    const next = item.next && item.severity !== "pass" ? `\n   next: ${item.next}` : "";
    return `${prefix} [${item.area}] ${item.message}${next}`;
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
