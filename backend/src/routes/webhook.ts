import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { scoreDeployment } from "../scoring/engine";
import { getExplanationProvider } from "../llm";

const router = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const DeployPayloadSchema = z.object({
  repo: z.string().min(1, "repo is required"),
  commitSha: z.string().min(1, "commitSha is required"),
  author: z.string().min(1, "author is required"),
  filesChanged: z
    .array(z.string())
    .min(1, "filesChanged must have at least one entry"),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
  coverageDelta: z.number().nullable().optional(),
  deployedAt: z
    .string()
    .datetime({ message: "deployedAt must be a valid ISO 8601 datetime" }),
  diff: z.string().optional(), // full diff text; stored for Phase 3 LLM use
});

// ---------------------------------------------------------------------------
// POST /webhook/deploy
// ---------------------------------------------------------------------------

/**
 * Accepts a deploy payload, scores it deterministically, then refines with LLM.
 *
 * Flow:
 *   1. Validate payload (Zod)
 *   2. Deterministic scoring engine → per-signal breakdown + composite score
 *   3. LLM synthesis → refined score + plain-English explanation
 *      (falls back to deterministic score if Gemini is unavailable)
 *   4. Persist Deploy record
 */
router.post("/deploy", async (req: Request, res: Response) => {
  const parseResult = DeployPayloadSchema.safeParse(req.body);

  if (!parseResult.success) {
    res.status(400).json({
      error: "Invalid payload",
      details: parseResult.error.flatten().fieldErrors,
    });
    return;
  }

  const data = parseResult.data;
  const deployedAt = new Date(data.deployedAt);

  try {
    // ── Phase 2: Deterministic scoring ──────────────────────────────────────
    const riskSignals = await scoreDeployment({
      repo: data.repo,
      author: data.author,
      filesChanged: data.filesChanged,
      linesAdded: data.linesAdded,
      linesDeleted: data.linesDeleted,
      coverageDelta: data.coverageDelta,
      deployedAt,
    });

    // ── Phase 3: LLM synthesis ───────────────────────────────────────────────
    const llmResult = await getExplanationProvider().explainRisk(
      riskSignals,
      data.diff ?? ""
    );

    const finalScore = llmResult.refinedScore;
    const deploy = await prisma.deploy.create({
      data: {
        repo: data.repo,
        commitSha: data.commitSha,
        author: data.author,
        filesChanged: data.filesChanged,
        linesAdded: data.linesAdded,
        linesDeleted: data.linesDeleted,
        coverageDelta: data.coverageDelta ?? null,
        deployedAt,
        riskScore: finalScore,
        riskSignals: riskSignals as unknown as Prisma.InputJsonValue,
        llmExplanation: llmResult.explanation,
        outcome: null,
      },
    });

    console.log(
      `[webhook] Deploy processed: ${deploy.id} | repo=${data.repo} | deterministicScore=${riskSignals.compositeScore} | finalScore=${finalScore} | llmSource=${llmResult.source}`
    );

    res.status(201).json({
      id: deploy.id,
      repo: deploy.repo,
      commitSha: deploy.commitSha,
      riskScore: finalScore,
      deterministicScore: riskSignals.compositeScore,
      riskSignals,
      llmExplanation: llmResult.explanation,
      llmSource: llmResult.source,
    });
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.status(500).json({ error: "Failed to score and store deploy record" });
  }
});

export default router;
