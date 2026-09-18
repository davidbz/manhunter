import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE, type Balance } from "./balance";
import type { GameConfig, GameSetup } from "./config";
import { createDistrictLogic } from "./districts";
import { createGameLogic, type GameResult } from "./game";
import { createGenerationLogic } from "./generate";
import { createGraphLogic } from "./graph";
import { LIMITS } from "./limits";
import { createMinCutLogic } from "./mincut";
import { createRiverLogic } from "./river";
import { createRng } from "./rng";
import { HOURS_PER_DAY } from "./time";
import { createTopologyLogic } from "./topology";
import { createValidatorLogic } from "./validator";

const rng = createRng();
const graph = createGraphLogic();
const generation = createGenerationLogic({
  rng,
  topology: createTopologyLogic({ rng, graph }),
  river: createRiverLogic({ rng, graph }),
  districts: createDistrictLogic({ rng, graph }),
  validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
});
const game = createGameLogic({ rng, generation });

const SETUP: GameSetup = {
  map: { columns: 8, rows: 6, exitCount: 3 },
  maxTurns: 24,
  difficulty: "standard",
};
/** Impossible: under `MIN_BANK * 2` on both axes, so no orientation can carry a river. */
const IMPOSSIBLE_SETUP: GameSetup = { ...SETUP, map: { columns: 3, rows: 3, exitCount: 3 } };

const SEED = 1;
const OTHER_SEED = 2;
/** Enough seeds to see a drawn field take more than one value without making the suite slow. */
const SAMPLE_SEEDS = 40;

const create = (setup: GameSetup, seed: number, balance: Balance = BALANCE): GameResult =>
  game.create({ setup, seed, balance });

const worldFor = (seed: number, setup: GameSetup = SETUP) => {
  const result = create(setup, seed);
  if (result.kind !== "game") {
    throw new Error(`expected a game, got ${result.kind}`);
  }
  return result.world;
};

describe("starting a hunt", () => {
  it("resolves the setup into a config without losing a field", () => {
    const world = worldFor(SEED);
    expect(world.config.maxTurns).toBe(SETUP.maxTurns);
    expect(world.config.map).toEqual(SETUP.map);
    expect(world.config.difficulty).toBe(SETUP.difficulty);
  });

  it("puts the criminal at the crime scene, on foot and knowing nothing", () => {
    const world = worldFor(SEED);
    expect(world.criminal.nodeId).toBe(world.map.incidentNodeId);
    expect(world.criminal.travelMode).toBe("foot");
    expect(world.criminal.knowledge.knownRoadblockEdgeIds).toEqual([]);
    expect(world.criminal.knowledge.heardBriefingTurns).toEqual([]);
  });

  it("starts the clock at turn zero on the drawn hour", () => {
    const world = worldFor(SEED);
    expect(world.clock.turn).toBe(0);
    expect(world.clock.hour).toBe(world.config.startHour);
  });

  it("starts with nothing having happened yet", () => {
    const world = worldFor(SEED);
    expect(world.reports).toEqual([]);
    expect(world.events).toEqual([]);
    expect(world.casualties).toBe(0);
    expect(world.outcome).toEqual({ kind: "in_progress" });
  });

  it("round-trips through JSON, because a world is plain data (architecture rule 3)", () => {
    const world = worldFor(SEED);
    expect(JSON.parse(JSON.stringify(world))).toEqual(world);
  });
});

