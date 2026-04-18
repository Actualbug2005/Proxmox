/**
 * DRS tick runner — glues policy + planner + PVE migrate call + event bus.
 *
 * Every tick:
 *   1. Policy mode === 'off'        → no-op.
 *   2. Blackout cron matches now    → no-op, log skip.
 *   3. Plan a move.
 *      - null (nothing hot enough)  → record no-action, continue.
 *      - dry-run                    → emit drs.would.migrate, continue.
 *      - enabled                    → call PVE migrate, emit drs.migrated
 *                                     (or drs.migration.failed), stamp
 *                                     the vmid's cooldown.
 *
 * The runner calls out to a PVEAuthSession for the migrate call. In
 * production that session is the service-account session seeded at
 * boot (see server.ts's DRS wiring). Tests inject a stub fetcher +
 * skip the bus wiring.
 */

import { matchesCron } from '../cron-match.ts';
import type { PVEAuthSession } from '../../types/proxmox.ts';
import { emit } from '../notifications/event-bus.ts';
import { planMove, type PlannerInput } from './planner.ts';
import {
  appendHistory,
  getState,
  noteMigrated,
} from './store.ts';
import type { DrsHistoryEntry, DrsPolicy } from './types.ts';
import { pveFetch } from '../pve-fetch.ts';

export interface TickDeps {
  fetchCluster: () => Promise<{
    resources: PlannerInput['resources'];
    nodeStatuses: PlannerInput['nodeStatuses'];
  }>;
  /**
   * Execute a guest migration on PVE. Optional — when absent, a stub
   * that always resolves `{ ok: true, upid }` is used so tests can
   * verify the dry-run / enabled branching without spinning up PVE.
   */
  migrate?: (args: {
    session: PVEAuthSession;
    vmid: number;
    sourceNode: string;
    targetNode: string;
  }) => Promise<{ ok: boolean; upid?: string; reason?: string }>;
  session?: PVEAuthSession;
  now?: () => number;
}

