'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/proxmox-client';
import { useSystemNode } from '@/app/dashboard/system/node-context';
import { ConfirmDialog } from '@/components/dashboard/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, ShieldCheck, AlertTriangle, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

type Tab = 'current' | 'acme' | 'tunnels';

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

const TUNNEL_PROVIDERS = [
  {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    binary: 'cloudflared',
    service: 'cloudflared',
    installCmd: 'curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null && echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" | tee /etc/apt/sources.list.d/cloudflared.list && apt-get update && apt-get install -y cloudflared',
    configFields: [{ key: 'token', label: 'Tunnel Token', placeholder: 'eyJhIjoi...' }],
    configCmd: (vals: Record<string, string>) =>
      `cloudflared service install ${vals.token}`,
  },
  {
    id: 'ngrok',
    name: 'ngrok',
    binary: 'ngrok',
    service: 'ngrok',
    installCmd: 'curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list && apt-get update && apt-get install -y ngrok',
    configFields: [
      { key: 'authtoken', label: 'Auth Token', placeholder: '2abc...' },
      { key: 'port', label: 'Local Port', placeholder: '8080' },
    ],
    configCmd: (vals: Record<string, string>) =>
      `ngrok config add-authtoken ${vals.authtoken} && ngrok http ${vals.port ?? '8080'} --log=stdout &`,
  },
];

