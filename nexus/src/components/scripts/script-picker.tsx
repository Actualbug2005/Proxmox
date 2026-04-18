'use client';

/**
 * Compact combobox for picking a Community Script.
 *
 * Used inside ChainEditor step rows — a full two-pane browser is overkill
 * there, so this renders a search box that filters a flat list and calls
 * back with the minimum required fields to populate a ChainStep
 * (`slug`, `scriptName`, `scriptUrl`, `method`).
 *
 * Data source: the same /api/scripts?grouped=1 endpoint the main Scripts
 * page uses; results are cached via TanStack Query keyed by
 * ['scripts','grouped'] so opening 10 pickers in a chain only fetches
 * once.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CommunityScript } from '@/lib/community-scripts';
import type { GroupedEnvelope } from '@/app/api/scripts/route';

export interface PickedScript {
  slug: string;
  scriptName: string;
  scriptUrl: string;
  method?: string;
}

interface ScriptPickerProps {
  value: PickedScript | null;
  onChange: (picked: PickedScript) => void;
  /** `compact` renders as a one-line combobox for chain step rows. */
  variant?: 'compact' | 'panel';
}

async function fetchGrouped(): Promise<GroupedEnvelope> {
  const res = await fetch('/api/scripts?grouped=1');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as GroupedEnvelope;
}

export function ScriptPicker({ value, onChange, variant = 'compact' }: ScriptPickerProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['scripts', 'grouped'],
    queryFn: fetchGrouped,
    staleTime: 5 * 60_000,
  });

  const flat = useMemo<CommunityScript[]>(() => {
    if (!data) return [];
    return data.categories.flatMap((c) => c.scripts);
  }, [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return flat.slice(0, 60);
    return flat
      .filter((s) =>
        s.name.toLowerCase().includes(needle) ||
        s.slug.toLowerCase().includes(needle) ||
        (s.description ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 60);
  }, [flat, q]);

  const pick = (s: CommunityScript) => {
    onChange({
      slug: s.slug,
      scriptName: s.name,
      scriptUrl: s.scriptUrl,
      method: s.method,
    });
    setOpen(false);
    setQ('');
  };

  return (
    <div className={cn('relative', variant === 'panel' && 'w-full')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition',
          'border-[var(--color-border-subtle)] bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] hover:border-[var(--color-border-strong)]',
          open && 'border-zinc-600',
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left">
          {value ? (
            <>
              <span className="text-[var(--color-fg)]">{value.scriptName}</span>
              <span className="ml-2 font-mono text-xs text-[var(--color-fg-subtle)]">{value.slug}</span>
            </>
          ) : (
            <span className="text-[var(--color-fg-subtle)]">Pick a community script…</span>
          )}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-[var(--color-fg-subtle)] transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 right-0 z-40 mt-1 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] shadow-2xl',
            'max-h-80 overflow-hidden',
          )}
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3 py-2">
            <Search className="h-3.5 w-3.5 text-[var(--color-fg-subtle)]" />
            <input
              autoFocus
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search scripts…"
              className="flex-1 bg-transparent text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]"
                aria-label="Clear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-6 text-[var(--color-fg-subtle)]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            {error && (
              <div className="px-3 py-4 text-xs text-[var(--color-err)]">
                Failed to load scripts: {error.message}
              </div>
            )}
            {!isLoading && !error && filtered.length === 0 && (
              <div className="px-3 py-4 text-xs text-[var(--color-fg-subtle)]">No matches.</div>
            )}
            {!isLoading &&
              !error &&
              filtered.map((s) => {
                const selected = value?.slug === s.slug;
                return (
                  <button
                    type="button"
                    key={s.slug}
                    onClick={() => pick(s)}
                    className={cn(
                      'flex w-full items-start gap-2 border-b border-zinc-800/40 px-3 py-2 text-left transition last:border-b-0',
                      'hover:bg-zinc-800/60',
                      selected && 'bg-zinc-800/40',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-[var(--color-fg)]">{s.name}</span>
                        <span className="shrink-0 font-mono text-[11px] uppercase text-[var(--color-fg-subtle)]">
                          {s.type}
                        </span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-[var(--color-fg-subtle)]">{s.slug}</div>
                      {s.description && (
                        <div className="mt-0.5 line-clamp-1 text-xs text-[var(--color-fg-muted)]">
                          {s.description}
                        </div>
                      )}
                    </div>
                    {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-ok)]" />}
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
