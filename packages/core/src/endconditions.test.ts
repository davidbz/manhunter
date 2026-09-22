import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import {
  END_CONDITIONS,
  type EndConditionKind,
  type EndConditionSettings,
  isHuntOver,
  outcomeAfter,
} from "./endconditions";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";
import { type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { createRng } from "./rng";
import { makeClock, type Turn } from "./time";
import { type GameOutcome, makeWorldState, type WorldState } from "./world";

const rng = createRng();

const SEED = 7;
const NOON = 12;
const MAX_TURNS = 24;
const NOW: Turn = 5;
const START_TRUST = 70;
const START_PRESSURE = 10;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_STAMINA = 100;
const START_HEAT = 20;
const START_CASH = 250;
const CALM = 0;
const NO_CASUALTIES = 0;
/** Short enough that `NOW` is already past it, which is what makes the deadline the config's. */
const SHORT_DEADLINE = 2;

const downtown = makeNodeId("downtown");
const terminal = makeNodeId("terminal");

const city: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(terminal, "exit", { x: 1, y: 0 }),
  ],
  edges: [makeEdge("road", makeEdgeId("downtown-terminal"), downtown, terminal)],
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
  readonly nodeId?: typeof downtown;
  readonly inCustody?: boolean;
  readonly trust?: number;
  readonly casualties?: number;
  readonly turn?: Turn;
  readonly maxTurns?: number;
};

const worldAt = (options: WorldOptions = {}): WorldState => ({
  ...makeWorldState({
    config: { ...config, maxTurns: options.maxTurns ?? MAX_TURNS },
    rng: rng.seed(SEED),
    clock: makeClock(config.startHour, options.turn ?? NOW),
    map: city,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: START_BUDGET,
      trust: options.trust ?? START_TRUST,
      pressure: START_PRESSURE,
    }),
    criminal: {
      ...makeCriminalState({
        nodeId: options.nodeId ?? downtown,
        travelMode: "foot",
        profile: "amateur",
        stamina: START_STAMINA,
        heat: START_HEAT,
        cash: START_CASH,
        desperation: CALM,
      }),
      inCustody: options.inCustody ?? false,
    },
  }),
  casualties: options.casualties ?? NO_CASUALTIES,
});

const SETTINGS: EndConditionSettings = BALANCE.endConditions;

/**
 * Which endings have a rule. Keyed by `EndConditionKind`, so it stops compiling the day a new
 * `GameOutcome` variant appears and nobody says which side of the line it is on.
 */
const HAS_A_RULE: Readonly<Record<EndConditionKind, boolean>> = {
  captured: true,
  escaped: true,
  trust_collapsed: true,
  casualties_exceeded: true,
  timed_out: true,
};

const ruledKinds = (): readonly string[] => END_CONDITIONS.map((condition) => condition.kind);

describe("the end condition table", () => {
  /**
   * The table is total as of PLAN M3.11, which landed the capture as one entry. Anything added to
   * `GameOutcome` from here arrives ruleless and fails this until somebody rules on it.
   */
  it("holds a rule for every ending the MVP can reach, and no others", () => {
    const expected = Object.entries(HAS_A_RULE)
      .filter(([, hasRule]) => hasRule)
      .map(([kind]) => kind);

    expect([...ruledKinds()].sort()).toEqual([...expected].sort());
  });

  it("leaves no ending without a rule", () => {
    const ruleless = Object.entries(HAS_A_RULE)
      .filter(([, hasRule]) => !hasRule)
      .map(([kind]) => kind);

    expect(ruleless).toEqual([]);
  });

  it("checks them in GameOutcome's own declaration order", () => {
    expect(ruledKinds()).toEqual([
      "captured",
      "escaped",
      "trust_collapsed",
      "casualties_exceeded",
      "timed_out",
    ]);
  });
});

