// ================================================================
// Node runtime version gate
// ================================================================
// Viser is executed directly from `.ts` files, so it depends on Node's native
// TypeScript stripping support. Feature checks alone are not enough: an older
// Node runtime may have fetch/WebSocket but still fail to run `src/index.ts`.

export const MIN_NODE_VERSION = "22.6.0";

export interface ParsedNodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(version: string): ParsedNodeVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  };
}

export function isNodeVersionSupported(version = process.version): boolean {
  const parsed = parseNodeVersion(version);
  const minimum = parseNodeVersion(MIN_NODE_VERSION);
  if (!parsed || !minimum) return false;
  if (parsed.major !== minimum.major) return parsed.major > minimum.major;
  if (parsed.minor !== minimum.minor) return parsed.minor > minimum.minor;
  return parsed.patch >= minimum.patch;
}

export function nodeVersionLabel(version = process.version): string {
  return isNodeVersionSupported(version)
    ? `${version} (ok; requires >= ${MIN_NODE_VERSION})`
    : `${version} (unsupported; requires >= ${MIN_NODE_VERSION})`;
}
