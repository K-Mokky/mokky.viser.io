# Safe Automation
Description: Plan real-world computer actions with explicit permission boundaries and rollback notes.

## When to use
Use this before running shell, file, browser, account, or messenger actions that could change user state.

## Procedure
1. Separate read-only inspection from write/destructive actions.
2. Prefer read-only tools first.
3. Ask for approval before irreversible or externally visible changes.
4. Report the exact command or action, expected effect, and rollback path.
