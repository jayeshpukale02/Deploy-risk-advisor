import micromatch from "micromatch";

/**
 * Deterministic Risk Signal Functions
 * =====================================
 * Each function is pure: it takes pre-fetched data and returns a sub-score
 * in the range 0–100 (higher = riskier). No DB calls, no side effects.
 *
 * This design makes every signal independently unit-testable and lets the
 * engine orchestrate DB queries separately from scoring logic.
 */

// ---------------------------------------------------------------------------
// Signal 1 — Sensitive Path Coverage
// ---------------------------------------------------------------------------

/**
 * Scores based on what fraction of changed files match configured sensitive
 * glob patterns (e.g. "auth/**", "payments/**", "config/**").
 *
 * Score curve:
 *   0 matching files  →  0
 *   ≤25% of files     →  30
 *   ≤50% of files     →  55
 *   ≤75% of files     →  75
 *   >75% of files     →  90
 *   ALL files match   →  100
 *
 * Returns 0 if no patterns are configured (no false positives for un-configured repos).
 */
export function sensitivePathScore(
  filesChanged: string[],
  patterns: string[]
): number {
  if (patterns.length === 0 || filesChanged.length === 0) return 0;

  const matches = micromatch(filesChanged, patterns, { dot: true });
  const ratio = matches.length / filesChanged.length;

  if (ratio === 0) return 0;
  if (ratio <= 0.25) return 30;
  if (ratio <= 0.5) return 55;
  if (ratio <= 0.75) return 75;
  if (ratio < 1) return 90;
  return 100; // every file is in a sensitive path
}

// ---------------------------------------------------------------------------
// Signal 2 — Coverage Delta
// ---------------------------------------------------------------------------

/**
 * Scores based on the percentage-point change in test coverage.
 * Improvement (positive delta) reduces risk; decline raises it.
 *
 * Score curve:
 *   null / unknown    →  25  (slight penalty — can't verify safety)
 *   delta ≥ +2pp      →   0  (clearly improved)
 *   delta > 0         →   5  (marginally improved)
 *   delta === 0       →  20  (flat — no regression but no improvement)
 *   delta > -5pp      →  45  (small decline)
 *   delta > -10pp     →  65  (moderate decline)
 *   delta > -20pp     →  82  (significant decline)
 *   delta ≤ -20pp     → 100  (severe coverage loss)
 */
export function coverageDeltaScore(delta: number | null | undefined): number {
  if (delta === null || delta === undefined) return 25;
  if (delta >= 2) return 0;
  if (delta > 0) return 5;
  if (delta === 0) return 20;
  if (delta > -5) return 45;
  if (delta > -10) return 65;
  if (delta > -20) return 82;
  return 100;
}

// ---------------------------------------------------------------------------
// Signal 3 — Change Size vs. Historical Average
// ---------------------------------------------------------------------------

/**
 * Scores based on how many total lines were changed relative to the historical
 * average for this repository. Large outliers are inherently riskier.
 *
 * Score curve (ratio = totalLines / historicalAvg):
 *   No history                 →  40  (can't assess; moderate baseline risk)
 *   ratio ≤ 0.5  (tiny)        →   5
 *   ratio ≤ 1.0  (normal)      →  15
 *   ratio ≤ 1.5  (slightly big)→  25
 *   ratio ≤ 2.0               →  40
 *   ratio ≤ 3.0               →  60
 *   ratio ≤ 5.0               →  80
 *   ratio > 5.0  (massive)     → 100
 */
export function changeSizeScore(
  totalLines: number,
  historicalAvgLines: number | null
): number {
  if (historicalAvgLines === null || historicalAvgLines <= 0) return 40;

  const ratio = totalLines / historicalAvgLines;

  if (ratio <= 0.5) return 5;
  if (ratio <= 1.0) return 15;
  if (ratio <= 1.5) return 25;
  if (ratio <= 2.0) return 40;
  if (ratio <= 3.0) return 60;
  if (ratio <= 5.0) return 80;
  return 100;
}

// ---------------------------------------------------------------------------
// Signal 4 — Author Familiarity
// ---------------------------------------------------------------------------

/**
 * Scores based on how recently the author last touched this repo/service.
 * "Cold hands" on unfamiliar code is a known incident predictor.
 *
 * Score curve (days since author last deployed to this repo):
 *   null (never committed) →  90  (complete unfamiliarity)
 *   > 365 days             →  75
 *   > 180 days             →  55
 *   > 90  days             →  35
 *   > 30  days             →  15
 *   ≤ 30  days             →   5
 *   Same day (0)           →   0
 */
export function authorFamiliarityScore(
  daysSinceLastDeploy: number | null
): number {
  if (daysSinceLastDeploy === null) return 90;
  if (daysSinceLastDeploy === 0) return 0;
  if (daysSinceLastDeploy <= 30) return 5;
  if (daysSinceLastDeploy <= 90) return 15;
  if (daysSinceLastDeploy <= 180) return 35;
  if (daysSinceLastDeploy <= 365) return 55;
  return 75;
}

// ---------------------------------------------------------------------------
// Signal 5 — Deploy Timing
// ---------------------------------------------------------------------------

/**
 * Scores based on the day and UTC hour of the deploy.
 * "Never ship on a Friday" is industry wisdom — this signal encodes it.
 *
 * Score map (UTC):
 *   Friday   15:00–23:59  →  95  ("Friday afternoon deploy")
 *   Saturday / Sunday     →  85  (weekend — skeleton crew)
 *   Friday   09:00–15:00  →  70  (Friday but earlier)
 *   Friday   00:00–09:00  →  55  (Friday but pre-hours)
 *   Mon–Thu  18:00–23:59  →  40  (after-hours weekday)
 *   Mon–Thu  00:00–08:59  →  35  (early morning, pre-standup)
 *   Mon–Thu  09:00–17:59  →  10  (normal business hours — safest window)
 *
 * NOTE: Uses UTC. If your team works in a specific timezone, pass a
 * pre-adjusted date or convert before calling.
 */
export function deployTimingScore(deployedAt: Date): number {
  const day = deployedAt.getUTCDay(); // 0=Sun, 1=Mon, …, 5=Fri, 6=Sat
  const hour = deployedAt.getUTCHours();

  if (day === 5) {
    // Friday
    if (hour >= 15) return 95;
    if (hour >= 9) return 70;
    return 55;
  }

  if (day === 0 || day === 6) return 85; // Weekend

  // Monday–Thursday
  if (hour >= 18 || hour < 9) return 40; // Outside business hours
  return 10; // Safe window
}

// ---------------------------------------------------------------------------
// Signal 6 — Historical Correlation
// ---------------------------------------------------------------------------

/**
 * Scores based on the historical incident rate for this repository.
 * If prior deploys frequently led to incidents/rollbacks, that's a red flag.
 *
 * Confidence scaling: with fewer than 5 prior deploys we can't draw reliable
 * conclusions, so the score is damped proportionally.
 *
 * Score: incidentRate × 100 × confidenceFactor
 *   where confidenceFactor = min(sampleSize / 5, 1.0)
 *
 * Examples:
 *   5 deploys, 1 incident  (20% rate) →  20
 *   20 deploys, 5 incidents (25% rate) →  25
 *   3 deploys, 1 incident              →  ~13 (damped — small sample)
 *   0 prior deploys                    →   0
 */
export function historicalCorrelationScore(
  incidentRate: number | null,
  sampleSize: number
): number {
  if (incidentRate === null || sampleSize === 0) return 0;

  const confidenceFactor = Math.min(sampleSize / 5, 1.0);
  return Math.round(incidentRate * 100 * confidenceFactor);
}
