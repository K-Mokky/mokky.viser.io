// ================================================================
// Local tools with a permission gate
// ================================================================
// This is the first step toward OpenClaw/Hermes-style real actions. Tools are
// intentionally explicit slash commands for now, not hidden model privileges.
import { constants } from "node:fs";
import { access, lstat, open, readdir, realpath } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { basename, delimiter, join, resolve, relative, isAbsolute } from "node:path";
import { runCommand } from "../utils/exec.js";
import { fetchWithTimeout } from "../utils/fetch.js";
const GIT_READ_ONLY_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "branch", "rev-parse", "ls-files"]);
const GIT_DIFF_RENDERING_SUBCOMMANDS = new Set(["log", "diff", "show"]);
const MUTATING_FIND_ACTIONS = new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprint0", "-fprintf", "-fls"]);
const UNSAFE_SED_COMMAND_PATTERN = /(^|[;{}\n])\s*(?:(?:\d+|\$|\/(?:\\.|[^/])*\/)(?:,(?:\d+|\$|\/(?:\\.|[^/])*\/))?)?\s*[rRwWeE]/u;
const RAW_SHELL_BLOCKLIST = /[|;&><`]|\$\(/u;
const WEB_FETCH_TEXT_CONTENT_TYPES = [
    "text/",
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/xhtml+xml",
    "application/rss+xml",
    "application/atom+xml"
];
const WEB_FETCH_DEFAULT_MAX_CHARS = 20_000;
const WEB_SEARCH_DEFAULT_MAX_RESULTS = 5;
const WEB_SEARCH_MAX_QUERY_CHARS = 300;
const WEB_SEARCH_RESULT_SNIPPET_CHARS = 240;
const SEARCH_DEFAULT_MAX_MATCHES = 50;
const SEARCH_MAX_MATCHES = 200;
const SEARCH_MAX_FILES = 2_000;
const SEARCH_FILE_MAX_BYTES = 64_000;
const SEARCH_SNIPPET_CHARS = 160;
const SEARCH_SKIPPED_DIRS = new Set([".git", ".omx", ".viser", "node_modules", "coverage", "dist"]);
const SEARCH_SKIPPED_FILE_PATTERNS = [/^\.env(?:\.|$)/u, /^\.npmrc$/u];
export class ToolRunner {
    config;
    fetchImpl;
    lookupImpl;
    webFetchCache = new Map();
    constructor(config, options = {}) {
        this.config = config;
        this.fetchImpl = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
        this.lookupImpl = options.lookupImpl ?? defaultLookup;
    }
    listTools() {
        const shellStatus = this.config.shell.enabled ? "enabled" : "disabled";
        const webFetchStatus = this.config.webFetch.enabled ? "enabled" : "disabled";
        const webSearchStatus = this.config.webSearch.enabled ? "enabled" : "disabled";
        return [
            "Available tools",
            "- list-dir <path>: list files under an allowed read root",
            "- read-file <path>: read a text file under an allowed read root",
            "- search-files <query> [path] [maxMatches]: literal text search under an allowed read root",
            `- shell <command>: run an allowlisted read-only command (${shellStatus})`,
            `- web-search <query> [maxResults]: guarded readable web result search without JavaScript (${webSearchStatus})`,
            `- web-fetch <http-url|https-url> [maxChars] [text|markdown]: fetch readable remote content without JavaScript (${webFetchStatus})`,
            "",
            `Allowed read roots:\n${this.config.allowedReadRoots.map((root) => `- ${root}`).join("\n")}`
        ].join("\n");
    }
    async run(raw) {
        if (!this.config.enabled)
            return { ok: false, title: "tools disabled", output: "Local tools are disabled in config." };
        try {
            const [toolId, ...args] = splitCommandLine(raw);
            switch (toolId) {
                case "list-dir":
                case "ls":
                    return await this.listDir(args.join(" ") || ".");
                case "read-file":
                case "cat":
                    return await this.readFile(args.join(" "));
                case "search-files":
                case "grep-files":
                case "search":
                    return await this.searchFiles(args);
                case "shell":
                    return await this.shell(args.join(" "));
                case "web-fetch":
                case "fetch-url":
                    return await this.webFetch(args);
                case "web-search":
                case "search-web":
                    return await this.webSearch(args);
                default:
                    return { ok: false, title: "unknown tool", output: `Unknown tool '${toolId}'. Try /tools.` };
            }
        }
        catch (error) {
            return {
                ok: false,
                title: "tool error",
                output: toolErrorMessage(error)
            };
        }
    }
    async listDir(pathInput) {
        const target = await this.resolveAllowedPath(pathInput || ".");
        const entries = await readdir(target, { withFileTypes: true });
        const lines = entries
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
        return { ok: true, title: `list-dir ${target}`, output: lines.join("\n") || "(empty)" };
    }
    async readFile(pathInput) {
        if (!pathInput.trim())
            return { ok: false, title: "read-file", output: "Path is required." };
        const target = await this.resolveAllowedPath(pathInput);
        const targetInfo = await lstat(target);
        if (targetInfo.isSymbolicLink())
            throw new Error(`Tool path contains a symlink: ${target}`);
        const raw = await readToolFileNoFollow(target);
        if (!raw)
            return { ok: false, title: `read-file ${target}`, output: "Target is not a regular file." };
        const truncated = raw.length > this.config.maxReadBytes;
        const output = raw.subarray(0, this.config.maxReadBytes).toString("utf8");
        return {
            ok: true,
            title: `read-file ${target}`,
            output: truncated ? `${output}\n\n[truncated at ${this.config.maxReadBytes} bytes]` : output
        };
    }
    async searchFiles(args) {
        const [queryInput, pathInput = ".", maxMatchesInput] = args;
        const query = queryInput?.trim() ?? "";
        if (!query)
            return { ok: false, title: "search-files", output: "Query is required." };
        if (query.length > 200)
            return { ok: false, title: "search-files", output: "Query must be 200 characters or fewer." };
        const target = await this.resolveAllowedPath(pathInput || ".");
        const targetInfo = await lstat(target);
        if (targetInfo.isSymbolicLink())
            throw new Error(`Tool path contains a symlink: ${target}`);
        const maxMatches = normalizeSearchMaxMatches(maxMatchesInput);
        const state = {
            filesScanned: 0,
            skipped: 0,
            partialFiles: 0,
            truncated: false,
            matches: []
        };
        await this.collectSearchMatches(target, query.toLowerCase(), maxMatches, state);
        const header = [
            `query: ${query}`,
            `path: ${this.formatToolDisplayPath(target)}`,
            `files scanned: ${state.filesScanned}`,
            `skipped: ${state.skipped}`,
            state.partialFiles ? `partial files: ${state.partialFiles} (searched first ${SEARCH_FILE_MAX_BYTES} bytes)` : undefined,
            state.truncated ? `output: truncated at ${maxMatches} matches or ${SEARCH_MAX_FILES} files` : undefined
        ].filter(Boolean).join("\n");
        return {
            ok: true,
            title: `search-files ${this.formatToolDisplayPath(target)}`,
            output: `${header}\n\n${state.matches.join("\n") || "(no matches)"}`
        };
    }
    async collectSearchMatches(path, needle, maxMatches, state) {
        if (state.truncated || state.matches.length >= maxMatches)
            return;
        const info = await lstat(path);
        if (info.isSymbolicLink()) {
            state.skipped += 1;
            return;
        }
        const name = basename(path);
        if (info.isDirectory()) {
            if (SEARCH_SKIPPED_DIRS.has(name)) {
                state.skipped += 1;
                return;
            }
            const entries = await readdir(path, { withFileTypes: true });
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                await this.collectSearchMatches(join(path, entry.name), needle, maxMatches, state);
                if (state.truncated || state.matches.length >= maxMatches)
                    return;
            }
            return;
        }
        if (!info.isFile()) {
            state.skipped += 1;
            return;
        }
        if (SEARCH_SKIPPED_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
            state.skipped += 1;
            return;
        }
        if (state.filesScanned >= SEARCH_MAX_FILES) {
            state.truncated = true;
            return;
        }
        state.filesScanned += 1;
        const raw = await readToolFilePrefixNoFollow(path, SEARCH_FILE_MAX_BYTES);
        if (!raw) {
            state.skipped += 1;
            return;
        }
        if (raw.truncated)
            state.partialFiles += 1;
        if (isLikelyBinary(raw.buffer)) {
            state.skipped += 1;
            return;
        }
        const lines = raw.buffer.toString("utf8").split(/\r?\n/u);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            if (!line.toLowerCase().includes(needle))
                continue;
            state.matches.push(`${this.formatToolDisplayPath(path)}:${index + 1}: ${searchSnippet(line)}`);
            if (state.matches.length >= maxMatches) {
                state.truncated = true;
                return;
            }
        }
    }
    formatToolDisplayPath(path) {
        const resolved = resolve(path);
        for (const root of this.config.allowedReadRoots) {
            const resolvedRoot = resolve(root);
            if (isInside(resolved, resolvedRoot))
                return relative(resolvedRoot, resolved) || ".";
        }
        return resolved;
    }
    async shell(rawCommand) {
        if (!this.config.shell.enabled)
            return { ok: false, title: "shell disabled", output: "Shell tool is disabled." };
        if (!rawCommand.trim())
            return { ok: false, title: "shell", output: "Command is required." };
        if (RAW_SHELL_BLOCKLIST.test(rawCommand)) {
            return { ok: false, title: "shell rejected", output: "Shell metacharacters are not allowed; use a single read-only command." };
        }
        const tokens = splitCommandLine(rawCommand);
        const [command, ...args] = tokens;
        if (!command)
            return { ok: false, title: "shell rejected", output: "Command is required." };
        const safety = isAllowedReadOnlyCommand(command, args, this.config.shell.allowedCommands);
        if (!safety.ok)
            return { ok: false, title: "shell rejected", output: safety.reason };
        const primaryRoot = await resolveSafeToolRoot(this.config.allowedReadRoots[0]);
        const pathSafety = await validateShellPathArguments(args, this.config.allowedReadRoots);
        if (!pathSafety.ok)
            return { ok: false, title: "shell rejected", output: pathSafety.reason };
        const env = toolShellRuntimeEnv(command);
        const executable = await resolveSafeShellCommand(command, primaryRoot.lexical, env.PATH);
        const safeArgs = hardenedShellArgs(command, args);
        const result = await runCommand({
            command: executable,
            args: safeArgs,
            timeoutMs: this.config.shell.timeoutMs,
            maxOutputBytes: this.config.maxReadBytes,
            cwd: primaryRoot.lexical,
            env,
            inheritEnv: false
        });
        const output = [
            result.stdout.trim(),
            result.stderr.trim(),
            outputTruncationNote(result)
        ].filter(Boolean).join("\n");
        return {
            ok: result.exitCode === 0 && !result.signal,
            title: `shell ${command}`,
            output: output || `(exit=${result.exitCode}, signal=${result.signal ?? "none"})`
        };
    }
    async webFetch(args) {
        if (!this.config.webFetch.enabled)
            return { ok: false, title: "web-fetch disabled", output: "Web fetch tool is disabled." };
        const [urlInput, secondInput, thirdInput] = args;
        if (!urlInput)
            return { ok: false, title: "web-fetch", output: "URL is required." };
        const [maxCharsInput, extractModeInput] = splitWebFetchOptionalArgs(secondInput, thirdInput);
        const maxChars = normalizeWebFetchMaxChars(maxCharsInput, Math.min(WEB_FETCH_DEFAULT_MAX_CHARS, this.config.maxReadBytes));
        const extractMode = normalizeWebFetchExtractMode(extractModeInput, this.config.webFetch.extractMode);
        const fetched = await fetchReadableUrl(urlInput, {
            fetchImpl: this.fetchImpl,
            lookupImpl: this.lookupImpl,
            provider: this.config.webFetch.provider,
            firecrawlApiKeyEnv: this.config.webFetch.firecrawlApiKeyEnv,
            firecrawlApiKey: this.config.webFetch.firecrawlApiKey,
            timeoutMs: this.config.webFetch.timeoutMs,
            maxRedirects: this.config.webFetch.maxRedirects,
            maxResponseBytes: this.config.webFetch.maxResponseBytes,
            maxChars,
            extractMode,
            cacheTtlMs: this.config.webFetch.cacheTtlMs,
            cache: this.webFetchCache,
            userAgent: this.config.webFetch.userAgent
        });
        const header = [
            `url: ${fetched.url}`,
            `status: ${fetched.status}`,
            `content-type: ${fetched.contentType || "unknown"}`,
            `extract-mode: ${fetched.extractMode}`,
            `cache: ${fetched.cacheStatus}`,
            `bytes: ${fetched.bytesRead}${fetched.responseTruncated ? " (response truncated)" : ""}`,
            fetched.outputTruncated ? `output: truncated at ${maxChars} chars` : undefined
        ].filter(Boolean).join("\n");
        return {
            ok: true,
            title: `web-fetch ${fetched.url}`,
            output: `${header}\n\n${fetched.text || "(empty)"}`
        };
    }
    async webSearch(args) {
        if (!this.config.webSearch.enabled)
            return { ok: false, title: "web-search disabled", output: "Web search tool is disabled." };
        const [queryInput, maxResultsInput] = args;
        const query = queryInput?.trim() ?? "";
        if (!query)
            return { ok: false, title: "web-search", output: "Query is required." };
        if (query.length > WEB_SEARCH_MAX_QUERY_CHARS)
            return { ok: false, title: "web-search", output: `Query must be ${WEB_SEARCH_MAX_QUERY_CHARS} characters or fewer.` };
        const maxResults = normalizeWebSearchMaxResults(maxResultsInput, this.config.webSearch.maxResults);
        const searched = await searchReadableWeb(query, {
            fetchImpl: this.fetchImpl,
            provider: this.config.webSearch.provider,
            searxngBaseUrl: this.config.webSearch.searxngBaseUrl,
            braveApiKeyEnv: this.config.webSearch.braveApiKeyEnv,
            braveApiKey: this.config.webSearch.braveApiKey,
            tavilyApiKeyEnv: this.config.webSearch.tavilyApiKeyEnv,
            tavilyApiKey: this.config.webSearch.tavilyApiKey,
            perplexityApiKeyEnv: this.config.webSearch.perplexityApiKeyEnv,
            perplexityApiKey: this.config.webSearch.perplexityApiKey,
            exaApiKeyEnv: this.config.webSearch.exaApiKeyEnv,
            exaApiKey: this.config.webSearch.exaApiKey,
            firecrawlApiKeyEnv: this.config.webSearch.firecrawlApiKeyEnv,
            firecrawlApiKey: this.config.webSearch.firecrawlApiKey,
            ollamaBaseUrl: this.config.webSearch.ollamaBaseUrl,
            ollamaApiKeyEnv: this.config.webSearch.ollamaApiKeyEnv,
            ollamaApiKey: this.config.webSearch.ollamaApiKey,
            timeoutMs: this.config.webSearch.timeoutMs,
            maxResponseBytes: this.config.webSearch.maxResponseBytes,
            maxResults,
            userAgent: this.config.webSearch.userAgent
        });
        const header = [
            `query: ${query}`,
            `provider: ${searched.provider}`,
            `results: ${searched.results.length}`,
            `bytes: ${searched.bytesRead}${searched.responseTruncated ? " (response truncated)" : ""}`,
            searched.outputTruncated ? `output: truncated at ${maxResults} results` : undefined
        ].filter(Boolean).join("\n");
        const output = searched.results
            .map((result, index) => {
            const snippet = result.snippet ? `\n   ${result.snippet}` : "";
            return `${index + 1}. ${result.title}\n   ${result.url}${snippet}`;
        })
            .join("\n\n");
        return {
            ok: true,
            title: `web-search ${query}`,
            output: `${header}\n\n${output || "(no results)"}`
        };
    }
    async resolveAllowedPath(pathInput) {
        const candidate = isAbsolute(pathInput) ? resolve(pathInput) : resolve(this.config.allowedReadRoots[0], pathInput);
        for (const root of this.config.allowedReadRoots) {
            const resolvedRoot = resolve(root);
            if (isInside(candidate, resolvedRoot)) {
                await assertToolRootIsSafe(resolvedRoot);
                await assertNoToolPathSymlinkComponents(candidate, resolvedRoot);
                return candidate;
            }
        }
        throw new Error(`Path '${pathInput}' is outside allowed read roots.`);
    }
}
export async function readToolFileNoFollow(path) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            return undefined;
        return await handle.readFile();
    }
    catch (error) {
        if (isNodeError(error) && ["ENOENT", "ELOOP", "EMLINK"].includes(error.code ?? ""))
            return undefined;
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
async function readToolFilePrefixNoFollow(path, maxBytes) {
    let handle;
    try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
        const info = await handle.stat();
        if (!info.isFile())
            return undefined;
        const bytesToRead = Math.min(info.size, maxBytes);
        const buffer = Buffer.alloc(bytesToRead);
        if (bytesToRead === 0)
            return { buffer, truncated: false };
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
        return {
            buffer: buffer.subarray(0, bytesRead),
            truncated: info.size > bytesRead
        };
    }
    catch (error) {
        if (isNodeError(error) && ["ENOENT", "ELOOP", "EMLINK"].includes(error.code ?? ""))
            return undefined;
        throw error;
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
async function searchReadableWeb(query, options) {
    if (options.provider === "brave-api")
        return await searchBraveApi(query, options);
    if (options.provider === "tavily-api")
        return await searchTavilyApi(query, options);
    if (options.provider === "perplexity-api")
        return await searchPerplexityApi(query, options);
    if (options.provider === "exa-api")
        return await searchExaApi(query, options);
    if (options.provider === "firecrawl-api")
        return await searchFirecrawlApi(query, options);
    if (options.provider === "ollama-api")
        return await searchOllamaApi(query, options);
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "GET",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
            "accept-language": "en-US,en;q=0.9"
        }
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|text\/plain|application\/xhtml\+xml/iu.test(contentType)) {
        throw new Error(`Web search only accepts readable HTML/text responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = options.provider === "searxng-html"
        ? parseSearxngHtmlResults(body.text, options.maxResults, options.searxngBaseUrl)
        : parseDuckDuckGoHtmlResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function webSearchEndpoint(query, options) {
    switch (options.provider) {
        case "duckduckgo-html":
            return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        case "searxng-html": {
            const base = normalizeSearxngBaseUrl(options.searxngBaseUrl);
            const url = new URL(base);
            url.pathname = `${url.pathname.replace(/\/+$/u, "")}/search`;
            url.search = "";
            url.searchParams.set("q", query);
            url.searchParams.set("format", "html");
            return url.toString();
        }
        case "brave-api": {
            const url = new URL("https://api.search.brave.com/res/v1/web/search");
            url.searchParams.set("q", query);
            url.searchParams.set("count", String(options.maxResults));
            return url.toString();
        }
        case "tavily-api":
            return "https://api.tavily.com/search";
        case "perplexity-api":
            return "https://api.perplexity.ai/search";
        case "exa-api":
            return "https://api.exa.ai/search";
        case "firecrawl-api":
            return "https://api.firecrawl.dev/v2/search";
        case "ollama-api": {
            const base = normalizeOllamaBaseUrl(options.ollamaBaseUrl);
            const url = new URL(base);
            const basePath = url.pathname.replace(/\/+$/u, "");
            url.pathname = `${basePath}${isHostedOllamaBaseUrl(base) ? "/api/web_search" : "/api/experimental/web_search"}`;
            url.search = "";
            return url.toString();
        }
    }
}
async function searchBraveApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "GET",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "x-subscription-token": normalizeBraveApiKey(options.braveApiKey, options.braveApiKeyEnv)
        }
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Brave web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Brave web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Brave web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseBraveApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizeBraveApiKey(value, envName = "BRAVE_SEARCH_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Brave web search requires tools.webSearch.braveApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Brave web search API key must not contain whitespace.");
    return trimmed;
}
async function searchTavilyApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": `Bearer ${normalizeTavilyApiKey(options.tavilyApiKey, options.tavilyApiKeyEnv)}`
        },
        body: JSON.stringify({
            query,
            max_results: options.maxResults,
            search_depth: "basic",
            include_answer: false,
            include_raw_content: false
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Tavily web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Tavily web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Tavily web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseTavilyApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizeTavilyApiKey(value, envName = "TAVILY_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Tavily web search requires tools.webSearch.tavilyApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Tavily web search API key must not contain whitespace.");
    return trimmed;
}
async function searchPerplexityApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": `Bearer ${normalizePerplexityApiKey(options.perplexityApiKey, options.perplexityApiKeyEnv)}`
        },
        body: JSON.stringify({
            query,
            max_results: options.maxResults,
            max_tokens: 5_000,
            max_tokens_per_page: 1_024
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Perplexity web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Perplexity web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Perplexity web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parsePerplexityApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizePerplexityApiKey(value, envName = "PERPLEXITY_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Perplexity web search requires tools.webSearch.perplexityApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Perplexity web search API key must not contain whitespace.");
    return trimmed;
}
async function searchExaApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "content-type": "application/json",
            "x-api-key": normalizeExaApiKey(options.exaApiKey, options.exaApiKeyEnv)
        },
        body: JSON.stringify({
            query,
            numResults: options.maxResults,
            contents: {
                highlights: true
            }
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Exa web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Exa web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Exa web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseExaApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizeExaApiKey(value, envName = "EXA_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Exa web search requires tools.webSearch.exaApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Exa web search API key must not contain whitespace.");
    return trimmed;
}
async function searchFirecrawlApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": `Bearer ${normalizeFirecrawlApiKey(options.firecrawlApiKey, options.firecrawlApiKeyEnv)}`
        },
        body: JSON.stringify({
            query,
            limit: options.maxResults,
            sources: ["web"],
            ignoreInvalidURLs: true
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Firecrawl web search does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Firecrawl web search failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Firecrawl web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseFirecrawlApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizeFirecrawlApiKey(value, envName = "FIRECRAWL_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Firecrawl web search requires tools.webSearch.firecrawlApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Firecrawl web search API key must not contain whitespace.");
    return trimmed;
}
async function searchOllamaApi(query, options) {
    const endpoint = webSearchEndpoint(query, options);
    const key = options.ollamaApiKey?.trim();
    try {
        return await requestOllamaWebSearch(endpoint, query, options, isHostedOllamaBaseUrl(endpoint) ? normalizeOllamaApiKey(key, options.ollamaApiKeyEnv) : undefined);
    }
    catch (error) {
        if (!key || isHostedOllamaBaseUrl(endpoint) || !isOllamaLocalUnsupportedError(error))
            throw error;
        return await requestOllamaWebSearch("https://ollama.com/api/web_search", query, options, normalizeOllamaApiKey(key, options.ollamaApiKeyEnv));
    }
}
async function requestOllamaWebSearch(endpoint, query, options, apiKey) {
    const headers = {
        "user-agent": options.userAgent,
        "accept": "application/json",
        "content-type": "application/json"
    };
    if (apiKey)
        headers.authorization = `Bearer ${apiKey}`;
    const response = await fetchWithTimeout(options.fetchImpl, endpoint, {
        method: "POST",
        redirect: "manual",
        headers,
        body: JSON.stringify({
            query,
            max_results: Math.min(options.maxResults, 10)
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Ollama web search does not follow provider redirects.");
    if (!response.ok) {
        const unsupported = response.status === 404 || response.status === 405 || response.status === 501;
        throw new OllamaWebSearchError(`Ollama web search failed: ${response.status} ${response.statusText}`, unsupported);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Ollama web search only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseOllamaApiResults(body.text, options.maxResults);
    return {
        provider: options.provider,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        outputTruncated: parsed.truncated,
        results: parsed.results
    };
}
function normalizeOllamaApiKey(value, envName = "OLLAMA_API_KEY") {
    const trimmed = value?.trim();
    if (!trimmed)
        throw new Error(`Hosted Ollama web search requires tools.webSearch.ollamaApiKey or ${envName}.`);
    if (/[\s\u0000-\u001f\u007f]/u.test(trimmed))
        throw new Error("Ollama web search API key must not contain whitespace.");
    return trimmed;
}
function normalizeOllamaBaseUrl(value) {
    const raw = value?.trim() || "http://127.0.0.1:11434";
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new Error("Ollama web search base URL must be a valid http(s) URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error("Ollama web search base URL must use http or https.");
    if (url.username || url.password)
        throw new Error("Ollama web search base URL credentials are not allowed.");
    if (url.search || url.hash)
        throw new Error("Ollama web search base URL must not include query or hash.");
    const hostname = normalizeHostname(url.hostname);
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
    if (url.protocol === "http:" && !isLocal)
        throw new Error("Ollama web search http base URL is only allowed for localhost.");
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
}
function isHostedOllamaBaseUrl(value) {
    try {
        return normalizeHostname(new URL(value).hostname) === "ollama.com";
    }
    catch {
        return false;
    }
}
class OllamaWebSearchError extends Error {
    unsupported;
    constructor(message, unsupported) {
        super(message);
        this.unsupported = unsupported;
    }
}
function isOllamaLocalUnsupportedError(error) {
    return error instanceof OllamaWebSearchError && error.unsupported;
}
function normalizeSearxngBaseUrl(value) {
    if (!value?.trim())
        throw new Error("SearXNG web search requires tools.webSearch.searxngBaseUrl.");
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        throw new Error("SearXNG base URL must be a valid https URL.");
    }
    if (url.protocol !== "https:")
        throw new Error("SearXNG base URL must use https.");
    if (!url.hostname)
        throw new Error("SearXNG base URL must include a hostname.");
    if (url.username || url.password)
        throw new Error("SearXNG base URL credentials are not allowed.");
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
}
function parseDuckDuckGoHtmlResults(raw, maxResults) {
    const results = [];
    const seen = new Set();
    const anchorPattern = /<a\b(?=[^>]*\bclass=(["'])[^"']*\bresult__a\b[^"']*\1)(?=[^>]*\bhref=(["'])(.*?)\2)[^>]*>([\s\S]*?)<\/a>/giu;
    let match;
    while ((match = anchorPattern.exec(raw)) !== null) {
        const url = normalizeSearchResultUrl(match[3] ?? "");
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(match[4] ?? "");
        if (!title)
            continue;
        seen.add(url);
        results.push({
            title,
            url,
            snippet: searchResultSnippet(raw.slice(match.index + match[0].length, match.index + match[0].length + 2_000))
        });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    if (results.length === 0) {
        const fallbackAnchorPattern = /<a\b(?=[^>]*\bhref=(["'])(.*?)\1)[^>]*>([\s\S]*?)<\/a>/giu;
        while ((match = fallbackAnchorPattern.exec(raw)) !== null) {
            const url = normalizeSearchResultUrl(match[2] ?? "");
            if (!url || seen.has(url))
                continue;
            const title = htmlFragmentToText(match[3] ?? "");
            if (!title || title.length < 2)
                continue;
            seen.add(url);
            results.push({ title, url, snippet: "" });
            if (results.length >= maxResults)
                return { results, truncated: true };
        }
    }
    return { results, truncated: false };
}
function parseSearxngHtmlResults(raw, maxResults, baseUrl) {
    const baseHost = safeHostname(baseUrl);
    const results = [];
    const seen = new Set();
    const articlePattern = /<article\b(?=[^>]*\bclass=(["'])[^"']*\bresult\b[^"']*\1)[^>]*>([\s\S]*?)<\/article>/giu;
    let match;
    while ((match = articlePattern.exec(raw)) !== null) {
        const block = match[2] ?? "";
        const anchor = /<a\b(?=[^>]*\bhref=(["'])(.*?)\1)[^>]*>([\s\S]*?)<\/a>/iu.exec(block);
        if (!anchor)
            continue;
        const url = normalizeSearchResultUrl(anchor[2] ?? "", baseUrl);
        if (!url || seen.has(url) || isSearchProviderUrl(url, baseHost))
            continue;
        const title = htmlFragmentToText(anchor[3] ?? "");
        if (!title)
            continue;
        seen.add(url);
        results.push({
            title,
            url,
            snippet: searxngResultSnippet(block)
        });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    if (results.length === 0) {
        const fallbackAnchorPattern = /<a\b(?=[^>]*\bhref=(["'])(.*?)\1)[^>]*>([\s\S]*?)<\/a>/giu;
        while ((match = fallbackAnchorPattern.exec(raw)) !== null) {
            const url = normalizeSearchResultUrl(match[2] ?? "", baseUrl);
            if (!url || seen.has(url) || isSearchProviderUrl(url, baseHost))
                continue;
            const title = htmlFragmentToText(match[3] ?? "");
            if (!title || title.length < 2)
                continue;
            seen.add(url);
            results.push({ title, url, snippet: "" });
            if (results.length >= maxResults)
                return { results, truncated: true };
        }
    }
    return { results, truncated: false };
}
function parseBraveApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Brave web search returned invalid JSON.");
    }
    const web = isObjectRecord(payload) ? payload.web : undefined;
    const candidates = isObjectRecord(web) && Array.isArray(web.results) ? web.results : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://search.brave.com/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? "");
        if (!title)
            continue;
        const snippet = apiResultSnippet(asString(candidate.description) ?? asString(candidate.extra_snippets) ?? "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parseTavilyApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Tavily web search returned invalid JSON.");
    }
    const candidates = isObjectRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://tavily.com/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? "");
        if (!title)
            continue;
        const snippet = apiResultSnippet(asString(candidate.content) ?? asString(candidate.raw_content) ?? "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parsePerplexityApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Perplexity web search returned invalid JSON.");
    }
    const candidates = isObjectRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://www.perplexity.ai/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? "");
        if (!title)
            continue;
        const snippet = apiResultSnippet(asString(candidate.snippet) ?? "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parseExaApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Exa web search returned invalid JSON.");
    }
    const candidates = isObjectRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://exa.ai/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? "");
        if (!title)
            continue;
        const highlights = asStringArray(candidate.highlights).join(" ");
        const snippet = apiResultSnippet(highlights || asString(candidate.summary) || asString(candidate.text) || "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parseFirecrawlApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Firecrawl web search returned invalid JSON.");
    }
    const data = isObjectRecord(payload) ? payload.data : undefined;
    const candidates = isObjectRecord(data) && Array.isArray(data.web) ? data.web : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url) ?? asString(isObjectRecord(candidate.metadata) ? candidate.metadata.url : undefined) ?? asString(isObjectRecord(candidate.metadata) ? candidate.metadata.sourceURL : undefined);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://firecrawl.dev/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? asString(isObjectRecord(candidate.metadata) ? candidate.metadata.title : undefined) ?? "");
        if (!title)
            continue;
        const snippet = apiResultSnippet(asString(candidate.description)
            ?? asString(isObjectRecord(candidate.metadata) ? candidate.metadata.description : undefined)
            ?? asString(candidate.markdown)
            ?? "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parseOllamaApiResults(raw, maxResults) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Ollama web search returned invalid JSON.");
    }
    const candidates = isObjectRecord(payload) && Array.isArray(payload.results) ? payload.results : [];
    const results = [];
    const seen = new Set();
    for (const candidate of candidates) {
        if (!isObjectRecord(candidate))
            continue;
        const rawUrl = asString(candidate.url);
        const url = rawUrl ? normalizeSearchResultUrl(rawUrl, "https://ollama.com/") : undefined;
        if (!url || seen.has(url))
            continue;
        const title = htmlFragmentToText(asString(candidate.title) ?? "");
        if (!title)
            continue;
        const snippet = apiResultSnippet(asString(candidate.content) ?? asString(candidate.snippet) ?? "");
        seen.add(url);
        results.push({ title, url, snippet });
        if (results.length >= maxResults)
            return { results, truncated: true };
    }
    return { results, truncated: false };
}
function parseFirecrawlScrapeReadable(raw, mode) {
    let payload;
    try {
        payload = JSON.parse(raw);
    }
    catch {
        throw new Error("Firecrawl web fetch returned invalid JSON.");
    }
    const data = isObjectRecord(payload) ? payload.data : undefined;
    if (!isObjectRecord(data))
        throw new Error("Firecrawl web fetch returned no readable data.");
    const metadata = isObjectRecord(data.metadata) ? data.metadata : {};
    const status = asNumber(data.statusCode) ?? asNumber(metadata.statusCode);
    if (mode === "markdown") {
        const markdown = asString(data.markdown) ?? asString(data.content);
        if (markdown?.trim()) {
            return { readable: normalizeReadableWhitespace(decodeBasicHtmlEntities(stripUnsafeHtml(markdown))), status, contentType: "text/markdown" };
        }
        const html = asString(data.html) ?? asString(data.rawHtml);
        if (html?.trim()) {
            return { readable: extractReadableWebMarkdown(html, "text/html"), status, contentType: "text/html" };
        }
    }
    else {
        const html = asString(data.html) ?? asString(data.rawHtml);
        if (html?.trim()) {
            return { readable: extractReadableWebText(html, "text/html"), status, contentType: "text/html" };
        }
        const markdown = asString(data.markdown) ?? asString(data.content);
        if (markdown?.trim()) {
            return { readable: normalizeReadableWhitespace(decodeBasicHtmlEntities(stripUnsafeHtml(markdown))), status, contentType: "text/markdown" };
        }
    }
    throw new Error("Firecrawl web fetch returned no readable text content.");
}
function apiResultSnippet(raw) {
    const text = htmlFragmentToText(raw);
    if (text.length <= WEB_SEARCH_RESULT_SNIPPET_CHARS)
        return text;
    return `${text.slice(0, WEB_SEARCH_RESULT_SNIPPET_CHARS - 1)}…`;
}
function isObjectRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function asStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function searchResultSnippet(raw) {
    const match = /<(?:a|div|span)\b(?=[^>]*\bclass=(["'])[^"']*\bresult__snippet\b[^"']*\1)[^>]*>([\s\S]*?)<\/(?:a|div|span)>/iu.exec(raw);
    const text = htmlFragmentToText(match?.[2] ?? "");
    if (text.length <= WEB_SEARCH_RESULT_SNIPPET_CHARS)
        return text;
    return `${text.slice(0, WEB_SEARCH_RESULT_SNIPPET_CHARS - 1)}…`;
}
function searxngResultSnippet(raw) {
    const match = /<(?:p|div|span)\b(?=[^>]*\bclass=(["'])[^"']*(?:\bcontent\b|\bresult-content\b|\bresult__snippet\b)[^"']*\1)[^>]*>([\s\S]*?)<\/(?:p|div|span)>/iu.exec(raw);
    const text = htmlFragmentToText(match?.[2] ?? "");
    if (text.length <= WEB_SEARCH_RESULT_SNIPPET_CHARS)
        return text;
    return `${text.slice(0, WEB_SEARCH_RESULT_SNIPPET_CHARS - 1)}…`;
}
function normalizeSearchResultUrl(rawHref, baseUrl = "https://duckduckgo.com/") {
    const href = decodeBasicHtmlEntities(rawHref.trim());
    if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        return undefined;
    let url;
    try {
        url = new URL(href.startsWith("//") ? `https:${href}` : href, baseUrl);
    }
    catch {
        return undefined;
    }
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/" && url.searchParams.has("uddg")) {
        try {
            url = new URL(url.searchParams.get("uddg") ?? "");
        }
        catch {
            return undefined;
        }
    }
    if (url.protocol !== "https:" && url.protocol !== "http:")
        return undefined;
    if (url.username || url.password)
        return undefined;
    const hostname = normalizeHostname(url.hostname);
    if (isBlockedInternalHostname(hostname) || (isIP(hostname) && isPrivateOrReservedIp(hostname)))
        return undefined;
    url.hash = "";
    return url.toString();
}
function safeHostname(value) {
    if (!value)
        return undefined;
    try {
        return normalizeHostname(new URL(value).hostname);
    }
    catch {
        return undefined;
    }
}
function isSearchProviderUrl(urlValue, baseHost) {
    if (!baseHost)
        return false;
    try {
        return normalizeHostname(new URL(urlValue).hostname) === baseHost;
    }
    catch {
        return false;
    }
}
function htmlFragmentToText(raw) {
    return normalizeReadableWhitespace(decodeBasicHtmlEntities(stripUnsafeHtml(raw).replace(/<[^>]+>/gu, " ")));
}
async function fetchReadableUrl(urlInput, options) {
    let current = await normalizeWebFetchUrl(urlInput, options.lookupImpl);
    const cacheKey = `${options.provider}\n${options.extractMode}\n${current.toString()}`;
    const now = Date.now();
    if (options.cacheTtlMs > 0) {
        const cached = options.cache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return formatWebFetchResult(cached.value, options.maxChars, "hit");
        }
        if (cached)
            options.cache.delete(cacheKey);
    }
    let redirects = 0;
    if (options.provider === "firecrawl-api") {
        const value = await fetchFirecrawlReadableUrl(current, options);
        if (options.cacheTtlMs > 0) {
            options.cache.set(cacheKey, { expiresAt: now + options.cacheTtlMs, value });
            pruneExpiredWebFetchCache(options.cache, now);
        }
        return formatWebFetchResult(value, options.maxChars, options.cacheTtlMs > 0 ? "miss" : "disabled");
    }
    while (true) {
        const response = await fetchWithTimeout(options.fetchImpl, current.toString(), {
            method: "GET",
            redirect: "manual",
            headers: {
                "user-agent": options.userAgent,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.8,*/*;q=0.5",
                "accept-language": "en-US,en;q=0.9"
            }
        }, options.timeoutMs);
        if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
            redirects += 1;
            if (redirects > options.maxRedirects)
                throw new Error(`Web fetch followed more than ${options.maxRedirects} redirects.`);
            current = await normalizeWebFetchUrl(new URL(response.headers.get("location") ?? "", current).toString(), options.lookupImpl);
            continue;
        }
        if (!response.ok)
            throw new Error(`Web fetch failed: ${response.status} ${response.statusText}`);
        const contentType = response.headers.get("content-type") ?? "";
        if (!isReadableWebContentType(contentType)) {
            throw new Error(`Web fetch only accepts readable text/html/json/xml responses; got '${contentType || "unknown"}'.`);
        }
        const body = await readBoundedResponseText(response, options.maxResponseBytes);
        const value = {
            url: current.toString(),
            status: response.status,
            contentType,
            bytesRead: body.bytesRead,
            responseTruncated: body.truncated,
            extractMode: options.extractMode,
            readable: extractReadableWebContent(body.text, contentType, options.extractMode)
        };
        if (options.cacheTtlMs > 0) {
            options.cache.set(cacheKey, { expiresAt: now + options.cacheTtlMs, value });
            pruneExpiredWebFetchCache(options.cache, now);
        }
        return formatWebFetchResult(value, options.maxChars, options.cacheTtlMs > 0 ? "miss" : "disabled");
    }
}
async function fetchFirecrawlReadableUrl(current, options) {
    const requestedFormat = options.extractMode === "markdown" ? "markdown" : "html";
    const response = await fetchWithTimeout(options.fetchImpl, "https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        redirect: "manual",
        headers: {
            "user-agent": options.userAgent,
            "accept": "application/json",
            "content-type": "application/json",
            "authorization": `Bearer ${normalizeFirecrawlApiKey(options.firecrawlApiKey, options.firecrawlApiKeyEnv)}`
        },
        body: JSON.stringify({
            url: current.toString(),
            formats: [requestedFormat],
            onlyMainContent: true,
            removeBase64Images: true,
            blockAds: true,
            timeout: options.timeoutMs
        })
    }, options.timeoutMs);
    if (response.status >= 300 && response.status < 400)
        throw new Error("Firecrawl web fetch does not follow provider redirects.");
    if (!response.ok)
        throw new Error(`Firecrawl web fetch failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/application\/json|text\/json|application\/problem\+json/iu.test(contentType)) {
        throw new Error(`Firecrawl web fetch only accepts JSON responses; got '${contentType}'.`);
    }
    const body = await readBoundedResponseText(response, options.maxResponseBytes);
    const parsed = parseFirecrawlScrapeReadable(body.text, options.extractMode);
    return {
        url: current.toString(),
        status: parsed.status ?? response.status,
        contentType: parsed.contentType,
        bytesRead: body.bytesRead,
        responseTruncated: body.truncated,
        extractMode: options.extractMode,
        readable: parsed.readable
    };
}
function formatWebFetchResult(value, maxChars, cacheStatus) {
    const truncatedText = value.readable.length > maxChars ? `${value.readable.slice(0, maxChars)}\n\n[truncated at ${maxChars} chars]` : value.readable;
    return {
        url: value.url,
        status: value.status,
        contentType: value.contentType,
        bytesRead: value.bytesRead,
        responseTruncated: value.responseTruncated,
        outputTruncated: value.readable.length > maxChars,
        extractMode: value.extractMode,
        cacheStatus,
        text: truncatedText
    };
}
function pruneExpiredWebFetchCache(cache, now) {
    if (cache.size <= 100)
        return;
    for (const [key, value] of cache) {
        if (value.expiresAt <= now || cache.size > 100)
            cache.delete(key);
    }
}
async function normalizeWebFetchUrl(value, lookupImpl) {
    let url;
    try {
        url = new URL(value.trim());
    }
    catch {
        throw new Error("Web fetch URL must be a valid http:// or https:// URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("Web fetch URL must use http:// or https://.");
    }
    if (!url.hostname)
        throw new Error("Web fetch URL must include a hostname.");
    if (url.username || url.password)
        throw new Error("Web fetch URL credentials are not allowed.");
    if (url.hash)
        url.hash = "";
    await assertPublicWebFetchHost(url.hostname, lookupImpl);
    return url;
}
async function assertPublicWebFetchHost(rawHostname, lookupImpl) {
    const hostname = normalizeHostname(rawHostname);
    if (!hostname)
        throw new Error("Web fetch hostname is required.");
    if (isBlockedInternalHostname(hostname))
        throw new Error("Web fetch blocks private/internal hostnames.");
    if (isIP(hostname)) {
        if (isPrivateOrReservedIp(hostname))
            throw new Error("Web fetch blocks private/internal IP addresses.");
        return;
    }
    const addresses = await lookupImpl(hostname);
    if (addresses.length === 0)
        throw new Error(`Web fetch could not resolve hostname '${hostname}'.`);
    for (const address of addresses) {
        if (isPrivateOrReservedIp(address.address)) {
            throw new Error("Web fetch blocks hostnames that resolve to private/internal IP addresses.");
        }
    }
}
function normalizeHostname(hostname) {
    return hostname.trim().toLowerCase().replace(/^\[/u, "").replace(/\]$/u, "").replace(/\.$/u, "");
}
function isBlockedInternalHostname(hostname) {
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local"))
        return true;
    if (hostname === "metadata.google.internal" || hostname === "metadata")
        return true;
    if (!hostname.includes(".") && !isIP(hostname))
        return true;
    return false;
}
function isPrivateOrReservedIp(address) {
    const normalized = normalizeHostname(address);
    if (normalized.startsWith("::ffff:"))
        return isPrivateOrReservedIp(normalized.slice("::ffff:".length));
    const family = isIP(normalized);
    if (family === 4)
        return isPrivateOrReservedIpv4(normalized);
    if (family === 6)
        return isPrivateOrReservedIpv6(normalized);
    return true;
}
function isPrivateOrReservedIpv4(address) {
    const parts = address.split(".").map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = parts;
    return a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0 && parts[2] === 2)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && parts[2] === 100)
        || (a === 203 && b === 0 && parts[2] === 113)
        || a >= 224;
}
function isPrivateOrReservedIpv6(address) {
    const normalized = address.toLowerCase();
    const firstHextet = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return normalized === "::"
        || normalized === "::1"
        || (firstHextet & 0xfe00) === 0xfc00
        || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
        || (firstHextet & 0xff00) === 0xff00
        || normalized.startsWith("2001:db8:");
}
async function readBoundedResponseText(response, maxBytes) {
    if (!response.body) {
        const raw = await response.text();
        const bytes = Buffer.byteLength(raw);
        return {
            text: bytes > maxBytes ? raw.slice(0, maxBytes) : raw,
            bytesRead: Math.min(bytes, maxBytes),
            truncated: bytes > maxBytes
        };
    }
    const reader = response.body.getReader();
    const chunks = [];
    let bytesRead = 0;
    let truncated = false;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            if (!value)
                continue;
            const remaining = maxBytes - bytesRead;
            if (remaining <= 0) {
                truncated = true;
                await reader.cancel().catch(() => undefined);
                break;
            }
            if (value.byteLength > remaining) {
                chunks.push(value.slice(0, remaining));
                bytesRead += remaining;
                truncated = true;
                await reader.cancel().catch(() => undefined);
                break;
            }
            chunks.push(value);
            bytesRead += value.byteLength;
        }
    }
    finally {
        reader.releaseLock();
    }
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(concatUint8Arrays(chunks, bytesRead)), bytesRead, truncated };
}
function concatUint8Arrays(chunks, totalLength) {
    const output = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
function isReadableWebContentType(contentType) {
    const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
    if (!normalized)
        return true;
    return WEB_FETCH_TEXT_CONTENT_TYPES.some((prefix) => normalized === prefix.replace(/\/$/u, "") || normalized.startsWith(prefix));
}
function extractReadableWebContent(raw, contentType, mode) {
    return mode === "markdown" ? extractReadableWebMarkdown(raw, contentType) : extractReadableWebText(raw, contentType);
}
function extractReadableWebText(raw, contentType) {
    if (!/html|xml/u.test(contentType.toLowerCase()))
        return normalizeReadableWhitespace(raw);
    const withoutScripts = stripUnsafeHtml(raw)
        .replace(/<(?:br|p|div|section|article|header|footer|main|li|tr|h[1-6])\b[^>]*>/giu, "\n")
        .replace(/<\/(?:p|div|section|article|header|footer|main|li|tr|h[1-6])>/giu, "\n")
        .replace(/<[^>]+>/gu, " ");
    return normalizeReadableWhitespace(decodeBasicHtmlEntities(withoutScripts));
}
function extractReadableWebMarkdown(raw, contentType) {
    if (!/html|xml/u.test(contentType.toLowerCase()))
        return normalizeReadableWhitespace(raw);
    const markdown = stripUnsafeHtml(raw)
        .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/giu, (_match, text) => `\n# ${htmlFragmentToText(text)}\n`)
        .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/giu, (_match, text) => `\n## ${htmlFragmentToText(text)}\n`)
        .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/giu, (_match, text) => `\n### ${htmlFragmentToText(text)}\n`)
        .replace(/<h([4-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_match, level, text) => `\n${"#".repeat(Number(level))} ${htmlFragmentToText(text)}\n`)
        .replace(/<a\b(?=[^>]*\bhref=(["'])(.*?)\1)[^>]*>([\s\S]*?)<\/a>/giu, (_match, _quote, href, text) => {
        const label = htmlFragmentToText(text);
        const url = normalizeMarkdownLinkUrl(href);
        return label && url ? `[${escapeMarkdownLinkLabel(label)}](${url})` : label;
    })
        .replace(/<li\b[^>]*>/giu, "\n- ")
        .replace(/<\/li>/giu, "\n")
        .replace(/<(?:br|p|div|section|article|header|footer|main|tr)\b[^>]*>/giu, "\n")
        .replace(/<\/(?:p|div|section|article|header|footer|main|tr)>/giu, "\n")
        .replace(/<[^>]+>/gu, " ");
    return normalizeReadableWhitespace(decodeBasicHtmlEntities(markdown));
}
function normalizeMarkdownLinkUrl(rawHref) {
    const href = decodeBasicHtmlEntities(rawHref.trim());
    if (!href || href.startsWith("#") || href.startsWith("javascript:"))
        return undefined;
    try {
        const absoluteHref = href.startsWith("//") ? `https:${href}` : href;
        if (!/^https?:\/\//iu.test(absoluteHref))
            return undefined;
        const url = new URL(absoluteHref);
        if (url.protocol !== "https:" && url.protocol !== "http:")
            return undefined;
        if (url.username || url.password)
            return undefined;
        const hostname = normalizeHostname(url.hostname);
        if (isBlockedInternalHostname(hostname) || (isIP(hostname) && isPrivateOrReservedIp(hostname)))
            return undefined;
        url.hash = "";
        return url.toString();
    }
    catch {
        return undefined;
    }
}
function escapeMarkdownLinkLabel(value) {
    return value.replace(/[[\]\\]/gu, "\\$&");
}
function stripUnsafeHtml(raw) {
    return raw
        .replace(/<!--[\s\S]*?-->/gu, " ")
        .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
        .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, " ");
}
function decodeBasicHtmlEntities(value) {
    return value
        .replace(/&nbsp;/giu, " ")
        .replace(/&amp;/giu, "&")
        .replace(/&lt;/giu, "<")
        .replace(/&gt;/giu, ">")
        .replace(/&quot;/giu, "\"")
        .replace(/&#39;|&apos;/giu, "'")
        .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/giu, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
function normalizeReadableWhitespace(value) {
    return value
        .replace(/\r\n?/gu, "\n")
        .replace(/[\t\f\v ]+/gu, " ")
        .replace(/\n[ \t]+/gu, "\n")
        .replace(/\n{3,}/gu, "\n\n")
        .trim();
}
function normalizeWebFetchMaxChars(value, fallback) {
    if (!value)
        return Math.max(1, fallback);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error("web-fetch maxChars must be a positive integer.");
    return Math.min(parsed, Math.max(1, fallback));
}
function splitWebFetchOptionalArgs(second, third) {
    if (second && !third && isWebFetchExtractMode(second))
        return [undefined, second];
    return [second, third];
}
function normalizeWebFetchExtractMode(value, fallback) {
    if (!value)
        return fallback;
    const normalized = value.trim().toLowerCase();
    if (isWebFetchExtractMode(normalized))
        return normalized;
    throw new Error("web-fetch extractMode must be text or markdown.");
}
function isWebFetchExtractMode(value) {
    return value === "text" || value === "markdown";
}
function normalizeWebSearchMaxResults(value, fallback) {
    const cap = Math.max(1, Math.min(20, fallback || WEB_SEARCH_DEFAULT_MAX_RESULTS));
    if (!value)
        return cap;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error("web-search maxResults must be a positive integer.");
    return Math.min(parsed, cap);
}
function normalizeSearchMaxMatches(value) {
    if (!value)
        return SEARCH_DEFAULT_MAX_MATCHES;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
        throw new Error("search-files maxMatches must be a positive integer.");
    return Math.min(parsed, SEARCH_MAX_MATCHES);
}
function isLikelyBinary(buffer) {
    for (const byte of buffer) {
        if (byte === 0)
            return true;
    }
    return false;
}
function searchSnippet(line) {
    const normalized = line
        .replace(/[\u0000-\u001f\u007f]/gu, " ")
        .replace(/\s+/gu, " ")
        .trim();
    if (normalized.length <= SEARCH_SNIPPET_CHARS)
        return normalized;
    return `${normalized.slice(0, SEARCH_SNIPPET_CHARS - 1)}…`;
}
async function defaultLookup(hostname) {
    return await dnsLookup(hostname, { all: true, verbatim: true });
}
function outputTruncationNote(result) {
    const notes = [];
    if (result.stdoutTruncated)
        notes.push(`stdout truncated at ${result.maxOutputBytes} bytes`);
    if (result.stderrTruncated)
        notes.push(`stderr truncated at ${result.maxOutputBytes} bytes`);
    return notes.length ? `[${notes.join("; ")}]` : "";
}
export function splitCommandLine(input) {
    const tokens = [];
    let current = "";
    let quote;
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quote) {
            if (char === quote)
                quote = undefined;
            else
                current += char;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (/\s/u.test(char)) {
            if (current) {
                tokens.push(current);
                current = "";
            }
            continue;
        }
        current += char;
    }
    if (current)
        tokens.push(current);
    return tokens;
}
function isAllowedReadOnlyCommand(command, args, allowedCommands) {
    if (!command)
        return { ok: false, reason: "Command is required." };
    if (!allowedCommands.includes(command))
        return { ok: false, reason: `Command '${command}' is not allowlisted.` };
    if (command === "git") {
        if (args.some((arg) => ["-C", "-c", "--config-env", "--git-dir", "--work-tree", "--output"].includes(arg) || arg.startsWith("--config-env=") || arg.startsWith("--git-dir=") || arg.startsWith("--work-tree=") || arg.startsWith("--output="))) {
            return { ok: false, reason: "Git directory/worktree redirection is not allowed." };
        }
        if (args.some(isUnsafeGitRenderingOption)) {
            return { ok: false, reason: "Git external diff/textconv/filter options are not allowed." };
        }
        const subcommand = gitSubcommand(args)?.value;
        if (!subcommand || !GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
            return { ok: false, reason: `Only read-only git subcommands are allowed: ${[...GIT_READ_ONLY_SUBCOMMANDS].join(", ")}` };
        }
    }
    if (command === "find" && args.some((arg) => MUTATING_FIND_ACTIONS.has(arg))) {
        return { ok: false, reason: "Mutating find actions are not allowed." };
    }
    if (command === "find" && args.some((arg) => ["-H", "-L", "-follow"].includes(arg))) {
        return { ok: false, reason: "Symlink-following find options are not allowed." };
    }
    if (command === "grep" && (hasShortOption(args, "R") || args.includes("--dereference-recursive"))) {
        return { ok: false, reason: "Symlink-following recursive grep options are not allowed." };
    }
    if (command === "rg" && (hasShortOption(args, "L") || args.includes("--follow"))) {
        return { ok: false, reason: "Symlink-following ripgrep options are not allowed." };
    }
    if (command === "rg" && args.some((arg) => arg === "--pre" || arg.startsWith("--pre="))) {
        return { ok: false, reason: "Ripgrep preprocessor commands are not allowed." };
    }
    if (command === "ls" && (hasShortOption(args, "L") || args.includes("--dereference"))) {
        return { ok: false, reason: "Symlink-dereferencing ls options are not allowed." };
    }
    if (command === "sed" && args.some((arg) => arg === "-i" || arg.startsWith("-i"))) {
        return { ok: false, reason: "In-place sed editing is not allowed." };
    }
    if (command === "sed") {
        const sedSafety = validateSedReadOnlyArgs(args);
        if (!sedSafety.ok)
            return sedSafety;
    }
    if (args.some((arg) => ["rm", "mv", "cp", "chmod", "chown", "sudo"].includes(basename(arg)))) {
        return { ok: false, reason: "Mutating helper commands are not allowed as arguments." };
    }
    return { ok: true };
}
function isUnsafeGitRenderingOption(arg) {
    return arg === "--ext-diff"
        || arg === "--external-diff"
        || arg === "--textconv"
        || arg === "--filters"
        || arg.startsWith("--ext-diff=")
        || arg.startsWith("--external-diff=")
        || arg.startsWith("--textconv=")
        || arg.startsWith("--filters=");
}
function gitSubcommand(args) {
    const index = args.findIndex((arg) => !arg.startsWith("-"));
    return index >= 0 ? { value: args[index], index } : undefined;
}
function hardenedShellArgs(command, args) {
    if (command !== "git")
        return args;
    const subcommand = gitSubcommand(args);
    if (!subcommand || !GIT_DIFF_RENDERING_SUBCOMMANDS.has(subcommand.value))
        return args;
    const output = [...args];
    output.splice(subcommand.index + 1, 0, "--no-ext-diff", "--no-textconv");
    return output;
}
function hardenedShellEnv(command) {
    if (command !== "git")
        return undefined;
    return {
        GIT_EXTERNAL_DIFF: undefined,
        GIT_PAGER: "cat",
        PAGER: "cat"
    };
}
function toolShellRuntimeEnv(command) {
    const env = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value === undefined || isToolHiddenEnvKey(key))
            continue;
        env[key] = value;
    }
    return { ...env, ...hardenedShellEnv(command) };
}
function isToolHiddenEnvKey(key) {
    return key.startsWith("VISER_") || /token|secret|key|password|credential/i.test(key);
}
async function resolveSafeShellCommand(command, shellRoot, pathValue = process.env.PATH ?? "") {
    if (command.includes("/")) {
        const commandPath = isAbsolute(command) ? resolve(command) : resolve(shellRoot, command);
        if (!isAbsolute(command) && !isInside(commandPath, shellRoot)) {
            throw new Error(`Shell command escapes the tool root: ${commandPath}`);
        }
        await assertSafeShellCommandCandidate(commandPath, shellRoot);
        return commandPath;
    }
    for (const entry of pathValue.split(delimiter)) {
        if (!entry)
            continue;
        const dir = isAbsolute(entry) ? resolve(entry) : resolve(shellRoot, entry);
        const candidate = join(dir, command);
        try {
            await access(candidate, constants.X_OK);
        }
        catch {
            continue;
        }
        await assertSafeShellCommandCandidate(candidate, shellRoot);
        return candidate;
    }
    throw new Error(`Shell command was not found on PATH: ${command}`);
}
async function assertSafeShellCommandCandidate(commandPath, shellRoot) {
    const workspaceRoot = resolve(process.cwd());
    const nofollowRoot = isInside(commandPath, workspaceRoot)
        ? workspaceRoot
        : isInside(commandPath, shellRoot)
            ? shellRoot
            : undefined;
    if (!nofollowRoot)
        return;
    await assertNoToolPathSymlinkComponents(commandPath, nofollowRoot);
    const info = await lstat(commandPath);
    if (info.isSymbolicLink())
        throw new Error(`Shell command is a symlink: ${commandPath}`);
    if (!info.isFile())
        throw new Error(`Shell command is not a regular file: ${commandPath}`);
}
function validateSedReadOnlyArgs(args) {
    const scripts = [];
    let expectsExpression = false;
    let sawExpressionOption = false;
    let consumedMainScript = false;
    for (const arg of args) {
        if (expectsExpression) {
            scripts.push(arg);
            expectsExpression = false;
            sawExpressionOption = true;
            continue;
        }
        if (arg === "-e" || arg === "--expression") {
            expectsExpression = true;
            continue;
        }
        if (arg.startsWith("-e") && arg.length > 2) {
            scripts.push(arg.slice(2));
            sawExpressionOption = true;
            continue;
        }
        if (arg.startsWith("--expression=")) {
            scripts.push(arg.slice("--expression=".length));
            sawExpressionOption = true;
            continue;
        }
        if (arg === "-f" || arg === "--file" || (arg.startsWith("-f") && arg.length > 2) || arg.startsWith("--file=")) {
            return { ok: false, reason: "Sed script files are not allowed in the shell tool." };
        }
        if (arg.startsWith("-"))
            continue;
        if (!sawExpressionOption && !consumedMainScript) {
            scripts.push(arg);
            consumedMainScript = true;
        }
    }
    if (expectsExpression)
        return { ok: false, reason: "Sed expression is missing after -e/--expression." };
    for (const script of scripts) {
        if (hasUnsafeSedScript(script)) {
            return { ok: false, reason: "Sed file read/write or execute commands are not allowed." };
        }
    }
    return { ok: true };
}
function hasUnsafeSedScript(script) {
    return UNSAFE_SED_COMMAND_PATTERN.test(script) || hasUnsafeSedSubstitutionFlag(script);
}
function hasUnsafeSedSubstitutionFlag(script) {
    for (let index = 0; index < script.length - 1; index += 1) {
        if (script[index] !== "s")
            continue;
        const delimiter = script[index + 1];
        if (!delimiter || /[\sA-Za-z0-9\\]/u.test(delimiter))
            continue;
        const firstEnd = findUnescaped(script, delimiter, index + 2);
        if (firstEnd < 0)
            continue;
        const secondEnd = findUnescaped(script, delimiter, firstEnd + 1);
        if (secondEnd < 0)
            continue;
        const flagsEnd = findSedCommandBoundary(script, secondEnd + 1);
        const flags = script.slice(secondEnd + 1, flagsEnd);
        if (/[wWeE]/u.test(flags))
            return true;
        index = flagsEnd;
    }
    return false;
}
function findUnescaped(value, needle, start) {
    for (let index = start; index < value.length; index += 1) {
        if (value[index] === "\\") {
            index += 1;
            continue;
        }
        if (value[index] === needle)
            return index;
    }
    return -1;
}
function findSedCommandBoundary(value, start) {
    for (let index = start; index < value.length; index += 1) {
        if (value[index] === ";" || value[index] === "\n" || value[index] === "}")
            return index;
    }
    return value.length;
}
async function validateShellPathArguments(args, allowedReadRoots) {
    const safeAllowedRoots = await Promise.all(allowedReadRoots.map((root) => resolveSafeToolRoot(root)));
    for (const arg of args) {
        if (!arg || arg === "--")
            continue;
        for (const candidate of pathCandidatesFromShellArg(arg)) {
            if (!candidate)
                continue;
            if (candidate.startsWith("/"))
                return { ok: false, reason: `Absolute paths are not allowed in shell tool arguments: ${arg}` };
            if (hasPathTraversal(candidate)) {
                return { ok: false, reason: `Path traversal is not allowed in shell tool arguments: ${arg}` };
            }
            const pathSafety = await validateExistingPathCandidate(candidate, safeAllowedRoots);
            if (!pathSafety.ok) {
                return {
                    ok: false,
                    reason: pathSafety.reason === "symlink"
                        ? `Shell path contains a symlink: ${arg}`
                        : `Shell path resolves outside allowed read roots: ${arg}`
                };
            }
        }
    }
    return { ok: true };
}
function pathCandidatesFromShellArg(arg) {
    if (arg.startsWith("-")) {
        const equalIndex = arg.indexOf("=");
        return equalIndex >= 0 ? [arg.slice(equalIndex + 1)] : [];
    }
    return [arg];
}
function hasPathTraversal(value) {
    return value.split(/[\\/]/u).includes("..");
}
async function resolveSafeToolRoot(root) {
    if (!root)
        throw new Error("Tool allowed read root is not configured.");
    const lexical = resolve(root);
    await assertToolRootIsSafe(lexical);
    return {
        lexical,
        real: await realpath(lexical)
    };
}
async function validateExistingPathCandidate(candidate, allowedRoots) {
    const primaryRoot = allowedRoots[0];
    const resolved = resolve(primaryRoot.lexical, candidate);
    let existing;
    try {
        existing = await realpath(resolved);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
            const symlinkSafety = await validateNoToolPathSymlinkComponents(resolved, primaryRoot.lexical);
            return symlinkSafety.ok ? { ok: true } : { ok: false, reason: "symlink" };
        }
        throw error;
    }
    if (!allowedRoots.some((root) => isInside(existing, root.real)))
        return { ok: false, reason: "outside" };
    const symlinkSafety = await validateNoToolPathSymlinkComponents(resolved, primaryRoot.lexical);
    return symlinkSafety.ok ? { ok: true } : { ok: false, reason: "symlink" };
}
async function assertToolRootIsSafe(path) {
    const absolutePath = resolve(path);
    const cwd = resolve(process.cwd());
    if (isInside(absolutePath, cwd)) {
        await assertNoToolPathSymlinkComponents(absolutePath, cwd);
        return;
    }
    try {
        const info = await lstat(absolutePath);
        if (info.isSymbolicLink())
            throw new Error(`Tool allowed read root contains a symlink: ${absolutePath}`);
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return;
        throw error;
    }
}
async function assertNoToolPathSymlinkComponents(path, root) {
    const absolutePath = resolve(path);
    const absoluteRoot = resolve(root);
    const relativePath = relative(absoluteRoot, absolutePath);
    let current = absoluteRoot;
    const rootExists = await assertToolPathComponentIsNotSymlink(current);
    if (!rootExists)
        return;
    for (const part of relativePath.split(/[\\/]/u).filter(Boolean)) {
        current = join(current, part);
        const exists = await assertToolPathComponentIsNotSymlink(current);
        if (!exists)
            return;
    }
}
async function assertToolPathComponentIsNotSymlink(path) {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink())
            throw new Error(`Tool path contains a symlink: ${path}`);
        return true;
    }
    catch (error) {
        if (isNodeError(error) && error.code === "ENOENT")
            return false;
        throw error;
    }
}
async function validateNoToolPathSymlinkComponents(path, root) {
    try {
        await assertNoToolPathSymlinkComponents(path, root);
        return { ok: true };
    }
    catch (error) {
        if (error instanceof Error && /symlink/i.test(error.message))
            return { ok: false };
        throw error;
    }
}
function hasShortOption(args, option) {
    return args.some((arg) => arg === `-${option}` || (/^-[^-]/u.test(arg) && arg.slice(1).includes(option)));
}
function isInside(child, parent) {
    const rel = relative(parent, child);
    return !rel.startsWith("..") && !isAbsolute(rel);
}
function toolErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = isNodeError(error) ? error.code : undefined;
    if (code === "ENOENT")
        return `Path or command was not found. ${message}`;
    if (code === "EACCES" || code === "EPERM")
        return `Permission denied. ${message}`;
    if (code === "ENOTDIR")
        return `A path component is not a directory. ${message}`;
    if (code === "EISDIR")
        return `Target is a directory, not a file. ${message}`;
    return message;
}
function isNodeError(error) {
    return typeof error === "object" && error !== null && "code" in error;
}
