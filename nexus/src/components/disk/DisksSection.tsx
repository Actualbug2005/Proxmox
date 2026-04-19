'use client';

/**
 * DisksSection — shared VM/CT disk listing with per-row actions.
 *
 * Parses every string entry in `config` through `parseVolume` and renders
 * one row per recognised descriptor, sorted by a stable slot label so the
 * UI order is deterministic regardless of key-iteration order.
 *
 * Only Resize is wired up in this milestone. Add Disk/Volume lands in
 * Task 4; Remove lands in Task 5 — the trigger button and menu item
 * are present but disabled with a short "Coming in …" title.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { HardDrive, MoreHorizontal, Plus } from 'lucide-react';
import { parseVolume, formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';
import { ResizeDiskDialog } from './ResizeDiskDialog';

export interface DisksSectionProps {
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  config: Record<string, unknown>;
}

type DialogState =
  | { kind: 'closed' }
  | { kind: 'resize'; volume: VolumeDescriptor };

/** Stable sort key so rootfs leads CT volumes, then slot alpha. */
function slotLabel(v: VolumeDescriptor): string {
  return v.kind === 'ct-rootfs' ? 'rootfs' : v.slot;
}

function rowKey(v: VolumeDescriptor): string {
  return slotLabel(v);
}

export function DisksSection({ type, node, vmid, config }: DisksSectionProps) {
  const [dialog, setDialog] = useState<DialogState>({ kind: 'closed' });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const volumes = useMemo(() => {
    const out: VolumeDescriptor[] = [];
    for (const [key, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue;
      const parsed = parseVolume(key, value);
      if (parsed) out.push(parsed);
    }
    out.sort((a, b) => slotLabel(a).localeCompare(slotLabel(b)));
    return out;
  }, [config]);

  // Close the row popover on outside click or Escape.
  useEffect(() => {
    if (!menuFor) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const sectionTitle = type === 'qemu' ? 'Disks' : 'Volumes';
  const addLabel = type === 'qemu' ? 'Add Disk' : 'Add Volume';

  return (
    <>
      <div ref={rootRef} className="studio-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white">{sectionTitle}</h3>
          <button
            type="button"
            disabled
            title="Coming in Task 4"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-overlay)] text-[var(--color-fg-subtle)] text-xs rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            {addLabel}
          </button>
        </div>

        {volumes.length === 0 ? (
          <p className="text-xs text-[var(--color-fg-subtle)]">No volumes configured.</p>
        ) : (
          <div className="space-y-2">
            {volumes.map((volume) => {
              const label = slotLabel(volume);
              const key = rowKey(volume);
              const isMenuOpen = menuFor === key;
              return (
                <div
                  key={key}
                  className="relative flex items-center gap-3 p-3 bg-[var(--color-overlay)] rounded-lg"
                >
                  <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[var(--color-fg-secondary)]">
                      <span className="font-mono">{label}</span>{' '}
                      <span className="text-[var(--color-fg-subtle)] font-mono">
                        {volume.storage}:{volume.volume}
                      </span>
                    </p>
                    {volume.kind === 'ct-mp' && (
                      <p className="text-xs text-[var(--color-fg-subtle)] mt-0.5">
                        mounted at <span className="font-mono">{volume.mountpoint}</span>
                      </p>
                    )}
                  </div>
                  <span className="text-sm text-[var(--color-fg-secondary)] tabular-nums">
                    {formatVolumeSize(volume.sizeMiB)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMenuFor(isMenuOpen ? null : key)}
                    aria-label={`Actions for ${label}`}
                    aria-haspopup="menu"
                    aria-expanded={isMenuOpen}
                    className="p-1.5 rounded-lg text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)] transition"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {isMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-3 top-full z-20 mt-1 w-36 rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-overlay)] shadow-lg py-1"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuFor(null);
                          setDialog({ kind: 'resize', volume });
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-fg-secondary)] hover:bg-[var(--color-border-subtle)]/40 transition"
                      >
                        Resize
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled
                        title="Coming in Task 5"
                        className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-fg-subtle)] disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Remove…
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {dialog.kind === 'resize' && (
        <ResizeDiskDialog
          open
          onClose={() => setDialog({ kind: 'closed' })}
          type={type}
          node={node}
          vmid={vmid}
          volume={dialog.volume}
        />
      )}
    </>
  );
}
