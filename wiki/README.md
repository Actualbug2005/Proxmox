# Nexus Wiki Source

This directory is the **source of truth** for the Nexus GitHub Wiki.

- Edits land via PR on `main`.
- The [`publish-wiki.yml`](../.github/workflows/publish-wiki.yml) workflow syncs everything in `wiki/` (except this `README.md` and any `.git/` folder) to <https://github.com/Actualbug2005/Proxmox.wiki.git>.
- The live wiki is at <https://github.com/Actualbug2005/Proxmox/wiki>.

## Pre-flight (one time, by a maintainer)

GitHub refuses to clone `.wiki.git` until the Wiki tab has at least one page, so before the workflow can run for the first time:

1. Open repo **Settings** → **General** → **Features** and make sure **Wikis** is enabled.
2. Visit the Wiki tab and click **Create the first page**. Any placeholder content is fine — the workflow will overwrite it on the first successful sync.

## Authentication

The workflow tries `GITHUB_TOKEN` first. If GitHub rejects that (some repos require a PAT for `.wiki.git` pushes), create a fine-grained PAT with **Wiki: Read and write** scope, add it as the repo secret `WIKI_TOKEN`, and re-run the workflow.

## Conventions

- File names become page titles, with `-` rendered as a space: `Feature-Tour.md` → "Feature Tour".
- `Home.md`, `_Sidebar.md`, `_Footer.md` are reserved GitHub Wiki names.
- Images live in `wiki/images/` and are referenced by relative path: `![alt](images/foo.png)`.