describe("initial meters", () => {
  it("gives the hunter the starting resources balance names", () => {
    const { hunter } = worldFor(SEED);
    expect(hunter.actionPoints).toBe(BALANCE.hunter.actionPointsPerTurn);
    expect(hunter.budget).toBe(BALANCE.hunter.startingBudget);
    expect(hunter.trust).toBe(BALANCE.hunter.startingTrust);
    expect(hunter.pressure).toBe(BALANCE.hunter.startingPressure);
    expect(hunter.containments).toEqual([]);
  });

  it("gives the criminal the starting meters balance names", () => {
    const { criminal } = worldFor(SEED);
    expect(criminal.stamina).toBe(BALANCE.criminal.startingStamina);
    expect(criminal.heat).toBe(BALANCE.criminal.startingHeat);
    expect(criminal.cash).toBe(BALANCE.criminal.startingCash);
    expect(criminal.desperation).toBe(BALANCE.criminal.startingDesperation);
  });

  test.prop([fc.integer()])("opens every meter inside its bounds", (seed) => {
    const { hunter, criminal } = worldFor(seed);
    expect(hunter.trust).toBeGreaterThanOrEqual(BALANCE.hunter.trustMin);
    expect(hunter.trust).toBeLessThanOrEqual(BALANCE.hunter.trustMax);
    expect(hunter.pressure).toBeGreaterThanOrEqual(BALANCE.hunter.pressureMin);
    expect(hunter.pressure).toBeLessThanOrEqual(BALANCE.hunter.pressureMax);
    expect(hunter.budget).toBeGreaterThanOrEqual(0);
    expect(criminal.stamina).toBeLessThanOrEqual(BALANCE.criminal.staminaMax);
    expect(criminal.heat).toBeLessThanOrEqual(BALANCE.criminal.heatMax);
    expect(criminal.desperation).toBeLessThanOrEqual(BALANCE.criminal.desperationMax);
  });
});

describe("determinism", () => {
  it("builds an identical world from the same seed", () => {
    expect(create(SETUP, SEED)).toEqual(create(SETUP, SEED));
  });

  it("builds a different world from a different seed", () => {
    expect(create(SETUP, SEED)).not.toEqual(create(SETUP, OTHER_SEED));
  });

  test.prop([fc.integer()])("picks the same profile and start hour for the same seed", (seed) => {
    const first = worldFor(seed).config;
    const second = worldFor(seed).config;
    expect(first.criminalProfile).toBe(second.criminalProfile);
    expect(first.startHour).toBe(second.startHour);
  });
});

describe("the start hour is drawn, not chosen", () => {
  const hours = Array.from({ length: SAMPLE_SEEDS }, (_, seed) => worldFor(seed).config.startHour);

  it("falls inside a day", () => {
    for (const hour of hours) {
      expect(Number.isInteger(hour)).toBe(true);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThan(HOURS_PER_DAY);
    }
  });

  it("is not the same hour every hunt", () => {
    expect(new Set(hours).size).toBeGreaterThan(1);
  });
});

