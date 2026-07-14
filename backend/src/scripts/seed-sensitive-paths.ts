/**
 * Quick seed script: adds sensitive path patterns for the test repo.
 * Run with: npx ts-node src/scripts/seed-sensitive-paths.ts
 */
import prisma from "../db/prisma";

async function main() {
  const entries = [
    { repo: "acme-org/api-service", pattern: "src/auth/**" },
    { repo: "acme-org/api-service", pattern: "src/payments/**" },
    { repo: "acme-org/api-service", pattern: "config/**" },
  ];

  for (const entry of entries) {
    await prisma.sensitivePath.upsert({
      where: { repo_pattern: { repo: entry.repo, pattern: entry.pattern } },
      create: entry,
      update: {},
    });
    console.log(`✓ ${entry.repo}  →  ${entry.pattern}`);
  }

  console.log("\nSensitive paths seeded successfully.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
