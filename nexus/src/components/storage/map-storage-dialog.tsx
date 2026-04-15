'use client';

/**
 * Map Storage dialog — POSTs to PVE's cluster-wide /storage endpoint to
 * register a new storage pool (NFS / CIFS / local directory). Once created,
 * the pool propagates to every node PVE replicates config to and can back
 * VM disks, ISOs, CT templates, or backups depending on the content types
 * the user ticks.
 *
 * Payload shape matches the PVE API exactly:
 *   • `content` is a comma-joined string — PVE parses it on the server side.
 *   • `export` uses its reserved-word spelling because that's the literal
 *     PVE parameter name for the NFS export path.
 *   • Credentials (CIFS username/password) are optional; omit them for
 *     guest-readable shares.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, AlertCircle, HardDrive } from 'lucide-react';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { StorageBackendType, StorageCreatePayload } from '@/types/proxmox';

interface Props {
  onClose: () => void;
  onMapped: () => void;
}

/** Storage ID constraint — PVE actually accepts `[a-z][a-z0-9\-_.]*[a-z0-9]`
 *  but we ship a stricter regex here since "lowercase + digits + hyphens"
 *  covers 99% of real-world IDs and leaves no room for confusing names. */
const STORAGE_ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** Content types Nexus exposes in the Map Storage flow, in the UI order
 *  users expect. Each entry maps the friendly label to the PVE identifier
 *  that ends up in the comma-joined `content` parameter. */
const CONTENT_OPTIONS: ReadonlyArray<{ id: 'images' | 'iso' | 'vztmpl' | 'backup'; label: string; hint: string }> = [
  { id: 'images', label: 'Disk image', hint: 'VM & CT disk files' },
  { id: 'iso', label: 'ISO image', hint: 'bootable install media' },
  { id: 'vztmpl', label: 'Container template', hint: 'LXC template archives' },
  { id: 'backup', label: 'VZDump backup file', hint: 'vma.zst / tar.gz dumps' },
];

type ContentId = (typeof CONTENT_OPTIONS)[number]['id'];

const TYPE_OPTIONS: ReadonlyArray<{ id: StorageBackendType; label: string; desc: string }> = [
  { id: 'nfs', label: 'NFS', desc: 'Network File System export' },
  { id: 'cifs', label: 'CIFS / SMB', desc: 'Windows / Samba share' },
  { id: 'dir', label: 'Directory', desc: 'Local filesystem path' },
];

