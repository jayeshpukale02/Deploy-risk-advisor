import { Router, Request, Response } from "express";
import { z } from "zod";
import prisma from "../db/prisma";

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
 * Accepts a deploy payload, persists it to the DB.
 *
 * In Phase 1 the record is written with riskScore=0 and riskSignals={}.
 * Phase 2 will plug the deterministic scoring engine in here.
 * Phase 3 will plug the LLM synthesis layer in after that.
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

  try {
    const deploy = await prisma.deploy.create({
      data: {
        repo: data.repo,
        commitSha: data.commitSha,
        author: data.author,
        filesChanged: data.filesChanged,
        linesAdded: data.linesAdded,
        linesDeleted: data.linesDeleted,
        coverageDelta: data.coverageDelta ?? null,
        deployedAt: new Date(data.deployedAt),
        // Phase 1: placeholder — scoring added in Phase 2
        riskScore: 0,
        riskSignals: {},
        llmExplanation: null,
        outcome: null,
      },
    });

    console.log(`[webhook] New deploy stored: ${deploy.id} (${data.repo})`);

    res.status(201).json({
      id: deploy.id,
      repo: deploy.repo,
      commitSha: deploy.commitSha,
      riskScore: deploy.riskScore,
      message:
        "Deploy recorded. Scoring will be applied once the scoring engine is initialised (Phase 2).",
    });
  } catch (err) {
    console.error("[webhook] DB error:", err);
    res.status(500).json({ error: "Failed to store deploy record" });
  }
});

export default router;