function TunnelCard({ node, provider }: { node: string; provider: typeof TUNNEL_PROVIDERS[number] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [configVals, setConfigVals] = useState<Record<string, string>>({});
  const [showConfig, setShowConfig] = useState(false);
  const [output, setOutput] = useState('');

  const { data: checkData } = useQuery({
    queryKey: ['tunnel', node, provider.id, 'check'],
    queryFn: () => api.exec.shellCmd(node, `which ${provider.binary} && systemctl is-active ${provider.service} 2>/dev/null || echo inactive`),
    enabled: !!node,
    refetchInterval: 10_000,
  });

  const installed = typeof checkData === 'string' && checkData.includes('/');
  const active = typeof checkData === 'string' && checkData.includes('active');

  const execM = useMutation({
    mutationFn: (cmd: string) => api.exec.shellCmd(node, cmd),
    onSuccess: (result) => {
      const output = typeof result === 'string' ? result : JSON.stringify(result);
      setOutput(output);
      qc.invalidateQueries({ queryKey: ['tunnel', node, provider.id] });
      toast.success(`${provider.name} command sent`, output.slice(0, 160));
    },
    onError: (err) => toast.error(`${provider.name} command failed`, err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-white">{provider.name}</h3>
        </div>
        <div className="flex items-center gap-2">
          {installed ? (
            <Badge variant={active ? 'success' : 'outline'}>{active ? 'Running' : 'Installed'}</Badge>
          ) : (
            <Badge variant="danger">Not Installed</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {!installed && (
          <button
            onClick={() => execM.mutate(provider.installCmd)}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Install
          </button>
        )}
        {installed && (
          <>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'stop' : 'start'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={() => execM.mutate(`systemctl ${active ? 'disable' : 'enable'} ${provider.service}`)}
              disabled={execM.isPending}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition disabled:opacity-40"
            >
              {active ? 'Disable autostart' : 'Enable autostart'}
            </button>
            <button
              onClick={() => setShowConfig(!showConfig)}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-lg transition"
            >
              Configure
            </button>
          </>
        )}
      </div>

      {showConfig && (
        <div className="space-y-2 pt-2 border-t border-gray-800">
          {provider.configFields.map((field) => (
            <div key={field.key}>
              <label className="text-xs text-gray-500 block mb-1">{field.label}</label>
              <input
                value={configVals[field.key] ?? ''}
                onChange={(e) => setConfigVals((p) => ({ ...p, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50"
              />
            </div>
          ))}
          <button
            onClick={() => execM.mutate(provider.configCmd(configVals))}
            disabled={execM.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded-lg transition disabled:opacity-40"
          >
            {execM.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Apply Config
          </button>
        </div>
      )}

      {output && (
        <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs text-gray-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-32">
          {output}
        </pre>
      )}
    </div>
  );
}

export default function CertificatesPage() {
  const { node } = useSystemNode();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('current');
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
    enabled: !!node && tab === 'acme',
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

  const activeCert = certs?.find((c) => c.filename === 'pveproxy-ssl.pem') ?? certs?.[0];
  const days = daysUntil(activeCert?.notafter);

  if (!node) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
        Select a node to manage certificates.
      </div>
    );
  }

  const inputCls = 'w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-orange-500/50';

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

      <div>
        <h1 className="text-xl font-semibold text-white">Certificates</h1>
        <p className="text-sm text-gray-500">TLS certificates and tunnel providers for {node}</p>
      </div>

      {taskUpid && (
        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs px-4 py-2 rounded-lg">
          Task queued: <span className="font-mono">{taskUpid}</span>
        </div>
      )}

      <div className="flex gap-1 border-b border-gray-800">
        {([['current', 'Current Cert'], ['acme', 'ACME / Let\'s Encrypt'], ['tunnels', 'Tunnel Providers']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition border-b-2 -mb-px',
              tab === t ? 'border-orange-500 text-orange-400' : 'border-transparent text-gray-500 hover:text-gray-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'current' && (
        <div className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-orange-500" /></div>
          ) : activeCert ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
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
                    <dt className="text-xs text-gray-500">{label}</dt>
                    <dd className="text-gray-300 font-mono text-xs mt-0.5 break-all">{val ?? '—'}</dd>
                  </div>
                ))}
              </dl>
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-red-400 hover:text-red-300 transition"
              >
                Delete custom certificate
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <AlertTriangle className="w-4 h-4" />
              No certificate info available.
            </div>
          )}

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Upload Custom Certificate</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Certificate (PEM)</label>
              <textarea
                value={certPem}
                onChange={(e) => setCertPem(e.target.value)}
                placeholder="-----BEGIN CERTIFICATE-----&#10;..."
                rows={5}
                className={inputCls + ' font-mono text-xs resize-y'}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Private Key (PEM)</label>
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
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {uploadM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Upload Certificate
            </button>
          </div>
        </div>
      )}

      {tab === 'acme' && (
        <div className="space-y-5">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">ACME Account</h3>
            {acmeAccounts && acmeAccounts.length > 0 ? (
              <div className="space-y-2">
                {acmeAccounts.map((a) => (
                  <div key={a.name} className="flex items-center gap-3">
                    <Badge variant="success">Registered</Badge>
                    <span className="text-sm text-gray-300 font-mono">{a.contact?.join(', ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">No ACME account registered. Register one to enable Let&apos;s Encrypt.</p>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input value={acmeEmail} onChange={(e) => setAcmeEmail(e.target.value)} placeholder="admin@example.com" className={inputCls} />
                </div>
                <button
                  onClick={() => registerAccountM.mutate()}
                  disabled={!acmeEmail || registerAccountM.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
                >
                  {registerAccountM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Register Account
                </button>
              </div>
            )}
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">Order Certificate</h3>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Domain (must resolve to this node&apos;s IP)</label>
              <input value={acmeDomain} onChange={(e) => setAcmeDomain(e.target.value)} placeholder="pve.example.com" className={inputCls} />
            </div>
            <button
              onClick={() => orderCertM.mutate()}
              disabled={!acmeDomain || orderCertM.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm rounded-lg transition disabled:opacity-40"
            >
              {orderCertM.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              Order Certificate
            </button>
            <p className="text-xs text-gray-600">The domain must be configured on the node first via the Proxmox ACME domain config before ordering.</p>
          </div>
        </div>
      )}

      {tab === 'tunnels' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Install and manage reverse tunnel agents on {node}.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {TUNNEL_PROVIDERS.map((p) => (
              <TunnelCard key={p.id} node={node} provider={p} />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
