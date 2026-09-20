import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import { LIMITS } from "./limits";

/** Jitter is a fraction of `nodeSpacing`; half a cell is where a node would leave its own. */
const HALF_A_CELL = 0.5;

const RATE_MIN = 0;
const RATE_MAX = 1;

const districts = Object.values(BALANCE.districts);
const edges = Object.values(BALANCE.edges);

const expectRate = (value: number): void => {
  expect(value).toBeGreaterThanOrEqual(RATE_MIN);
  expect(value).toBeLessThanOrEqual(RATE_MAX);
};

describe("BALANCE is data", () => {
  it("round-trips through JSON", () => {
    expect(JSON.parse(JSON.stringify(BALANCE))).toEqual(BALANCE);
  });
});

describe("meters", () => {
  it("starts trust and pressure inside their own bounds", () => {
    const { startingTrust, trustMin, trustMax, startingPressure, pressureMin, pressureMax } =
      BALANCE.hunter;
    expect(startingTrust).toBeGreaterThan(trustMin);
    expect(startingTrust).toBeLessThan(trustMax);
    expect(startingPressure).toBeGreaterThanOrEqual(pressureMin);
    expect(startingPressure).toBeLessThan(pressureMax);
  });

  it("leaves pressure room to rise across a full hunt without pinning it early", () => {
    const { startingPressure, pressurePerTurn, pressureMax } = BALANCE.hunter;
    const atDeadline = startingPressure + pressurePerTurn * BALANCE.time.maxTurns;
    expect(atDeadline).toBeGreaterThan(startingPressure);
    expect(atDeadline).toBeLessThan(pressureMax);
  });

  it("starts the criminal's meters inside their maxima", () => {
    const { startingStamina, staminaMax, startingHeat, heatMax } = BALANCE.criminal;
    expect(startingStamina).toBeLessThanOrEqual(staminaMax);
    expect(startingHeat).toBeLessThan(heatMax);
    expect(BALANCE.criminal.profiles.amateur.hideAboveHeat).toBeLessThan(heatMax);
  });
});

describe("the hunt is winnable and losable", () => {
  it("gives the criminal a route that takes turns but fits in the deadline", () => {
    expect(BALANCE.map.minEscapeTurns).toBeGreaterThan(1);
    expect(BALANCE.map.minEscapeTurns).toBeLessThan(BALANCE.time.maxTurns);
  });

  /**
   * `river.ts` decides a node's bank from its grid cell but draws the water on the midline
   * between cells. The two can only agree while jitter cannot push a node across that midline.
   */
  it("keeps a node inside its own cell, which is what lets the river be drawn on the midline", () => {
    expect(BALANCE.map.positionJitter).toBeLessThan(HALF_A_CELL);
    expect(BALANCE.map.positionJitter).toBeGreaterThanOrEqual(0);
  });

  it("asks for a bridge range a river can actually satisfy", () => {
    expect(BALANCE.map.minBridges).toBeGreaterThan(0);
    expect(BALANCE.map.maxBridges).toBeGreaterThanOrEqual(BALANCE.map.minBridges);
  });

  it("affords at least one action per turn", () => {
    const costs = [
      BALANCE.actions.roadblock.actionPointCost,
      BALANCE.actions.canvass.actionPointCost,
      BALANCE.actions.pullCctv.actionPointCost,
      BALANCE.actions.trueBriefing.actionPointCost,
    ];
    for (const cost of costs) {
      expect(cost).toBeGreaterThan(0);
      expect(cost).toBeLessThanOrEqual(BALANCE.hunter.actionPointsPerTurn);
    }
  });

  it("keeps a full turn of roadblocks affordable at the start", () => {
    const perTurn = BALANCE.actions.roadblock.budgetCost * BALANCE.hunter.actionPointsPerTurn;
    expect(perTurn).toBeLessThan(BALANCE.hunter.startingBudget);
  });
});

describe("district table", () => {
  it("keeps every rate in [0, 1]", () => {
    for (const district of districts) {
      expectRate(district.witnessDensity);
      expectRate(district.nightWitnessMultiplier);
      expectRate(district.hidingSpots);
      expectRate(district.cctvCoverage);
    }
  });

  it("empties the park after dark and nearly empties industrial, per DESIGN.md", () => {
    expect(BALANCE.districts.park.nightWitnessMultiplier).toBe(0);
    expect(BALANCE.districts.park.cctvCoverage).toBe(0);
    expect(BALANCE.districts.industrial.nightWitnessMultiplier).toBeLessThan(
      BALANCE.districts.residential.nightWitnessMultiplier,
    );
  });

  it("makes the crowded districts the watched ones", () => {
    expect(BALANCE.districts.downtown.witnessDensity).toBeGreaterThan(
      BALANCE.districts.suburb.witnessDensity,
    );
    expect(BALANCE.districts.transit_hub.cctvCoverage).toBeGreaterThan(
      BALANCE.districts.residential.cctvCoverage,
    );
  });
});

