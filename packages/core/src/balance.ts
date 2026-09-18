/**
 * Every number the rules turn on, in one place (AGENTS.md "Numbers live in one place").
 * DESIGN.md says what each knob means; this file says what it is set to, and PLAN M4.3 is what
 * tunes it once `sim` can measure a batch of games.
 *
 * Balance is data, so logic takes it as an argument rather than importing it: a rule module is
 * `(deps, balance: Balance, ...)` and `BALANCE` is wired at the composition root. That is what
 * lets a balance sweep run several settings in one process without mocking a module.
 *
 * Bounds that stop a loop running away are not balance; they live in `limits.ts`.
 */

import type { MapConfig } from "./config";
import type { DistrictType, EdgeKind, EdgeProperties } from "./map";
import type { GameOutcome } from "./world";

/** The numeric form of DESIGN.md's "District properties" table. Every rate is in [0, 1]. */
export type DistrictProperties = {
  /** Chance the district yields a witness to the criminal passing through it, by day. */
  readonly witnessDensity: number;
  /** Multiplies `witnessDensity` after dark. */
  readonly nightWitnessMultiplier: number;
  /** How well the district hides someone who stops moving. Drives heat loss while hiding. */
  readonly hidingSpots: number;
  /** Chance a CCTV pull on the district returns anything at all. */
  readonly cctvCoverage: number;
};

const DISTRICTS: Readonly<Record<DistrictType, DistrictProperties>> = {
  downtown: {
    witnessDensity: 0.8,
    nightWitnessMultiplier: 0.6,
    hidingSpots: 0.8,
    cctvCoverage: 0.9,
  },
  residential: {
    witnessDensity: 0.5,
    nightWitnessMultiplier: 0.5,
    hidingSpots: 0.5,
    cctvCoverage: 0.2,
  },
  suburb: {
    witnessDensity: 0.25,
    nightWitnessMultiplier: 0.6,
    hidingSpots: 0.2,
    cctvCoverage: 0.15,
  },
  industrial: {
    witnessDensity: 0.2,
    nightWitnessMultiplier: 0.1,
    hidingSpots: 0.85,
    cctvCoverage: 0.5,
  },
  /** DESIGN.md: no witnesses at all after dark, which is what makes a park a night corridor. */
  park: {
    witnessDensity: 0.45,
    nightWitnessMultiplier: 0,
    hidingSpots: 0.55,
    cctvCoverage: 0,
  },
  transit_hub: {
    witnessDensity: 0.85,
    nightWitnessMultiplier: 0.5,
    hidingSpots: 0.2,
    cctvCoverage: 0.9,
  },
  /** DESIGN.md's table has no row for exits. They are watched but thinly populated. */
  exit: {
    witnessDensity: 0.4,
    nightWitnessMultiplier: 0.5,
    hidingSpots: 0.2,
    cctvCoverage: 0.6,
  },
};

/**
 * Travel cost is in turns, so a path cost compares directly against the clock and against
 * `map.minEscapeTurns`. `null` means the mode cannot use the edge at all.
 *
 * Footpaths are deliberately not blockable: a roadblock is a vehicle checkpoint, and leaving one
 * kind of edge open on foot is what stops a single well-placed block from ending the hunt.
 */
const EDGES: Readonly<Record<EdgeKind, EdgeProperties>> = {
  road: { costByMode: { foot: 2, car: 1, transit: null }, blockable: true },
  footpath: { costByMode: { foot: 1, car: null, transit: null }, blockable: false },
  rail: { costByMode: { foot: null, car: null, transit: 1 }, blockable: true },
  tunnel: { costByMode: { foot: 2, car: 1, transit: null }, blockable: true },
  bridge: { costByMode: { foot: 2, car: 1, transit: null }, blockable: true },
};

/** Utility weights for DESIGN.md's decision model. PLAN M6 adds a sibling per new profile. */
export type CriminalProfileWeights = {
  readonly exitProgress: number;
  readonly perceivedRisk: number;
  /** Magnitude of the random term that keeps a profile from being solvable by inspection. */
  readonly noise: number;
  readonly hideAboveHeat: number;
  /** Per-turn chance of hurting a civilian, which confirms a location for free. */
  readonly civilianHarmChance: number;
};

const AMATEUR: CriminalProfileWeights = {
  exitProgress: 1,
  perceivedRisk: 0.7,
  noise: 0.35,
  hideAboveHeat: 60,
  civilianHarmChance: 0.06,
};

const DEFAULT_MAP: MapConfig = { columns: 8, rows: 6, exitCount: 3 };

/**
 * What each ending is worth before the components are applied. Only a capture scores a base:
 * DESIGN.md scores the win, and a loss is left to be told apart by its components.
 */
