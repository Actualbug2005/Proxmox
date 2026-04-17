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

import { RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { BulkProgressPanel } from '@/components/dashboard/bulk-progress-panel';
import { BentoGrid } from '@/components/dashboard/bento-grid';
import { PresetSwitcher } from '@/components/dashboard/preset-switcher';
import { PRESETS, DEFAULT_PRESET_ID, getPreset } from '@/lib/widgets/presets';
import { registerAllWidgets } from '@/lib/widgets/register-all';
import { usePreferredPreset } from '@/hooks/use-preferred-preset';

registerAllWidgets();

export default function DashboardPage() {
  const [presetId] = usePreferredPreset();
  const preset = getPreset(presetId) ?? PRESETS[DEFAULT_PRESET_ID];
  const qc = useQueryClient();

  const refreshAll = () => {
    // Invalidate every query the bento widgets might depend on. Cheaper
    // than a targeted set — the two "cluster/*" prefixes cover
    // resources, tasks, status, and the health composite.
    void qc.invalidateQueries({ queryKey: ['cluster'] });
    void qc.invalidateQueries({ queryKey: ['node'] });
    void qc.invalidateQueries({ queryKey: ['storage'] });
  };

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
            onClick={refreshAll}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-fg-secondary)] transition hover:bg-[var(--color-overlay)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      <BulkProgressPanel />

      <BentoGrid preset={preset} />
    </div>
  );
}
