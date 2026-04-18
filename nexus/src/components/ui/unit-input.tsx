'use client';

/**
 * Binary-unit number input. Lets the user type a number and pick a unit
 * (MiB / GiB / TiB); the component converts back to a single canonical
 * unit for the caller so upstream code keeps working with one scalar.
 *
 * Why binary units only: every Proxmox size field we bind to is a power
 * of 1024, and mixing SI (GB = 1e9) into the same control would silently
 * break on the boundary (a user typing "1 GB" when the backend wants MiB
 * would send 1000 instead of 1024 bytes' worth).
 *
 * Why the unit lives in local state, not a prop:
 *   - The canonical value is the source of truth. The displayed unit is
 *     a pure presentation concern; flipping it must never change what
 *     gets submitted.
 *   - On mount we infer a "nice" initial unit from the value magnitude
 *     so an existing 2048 MiB renders as `2 GiB`, not `2048 MiB`.
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export type BinaryUnit = 'MiB' | 'GiB' | 'TiB';

const FACTOR: Record<BinaryUnit, number> = {
  MiB: 1,
  GiB: 1024,
  TiB: 1024 * 1024,
};

/**
 * Pick the largest unit that keeps the number ≥ 1. Avoids rendering
 * `0.002 TiB` when `2 GiB` is clearer, and `1024 MiB` when `1 GiB`
 * would do. Falls back to MiB for fractional-MiB canonical values.
 */
function preferredUnit(
  canonicalMiB: number,
  allowed: readonly BinaryUnit[],
): BinaryUnit {
  for (const u of ['TiB', 'GiB'] as const) {
    if (allowed.includes(u) && canonicalMiB >= FACTOR[u]) return u;
  }
  return 'MiB';
}

export interface UnitInputProps {
  /** Current value, expressed in the canonical unit (see `canonicalUnit`). */
  value: number;
  /**
   * Unit the caller wants back through `onChange`. PVE's VM memory takes
   * MiB; disk sizes take GiB — pick whichever matches the API the caller
   * will send to.
   */
  canonicalUnit: BinaryUnit;
  onChange: (canonicalValue: number) => void;
  /** Units the user may pick from. Defaults to all three. */
  units?: readonly BinaryUnit[];
  /** Lower bound, in the canonical unit. */
  min?: number;
  /** Upper bound, in the canonical unit. */
  max?: number;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

const DEFAULT_UNITS: readonly BinaryUnit[] = ['MiB', 'GiB', 'TiB'] as const;

export function UnitInput({
  value,
  canonicalUnit,
  onChange,
  units = DEFAULT_UNITS,
  min,
  max,
  placeholder,
  className,
  disabled,
  ariaLabel,
}: UnitInputProps) {
  const canonicalMiB = value * FACTOR[canonicalUnit];
  const [displayUnit, setDisplayUnit] = useState<BinaryUnit>(() =>
    preferredUnit(canonicalMiB, units),
  );

  // Displayed number derived from the canonical value every render — so
  // changing the unit re-renders with the same size, and external value
  // updates (e.g. a parent reset) flow through cleanly.
  const displayed = useMemo(() => {
    const n = canonicalMiB / FACTOR[displayUnit];
    // Trim to 4 sig-figs for readability without hiding the true value
    // outright; users typing whole numbers see whole numbers.
    return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
  }, [canonicalMiB, displayUnit]);

  function handleNumberChange(raw: string) {
    if (raw === '') {
      onChange(0);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    // Convert display → canonical. Round away sub-unit noise so 2.5 GiB
    // submitted for an MiB-canonical field lands on 2560, not 2559.9999.
    const inCanonical = (parsed * FACTOR[displayUnit]) / FACTOR[canonicalUnit];
    onChange(Math.round(inCanonical));
  }

  const inputCls = cn(
    'flex-1 px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-l-lg text-sm text-[var(--color-fg-secondary)]',
    'placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  );

  const selectCls = cn(
    'px-2 py-2 bg-[var(--color-overlay)] border border-l-0 border-[var(--color-border-subtle)] rounded-r-lg text-sm text-[var(--color-fg-secondary)]',
    'focus:outline-none focus:border-zinc-300/50',
    'disabled:opacity-50 disabled:cursor-not-allowed',
  );

  // Clamp hints passed to the <input> are expressed in the display unit
  // so the browser's native validation doesn't fight the user — a 256 MiB
  // minimum shows as 0.25 when the unit is GiB.
  const displayMin = min !== undefined
    ? (min * FACTOR[canonicalUnit]) / FACTOR[displayUnit]
    : undefined;
  const displayMax = max !== undefined
    ? (max * FACTOR[canonicalUnit]) / FACTOR[displayUnit]
    : undefined;

  return (
    <div className={cn('flex', className)}>
      <input
        type="number"
        value={displayed}
        onChange={(e) => handleNumberChange(e.target.value)}
        min={displayMin}
        max={displayMax}
        step="any"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className={inputCls}
      />
      <select
        value={displayUnit}
        onChange={(e) => setDisplayUnit(e.target.value as BinaryUnit)}
        disabled={disabled}
        aria-label="Unit"
        className={selectCls}
      >
        {units.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </div>
  );
}
