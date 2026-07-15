import { GoogleGenAI } from "@google/genai";
import type { RiskSignals } from "../types/deploy";
import type {
  ExplanationProvider,
  ExplanationResult,
  RollbackRecommendation,
} from "./ExplanationProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// gemini-flash-lite-latest resolves to the current Flash Lite model.
// The original spec requested "gemini-2.5-flash-lite" but that ID returns
// 404 for new API keys. This alias is the correct equivalent.
const MODEL = "gemini-flash-lite-latest";

/**
 * thinkingBudget: 0 — This task is bounded synthesis over pre-computed
 * signals, not open-ended reasoning. Internal thinking tokens add cost and
 * latency with no quality benefit here.
 */
const THINKING_CONFIG = { thinkingBudget: 0 };

// Score must stay in this valid range when parsed from LLM output
const SCORE_MIN = 0;
const SCORE_MAX = 100;

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildExplainRiskPrompt(signals: RiskSignals, diff: string): string {
  const diffSection =
    diff.trim().length > 0
      ? `\n## Code Diff (truncated to 3000 chars)\n\`\`\`\n${diff.slice(0, 3000)}\n\`\`\``
      : "\n## Code Diff\n(No diff provided — base your analysis on the signal breakdown only.)";

  return `You are a senior engineering reliability expert reviewing a code deployment.

## Deterministic Risk Signal Breakdown
Each signal is scored 0–100 (higher = riskier). The composite is weighted.

| Signal | Score | Weight |
|--------|-------|--------|
| Sensitive path coverage (auth/payments/config) | ${signals.sensitivePathScore} | 25% |
| Test coverage delta | ${signals.coverageDeltaScore} | 20% |
| Change size vs. historical average | ${signals.changeSizeScore} | 15% |
| Author familiarity with this codebase | ${signals.authorFamiliarityScore} | 15% |
| Historical incident correlation | ${signals.historicalCorrelationScore} | 15% |
| Deploy timing (day/hour risk) | ${signals.deployTimingScore} | 10% |
| **Composite deterministic score** | **${signals.compositeScore}** | — |
${diffSection}

## Your Task
1. Review the signal breakdown and the diff.
2. Produce a refined risk score (0–100) that may adjust the deterministic base.
   - You may nudge ±15 points if the diff reveals context the signals can't capture
     (e.g. the diff looks trivial despite touching auth, or the diff is a massive
     refactor the signals underestimated).
   - Do NOT drift more than 20 points from ${signals.compositeScore} without strong evidence.
3. Write a 2–4 sentence plain-English explanation of the primary risk factors.
   Be specific. Mention the most impactful signals by name.

## Output Format (STRICT JSON — no markdown, no extra text)
{
  "refinedScore": <integer 0–100>,
  "explanation": "<2–4 sentences>"
}`;
}

function buildRollbackPrompt(
  deployId: string,
  signals: RiskSignals,
  errorRateDelta: number,
  errorSamples: string[]
): string {
  const samplesText =
    errorSamples.length > 0
      ? errorSamples.slice(0, 5).join("\n- ")
      : "(no error samples provided)";

  return `You are an on-call SRE reviewing a post-deploy incident.

## Deploy Info
- Deploy ID: ${deployId}
- Pre-deploy risk score: ${signals.compositeScore}/100

## Risk Signals at Time of Deploy
- Sensitive paths touched: ${signals.sensitivePathScore}/100
- Coverage delta: ${signals.coverageDeltaScore}/100
- Change size: ${signals.changeSizeScore}/100
- Author familiarity: ${signals.authorFamiliarityScore}/100
- Deploy timing risk: ${signals.deployTimingScore}/100
- Historical correlation: ${signals.historicalCorrelationScore}/100

## Post-Deploy Error Data
- Error rate increase: +${(errorRateDelta * 100).toFixed(1)}% above baseline
- Sample errors:
- ${samplesText}

## Your Task
Decide whether to recommend an immediate rollback.
Consider: how severe is the error rate spike? Are the errors consistent with the
risk signals (e.g. auth errors after touching auth files)? Is this likely a
deploy-caused regression or pre-existing noise?

## Output Format (STRICT JSON — no markdown, no extra text)
{
  "shouldRollback": <true|false>,
  "confidence": <float 0.0–1.0>,
  "reasoning": "<2–4 sentences explaining the recommendation>"
}`;
}

// ---------------------------------------------------------------------------
// JSON parsing (defensive — strips markdown fences if present)
// ---------------------------------------------------------------------------

