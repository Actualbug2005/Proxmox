/**
 * Typed fetch + error helpers for the /api/scripts surface.
 *
 * Extracted from src/app/(app)/scripts/page.tsx (audit god-file split).
 * The page-component file is now smaller and these helpers can be unit-
 * tested or shared with a future "scripts marketplace" mobile view
 * without dragging the entire 1000-line page along.
 */

export interface ApiError {
  status: number;
  error: string;
  kind?: 'timeout' | 'network' | 'http' | 'parse' | 'empty';
  detail?: string;
  upstreamStatus?: number | null;
  upstreamUrl?: string;
}

export class ScriptsApiError extends Error implements ApiError {
  status: number;
  error: string;
  kind?: ApiError['kind'];
  detail?: string;
  upstreamStatus?: number | null;
  upstreamUrl?: string;

  constructor(body: ApiError) {
    super(body.detail ?? body.error);
    this.name = 'ScriptsApiError';
    this.status = body.status;
    this.error = body.error;
    this.kind = body.kind;
    this.detail = body.detail;
    this.upstreamStatus = body.upstreamStatus;
    this.upstreamUrl = body.upstreamUrl;
  }
}

export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let body: Partial<ApiError> = {};
    try {
      body = (await res.json()) as Partial<ApiError>;
    } catch {
      /* ignore — fall back to status */
    }
    throw new ScriptsApiError({
      status: res.status,
      error: body.error ?? `HTTP ${res.status}`,
      kind: body.kind,
      detail: body.detail,
      upstreamStatus: body.upstreamStatus ?? null,
      upstreamUrl: body.upstreamUrl,
    });
  }
  return (await res.json()) as T;
}

export interface HumanError {
  title: string;
  message: string;
  icon: 'timeout' | 'network';
}

export function humanizeError(err: unknown): HumanError {
  if (err instanceof ScriptsApiError) {
    if (err.kind === 'timeout' || err.status === 504) {
      return {
        title: 'Upstream took too long',
        message:
          'The community-scripts PocketBase endpoint did not respond in time. Try again in a moment.',
        icon: 'timeout',
      };
    }
    if (err.kind === 'http' && err.upstreamStatus === 429) {
      return {
        title: 'Upstream rate-limit reached',
        message: 'Too many requests to the community-scripts API. Wait a minute and retry.',
        icon: 'network',
      };
    }
    if (err.kind === 'empty') {
      return {
        title: 'Upstream returned no scripts',
        message:
          'The PocketBase API responded but the index was empty — usually a transient upstream issue.',
        icon: 'network',
      };
    }
    return {
      title: 'Failed to load community scripts',
      message: err.detail ?? err.error,
      icon: 'network',
    };
  }
  return { title: 'Failed to load community scripts', message: String(err), icon: 'network' };
}
