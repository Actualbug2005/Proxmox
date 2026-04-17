'use client';

/**
 * File browser slide-out for a registered NAS share.
 *
 * Navigates one directory level at a time via GET /api/nas/browse, and
 * downloads files via GET /api/nas/download. Both endpoints defend against
 * traversal on the server — this component just has to render what comes
 * back and hand the user's clicks into subPaths.
 *
 * Memory note: downloads go through `res.blob()`, which buffers the whole
 * file into the browser's V8 isolate before the Save dialog shows. Fine for
 * typical NAS content (documents, photos, short videos); for multi-GB files,
 * swap to a plain `<a href="/api/nas/download?...">` that streams directly to
 * disk. We always `URL.revokeObjectURL` in a try/finally so the blob URL
 * never leaks regardless of success or failure.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Folder,
  File as FileIcon,
  Link as LinkIcon,
  Download,
  Loader2,
  X,
  ChevronRight,
  Home,
  AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { formatBytes, cn } from '@/lib/utils';
import type { FileNode } from '@/types/nas';

interface Props {
  node: string;
  shareId: string;
  shareName: string;
  onClose: () => void;
}

function formatMtime(mtime: number): string {
  if (!mtime) return '—';
  return new Date(mtime * 1000).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FileBrowserSheet({ node, shareId, shareName, onClose }: Props) {
  const toast = useToast();
  const [currentPath, setCurrentPath] = useState<string>('');
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const { data: files, isLoading, error } = useQuery({
    queryKey: ['nas-browse', node, shareId, currentPath],
    queryFn: () => api.nas.browse(node, shareId, currentPath),
    enabled: !!shareId,
  });

  const segments = useMemo(
    () => (currentPath ? currentPath.split('/') : []),
    [currentPath],
  );

  // Dirs first, then files, then symlinks — each group alphabetised.
  const sorted = useMemo<FileNode[]>(() => {
    const order: Record<FileNode['type'], number> = { dir: 0, file: 1, symlink: 2 };
    return [...(files ?? [])].sort((a, b) => {
      if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
      return a.name.localeCompare(b.name);
    });
  }, [files]);

  function openDir(name: string) {
    setCurrentPath(currentPath ? `${currentPath}/${name}` : name);
  }

  function navigateToSegment(index: number) {
    if (index < 0) {
      setCurrentPath('');
    } else {
      setCurrentPath(segments.slice(0, index + 1).join('/'));
    }
  }

  async function handleDownload(file: FileNode) {
    setDownloadingPath(file.relativePath);
    try {
      const res = await api.nas.download(node, shareId, file.relativePath);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        // Runs on every path — success, a.click() rejection, or anything
        // else — so the blob URL never leaks.
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error('Download failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingPath(null);
    }
  }

  function iconFor(type: FileNode['type']) {
    if (type === 'dir') return <Folder className="w-4 h-4 text-blue-400" />;
    if (type === 'symlink') return <LinkIcon className="w-4 h-4 text-zinc-500" />;
    return <FileIcon className="w-4 h-4 text-zinc-400" />;
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="fixed right-0 top-0 h-full w-full max-w-3xl bg-zinc-900 border-l border-zinc-800/60 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/60">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate">{shareName}</h2>
            <p className="text-xs text-zinc-500">File browser · {node}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-zinc-800/60 text-xs overflow-x-auto">
          <button
            onClick={() => navigateToSegment(-1)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded-md transition',
              segments.length === 0
                ? 'text-indigo-400 bg-white/5'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
            )}
          >
            <Home className="w-3 h-3" />
            {shareName}
          </button>
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1">
              <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
              <button
                onClick={() => navigateToSegment(i)}
                className={cn(
                  'px-2 py-1 rounded-md transition font-mono',
                  i === segments.length - 1
                    ? 'text-indigo-400 bg-white/5'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800',
                )}
              >
                {seg}
              </button>
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 m-5 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-300">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Failed to list directory:{' '}
                {error instanceof Error ? error.message : String(error)}
              </span>
            </div>
          )}

          {!isLoading && !error && sorted.length === 0 && (
            <p className="text-sm text-zinc-600 py-16 text-center">
              This directory is empty.
            </p>
          )}

          {!isLoading && !error && sorted.length > 0 && (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800/60">
                <tr>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-8"></th>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium">Name</th>
                  <th className="text-right px-4 py-2.5 text-zinc-500 font-medium w-24">Size</th>
                  <th className="text-left px-4 py-2.5 text-zinc-500 font-medium w-48">Modified</th>
                  <th className="text-right px-4 py-2.5 text-zinc-500 font-medium w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f) => {
                  const isClickableDir = f.type === 'dir';
                  const isDownloadable = f.type === 'file';
                  const isDownloading = downloadingPath === f.relativePath;
                  return (
                    <tr
                      key={f.relativePath}
                      className={cn(
                        'border-b border-zinc-800/40 transition',
                        isClickableDir
                          ? 'hover:bg-zinc-800/40 cursor-pointer'
                          : 'hover:bg-zinc-800/20',
                        f.type === 'symlink' && 'opacity-50',
                      )}
                      onClick={isClickableDir ? () => openDir(f.name) : undefined}
                    >
                      <td className="px-4 py-2 text-center">{iconFor(f.type)}</td>
                      <td className="px-4 py-2 text-zinc-200 break-all">
                        {f.name}
                        {f.type === 'symlink' && (
                          <span className="ml-2 text-[10px] text-zinc-500">symlink</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-zinc-400">
                        {f.type === 'file' ? formatBytes(f.size) : '—'}
                      </td>
                      <td className="px-4 py-2 text-zinc-500">{formatMtime(f.mtime)}</td>
                      <td className="px-4 py-2 text-right">
                        {isDownloadable && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(f);
                            }}
                            disabled={isDownloading}
                            aria-label={`Download ${f.name}`}
                            className="p-1.5 text-zinc-500 hover:text-zinc-100 hover:bg-white/5 rounded-md transition disabled:opacity-40"
                          >
                            {isDownloading ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
