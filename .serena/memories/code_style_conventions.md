# Code Style & Conventions

## Language / Types

- **Strict TypeScript** everywhere. All Proxmox API shapes are modelled in `src/types/proxmox.ts`.
- PVE's boolean-as-integer convention is respected at the type boundary: fields are literally typed as `0 | 1` (e.g. `mkdir`, `enable`, `shared`, `vmstate`). React state uses booleans; coercion happens once at the payload-build site.
- Payload interfaces named `*CreatePayload` / `*UpdatePayload`. `Update` variants are typically `Partial<Omit<Create, 'id' | 'type'>>` — PVE rejects ID/type mutations.
- Use `import type { ... }` for type-only imports.

## React / Next

- App Router. `'use client'` at the top of files that use hooks or browser APIs.
- Read `node_modules/next/dist/docs/` before using Next APIs — training data is stale.
- Pages live in `src/app/<route>/page.tsx`. Feature components in `src/components/<feature>/`.
- Data fetching: TanStack Query v5 via `useQuery` / `useMutation`. Poll intervals centralised in `src/hooks/use-cluster.ts → POLL_INTERVALS`.
- After mutations, call `qc.invalidateQueries({ queryKey: ['<root>'] })` — keep queryKeys hierarchical.

## Styling

- Tailwind v4. Utility-first, no per-component CSS modules.
- Dark palette: `bg-gray-900`, `border-gray-800`, body text `text-white` / `text-gray-400`, subtle labels `text-gray-500/600`, accent `orange-500`.
- Class composition via the `cn(...)` helper from `@/lib/utils`.
- Shared form input class: `w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50 font-mono`.
- Icons from `lucide-react`, generally 3.5-4 w/h.

## Conventions observed

- Mutating API wrappers add `X-Nexus-CSRF` via `readCsrfCookie()` in `proxmox-client.ts`. Never hand-roll mutating fetch.
- Form-encoded endpoints use `proxmox.postForm`; JSON endpoints use `proxmox.post`.
- Dialogs share a pattern: overlay `fixed inset-0 z-40 bg-black/60 backdrop-blur-sm`, inner card stops propagation on click, explicit `onClose`/`on<Action>` props.
- `ConfirmDialog` (`src/components/dashboard/confirm-dialog.tsx`) is the shared destructive-action prompt; use `danger` for delete flows.
- Toast notifications via `useToast()` (`src/components/ui/toast`): `.success(title, detail)` / `.error(title, detail)`.

## Comments policy (repo-wide)

From the user's global instruction + observed code:
- No narrative/what-it-does comments. Well-named identifiers carry that.
- Keep comments for **why**: PVE quirks (e.g. `export` reserved-word spelling, `mkdir: 0|1`), deliberate trade-offs, hidden invariants.
- Block-style header doc-comments ARE used on exported components and shared clients to explain PVE-specific gotchas. Keep them.

## TypeScript "unused import" lag

The IDE sometimes reports newly-added imports as unused while a file is being edited. These disappear after subsequent edits reference them. `npx tsc --noEmit` is the ground truth — ignore IDE-only "never used" warnings if `tsc` exits 0.
