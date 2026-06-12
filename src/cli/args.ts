// ================================================================
// Minimal CLI argument parsing
// ================================================================
// No dependency is used here. The parser supports global flags, command names,
// and repeated values well enough for a personal assistant CLI.

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let command = "gateway";
  let sawCommand = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith("--")) {
      const [rawKey, inlineValue] = token.slice(2).split("=", 2);
      const key = camelCase(rawKey);
      const next = argv[index + 1];

      if (inlineValue !== undefined) flags[key] = inlineValue;
      else if (next && !next.startsWith("-")) {
        flags[key] = next;
        index += 1;
      } else flags[key] = true;
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const key = shortFlag(token.slice(1));
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        flags[key] = next;
        index += 1;
      } else flags[key] = true;
      continue;
    }

    if (!sawCommand) {
      command = token;
      sawCommand = true;
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}

export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

function camelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function shortFlag(value: string): string {
  const map: Record<string, string> = {
    c: "config",
    p: "provider",
    s: "session",
    f: "force",
    h: "help"
  };
  return map[value] ?? value;
}
