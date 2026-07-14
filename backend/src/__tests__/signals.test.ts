import {
  sensitivePathScore,
  coverageDeltaScore,
  changeSizeScore,
  authorFamiliarityScore,
  deployTimingScore,
  historicalCorrelationScore,
} from "../scoring/signals";
import { computeCompositeScore, SIGNAL_WEIGHTS } from "../scoring/engine";

// ---------------------------------------------------------------------------
// Signal 1: sensitivePathScore
// ---------------------------------------------------------------------------

describe("sensitivePathScore", () => {
  it("returns 0 when no patterns are configured", () => {
    expect(sensitivePathScore(["src/auth/login.ts"], [])).toBe(0);
  });

  it("returns 0 when no files are changed", () => {
    expect(sensitivePathScore([], ["auth/**"])).toBe(0);
  });

  it("returns 0 when no files match any pattern", () => {
    expect(
      sensitivePathScore(["src/utils/helper.ts", "README.md"], ["auth/**", "payments/**"])
    ).toBe(0);
  });

  it("returns 30 when ≤25% of files match", () => {
    // 1/4 = 25% — boundary, score should be 30
    // pattern must match the full relative path prefix
    expect(
      sensitivePathScore(
        ["src/auth/login.ts", "README.md", "src/utils/a.ts", "src/utils/b.ts"],
        ["src/auth/**"]
      )
    ).toBe(30);
  });

  it("returns 55 when ~50% of files match", () => {
    expect(
      sensitivePathScore(
        ["src/auth/login.ts", "src/payments/checkout.ts", "README.md", "src/utils/helper.ts"],
        ["src/auth/**", "src/payments/**"]
      )
    ).toBe(55);
  });

  it("returns 100 when ALL files are in sensitive paths", () => {
    expect(
      sensitivePathScore(
        ["src/auth/login.ts", "src/auth/register.ts"],
        ["src/auth/**"]
      )
    ).toBe(100);
  });

  it("matches deep glob patterns correctly", () => {
    expect(
      sensitivePathScore(["config/secrets/db.yml"], ["config/**"])
    ).toBe(100);
  });

  it("matches dot-files in sensitive paths", () => {
    expect(
      sensitivePathScore([".env", "src/index.ts"], ["**/.env"])
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Signal 2: coverageDeltaScore
// ---------------------------------------------------------------------------

describe("coverageDeltaScore", () => {
  it("returns 25 for null (unknown)", () => {
    expect(coverageDeltaScore(null)).toBe(25);
  });

  it("returns 25 for undefined (unknown)", () => {
    expect(coverageDeltaScore(undefined)).toBe(25);
  });

  it("returns 0 for a +2pp or more improvement", () => {
    expect(coverageDeltaScore(2)).toBe(0);
    expect(coverageDeltaScore(10)).toBe(0);
  });

  it("returns 5 for a small positive delta", () => {
    expect(coverageDeltaScore(0.5)).toBe(5);
    expect(coverageDeltaScore(1.9)).toBe(5);
  });

  it("returns 20 for no change", () => {
    expect(coverageDeltaScore(0)).toBe(20);
  });

  it("returns 45 for a small decline (0 to -5pp)", () => {
    expect(coverageDeltaScore(-1)).toBe(45);
    expect(coverageDeltaScore(-4.9)).toBe(45);
  });

  it("returns 65 for a moderate decline (-5 to -10pp)", () => {
    expect(coverageDeltaScore(-5)).toBe(65);
    expect(coverageDeltaScore(-9.9)).toBe(65);
  });

  it("returns 82 for a significant decline (-10 to -20pp)", () => {
    expect(coverageDeltaScore(-10)).toBe(82);
    expect(coverageDeltaScore(-19.9)).toBe(82);
  });

  it("returns 100 for severe decline (≤-20pp)", () => {
    expect(coverageDeltaScore(-20)).toBe(100);
    expect(coverageDeltaScore(-50)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Signal 3: changeSizeScore
// ---------------------------------------------------------------------------

describe("changeSizeScore", () => {
  it("returns 40 when no historical data exists", () => {
    expect(changeSizeScore(100, null)).toBe(40);
  });

  it("returns 40 when historicalAvg is 0 (div-by-zero guard)", () => {
    expect(changeSizeScore(100, 0)).toBe(40);
  });

  it("returns 5 for a tiny change (ratio ≤ 0.5)", () => {
    expect(changeSizeScore(10, 100)).toBe(5); // ratio = 0.1
    expect(changeSizeScore(50, 100)).toBe(5); // ratio = 0.5
  });

  it("returns 15 for a normal-sized change (ratio ≤ 1.0)", () => {
    expect(changeSizeScore(80, 100)).toBe(15); // ratio = 0.8
    expect(changeSizeScore(100, 100)).toBe(15); // ratio = 1.0
  });

  it("returns 25 for a slightly big change (ratio ≤ 1.5)", () => {
    expect(changeSizeScore(150, 100)).toBe(25);
  });

  it("returns 40 for a 2x change", () => {
    expect(changeSizeScore(200, 100)).toBe(40);
  });

  it("returns 60 for a 3x change", () => {
    expect(changeSizeScore(300, 100)).toBe(60);
  });

  it("returns 80 for a 5x change", () => {
    expect(changeSizeScore(500, 100)).toBe(80);
  });

  it("returns 100 for a massively outsized change (> 5x)", () => {
    expect(changeSizeScore(600, 100)).toBe(100);
    expect(changeSizeScore(10000, 100)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Signal 4: authorFamiliarityScore
// ---------------------------------------------------------------------------

describe("authorFamiliarityScore", () => {
  it("returns 90 for a first-time author (null)", () => {
    expect(authorFamiliarityScore(null)).toBe(90);
  });

  it("returns 0 for a commit made today (0 days)", () => {
    expect(authorFamiliarityScore(0)).toBe(0);
  });

  it("returns 5 for ≤30 days", () => {
    expect(authorFamiliarityScore(1)).toBe(5);
    expect(authorFamiliarityScore(30)).toBe(5);
  });

  it("returns 15 for 31–90 days", () => {
    expect(authorFamiliarityScore(31)).toBe(15);
    expect(authorFamiliarityScore(90)).toBe(15);
  });

  it("returns 35 for 91–180 days", () => {
    expect(authorFamiliarityScore(91)).toBe(35);
    expect(authorFamiliarityScore(180)).toBe(35);
  });

  it("returns 55 for 181–365 days", () => {
    expect(authorFamiliarityScore(181)).toBe(55);
    expect(authorFamiliarityScore(365)).toBe(55);
  });

  it("returns 75 for more than a year", () => {
    expect(authorFamiliarityScore(366)).toBe(75);
    expect(authorFamiliarityScore(1000)).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// Signal 5: deployTimingScore
// ---------------------------------------------------------------------------

/** Helper: build a UTC Date with a specific day/hour */
function utcDate(year: number, month: number, day: number, hour: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
}

describe("deployTimingScore", () => {
  // 2026-07-10 is a Friday
  it("returns 95 for Friday afternoon (15:00–23:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 10, 15))).toBe(95);
    expect(deployTimingScore(utcDate(2026, 7, 10, 20))).toBe(95);
  });

  it("returns 70 for Friday morning (09:00–14:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 10, 9))).toBe(70);
    expect(deployTimingScore(utcDate(2026, 7, 10, 14))).toBe(70);
  });

  it("returns 55 for Friday pre-hours (00:00–08:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 10, 0))).toBe(55);
    expect(deployTimingScore(utcDate(2026, 7, 10, 8))).toBe(55);
  });

  // 2026-07-11 is Saturday, 2026-07-12 is Sunday
  it("returns 85 for Saturday", () => {
    expect(deployTimingScore(utcDate(2026, 7, 11, 12))).toBe(85);
  });

  it("returns 85 for Sunday", () => {
    expect(deployTimingScore(utcDate(2026, 7, 12, 10))).toBe(85);
  });

  // 2026-07-13 is Monday
  it("returns 10 for Monday–Thursday during business hours (09:00–17:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 13, 9))).toBe(10);
    expect(deployTimingScore(utcDate(2026, 7, 13, 14))).toBe(10);
    expect(deployTimingScore(utcDate(2026, 7, 13, 17))).toBe(10);
  });

  it("returns 40 for Mon–Thu after hours (18:00–23:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 13, 18))).toBe(40);
    expect(deployTimingScore(utcDate(2026, 7, 13, 23))).toBe(40);
  });

  it("returns 40 for Mon–Thu pre-hours (00:00–08:59 UTC)", () => {
    expect(deployTimingScore(utcDate(2026, 7, 13, 0))).toBe(40);
    expect(deployTimingScore(utcDate(2026, 7, 13, 8))).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// Signal 6: historicalCorrelationScore
// ---------------------------------------------------------------------------

describe("historicalCorrelationScore", () => {
  it("returns 0 for no prior deploys", () => {
    expect(historicalCorrelationScore(null, 0)).toBe(0);
  });

  it("returns 0 for a null incident rate", () => {
    expect(historicalCorrelationScore(null, 10)).toBe(0);
  });

  it("returns 0 for a 0% incident rate", () => {
    expect(historicalCorrelationScore(0, 20)).toBe(0);
  });

  it("applies confidence damping below 5 samples", () => {
    // 1/3 deploys = 33% rate, but only 3 samples (confidence = 3/5 = 0.6)
    // score = 33 * 0.6 ≈ 20
    expect(historicalCorrelationScore(1 / 3, 3)).toBe(20);
  });

  it("returns full rate × 100 when sample ≥ 5", () => {
    // 20% rate, 10 samples → score = 20
    expect(historicalCorrelationScore(0.2, 10)).toBe(20);
    // 50% rate, 5 samples → score = 50
    expect(historicalCorrelationScore(0.5, 5)).toBe(50);
  });

  it("returns 100 at 100% incident rate with enough samples", () => {
    expect(historicalCorrelationScore(1.0, 10)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Composite scorer: weights validation
// ---------------------------------------------------------------------------

describe("computeCompositeScore", () => {
  it("weights sum to exactly 1.0", () => {
    const sum = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("returns 0 when all sub-scores are 0", () => {
    expect(
      computeCompositeScore({
        sensitivePathScore: 0,
        coverageDeltaScore: 0,
        changeSizeScore: 0,
        authorFamiliarityScore: 0,
        deployTimingScore: 0,
        historicalCorrelationScore: 0,
      })
    ).toBe(0);
  });

  it("returns 100 when all sub-scores are 100", () => {
    expect(
      computeCompositeScore({
        sensitivePathScore: 100,
        coverageDeltaScore: 100,
        changeSizeScore: 100,
        authorFamiliarityScore: 100,
        deployTimingScore: 100,
        historicalCorrelationScore: 100,
      })
    ).toBe(100);
  });

  it("clamps the composite score to [0, 100]", () => {
    // Should never exceed 100 even with floating-point drift
    const score = computeCompositeScore({
      sensitivePathScore: 100,
      coverageDeltaScore: 100,
      changeSizeScore: 100,
      authorFamiliarityScore: 100,
      deployTimingScore: 100,
      historicalCorrelationScore: 100,
    });
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("computes a realistic mid-range score correctly", () => {
    // sensitivePathScore=100  × 0.25 = 25
    // coverageDeltaScore=65   × 0.20 = 13
    // changeSizeScore=25      × 0.15 = 3.75
    // authorFamiliarityScore=0× 0.15 = 0
    // deployTimingScore=10    × 0.10 = 1
    // historicalCorrelation=0 × 0.15 = 0
    // Total = 42.75 → rounds to 43
    expect(
      computeCompositeScore({
        sensitivePathScore: 100,
        coverageDeltaScore: 65,
        changeSizeScore: 25,
        authorFamiliarityScore: 0,
        deployTimingScore: 10,
        historicalCorrelationScore: 0,
      })
    ).toBe(43);
  });
});
