/**
 * NAS provider registry.
 *
 * `getNasProvider(node)` is the single entry point — the UI and API layers
 * never import a concrete provider directly. When dynamic selection lands
 * (per-node probe for U-NAS presence, explicit cluster config, etc.) only
 * this function changes; the rest of the stack is unaware.
 */
import type { NasProvider } from '@/types/nas';
import { nativeProvider } from '@/lib/nas/providers/native';

function notImplemented(): never {
  throw new Error('Not implemented');
}

/** U-NAS REST adapter — Phase 2b placeholder. */
export const unasProvider: NasProvider = {
  getShares: async () => notImplemented(),
  createShare: async () => notImplemented(),
  deleteShare: async () => notImplemented(),
  getServices: async () => notImplemented(),
  listDirectory: async () => notImplemented(),
};

export { nativeProvider };

/**
 * Route a request to the appropriate NAS provider for `node`.
 *
 * TODO(phase-2b): replace hardcode with per-node detection — probe the
 * node for U-NAS presence (e.g. systemd unit active + HTTP 200 on the
 * U-NAS admin port), fall back to the native Samba/NFS shell-out provider
 * when absent. The probe result can be memoised per-node with a short TTL.
 */
export function getNasProvider(_node: string): NasProvider {
  return nativeProvider;
}
