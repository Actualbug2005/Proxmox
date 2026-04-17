'use client';

/**
 * Modal form for creating a NAS share. Validation rules match the server
 * validator in /api/nas/shares/route.ts, so the "Create" button disables
 * when the backend would reject — the user sees feedback inline instead of
 * a toast after round-tripping.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { NasProtocol } from '@/types/nas';

interface Props {
  node: string;
  onClose: () => void;
  onCreated: () => void;
}

const NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const NAME_MAX = 64;

export function CreateShareDialog({ node, onClose, onCreated }: Props) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [smb, setSmb] = useState(true);
  const [nfs, setNfs] = useState(false);
  const [readOnly, setReadOnly] = useState(true);

  // Live validation. Recomputed only when the inputs it depends on change.
  const validation = useMemo(() => {
    const errors: { name?: string; path?: string; protocols?: string } = {};
    if (name.length === 0) errors.name = 'Required';
    else if (name.length > NAME_MAX) errors.name = `Max ${NAME_MAX} chars`;
    else if (!NAME_RE.test(name)) errors.name = 'Only letters, digits, _ . -';

    if (path.length === 0) errors.path = 'Required';
    else if (!path.startsWith('/')) errors.path = 'Must be absolute (start with /)';
    else if (path.includes('..')) errors.path = 'Cannot contain ..';

    if (!smb && !nfs) errors.protocols = 'Pick at least one protocol';

    const ok = Object.keys(errors).length === 0;
    return { errors, ok };
  }, [name, path, smb, nfs]);

  const createM = useMutation({
    mutationFn: () => {
      const protocols: NasProtocol[] = [];
      if (smb) protocols.push('smb');
      if (nfs) protocols.push('nfs');
      return api.nas.createShare(node, { name, path, protocols, readOnly });
    },
    onSuccess: (share) => {
      toast.success('Share created', `${share.name} on ${node}`);
      onCreated();
      onClose();
    },
    onError: (err) => {
      toast.error('Create failed', err instanceof Error ? err.message : String(err));
    },
  });

  const inputCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50 font-mono';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="studio-card w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
          <div>
            <h2 className="text-sm font-semibold text-white">Create NAS share</h2>
            <p className="text-xs text-[var(--color-fg-subtle)]">on {node}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Share name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="media"
              maxLength={NAME_MAX + 8}
              className={cn(inputCls, validation.errors.name && name.length > 0 && 'border-red-500/50')}
            />
            {validation.errors.name && name.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                <AlertCircle className="w-3 h-3" />
                {validation.errors.name}
              </p>
            )}
          </div>

          {/* Path */}
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Export path</label>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/mnt/tank/media"
              className={cn(inputCls, validation.errors.path && path.length > 0 && 'border-red-500/50')}
            />
            {validation.errors.path && path.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                <AlertCircle className="w-3 h-3" />
                {validation.errors.path}
              </p>
            )}
          </div>

          {/* Protocols */}
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-2">Protocols</label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={smb}
                  onChange={(e) => setSmb(e.target.checked)}
                  className="w-4 h-4 accent-zinc-100"
                />
                <span className="text-sm text-[var(--color-fg-secondary)]">SMB</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={nfs}
                  onChange={(e) => setNfs(e.target.checked)}
                  className="w-4 h-4 accent-zinc-100"
                />
                <span className="text-sm text-[var(--color-fg-secondary)]">NFS</span>
              </label>
            </div>
            {validation.errors.protocols && (
              <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                <AlertCircle className="w-3 h-3" />
                {validation.errors.protocols}
              </p>
            )}
          </div>

          {/* Read-only toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border-subtle)]">
            <div>
              <p className="text-sm text-[var(--color-fg-secondary)]">Read-only</p>
              <p className="text-xs text-[var(--color-fg-subtle)]">
                Clients can list + read files but cannot modify them.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={readOnly}
              onClick={() => setReadOnly((v) => !v)}
              className={cn(
                'relative w-10 h-6 rounded-full transition shrink-0',
                readOnly ? 'bg-emerald-500' : 'bg-[var(--color-overlay)]',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform',
                  readOnly && 'translate-x-4',
                )}
              />
            </button>
          </div>
        </div>

        <div className="flex gap-3 justify-end px-5 py-4 border-t border-[var(--color-border-subtle)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={() => createM.mutate()}
            disabled={!validation.ok || createM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createM.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Create Share
          </button>
        </div>
      </div>
    </div>
  );
}
