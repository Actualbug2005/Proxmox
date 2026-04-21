'use client';

/**
 * Node Certificates tab body.
 *
 * Extracted from `src/app/(app)/dashboard/system/certificates/page.tsx`
 * for the Plan D Task 2 tabbed shell. The /dashboard/system layout owns
 * the outer `p-6 space-y-6` wrapper AND the node-picker header; the old
 * route keeps only the page-level `<h1>` + subtitle chrome.
 *
 * Internal sub-tabs (`current | acme | tunnels`) moved from local
 * `useState` to URL-driven `?sub=<id>` so deep-links like
 * `/dashboard/system?tab=certificates&sub=tunnels` will work once Task 2
 * lands. `scroll: false` on `router.replace` preserves scroll position
 * on toggle. Relative URL so the same tab file renders correctly from
 * both the standalone /dashboard/system/certificates route and the
 * future tabbed shell.
 */

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ProxmoxAPIError } from '@/lib/proxmox-client';
import { POLL_INTERVALS } from '@/hooks/use-cluster';
import { useSystemNode } from '@/app/(app)/dashboard/system/node-context';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { TunnelProviderId, TunnelStatus, TunnelStatusResponse } from '@/types/tunnels';

type ToastApi = ReturnType<typeof useToast>;

type Sub = 'current' | 'acme' | 'tunnels';
const SUBS = ['current', 'acme', 'tunnels'] as const;
function isSub(v: string | null): v is Sub {
  return !!v && (SUBS as readonly string[]).includes(v);
}

