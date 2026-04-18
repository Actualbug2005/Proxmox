/**
 * Hard limits for remote command execution (/api/exec and /api/scripts/run).
 *
 * These are trust-boundary values. A compromised session, a buggy UI, or a
 * caller with valid Sys.Modify cannot exceed them — the route enforces the
 * caps server-side before spawning any subprocess. All values picked for the
 * "Heavy cluster work" profile (apt upgrades across multiple nodes,
 * long ansible-pull runs, pveam template installs):
 *
 *   Profile                 timeout   cmd len   output   concurrent
 *   Light diagnostics        5 min     16 KB     2 MB        3
 *   Mixed ops                15 min    32 KB     5 MB        3
 *   Heavy cluster work  ✓   45 min    64 KB    20 MB        5
 *
 * If the operator later restricts /api/exec to ad-hoc diagnostics only,
 * tighten these to the Light profile in a single edit — every call site
 * imports the same constants.
 */

export const EXEC_LIMITS = {
  /** Maximum wall-clock time for a single remote execution. */
  maxTimeoutMs: 45 * 60 * 1000,

  /** Maximum length of a command string accepted by /api/exec. */
  maxCommandBytes: 64 * 1024,

  /** Maximum bytes captured from remote stdout+stderr combined. */
  maxOutputBytes: 20 * 1024 * 1024,

  /**
   * Maximum number of in-flight executions per session (summed across
   * /api/exec + /api/scripts/run). Enforced via
   * {@link ../../lib/rate-limit.ts#acquireSlot}.
   */
  maxConcurrentPerSession: 5,
} as const;

export type ExecLimits = typeof EXEC_LIMITS;
