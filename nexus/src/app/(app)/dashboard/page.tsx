'use client';

/**
 * /dashboard — bento-preset landing page.
 *
 * One of four curated layouts (Overview / NOC / Capacity / Incidents)
 * drives the visible widgets; the preset is persisted in a cookie
 * (see `usePreferredPreset`). Widgets are self-fetching — the page
 * owns no data of its own, only selection of which preset to render.
 *
 * `registerAllWidgets()` is called at module load; the registry is
 * idempotent so repeat evaluations (HMR, multi-mount) are safe.
 */

import { useState } from 'react';
import { Pencil, RefreshCw, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { BulkProgressPanel } from '@/components/dashboard/bulk-progress-panel';
import { BentoGridDnd } from '@/components/dashboard/bento-grid-dnd';
import { PresetSwitcher } from '@/components/dashboard/preset-switcher';
import { PRESETS, DEFAULT_PRESET_ID, getPreset } from '@/lib/widgets/presets';
import { registerAllWidgets } from '@/lib/widgets/register-all';
import { usePreferredPreset } from '@/hooks/use-preferred-preset';
import { useSaveLayout, useUserPrefs } from '@/hooks/use-user-prefs';
import type { BentoCell } from '@/lib/widgets/registry';
import { cn } from '@/lib/utils';

registerAllWidgets();

export default function DashboardPage() {
  const [presetId] = usePreferredPreset();
  const preset = getPreset(presetId) ?? PRESETS[DEFAULT_PRESET_ID];
  const qc = useQueryClient();
  const { data: prefs } = useUserPrefs();
  const saveLayout = useSaveLayout();

  // The custom layout (if any) overrides the built-in. Persistence is
  // through TanStack Query: the mutation invalidates the prefs query,
  // which refetches and the new `custom` flows back through props.
  // BentoGridDnd holds its own short-lived drag state; we don't need
  // a local copy up here.
  const custom = prefs?.bentoLayouts?.[preset.id];
  const cells = custom ?? preset.cells;
  const [editing, setEditing] = useState(false);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: ['cluster'] });
    void qc.invalidateQueries({ queryKey: ['node'] });
    void qc.invalidateQueries({ queryKey: ['storage'] });
  };

  function writeOptimistic(layout: BentoCell[] | null): void {
    // Snap the UI immediately by patching the cached prefs before the
    // network round-trip. The mutation's onSuccess invalidates the
    // query, so the real server state reconciles shortly after.
    qc.setQueryData<typeof prefs>(['user-prefs'], (curr) => ({
      version: 1,
      bentoLayouts: {
        ...(curr?.bentoLayouts ?? {}),
        [preset.id]: layout ?? undefined,
      },
    }));
  }

  function onLayoutChange(next: BentoCell[]): void {
    writeOptimistic(next);
    saveLayout.mutate({ presetId: preset.id, layout: next });
  }

  function resetLayout(): void {
    writeOptimistic(null);
    saveLayout.mutate({ presetId: preset.id, layout: null });
  }

  const hasCustomLayout = custom !== undefined;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-fg)]">{preset.label}</h1>
          <p className="text-sm text-[var(--color-fg-subtle)]">{preset.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PresetSwitcher />
          <button
            onClick={() => setEditing((v) => !v)}
            title={editing ? 'Lock layout' : 'Edit layout: drag widgets to reorder'}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition',
              editing
                ? 'border-[var(--color-accent-border,rgba(255,255,255,0.5))] bg-white/[0.08] text-[var(--color-fg)]'
                : 'border-[var(--color-border-subtle)] bg-[var(--color-surface)] text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)]',
            )}
            aria-pressed={editing}
          >
            <Pencil className="h-3.5 w-3.5" />
            {editing ? 'Done' : 'Edit'}
          </button>
          {hasCustomLayout && (
            <button
              onClick={resetLayout}
              title="Reset this preset to its built-in layout"
              className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-overlay)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </button>
          )}
          <button
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-overlay)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      <BulkProgressPanel />

      <BentoGridDnd cells={cells} onChange={onLayoutChange} editable={editing} />
    </div>
  );
}
