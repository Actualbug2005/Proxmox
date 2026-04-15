'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, ExternalLink, AlertCircle } from 'lucide-react';

interface Session {
  proxmoxHost: string;
}

export default function VncConsolePage() {
  const params = useSearchParams();
  const [err, setErr] = useState('');
  const [url, setUrl] = useState('');

  const node = params.get('node');
  const vmid = params.get('vmid');
  const type = params.get('type');

  useEffect(() => {
    if (!node || !vmid || !type) {
      setErr('Missing node, vmid, or type query params.');
      return;
    }
    fetch('/api/auth/session', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('Not authenticated');
        return r.json();
      })
      .then((s: Session) => {
        const host = s.proxmoxHost;
        const consoleType = type === 'qemu' ? 'kvm' : 'lxc';
        const target = `https://${host}:8006/?console=${consoleType}&vmid=${vmid}&node=${node}&novnc=1`;
        setUrl(target);
        window.location.replace(target);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [node, vmid, type]);

  return (
    <div className="flex items-center justify-center h-screen bg-gray-950 text-gray-300">
      <div className="max-w-md px-6 py-8 bg-gray-900 border border-gray-800 rounded-2xl text-center space-y-4">
        {err ? (
          <>
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
            <h1 className="text-lg font-semibold text-white">Cannot open graphical console</h1>
            <p className="text-sm text-gray-400">{err}</p>
          </>
        ) : (
          <>
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin mx-auto" />
            <h1 className="text-lg font-semibold text-white">Opening graphical console…</h1>
            <p className="text-sm text-gray-500">
              Redirecting to Proxmox native noVNC client. You may be asked to log in to PVE directly if this is the first time.
            </p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
              >
                <ExternalLink className="w-4 h-4" />
                Open manually
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