describe("the criminal profile is drawn from the difficulty's pool", () => {
  it("draws the only profile the shipped balance pools name", () => {
    for (const difficulty of ["easy", "standard", "hard"] as const) {
      expect(worldFor(SEED, { ...SETUP, difficulty }).config.criminalProfile).toBe("amateur");
    }
  });

  // The shipped pools hold the same single profile each (PLAN M6 fills the rest), so pools that
  // differ from one another are injected rather than waited for: otherwise both the "difficulty
  // selects the pool" and "the draw is a draw" readings pass vacuously. `professional` has no
  // weights yet, which is why only a balance a test builds may name it.
  const pooled: Balance = {
    ...BALANCE,
    criminal: {
      ...BALANCE.criminal,
      pools: {
        easy: [{ value: "amateur", weight: 1 }],
        standard: [
          { value: "amateur", weight: 1 },
          { value: "professional", weight: 1 },
        ],
        hard: [{ value: "professional", weight: 1 }],
      },
    },
  };

  const configFor = (seed: number, setup: GameSetup = SETUP): GameConfig => {
    const result = create(setup, seed, pooled);
    if (result.kind !== "game") {
      throw new Error(`expected a game, got ${result.kind}`);
    }
    return result.world.config;
  };

  const profileFor = (seed: number, setup: GameSetup = SETUP): string =>
    configFor(seed, setup).criminalProfile;

  const seeds = Array.from({ length: SAMPLE_SEEDS }, (_, seed) => seed);

  it("reads the pool the setup's difficulty names, not a fixed one", () => {
    for (const seed of seeds) {
      expect(profileFor(seed, { ...SETUP, difficulty: "easy" })).toBe("amateur");
      expect(profileFor(seed, { ...SETUP, difficulty: "hard" })).toBe("professional");
    }
  });

  it("draws the same profile from the same seed, and not one profile from every seed", () => {
    const profiles = seeds.map((seed) => profileFor(seed));
    expect(profiles).toEqual(seeds.map((seed) => profileFor(seed)));
    expect(new Set(profiles).size).toBeGreaterThan(1);
  });

  // The one observable consequence of the profile having its own fork label. Share the start
  // hour's label and both draws become functions of the same word, so a two-entry pool would
  // split exactly on the half of the day the hour landed in.
  it("draws a profile that does not track the start hour", () => {
    const halvesSeen = new Map<string, Set<boolean>>();
    for (const seed of seeds) {
      const config = configFor(seed);
      const halves = halvesSeen.get(config.criminalProfile) ?? new Set<boolean>();
      halves.add(config.startHour < HOURS_PER_DAY / 2);
      halvesSeen.set(config.criminalProfile, halves);
    }
    for (const halves of halvesSeen.values()) {
      expect(halves.size).toBe(2);
    }
  });
});

describe("streams are independent", () => {
  // Each derived field forks its own stream off the root, so changing what one draw consumes
  // cannot shift another. Difficulty moves the profile pool; the start hour must not notice.
  it("draws the same start hour whatever the difficulty selects", () => {
    const easy = worldFor(SEED, { ...SETUP, difficulty: "easy" }).config.startHour;
    const hard = worldFor(SEED, { ...SETUP, difficulty: "hard" }).config.startHour;
    expect(easy).toBe(hard);
  });

  it("draws the same start hour and profile whatever the deadline is", () => {
    const short = worldFor(SEED, { ...SETUP, maxTurns: 1 }).config;
    const long = worldFor(SEED, { ...SETUP, maxTurns: BALANCE.time.maxTurns }).config;
    expect(short.startHour).toBe(long.startHour);
    expect(short.criminalProfile).toBe(long.criminalProfile);
  });

  it("leaves the world a play stream that is not the map's", () => {
    const world = worldFor(SEED);
    expect(world.rng).not.toEqual(rng.seed(SEED));
    expect(world.rng).toEqual(rng.fork(rng.seed(SEED), "play"));
  });
});

describe("a hunt that cannot start says why", () => {
  it("rejects a deadline over the limit rather than clamping it", () => {
    const result = create({ ...SETUP, maxTurns: LIMITS.maxGameTurns + 1 }, SEED);
    expect(result).toEqual({
      kind: "deadline_too_long",
      requestedTurns: LIMITS.maxGameTurns + 1,
      maxTurns: LIMITS.maxGameTurns,
    });
  });

  it("accepts a deadline exactly at the limit", () => {
    const result = create({ ...SETUP, maxTurns: LIMITS.maxGameTurns }, SEED);
    expect(result.kind).toBe("game");
  });

  it("passes a generation refusal through with its numbers intact", () => {
    const result = create(IMPOSSIBLE_SETUP, SEED);
    expect(result.kind).toBe("generation_failed");
    if (result.kind !== "generation_failed") return;
    expect(result.lastFailure.kind).toBe("river_not_bridgeable");
    expect(result.attempts).toBe(LIMITS.maxMapGenerationAttempts);
  });

  it("rejects the deadline before it spends an attempt on the map", () => {
    const result = create({ ...IMPOSSIBLE_SETUP, maxTurns: LIMITS.maxGameTurns + 1 }, SEED);
    expect(result.kind).toBe("deadline_too_long");
  });
});
