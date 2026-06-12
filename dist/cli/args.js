// ================================================================
// Minimal CLI argument parsing
// ================================================================
// No dependency is used here. The parser supports global flags, command names,
// and repeated values well enough for a personal assistant CLI.
export function parseArgs(argv) {
    const flags = {};
    const positionals = [];
    let command = "gateway";
    let sawCommand = false;
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token.startsWith("--")) {
            const [rawKey, inlineValue] = token.slice(2).split("=", 2);
            const key = camelCase(rawKey);
            const next = argv[index + 1];
            if (inlineValue !== undefined)
                flags[key] = inlineValue;
            else if (next && !next.startsWith("-")) {
                flags[key] = next;
                index += 1;
            }
            else
                flags[key] = true;
            continue;
        }
        if (token.startsWith("-") && token.length > 1) {
            const key = shortFlag(token.slice(1));
            const next = argv[index + 1];
            if (next && !next.startsWith("-")) {
                flags[key] = next;
                index += 1;
            }
            else
                flags[key] = true;
            continue;
        }
        if (!sawCommand) {
            command = token;
            sawCommand = true;
        }
        else {
            positionals.push(token);
        }
    }
    return { command, positionals, flags };
}
export function flagString(flags, key) {
    const value = flags[key];
    return typeof value === "string" ? value : undefined;
}
export function flagBool(flags, key) {
    return flags[key] === true || flags[key] === "true";
}
function camelCase(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
function shortFlag(value) {
    const map = {
        c: "config",
        p: "provider",
        s: "session",
        f: "force",
        h: "help"
    };
    return map[value] ?? value;
}
