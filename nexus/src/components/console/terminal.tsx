'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Loader2, AlertCircle, Maximize2, Minimize2, RefreshCw, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hintForError } from '@/lib/task-hints';
import { readCsrfCookie } from '@/lib/proxmox-client';

interface TerminalProps {
  node: string;
  vmid?: number;
  type: 'qemu' | 'lxc' | 'node';
  className?: string;
}

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export function Terminal({ node, vmid, type, className }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  // Hint is recomputed only when the error string changes, not on every
  // render. Regex literals in lib/task-hints live at module scope.
  const hint = useMemo(() => hintForError(error), [error]);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError('');

    try {
      // Get WS ticket from our proxy. POST is a mutating verb, so the server-
      // side CSRF guard requires the X-Nexus-CSRF header to match the
      // nexus_csrf cookie set at login. Without it the proxy answers 403.
      const csrf = readCsrfCookie();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (csrf) headers['X-Nexus-CSRF'] = csrf;

      const res = await fetch('/api/proxmox-ws', {
        method: 'POST',
        headers,
        body: JSON.stringify({ node, vmid, type }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to get terminal ticket');
      }

      // Server has already opened the PVE WS connection — we just need the session ID
      const { sessionId } = await res.json();

      // Init xterm
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }

      const term = new XTerm({
        // allowTransparency lets the studio-card pane behind the
        // terminal show through — without it xterm paints an opaque
        // fallback background regardless of `theme.background`.
        allowTransparency: true,
        theme: {
          background: 'transparent',
          foreground: '#fafafa',                  // zinc-50
          cursor: '#fafafa',                       // zinc-50
          cursorAccent: '#09090b',                 // zinc-950 (text-on-cursor)
          selectionBackground: 'rgba(255, 255, 255, 0.2)',
          black: '#18181b',                        // zinc-900
          red: '#ef4444',                          // red-500
          green: '#10b981',                        // emerald-500
          yellow: '#f59e0b',                       // amber-500
          blue: '#3b82f6',                         // blue-500
          magenta: '#8b5cf6',                      // violet-500
          cyan: '#06b6d4',                         // cyan-500
          white: '#fafafa',                        // zinc-50
          brightBlack: '#27272a',                  // zinc-800
          brightRed: '#f87171',                    // red-400
          brightGreen: '#34d399',                  // emerald-400
          brightYellow: '#fbbf24',                 // amber-400
          brightBlue: '#60a5fa',                   // blue-400
          brightMagenta: '#a78bfa',                // violet-400
          brightCyan: '#22d3ee',                   // cyan-400
          brightWhite: '#fafafa',                  // zinc-50
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      const webLinksAddon = new WebLinksAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      fitAddonRef.current = fitAddon;

      if (containerRef.current) {
        term.open(containerRef.current);
        fitAddon.fit();
      }

      termRef.current = term;

      // Join the already-open PVE connection via our relay (plain ws://, no cert issues)
      const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const relayWsUrl = `${wsProto}://${window.location.host}/api/ws-relay?session=${encodeURIComponent(sessionId)}`;

      const ws = new WebSocket(relayWsUrl, ['binary']);
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('connected');
        // Tell PVE the terminal dimensions
        const { cols, rows } = term;
        ws.send(`1:${cols}:${rows}:`);
      };

      ws.onmessage = (event) => {
        // termproxy sends raw PTY bytes back — no framing prefix.
        // Only the client→server direction uses 0:len:data (input) and
        // 1:cols:rows: (resize) framing.
        if (event.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(event.data));
        } else if (typeof event.data === 'string') {
          term.write(event.data);
        }
      };

      ws.onerror = () => {
        setStatus('error');
        setError('WebSocket connection failed');
      };

      ws.onclose = (e) => {
        setStatus('disconnected');
        if (e.code !== 1000) {
          term.writeln('\r\n\x1b[33m[Connection closed]\x1b[0m');
        }
      };

      // Send terminal input — PVE termproxy format: "0:<len>:<data>"
      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`0:${data.length}:${data}`);
        }
      });

      // Send resize events
      term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`1:${cols}:${rows}:`);
        }
      });
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
      // Termproxy failed — the VM/CT may have been destroyed since the last
      // resource-tree poll. Force an immediate refetch so any ghost row
      // gets purged from the dashboard. Cheap fire-and-forget; the next
      // ['cluster','resources'] read picks up the fresh data.
      qc.invalidateQueries({ queryKey: ['cluster', 'resources'] });
    }
  }, [node, vmid, type, qc]);

  // Fit on container resize
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      termRef.current?.dispose();
    };
  }, []);

  return (
    <div
      className={cn(
        // No bg on the outer wrapper: the glass pane behind it provides
        // the chrome, and allowTransparency on the xterm canvas lets that
        // pane show through the terminal viewport. An opaque bg here
        // would defeat the transparency.
        'flex flex-col border border-[var(--color-border-subtle)] rounded-lg overflow-hidden',
        fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)] shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-err)]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-warn)]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-ok)]/60" />
          <span className="text-xs text-[var(--color-fg-subtle)] ml-2">
            {type === 'node' ? `${node} — Shell` : `${node}/${type}/${vmid} — Console`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              status === 'connected'
                ? 'text-[var(--color-ok)] bg-[var(--color-ok)]/10'
                : status === 'connecting'
                  ? 'text-blue-400 bg-blue-500/10'
                  : status === 'error'
                    ? 'text-[var(--color-err)] bg-[var(--color-err)]/10'
                    : 'text-[var(--color-fg-subtle)] bg-[var(--color-overlay)]',
            )}
          >
            {status}
          </span>
          {(status === 'idle' || status === 'disconnected' || status === 'error') && (
            <button
              onClick={connect}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-xs rounded-md transition"
            >
              {status === 'error' || status === 'disconnected' ? (
                <RefreshCw className="w-3 h-3" />
              ) : null}
              {status === 'idle' ? 'Connect' : 'Reconnect'}
            </button>
          )}
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="p-1 text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)] transition"
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Terminal area */}
      <div className="flex-1 relative min-h-0">
        {status === 'idle' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-[var(--color-fg-subtle)] mb-3">Terminal not connected</p>
              <button
                onClick={connect}
                className="px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition"
              >
                Connect
              </button>
            </div>
          </div>
        )}

        {status === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-[var(--color-fg-muted)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Connecting…</span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-center max-w-md">
              <AlertCircle className="w-8 h-8 text-[var(--color-err)]" />
              <p className="text-sm text-[var(--color-err)] break-words">{error}</p>
              {hint && (
                <p className="flex items-start gap-1.5 text-xs text-[var(--color-warn)]/90">
                  <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{hint.message}</span>
                </p>
              )}
              <button
                onClick={connect}
                className="px-3 py-1.5 bg-[var(--color-err)]/10 border border-[var(--color-err)]/30 text-[var(--color-err)] text-xs rounded-lg hover:bg-[var(--color-err)]/20 transition"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className={cn(
            'w-full h-full p-2',
            status !== 'connected' && status !== 'disconnected' && 'invisible',
          )}
          style={{ minHeight: 300 }}
        />
      </div>
    </div>
  );
}
