/**
 * Holt's linear exponential smoothing for short-horizon capacity forecasting.
 *
 * Uses damped-trend Holt's (aka additive Holt's with a damping parameter
 * phi ∈ (0, 1]). Damping decays the trend's contribution geometrically over
 * the forecast horizon so long-range projections approach a horizontal
 * asymptote (level + trend * phi / (1 - phi)) instead of running off to
 * infinity. This matters for bounded metrics like CPU fraction, where an
 * unbounded linear projection can easily produce nonsense like -199%.
 *
 * Plain least-squares (see trend.ts) works well for the storage exhaustion
 * widget — RRD storage series drift slowly and the ~70 samples over a week
 * give a stable fit. For CPU/RAM/disk telemetry the series is much noisier
 * and the recent slope matters far more than the global one. Holt's-linear
 * tracks an exponentially-smoothed level and trend, so recent behaviour
 * dominates without needing an explicit window size.
 *
 * No seasonal component: the noc-overlay horizons are tens of minutes to a
 * few hours, well below any meaningful diurnal cycle, and adding Holt-
 * Winters would need a period guess we don't have. If we later want daily
 * seasonality on a longer window, a separate module can wrap this one.
 *
 * This file is intentionally independent of trend.ts — callers pick the
 * model that fits their series; storage exhaustion stays on linearRegression.
 */

export interface ForecastSample {
  /** Seconds epoch. */
  t: number;
  /** Observed value (any unit — fraction, bytes, whatever). */
  v: number;
}

export interface ForecastInput {
  samples: ReadonlyArray<ForecastSample>;
  /** How far to extrapolate past the last sample, in seconds. */
  horizonSeconds: number;
  /** Optional thresholds to mark crossings for. */
  thresholds?: ReadonlyArray<number>;
  /** Level-smoothing factor (0..1]. Default 0.15 — favours history over
   *  the most recent sample, tuned for multi-hour horizons. */
  alpha?: number;
  /** Trend-smoothing factor (0..1]. Default 0.05 — trend updates slowly
   *  so a single shock doesn't dominate 24h projections. */
  beta?: number;
  /** Trend-damping factor (0..1]. Default 0.9. At phi=1 this collapses
   *  to plain Holt's (unbounded linear extrapolation); lower values
   *  make the forecast approach a horizontal asymptote faster. */
  phi?: number;
}

export type ForecastConfidence = 'low' | 'medium' | 'high';

export interface ForecastResult {
  /** Extrapolated points, same cadence as the input (median gap). */
  points: ForecastSample[];
  confidence: ForecastConfidence;
  /** Timestamps where the extrapolated line crosses each requested threshold. */
  crossings: Array<{ threshold: number; at: number }>;
}

/** Median of a numeric array. Caller guarantees non-empty input. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Run damped-trend Holt's smoothing over `samples` and emit a point-forecast
 * out to `horizonSeconds`. Returns null when there aren't enough samples
 * (<10) to form a credible trend. See module docstring for algorithm
 * rationale.
 */
export function forecast(input: ForecastInput): ForecastResult | null {
  const {
    samples,
    horizonSeconds,
    thresholds = [],
    alpha = 0.15,
    beta = 0.05,
    phi = 0.9,
  } = input;

  if (samples.length < 10) return null;

  // Cadence: median gap between consecutive timestamps. Guard against a
  // degenerate series where every sample shares a timestamp.
  const gaps: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    gaps.push(samples[i].t - samples[i - 1].t);
  }
  const medianGap = gaps.length > 0 ? median(gaps) : 0;
  const gap = medianGap > 0 ? medianGap : 60;

  // Damped Holt's-linear pass. Seed level with the first observation and
  // trend with the first inter-sample delta; iterate from i=1 so the seed
  // is consumed. The phi multiplier on `trend` decays its contribution
  // geometrically both within the smoothing recurrence and in the
  // projection below.
  let level = samples[0].v;
  let trend = samples[1].v - samples[0].v;

  // One-step-ahead residuals for the confidence heuristic.
  let sqErrSum = 0;
  let residualCount = 0;
  let minV = samples[0].v;
  let maxV = samples[0].v;

  for (let i = 1; i < samples.length; i++) {
    const x = samples[i].v;
    if (x < minV) minV = x;
    if (x > maxV) maxV = x;

    const predicted = level + phi * trend;
    const err = x - predicted;
    sqErrSum += err * err;
    residualCount += 1;

    const prevLevel = level;
    level = alpha * x + (1 - alpha) * (level + phi * trend);
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }

  const rmse = residualCount > 0 ? Math.sqrt(sqErrSum / residualCount) : 0;
  const valueRange = maxV - minV;
  const noiseRatio = valueRange === 0 ? 0 : rmse / valueRange;
  let confidence: ForecastConfidence;
  if (noiseRatio < 0.1) confidence = 'high';
  else if (noiseRatio < 0.3) confidence = 'medium';
  else confidence = 'low';

  // Extrapolate. `steps` is at least 1 so short horizons still emit a point.
  const last = samples[samples.length - 1];
  const steps = Math.max(1, Math.floor(horizonSeconds / gap));
  const points: ForecastSample[] = [];

  // Damped-trend k-step forecast. Closed-form so we don't accumulate floating
  // error over 1000+ steps. When phi is exactly 1 this degenerates to k*trend
  // via a L'Hôpital-style fallback (we handle it explicitly to avoid the
  // divide-by-zero).
  const damping = (k: number): number => {
    if (phi >= 1) return k;
    // phi + phi^2 + ... + phi^k = phi * (1 - phi^k) / (1 - phi)
    return (phi * (1 - Math.pow(phi, k))) / (1 - phi);
  };

  for (let k = 1; k <= steps; k++) {
    points.push({ t: last.t + k * gap, v: level + damping(k) * trend });
  }

  // Threshold crossings: solve `level + damping(k) * trend = threshold` for
  // k. When phi < 1 the forecast has a horizontal asymptote at
  // `level + trend * phi / (1 - phi)`; thresholds beyond that asymptote are
  // unreachable and get skipped. A zero trend can't cross anything.
  const crossings: Array<{ threshold: number; at: number }> = [];
  if (trend !== 0) {
    for (const threshold of thresholds) {
      const target = (threshold - level) / trend;
      let k: number | null;
      if (phi >= 1) {
        // damping(k) = k → k = target directly (plain Holt's path).
        k = target;
      } else {
        const asymptote = phi / (1 - phi);
        if (Math.abs(target) > asymptote) {
          k = null;
        } else {
          // damping(k) = phi * (1 - phi^k) / (1 - phi) = target
          // => phi^k = 1 - (1 - phi) * target / phi
          // => k = ln(inner) / ln(phi)
          const inner = 1 - ((1 - phi) * target) / phi;
          if (inner <= 0) {
            k = null;
          } else {
            k = Math.log(inner) / Math.log(phi);
          }
        }
      }
      if (k === null || k <= 0) continue;
      const tCross = last.t + k * gap;
      if (tCross > last.t && tCross <= last.t + horizonSeconds) {
        crossings.push({ threshold, at: tCross });
      }
    }
  }

  return { points, confidence, crossings };
}