const OUTCOME_BASE: Readonly<Record<GameOutcome["kind"], number>> = {
  in_progress: 0,
  captured: 1200,
  escaped: 0,
  trust_collapsed: 0,
  casualties_exceeded: 0,
  bankrupt: 0,
};

export const BALANCE = {
  time: {
    maxTurns: 24,
    /** Which hours count as night, per `TimeOfDay` in `time.ts`. Night is [21, 06). */
    nightStartHour: 21,
    dayStartHour: 6,
    rushHourHours: [7, 8, 17, 18],
  },

  map: {
    defaults: DEFAULT_MAP,
    /** DESIGN.md "Generation validity": the criminal must need this many turns to reach an exit. */
    minEscapeTurns: 6,
    /** One roadblock never wins. */
    minCutToExits: 2,
    minBridges: 2,
    maxBridges: 3,
  },

  hunter: {
    actionPointsPerTurn: 3,
    startingBudget: 1000,
    startingTrust: 70,
    trustMin: 0,
    trustMax: 100,
    startingPressure: 10,
    pressureMin: 0,
    pressureMax: 100,
    /**
     * Pressure is display-only in the MVP (DESIGN.md "Hunter resources"): it rises, it is shown,
     * and nothing reads it until M6's override events. Twenty-four turns of this plus one
     * casualty brings it near the top without a quiet game ever pinning it there.
     */
    pressurePerTurn: 3,
    pressurePerCasualty: 15,
  },

  actions: {
    roadblock: { actionPointCost: 1, budgetCost: 50, trustCost: 3, durationTurns: 4 },
    canvass: { actionPointCost: 1, budgetCost: 20, trustCost: 1 },
    /** DESIGN.md: reliable, and about the past. Delay and lookback are both in turns. */
    pullCctv: {
      actionPointCost: 1,
      budgetCost: 30,
      minDelayTurns: 1,
      maxDelayTurns: 2,
      lookbackTurns: 2,
    },
    /** Media cuts both ways: the public helps more, and so does the criminal's sense of the net. */
    trueBriefing: {
      actionPointCost: 1,
      budgetCost: 0,
      trustGain: 4,
      reportVolumeMultiplier: 1.5,
      criminalHeatGain: 10,
    },
  },

  districts: DISTRICTS,
  edges: EDGES,

  reports: {
    /** Accuracy of a witness sighting before trust and district density move it. */
    baseSightingAccuracy: 0.45,
    /** How much of the accuracy range full public trust is worth. */
    trustAccuracyWeight: 0.4,
    minAccuracy: 0.1,
    maxAccuracy: 0.95,
    cctvAccuracy: 0.95,
    /** Pranks scale with media attention; in the MVP the only media is a briefing. */
    basePrankRate: 0.05,
    prankRatePerBriefing: 0.04,
    maxPrankRate: 0.4,
    falseReportRate: 0.1,
  },

  criminal: {
    startingStamina: 100,
    staminaMax: 100,
    staminaPerMove: 8,
    staminaPerRest: 25,
    startingHeat: 20,
    heatMax: 100,
    heatDecayPerTurn: 3,
    heatPerSighting: 6,
    startingCash: 500,
    startingDesperation: 10,
    desperationMax: 100,
    desperationPerTurn: 2,
    profiles: { amateur: AMATEUR },
  },

  endConditions: {
    casualtiesToLose: 3,
    /** Trust at or below this ends the hunt: DESIGN.md "0 means removed from case". */
    trustCollapseAt: 0,
    bankruptBelow: 0,
  },

  /**
   * DESIGN.md names the score components but no weights; this is where they were invented
   * (PLAN "Decisions and open questions"). Every component is a visible subtraction from the
   * base, so M3.10's breakdown reads as a receipt rather than a verdict.
   *
   * The weights are set so that the worst possible capture still outscores the best possible
   * loss - a hunt won the ugly way beats one lost with the public still on side. `balance.test.ts`
   * asserts that, so tuning these cannot quietly invert the game's values.
   *
   * Political pressure is deliberately absent: it tracks the clock, and turns taken is already
   * a component.
   */
  score: {
    outcomeBase: OUTCOME_BASE,
    turnPenalty: 15,
    budgetPenaltyPerUnit: 0.15,
    casualtyPenalty: 100,
    trustBonusPerPoint: 2,
    /**
     * `GameOutcome`'s `captured` variant carries no aliveness flag today, so M3.10 either adds
     * one or drops this bonus. The weight is here because DESIGN.md lists the component.
     */
    capturedAliveBonus: 200,
    minimumScore: 0,
  },
} as const;

export type Balance = typeof BALANCE;
