import { Router, Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "../db/prisma";
import { scoreDeployment } from "../scoring/engine";

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
 * Accepts a deploy payload, scores it deterministically, and persists it.
 *
 * Flow:
 *   1. Validate payload (Zod)
 *   2. Run deterministic scoring engine → per-signal breakdown + composite score
 *   3. Persist Deploy record with real risk scores
 *   4. (Phase 3 will add LLM synthesis here, after step 2)
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

    // ── Phase 3 slot: LLM synthesis will go here ─────────────────────────────
    // const llmResult = await explanationProvider.explainRisk(riskSignals, data.diff ?? "");

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
        riskScore: riskSignals.compositeScore,
        riskSignals: riskSignals as unknown as Prisma.InputJsonValue,
        llmExplanation: null, // Phase 3
        outcome: null,
      },
    });

    console.log(
      `[webhook] Deploy scored: ${deploy.id} | repo=${data.repo} | score=${riskSignals.compositeScore}`
    );

    res.status(201).json({
      id: deploy.id,
      repo: deploy.repo,
      commitSha: deploy.commitSha,
      riskScore: riskSignals.compositeScore,
      riskSignals,
    });
  } catch (err) {
    console.error("[webhook] Error:", err);
    res.status(500).json({ error: "Failed to score and store deploy record" });
  }
});

export default router;
