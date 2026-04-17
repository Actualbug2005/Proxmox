'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { TabBar } from '@/components/dashboard/tab-bar';
import { StorageContentTable } from '@/components/storage/storage-content-table';
import { IsoUploadDialog } from '@/components/storage/iso-upload-dialog';
import { ChevronLeft, Upload, HardDrive } from 'lucide-react';
import { formatBytes } from '@/lib/utils';
import type { StorageContentType } from '@/types/proxmox';

type ContentTab = 'iso' | 'vztmpl' | 'backup' | 'images' | 'snippets';

const TAB_LABELS: Record<ContentTab, string> = {
  iso: 'ISO images',
  vztmpl: 'CT templates',
  backup: 'Backups',
  images: 'Disk images',
  snippets: 'Snippets',
};

export default function StorageDetailPage({
  params,
}: {
  params: Promise<{ node: string; storage: string }>;
}) {
  const { node, storage } = use(params);
  const [tab, setTab] = useState<ContentTab>('iso');
  const [showUpload, setShowUpload] = useState(false);

  const { data: storages } = useQuery({
    queryKey: ['storage', node, 'list'],
    queryFn: () => api.storage.list(node),
  });
  const meta = storages?.find((s) => s.storage === storage);

  const contentSupported = (meta?.content ?? '').split(',').map((s) => s.trim());

  const tabs: { id: ContentTab; label: string }[] = (Object.keys(TAB_LABELS) as ContentTab[])
    .filter((t) => contentSupported.includes(t))
    .map((t) => ({ id: t, label: TAB_LABELS[t] }));

  // If the current tab is not supported by this storage, switch to the first supported one.
  if (tabs.length > 0 && !tabs.find((t) => t.id === tab)) {
    setTab(tabs[0].id);
  }

  const { data: items, isLoading } = useQuery({
    queryKey: ['storage-content', node, storage, tab],
    queryFn: () => api.storage.contentByType(node, storage, tab as StorageContentType),
    enabled: tabs.some((t) => t.id === tab),
  });

  const canUpload = tab === 'iso' || tab === 'vztmpl';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <Link href="/dashboard/storage" className="flex items-center gap-1 text-zinc-500 hover:text-zinc-300 transition">
          <ChevronLeft className="w-3.5 h-3.5" />
          Storage
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-zinc-300">{storage}</span>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-zinc-800 border border-zinc-800/60 flex items-center justify-center">
            <HardDrive className="w-5 h-5 text-zinc-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{storage}</h1>
            <p className="text-sm text-zinc-500">
              {meta?.type}
              {typeof meta?.total === 'number' && typeof meta?.used === 'number' && (
                <> · {formatBytes(meta.used)} of {formatBytes(meta.total)} used</>
              )}
              <span className="ml-1 text-zinc-600">· node <span className="font-mono">{node}</span></span>
            </p>
          </div>
        </div>
        {canUpload && (
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-300 hover:bg-zinc-200 text-zinc-900 text-sm rounded-lg transition"
          >
            <Upload className="w-4 h-4" />
            Upload
          </button>
        )}
      </div>

      {showUpload && (
        <IsoUploadDialog
          node={node}
          storage={storage}
          defaultContent={tab === 'vztmpl' ? 'vztmpl' : 'iso'}
          onClose={() => setShowUpload(false)}
          onComplete={() => setShowUpload(false)}
        />
      )}

      {tabs.length === 0 ? (
        <div className="studio-card p-8 text-center text-sm text-zinc-500">
          This storage is not configured for any browsable content types.
        </div>
      ) : (
        <>
          <TabBar tabs={tabs} value={tab} onChange={setTab} />
          <StorageContentTable
            node={node}
            storage={storage}
            items={items}
            isLoading={isLoading}
            emptyTitle={`No ${TAB_LABELS[tab].toLowerCase()} yet`}
            emptyDescription={canUpload ? 'Use the Upload button to add one.' : undefined}
          />
        </>
      )}
    </div>
  );
}