export function MapStorageDialog({ onClose, onMapped }: Props) {
  const toast = useToast();

  // Common
  const [storageId, setStorageId] = useState('');
  const [type, setType] = useState<StorageBackendType>('nfs');
  const [content, setContent] = useState<Set<ContentId>>(new Set(['iso']));

  // Dynamic — all start empty; unused fields for the current type are ignored
  const [server, setServer] = useState('');
  const [exportPath, setExportPath] = useState('');
  const [share, setShare] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [path, setPath] = useState('');

  const validation = useMemo(() => {
    const errors: {
      storageId?: string;
      content?: string;
      server?: string;
      export?: string;
      share?: string;
      path?: string;
    } = {};

    if (!storageId) errors.storageId = 'Required';
    else if (!STORAGE_ID_RE.test(storageId))
      errors.storageId = 'Lowercase letters, digits, and hyphens (2-32 chars)';

    if (content.size === 0) errors.content = 'Select at least one content type';

    if (type === 'nfs') {
      if (!server.trim()) errors.server = 'Required';
      if (!exportPath.trim()) errors.export = 'Required';
    } else if (type === 'cifs') {
      if (!server.trim()) errors.server = 'Required';
      if (!share.trim()) errors.share = 'Required';
    } else if (type === 'dir') {
      if (!path.trim()) errors.path = 'Required';
      else if (!path.startsWith('/')) errors.path = 'Must be an absolute path';
    }

    return { errors, ok: Object.keys(errors).length === 0 };
  }, [storageId, type, content, server, exportPath, share, path]);

  function toggleContent(id: ContentId) {
    setContent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const createM = useMutation({
    mutationFn: () => {
      // Join in the deterministic CONTENT_OPTIONS order so the payload is
      // byte-for-byte stable given the same ticks — makes tests + debug
      // output readable.
      const contentStr = CONTENT_OPTIONS.filter((o) => content.has(o.id))
        .map((o) => o.id)
        .join(',');

      const payload: StorageCreatePayload = {
        storage: storageId,
        type,
        content: contentStr,
      };

      if (type === 'nfs') {
        payload.server = server.trim();
        payload.export = exportPath.trim();
      } else if (type === 'cifs') {
        payload.server = server.trim();
        payload.share = share.trim();
        if (username.trim()) payload.username = username.trim();
        if (password) payload.password = password;
      } else if (type === 'dir') {
        payload.path = path.trim();
      }

      return api.storage.create(payload);
    },
    onSuccess: () => {
      toast.success('Storage mapped', storageId);
      onMapped();
    },
    onError: (err) => {
      toast.error('Map failed', err instanceof Error ? err.message : String(err));
    },
  });

  const inputCls =
    'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50 font-mono';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-gray-500" />
            <div>
              <h2 className="text-sm font-semibold text-white">Map storage</h2>
              <p className="text-xs text-gray-500">Add a cluster-wide storage pool</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-300 transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrolls if fields overflow the viewport) */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Storage ID */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Storage ID</label>
            <input
              value={storageId}
              onChange={(e) => setStorageId(e.target.value.toLowerCase())}
              placeholder="nas-media"
              maxLength={40}
              className={cn(
                inputCls,
                validation.errors.storageId && storageId.length > 0 && 'border-red-500/50',
              )}
            />
            {validation.errors.storageId && storageId.length > 0 && (
              <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                <AlertCircle className="w-3 h-3" />
                {validation.errors.storageId}
              </p>
            )}
          </div>

          {/* Type */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as StorageBackendType)}
              className={cn(inputCls, 'font-sans')}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} — {t.desc}
                </option>
              ))}
            </select>
          </div>

          {/* Content */}
          <div>
            <label className="text-xs text-gray-500 block mb-2">Content</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CONTENT_OPTIONS.map((c) => (
                <label
                  key={c.id}
                  className="flex items-start gap-2 p-2 bg-gray-950/40 border border-gray-800 rounded-lg cursor-pointer hover:border-gray-700 transition"
                >
                  <input
                    type="checkbox"
                    checked={content.has(c.id)}
                    onChange={() => toggleContent(c.id)}
                    className="w-4 h-4 accent-orange-500 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-gray-200">{c.label}</p>
                    <p className="text-[10px] text-gray-500">{c.hint}</p>
                  </div>
                </label>
              ))}
            </div>
            {validation.errors.content && (
              <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                <AlertCircle className="w-3 h-3" />
                {validation.errors.content}
              </p>
            )}
          </div>

          {/* Dynamic — NFS */}
          {type === 'nfs' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Server</label>
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="10.0.0.5"
                  className={cn(
                    inputCls,
                    validation.errors.server && server.length > 0 && 'border-red-500/50',
                  )}
                />
                {validation.errors.server && server.length > 0 && (
                  <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {validation.errors.server}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Export path</label>
                <input
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  placeholder="/volume1/proxmox"
                  className={cn(
                    inputCls,
                    validation.errors.export && exportPath.length > 0 && 'border-red-500/50',
                  )}
                />
                {validation.errors.export && exportPath.length > 0 && (
                  <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                    <AlertCircle className="w-3 h-3" />
                    {validation.errors.export}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Dynamic — CIFS */}
          {type === 'cifs' && (
            <>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Server</label>
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="10.0.0.5"
                  className={cn(
                    inputCls,
                    validation.errors.server && server.length > 0 && 'border-red-500/50',
                  )}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Share name</label>
                <input
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                  placeholder="proxmox"
                  className={cn(
                    inputCls,
                    validation.errors.share && share.length > 0 && 'border-red-500/50',
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Username (optional)</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="proxmox"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Password (optional)</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••"
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}

          {/* Dynamic — Directory */}
          {type === 'dir' && (
            <div>
              <label className="text-xs text-gray-500 block mb-1">Local path</label>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/mnt/external"
                className={cn(
                  inputCls,
                  validation.errors.path && path.length > 0 && 'border-red-500/50',
                )}
              />
              {validation.errors.path && path.length > 0 && (
                <p className="flex items-center gap-1 text-[11px] text-red-400 mt-1">
                  <AlertCircle className="w-3 h-3" />
                  {validation.errors.path}
                </p>
              )}
              <p className="text-[11px] text-gray-600 mt-1">
                The path must already exist on every node in the cluster.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white bg-gray-800 rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={() => createM.mutate()}
            disabled={!validation.ok || createM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createM.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Map Storage
          </button>
        </div>
      </div>
    </div>
  );
}