describe("the outcome a settled world has earned", () => {
  it("leaves a hunt nothing has finished in progress", () => {
    expect(outcomeAfter(worldAt(), SETTINGS)).toEqual({ kind: "in_progress" });
  });

  it("ends a hunt whose criminal has been taken", () => {
    expect(outcomeAfter(worldAt({ inCustody: true }), SETTINGS)).toEqual({
      kind: "captured",
      turn: NOW,
    });
  });

  it("ends a hunt whose criminal is standing on an exit", () => {
    expect(outcomeAfter(worldAt({ nodeId: terminal }), SETTINGS)).toEqual({
      kind: "escaped",
      turn: NOW,
    });
  });

  it("ends a hunt whose trust has run out", () => {
    expect(outcomeAfter(worldAt({ trust: SETTINGS.trustCollapseAt }), SETTINGS)).toEqual({
      kind: "trust_collapsed",
      turn: NOW,
    });
  });

  it("ends a hunt whose trust has somehow gone below the floor", () => {
    expect(outcomeAfter(worldAt({ trust: SETTINGS.trustCollapseAt - 1 }), SETTINGS)).toMatchObject({
      kind: "trust_collapsed",
    });
  });

  it("leaves a hunt with a point of trust left in progress", () => {
    expect(outcomeAfter(worldAt({ trust: SETTINGS.trustCollapseAt + 1 }), SETTINGS)).toEqual({
      kind: "in_progress",
    });
  });

  it("ends a hunt that has reached the casualty threshold", () => {
    expect(outcomeAfter(worldAt({ casualties: SETTINGS.casualtiesToLose }), SETTINGS)).toEqual({
      kind: "casualties_exceeded",
      turn: NOW,
    });
  });

  it("leaves a hunt one casualty short of the threshold in progress", () => {
    const world = worldAt({ casualties: SETTINGS.casualtiesToLose - 1 });

    expect(outcomeAfter(world, SETTINGS)).toEqual({ kind: "in_progress" });
  });

  it("ends a hunt whose deadline has arrived", () => {
    expect(outcomeAfter(worldAt({ turn: MAX_TURNS }), SETTINGS)).toEqual({
      kind: "timed_out",
      turn: MAX_TURNS,
    });
  });

  it("leaves a hunt one turn short of its deadline in progress", () => {
    expect(outcomeAfter(worldAt({ turn: MAX_TURNS - 1 }), SETTINGS)).toEqual({
      kind: "in_progress",
    });
  });

  it("ends a hunt whose clock has somehow run past its deadline", () => {
    expect(outcomeAfter(worldAt({ turn: MAX_TURNS + 1 }), SETTINGS)).toMatchObject({
      kind: "timed_out",
    });
  });

  /** The deadline is the hunt's own, so two hunts on one balance can run for different lengths. */
  it("reads the deadline off the hunt's own config rather than the balance", () => {
    const shortHunt = worldAt({ turn: SHORT_DEADLINE, maxTurns: SHORT_DEADLINE });

    expect(outcomeAfter(shortHunt, SETTINGS)).toMatchObject({ kind: "timed_out" });
    expect(outcomeAfter(worldAt({ turn: SHORT_DEADLINE }), SETTINGS)).toEqual({
      kind: "in_progress",
    });
  });

  it("names the first condition that holds when two hold at once", () => {
    const world = worldAt({ nodeId: terminal, casualties: SETTINGS.casualtiesToLose, trust: 0 });

    expect(outcomeAfter(world, SETTINGS)).toMatchObject({ kind: "escaped" });
  });

  /** A criminal in custody is not at large, whatever else the same turn did (PLAN M3.11). */
  it("names the capture over every other ending that holds at once", () => {
    const world = worldAt({
      inCustody: true,
      nodeId: terminal,
      casualties: SETTINGS.casualtiesToLose,
      trust: SETTINGS.trustCollapseAt,
      turn: MAX_TURNS,
    });

    expect(outcomeAfter(world, SETTINGS)).toMatchObject({ kind: "captured" });
  });

  /** A criminal who walks out on the final turn escaped; the clock is not what ended that hunt. */
  it("names the escape when the criminal reaches an exit on the final turn", () => {
    const world = worldAt({ nodeId: terminal, turn: MAX_TURNS });

    expect(outcomeAfter(world, SETTINGS)).toEqual({ kind: "escaped", turn: MAX_TURNS });
  });

  it("names the trust collapse when the public gives up on the final turn", () => {
    const world = worldAt({ trust: SETTINGS.trustCollapseAt, turn: MAX_TURNS });

    expect(outcomeAfter(world, SETTINGS)).toMatchObject({ kind: "trust_collapsed" });
  });

  it("names the casualties when the threshold is reached on the final turn", () => {
    const world = worldAt({ casualties: SETTINGS.casualtiesToLose, turn: MAX_TURNS });

    expect(outcomeAfter(world, SETTINGS)).toMatchObject({ kind: "casualties_exceeded" });
  });

  it("stamps the outcome with the turn the world is on", () => {
    const world = { ...worldAt({ nodeId: terminal }), clock: makeClock(config.startHour, 0) };

    expect(outcomeAfter(world, SETTINGS)).toEqual({ kind: "escaped", turn: 0 });
  });

  /** The thresholds are the argument's, not `BALANCE`'s, so a sweep can move them (PLAN M4.3). */
  it("reads the thresholds it is handed rather than the shipped balance", () => {
    const oneIsTooMany: EndConditionSettings = { casualtiesToLose: 1, trustCollapseAt: 0 };
    const trustedNoMore: EndConditionSettings = {
      casualtiesToLose: SETTINGS.casualtiesToLose,
      trustCollapseAt: START_TRUST,
    };

    expect(outcomeAfter(worldAt({ casualties: 1 }), SETTINGS)).toEqual({ kind: "in_progress" });
    expect(outcomeAfter(worldAt({ casualties: 1 }), oneIsTooMany)).toMatchObject({
      kind: "casualties_exceeded",
    });
    expect(outcomeAfter(worldAt(), trustedNoMore)).toMatchObject({ kind: "trust_collapsed" });
  });
});

describe("whether a hunt is over", () => {
  /** Keyed by kind, so a new ending cannot go unasked (`HAS_A_RULE` does the same for the rules). */
  const ENDED: Readonly<Record<EndConditionKind, GameOutcome>> = {
    captured: { kind: "captured", turn: NOW },
    escaped: { kind: "escaped", turn: NOW },
    trust_collapsed: { kind: "trust_collapsed", turn: NOW },
    casualties_exceeded: { kind: "casualties_exceeded", turn: NOW },
    timed_out: { kind: "timed_out", turn: NOW },
  };

  it("says no while the hunt is in progress", () => {
    expect(isHuntOver({ kind: "in_progress" })).toBe(false);
  });

  it("says yes for every ending, including the one no rule produces yet", () => {
    for (const outcome of Object.values(ENDED)) {
      expect(isHuntOver(outcome)).toBe(true);
    }
  });
});
