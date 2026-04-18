'use client';

/**
 * /console/vnc — embedded graphical console.
 *
 * Previously this page redirected to https://<pveHost>:8006/?novnc=1, which
 * broke the moment the browser wasn't on the same LAN as the PVE host
 * (Cloudflare Tunnel, remote WAN, VPN-only Mac, etc.). The redirect also
 * required the user to log in to PVE's own UI every time.
 *
 * The current implementation renders a <VncConsole /> that opens a same-
 * origin WebSocket to /api/ws-relay, which the Nexus server bridges to
 * pveproxy's vncwebsocket endpoint with a one-shot vncproxy ticket. The
 * browser never contacts :8006 directly, so the console works everywhere
 * Nexus itself is reachable.
 */

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { VncConsole } from '@/components/console/vnc-console';

const VALID_TYPES = new Set(['qemu', 'lxc'] as const);
type VncTargetType = 'qemu' | 'lxc';

export default function VncConsolePage() {
  const params = useSearchParams();
  const node = params.get('node');
  const vmidRaw = params.get('vmid');
  const typeRaw = params.get('type');

  const vmid = vmidRaw ? Number.parseInt(vmidRaw, 10) : NaN;
  const missing =
    !node ||
    !vmidRaw ||
    Number.isNaN(vmid) ||
    !typeRaw ||
    !VALID_TYPES.has(typeRaw as VncTargetType);

  if (missing) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <div className="studio-card rounded-lg p-5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <h1 className="text-sm font-semibold text-red-300 mb-1">Cannot open graphical console</h1>
            <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">
              Missing or invalid <span className="font-mono">node</span>,{' '}
              <span className="font-mono">vmid</span>, or <span className="font-mono">type</span>{' '}
              (must be <span className="font-mono">qemu</span> or{' '}
              <span className="font-mono">lxc</span>).
            </p>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1 mt-3 text-xs text-indigo-300 hover:text-indigo-200"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const type = typeRaw as VncTargetType;

  return (
    <div className="h-[calc(100dvh-theme(spacing.16))] flex flex-col p-4 gap-3">
      <header className="flex items-center gap-2">
        <Link
          href={`/dashboard/${type === 'qemu' ? 'vms' : 'cts'}/${node}/${vmid}`}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)]
                     rounded-md hover:bg-zinc-800/60
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </Link>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-[var(--color-fg)] truncate">
            Graphical console · <span className="font-mono">{type === 'qemu' ? 'VM' : 'CT'} {vmid}</span>
          </h1>
          <p className="text-[11px] text-[var(--color-fg-subtle)] font-mono truncate">node: {node}</p>
        </div>
      </header>

      <VncConsole node={node!} vmid={vmid} type={type} className="flex-1 min-h-0" />
    </div>
  );
}
