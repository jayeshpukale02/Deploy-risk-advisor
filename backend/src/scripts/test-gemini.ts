/**
 * Quick smoke test for the GeminiExplanationProvider.
 * Run: npx ts-node --transpile-only src/scripts/test-gemini.ts
 */
import { GeminiExplanationProvider } from "../llm/GeminiExplanationProvider";

const provider = new GeminiExplanationProvider(
  process.env.GEMINI_API_KEY ?? ""
);

const mockSignals = {
  sensitivePathScore: 100,
  coverageDeltaScore: 65,
  changeSizeScore: 40,
  authorFamiliarityScore: 90,
  deployTimingScore: 95,
  historicalCorrelationScore: 0,
  compositeScore: 65,
};

const mockDiff = `
diff --git a/src/auth/login.ts b/src/auth/login.ts
index a1b2c3d..e4f5g6h 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -12,6 +12,12 @@ export async function loginUser(email: string, password: string) {
   const user = await db.user.findUnique({ where: { email } });
   if (!user) throw new AuthError("User not found");
+
+  // Temporary bypass for testing — REMOVE BEFORE PROD
+  if (process.env.SKIP_AUTH === "true") {
+    return generateToken(user.id);
+  }
+
   const valid = await bcrypt.compare(password, user.passwordHash);
   if (!valid) throw new AuthError("Invalid credentials");
`;

async function run() {
  console.log("=== Testing explainRisk ===");
  console.log("Signals:", JSON.stringify(mockSignals, null, 2));
  console.log("\nCalling Gemini...\n");

  const result = await provider.explainRisk(mockSignals, mockDiff);

  console.log("Result:");
  console.log("  refinedScore:", result.refinedScore);
  console.log("  source:", result.source);
  console.log("  explanation:", result.explanation);

  console.log("\n=== Testing recommendRollback ===");
  const rollback = await provider.recommendRollback(
    "test-deploy-id",
    mockSignals,
    0.72,
    [
      "AuthError: Invalid token signature at verifyToken (auth.ts:45)",
      "AuthError: Invalid token signature at verifyToken (auth.ts:45)",
      "TypeError: Cannot read property 'id' of undefined at loginUser (login.ts:18)",
    ]
  );

  console.log("Result:");
  console.log("  shouldRollback:", rollback.shouldRollback);
  console.log("  confidence:", rollback.confidence);
  console.log("  source:", rollback.source);
  console.log("  reasoning:", rollback.reasoning);
}

run().catch(console.error);
