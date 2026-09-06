// ================================================================
// Notion page append sender
// ================================================================
// Notion workspace automation is approval-gated like other outbound connector
// actions. Viser stores tokens and page IDs in config/env only, then exposes
// short local aliases such as notion:ops-notes to actions and scheduler state.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import type { NotionConnectorConfig } from "../core/types.ts";

const NOTION_API_BASE = "https://api.notion.com";
const NOTION_API_VERSION = "2026-03-11";
const NOTION_PARAGRAPH_CHUNK_SIZE = 1_900;

export interface NotionPageTarget {
  pageId: string;
}

export interface NotionFetchOptions {
  fetchImpl?: FetchLike;
}

export async function appendNotionPageMessage(
  config: NotionConnectorConfig,
  pageId: string,
  text: string,
  options: NotionFetchOptions = {}
): Promise<void> {
  const token = normalizeNotionToken(config.token);
  const target = resolveNotionPageTarget(config, pageId);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${NOTION_API_BASE}/v1/blocks/${encodeURIComponent(target.pageId)}/children`;

  for (const chunk of chunkText(normalizeNotionMessage(text), NOTION_PARAGRAPH_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "PATCH",
      headers: notionHeaders(token),
      body: JSON.stringify({
        children: [
          {
            object: "block",
            type: "paragraph",
            paragraph: {
              rich_text: [
                {
                  type: "text",
                  text: { content: chunk }
                }
              ]
            }
          }
        ]
      })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactNotionDetail(`Notion page append failed: ${response.status} ${response.statusText} ${bodyText}`, config, pageId, target, chunk));
    }
  }
}

export function resolveNotionPageTarget(config: NotionConnectorConfig, pageId: string): NotionPageTarget {
  const alias = normalizeNotionTargetAlias(pageId);
  const target = config.pages[alias] ?? (alias === "default" ? config.page : undefined);
  if (!target) {
    throw new Error(`Notion page alias '${alias}' is not configured. Set ${config.pageEnv} or ${config.pagesEnv}.`);
  }
  return parseNotionPageTarget(target);
}

export function hasNotionPageTarget(config: NotionConnectorConfig): boolean {
  return Boolean(config.page || Object.keys(config.pages).length > 0);
}

export function hasNotionCredentials(config: NotionConnectorConfig): boolean {
  return Boolean(config.token && hasNotionPageTarget(config));
}

export function normalizeNotionToken(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("Notion token is required.");
  if (trimmed.length < 10 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error("Notion token must be a single opaque token.");
  }
  return trimmed;
}

export function normalizeNotionTargetAlias(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
    throw new Error("Notion page alias must be a short alias such as default, ops, or meeting-notes.");
  }
  return trimmed.toLowerCase();
}

export function parseNotionPageTarget(value: string): NotionPageTarget {
  const raw = value.trim();
  if (!raw) throw new Error("Notion page target is required.");
  return { pageId: normalizeNotionPageId(extractNotionPageId(raw)) };
}

export function parseNotionPageMap(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const output: Record<string, string> = {};
      for (const [key, target] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof target !== "string" || !target.trim()) continue;
        const alias = normalizeNotionTargetAlias(key);
        output[alias] = formatNotionPageTarget(parseNotionPageTarget(target));
      }
      return output;
    }
  } catch {
    // Fall through to a shell-friendly alias=page-id list.
  }

  const output: Record<string, string> = {};
  for (const part of raw.split(/[,\n;]/u)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const alias = normalizeNotionTargetAlias(part.slice(0, separator));
    const target = part.slice(separator + 1).trim();
    if (alias && target) output[alias] = formatNotionPageTarget(parseNotionPageTarget(target));
  }
  return output;
}

export function formatNotionPageTarget(target: NotionPageTarget): string {
  return target.pageId;
}

export function notionHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "notion-version": NOTION_API_VERSION
  };
}

export function redactNotionDetail(
  detail: string,
  config: NotionConnectorConfig,
  alias?: string,
  target?: NotionPageTarget,
  text?: string
): string {
  let output = detail;
  const compactPageId = target?.pageId.replace(/-/gu, "");
  for (const secret of [config.token, config.page, ...Object.values(config.pages), alias, target?.pageId, compactPageId, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function extractNotionPageId(value: string): string {
  let decoded = value;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isNotionHost = hostname === "notion.so"
      || hostname.endsWith(".notion.so")
      || hostname === "notion.site"
      || hostname.endsWith(".notion.site");
    if (url.protocol !== "https:" || !isNotionHost) {
      throw new Error("Notion page URL must use https://*.notion.so or https://*.notion.site.");
    }
    if (url.username || url.password) throw new Error("Notion page URL credentials are not allowed.");
    decoded = decodeURIComponent(url.pathname);
  } catch (error) {
    if (error instanceof TypeError) {
      decoded = value;
    } else {
      throw error;
    }
  }

  const match = /([0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12})/u.exec(decoded);
  if (!match) throw new Error("Notion page target must be a page ID or Notion page URL.");
  return match[1];
}

function normalizeNotionPageId(value: string): string {
  const compact = value.replace(/-/gu, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(compact)) throw new Error("Notion page ID must be a UUID.");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function normalizeNotionMessage(text: string): string {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) throw new Error("Notion message body is required.");
  return normalized;
}
