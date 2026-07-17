import { Router, Request, Response } from "express";
import prisma from "../db/prisma";

const router = Router();

// ---------------------------------------------------------------------------
// GET /deploys
// ---------------------------------------------------------------------------

/**
 * Returns paginated deploy history with aggregate statistics.
 *
 * Query parameters:
 *   page      number  (default 1)
 *   limit     number  (default 20, max 100)
 *   sort      "deployedAt" | "riskScore"  (default "deployedAt")
 *   order     "asc" | "desc"              (default "desc")
 *   repo      string  (exact match filter)
 *   minScore  number  (minimum riskScore filter)
 */
router.get("/", async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20)
  );
  const sort =
    req.query.sort === "riskScore" ? "riskScore" : "deployedAt";
  const order: "asc" | "desc" =
    req.query.order === "asc" ? "asc" : "desc";
  const repoFilter = req.query.repo ? String(req.query.repo) : undefined;
  const minScore = req.query.minScore
    ? parseInt(String(req.query.minScore), 10)
    : undefined;

  const where = {
    ...(repoFilter ? { repo: repoFilter } : {}),
    ...(minScore !== undefined ? { riskScore: { gte: minScore } } : {}),
  };

  try {
    const [deploys, totalCount, allScores, highRiskStats] = await Promise.all([
      // Page of deploys
      prisma.deploy.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          repo: true,
          commitSha: true,
          author: true,
          filesChanged: true,
          linesAdded: true,
          linesDeleted: true,
          coverageDelta: true,
          deployedAt: true,
          riskScore: true,
          riskSignals: true,
          llmExplanation: true,
          outcome: true,
          createdAt: true,
        },
      }),

      // Total count for pagination
      prisma.deploy.count({ where }),

      // Average risk score across ALL deploys (not just this page)
      prisma.deploy.aggregate({
        where,
        _avg: { riskScore: true },
      }),

      // High-risk accuracy stats: deploys with score ≥ 75 that have an outcome
      prisma.deploy.findMany({
        where: {
          ...where,
          riskScore: { gte: 75 },
          outcome: { not: null },
        },
        select: { outcome: true },
      }),
    ]);

    // Accuracy rate: what % of high-risk (≥75) deploys that got an outcome
    // were actually incidents or rollbacks?
    const highRiskWithOutcome = highRiskStats.length;
    const highRiskBadOutcome = highRiskStats.filter(
      (d) => d.outcome === "incident" || d.outcome === "rolled_back"
    ).length;
    const accuracyRate =
      highRiskWithOutcome > 0
        ? Math.round((highRiskBadOutcome / highRiskWithOutcome) * 100)
        : null;

    // High-risk count on this page (for the stats bar)
    const highRiskTotal = await prisma.deploy.count({
      where: { ...where, riskScore: { gte: 75 } },
    });

    res.json({
      deploys,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
      stats: {
        totalDeploys: totalCount,
        avgRiskScore:
          allScores._avg.riskScore !== null
            ? Math.round(allScores._avg.riskScore)
            : null,
        highRiskCount: highRiskTotal,
        accuracyRate,
        highRiskWithOutcome,
      },
    });
  } catch (err) {
    console.error("[deploys] Error:", err);
    res.status(500).json({ error: "Failed to fetch deploys" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /deploys/:id/outcome
// ---------------------------------------------------------------------------

/**
 * Records the real-world outcome of a deploy.
 * Used by the dashboard and Phase 6 rollback advisor to feed the accuracy tracker.
 */
router.patch("/:id/outcome", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { outcome } = req.body as { outcome?: string };

  const validOutcomes = ["safe", "incident", "rolled_back"];
  if (!outcome || !validOutcomes.includes(outcome)) {
    res.status(400).json({
      error: `outcome must be one of: ${validOutcomes.join(", ")}`,
    });
    return;
  }

  try {
    const deploy = await prisma.deploy.update({
      where: { id },
      data: { outcome },
      select: { id: true, outcome: true, riskScore: true },
    });
    res.json(deploy);
  } catch (err) {
    console.error("[deploys] outcome update error:", err);
    res.status(500).json({ error: "Failed to update outcome" });
  }
});

export default router;
