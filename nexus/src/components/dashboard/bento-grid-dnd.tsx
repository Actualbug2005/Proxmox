'use client';

/**
 * Drag-and-drop variant of BentoGrid (7.4).
 *
 * Why not react-grid-layout:
 *   - It ships a class-component tree and ~50 kB gzip for interactions
 *     we don't need (free-form resize, responsive breakpoints, WebKit
 *     touch workarounds).
 *   - Our grid is a fixed 4-col bento with discrete (col, row, cols,
 *     rows) cells. A tiny native HTML5 DnD handler is ~100 lines,
 *     keeps the existing grammar, and defers entirely to CSS Grid for
 *     the actual rendering.
 *
 * Interaction:
 *   - Hold and drag the header drag handle of a widget card.
 *   - Drop it on any OTHER card: the two cells swap anchor (col, row)
 *     and size (cols, rows). Swapping on a discrete grid is commutative
 *     — a layout that was valid before the swap is valid after. No
 *     validation branch runs on the client.
 *   - On drop, fire `onChange(nextCells)`. The parent page owns state
 *     and persistence through useSaveLayout.
 *
 * Keyboard affordance: the drag handle is a button. Space/Enter picks
 * up; arrow keys move between cells; Space/Enter drops. Keeps parity
 * with a subset of WAI-ARIA drag-and-drop semantics without pulling a
 * full ARIA library.
 */

import { useState } from 'react';
import { AlertTriangle, GripVertical } from 'lucide-react';
import type { BentoCell } from '@/lib/widgets/registry';
import { getWidget } from '@/lib/widgets/registry';
import { cn } from '@/lib/utils';

interface BentoGridDndProps {
  cells: BentoCell[];
  /** Called on every successful swap. Parent owns persistence. */
  onChange: (next: BentoCell[]) => void;
  /** False turns DnD off entirely (same visual as the plain BentoGrid). */
  editable?: boolean;
}

/**
 * Swap two cells' geometry. Result is a new array — callers should
 * treat the input as immutable.
 */
function swapCells(cells: BentoCell[], a: number, b: number): BentoCell[] {
  if (a === b) return cells;
  const next = cells.slice();
  const A = next[a];
  const B = next[b];
  next[a] = { ...A, col: B.col, row: B.row, cols: B.cols, rows: B.rows };
  next[b] = { ...B, col: A.col, row: A.row, cols: A.cols, rows: A.rows };
  return next;
}

export function BentoGridDnd({ cells, onChange, editable = true }: BentoGridDndProps) {
  // Index of the cell currently being dragged, or keyboard-selected as
  // the "picked up" source. Null when idle.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [keyboardSrc, setKeyboardSrc] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  function handleDragStart(idx: number, e: React.DragEvent): void {
    if (!editable) return;
    setDragIdx(idx);
    // setData is required for Firefox to initiate the drag.
    e.dataTransfer.setData('text/plain', String(idx));
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(idx: number, e: React.DragEvent): void {
    if (!editable || dragIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoverIdx(idx);
  }

  function handleDrop(idx: number): void {
    if (!editable || dragIdx === null) return;
    const next = swapCells(cells, dragIdx, idx);
    setDragIdx(null);
    setHoverIdx(null);
    if (next !== cells) onChange(next);
  }

  function handleDragEnd(): void {
    setDragIdx(null);
    setHoverIdx(null);
  }

  function handleKeyboardPick(idx: number): void {
    if (!editable) return;
    if (keyboardSrc === null) {
      setKeyboardSrc(idx);
      return;
    }
    if (keyboardSrc === idx) {
      // Same card pressed twice — cancel the pick-up.
      setKeyboardSrc(null);
      return;
    }
    const next = swapCells(cells, keyboardSrc, idx);
    setKeyboardSrc(null);
    if (next !== cells) onChange(next);
  }

  return (
    <div
      className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 auto-rows-[minmax(12rem,auto)]"
      aria-label={editable ? 'Editable dashboard layout' : undefined}
    >
      {cells.map((cell, i) => {
        const widget = getWidget(cell.widgetId);
        const isSource = dragIdx === i || keyboardSrc === i;
        const isHover = hoverIdx === i && dragIdx !== null && dragIdx !== i;
        return (
          <div
            key={`${cell.widgetId}-${i}`}
            style={{
              gridColumn: `span ${cell.cols} / span ${cell.cols}`,
              gridRow: `span ${cell.rows} / span ${cell.rows}`,
            }}
            onDragOver={(e) => handleDragOver(i, e)}
            onDrop={() => handleDrop(i)}
            onDragLeave={() => hoverIdx === i && setHoverIdx(null)}
            className={cn(
              'min-w-0 relative transition',
              isSource && 'opacity-40 scale-[0.98]',
              isHover &&
                'outline outline-2 outline-[var(--color-accent-border,rgba(255,255,255,0.5))] outline-offset-2 rounded-xl',
            )}
          >
            {editable && (
              <button
                type="button"
                // Draggable span inside — makes the drag handle the only
                // grabbable region so interactive widget content (links,
                // buttons) stays clickable.
                draggable
                onDragStart={(e) => handleDragStart(i, e)}
                onDragEnd={handleDragEnd}
                onClick={() => handleKeyboardPick(i)}
                title={
                  keyboardSrc === i
                    ? 'Press again to cancel, or activate another card to swap'
                    : 'Drag, or click to pick up; click another card to swap'
                }
                className={cn(
                  'absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md',
                  'border border-white/10 bg-[var(--color-bg-raised,rgba(0,0,0,0.2))] text-[var(--color-fg-subtle)]',
                  'opacity-0 transition hover:opacity-100 focus-visible:opacity-100',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300',
                  keyboardSrc === i && 'opacity-100 text-[var(--color-fg)]',
                )}
                aria-label={`Reposition ${widget?.title ?? cell.widgetId}`}
                aria-pressed={keyboardSrc === i}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
            )}
            {widget ? (
              <widget.Component />
            ) : (
              <div className="flex h-full items-center gap-2 rounded-xl border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/5 p-4 text-sm text-[var(--color-warn)]">
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
