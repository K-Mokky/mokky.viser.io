// ================================================================
// Runtime dashboard contract check
// ================================================================
// `dashboard` is provider-free, but service/gateway deployments still need a
// cheap proof that the localhost listener is actually alive and serving the
// current DashboardData contract. This command validates the live HTTP surface
// without touching providers, jobs, or write/action routes.

import { DASHBOARD_SCHEMA_VERSION } from "../connectors/web-dashboard.ts";
import { fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import type { ViserConfig } from "../core/types.ts";

const DEFAULT_DASHBOARD_CHECK_TIMEOUT_MS = 3_000;
const LOCAL_DASHBOARD_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export interface DashboardCheckOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface DashboardCheckItem {
  status: "pass" | "warn" | "fail";
  area: string;
  message: string;
  next?: string;
}

export interface DashboardCheckResult {
  ok: boolean;
  target: string;
  items: DashboardCheckItem[];
  report: string;
}

export async function dashboardCheck(config: ViserConfig, options: DashboardCheckOptions = {}): Promise<DashboardCheckResult> {
  const host = options.host ?? config.webDashboard.host;
  const port = options.port ?? config.webDashboard.port;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_DASHBOARD_CHECK_TIMEOUT_MS);
  const fetchImpl = options.fetchImpl ?? fetch;
  const target = dashboardBaseUrl(host, port);
  const items: DashboardCheckItem[] = [];

  if (!LOCAL_DASHBOARD_HOSTS.has(host)) {
    items.push({
      status: "fail",
      area: "target",
      message: `refusing non-localhost dashboard host '${host}'`,
      next: "Use 127.0.0.1, localhost, or ::1. For remote access, create an explicit local tunnel."
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
    next: config.webDashboard.enabled ? undefined : "Set webDashboard.enabled=true for service/gateway startup, or run `node src/index.ts web-dashboard`."
  });

  if (!items.some((item) => item.status === "fail")) {
    await collectLiveDashboardItems(target, fetchImpl, timeoutMs, items);
  }

  const ok = items.every((item) => item.status !== "fail");
  return { ok, target, items, report: formatDashboardCheckReport(target, timeoutMs, items) };
}

export async function dashboardCheckReport(config: ViserConfig, options: DashboardCheckOptions = {}): Promise<string> {
  return (await dashboardCheck(config, options)).report;
}

async function collectLiveDashboardItems(target: string, fetchImpl: FetchLike, timeoutMs: number, items: DashboardCheckItem[]): Promise<void> {
  try {
    const health = asRecord(await fetchJson(fetchImpl, `${target}/healthz`, timeoutMs));
    const ok = health?.ok === true && health.surface === "web-dashboard";
    items.push({
      status: ok ? "pass" : "fail",
      area: "healthz",
      message: ok ? "web dashboard health endpoint responded" : "healthz response did not match the web-dashboard contract",
      next: ok ? undefined : "Restart the dashboard/service and rerun `node src/index.ts dashboard-check`."
    });
  } catch (error) {
    items.push({
      status: "fail",
      area: "healthz",
      message: `dashboard health request failed: ${errorMessage(error)}`,
      next: "Start or restart the dashboard: `node src/index.ts service restart` or `node src/index.ts web-dashboard`."
    });
    return;
  }

  try {
    const dashboard = asRecord(await fetchJson(fetchImpl, `${target}/dashboard.json`, timeoutMs));
    const capabilities = asRecord(dashboard?.capabilities);
    const runtime = asRecord(dashboard?.runtime);
    const webDashboard = asRecord(runtime?.webDashboard);
    const contractOk = dashboard?.schemaVersion === DASHBOARD_SCHEMA_VERSION
      && capabilities?.readOnly === true
      && capabilities?.providerCalls === false
      && capabilities?.writeActions === false
      && capabilities?.jobExecution === false
      && capabilities?.liveProviderProof === false;
    const runtimeOk = webDashboard?.enabled === true && typeof webDashboard.host === "string" && typeof webDashboard.port === "number";

    items.push({
      status: contractOk ? "pass" : "fail",
      area: "dashboard-json",
      message: contractOk
        ? `dashboard.json serves schemaVersion=${DASHBOARD_SCHEMA_VERSION} read-only capabilities`
        : "dashboard.json is stale or missing schemaVersion/capabilities",
      next: contractOk ? undefined : "Restart the service so the running process loads the current dashboard code."
    });
    items.push({
      status: runtimeOk ? "pass" : "fail",
      area: "dashboard-runtime",
      message: runtimeOk
        ? `dashboard runtime reports ${webDashboard.host}:${webDashboard.port}`
        : "dashboard runtime snapshot does not report an enabled webDashboard",
      next: runtimeOk ? undefined : "Verify `webDashboard.enabled=true` and restart gateway/service."
    });
  } catch (error) {
    items.push({
      status: "fail",
      area: "dashboard-json",
      message: `dashboard.json request failed: ${errorMessage(error)}`,
      next: "Restart the dashboard/service and inspect `node src/index.ts service logs`."
    });
  }

  try {
    const schema = asRecord(await fetchJson(fetchImpl, `${target}/dashboard.schema.json`, timeoutMs));
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
  } catch (error) {
    items.push({
      status: "fail",
      area: "dashboard-schema",
      message: `dashboard.schema.json request failed: ${errorMessage(error)}`,
      next: "Restart the dashboard/service; this catches old processes that still serve the pre-schema build."
    });
  }

  try {
    const canvas = await fetchText(fetchImpl, `${target}/dashboard.canvas.svg`, timeoutMs, "image/svg+xml");
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
      next: canvasOk ? undefined : "Restart the dashboard/service so `/dashboard.canvas.svg` is served from the current code."
    });
  } catch (error) {
    items.push({
      status: "fail",
      area: "dashboard-canvas",
      message: `dashboard.canvas.svg request failed: ${errorMessage(error)}`,
      next: "Restart the dashboard/service; this catches old processes that still serve the pre-canvas build."
    });
  }
}

async function fetchJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { accept: "application/json" } }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`invalid JSON: ${errorMessage(error)}`);
  }
}

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  timeoutMs: number,
  accept: string
): Promise<{ text: string; contentType: string }> {
  const response = await fetchWithTimeout(fetchImpl, url, { headers: { accept } }, timeoutMs);
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  return { text, contentType: response.headers.get("content-type") ?? "" };
}

function formatDashboardCheckReport(target: string, timeoutMs: number, items: DashboardCheckItem[]): string {
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
      ? `- Open ${target}/ in a browser, or run \`node src/index.ts launch-status\` for live provider proof.`
      : "- Fix the blocker above, then rerun `node src/index.ts dashboard-check --strict`."
  ].join("\n");
}

function formatItem(item: DashboardCheckItem): string {
  const prefix = item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
  return `${prefix} [${item.area}] ${item.message}${item.status === "pass" || !item.next ? "" : `\n   next: ${item.next}`}`;
}

function dashboardBaseUrl(host: string, port: number): string {
  return `http://${urlHost(host)}:${port}`;
}

function urlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