describe("edge table", () => {
  it("leaves every edge kind usable by some mode", () => {
    for (const edge of edges) {
      const usable = Object.values(edge.costByMode).filter((cost): cost is number => cost !== null);
      expect(usable.length).toBeGreaterThan(0);
      for (const cost of usable) {
        expect(cost).toBeGreaterThan(0);
      }
    }
  });

  it("leaves a way round a roadblock on foot", () => {
    expect(BALANCE.edges.road.blockable).toBe(true);
    expect(BALANCE.edges.bridge.blockable).toBe(true);
    expect(BALANCE.edges.footpath.blockable).toBe(false);
    expect(BALANCE.edges.footpath.costByMode.foot).not.toBeNull();
  });

  it("makes a car faster than walking where both can go", () => {
    const { car, foot } = BALANCE.edges.road.costByMode;
    if (car === null || foot === null) {
      throw new Error("a road must be usable both on foot and by car");
    }
    expect(car).toBeLessThan(foot);
  });
});

describe("reports", () => {
  it("keeps accuracy inside a band that leaves room for doubt", () => {
    const { minAccuracy, maxAccuracy, baseSightingAccuracy, cctvAccuracy } = BALANCE.reports;
    expect(minAccuracy).toBeGreaterThan(RATE_MIN);
    expect(maxAccuracy).toBeLessThan(RATE_MAX);
    expect(baseSightingAccuracy).toBeGreaterThanOrEqual(minAccuracy);
    expect(baseSightingAccuracy).toBeLessThanOrEqual(maxAccuracy);
    expect(cctvAccuracy).toBeGreaterThan(baseSightingAccuracy);
  });

  it("delivers CCTV late, always", () => {
    const { minDelayTurns, maxDelayTurns } = BALANCE.actions.pullCctv;
    expect(minDelayTurns).toBeGreaterThan(0);
    expect(maxDelayTurns).toBeGreaterThanOrEqual(minDelayTurns);
  });

  /**
   * The camera can only show what the criminal's trail still remembers (PLAN M3.8b-2), so a
   * lookback past the cap would quietly return empty footage instead of failing.
   */
  it("asks for no more footage than the criminal's trail keeps", () => {
    const { lookbackTurns } = BALANCE.actions.pullCctv;
    expect(lookbackTurns).toBeGreaterThan(0);
    expect(lookbackTurns).toBeLessThanOrEqual(LIMITS.maxCriminalTrail);
  });

  it("caps pranks below certainty and lets media raise them", () => {
    const { basePrankRate, prankRatePerBriefing, maxPrankRate } = BALANCE.reports;
    expect(prankRatePerBriefing).toBeGreaterThan(0);
    expect(basePrankRate).toBeLessThan(maxPrankRate);
    expect(maxPrankRate).toBeLessThan(RATE_MAX);
  });

  it("leaves room for a witness to be wrong without making most of them wrong", () => {
    const { falseReportRate } = BALANCE.reports;
    expect(falseReportRate).toBeGreaterThan(RATE_MIN);
    expect(falseReportRate).toBeLessThan(RATE_MAX / 2);
  });

  /** A canvass is immediate because the hunter is there; nobody asked for the rest (PLAN M3.6). */
  it("never delivers an unprompted call the turn it was made", () => {
    expect(BALANCE.reports.unpromptedDelayTurns).toBeGreaterThan(0);
  });
});

describe("criminal pools", () => {
  const pools = Object.values(BALANCE.criminal.pools);

  it("only ever draws a profile that has weights to play with", () => {
    const withWeights = Object.keys(BALANCE.criminal.profiles);
    for (const pool of pools) {
      for (const entry of pool) {
        expect(withWeights).toContain(entry.value);
      }
    }
  });

  it("gives every difficulty something to draw", () => {
    for (const pool of pools) {
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.some((entry) => entry.weight > 0)).toBe(true);
    }
  });
});

describe("score weights", () => {
  it("scores only a capture on the outcome alone", () => {
    for (const [kind, base] of Object.entries(BALANCE.score.outcomeBase)) {
      const expected = kind === "captured" ? base > 0 : base === 0;
      expect(expected).toBe(true);
    }
  });

  it("makes the worst capture beat the best loss", () => {
    const { score, hunter, time, endConditions } = BALANCE;
    const worstCapture =
      score.outcomeBase.captured -
      time.maxTurns * score.turnPenalty -
      hunter.startingBudget * score.budgetPenaltyPerUnit -
      (endConditions.casualtiesToLose - 1) * score.casualtyPenalty;
    const bestLoss = score.outcomeBase.escaped + hunter.trustMax * score.trustBonusPerPoint;

    expect(worstCapture).toBeGreaterThan(bestLoss);
    expect(worstCapture).toBeGreaterThan(score.minimumScore);
  });

  it("keeps every weight a penalty or a bonus, never a sign flip", () => {
    const { turnPenalty, budgetPenaltyPerUnit, casualtyPenalty, trustBonusPerPoint } =
      BALANCE.score;
    for (const weight of [turnPenalty, budgetPenaltyPerUnit, casualtyPenalty, trustBonusPerPoint]) {
      expect(weight).toBeGreaterThan(0);
    }
  });
});
