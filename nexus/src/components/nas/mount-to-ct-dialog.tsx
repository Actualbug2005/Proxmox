'use client';

/**
 * Bind-mount a NAS share into an LXC via /api/nas/mount.
 *
 * Picks the target container from the live cluster resources (scoped to
 * the same node as the share — the bind-mount is a host path, so the
 * LXC must live on the same host for the path to exist). Guest path is
 * free-form text; the server re-validates against path-traversal and
 * PVE-config metacharacters.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, HardDriveDownload, Loader2, X } from 'lucide-react';
import { useNodeCTs } from '@/hooks/use-cluster';
import { useToast } from '@/components/ui/toast';
import { readCsrfCookie } from '@/lib/proxmox-client';
import type { NasShare } from '@/types/nas';

interface Props {
  node: string;
  share: NasShare;
  onClose: () => void;
}

interface MountResponse {
  ok: true;
  slot: number;
  mp: string;
  hostPath: string;
  guestPath: string;
  readOnly: boolean;
  shared: boolean;
}

export function MountToCtDialog({ node, share, onClose }: Props) {
  const toast = useToast();
  const cts = useNodeCTs(node);
  const sortedCts = useMemo(
    () => [...cts].sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0)),
    [cts],
  );

  const [vmid, setVmid] = useState<number | ''>(sortedCts[0]?.vmid ?? '');
  const [guestPath, setGuestPath] = useState(`/mnt/${share.name}`);
  const [readOnly, setReadOnly] = useState(share.readOnly);

  const mutation = useMutation({
    mutationFn: async () => {
      if (typeof vmid !== 'number') throw new Error('Select a container');
      const csrf = readCsrfCookie();
      const res = await fetch('/api/nas/mount', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        body: JSON.stringify({
          node,
          shareId: share.id,
          vmid,
          guestPath,
          readOnly,
          // shared defaults to true on the server; leave it implicit.
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as MountResponse;
    },
    onSuccess: (data) => {
      toast.success(
        'Mounted',
        `${data.mp}=${data.hostPath} → vmid ${vmid}:${data.guestPath}`,
      );
      onClose();
    },
    onError: (err) => {
      toast.error('Mount failed', err instanceof Error ? err.message : String(err));
    },
  });

  const disabled =
    typeof vmid !== 'number' ||
    !guestPath.startsWith('/') ||
    guestPath.includes('..') ||
    /[,=\n\s]/.test(guestPath);

  return (
    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--color-surface)] border-l border-[var(--color-border-subtle)] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <HardDriveDownload className="w-4 h-4 text-indigo-400" />
              Mount to container
            </h2>
            <p className="text-xs text-[var(--color-fg-subtle)]">
              Bind-mount {share.name} → an LXC on {node}.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] block mb-1.5">
              Host path
            </label>
            <p className="font-mono text-xs text-[var(--color-fg-secondary)] bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md px-2 py-1.5 break-all">
              {share.path}
            </p>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] block mb-1.5">
              Container
            </label>
            {sortedCts.length === 0 ? (
              <p className="flex items-start gap-2 text-xs text-[var(--color-warn)] bg-[var(--color-warn)]/10 border border-[var(--color-warn)]/20 rounded-md px-2 py-1.5">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                No LXC containers found on {node}.
              </p>
            ) : (
              <select
                value={vmid}
                onChange={(e) => setVmid(Number(e.target.value))}
                className="w-full px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)]"
              >
                {sortedCts.map((ct) => (
                  <option key={ct.id} value={ct.vmid}>
                    {ct.vmid} — {ct.name ?? '(unnamed)'} · {ct.status ?? '?'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-widest text-[var(--color-fg-subtle)] block mb-1.5">
              Mount point inside container
            </label>
            <input
              type="text"
              value={guestPath}
              onChange={(e) => setGuestPath(e.target.value)}
              placeholder="/mnt/videos"
              className="w-full px-2 py-1.5 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-md text-xs text-[var(--color-fg-secondary)] font-mono"
            />
            <p className="text-[10px] text-[var(--color-fg-subtle)] mt-1">
              Absolute path. No spaces, commas or equals — PVE&apos;s config parser
              reserves those.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-[var(--color-fg-secondary)]">
            <input
              type="checkbox"
              checked={readOnly}
              onChange={(e) => setReadOnly(e.target.checked)}
            />
            Mount read-only inside the guest
          </label>

          <div className="flex items-start gap-2 text-[10px] text-[var(--color-fg-faint)] border-t border-[var(--color-border-subtle)] pt-3">
            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
            PVE may refuse this change if the container is running and hot-plug
            isn&apos;t supported on its config. Stop the container first if the
            mount fails with &quot;hotplug&quot;.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-border-subtle)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs text-[var(--color-fg-secondary)] hover:bg-[var(--color-overlay)] transition"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={disabled || mutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-medium disabled:opacity-40"
          >
            {mutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <HardDriveDownload className="w-3 h-3" />
            )}
            Mount
          </button>
        </div>
      </div>
    </div>
  );
}
