import { describe, expect, it } from "vitest";
import type { Balance, DistrictProperties } from "./balance";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import type { CriminalProfile } from "./criminal";
import { makeCriminalState } from "./criminal";
import type { GameEvent } from "./events";
import type { EventResult } from "./eventtable";
import { createEventLogic } from "./eventtable";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId, type NodeId } from "./ids";
import { type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { createRng } from "./rng";
import { makeClock, type Turn } from "./time";
import { makeWorldState, type WorldState } from "./world";

const rng = createRng();
const events = createEventLogic({ rng });

const SEED = 7;
const SEEDS = [1, 2, 3, 5, 8];
const MAX_TURNS = 24;
const FIRST_TURN = 0;
const SECOND_TURN = 1;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 70;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;
const CALM = 0;

const NIGHTFALL_HOUR = BALANCE.time.nightStartHour;
const LATE_NIGHT_HOUR = 23;
const NOON = 12;
const TURNS_PER_DAY = 24;
const TWO_DAYS = 48;

/**
 * Long enough that a per-turn chance of 0.06 lands within a twentieth of itself on every seed
 * sampled, so the rate can be checked against the shipped profile rather than a bent one.
 */
const TURNS_SAMPLED = 1000;
const HARM_CHANCE = BALANCE.criminal.profiles.amateur.civilianHarmChance;
const RATE_TOLERANCE = 0.02;

/** A profile `balance.criminal.profiles` gives no weights to, and therefore no behaviour. */
const NO_BEHAVIOUR: CriminalProfile = "professional";

const downtown = makeNodeId("downtown");
const park = makeNodeId("park");
const terminal = makeNodeId("terminal");

const city: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(park, "park", { x: 1, y: 0 }),
    makeNode(terminal, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", makeEdgeId("downtown-park"), downtown, park),
    makeEdge("road", makeEdgeId("park-terminal"), park, terminal),
  ],
  exits: [makeExit(terminal, "highway")],
  river: null,
  incidentNodeId: downtown,
};

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: NOON,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

type WorldOptions = {
  readonly hour?: number;
  readonly turn?: Turn;
  readonly nodeId?: NodeId;
  readonly profile?: CriminalProfile;
  readonly seed?: number;
};

/** `hour` is the hour it is now: the clock is built from it, so a turn is free to be anything. */
const worldAt = (options: WorldOptions = {}): WorldState => {
  const hour = options.hour ?? NOON;
  const turn = options.turn ?? FIRST_TURN;
  return makeWorldState({
    config: { ...config, startHour: hour - turn },
    rng: rng.seed(options.seed ?? SEED),
    clock: makeClock(hour - turn, turn),
    map: city,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: START_BUDGET,
      trust: START_TRUST,
      pressure: START_PRESSURE,
    }),
    criminal: makeCriminalState({
      nodeId: options.nodeId ?? downtown,
      travelMode: "foot",
      profile: options.profile ?? "amateur",
      stamina: START_STAMINA,
      heat: CALM,
      cash: START_CASH,
      desperation: CALM,
    }),
  });
};

const withDistrict = (
  district: "downtown" | "park",
  overrides: Partial<DistrictProperties>,
): Balance => ({
  ...BALANCE,
  districts: {
    ...BALANCE.districts,
    [district]: { ...BALANCE.districts[district], ...overrides },
  },
});

/** Crowded at every hour, so the harm rate is the profile's chance and not the clock's. */
const ALWAYS_CROWDED = withDistrict("downtown", { nightWitnessMultiplier: 1 });
/** A district with nobody in it at any hour, which is the trigger's other side. */
const DESERTED = withDistrict("park", { witnessDensity: 0 });

const turnsOf = (count: number): readonly Turn[] =>
  Array.from({ length: count }, (_unused, turn) => turn);

/** One firing per turn of a run, the world and the stream threaded through as the turn loop will. */
const overTurns = (start: WorldState, balance: Balance, count: number): EventResult => {
  const fired: GameEvent[] = [];
  let world = start;
  for (const turn of turnsOf(count)) {
    const result = events.fire({
      world: { ...world, clock: makeClock(start.config.startHour, turn) },
      balance,
    });
    world = result.world;
    fired.push(...result.events);
  }
  return { world, events: fired };
};

const kinds = (fired: readonly GameEvent[], kind: GameEvent["kind"]): readonly GameEvent[] =>
  fired.filter((event) => event.kind === kind);

describe("nightfall", () => {
  it("fires on the turn the lights go out", () => {
    const fired = events.fire({
      world: worldAt({ hour: NIGHTFALL_HOUR, turn: SECOND_TURN, nodeId: park }),
      balance: BALANCE,
    });

    expect(fired.events).toEqual([{ kind: "nightfall", turn: SECOND_TURN }]);
  });

  it("does not fire again once it is already dark", () => {
    const fired = events.fire({
      world: worldAt({ hour: LATE_NIGHT_HOUR, nodeId: park }),
      balance: BALANCE,
    });

    expect(kinds(fired.events, "nightfall")).toEqual([]);
  });

  it("opens a hunt that begins exactly at nightfall", () => {
    const fired = events.fire({
      world: worldAt({ hour: NIGHTFALL_HOUR, nodeId: park }),
      balance: BALANCE,
    });

    expect(kinds(fired.events, "nightfall")).toHaveLength(1);
  });

  it("stays quiet on a hunt that begins after dark", () => {
    const world = worldAt({ hour: LATE_NIGHT_HOUR, nodeId: park });
    const fired = events.fire({ world, balance: BALANCE });

    expect(fired.events).toEqual([]);
    expect(fired.world.rng).toEqual(world.rng);
  });

  it("fires once a day and no more", () => {
    const fired = overTurns(worldAt({ hour: NOON, nodeId: park }), BALANCE, TWO_DAYS);

    expect(kinds(fired.events, "nightfall")).toHaveLength(TWO_DAYS / TURNS_PER_DAY);
  });

  it("changes nothing but the feed", () => {
    const world = worldAt({ hour: NIGHTFALL_HOUR, nodeId: park });
    const fired = events.fire({ world, balance: BALANCE });

    expect(fired.world).toEqual({ ...world, rng: fired.world.rng, events: fired.events });
  });
});

