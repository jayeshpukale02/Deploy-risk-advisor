-- CreateTable
CREATE TABLE "Deploy" (
    "id" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "filesChanged" TEXT[],
    "linesAdded" INTEGER NOT NULL,
    "linesDeleted" INTEGER NOT NULL,
    "coverageDelta" DOUBLE PRECISION,
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskSignals" JSONB NOT NULL DEFAULT '{}',
    "llmExplanation" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deploy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SensitivePath" (
    "id" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,

    CONSTRAINT "SensitivePath_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deploy_repo_deployedAt_idx" ON "Deploy"("repo", "deployedAt");

-- CreateIndex
CREATE INDEX "Deploy_riskScore_idx" ON "Deploy"("riskScore");

-- CreateIndex
CREATE INDEX "SensitivePath_repo_idx" ON "SensitivePath"("repo");

-- CreateIndex
CREATE UNIQUE INDEX "SensitivePath_repo_pattern_key" ON "SensitivePath"("repo", "pattern");
