/**
 * Tiny trendline helpers for the NOC view's exhaustion projection.
 *
 * Plain least-squares linear regression — no dependency. PVE storage RRD
 * gives ~70 samples over a week, which is plenty for a rough "days until
 * full" estimate. We stay deliberately naive: one pass, no smoothing,
 * no seasonality. If the series is flat or shrinking we return null;
 * the UI renders that as "no trend" rather than a garbage projection.
 */

/**
 * Least-squares fit y = slope·x + intercept. Returns null if the series
 * has fewer than 2 points or every x is the same (vertical line).
 */
export function linearRegression(
  points: ReadonlyArray<[number, number]>,
): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;

  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;

  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    const dx = x - meanX;
    num += dx * (y - meanY);
    den += dx * dx;
  }
  if (den === 0) return null;

  const slope = num / den;
  const intercept = meanY - slope * meanX;
  return { slope, intercept };
}

/**
 * Return the x-value at which the regression crosses `threshold`. Null
 * when there's no trend (fewer than 2 points) or the line is flat/falling
 * (`slope <= 0`) — for exhaustion projection we only care about growth.
 */
export function projectToThreshold(
  points: ReadonlyArray<[number, number]>,
  threshold: number,
): number | null {
  const fit = linearRegression(points);
  if (!fit) return null;
  if (fit.slope <= 0) return null;
  return (threshold - fit.intercept) / fit.slope;
}

/**
 * Days until a storage RRD series hits `threshold` fraction of capacity
 * (default 0.95). Returns null when the trend is flat/shrinking or the
 * storage is already past the threshold.
 *
 * Inputs accept either raw numbers or the StorageRRDData shape PVE returns.
 * `time` is seconds epoch (PVE convention); output is days relative to
 * the most recent sample.
 */
export function daysUntilFull(
  rrd: ReadonlyArray<{ time: number; used?: number; total?: number }>,
  threshold = 0.95,
): number | null {
  if (rrd.length < 2) return null;

  // Filter to samples where both fields are present and total > 0 so the
  // fraction is well-defined. Seconds → ms for the regression so slope's
  // units are "fraction per ms".
  const points: Array<[number, number]> = [];
  for (const p of rrd) {
    if (p.total === undefined || p.total <= 0) continue;
    if (p.used === undefined) continue;
    points.push([p.time * 1000, p.used / p.total]);
  }
  if (points.length < 2) return null;

  const fit = linearRegression(points);
  if (!fit || fit.slope <= 0) return null;

  const latest = points[points.length - 1];
  const latestY = fit.slope * latest[0] + fit.intercept;
  if (latestY >= threshold) return 0; // already past — render as "now"

  const tCrossMs = (threshold - fit.intercept) / fit.slope;
  const deltaMs = tCrossMs - latest[0];
  if (deltaMs <= 0) return 0;
  return deltaMs / (1000 * 60 * 60 * 24);
}
