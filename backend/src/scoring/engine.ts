import prisma from "../db/prisma";
import type { RiskSignals } from "../types/deploy";
import {
  sensitivePathScore,
  coverageDeltaScore,
  changeSizeScore,
  authorFamiliarityScore,
  deployTimingScore,
  historicalCorrelationScore,
} from "./signals";

// ---------------------------------------------------------------------------
// Weight configuration
// ---------------------------------------------------------------------------

/**
 * Weights for each signal in the composite score.
 *
 * TUNING GUIDE — change these numbers to adjust the engine's sensitivity:
 *
 *  sensitivePathScore      — highest weight; touching auth/payments is the
 *                            strongest single predictor of a bad deploy.
 *  coverageDeltaScore      — second; coverage regression strongly correlates
 *                            with post-deploy bugs.
 *  changeSizeScore         — large diffs are harder to review thoroughly.
 *  authorFamiliarityScore  — "cold hands" on unfamiliar code is a known risk.
 *  historicalCorrelation   — learned from past incidents in this repo.
 *  deployTimingScore       — lowest because it's blunt (time alone doesn't
 *                            make a deploy bad, it just raises the blast radius).
 *
 * Rule: all weights MUST sum to exactly 1.0.
 */
export const SIGNAL_WEIGHTS = {
  sensitivePathScore: 0.25,
  coverageDeltaScore: 0.20,
  changeSizeScore: 0.15,
  authorFamiliarityScore: 0.15,
  historicalCorrelationScore: 0.15,
  deployTimingScore: 0.10,
} as const;

// Compile-time check that weights are defined for every signal key
type SignalKey = keyof Omit<RiskSignals, "compositeScore">;
type WeightMap = Record<SignalKey, number>;
const _weightCheck: WeightMap = SIGNAL_WEIGHTS; // TypeScript will error if a key is missing
void _weightCheck;

// ---------------------------------------------------------------------------
// DB context queries
// ---------------------------------------------------------------------------

interface ScoringContext {
  sensitivePatterns: string[];
  historicalAvgLines: number | null;
  daysSinceAuthorLastDeploy: number | null;
  incidentRate: number | null;
  sampleSize: number;
}

/**
 * Fetches all contextual data needed by the scoring engine in a single pass.
 * Isolated here so that unit tests can stub this function without touching Prisma.
 */
export async function fetchScoringContext(
  repo: string,
  author: string,
  deployedAt: Date
): Promise<ScoringContext> {
  const [sensitivePathRows, priorDeploys, lastAuthorDeploy] = await Promise.all(
    [
      // 1. Sensitive path patterns configured for this repo
      prisma.sensitivePath.findMany({ where: { repo } }),

      // 2. All prior deploys for this repo (for avg size + incident rate)
      prisma.deploy.findMany({
        where: { repo },
        select: {
          linesAdded: true,
          linesDeleted: true,
          outcome: true,
          deployedAt: true,
        },
        orderBy: { deployedAt: "desc" },
        take: 100, // cap to last 100 deploys for performance
      }),

      // 3. Most recent deploy by this author to this repo
      prisma.deploy.findFirst({
        where: { repo, author },
        select: { deployedAt: true },
        orderBy: { deployedAt: "desc" },
      }),
    ]
  );

  // Historical average change size (lines added + deleted)
  const historicalAvgLines =
    priorDeploys.length > 0
      ? priorDeploys.reduce(
          (sum, d) => sum + d.linesAdded + d.linesDeleted,
          0
        ) / priorDeploys.length
      : null;

  // Days since this author last deployed to this repo
  const daysSinceAuthorLastDeploy = lastAuthorDeploy
    ? Math.floor(
        (deployedAt.getTime() - lastAuthorDeploy.deployedAt.getTime()) /
          (1000 * 60 * 60 * 24)
      )
    : null;

  // Historical incident/rollback rate for this repo
  const sampleSize = priorDeploys.length;
  const incidentCount = priorDeploys.filter(
    (d) => d.outcome === "incident" || d.outcome === "rolled_back"
  ).length;
  const incidentRate =
    sampleSize > 0 ? incidentCount / sampleSize : null;

  return {
    sensitivePatterns: sensitivePathRows.map((r) => r.pattern),
    historicalAvgLines,
    daysSinceAuthorLastDeploy,
    incidentRate,
    sampleSize,
  };
}

// ---------------------------------------------------------------------------
// Composite scorer
// ---------------------------------------------------------------------------

/**
 * Combines sub-scores using the configured weights into a final 0–100 score.
 * Exported separately so it can be tested without DB dependencies.
 */
export function computeCompositeScore(
  subScores: Omit<RiskSignals, "compositeScore">
): number {
  const weighted =
    subScores.sensitivePathScore * SIGNAL_WEIGHTS.sensitivePathScore +
    subScores.coverageDeltaScore * SIGNAL_WEIGHTS.coverageDeltaScore +
    subScores.changeSizeScore * SIGNAL_WEIGHTS.changeSizeScore +
    subScores.authorFamiliarityScore * SIGNAL_WEIGHTS.authorFamiliarityScore +
    subScores.historicalCorrelationScore *
      SIGNAL_WEIGHTS.historicalCorrelationScore +
    subScores.deployTimingScore * SIGNAL_WEIGHTS.deployTimingScore;

  return Math.round(Math.min(100, Math.max(0, weighted)));
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------

export interface ScoreDeployInput {
  repo: string;
  author: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  coverageDelta: number | null | undefined;
  deployedAt: Date;
}

/**
 * Runs the full deterministic scoring pipeline:
 *   1. Fetch contextual data from DB
 *   2. Compute each signal sub-score (pure functions)
 *   3. Combine into a weighted composite score
 *   4. Return the full RiskSignals breakdown
 *
 * This function is the single entry point for Phase 2 scoring.
 * Phase 3 will call this first, then pass the result to the LLM layer.
 */
export async function scoreDeployment(
  input: ScoreDeployInput
): Promise<RiskSignals> {
  const totalLines = input.linesAdded + input.linesDeleted;

  const ctx = await fetchScoringContext(
    input.repo,
    input.author,
    input.deployedAt
  );

  const subScores: Omit<RiskSignals, "compositeScore"> = {
    sensitivePathScore: sensitivePathScore(
      input.filesChanged,
      ctx.sensitivePatterns
    ),
    coverageDeltaScore: coverageDeltaScore(input.coverageDelta),
    changeSizeScore: changeSizeScore(totalLines, ctx.historicalAvgLines),
    authorFamiliarityScore: authorFamiliarityScore(
      ctx.daysSinceAuthorLastDeploy
    ),
    deployTimingScore: deployTimingScore(input.deployedAt),
    historicalCorrelationScore: historicalCorrelationScore(
      ctx.incidentRate,
      ctx.sampleSize
    ),
  };

  const compositeScore = computeCompositeScore(subScores);

  return { ...subScores, compositeScore };
}
