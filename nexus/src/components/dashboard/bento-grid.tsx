'use client';

/**
 * Renders a BentoPreset as a CSS grid.
 *
 * Grid is fixed at 4 columns on lg+; collapses to 2 at md and 1 on
 * mobile so a 2x1 bento widget stacks gracefully instead of overflowing
 * horizontally. Widget row spans are honoured on lg+; below that we
 * let each widget auto-size.
 *
 * Rendering contract:
 *   - Each cell renders its widget's Component with no props.
 *   - Unknown widget ids render a visible warning card (not nothing) so
 *     broken presets surface during dev rather than silently dropping.
 */

import type { BentoPreset } from '@/lib/widgets/registry';
import { getWidget } from '@/lib/widgets/registry';
import { AlertTriangle } from 'lucide-react';

interface BentoGridProps {
  preset: BentoPreset;
}

export function BentoGrid({ preset }: BentoGridProps) {
  return (
    <div
      className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(12rem,auto)]"
    >
      {preset.cells.map((cell, i) => {
        const widget = getWidget(cell.widgetId);
        return (
          <div
            key={`${cell.widgetId}-${i}`}
            // Tailwind JIT won't see template-literal classes, so we emit
            // the `col-span-*` / `row-span-*` utilities from the safelist.
            // Mobile collapses the spans; lg+ honours the preset.
            style={{
              gridColumn: `span ${cell.cols} / span ${cell.cols}`,
              gridRow: `span ${cell.rows} / span ${cell.rows}`,
            }}
            className="min-w-0"
          >
            {widget ? (
              <widget.Component />
            ) : (
              <div className="flex h-full items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                Widget <span className="font-mono">{cell.widgetId}</span> not registered.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
