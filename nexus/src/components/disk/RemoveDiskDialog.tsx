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

import { useState } from 'react';
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
}

type RemoveMode = 'detach' | 'delete';

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
}: RemoveDiskDialogProps) {
  const [mode, setMode] = useState<RemoveMode>('detach');

  const slotLabel = volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;
  const slot = resolveSlot(volume);
  const basePath = type === 'qemu' ? 'qemu' : 'lxc';
  const url = `/api/proxmox/nodes/${encodeURIComponent(node)}/${basePath}/${vmid}/config`;

  // PVE's "remove + destroy" is a two-step flow: detach moves the volume to
  // unused{N}, a second delete on that key destroys it. This matches what
  // PVE's own UI does.
  const finaliseDelete = async () => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as ConfigResponse;
      const data = json.data ?? {};
      const unusedKey = Object.keys(data).find((k) => k.startsWith('unused'));
      if (!unusedKey) {
        onClose();
        return;
      }
      const token = (() => {
        if (typeof document === 'undefined') return null;
        const entry = document.cookie
          .split('; ')
          .find((c) => c.startsWith('CSRFPreventionToken='));
        return entry ? entry.slice('CSRFPreventionToken='.length) : null;
      })();
      const destroyRes = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { CSRFPreventionToken: token } : {}),
        },
        body: JSON.stringify({ delete: unusedKey }),
      });
      if (!destroyRes.ok) {
        throw new Error(`Destroy volume failed: ${destroyRes.status}`);
      }
      onClose();
    } catch (err) {
      console.error(err);
      onClose();
    }
  };

  const mutation = useCsrfMutation<unknown, { delete: string }>({
    url,
    method: 'PUT',
    invalidateKeys: [
      [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'config'],
      ['cluster', 'resources'],
    ],
  });

  const pveError = mutation.error?.message ?? null;

  if (!open) return null;

  const submit = () => {
    if (mutation.isPending) return;
    mutation.mutate(
      { delete: slot },
      {
        onSuccess: () => {
          if (mode === 'detach') {
            onClose();
            return;
          }
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
    <ModalShell size="md" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg-secondary)]">
            Remove {slotLabel}
          </h3>
        </div>
        <button
          onClick={onClose}
          disabled={mutation.isPending}
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
              disabled={mutation.isPending}
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
              disabled={mutation.isPending}
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
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={mutation.isPending}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition disabled:opacity-40 ${actionCls}`}
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {actionLabel}
        </button>
      </div>
    </ModalShell>
  );
}