function stripMarkdownFences(text: string): string {
  // Gemini occasionally wraps JSON in ```json ... ``` or ``` ... ```
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

function parseExplainResult(
  raw: string,
  fallbackScore: number
): ExplanationResult {
  try {
    const cleaned = stripMarkdownFences(raw);
    const parsed = JSON.parse(cleaned) as {
      refinedScore?: unknown;
      explanation?: unknown;
    };

    const refinedScore =
      typeof parsed.refinedScore === "number" &&
      parsed.refinedScore >= SCORE_MIN &&
      parsed.refinedScore <= SCORE_MAX
        ? Math.round(parsed.refinedScore)
        : fallbackScore;

    const explanation =
      typeof parsed.explanation === "string" && parsed.explanation.trim().length > 0
        ? parsed.explanation.trim()
        : buildGenericExplanation(fallbackScore);

    return { refinedScore, explanation, source: "llm" };
  } catch {
    console.warn("[GeminiProvider] Failed to parse explainRisk response:", raw);
    return {
      refinedScore: fallbackScore,
      explanation: buildGenericExplanation(fallbackScore),
      source: "fallback",
    };
  }
}

function parseRollbackResult(
  raw: string,
  errorRateDelta: number
): RollbackRecommendation {
  try {
    const cleaned = stripMarkdownFences(raw);
    const parsed = JSON.parse(cleaned) as {
      shouldRollback?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };

    const shouldRollback =
      typeof parsed.shouldRollback === "boolean"
        ? parsed.shouldRollback
        : errorRateDelta > 0.5; // fallback heuristic

    const confidence =
      typeof parsed.confidence === "number" &&
      parsed.confidence >= 0 &&
      parsed.confidence <= 1
        ? parsed.confidence
        : 0.5;

    const reasoning =
      typeof parsed.reasoning === "string" && parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : "Unable to produce LLM reasoning. Recommendation based on error rate threshold.";

    return { shouldRollback, confidence, reasoning, source: "llm" };
  } catch {
    console.warn("[GeminiProvider] Failed to parse rollback response:", raw);
    return {
      shouldRollback: errorRateDelta > 0.5,
      confidence: 0.4,
      reasoning: "LLM response parsing failed. Recommendation based on error rate heuristic only.",
      source: "fallback",
    };
  }
}

function buildGenericExplanation(score: number): string {
  if (score >= 75)
    return `This deployment scored ${score}/100 on the deterministic risk engine, indicating high risk. Key risk factors include sensitive path coverage, test coverage changes, or elevated deploy timing risk. Review all signals carefully before proceeding.`;
  if (score >= 50)
    return `This deployment scored ${score}/100 on the deterministic risk engine, indicating moderate risk. Some signals are elevated — review the signal breakdown and ensure adequate monitoring is in place post-deploy.`;
  return `This deployment scored ${score}/100 on the deterministic risk engine, indicating low risk. Standard monitoring procedures apply.`;
}

// ---------------------------------------------------------------------------
// GeminiExplanationProvider
// ---------------------------------------------------------------------------

export class GeminiExplanationProvider implements ExplanationProvider {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error(
        "GeminiExplanationProvider: GEMINI_API_KEY is required but was not provided."
      );
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async explainRisk(signals: RiskSignals, diff: string): Promise<ExplanationResult> {
    try {
      const prompt = buildExplainRiskPrompt(signals, diff);

      const response = await this.ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          thinkingConfig: THINKING_CONFIG,
          temperature: 0.2, // low temperature for consistent, structured output
          maxOutputTokens: 512,
        },
      });

      const raw = response.text ?? "";
      if (!raw.trim()) {
        throw new Error("Gemini returned an empty response");
      }

      const result = parseExplainResult(raw, signals.compositeScore);
      console.log(
        `[GeminiProvider] explainRisk → score=${result.refinedScore} source=${result.source}`
      );
      return result;
    } catch (err) {
      // Graceful fallback — never crash the webhook over an LLM failure
      console.error("[GeminiProvider] explainRisk failed, using fallback:", err);
      return {
        refinedScore: signals.compositeScore,
        explanation: buildGenericExplanation(signals.compositeScore),
        source: "fallback",
      };
    }
  }

  async recommendRollback(
    deployId: string,
    signals: RiskSignals,
    errorRateDelta: number,
    errorSamples: string[]
  ): Promise<RollbackRecommendation> {
    try {
      const prompt = buildRollbackPrompt(deployId, signals, errorRateDelta, errorSamples);

      const response = await this.ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          thinkingConfig: THINKING_CONFIG,
          temperature: 0.1, // near-deterministic for safety-critical rollback decisions
          maxOutputTokens: 512,
        },
      });

      const raw = response.text ?? "";
      if (!raw.trim()) {
        throw new Error("Gemini returned an empty response");
      }

      const result = parseRollbackResult(raw, errorRateDelta);
      console.log(
        `[GeminiProvider] recommendRollback → shouldRollback=${result.shouldRollback} confidence=${result.confidence} source=${result.source}`
      );
      return result;
    } catch (err) {
      console.error("[GeminiProvider] recommendRollback failed, using fallback:", err);
      return {
        shouldRollback: errorRateDelta > 0.5,
        confidence: 0.4,
        reasoning: "LLM unavailable. Recommendation based on error rate heuristic only.",
        source: "fallback",
      };
    }
  }
}
