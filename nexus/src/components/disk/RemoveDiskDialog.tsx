'use client';

/**
 * RemoveDiskDialog — detach or destroy a VM disk / CT mountpoint.
 *
 * The operator picks Detach (default, safer) or Delete via radio — no
 * type-to-confirm gate; the red copy on the Delete option and the radio
 * pick itself are the pre-flight barrier. Matches PVE's own "remove
 * with destroy volume" UX but without the ambiguity of two separate
 * buttons.
 *
 * Rootfs isn't removable (PVE rejects and the CT needs its root), so
 * DisksSection disables the menu item in that case; this dialog doesn't
 * try to guard against being opened with one.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, X, HardDrive } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';

export interface RemoveDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  volume: VolumeDescriptor;
  /** Current guest config — used to snapshot pre-detach `unused*` keys
   *  so leg 2 of the delete flow can identify the newly-produced key
   *  rather than blindly picking the first `unused*` it sees. */
  config: Record<string, unknown>;
}

type RemoveMode = 'detach' | 'delete';
type DeletePhase = 'idle' | 'detached';

/** PVE `delete` parameter: rootfs uses the literal key, everything else
 *  uses its own config slot (scsi0, virtio1, mp0, …). */
function resolveSlot(volume: VolumeDescriptor): string {
  return volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;
}

interface ConfigResponse {
  data?: Record<string, unknown>;
}

export function RemoveDiskDialog({
  open,
  onClose,
  type,
  node,
  vmid,
  volume,
  config,
}: RemoveDiskDialogProps) {
  const [mode, setMode] = useState<RemoveMode>('detach');
  const [phase, setPhase] = useState<DeletePhase>('idle');
  const [localError, setLocalError] = useState<string | null>(null);
  const qc = useQueryClient();

  const slotLabel = volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;
  const slot = resolveSlot(volume);
  const basePath = type === 'qemu' ? 'qemu' : 'lxc';
  const url = `/api/proxmox/nodes/${encodeURIComponent(node)}/${basePath}/${vmid}/config`;
  const configKey = [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'config'] as const;

  // Snapshot the `unused*` keys present BEFORE the detach so leg 2 can
  // identify the new key deterministically (the first `unused*` in the
  // refetched config may be a pre-existing entry from an earlier detach).
  const preDetachUnused = useMemo(
    () => new Set(Object.keys(config).filter((k) => k.startsWith('unused'))),
    [config],
  );

  const invalidateKeys = useMemo(
    () => [[...configKey], ['cluster', 'resources']],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, node, vmid],
  );

  // PVE's "remove + destroy" is a two-step flow: leg 1 detaches the slot
  // (the volume moves to unused{N}); leg 2 deletes that unused{N} key to
  // destroy the volume on storage. Both legs are PUT /config with a
  // `delete` param — same URL, same CSRF path, same invalidations.
  const detachMutation = useCsrfMutation<unknown, { delete: string }>({
    url,
    method: 'PUT',
    invalidateKeys,
  });

  const destroyMutation = useCsrfMutation<unknown, { delete: string }>({
    url,
    method: 'PUT',
    invalidateKeys,
  });

  const pending = detachMutation.isPending || destroyMutation.isPending;
  const pveError =
    destroyMutation.error?.message ??
    detachMutation.error?.message ??
    localError;

  if (!open) return null;

  const finaliseDelete = async () => {
    setLocalError(null);
    // Refetch the config so we can diff against the pre-detach snapshot.
    const res = await fetch(url, { credentials: 'include' });
    const json = (await res.json().catch(() => ({}))) as ConfigResponse;
    const data = json.data ?? {};
    const currentUnused = Object.keys(data).filter((k) => k.startsWith('unused'));
    const newKeys = currentUnused.filter((k) => !preDetachUnused.has(k));

    if (newKeys.length === 0) {
      // PVE destroyed the volume inline — common for some LXC / storage
      // combinations. Nothing more to do.
      void qc.invalidateQueries({ queryKey: [...configKey] });
      onClose();
      return;
    }

    if (newKeys.length > 1) {
      setLocalError(
        'Could not identify the newly-detached volume. Inspect the guest in PVE directly.',
      );
      return;
    }

    destroyMutation.mutate(
      { delete: newKeys[0] },
      { onSuccess: () => onClose() },
    );
  };

  const submit = () => {
    if (pending) return;
    setLocalError(null);

    if (mode === 'detach') {
      detachMutation.mutate(
        { delete: slot },
        { onSuccess: () => onClose() },
      );
      return;
    }

    // Delete flow: retry re-enters at the point where it last failed so
    // we don't re-detach an already-detached slot.
    if (phase === 'detached') {
      void finaliseDelete();
      return;
    }

    detachMutation.mutate(
      { delete: slot },
      {
        onSuccess: () => {
          setPhase('detached');
          void finaliseDelete();
        },
      },
    );
  };

  const actionLabel = mode === 'delete' ? 'Delete' : 'Detach';
  const actionCls =
    mode === 'delete'
      ? 'bg-[var(--color-err)] hover:opacity-90 text-white'
      : 'bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)]';

  return (
    <ModalShell size="md" onClose={pending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg-secondary)]">
            Remove {slotLabel}
          </h3>
        </div>
        <button
          onClick={onClose}
          disabled={pending}
          className="text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] p-1 disabled:opacity-40"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-overlay)] p-3">
          <p className="text-sm text-[var(--color-fg-secondary)]">
            <span className="font-mono">{slotLabel}</span>
            <span className="text-[var(--color-fg-subtle)]">
              {' '}on {volume.storage} ({formatVolumeSize(volume.sizeMiB)})
            </span>
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="remove-mode"
              value="detach"
              checked={mode === 'detach'}
              onChange={() => setMode('detach')}
              disabled={pending || phase === 'detached'}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm text-[var(--color-fg-secondary)]">
                Detach — keep volume on storage
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-fg-subtle)]">
                The disk is unplugged from this guest. The volume stays on{' '}
                {volume.storage} and can be re-attached later.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="remove-mode"
              value="delete"
              checked={mode === 'delete'}
              onChange={() => setMode('delete')}
              disabled={pending || phase === 'detached'}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div
                className="text-sm font-medium"
                style={{ color: 'var(--color-err)' }}
              >
                Delete — volume will be destroyed
              </div>
              {mode === 'delete' && (
                <p
                  className="mt-0.5 text-xs"
                  style={{ color: 'var(--color-err)' }}
                >
                  The volume file on {volume.storage} will be destroyed. This
                  cannot be undone.
                </p>
              )}
            </div>
          </label>
        </div>

        {phase === 'detached' && !pveError && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg">
            <AlertCircle className="w-4 h-4 text-[var(--color-fg-subtle)] mt-0.5 shrink-0" />
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Volume detached. Retry to destroy it.
            </p>
          </div>
        )}

        {pveError && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
            <p className="text-xs text-[var(--color-err)]">{pveError}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition disabled:opacity-40 ${actionCls}`}
        >
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          {actionLabel}
        </button>
      </div>
    </ModalShell>
  );
}
