'use client';

/**
 * AddDiskDialog — create a new VM disk or CT mountpoint.
 *
 * Slot is derived from the existing config rather than asked of the
 * operator: for VMs we find the first free `${bus}${N}` key, for CTs
 * the first free `mpN`. This keeps the UI one concept lighter while
 * still guaranteeing we don't collide with an occupied slot.
 *
 * Content-type filtering matches PVE's own: VM disks land on storages
 * that advertise `images`, CT volumes on storages that advertise
 * `rootdir`. A storage with no `content` declared (rare, legacy pools)
 * is considered compatible — PVE will reject it if it really can't
 * hold the volume and the error surfaces inline.
 *
 * Errors: same inline-in-body pattern ResizeDiskDialog uses so the
 * operator can retry without the dialog dismissing itself.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertCircle, X, HardDrive } from 'lucide-react';
import { ModalShell } from '@/components/ui/modal-shell';
import { UnitInput } from '@/components/ui/unit-input';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import { api } from '@/lib/proxmox-client';

export interface AddDiskDialogProps {
  open: boolean;
  onClose: () => void;
  type: 'qemu' | 'lxc';
  node: string;
  vmid: number;
  config: Record<string, unknown>;
}

type VMBus = 'virtio' | 'scsi' | 'sata' | 'ide';
type VMFormat = 'raw' | 'qcow2' | 'vmdk';

const VM_BUSES: VMBus[] = ['virtio', 'scsi', 'sata', 'ide'];
const VM_FORMATS: VMFormat[] = ['raw', 'qcow2', 'vmdk'];

/** First free `${bus}${N}` in `config` for N in 0..30. Falls back to
 *  `${bus}0` — PVE will reject a collision and the error surfaces
 *  inline; better than throwing from a render-path computation. */
function nextVmSlot(config: Record<string, unknown>, bus: VMBus): string {
  for (let n = 0; n <= 30; n++) {
    const key = `${bus}${n}`;
    if (!(key in config)) return key;
  }
  return `${bus}0`;
}

/** First free `mpN` in `config` for N in 0..255. Same fallback rationale
 *  as nextVmSlot — graceful, PVE is the source of truth. */
function nextCtSlot(config: Record<string, unknown>): string {
  for (let n = 0; n <= 255; n++) {
    const key = `mp${n}`;
    if (!(key in config)) return key;
  }
  return 'mp0';
}

