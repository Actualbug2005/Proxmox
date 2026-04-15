# Suggested Commands

All commands assume CWD = `/Users/devlin/Documents/GitHub/Proxmox/nexus` unless noted.

## Dev loop

| Task | Command |
|------|---------|
| Dev server | `npm run dev` (Next.js dev server) |
| Production build | `npm run build` (uses `next build --webpack`) |
| Run built app | `npm run start` (`node --experimental-strip-types server.ts`) |
| Lint | `npm run lint` (ESLint 9 + `eslint-config-next`) |
| **Type-check (no test suite yet)** | `npx tsc --noEmit` — primary correctness gate |

There is **no test runner** configured yet (no Jest / Vitest / Playwright deps). Verification relies on `tsc --noEmit` + `lint` + manual UI smoke tests.

## GitNexus (per CLAUDE.md)

| Task | Command |
|------|---------|
| Reindex after commit (preserve embeddings) | `npx gitnexus analyze --embeddings` |
| Reindex (no embeddings) | `npx gitnexus analyze` |
| Check index metadata | inspect `.gitnexus/meta.json` → `stats.embeddings` |

## Darwin (macOS) system commands

Default shell is `zsh`. Standard tools: `ls`, `cd`, `grep`, `find`, `git`, `rg` (ripgrep).

- Use `rg` via the Grep tool (not Bash) — see the tool docs.
- Use `Glob` for file-pattern search (not `find`).
- Use `Read` (not `cat`/`head`/`tail`) and `Edit` (not `sed`/`awk`).

## Git

Clean branch tooling; the user runs the PostToolUse hook to re-analyse GitNexus after every commit/merge. Never pass `--no-verify` or skip hooks. Project policy: always create NEW commits (never `--amend` after hook failure).
