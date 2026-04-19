import { loadConfig } from './store.ts';
import { probeServiceAccount } from './probe.ts';
import type { ServiceAccountSession } from './types.ts';

interface Status {
  configured: boolean;
  savedAt: number | null;
  userid: string | null;
  lastProbeOk: boolean | null;
  lastProbeError: string | null;
  lastProbeAt: number | null;
}

const INITIAL_STATUS: Status = {
  configured: false,
  savedAt: null,
  userid: null,
  lastProbeOk: null,
  lastProbeError: null,
  lastProbeAt: null,
};

let current: ServiceAccountSession | null = null;
let status: Status = { ...INITIAL_STATUS };
let reloadInFlight: Promise<void> | null = null;

async function doReload(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg) {
    current = null;
    status = { ...INITIAL_STATUS };
    return;
  }
  current = {
    tokenId: cfg.tokenId,
    secret: cfg.secret,
    proxmoxHost: cfg.proxmoxHost,
  };
  const probe = await probeServiceAccount(current);
  status = {
    configured: true,
    savedAt: cfg.savedAt,
    userid: probe.ok ? probe.userid : cfg.tokenId,
    lastProbeOk: probe.ok,
    lastProbeError: probe.ok ? null : probe.error,
    lastProbeAt: Date.now(),
  };
}

export async function loadServiceAccountAtBoot(): Promise<void> {
  await reloadServiceAccount();
}

export async function reloadServiceAccount(): Promise<void> {
  if (reloadInFlight) {
    await reloadInFlight;
    return;
  }
  reloadInFlight = doReload().finally(() => {
    reloadInFlight = null;
  });
  await reloadInFlight;
}

export function getServiceSession(): ServiceAccountSession | null {
  return current;
}

export function getServiceAccountStatus(): Status {
  return { ...status };
}
