'use client';

/**
 * Map Storage dialog — POSTs to PVE's cluster-wide /storage endpoint to
 * register a new storage pool (NFS / CIFS / local directory), or PUTs to
 * /storage/{id} to edit one. Once created, the pool propagates to every
 * node PVE replicates config to and can back VM disks, ISOs, CT templates,
 * or backups depending on the content types the user ticks.
 *
 * Payload shape matches the PVE API exactly:
 *   • `content` is a comma-joined string — PVE parses it on the server side.
 *   • `export` uses its reserved-word spelling because that's the literal
 *     PVE parameter name for the NFS export path.
 *   • `mkdir` is coerced to PVE's 0|1 integer convention.
 *   • `nodes` is a comma-joined subset of node names, or omitted entirely
 *     to leave the pool cluster-wide.
 *
 * Edit mode (existingStorage provided) disables topology fields — PVE
 * rejects those changes and requires delete+recreate to rename a server
 * or change an export path.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Loader2, AlertCircle, HardDrive, ChevronDown } from 'lucide-react';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type {
  PVEStorageConfigPublic,
  StorageBackendType,
  StorageCreatePayloadPublic,
  StorageUpdatePayloadPublic,
} from '@/types/proxmox';

interface Props {
  onClose: () => void;
  onMapped: () => void;
  /** Available node names for the optional node restriction. Omitted → no checkbox list. */
  nodeNames?: string[];
  /** When supplied the dialog opens in edit mode — topology fields get disabled
   *  and the submit button PUTs to /storage/{id} instead of POSTing to /storage. */
  existingStorage?: PVEStorageConfigPublic;
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

/** SMB dialect selector values. 'default' → omit the param and let PVE pick. */
const SMB_VERSIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'default', label: 'Default (auto-negotiate)' },
  { value: '2.0', label: 'SMB 2.0' },
  { value: '2.1', label: 'SMB 2.1' },
  { value: '3.0', label: 'SMB 3.0' },
];

function parseContentString(s: string | undefined): Set<ContentId> {
  if (!s) return new Set();
  const ids = new Set<ContentId>();
  for (const part of s.split(',')) {
    const trimmed = part.trim() as ContentId;
    if (CONTENT_OPTIONS.some((o) => o.id === trimmed)) ids.add(trimmed);
  }
  return ids;
}

function parseNodes(s: string | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(s.split(',').map((x) => x.trim()).filter(Boolean));
}