function daysUntil(ts?: number): number | null {
  if (!ts) return null;
  return Math.floor((ts * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

function CertBadge({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days < 7) return <Badge variant="danger">{days}d left</Badge>;
  if (days < 30) return <Badge variant="warning">{days}d left</Badge>;
  return <Badge variant="success">{days}d left</Badge>;
}

interface TunnelProvider {
  id: TunnelProviderId;
  name: string;
  binary: string;
  service: string;
  installCmd: string;
  configFields: { key: string; label: string; placeholder: string }[];
  configCmd: (vals: Record<string, string>) => string;
}

const TUNNEL_PROVIDERS: readonly TunnelProvider[] = [
  {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    binary: 'cloudflared',
    service: 'cloudflared',
    installCmd: `set -e
ARCH=$(dpkg --print-architecture)
curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-\${ARCH}.deb" -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb || apt-get install -f -y
rm -f /tmp/cloudflared.deb
cloudflared --version`,
    configFields: [{ key: 'token', label: 'Tunnel Token', placeholder: 'eyJhIjoi...' }],
    configCmd: (vals: Record<string, string>) =>
      `cloudflared service install ${vals.token}`,
  },
  {
    id: 'ngrok',
    name: 'ngrok',
    binary: 'ngrok',
    service: 'ngrok',
    installCmd: `set -e
mkdir -p --mode=0755 /etc/apt/keyrings
curl -fsSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc -o /etc/apt/keyrings/ngrok.asc
echo "deb [signed-by=/etc/apt/keyrings/ngrok.asc] https://ngrok-agent.s3.amazonaws.com buster main" > /etc/apt/sources.list.d/ngrok.list
apt-get update
apt-get install -y ngrok
ngrok --version`,
    configFields: [
      { key: 'authtoken', label: 'Auth Token', placeholder: '2abc...' },
      { key: 'port', label: 'Local Port', placeholder: '8080' },
    ],
    configCmd: (vals: Record<string, string>) =>
      `ngrok config add-authtoken ${vals.authtoken} && ngrok http ${vals.port ?? '8080'} --log=stdout &`,
  },
] as const;

// TunnelStatus + TunnelStatusResponse moved to '@/types/tunnels' so the
// route handler and this page share the canonical wire-shape.

const TUNNEL_STATUS_KEY = ['tunnel-status'] as const;

async function fetchTunnelStatus(node: string): Promise<TunnelStatusResponse> {
  const res = await fetch(`/api/tunnels/status?node=${encodeURIComponent(node)}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ProxmoxAPIError(res.status, res.statusText, body.error ?? res.statusText);
  }
  return (await res.json()) as TunnelStatusResponse;
}

interface TunnelFlags {
  status: TunnelStatus;
  installed: boolean;
  configured: boolean;
  active: boolean;
}

function deriveTunnelFlags(status: TunnelStatus): TunnelFlags {
  const installed = status === 'not-configured' || status === 'stopped' || status === 'active';
  const configured = status === 'stopped' || status === 'active';
  const active = status === 'active';
  return { status, installed, configured, active };
}

/** Translate a thrown ProxmoxAPIError into a user-facing toast. 403 is a
 *  permission-denied case from the Sys.Modify gate on /api/exec — surface
 *  that explicitly so the user knows it's an ACL issue, not a script bug. */
function reportExecError(toast: ToastApi, providerName: string, err: unknown): void {
  if (err instanceof ProxmoxAPIError && err.status === 403) {
    toast.error('Permission Denied', 'Requires Sys.Modify on node.');
    return;
  }
  toast.error(
    `${providerName} command failed`,
    err instanceof Error ? err.message : String(err),
  );
}

interface TunnelCardProps {
  node: string;
  provider: TunnelProvider;
  status: TunnelStatus;
}

function TunnelCard({ node, provider, status }: TunnelCardProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const [configVals, setConfigVals] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [output, setOutput] = useState('');

  const { installed, configured, active } = useMemo(
    () => deriveTunnelFlags(status),
    [status],
  );

  const execM = useMutation({
    mutationFn: (cmd: string) => api.exec.shellCmd(node, cmd),
    onSuccess: (result) => {
      const output = typeof result === 'string' ? result : JSON.stringify(result);
      setOutput(output);
      // Refresh the page-level status query so the badge flips.
      qc.invalidateQueries({ queryKey: TUNNEL_STATUS_KEY });
      toast.success(`${provider.name} command sent`, output.slice(0, 160));
    },
    onError: (err) => reportExecError(toast, provider.name, err),
  });

  return (
    <div className="studio-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[var(--color-fg-muted)]" />
          <h3 className="text-sm font-semibold text-white">{provider.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {!installed && <Badge variant="danger">Not Installed</Badge>}
          {installed && !configured && <Badge variant="warning">Installed · Not Configured</Badge>}
          {configured && !active && <Badge variant="outline">Stopped</Badge>}
          {active && <Badge variant="success">Running</Badge>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!installed && (
          <button
            onClick={() => execM.mutate(provider.installCmd)}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Install
          </button>
        )}
        {installed && !configured && (
          <p className="text-xs text-[var(--color-fg-subtle)] w-full">
            Binary installed. Use the Configure form below to register a token — this creates the systemd service.
          </p>
        )}
        {configured && (
          <>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'stop' : 'start'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'disable' : 'enable'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Disable autostart' : 'Enable autostart'}
            </button>
          </>
        )}
        {installed && (
          <>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-3 py-1.5 bg-[var(--color-overlay)] hover:bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-xs rounded-lg transition"
            >
              Configure
            </button>
          </>
        )}
      </div>

      {showConfig && (
        <div className="space-y-2 pt-2 border-t border-[var(--color-border-subtle)]">
          {provider.configFields.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">{field.label}</label>
              <input
                value={configVals[field.key] ?? ''}
                onChange={(e) => setConfigVals((p) => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50"
              />
            </div>
          ))}
          <button
            onClick={() => execM.mutate(provider.configCmd(configVals))}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Apply Config
          </button>
        </div>
      )}

      {output && (
        <pre className="bg-gray-950 border border-[var(--color-border-subtle)] rounded-lg p-3 text-xs text-[var(--color-fg-muted)] font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
          {output}
        </pre>
      )}
    </div>
  );
}

export function CertificatesTab() {
  const { node } = useSystemNode();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const router = useRouter();
  const sub: Sub = isSub(sp.get('sub')) ? (sp.get('sub') as Sub) : 'current';
  const setSub = (id: Sub) => {
    const next = new URLSearchParams(sp);
    next.set('sub', id);
    // scroll: false — sub-tab switches shouldn't yank the page to top; the
    // old useState toggle preserved scroll, Next's router.replace defaults
    // to scroll: true.
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [acmeEmail, setAcmeEmail] = useState('');
  const [acmeDomain, setAcmeDomain] = useState('');
  const [taskUpid, setTaskUpid] = useState('');

  const toast = useToast();

  const { data: certs, isLoading } = useQuery({
    queryKey: ['certificates', node],
    queryFn: () => api.certificates.list(node),
    enabled: !!node,
  });

  const { data: acmeAccounts } = useQuery({
    queryKey: ['acme', 'accounts'],
    queryFn: () => api.acme.accounts(),
    enabled: !!node && sub === 'acme',
  });

  const uploadM = useMutation({
    mutationFn: () => api.certificates.uploadCustom(node, certPem, keyPem),
    onSuccess: () => {
      setCertPem('');
      setKeyPem('');
      qc.invalidateQueries({ queryKey: ['certificates', node] });
      toast.success('Certificate uploaded', `Restart pveproxy for it to take effect.`);
    },
    onError: (err) => toast.error('Upload failed', err instanceof Error ? err.message : String(err)),
  });

  const deleteCustomM = useMutation({
    mutationFn: () => api.certificates.deleteCustom(node),
    onSuccess: () => {
      setShowDeleteConfirm(false);
      qc.invalidateQueries({ queryKey: ['certificates', node] });
      toast.success('Custom certificate deleted', 'Reverted to self-signed.');
    },
    onError: (err) => toast.error('Delete failed', err instanceof Error ? err.message : String(err)),
  });

  const registerAccountM = useMutation({
    mutationFn: () => api.acme.registerAccount('default', acmeEmail),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acme', 'accounts'] });
      toast.success('ACME account registered', acmeEmail);
    },
    onError: (err) => toast.error('Registration failed', err instanceof Error ? err.message : String(err)),
  });

  const orderCertM = useMutation({
    mutationFn: () => api.certificates.orderAcme(node),
    onSuccess: (upid) => {
      setTaskUpid(upid);
      toast.success('Certificate order queued', upid.slice(0, 48));
    },
    onError: (err) => toast.error('Order failed', err instanceof Error ? err.message : String(err)),
  });

  const activeCert = useMemo(
    () => certs?.find((c) => c.filename === 'pveproxy-ssl.pem') ?? certs?.[0],
    [certs],
  );
  const days = useMemo(() => daysUntil(activeCert?.notafter), [activeCert]);

  const { data: tunnelStatus, isLoading: tunnelStatusLoading, error: tunnelStatusError } = useQuery({
    queryKey: [...TUNNEL_STATUS_KEY, node],
    queryFn: () => fetchTunnelStatus(node),
    enabled: !!node && sub === 'tunnels',
    refetchInterval: POLL_INTERVALS.services,
    retry: (failureCount, err) => {
      // Don't hammer the server retrying a 403 — the user lacks Sys.Audit.
      if (err instanceof ProxmoxAPIError && (err.status === 403 || err.status === 401)) return false;
      return failureCount < 2;
    },
  });

  const tunnelCards = useMemo(
    () =>
      TUNNEL_PROVIDERS.map((p) => (
        <TunnelCard
          key={p.id}
          node={node}
          provider={p}
          status={(tunnelStatus?.providers?.[p.id] ?? 'unknown') as TunnelStatus}
        />
      )),
    [node, tunnelStatus],
  );

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--color-fg-subtle)] text-sm">
        Select a node to manage certificates.
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)] focus:outline-none focus:border-zinc-300/50';

  return (
    <>
      {showDeleteConfirm && (
        <ConfirmDialog
          title="Delete custom certificate?"
          message="This will revert to the self-signed Proxmox certificate."
          danger
          onConfirm={() => deleteCustomM.mutate()}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {taskUpid && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs px-4 py-2 rounded-lg">
          Task queued: <span className="font-mono">{taskUpid}</span>
        </div>
      )}

      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        {([['current', 'Current Cert'], ['acme', 'ACME / Let\'s Encrypt'], ['tunnels', 'Tunnel Providers']] as [Sub, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setSub(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              sub === t ? 'border-zinc-200 text-indigo-400' : 'border-transparent text-[var(--color-fg-subtle)] hover:text-[var(--color-fg-secondary)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {sub === 'current' && (
        <div className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" /></div>
          ) : activeCert ? (
            <div className="studio-card p-5 space-y-3">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-[var(--color-ok)]" />
                <h3 className="text-sm font-semibold text-white">Active Certificate</h3>
                <CertBadge days={days} />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Subject', activeCert.subject],
                  ['Issuer', activeCert.issuer],
                  ['SANs', activeCert.san?.join(', ')],
                  ['Fingerprint', activeCert.fingerprint],
                  ['Valid Until', activeCert.notafter ? new Date(activeCert.notafter * 1000).toLocaleDateString() : '—'],
                ].map(([label, val]) => (
                  <div key={label}>
                    <dt className="text-xs text-[var(--color-fg-subtle)]">{label}</dt>
                    <dd className="text-[var(--color-fg-secondary)] font-mono text-xs mt-0.5 break-all">{val ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-[var(--color-err)] hover:text-[var(--color-err)] transition"
              >
                Delete custom certificate
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[var(--color-fg-subtle)] text-sm">
              <AlertTriangle className="w-4 h-4" />
              No certificate info available.
            </div>
          )}

          <div className="studio-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Upload Custom Certificate</h3>
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Certificate (PEM)</label>
              <textarea
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                rows={5}
                className={inputCls + ' font-mono text-xs resize-y'}
              />
            </div>
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Private Key (PEM)</label>
              <textarea
                value={keyPem}
                onChange={(e) => setKeyPem(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;..."
                rows={5}
                className={inputCls + ' font-mono text-xs resize-y'}
              />
            </div>
            <button
              onClick={() => uploadM.mutate()}
              disabled={!certPem || !keyPem || uploadM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40"
            >
              {uploadM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Upload Certificate
            </button>
          </div>
        </div>
      )}

      {sub === 'acme' && (
        <div className="space-y-5">
          <div className="studio-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">ACME Account</h3>
            {acmeAccounts && acmeAccounts.length > 0 ? (
              <div className="space-y-2">
                {acmeAccounts.map((a) => (
                  <div key={a.name} className="flex items-center gap-3">
                    <Badge variant="success">Registered</Badge>
                    <span className="text-sm text-[var(--color-fg-secondary)] font-mono">{a.contact?.join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[var(--color-fg-subtle)]">No ACME account registered. Register one to enable Let&apos;s Encrypt.</p>
                <div>
                  <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Email</label>
                  <input value={acmeEmail} onChange={(e) => setAcmeEmail(e.target.value)} placeholder="admin@example.com" className={inputCls} />
                </div>
                <button
                  onClick={() => registerAccountM.mutate()}
                  disabled={!acmeEmail || registerAccountM.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40"
                >
                  {registerAccountM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Register Account
                </button>
              </div>
            )}
          </div>

          <div className="studio-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Order Certificate</h3>
            <div>
              <label className="text-xs text-[var(--color-fg-subtle)] block mb-1">Domain (must resolve to this node&apos;s IP)</label>
              <input value={acmeDomain} onChange={(e) => setAcmeDomain(e.target.value)} placeholder="pve.example.com" className={inputCls} />
            </div>
            <button
              onClick={() => orderCertM.mutate()}
              disabled={!acmeDomain || orderCertM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm rounded-lg transition disabled:opacity-40"
            >
              {orderCertM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Order Certificate
            </button>
            <p className="text-xs text-[var(--color-fg-faint)]">The domain must be configured on the node first via the Proxmox ACME domain config before ordering.</p>
          </div>
        </div>
      )}

      {sub === 'tunnels' && (
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-fg-subtle)]">
            Install and manage reverse tunnel agents on {node}. Status requires{' '}
            <span className="font-mono text-[var(--color-fg-muted)]">Sys.Audit</span>; install / start / stop
            actions require <span className="font-mono text-[var(--color-fg-muted)]">Sys.Modify</span>.
          </p>

          {tunnelStatusError instanceof ProxmoxAPIError && tunnelStatusError.status === 403 && (
            <div className="flex items-start gap-2 bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 text-[var(--color-err)] text-xs px-4 py-2 rounded-lg">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Permission Denied: requires Sys.Audit on /nodes/{node} to view tunnel status.</span>
            </div>
          )}

          {tunnelStatusLoading && !tunnelStatus ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--color-fg-muted)]" />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{tunnelCards}</div>
          )}
        </div>
      )}
    </>
  );
}