const defaultMigrate: NonNullable<TickDeps['migrate']> = async ({
  session,
  vmid,
  sourceNode,
  targetNode,
}) => {
  // PVE's qemu migrate endpoint — POST /nodes/{node}/qemu/{vmid}/migrate.
  // `online=1` is the key flag: without it, PVE only migrates a stopped
  // guest, which defeats the purpose of auto-DRS.
  const url =
    `https://${session.proxmoxHost}:8006/api2/json/nodes/` +
    `${encodeURIComponent(sourceNode)}/qemu/${vmid}/migrate`;
  const body = new URLSearchParams({
    target: targetNode,
    online: '1',
    // with-local-disks off by default — DRS shouldn't move local-disk
    // guests without explicit operator opt-in. Those guests will fail
    // the precondition check on PVE's side and the runner logs the
    // failure cleanly.
  });
  try {
    const res = await pveFetch(url, {
      method: 'POST',
      headers: {
        Cookie: `PVEAuthCookie=${session.ticket}`,
        CSRFPreventionToken: session.csrfToken,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, reason: `PVE ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}` };
    }
    const json = (await res.json()) as { data?: string };
    return { ok: true, upid: typeof json.data === 'string' ? json.data : undefined };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

function isInBlackout(policy: DrsPolicy, at: Date): boolean {
  if (!policy.blackoutCron) return false;
  try {
    return matchesCron(policy.blackoutCron as unknown as string, at);
  } catch {
    // Corrupt cron expression should NOT wedge DRS off forever — log
    // and behave as if no blackout is set. The policy validator
    // refuses invalid crons at save time, so this is a belt-and-braces
    // guard against filesystem tampering.
    return false;
  }
}

/**
 * One complete DRS evaluation. Callers wire this to a scheduler tick.
 */
export async function runTick(deps: TickDeps): Promise<DrsHistoryEntry> {
  const now = deps.now ? deps.now() : Date.now();
  const state = await getState();
  const policy = state.policy;

  if (policy.mode === 'off') {
    return { at: now, mode: 'off', outcome: 'skipped', reason: 'mode=off' };
  }
  if (isInBlackout(policy, new Date(now))) {
    const entry: DrsHistoryEntry = {
      at: now, mode: policy.mode, outcome: 'skipped', reason: 'blackout window',
    };
    await appendHistory(entry);
    return entry;
  }

  let cluster;
  try {
    cluster = await deps.fetchCluster();
  } catch (err) {
    const entry: DrsHistoryEntry = {
      at: now,
      mode: policy.mode,
      outcome: 'skipped',
      reason: `fetchCluster failed: ${err instanceof Error ? err.message : String(err)}`,
    };
    await appendHistory(entry);
    return entry;
  }

  const plan = planMove({
    resources: cluster.resources,
    nodeStatuses: cluster.nodeStatuses,
    policy,
    cooldowns: state.cooldowns,
    now,
  });
  if (!plan) {
    const entry: DrsHistoryEntry = {
      at: now, mode: policy.mode, outcome: 'no-action',
    };
    await appendHistory(entry);
    return entry;
  }

  // Dry-run: emit + record, never actually move.
  if (policy.mode === 'dry-run') {
    emit({
      kind: 'drs.would.migrate',
      at: now,
      payload: {
        vmid: plan.vmid,
        sourceNode: plan.sourceNode,
        targetNode: plan.targetNode,
        scoreDelta: Math.round(plan.scoreDelta),
      },
    });
    const entry: DrsHistoryEntry = {
      at: now,
      mode: 'dry-run',
      outcome: 'would-move',
      vmid: plan.vmid,
      sourceNode: plan.sourceNode,
      targetNode: plan.targetNode,
      scoreDelta: plan.scoreDelta,
    };
    await appendHistory(entry);
    return entry;
  }

  // Enabled: actually migrate.
  if (!deps.session) {
    // Production must inject a session; if absent we refuse to call PVE
    // rather than guessing. The operator flipped mode=enabled without
    // the boot wiring completing — surface and try again next tick.
    const entry: DrsHistoryEntry = {
      at: now,
      mode: 'enabled',
      outcome: 'skipped',
      reason: 'no PVE session available to the DRS runner yet',
    };
    await appendHistory(entry);
    return entry;
  }

  const migrate = deps.migrate ?? defaultMigrate;
  const result = await migrate({
    session: deps.session,
    vmid: plan.vmid,
    sourceNode: plan.sourceNode,
    targetNode: plan.targetNode,
  });

  if (!result.ok) {
    emit({
      kind: 'drs.migration.failed',
      at: now,
      payload: {
        vmid: plan.vmid,
        sourceNode: plan.sourceNode,
        targetNode: plan.targetNode,
        reason: result.reason ?? 'unknown',
      },
    });
    const entry: DrsHistoryEntry = {
      at: now,
      mode: 'enabled',
      outcome: 'skipped',
      vmid: plan.vmid,
      sourceNode: plan.sourceNode,
      targetNode: plan.targetNode,
      scoreDelta: plan.scoreDelta,
      reason: result.reason,
    };
    await appendHistory(entry);
    return entry;
  }

  await noteMigrated(plan.vmid, now);
  emit({
    kind: 'drs.migrated',
    at: now,
    payload: {
      vmid: plan.vmid,
      sourceNode: plan.sourceNode,
      targetNode: plan.targetNode,
      scoreDelta: Math.round(plan.scoreDelta),
      upid: result.upid ?? '',
    },
  });
  const entry: DrsHistoryEntry = {
    at: now,
    mode: 'enabled',
    outcome: 'moved',
    vmid: plan.vmid,
    sourceNode: plan.sourceNode,
    targetNode: plan.targetNode,
    scoreDelta: plan.scoreDelta,
  };
  await appendHistory(entry);
  return entry;
}
