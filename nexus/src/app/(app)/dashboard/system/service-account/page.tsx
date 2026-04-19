'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCsrfMutation } from '@/lib/create-csrf-mutation';
import type { ServiceAccountStatus } from '@/lib/service-account/session';

const PVEUM_SETUP = `pveum user add nexus@pve
pveum acl modify / -user nexus@pve -role PVEAuditor
pveum acl modify /vms -user nexus@pve -role PVEVMAdmin
pveum user token add nexus@pve automation --privsep 0`;

function timeAgo(ts: number | null): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleString();
}

export default function ServiceAccountPage() {
  const qc = useQueryClient();
  const { data: status } = useQuery<ServiceAccountStatus>({
    queryKey: ['service-account', 'status'],
    queryFn: async () => {
      const res = await fetch('/api/system/service-account', { credentials: 'include' });
      if (!res.ok) throw new Error(`Failed to load status: ${res.status}`);
      return res.json();
    },
  });

  const [tokenId, setTokenId] = useState('');
  const [secret, setSecret] = useState('');
  const [proxmoxHost, setProxmoxHost] = useState('127.0.0.1');

  const saveMutation = useCsrfMutation<ServiceAccountStatus, { tokenId: string; secret: string; proxmoxHost: string }>({
    url: () => '/api/system/service-account',
    method: 'PUT',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const deleteMutation = useCsrfMutation<ServiceAccountStatus, void>({
    url: () => '/api/system/service-account',
    method: 'DELETE',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const probeMutation = useCsrfMutation<{ ok: boolean; error?: string; userid?: string }, void>({
    url: () => '/api/system/service-account/probe',
    method: 'POST',
    invalidateKeys: () => [['service-account', 'status']],
  });

  const canSubmit = tokenId.length > 0 && secret.length > 0 && proxmoxHost.length > 0;

  function onSave() {
    saveMutation.mutate(
      { tokenId, secret, proxmoxHost },
      {
        onSuccess: () => {
          setSecret('');
          void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
        },
      },
    );
  }

  function onDisconnect() {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setTokenId('');
        setSecret('');
        void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
      },
    });
  }

  function onReVerify() {
    probeMutation.mutate(undefined, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: ['service-account', 'status'] });
      },
    });
  }

  if (!status) {
    return <div className="p-6 text-[var(--color-fg-subtle)]">Loading…</div>;
  }

  const configured = status.configured;
  const healthy = configured && status.lastProbeOk === true;
  const failing = configured && status.lastProbeOk === false;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-[var(--color-fg)]">Service Account</h1>
        <p className="text-sm text-[var(--color-fg-subtle)] mt-1">
          A PVE API token Nexus uses for background automation (DRS, auto-updates, pressure monitoring).
        </p>
      </div>

      {!configured && (
        <div className="studio-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">Quick setup</h2>
          <p className="text-xs text-[var(--color-fg-subtle)]">
            Run these on any PVE node, then paste the generated token below.
          </p>
          <pre className="text-xs bg-[var(--color-overlay)] p-3 rounded-lg overflow-x-auto whitespace-pre text-[var(--color-fg-secondary)]">
{PVEUM_SETUP}
          </pre>
        </div>
      )}

      {healthy && (
        <div className="studio-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[var(--color-ok)]">Connected</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            Authenticated as <code>{status.userid}</code>
            {status.lastProbeAt && <> · last verified {timeAgo(status.lastProbeAt)}</>}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onReVerify}
              disabled={probeMutation.isPending}
              className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50"
            >
              {probeMutation.isPending ? 'Re-verifying…' : 'Re-verify'}
            </button>
            <button
              onClick={onDisconnect}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 bg-[var(--color-err)] text-[var(--color-cta-fg)] text-sm rounded-lg disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {failing && (
        <div className="studio-card p-5 space-y-3 border border-[var(--color-err)]/30">
          <h2 className="text-sm font-semibold text-[var(--color-err)]">Connected but failing</h2>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            {status.lastProbeError ?? 'Probe has not run yet.'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onReVerify}
              disabled={probeMutation.isPending}
              className="px-4 py-2 bg-[var(--color-overlay)] text-[var(--color-fg-secondary)] text-sm rounded-lg disabled:opacity-50"
            >
              {probeMutation.isPending ? 'Re-verifying…' : 'Re-verify'}
            </button>
            <button
              onClick={onDisconnect}
              disabled={deleteMutation.isPending}
              className="px-4 py-2 bg-[var(--color-err)] text-[var(--color-cta-fg)] text-sm rounded-lg disabled:opacity-50"
            >
              {deleteMutation.isPending ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      <div className="studio-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--color-fg)]">
          {configured ? 'Update credentials' : 'Configure'}
        </h2>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Token ID</span>
          <input
            type="text"
            value={tokenId}
            onChange={(e) => setTokenId(e.target.value)}
            placeholder="nexus@pve!automation"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Secret</span>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        <label className="block">
          <span className="text-xs text-[var(--color-fg-subtle)] block mb-1.5">Proxmox host</span>
          <input
            type="text"
            value={proxmoxHost}
            onChange={(e) => setProxmoxHost(e.target.value)}
            placeholder="127.0.0.1"
            className="w-full px-3 py-2 bg-[var(--color-overlay)] border border-[var(--color-border-subtle)] rounded-lg text-sm text-[var(--color-fg-secondary)]"
          />
        </label>
        {saveMutation.error && (
          <p className="text-sm text-[var(--color-err)] bg-[var(--color-err)]/10 border border-[var(--color-err)]/20 rounded-lg px-3 py-2">
            {saveMutation.error instanceof Error ? saveMutation.error.message : String(saveMutation.error)}
          </p>
        )}
        <button
          onClick={onSave}
          disabled={!canSubmit || saveMutation.isPending}
          className="px-4 py-2 bg-[var(--color-cta)] hover:bg-[var(--color-cta-hover)] text-[var(--color-cta-fg)] text-sm font-medium rounded-lg transition disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
