import type { RiskSignals } from "../types/deploy";

/**
 * ExplanationProvider — interface for the LLM synthesis layer.
 *
 * ARCHITECTURE NOTE:
 * All calling code must depend ONLY on this interface, never on a concrete
 * implementation or on the Gemini SDK directly. This makes the LLM provider
 * swappable (e.g. Gemini → Claude → GPT-4) as a single config change with
 * zero rewrites to business logic.
 */
export interface ExplanationProvider {
  /**
   * Takes the deterministic signal breakdown + the code diff and returns:
   *   - refinedScore: a 0–100 score that may adjust the deterministic base
   *     (the LLM can up- or down-weight based on diff context)
   *   - explanation: plain-English reasoning for the risk level
   *
   * IMPORTANT: must NEVER throw. On failure, implementations must return a
   * graceful fallback (deterministic score + generic explanation).
   */
  explainRisk(
    signals: RiskSignals,
    diff: string
  ): Promise<ExplanationResult>;

  /**
   * Variant used by the Rollback Advisor (Phase 6).
   * Takes error-rate data post-deploy and recommends whether to roll back.
   */
  recommendRollback(
    deployId: string,
    signals: RiskSignals,
    errorRateDelta: number,
    errorSamples: string[]
  ): Promise<RollbackRecommendation>;
}

export interface ExplanationResult {
  /** LLM-refined risk score 0–100 */
  refinedScore: number;
  /** Plain-English explanation of why this deploy is risky (or safe) */
  explanation: string;
  /** Whether the result came from the LLM or fell back to deterministic */
  source: "llm" | "fallback";
}

export interface RollbackRecommendation {
  /** true = recommend rolling back immediately */
  shouldRollback: boolean;
  /** Confidence 0–1 in the rollback recommendation */
  confidence: number;
  /** Plain-English reasoning */
  reasoning: string;
  source: "llm" | "fallback";
}
