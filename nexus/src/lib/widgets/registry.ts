/**
 * Widget registry — stable types for the bento dashboard.
 *
 * A Widget is a self-fetching card with a stable id. Presets (see
 * `presets.ts`) reference widgets by id and assign them a position
 * + span in the CSS grid. Keeping the widget map separate from preset
 * layout means a widget can appear in multiple presets without copies.
 *
 * Design decisions baked in here:
 *   - Widgets have *no* props other than an optional span override.
 *     Cross-widget state doesn't exist — each one owns its fetching
 *     and visual state. Page-level context (selected resource, bulk
 *     selection) stays on the page, not on any widget.
 *   - `span` is advisory. The preset layout ultimately decides the
 *     rendered cols/rows; widget default spans are just sensible
 *     fallbacks for anyone rendering a widget outside a preset.
 */

import type { ComponentType } from 'react';

export type WidgetId = string;

export interface WidgetSpan {
  /** Column span on a 4-col bento grid. Clamped 1..4. */
  cols: 1 | 2 | 3 | 4;
  /** Row span in grid rows. Clamped 1..3. */
  rows: 1 | 2 | 3;
}

export interface Widget {
  id: WidgetId;
  title: string;
  description?: string;
  /** Default size when a preset doesn't override. */
  defaultSpan: WidgetSpan;
  Component: ComponentType;
}

export interface BentoCell {
  widgetId: WidgetId;
  /** Column start (1-based CSS grid) and span. */
  col: number;
  cols: number;
  /** Row start (1-based CSS grid) and span. */
  row: number;
  rows: number;
}

export interface BentoPreset {
  id: 'overview' | 'noc' | 'capacity' | 'incidents';
  label: string;
  description: string;
  /** Ordered cells — the BentoGrid walks this array in order. */
  cells: BentoCell[];
}

// ─── Registry ────────────────────────────────────────────────────────────────

const registry = new Map<WidgetId, Widget>();

export function registerWidget(widget: Widget): void {
  if (registry.has(widget.id)) {
    // Register-twice is almost always a dev HMR re-eval. The last-write
    // wins so edited components hot-reload cleanly.
  }
  registry.set(widget.id, widget);
}

export function getWidget(id: WidgetId): Widget | undefined {
  return registry.get(id);
}

export function listWidgets(): Widget[] {
  return [...registry.values()];
}

/** Test/debug only — drops every registered widget. */
export function __resetRegistry(): void {
  registry.clear();
}

// ─── Preset validation ───────────────────────────────────────────────────────

export interface PresetValidation {
  ok: boolean;
  issues: string[];
}

/**
 * Sanity-check a preset without rendering it: does every cell point at
 * a registered widget, and does any pair of cells overlap on the grid?
 *
 * Bento layouts are intentionally static, so a collision is always a
 * bug in `presets.ts` — we fail loud in tests rather than silently
 * draw widgets on top of each other.
 */
export function validatePreset(preset: BentoPreset, gridCols = 4): PresetValidation {
  const issues: string[] = [];
  const occupied = new Map<string, WidgetId>();

  for (const cell of preset.cells) {
    if (!registry.has(cell.widgetId)) {
      issues.push(`unknown widget "${cell.widgetId}"`);
    }
    if (cell.col < 1 || cell.col + cell.cols - 1 > gridCols) {
      issues.push(
        `widget "${cell.widgetId}" overflows the ${gridCols}-col grid at col=${cell.col} cols=${cell.cols}`,
      );
    }
    for (let c = cell.col; c < cell.col + cell.cols; c++) {
      for (let r = cell.row; r < cell.row + cell.rows; r++) {
        const key = `${c}:${r}`;
        const prev = occupied.get(key);
        if (prev) {
          issues.push(
            `widget "${cell.widgetId}" overlaps "${prev}" at col=${c} row=${r}`,
          );
        } else {
          occupied.set(key, cell.widgetId);
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
