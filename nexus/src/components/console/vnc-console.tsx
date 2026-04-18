'use client';

/**
 * Graphical (noVNC) console component.
 *
 * Mirrors the flow of the text `Terminal` component but speaks the VNC (RFB)
 * protocol instead of PVE termproxy:
 *
 *   1. POST /api/proxmox-ws { mode: "vnc", node, vmid, type }
 *      → server acquires a PVE vncproxy ticket and eagerly opens a server-
 *        side WebSocket to pveproxy's vncwebsocket endpoint before the
 *        10 s ticket TTL expires.
 *   2. We join the already-open PVE connection via our /api/ws-relay
 *      WebSocket. Production uses secure WebSockets (wss://) because
 *      Caddy / Cloudflare Tunnel terminates TLS at the edge; local
 *      `next dev` over plain HTTP is the only non-TLS case, and the
 *      scheme flip is picked from window.location.protocol at runtime.
 *   3. We hand that URL to @novnc/novnc's RFB class, which opens its own
 *      WebSocket to /api/ws-relay and drives the canvas lifecycle itself
 *      (RFB handshake, pixel updates, input events). Our relay is
 *      protocol-agnostic — identical infrastructure as xterm uses.
 *
 * This keeps the entire console traffic same-origin so Cloudflare Tunnel
 * covers it without any extra exposure of PVE's :8006.
 */

import RFB from '@novnc/novnc/lib/rfb';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Power,
  Keyboard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readCsrfCookie } from '@/lib/proxmox-client';

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

interface VncConsoleProps {
  node: string;
  vmid: number;
  type: 'qemu' | 'lxc';
  className?: string;
}

