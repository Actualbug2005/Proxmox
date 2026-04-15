# Task Completion Checklist

Run before claiming a task is done / ready to commit.

## Required per CLAUDE.md

1. **Impact analysis**: for any symbol you modified, you must have run `gitnexus_impact({target: "<symbol>", direction: "upstream"})` and addressed HIGH/CRITICAL warnings.
2. **Scope verification**: run `gitnexus_detect_changes({scope: "staged"})` (or `"all"` during WIP) and confirm only expected files/symbols changed.
3. **d=1 dependents updated**: every direct caller/importer flagged as "WILL BREAK" has been patched.

## Correctness gates

1. `npx tsc --noEmit` in `nexus/` — **must exit 0**. No test runner is configured, so this is the primary gate.
2. `npm run lint` — resolve ESLint errors. Warnings are tolerated if pre-existing.
3. Manual UI smoke test when touching pages/components — run `npm run dev`, click the golden path, check console for runtime errors. Type-checks confirm code correctness, not feature correctness.

## Commit policy

- Only commit when the user explicitly asks.
- Always create **new** commits; never `--amend` (hook failures mean the commit didn't happen — amending would clobber the previous one).
- Never pass `--no-verify` / `--no-gpg-sign` unless the user requests it. If a hook fails, fix the underlying issue.
- Commit message style: conventional prefix (`feat(<scope>)`, `fix(<scope>)`, etc.), lowercase scope, terse body. Co-authored-by trailer is added automatically.

## After commit

The PostToolUse hook runs `npx gitnexus analyze` to keep the index fresh. If you see a stale-index warning from any GitNexus tool, run it manually (with `--embeddings` if embeddings exist — check `.gitnexus/meta.json`).