export function AddDiskDialog({
  open,
  onClose,
  type,
  node,
  vmid,
  config,
}: AddDiskDialogProps) {
  const [storage, setStorage] = useState<string>('');
  const [sizeGiB, setSizeGiB] = useState<number>(32);
  const [format, setFormat] = useState<VMFormat>('raw');
  const [bus, setBus] = useState<VMBus>('virtio');
  const [mountpoint, setMountpoint] = useState<string>('');

  const basePath = type === 'qemu' ? 'qemu' : 'lxc';
  const url = `/api/proxmox/nodes/${encodeURIComponent(node)}/${basePath}/${vmid}/config`;

  const storagesQuery = useQuery({
    queryKey: ['storage', node, 'list'],
    queryFn: () => api.storage.list(node),
    enabled: open,
  });

  const compatibleStorages = useMemo(() => {
    const all = storagesQuery.data ?? [];
    const needed = type === 'qemu' ? 'images' : 'rootdir';
    return all.filter((s) => {
      if (!s.content) return true;
      return s.content.split(',').includes(needed);
    });
  }, [storagesQuery.data, type]);

  const slot = useMemo(() => {
    if (type === 'qemu') return nextVmSlot(config, bus);
    return nextCtSlot(config);
  }, [type, config, bus]);

  // Mountpoint validation: must start with '/' and must NOT be exactly '/'.
  // Only show the inline error once the user has typed something, so the
  // field doesn't greet them with an angry red box.
  const mountpointError = useMemo(() => {
    if (type !== 'lxc') return null;
    if (mountpoint.length === 0) return null;
    if (!mountpoint.startsWith('/')) return 'Must start with /';
    if (mountpoint === '/') return 'Cannot be just /';
    return null;
  }, [type, mountpoint]);

  const mountpointValid =
    type !== 'lxc' ? true : mountpoint.length > 0 && !mountpointError;

  const mutation = useCsrfMutation<unknown, Record<string, string>>({
    url,
    method: 'PUT',
    invalidateKeys: [
      [type === 'qemu' ? 'vm' : 'ct', node, vmid, 'config'],
      ['cluster', 'resources'],
    ],
  });

  const pveError = mutation.error?.message ?? null;

  if (!open) return null;

  const canSubmit =
    storage !== '' &&
    sizeGiB >= 1 &&
    mountpointValid &&
    !mutation.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const value =
      type === 'qemu'
        ? `${storage}:${sizeGiB},format=${format}`
        : `${storage}:${sizeGiB},mp=${mountpoint}`;
    mutation.mutate(
      { [slot]: value },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  };

  const title = type === 'qemu' ? 'Add Disk' : 'Add Volume';

  const selectCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50 disabled:opacity-50';
  const inputCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] placeholder-zinc-600 focus:outline-none focus:border-zinc-300/50 disabled:opacity-50';
  const labelCls =
    'block text-xs uppercase tracking-wide text-[var(--color-fg-faint)] mb-1.5';
  const helpCls = 'mt-1.5 text-xs text-[var(--color-fg-subtle)]';

  return (
    <ModalShell size="lg" onClose={mutation.isPending ? undefined : onClose}>
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
          <h3 className="text-sm font-semibold text-[var(--color-fg-secondary)]">
            {title}
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
        <div>
          <label className={labelCls} htmlFor="add-disk-storage">
            Storage
          </label>
          <select
            id="add-disk-storage"
            value={storage}
            onChange={(e) => setStorage(e.target.value)}
            disabled={mutation.isPending || storagesQuery.isLoading}
            required
            className={selectCls}
          >
            <option value="">Select storage…</option>
            {compatibleStorages.map((s) => (
              <option key={s.storage} value={s.storage}>
                {s.storage} ({s.type})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="add-disk-size">
            Size
          </label>
          <UnitInput
            value={sizeGiB}
            canonicalUnit="GiB"
            units={['GiB', 'TiB']}
            min={1}
            onChange={setSizeGiB}
            disabled={mutation.isPending}
            ariaLabel="Disk size"
          />
        </div>

        {type === 'qemu' && (
          <>
            <div>
              <label className={labelCls} htmlFor="add-disk-format">
                Format
              </label>
              <select
                id="add-disk-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as VMFormat)}
                disabled={mutation.isPending}
                className={selectCls}
              >
                {VM_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <p className={helpCls}>
                Raw is fastest; QCOW2 supports snapshots on file-backed storage.
              </p>
            </div>

            <div>
              <label className={labelCls} htmlFor="add-disk-bus">
                Bus
              </label>
              <select
                id="add-disk-bus"
                value={bus}
                onChange={(e) => setBus(e.target.value as VMBus)}
                disabled={mutation.isPending}
                className={selectCls}
              >
                {VM_BUSES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <p className={helpCls}>
                Virtio is fastest for Linux. SCSI for broad guest support. IDE only for legacy OSes.
              </p>
            </div>
          </>
        )}

        {type === 'lxc' && (
          <div>
            <label className={labelCls} htmlFor="add-disk-mp">
              Mount path
            </label>
            <input
              id="add-disk-mp"
              type="text"
              value={mountpoint}
              onChange={(e) => setMountpoint(e.target.value)}
              disabled={mutation.isPending}
              placeholder="/data"
              className={inputCls}
            />
            {mountpointError && (
              <p className="mt-1.5 text-xs text-[var(--color-err)]">
                {mountpointError}
              </p>
            )}
          </div>
        )}

        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-overlay)] p-3">
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Will be created as{' '}
            <span className="font-mono text-[var(--color-fg-secondary)]">{slot}</span>.
          </p>
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
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] rounded-lg transition disabled:opacity-40"
        >
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Create
        </button>
      </div>
    </ModalShell>
  );
}
