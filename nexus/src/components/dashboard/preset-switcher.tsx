'use client';

/**
 * PresetSwitcher — segmented pill selecting the active bento preset.
 *
 * Writes through to the cookie-backed hook so a refresh lands on the
 * same view. Four buttons, always visible, no dropdown — the preset
 * set is small and stable enough that a pill reads better than a menu.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Flame,
  Gauge,
  LayoutDashboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRESETS } from '@/lib/widgets/presets';
import type { BentoPreset } from '@/lib/widgets/registry';
import { usePreferredPreset } from '@/hooks/use-preferred-preset';

const ICONS: Record<BentoPreset['id'], LucideIcon> = {
  overview: LayoutDashboard,
  noc: Activity,
  capacity: Gauge,
  incidents: Flame,
};

export function PresetSwitcher() {
  const [active, setActive] = usePreferredPreset();

  return (
    <div
      role="tablist"
      aria-label="Dashboard preset"
      className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1"
    >
      {(Object.values(PRESETS) as BentoPreset[]).map((preset) => {
        const Icon = ICONS[preset.id];
        const isActive = active === preset.id;
        return (
          <button
            key={preset.id}
            role="tab"
            aria-selected={isActive}
            title={preset.description}
            onClick={() => setActive(preset.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
              isActive
                ? 'bg-zinc-100 text-zinc-900 shadow-sm'
                : 'text-[var(--color-fg-muted)] hover:bg-white/[0.04] hover:text-[var(--color-fg)]',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
