// ================================================================
// GitHub issue/PR comment sender
// ================================================================
// GitHub treats pull requests as issues for top-level conversation comments.
// Viser keeps token and owner/repo/#number targets in config/env, then exposes
// only short local aliases through pairing/allowlist + approval-gated sends.

import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, type FetchLike } from "../utils/fetch.ts";
import { chunkText } from "../utils/text.ts";
import type { GitHubConnectorConfig } from "../core/types.ts";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_COMMENT_CHUNK_SIZE = 60_000;

export interface GitHubIssueTarget {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GitHubFetchOptions {
  fetchImpl?: FetchLike;
}

export async function sendGitHubIssueComment(
  config: GitHubConnectorConfig,
  targetId: string,
  text: string,
  options: GitHubFetchOptions = {}
): Promise<void> {
  const token = normalizeGitHubToken(config.token);
  const target = resolveGitHubIssueTarget(config, targetId);
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${target.issueNumber}/comments`;

  for (const chunk of chunkText(text, GITHUB_COMMENT_CHUNK_SIZE)) {
    const response = await fetchWithTimeout(fetchImpl, url, {
      method: "POST",
      headers: githubHeaders(token),
      body: JSON.stringify({ body: chunk })
    }, config.sendTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(redactGitHubDetail(`GitHub issue comment failed: ${response.status} ${response.statusText} ${bodyText}`, config, targetId, target, chunk));
    }
  }
}

export function resolveGitHubIssueTarget(config: GitHubConnectorConfig, targetId: string): GitHubIssueTarget {
  const alias = normalizeGitHubTargetAlias(targetId);
  const target = config.targets[alias] ?? (alias === "default" ? config.target : undefined);
  if (!target) {
    throw new Error(`GitHub issue target alias '${alias}' is not configured. Set ${config.targetEnv} or ${config.targetsEnv}.`);
  }
  return parseGitHubIssueTarget(target);
}

export function hasGitHubTarget(config: GitHubConnectorConfig): boolean {
  return Boolean(config.target || Object.keys(config.targets).length > 0);
}

export function hasGitHubCredentials(config: GitHubConnectorConfig): boolean {
  return Boolean(config.token && hasGitHubTarget(config));
}

export function normalizeGitHubToken(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error("GitHub token is required.");
  if (trimmed.length < 10 || trimmed.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error("GitHub token must be a single opaque token.");
  }
  return trimmed;
}

export function normalizeGitHubTargetAlias(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 80 || !/^[A-Za-z0-9._-]+$/u.test(trimmed)) {
    throw new Error("GitHub target alias must be a short alias such as default, ops, or release-pr.");
  }
  return trimmed.toLowerCase();
}

export function parseGitHubIssueTarget(value: string): GitHubIssueTarget {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("GitHub issue target is required.");

  const fromUrl = parseGitHubIssueUrl(trimmed);
  if (fromUrl) return fromUrl;

  const match = /^([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})#([1-9][0-9]{0,9})$/u.exec(trimmed);
  if (!match) {
    throw new Error("GitHub issue target must be owner/repo#123 or a https://github.com/owner/repo/issues/123 or /pull/123 URL.");
  }
  return normalizeGitHubIssueTarget(match[1], match[2], match[3]);
}

export function parseGitHubIssueTargetMap(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const output: Record<string, string> = {};
      for (const [key, target] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof target !== "string" || !target.trim()) continue;
        const alias = normalizeGitHubTargetAlias(key);
        output[alias] = formatGitHubIssueTarget(parseGitHubIssueTarget(target));
      }
      return output;
    }
  } catch {
    // Fall through to a shell-friendly alias=owner/repo#123 list.
  }

  const output: Record<string, string> = {};
  for (const part of raw.split(/[,\n;]/u)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const alias = normalizeGitHubTargetAlias(part.slice(0, separator));
    const target = part.slice(separator + 1).trim();
    if (alias && target) output[alias] = formatGitHubIssueTarget(parseGitHubIssueTarget(target));
  }
  return output;
}

export function formatGitHubIssueTarget(target: GitHubIssueTarget): string {
  return `${target.owner}/${target.repo}#${target.issueNumber}`;
}

export function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "user-agent": "Viser",
    "x-github-api-version": GITHUB_API_VERSION
  };
}

export function redactGitHubDetail(
  detail: string,
  config: GitHubConnectorConfig,
  alias?: string,
  target?: GitHubIssueTarget,
  text?: string
): string {
  let output = detail;
  const targetText = target ? formatGitHubIssueTarget(target) : undefined;
  for (const secret of [config.token, config.target, ...Object.values(config.targets), alias, targetText, text]) {
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  if (target) {
    output = output
      .split(`${target.owner}/${target.repo}/issues/${target.issueNumber}`).join("[REDACTED]")
      .split(`${target.owner}/${target.repo}/pull/${target.issueNumber}`).join("[REDACTED]")
      .split(`${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/issues/${target.issueNumber}`).join("[REDACTED]");
  }
  return output;
}

function parseGitHubIssueUrl(value: string): GitHubIssueTarget | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") {
    throw new Error("GitHub issue URL must use https://github.com.");
  }
  if (url.username || url.password) {
    throw new Error("GitHub issue URL credentials are not allowed.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || (parts[2] !== "issues" && parts[2] !== "pull")) {
    throw new Error("GitHub issue URL must look like https://github.com/owner/repo/issues/123 or /pull/123.");
  }
  return normalizeGitHubIssueTarget(parts[0], parts[1], parts[3]);
}

function normalizeGitHubIssueTarget(owner: string, repo: string, issueNumber: string): GitHubIssueTarget {
  const safeOwner = normalizeGitHubPathPart(owner, "owner");
  const safeRepo = normalizeGitHubPathPart(repo, "repo");
  const parsedIssueNumber = Number.parseInt(issueNumber, 10);
  if (!Number.isSafeInteger(parsedIssueNumber) || parsedIssueNumber <= 0 || parsedIssueNumber > 2_147_483_647) {
    throw new Error("GitHub issue number must be a positive integer.");
  }
  return { owner: safeOwner, repo: safeRepo, issueNumber: parsedIssueNumber };
}

function normalizeGitHubPathPart(value: string, label: string): string {
  const trimmed = decodeURIComponent(value).trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(trimmed) || trimmed === "." || trimmed === ".." || trimmed.includes("..")) {
    throw new Error(`GitHub ${label} must be a safe repository path segment.`);
  }
  return trimmed;
}
