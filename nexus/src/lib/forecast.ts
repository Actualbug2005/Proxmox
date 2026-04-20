/**
 * Holt's linear exponential smoothing for short-horizon capacity forecasting.
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
  /** Level-smoothing factor. Default 0.3. */
  alpha?: number;
  /** Trend-smoothing factor. Default 0.1. */
  beta?: number;
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
 * Run Holt's-linear smoothing over `samples` and emit a point-forecast out to
 * `horizonSeconds`. Returns null when there aren't enough samples (<10) to
 * form a credible trend. See module docstring for algorithm rationale.
 */
export function forecast(input: ForecastInput): ForecastResult | null {
  const {
    samples,
    horizonSeconds,
    thresholds = [],
    alpha = 0.3,
    beta = 0.1,
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

  // Holt's-linear pass. Seed level with the first observation and trend with
  // the first inter-sample delta; iterate from i=1 so the seed is consumed.
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

    const predicted = level + trend;
    const err = x - predicted;
    sqErrSum += err * err;
    residualCount += 1;

    const prevLevel = level;
    level = alpha * x + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
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
  for (let k = 1; k <= steps; k++) {
    points.push({ t: last.t + k * gap, v: level + k * trend });
  }

  // Threshold crossings: solve `level + ((t - last.t) / gap) * trend = thr`
  // for t, expressed in seconds. A zero trend can't cross anything.
  const crossings: Array<{ threshold: number; at: number }> = [];
  if (trend !== 0) {
    for (const threshold of thresholds) {
      // Forecast value k*gap seconds past `last.t` is `level + k*trend`.
      // Solve level + k*trend = threshold → k = (threshold - level) / trend.
      const k = (threshold - level) / trend;
      const tCross = last.t + k * gap;
      if (tCross > last.t && tCross <= last.t + horizonSeconds) {
        crossings.push({ threshold, at: tCross });
      }
    }
  }

  return { points, confidence, crossings };
}
