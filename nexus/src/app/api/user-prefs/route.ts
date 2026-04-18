/**
 * GET  /api/user-prefs          — current user's prefs document
 * PATCH /api/user-prefs         — merge a partial prefs patch
 *
 * The only writeable surface today is `bentoLayouts` for 7.4 (drag-and-
 * drop dashboards). Each preset id maps to an array of BentoCell —
 * validated server-side via the same `validatePreset` helper that
 * gates the built-in presets, so a tampered PATCH can't persist an
 * overlapping / off-grid layout that would crash the renderer.
 */
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/route-middleware';
import { getPrefs, updatePrefs } from '@/lib/user-prefs/store';
import type { CustomLayout, UserPrefs } from '@/lib/user-prefs/types';
import type { BentoCell, BentoPreset } from '@/lib/widgets/registry';
import { validatePreset } from '@/lib/widgets/registry';
import { PRESETS } from '@/lib/widgets/presets';

const KNOWN_PRESETS: ReadonlySet<BentoPreset['id']> = new Set(
  Object.keys(PRESETS) as BentoPreset['id'][],
);

/** Narrow a raw JSON cell into BentoCell, returning null on shape errors. */
function coerceCell(raw: unknown): BentoCell | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const widgetId = typeof c.widgetId === 'string' ? c.widgetId : null;
  const col = Number.isFinite(c.col) ? Number(c.col) : null;
  const cols = Number.isFinite(c.cols) ? Number(c.cols) : null;
  const row = Number.isFinite(c.row) ? Number(c.row) : null;
  const rows = Number.isFinite(c.rows) ? Number(c.rows) : null;
  if (!widgetId || col === null || cols === null || row === null || rows === null) {
    return null;
  }
  if (col < 1 || cols < 1 || row < 1 || rows < 1 || rows > 10 || cols > 4) {
    return null;
  }
  return { widgetId, col, cols, row, rows };
}

function coerceLayout(raw: unknown): CustomLayout | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 32) return null;
  const cells: BentoCell[] = [];
  for (const item of raw) {
    const cell = coerceCell(item);
    if (!cell) return null;
    cells.push(cell);
  }
  return cells;
}

export const GET = withAuth(async (_req, { session }) => {
  const prefs = await getPrefs(session.username as string);
  return NextResponse.json(prefs, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});

export const PATCH = withCsrf(async (req, { session }) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const patch = body as { bentoLayouts?: Record<string, unknown> };
  const nextLayouts: UserPrefs['bentoLayouts'] = {};

  if (patch.bentoLayouts !== undefined) {
    if (typeof patch.bentoLayouts !== 'object' || patch.bentoLayouts === null) {
      return NextResponse.json(
        { error: 'bentoLayouts must be an object' },
        { status: 400 },
      );
    }
    for (const [presetId, layoutRaw] of Object.entries(patch.bentoLayouts)) {
      if (!KNOWN_PRESETS.has(presetId as BentoPreset['id'])) {
        return NextResponse.json(
          { error: `unknown preset id "${presetId}"` },
          { status: 400 },
        );
      }
      if (layoutRaw === null) {
        // Null means "reset to built-in" — we encode that by omitting
        // the key from the persisted document.
        continue;
      }
      const cells = coerceLayout(layoutRaw);
      if (!cells) {
        return NextResponse.json(
          { error: `invalid layout for preset "${presetId}"` },
          { status: 400 },
        );
      }
      const validation = validatePreset({
        id: presetId as BentoPreset['id'],
        label: presetId,
        description: presetId,
        cells,
      });
      if (!validation.ok) {
        return NextResponse.json(
          { error: `invalid layout: ${validation.issues.join('; ')}` },
          { status: 400 },
        );
      }
      nextLayouts[presetId as BentoPreset['id']] = cells;
    }
  }

  const merged = await updatePrefs(session.username as string, {
    bentoLayouts: nextLayouts,
  });
  return NextResponse.json(merged, {
    headers: { 'Cache-Control': 'no-store, private' },
  });
});