export function VncConsole({ node, vmid, type, className }: VncConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const qc = useQueryClient();

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError('');

    // Tear down any previous RFB instance before reconnecting; leaking one
    // would keep a dangling WebSocket open to the relay.
    if (rfbRef.current) {
      try { rfbRef.current.disconnect(); } catch { /* already dead */ }
      rfbRef.current = null;
    }

    try {
      const csrf = readCsrfCookie();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrf) headers['X-Nexus-CSRF'] = csrf;

      const res = await fetch('/api/proxmox-ws', {
        method: 'POST',
        headers,
        body: JSON.stringify({ node, vmid, type, mode: 'vnc' }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Failed to get VNC ticket (HTTP ${res.status})`);
      }
      const { sessionId, vncTicket } = (await res.json()) as {
        sessionId: string;
        vncTicket?: string;
      };

      if (!containerRef.current) return;

      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const relayUrl = `${wsProto}://${window.location.host}/api/ws-relay?session=${encodeURIComponent(sessionId)}`;

      // RFB's constructor accepts either a pre-opened WebSocket or a URL
      // string — passing the URL lets it manage the lifecycle itself
      // (including clean reconnects when the user clicks Refresh).
      //
      // `wsProtocols: ['binary']` matches the subprotocol pveproxy's
      // vncwebsocket advertises; without the match, the WS upgrade is
      // rejected with 1002. The same protocol is negotiated on the
      // server-side connection in server.ts.
      //
      // `credentials.password`: PVE's inner RFB stream uses VNC Auth with
      // the vncticket as the password (truncated to 8 bytes per VNC Auth
      // spec). Without this, noVNC reaches the security challenge step
      // and waits indefinitely for credentials it was never given.
      // Diagnosed from byte-level relay logging in v0.4.3 (pveTx=30,
      // clientTx=13: banner + selection + 16-byte challenge, no response).
      const rfb = new RFB(containerRef.current, relayUrl, {
        wsProtocols: ['binary'],
        ...(vncTicket
          ? { credentials: { password: vncTicket.slice(0, 8) } }
          : {}),
      });
      // Scale the remote framebuffer to fit our container instead of
      // showing scrollbars — this is what PVE's built-in noVNC does, and
      // it matches user intuition for a "viewer" tab.
      rfb.scaleViewport = true;
      // Let the user resize the guest's desktop to match our viewport when
      // the guest agent supports it (QEMU with a resize-capable driver,
      // LXC with a framebuffer). Fallback is to letterbox via scaling.
      rfb.resizeSession = true;
      // Focus the canvas on click so keyboard events reach the guest.
      rfb.focusOnClick = true;

      // Watchdog: noVNC's WebSocket can fire `error` without a subsequent
      // `close` when the handshake fails in CONNECTING state (seen with
      // subprotocol mismatches and some edge proxies). That leaves us
      // stuck in "Connecting…" forever. If no `connect` event within 15s,
      // force an error state so the user at least sees something actionable.
      const watchdog = setTimeout(() => {
        if (rfbRef.current === rfb) {
          setStatus((prev) => {
            if (prev === 'connecting') {
              setError('Timed out waiting for the VNC handshake. Check Nexus logs for WebSocket relay errors (journalctl -u nexus).');
              try { rfb.disconnect(); } catch { /* already dead */ }
              return 'error';
            }
            return prev;
          });
        }
      }, 15_000);

      rfb.addEventListener('connect', () => {
        clearTimeout(watchdog);
        setStatus('connected');
      });
      rfb.addEventListener('disconnect', (e: Event) => {
        clearTimeout(watchdog);
        // noVNC dispatches a custom `disconnect` event whose `detail.clean`
        // tells us whether the server closed cleanly or we lost the link.
        const detail = (e as CustomEvent<{ clean: boolean; reason?: string }>).detail;
        if (detail && detail.clean === false) {
          setStatus('error');
          setError(detail.reason ?? 'Connection lost');
        } else {
          setStatus('disconnected');
        }
      });
      rfb.addEventListener('securityfailure', (e: Event) => {
        clearTimeout(watchdog);
        setStatus('error');
        const detail = (e as CustomEvent<{ reason?: string }>).detail;
        setError(detail?.reason ?? 'VNC authentication failed');
      });

      rfbRef.current = rfb;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Connection failed');
      // Mirror the terminal: a failed console might mean the VM/CT vanished
      // since the last cluster-resources poll. Force a refetch so ghost rows
      // don't linger on the dashboard.
      qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
    }
  }, [node, vmid, type, qc]);

  // Connect on mount / whenever target identity changes. We tear down any
  // existing RFB via the cleanup callback, not inside `connect` — that keeps
  // the "reconnect" button (which also calls `connect`) from double-closing.
  useEffect(() => {
    void connect();
    return () => {
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch { /* already dead */ }
        rfbRef.current = null;
      }
    };
  }, [connect]);

  function toggleFullscreen() {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {});
    }
  }

  function sendCtrlAltDel() {
    rfbRef.current?.sendCtrlAltDel();
  }

  return (
    <div
      className={cn(
        'relative flex flex-col min-h-0 bg-black rounded-lg overflow-hidden border border-[var(--color-border-subtle)]',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-[var(--color-border-subtle)] bg-zinc-950/80">
        <div className="flex items-center gap-2 min-w-0 text-[11px]">
          <StatusChip status={status} />
          <span className="text-[var(--color-fg-subtle)] font-mono truncate">
            {type} {vmid} @ {node}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <ToolbarButton onClick={sendCtrlAltDel} disabled={status !== 'connected'} label="Ctrl-Alt-Del">
            <Keyboard className="w-3.5 h-3.5" />
            <span>Ctrl+Alt+Del</span>
          </ToolbarButton>
          <ToolbarButton onClick={connect} disabled={status === 'connecting'} label="Reconnect">
            <RefreshCw className={cn('w-3.5 h-3.5', status === 'connecting' && 'animate-spin')} />
          </ToolbarButton>
          <ToolbarButton onClick={toggleFullscreen} label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </ToolbarButton>
        </div>
      </div>

      {/* Canvas area — noVNC RFB attaches its <canvas> as a child of this div */}
      <div ref={containerRef} className="flex-1 min-h-0 relative bg-black">
        {(status === 'connecting' || status === 'idle') && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 pointer-events-none">
            <div className="flex items-center gap-2 text-[var(--color-fg-muted)] text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting…
            </div>
          </div>
        )}
        {status === 'error' && error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-md studio-card rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium text-red-300">Console unavailable</p>
                <p className="text-xs text-[var(--color-fg-muted)] leading-relaxed">{error}</p>
                <button
                  onClick={connect}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-zinc-700
                             text-[var(--color-fg-secondary)] text-xs rounded-md transition
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
                >
                  <RefreshCw className="w-3 h-3" />
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
        {status === 'disconnected' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center space-y-3">
              <Power className="w-6 h-6 text-[var(--color-fg-subtle)] mx-auto" />
              <p className="text-sm text-[var(--color-fg-muted)]">Disconnected</p>
              <button
                onClick={connect}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-zinc-700
                           text-[var(--color-fg-secondary)] text-xs rounded-md transition
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
              >
                <RefreshCw className="w-3 h-3" />
                Reconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: Status }) {
  const label = status === 'idle' ? 'Ready' : status.charAt(0).toUpperCase() + status.slice(1);
  const colour =
    status === 'connected'
      ? 'bg-emerald-500'
      : status === 'connecting'
        ? 'bg-amber-500 animate-pulse'
        : status === 'error'
          ? 'bg-red-500'
          : 'bg-zinc-600';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', colour)} />
      <span className="text-[var(--color-fg-secondary)]">{label}</span>
    </span>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]
                 text-[var(--color-fg-muted)] hover:text-[var(--color-fg-secondary)] hover:bg-zinc-800/80
                 disabled:opacity-40 disabled:cursor-not-allowed
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300"
    >
      {children}
    </button>
  );
}
