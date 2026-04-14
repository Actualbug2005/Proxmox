'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Loader2, AlertCircle, Maximize2, Minimize2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

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
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError('');

    try {
      // Get WS ticket from our proxy
      const res = await fetch('/api/proxmox-ws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        theme: {
          background: '#030712',
          foreground: '#e5e7eb',
          cursor: '#f97316',
          cursorAccent: '#030712',
          black: '#1f2937',
          red: '#ef4444',
          green: '#10b981',
          yellow: '#f59e0b',
          blue: '#3b82f6',
          magenta: '#8b5cf6',
          cyan: '#06b6d4',
          white: '#e5e7eb',
          brightBlack: '#374151',
          brightRed: '#f87171',
          brightGreen: '#34d399',
          brightYellow: '#fbbf24',
          brightBlue: '#60a5fa',
          brightMagenta: '#a78bfa',
          brightCyan: '#22d3ee',
          brightWhite: '#f9fafb',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowTransparency: false,
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
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [node, vmid, type]);

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
        'flex flex-col bg-gray-950 border border-gray-800 rounded-xl overflow-hidden',
        fullscreen && 'fixed inset-0 z-50 rounded-none border-0',
        className,
      )}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
          <span className="text-xs text-gray-500 ml-2">
            {type === 'node' ? `${node} — Shell` : `${node}/${type}/${vmid} — Console`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              status === 'connected'
                ? 'text-emerald-400 bg-emerald-500/10'
                : status === 'connecting'
                  ? 'text-blue-400 bg-blue-500/10'
                  : status === 'error'
                    ? 'text-red-400 bg-red-500/10'
                    : 'text-gray-500 bg-gray-800',
            )}
          >
            {status}
          </span>
          {(status === 'idle' || status === 'disconnected' || status === 'error') && (
            <button
              onClick={connect}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-md transition"
            >
              {status === 'error' || status === 'disconnected' ? (
                <RefreshCw className="w-3 h-3" />
              ) : null}
              {status === 'idle' ? 'Connect' : 'Reconnect'}
            </button>
          )}
          <button
            onClick={() => setFullscreen((f) => !f)}
            className="p-1 text-gray-500 hover:text-gray-300 transition"
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
              <p className="text-sm text-gray-500 mb-3">Terminal not connected</p>
              <button
                onClick={connect}
                className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition"
              >
                Connect
              </button>
            </div>
          </div>
        )}

        {status === 'connecting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Connecting…</span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={connect}
                className="px-3 py-1.5 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-lg hover:bg-red-500/20 transition"
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
