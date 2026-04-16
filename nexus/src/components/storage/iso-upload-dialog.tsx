'use client';

import { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useToast } from '@/components/ui/toast';
import { Loader2, Upload, Link2, FileUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IsoUploadParams, DownloadUrlParams } from '@/types/proxmox';

interface IsoUploadDialogProps {
  node: string;
  storage: string;
  defaultContent?: 'iso' | 'vztmpl';
  onClose: () => void;
  onComplete: () => void;
}

export function IsoUploadDialog({ node, storage, defaultContent = 'iso', onClose, onComplete }: IsoUploadDialogProps) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'upload' | 'url'>('upload');
  const [content, setContent] = useState<'iso' | 'vztmpl'>(defaultContent);
  const [file, setFile] = useState<File | null>(null);
  const [filename, setFilename] = useState('');
  const [progress, setProgress] = useState(0);
  const [url, setUrl] = useState('');
  const [urlFilename, setUrlFilename] = useState('');
  const [checksum, setChecksum] = useState('');
  const [checksumAlg, setChecksumAlg] = useState<'sha256' | 'sha512' | 'md5' | 'sha1' | 'sha224' | 'sha384'>('sha256');

  const inputCls = 'w-full px-3 py-2 bg-zinc-800 border border-zinc-800/60 rounded-lg text-sm text-zinc-200 focus:outline-none focus:border-zinc-300/50';

  const uploadM = useMutation({
    mutationFn: (params: IsoUploadParams) => api.storage.upload(params, setProgress),
    onSuccess: () => {
      toast.success('Upload complete', `${filename} stored on ${storage}.`);
      onComplete();
    },
    onError: (err) => {
      setProgress(0);
      toast.error('Upload failed', err instanceof Error ? err.message : String(err));
    },
  });

  const downloadM = useMutation({
    mutationFn: (params: DownloadUrlParams) => api.storage.downloadUrl(params),
    onSuccess: () => {
      toast.success('Download queued', 'PVE is fetching the file — watch Tasks for progress.');
      onComplete();
    },
    onError: (err) => toast.error('Download failed', err instanceof Error ? err.message : String(err)),
  });

  const chooseFile = (f: File | null) => {
    setFile(f);
    if (f && !filename) setFilename(f.name);
  };

  const submitUpload = () => {
    if (!file || !filename) return;
    uploadM.mutate({ node, storage, content, filename, file });
  };

  const submitDownload = () => {
    if (!url || !urlFilename) return;
    downloadM.mutate({
      node,
      storage,
      content,
      url,
      filename: urlFilename,
      ...(checksum ? { checksum, 'checksum-algorithm': checksumAlg } : {}),
    });
  };

  const isPending = uploadM.isPending || downloadM.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="studio-card p-6 w-full max-w-lg shadow-2xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Upload to {storage}</h3>
            <p className="text-xs text-zinc-500 mt-0.5">ISO images or LXC templates</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white p-1" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg w-fit mb-4">
          {(['upload', 'url'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition',
                mode === m ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {m === 'upload' ? <FileUp className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
              {m === 'upload' ? 'Upload file' : 'Download from URL'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Content type</label>
            <select value={content} onChange={(e) => setContent(e.target.value as 'iso' | 'vztmpl')} className={inputCls}>
              <option value="iso">ISO image</option>
              <option value="vztmpl">LXC template (vztmpl)</option>
            </select>
          </div>

          {mode === 'upload' ? (
            <>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">File</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept={content === 'iso' ? '.iso,.img' : '.tar.gz,.tar.xz,.tar.zst,.tgz'}
                  onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                  className={cn(inputCls, 'file:mr-3 file:px-2 file:py-0.5 file:rounded-md file:border-0 file:bg-zinc-800 file:text-zinc-200 file:text-xs cursor-pointer')}
                />
                {file && (
                  <p className="text-xs text-zinc-500 mt-1">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Destination filename</label>
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="my-image.iso"
                  className={inputCls}
                />
              </div>
              {progress > 0 && progress < 100 && (
                <div>
                  <div className="flex justify-between text-xs text-zinc-500 mb-1">
                    <span>Uploading…</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-100 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500 block mb-1">Destination filename</label>
                <input
                  value={urlFilename}
                  onChange={(e) => setUrlFilename(e.target.value)}
                  placeholder="ubuntu-24.04.iso"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Checksum (optional)</label>
                  <input
                    value={checksum}
                    onChange={(e) => setChecksum(e.target.value)}
                    placeholder="sha256 hex digest"
                    className={cn(inputCls, 'font-mono text-xs')}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Algorithm</label>
                  <select value={checksumAlg} onChange={(e) => setChecksumAlg(e.target.value as typeof checksumAlg)} className={inputCls}>
                    <option value="sha256">sha256</option>
                    <option value="sha512">sha512</option>
                    <option value="md5">md5</option>
                    <option value="sha1">sha1</option>
                    <option value="sha224">sha224</option>
                    <option value="sha384">sha384</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-zinc-600">PVE downloads the file server-side — no browser upload, fast for large images.</p>
            </>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} disabled={isPending} className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 rounded-lg transition disabled:opacity-40">
            Cancel
          </button>
          <button
            onClick={mode === 'upload' ? submitUpload : submitDownload}
            disabled={
              isPending ||
              (mode === 'upload' ? !file || !filename : !url || !urlFilename)
            }
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-zinc-100 hover:bg-white text-white rounded-lg transition disabled:opacity-40"
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {mode === 'upload' ? 'Upload' : 'Queue download'}
          </button>
        </div>
      </div>
    </div>
  );
}