describe("civilian hurt", () => {
  it("cannot happen where there is nobody about", () => {
    const fired = overTurns(worldAt({ nodeId: park }), DESERTED, TURNS_SAMPLED);

    expect(kinds(fired.events, "civilian_hurt")).toEqual([]);
    expect(fired.world.casualties).toBe(0);
  });

  it("does not even roll for it in a district with nobody in it", () => {
    const world = worldAt({ hour: LATE_NIGHT_HOUR, nodeId: park });

    expect(events.fire({ world, balance: BALANCE }).world.rng).toEqual(world.rng);
  });

  it("rolls for it in the same park while there is still daylight", () => {
    const world = worldAt({ hour: NOON, nodeId: park });

    expect(events.fire({ world, balance: BALANCE }).world.rng).toEqual(rng.float(world.rng).state);
  });

  for (const seed of SEEDS) {
    it(`happens at the profile's own chance, seed ${seed}`, () => {
      const fired = overTurns(worldAt({ seed }), ALWAYS_CROWDED, TURNS_SAMPLED);
      const hurt = kinds(fired.events, "civilian_hurt");

      expect(hurt.length / TURNS_SAMPLED).toBeGreaterThan(HARM_CHANCE - RATE_TOLERANCE);
      expect(hurt.length / TURNS_SAMPLED).toBeLessThan(HARM_CHANCE + RATE_TOLERANCE);
    });
  }

  it("costs one casualty per person hurt, and nothing else on the meters", () => {
    const start = worldAt();
    const fired = overTurns(start, ALWAYS_CROWDED, TURNS_SAMPLED);

    expect(fired.world.casualties).toBe(kinds(fired.events, "civilian_hurt").length);
    expect(fired.world.casualties).toBeGreaterThan(0);
    expect(fired.world.hunter).toEqual(start.hunter);
  });

  it("names the node the criminal is standing on, which is what harm confirms", () => {
    const fired = overTurns(worldAt({ nodeId: downtown }), ALWAYS_CROWDED, TURNS_SAMPLED);

    for (const event of kinds(fired.events, "civilian_hurt")) {
      expect(event).toEqual({ kind: "civilian_hurt", turn: expect.any(Number), nodeId: downtown });
    }
  });

  it("never happens to a criminal whose profile has no behaviour", () => {
    const start = worldAt({ profile: NO_BEHAVIOUR });
    const fired = overTurns(start, ALWAYS_CROWDED, TURNS_SAMPLED);

    expect(kinds(fired.events, "civilian_hurt")).toEqual([]);
    expect(fired.world.rng).not.toEqual(start.rng);
  });
});

describe("fire", () => {
  it("hands back the world untouched when nothing triggers", () => {
    const world = worldAt({ hour: LATE_NIGHT_HOUR, nodeId: park });

    expect(events.fire({ world, balance: BALANCE })).toEqual({ world, events: [] });
  });

  it("costs exactly one draw per triggered entry, fired or not", () => {
    const world = worldAt({ hour: NIGHTFALL_HOUR, nodeId: downtown });
    const twoDraws = rng.float(rng.float(world.rng).state).state;

    expect(events.fire({ world, balance: BALANCE }).world.rng).toEqual(twoDraws);
  });

  it("appends what fired to the world's own feed", () => {
    const fired = overTurns(worldAt(), ALWAYS_CROWDED, TURNS_PER_DAY);

    expect(fired.world.events).toEqual(fired.events);
  });

  it("stamps every event with the turn it fired on", () => {
    const start = worldAt();
    let world = start;
    for (const turn of turnsOf(TURNS_PER_DAY)) {
      const result = events.fire({
        world: { ...world, clock: makeClock(start.config.startHour, turn) },
        balance: ALWAYS_CROWDED,
      });
      world = result.world;
      for (const event of result.events) expect(event.turn).toBe(turn);
    }
  });

  it("draws the same events twice from the same world", () => {
    const world = worldAt({ hour: NIGHTFALL_HOUR });

    expect(events.fire({ world, balance: BALANCE })).toEqual(
      events.fire({ world, balance: BALANCE }),
    );
  });

  it("leaves the world it was given alone", () => {
    const world = worldAt({ hour: NIGHTFALL_HOUR });
    const before = JSON.stringify(world);

    events.fire({ world, balance: ALWAYS_CROWDED });

    expect(JSON.stringify(world)).toBe(before);
  });

  it("returns a world that round-trips through JSON (architecture rule 3)", () => {
    const fired = overTurns(worldAt(), ALWAYS_CROWDED, TURNS_PER_DAY);

    expect(JSON.parse(JSON.stringify(fired.world))).toEqual(fired.world);
  });
});
