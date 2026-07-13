/**
 * Shared TypeScript types for the Deploy Risk Advisor.
 *
 * These types mirror the Prisma schema but are kept separate so that
 * business logic modules (scoring, LLM layer) can import clean types
 * without depending on the Prisma client directly.
 */

// ---------------------------------------------------------------------------
// Webhook / ingest
// ---------------------------------------------------------------------------

/** The raw payload accepted by POST /webhook/deploy */
export interface DeployPayload {
  repo: string;
  commitSha: string;
  author: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  /** Optional — percentage-point delta in test coverage */
  coverageDelta?: number | null;
  deployedAt: string; // ISO 8601 string; parsed to Date before DB write
  /** Optional full diff text; used by the LLM layer (Phase 3+) */
  diff?: string;
}

// ---------------------------------------------------------------------------
// Risk signals (Phase 2+)
// ---------------------------------------------------------------------------

/**
 * The output of the deterministic scoring layer.
 * Each field maps to one signal. Values are 0–100 sub-scores (higher = riskier).
 */
export interface RiskSignals {
  /** Files match a configured sensitive-path pattern */
  sensitivePathScore: number;
  /** Test coverage decreased */
  coverageDeltaScore: number;
  /** Change size vs. historical average for this repo */
  changeSizeScore: number;
  /** Author unfamiliarity with touched files/service */
  authorFamiliarityScore: number;
  /** Day/time of deploy (e.g. Friday afternoon) */
  deployTimingScore: number;
  /** Historical correlation: similar signals → past incident */
  historicalCorrelationScore: number;
  /** Weighted composite 0–100 */
  compositeScore: number;
}

// ---------------------------------------------------------------------------
// LLM synthesis (Phase 3+)
// ---------------------------------------------------------------------------

/** Result from the ExplanationProvider */
export interface ExplanationResult {
  /** LLM-refined score 0–100 */
  refinedScore: number;
  /** Plain-English explanation of risk */
  explanation: string;
}

// ---------------------------------------------------------------------------
// Deploy record (mirrors Prisma model)
// ---------------------------------------------------------------------------

export type DeployOutcome = "safe" | "incident" | "rolled_back";

export interface DeployRecord {
  id: string;
  repo: string;
  commitSha: string;
  author: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
  coverageDelta: number | null;
  deployedAt: Date;
  riskScore: number;
  riskSignals: RiskSignals | Record<string, never>;
  llmExplanation: string | null;
  outcome: DeployOutcome | null;
  createdAt: Date;
}
