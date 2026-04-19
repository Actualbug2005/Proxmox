'use client';

/**
 * AlertBell — clickable bell icon that lives on pressure / event widgets.
 * Outline when no rules target this widget's scope; filled with a badge
 * showing the count when ≥1 rule matches. Click fires back to the parent
 * so the parent can open its rule-editor modal with a draft.
 *
 * Deliberately tiny: this is a leaf component with no hooks, no data
 * fetching, no side effects beyond the click handler. The parent owns
 * the rule count (usually from useRules() + a scope filter) and the
 * modal-open state.
 */

import { Bell, BellRing } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AlertBellProps {
  /** How many active rules are currently targeting this widget's scope. */
  rulesCount: number;
  /** Fires when the operator clicks the bell. Parent opens the rule editor. */
  onClick: () => void;
  /** Extra classes for the outer button (positioning, etc.). */
  className?: string;
  /** Optional aria-label override. Default is auto-computed. */
  ariaLabel?: string;
}

export function AlertBell({ rulesCount, onClick, className, ariaLabel }: AlertBellProps) {
  const active = rulesCount > 0;
  const label = ariaLabel ?? buildAriaLabel(rulesCount);
  const Icon = active ? BellRing : Bell;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'relative p-1 rounded-md transition-colors',
        active
          ? 'text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
          : 'text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)]/50',
        className,
      )}
    >
      <Icon className="w-4 h-4" />
      {active && (
        <span
          className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-accent)] text-[10px] font-medium text-white flex items-center justify-center"
          aria-hidden
        >
          {rulesCount}
        </span>
      )}
    </button>
  );
}

/**
 * Build an accessible label describing what the bell does in the
 * current state. Exported so the test suite can verify the pluralisation
 * without driving the button through the DOM.
 */
export function buildAriaLabel(rulesCount: number): string {
  if (rulesCount === 0) return 'Add alert rule';
  if (rulesCount === 1) return '1 alert rule';
  return `${rulesCount} alert rules`;
}