export function MapStorageDialog({ onClose, onMapped, nodeNames = [], existingStorage }: Props) {
  const toast = useToast();
  const isEdit = Boolean(existingStorage);

  // Common
  const [storageId, setStorageId] = useState(existingStorage?.storage ?? '');
  const [type, setType] = useState<StorageBackendType>(existingStorage?.type ?? 'nfs');
  const [content, setContent] = useState<Set<ContentId>>(
    existingStorage ? parseContentString(existingStorage.content) : new Set(['iso']),
  );

  // Dynamic — all start empty; unused fields for the current type are ignored
  const [server, setServer] = useState(existingStorage?.server ?? '');
  const [exportPath, setExportPath] = useState(existingStorage?.export ?? '');
  const [share, setShare] = useState(existingStorage?.share ?? '');
  const [username, setUsername] = useState(existingStorage?.username ?? '');
  const [password, setPassword] = useState('');
  const [path, setPath] = useState(existingStorage?.path ?? '');

  // Node restriction
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(parseNodes(existingStorage?.nodes));

  // Advanced options
  const [mountOptions, setMountOptions] = useState(existingStorage?.options ?? '');
  const [smbVersion, setSmbVersion] = useState(existingStorage?.smbversion ?? 'default');
  // `mkdir` defaults to true (PVE's own default when the param is omitted).
  const [mkdir, setMkdir] = useState<boolean>(existingStorage?.mkdir ?? true);
  const [advancedOpen, setAdvancedOpen] = useState(false);

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

  function toggleNode(name: string) {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /** Build the PVE payload, honouring the "omit nodes when all/none selected"
   *  rule and coercing our React booleans to PVE's 0|1 integer form. Shared
   *  between create and update so the diff is kept to a single branch. */
  function buildPayload(): StorageCreatePayloadPublic {
    const contentStr = CONTENT_OPTIONS.filter((o) => content.has(o.id))
      .map((o) => o.id)
      .join(',');

    const payload: StorageCreatePayloadPublic = {
      storage: storageId,
      type,
      content: contentStr,
    };

    // Node restriction: omit entirely when the user leaves every box unticked
    // (cluster-wide) or ticks every available node (logically equivalent).
    if (
      nodeNames.length > 0 &&
      selectedNodes.size > 0 &&
      selectedNodes.size < nodeNames.length
    ) {
      payload.nodes = nodeNames.filter((n) => selectedNodes.has(n)).join(',');
    }

    if (type === 'nfs') {
      payload.server = server.trim();
      payload.export = exportPath.trim();
      if (mountOptions.trim()) payload.options = mountOptions.trim();
    } else if (type === 'cifs') {
      payload.server = server.trim();
      payload.share = share.trim();
      if (username.trim()) payload.username = username.trim();
      if (password) payload.password = password;
      if (smbVersion !== 'default') payload.smbversion = smbVersion;
    } else if (type === 'dir') {
      payload.path = path.trim();
      payload.mkdir = mkdir;
    }

    return payload;
  }

  const submitM = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      if (isEdit && existingStorage) {
        // PVE rejects `storage` and `type` on PUT — strip before sending.
        const { storage: _s, type: _t, ...patch } = payload;
        void _s;
        void _t;
        return api.storage.update(existingStorage.storage, patch as StorageUpdatePayloadPublic);
      }
      return api.storage.create(payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Storage updated' : 'Storage mapped', storageId);
      onMapped();
    },
    onError: (err) => {
      toast.error(
        isEdit ? 'Update failed' : 'Map failed',
        err instanceof Error ? err.message : String(err),
      );
    },
  });

  const inputCls =
    'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50 font-mono disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="studio-card w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)] shrink-0">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[var(--color-fg-subtle)]" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                {isEdit ? 'Edit storage' : 'Map storage'}
              </h2>
              <p className="text-xs text-[var(--color-fg-subtle)]">
                {isEdit ? 'Update an existing pool' : 'Add a cluster-wide storage pool'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (scrolls if fields overflow the viewport) */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Storage ID */}
          <div>
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Storage ID</label>
            <input
              value={storageId}
              onChange={(e) => setStorageId(e.target.value.toLowerCase())}
              placeholder="nas-media"
              maxLength={40}
              disabled={isEdit}
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
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as StorageBackendType)}
              disabled={isEdit}
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
            <label className="text-xs text-[var(--color-fg-subtle)] block mb-2">Content</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {CONTENT_OPTIONS.map((c) => (
                <label
                  key={c.id}
                  className="flex items-start gap-2 p-2 bg-gray-950/40 border border-[var(--color-border-subtle)] rounded-lg cursor-pointer hover:border-[var(--color-border-subtle)] transition"
                >
                  <input
                    type="checkbox"
                    checked={content.has(c.id)}
                    onChange={() => toggleContent(c.id)}
                    className="w-4 h-4 accent-zinc-100 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--color-fg-secondary)]">{c.label}</p>
                    <p className="text-[10px] text-[var(--color-fg-subtle)]">{c.hint}</p>
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

          {/* Node restriction */}
          {nodeNames.length > 0 && (
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-2">
                Restrict to nodes{' '}
                <span className="text-[var(--color-fg-faint)]">
                  (leave empty or tick all for cluster-wide)
                </span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {nodeNames.map((n) => (
                  <label
                    key={n}
                    className="flex items-center gap-2 p-2 bg-gray-950/40 border border-[var(--color-border-subtle)] rounded-lg cursor-pointer hover:border-[var(--color-border-subtle)] transition"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNodes.has(n)}
                      onChange={() => toggleNode(n)}
                      className="w-4 h-4 accent-zinc-100 shrink-0"
                    />
                    <span className="text-xs text-[var(--color-fg-secondary)] font-mono truncate">{n}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Dynamic — NFS */}
          {type === 'nfs' && (
            <>
              <div>
                <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Server</label>
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="10.0.0.5"
                  disabled={isEdit}
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
                <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Export path</label>
                <input
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  placeholder="/volume1/proxmox"
                  disabled={isEdit}
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
                <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Server</label>
                <input
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="10.0.0.5"
                  disabled={isEdit}
                  className={cn(
                    inputCls,
                    validation.errors.server && server.length > 0 && 'border-red-500/50',
                  )}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Share name</label>
                <input
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                  placeholder="proxmox"
                  disabled={isEdit}
                  className={cn(
                    inputCls,
                    validation.errors.share && share.length > 0 && 'border-red-500/50',
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Username (optional)</label>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="proxmox"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Password (optional)</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={isEdit ? '(unchanged)' : '••••••'}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}

          {/* Dynamic — Directory */}
          {type === 'dir' && (
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Local path</label>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/mnt/external"
                disabled={isEdit}
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
              <p className="text-[11px] text-[var(--color-fg-faint)] mt-1">
                The path must already exist on every node in the cluster.
              </p>
            </div>
          )}

          {/* Advanced options — collapsed by default; content varies by backend. */}
          <details
            open={advancedOpen}
            onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
            className="border border-[var(--color-border-subtle)] rounded-lg bg-gray-950/40 overflow-hidden group"
          >
            <summary className="flex items-center justify-between px-3 py-2 cursor-pointer text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)] transition select-none">
              <span>Advanced options</span>
              <ChevronDown className="w-3.5 h-3.5 transition group-open:rotate-180" />
            </summary>
            <div className="px-3 pb-3 pt-1 space-y-3">
              {type === 'nfs' && (
                <div>
                  <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Mount options</label>
                  <input
                    value={mountOptions}
                    onChange={(e) => setMountOptions(e.target.value)}
                    placeholder="vers=4.2,soft"
                    className={inputCls}
                  />
                  <p className="text-[11px] text-[var(--color-fg-faint)] mt-1">
                    Comma-separated mount(8) flags forwarded to the NFS client.
                  </p>
                </div>
              )}

              {type === 'cifs' && (
                <div>
                  <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">SMB version</label>
                  <select
                    value={smbVersion}
                    onChange={(e) => setSmbVersion(e.target.value)}
                    className={cn(inputCls, 'font-sans')}
                  >
                    {SMB_VERSIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {type === 'dir' && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mkdir}
                    onChange={(e) => setMkdir(e.target.checked)}
                    className="w-4 h-4 accent-zinc-100 mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--color-fg-secondary)]">Create subdirectories</p>
                    <p className="text-[10px] text-[var(--color-fg-subtle)]">
                      Auto-create content-type folders (images/, iso/, …) under the path.
                    </p>
                  </div>
                </label>
              )}

              {type !== 'nfs' && type !== 'cifs' && type !== 'dir' && (
                <p className="text-xs text-[var(--color-fg-faint)]">No advanced options for this backend.</p>
              )}
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex gap-3 justify-end px-5 py-4 border-t border-[var(--color-border-subtle)] shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--color-fg-muted)] hover:text-white bg-[var(--color-overlay)] rounded-lg transition"
          >
            Cancel
          </button>
          <button
            onClick={() => submitM.mutate()}
            disabled={!validation.ok || submitM.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitM.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Map Storage'}
          </button>
        </div>
      </div>
    </div>
  );
}
