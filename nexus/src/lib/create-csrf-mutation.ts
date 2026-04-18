/**
 * Client-side CSRF mutation helper.
 *
 * Eliminates the 8-line `readCsrfCookie() + fetch() + headers + body +
 * error-parse + JSON-decode` pattern that was repeated across 14 hooks
 * (use-bulk-lifecycle, use-chains, use-script-jobs, use-scheduled-jobs,
 * use-migration, ...).
 *
 * Usage:
 *
 *   export function useStartBulkOp() {
 *     return useCsrfMutation<StartBulkOpResponse, StartBulkOpInput>({
 *       url: '/api/cluster/bulk-lifecycle',
 *       method: 'POST',
 *       invalidateKeys: [['bulk-lifecycle', 'list']],
 *     });
 *   }
 *
 * Behaviour preserved from the hand-rolled pattern:
 *   • readCsrfCookie() is called lazily inside mutationFn — so SSR / first
 *     render doesn't try to read document.cookie before hydration.
 *   • If the cookie is missing, we omit the header rather than sending an
 *     empty one. The server will 403 either way; no value would.
 *   • readError parses `{ error: string }` if present, otherwise falls
 *     back to the HTTP status code.
 *   • invalidateKeys is invalidated on success. `onSuccessExtra` runs
 *     after invalidation if supplied (e.g. for toast + redirect combos).
 */
import { useMutation, useQueryClient, type UseMutationOptions } from '@tanstack/react-query';
import { readCsrfCookie } from '@/lib/proxmox-client';

/** Body-less methods that browsers send as "simple" (no pre-flight) requests. */
export type CsrfMutationMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface CsrfMutationOptions<TData, TInput> {
  /** URL to call. Can be a function when the URL depends on the input. */
  url: string | ((input: TInput) => string);
  method: CsrfMutationMethod;
  /**
   * Query keys to invalidate on success. Accepts a static list or a
   * function that derives keys from the mutation response + input.
   */
  invalidateKeys?: unknown[][] | ((data: TData, input: TInput) => unknown[][]);
  /**
   * If false, the request body is omitted (DELETE with no payload).
   * Default: true for POST/PUT/PATCH; false for DELETE.
   */
  sendBody?: boolean;
  /** Extra mutation options passed through to react-query. */
  extra?: Omit<UseMutationOptions<TData, Error, TInput>, 'mutationFn'>;
}

/**
 * Parse `{ error: string }` from a non-ok Response, falling back to the
 * HTTP status code. Shared across data-fetch hooks so the three stores
 * (chains, scheduled-jobs, bulk-lifecycle) surface errors identically.
 */
export async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `HTTP ${res.status}`;
}

export function useCsrfMutation<TData, TInput>(options: CsrfMutationOptions<TData, TInput>) {
  const qc = useQueryClient();
  const shouldSendBody = options.sendBody ?? options.method !== 'DELETE';

  return useMutation<TData, Error, TInput>({
    ...options.extra,
    mutationFn: async (input) => {
      const url = typeof options.url === 'function' ? options.url(input) : options.url;
      const csrf = readCsrfCookie();
      const res = await fetch(url, {
        method: options.method,
        headers: {
          ...(shouldSendBody ? { 'Content-Type': 'application/json' } : {}),
          ...(csrf ? { 'X-Nexus-CSRF': csrf } : {}),
        },
        ...(shouldSendBody ? { body: JSON.stringify(input) } : {}),
      });
      if (!res.ok) throw new Error(await readError(res));
      // Some DELETE endpoints return 204 No Content — guard against that.
      if (res.status === 204) return undefined as unknown as TData;
      return (await res.json()) as TData;
    },
    onSuccess: (data, input, ...rest) => {
      const keys =
        typeof options.invalidateKeys === 'function'
          ? options.invalidateKeys(data, input)
          : options.invalidateKeys;
      for (const key of keys ?? []) {
        void qc.invalidateQueries({ queryKey: key });
      }
      // Forward the remaining react-query args verbatim — this stays compatible
      // across v5 signature changes (onMutateResult vs context positional).
      (options.extra?.onSuccess as ((d: TData, i: TInput, ...r: unknown[]) => void) | undefined)?.(
        data,
        input,
        ...rest,
      );
    },
  });
}
