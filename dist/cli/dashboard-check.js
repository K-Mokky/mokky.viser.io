// ================================================================
// Runtime dashboard contract check
// ================================================================
// `dashboard` is provider-free, but foreground gateway deployments still need a
// cheap proof that the localhost listener is actually alive and serving the
// current DashboardData contract. This command validates the live HTTP surface
// without touching providers, jobs, or write/action routes.
import { DASHBOARD_SCHEMA_VERSION } from "../connectors/web-dashboard.js";
import { fetchWithTimeout } from "../utils/fetch.js";
const DEFAULT_DASHBOARD_CHECK_TIMEOUT_MS = 3_000;
const LOCAL_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export async function dashboardCheck(config, options = {}) {
    const host = options.host ?? config.webDashboard.host;
    const port = options.port ?? config.webDashboard.port;
    const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_DASHBOARD_CHECK_TIMEOUT_MS);
    const fetchImpl = options.fetchImpl ?? fetch;
    const target = dashboardBaseUrl(host, port);
    const items = [];
    if (!LOCAL_DASHBOARD_HOSTS.has(host) && !config.webDashboard.allowRemote) {
        items.push({
            status: "fail",
            area: "target",
            message: `refusing non-localhost dashboard host '${host}'`,
            next: "Use 127.0.0.1, localhost, or ::1. For remote access, create an explicit local tunnel."
        });
    }
    if (!LOCAL_DASHBOARD_HOSTS.has(host) && config.webDashboard.allowRemote && !config.webDashboard.authToken) {
        items.push({
            status: "fail",
            area: "target",
            message: `remote dashboard host '${host}' requires token authentication`,
            next: `Set ${config.webDashboard.authTokenEnv || "VISER_DASHBOARD_TOKEN"} before checking or exposing a non-local dashboard target.`
        });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        items.push({
            status: "fail",
            area: "target",
            message: `invalid dashboard port '${String(port)}'`,
            next: "Use a TCP port between 1 and 65535."
        });
    }
    items.push({
        status: config.webDashboard.enabled ? "pass" : "warn",
        area: "config",
        message: config.webDashboard.enabled
            ? "webDashboard.enabled=true in config"
            : "webDashboard.enabled=false in config; checking the target anyway for ad-hoc web-dashboard runs",
        next: config.webDashboard.enabled ? undefined : "Set webDashboard.enabled=true for foreground gateway startup, or run `viser web-dashboard`."
    });
    if (!items.some((item) => item.status === "fail")) {
        await collectLiveDashboardItems(target, fetchImpl, timeoutMs, items, config.webDashboard.authToken);
    }
    const ok = items.every((item) => item.status !== "fail");
    return { ok, target, items, report: formatDashboardCheckReport(target, timeoutMs, items) };
}
export async function dashboardCheckReport(config, options = {}) {
    return (await dashboardCheck(config, options)).report;
}
async function collectLiveDashboardItems(target, fetchImpl, timeoutMs, items, authToken) {
    try {
        const health = asRecord(await fetchJson(fetchImpl, `${target}/healthz`, timeoutMs, authToken));
        const ok = health?.ok === true && health.surface === "web-dashboard";
        items.push({
            status: ok ? "pass" : "fail",
            area: "healthz",
            message: ok ? "web dashboard health endpoint responded" : "healthz response did not match the web-dashboard contract",
            next: ok ? undefined : "Restart the foreground dashboard or `viser` runtime and rerun `viser dashboard-check`."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "healthz",
            message: `dashboard health request failed: ${errorMessage(error)}`,
            next: "Start or restart the dashboard in the foreground: `viser web-dashboard` or `viser`."
        });
        return;
    }
    try {
        const dashboard = asRecord(await fetchJson(fetchImpl, `${target}/dashboard.json`, timeoutMs, authToken));
        const capabilities = asRecord(dashboard?.capabilities);
        const runtime = asRecord(dashboard?.runtime);
        const webDashboard = asRecord(runtime?.webDashboard);
        const state = asRecord(dashboard?.state);
        const operatorActivity = asRecord(state?.operatorActivity);
        const contractOk = dashboard?.schemaVersion === DASHBOARD_SCHEMA_VERSION
            && capabilities?.readOnly === true
            && capabilities?.providerCalls === false
            && capabilities?.writeActions === false
            && capabilities?.jobExecution === false
            && capabilities?.liveProviderProof === false;
        const runtimeOk = webDashboard?.enabled === true && typeof webDashboard.host === "string" && typeof webDashboard.port === "number";
        const activityOk = typeof operatorActivity?.count === "number" && Array.isArray(operatorActivity.items);
        items.push({
            status: contractOk ? "pass" : "fail",
            area: "dashboard-json",
            message: contractOk
                ? `dashboard.json serves schemaVersion=${DASHBOARD_SCHEMA_VERSION} read-only capabilities`
                : "dashboard.json is stale or missing schemaVersion/capabilities",
            next: contractOk ? undefined : "Restart the foreground process so it loads the current dashboard code."
        });
        items.push({
            status: runtimeOk ? "pass" : "fail",
            area: "dashboard-runtime",
            message: runtimeOk
                ? `dashboard runtime reports ${webDashboard.host}:${webDashboard.port}`
                : "dashboard runtime snapshot does not report an enabled webDashboard",
            next: runtimeOk ? undefined : "Verify `webDashboard.enabled=true` and restart the foreground gateway/dashboard."
        });
        items.push({
            status: activityOk ? "pass" : "fail",
            area: "dashboard-activity",
            message: activityOk
                ? `dashboard.json serves operator activity stream (${operatorActivity.count} item(s))`
                : "dashboard.json is missing the operator activity stream",
            next: activityOk ? undefined : "Restart the foreground process so it exposes current approvals/jobs/schedules/sessions."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-json",
            message: `dashboard.json request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime and inspect the terminal output."
        });
    }
    try {
        const schema = asRecord(await fetchJson(fetchImpl, `${target}/dashboard.schema.json`, timeoutMs, authToken));
        const properties = asRecord(schema?.properties);
        const schemaVersion = asRecord(properties?.schemaVersion);
        const capabilities = asRecord(properties?.capabilities);
        const capabilityProperties = asRecord(capabilities?.properties);
        const readOnly = asRecord(capabilityProperties?.readOnly);
        const writeActions = asRecord(capabilityProperties?.writeActions);
        const schemaOk = schema?.["$id"] === "https://viser.local/schemas/dashboard.v1.json"
            && schemaVersion?.const === DASHBOARD_SCHEMA_VERSION
            && readOnly?.const === true
            && writeActions?.const === false;
        items.push({
            status: schemaOk ? "pass" : "fail",
            area: "dashboard-schema",
            message: schemaOk
                ? "dashboard.schema.json serves dashboard.v1 contract"
                : "dashboard.schema.json is missing or stale",
            next: schemaOk ? undefined : "Restart the service so `/dashboard.schema.json` is available from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-schema",
            message: `dashboard.schema.json request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still serve the pre-schema build."
        });
    }
    try {
        const canvas = await fetchText(fetchImpl, `${target}/dashboard.canvas.svg`, timeoutMs, "image/svg+xml", authToken);
        const canvasOk = canvas.contentType.includes("image/svg+xml")
            && canvas.text.includes("<svg")
            && canvas.text.includes("Viser read-only dashboard canvas")
            && canvas.text.includes("no provider calls");
        items.push({
            status: canvasOk ? "pass" : "fail",
            area: "dashboard-canvas",
            message: canvasOk
                ? "dashboard.canvas.svg serves a read-only SVG canvas snapshot"
                : "dashboard.canvas.svg is missing or stale",
            next: canvasOk ? undefined : "Restart the foreground dashboard/runtime so `/dashboard.canvas.svg` is served from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-canvas",
            message: `dashboard.canvas.svg request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still serve the pre-canvas build."
        });
    }
    try {
        const collab = await fetchText(fetchImpl, `${target}/canvas.html`, timeoutMs, "text/html", authToken);
        const collabOk = collab.contentType.includes("text/html")
            && collab.text.includes("Viser Collaborative Canvas")
            && collab.text.includes("x-viser-canvas-token")
            && collab.text.includes("Persistent localhost board")
            && collab.text.includes("never calls providers");
        items.push({
            status: collabOk ? "pass" : "fail",
            area: "dashboard-collab-canvas",
            message: collabOk
                ? "canvas.html serves a token-protected persistent localhost collaborative canvas"
                : "canvas.html is missing or stale",
            next: collabOk ? undefined : "Restart the foreground dashboard/runtime so `/canvas.html` is served from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-collab-canvas",
            message: `canvas.html request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still lack the collaborative canvas."
        });
    }
    try {
        const chat = await fetchText(fetchImpl, `${target}/chat.html`, timeoutMs, "text/html", authToken);
        const chatOk = chat.contentType.includes("text/html")
            && chat.text.includes("Viser WebChat")
            && chat.text.includes("x-viser-web-chat-token")
            && chat.text.includes("localhost only");
        items.push({
            status: chatOk ? "pass" : "fail",
            area: "dashboard-web-chat",
            message: chatOk
                ? "chat.html serves a localhost-only token-protected WebChat page"
                : "chat.html is missing or stale",
            next: chatOk ? undefined : "Restart the foreground dashboard/runtime so `/chat.html` is served from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-web-chat",
            message: `chat.html request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still lack WebChat."
        });
    }
    try {
        const voice = await fetchText(fetchImpl, `${target}/voice.html`, timeoutMs, "text/html", authToken);
        const voiceOk = voice.contentType.includes("text/html")
            && voice.text.includes("Viser Voice Capture")
            && voice.text.includes("SpeechRecognition")
            && voice.text.includes("viser voice --propose-speak")
            && voice.text.includes("does not call providers");
        items.push({
            status: voiceOk ? "pass" : "fail",
            area: "dashboard-voice-capture",
            message: voiceOk
                ? "voice.html serves a browser-side microphone transcript capture page without provider routes"
                : "voice.html is missing or stale",
            next: voiceOk ? undefined : "Restart the foreground dashboard/runtime so `/voice.html` is served from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-voice-capture",
            message: `voice.html request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still lack voice capture."
        });
    }
    try {
        const capture = await fetchText(fetchImpl, `${target}/capture.html`, timeoutMs, "text/html", authToken);
        const captureOk = capture.contentType.includes("text/html")
            && capture.text.includes("Viser Camera and Screen Capture")
            && capture.text.includes("getUserMedia")
            && capture.text.includes("getDisplayMedia")
            && capture.text.includes("does not call providers");
        items.push({
            status: captureOk ? "pass" : "fail",
            area: "dashboard-media-capture",
            message: captureOk
                ? "capture.html serves a browser-side camera and screen capture page without provider routes"
                : "capture.html is missing or stale",
            next: captureOk ? undefined : "Restart the foreground dashboard/runtime so `/capture.html` is served from the current code."
        });
    }
    catch (error) {
        items.push({
            status: "fail",
            area: "dashboard-media-capture",
            message: `capture.html request failed: ${errorMessage(error)}`,
            next: "Restart the foreground dashboard/runtime; this catches old processes that still lack media capture."
        });
    }
}
async function fetchJson(fetchImpl, url, timeoutMs, authToken) {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: requestHeaders("application/json", authToken) }, timeoutMs);
    const text = await response.text();
    if (!response.ok)
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new Error(`invalid JSON: ${errorMessage(error)}`);
    }
}
async function fetchText(fetchImpl, url, timeoutMs, accept, authToken) {
    const response = await fetchWithTimeout(fetchImpl, url, { headers: requestHeaders(accept, authToken) }, timeoutMs);
    const text = await response.text();
    if (!response.ok)
        throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
    return { text, contentType: response.headers.get("content-type") ?? "" };
}
function requestHeaders(accept, authToken) {
    return authToken ? { accept, authorization: `Bearer ${authToken}` } : { accept };
}
function formatDashboardCheckReport(target, timeoutMs, items) {
    const failCount = items.filter((item) => item.status === "fail").length;
    const warnCount = items.filter((item) => item.status === "warn").length;
    const passCount = items.filter((item) => item.status === "pass").length;
    const ok = failCount === 0;
    const blockers = items.filter((item) => item.status === "fail");
    const warnings = items.filter((item) => item.status === "warn");
    return [
        `Viser dashboard check: ${ok ? "PASS" : "BLOCKED"}`,
        `target: ${target}`,
        `mode: provider-free runtime HTTP contract check (timeout=${timeoutMs}ms)`,
        `summary: ${passCount} pass, ${warnCount} warn, ${failCount} fail`,
        "",
        ...items.map(formatItem),
        "",
        "Blockers:",
        blockers.length ? blockers.map((item) => `- [${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`).join("\n") : "- none",
        "",
        "Warnings:",
        warnings.length ? warnings.map((item) => `- [${item.area}] ${item.message}${item.next ? ` — ${item.next}` : ""}`).join("\n") : "- none",
        "",
        "Next:",
        ok
            ? `- Open ${target}/ in a browser, or run \`viser launch-status\` for live provider proof.`
            : "- Fix the blocker above, then rerun `viser dashboard-check --strict`."
    ].join("\n");
}
function formatItem(item) {
    const prefix = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
    return `${prefix} [${item.area}] ${item.message}${item.status === "pass" || !item.next ? "" : `\n   next: ${item.next}`}`;
}
function dashboardBaseUrl(host, port) {
    return `http://${urlHost(host)}:${port}`;
}
function urlHost(host) {
    return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
