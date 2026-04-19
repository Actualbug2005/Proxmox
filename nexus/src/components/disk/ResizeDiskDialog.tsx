'use client';

/**
 * ResizeDiskDialog — grow an existing VM disk or CT rootfs/mp.
 *
 * The UI takes an absolute new size (GiB or TiB) via <UnitInput>. We
 * compute the delta and submit PVE's `+NG` form, which is the only
 * resize direction PVE accepts — shrinks are refused server-side too,
 * but blocking them client-side keeps the operator out of a dead end.
 *
 * After a successful VM resize the guest's partition table and
 * filesystem are *not* grown automatically — we surface a hint
 * reminding the operator to run growpart/resize2fs inside the VM.
 * CTs auto-grow the underlying FS, so the CT hint is informational only.
 *
 * PVE errors are shown inline rather than as a toast: the operator is
 * looking at the dialog, the error is specific to this mutation, and
 * the Resize button can retry without the dialog dismissing itself.
 */

import { useMemo, useState } from 'react';
import { Loader2, AlertCircle, X, HardDrive } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';
import { UnitInput } from '@/components/ui/unit-input';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { formatVolumeSize, type VolumeDescriptor } from '@/lib/disk/parse';

interface ResizeDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  volume: VolumeDescriptor;
}

/** PVE `disk` parameter: CT rootfs lives at 'rootfs', everything else uses
 *  its own config key (scsi0, virtio1, mp0, …). */
function resolveSlot(volume: VolumeDescriptor): string {
  return volume.kind === 'ct-rootfs' ? 'rootfs' : volume.slot;
}

interface ResizeInput {
  disk: string;
  size: string;
}

export function ResizeDiskDialog({
  open,
  onClose,
  type,
  node,
  vmid,
  volume,
}: ResizeDiskDialogProps) {
  const currentMiB = volume.sizeMiB;
  // Floor the initial value at the current size expressed in whole GiB
  // (rounded up — the UnitInput `min` uses the same ceil so the initial
  // value never falls below the floor and triggers native validation).
  const minGiB = Math.ceil(currentMiB / 1024);
  const [newGiB, setNewGiB] = useState<number>(minGiB);

  const slot = resolveSlot(volume);
  const basePath = type === 'qemu' ? 'qemu' : 'lxc';
  const url = `/api/proxmox/nodes/${encodeURIComponent(node)}/${basePath}/${vmid}/resize`;

  const mutation = useCsrfMutation<unknown, ResizeInput>({
    url,
    method: 'PUT',
    invalidateKeys: [['config', node, vmid]],
  });

  const newMiB = newGiB * 1024;
  const deltaMiB = newMiB - currentMiB;
  const deltaGiB = Math.ceil(deltaMiB / 1024);
  const hasGrowth = deltaMiB > 0;

  const errorMessage = useMemo(() => {
    if (!hasGrowth) return 'New size must be larger than the current size.';
    return null;
  }, [hasGrowth]);

  const pveError = mutation.error?.message ?? null;

  if (!open) return null;

  const submit = () => {
    if (!hasGrowth || mutation.isPending) return;
    const sizeParam = `+${deltaGiB}G`;
    mutation.mutate(
      { disk: slot, size: sizeParam },
      {
        onSuccess: () => {
          if (type === 'qemu') {
            console.info(
              `Disk grown to ${newGiB} GiB. Log into the VM and run 'sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1' (or equivalent) to expand the filesystem.`,
            );
          } else {
            console.info(
              `${slot} grown to ${newGiB} GiB. The filesystem has been expanded automatically.`,
            );
          }
          onClose();
        },
      },
    );
  };

  const canSubmit = hasGrowth && !mutation.isPending;

  return (
    <ModalShell size="md" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg-secondary)]">
            Resize {slot}
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
          <div className="text-xs uppercase tracking-wide text-[var(--color-fg-faint)]">
            Current size
          </div>
          <div className="mt-1 text-sm text-[var(--color-fg-secondary)]">
            <span className="font-medium">{formatVolumeSize(currentMiB)}</span>
            <span className="text-[var(--color-fg-subtle)]"> on {volume.storage}</span>
          </div>
        </div>

        <div>
          <label
            className="block text-xs uppercase tracking-wide text-[var(--color-fg-faint)] mb-1.5"
            htmlFor="resize-new-size"
          >
            New size
          </label>
          <UnitInput
            value={newGiB}
            canonicalUnit="GiB"
            units={['GiB', 'TiB']}
            min={minGiB}
            onChange={setNewGiB}
            disabled={mutation.isPending}
            ariaLabel="New disk size"
          />
          <p className="mt-1.5 text-xs text-[var(--color-fg-subtle)]">
            Shrinking is not supported. Minimum {minGiB} GiB.
          </p>
        </div>

        {errorMessage && !pveError && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 rounded-lg">
            <AlertCircle className="w-4 h-4 text-[var(--color-err)] mt-0.5 shrink-0" />
            <p className="text-xs text-[var(--color-err)]">{errorMessage}</p>
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
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] bg-[var(--color-overlay)] rounded-lg transition disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] rounded-lg transition disabled:opacity-40"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Resize
        </button>
      </div>
    </ModalShell>
  );
}
