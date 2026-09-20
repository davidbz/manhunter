import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";
import { type MapGraph, makeEdge, makeExit, makeNode } from "./map";
import { createRng } from "./rng";
import { createScoringLogic, type ScoreBreakdown, type ScoreComponentKind } from "./score";
import { seal } from "./sealed";
import { makeClock, type Turn } from "./time";
import { type GameOutcome, IN_PROGRESS, makeWorldState, type WorldState } from "./world";

const rng = createRng();
const scoring = createScoringLogic();

const SEED = 11;
const NOON = 12;
const MAX_TURNS = 24;
const CLOCK_TURN: Turn = 3;
const START_ACTION_POINTS = 3;
const START_STAMINA = 100;
const START_HEAT = 20;
const START_CASH = 250;
const CALM = 0;

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

type HuntOptions = {
  readonly outcome?: GameOutcome;
  readonly clockTurn?: Turn;
  readonly trust?: number;
  readonly budgetSpent?: number;
  readonly casualties?: number;
};

const NOTHING_SPENT = 0;
const NO_CASUALTIES = 0;
const NO_TRUST = 0;

/** A finished hunt, built by hand rather than played, so every component is set on purpose. */
const hunt = (options: HuntOptions = {}): WorldState => ({
  ...makeWorldState({
    config,
    rng: rng.seed(SEED),
    clock: makeClock(config.startHour, options.clockTurn ?? CLOCK_TURN),
    map: city,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: BALANCE.hunter.startingBudget - (options.budgetSpent ?? NOTHING_SPENT),
      trust: options.trust ?? NO_TRUST,
      pressure: BALANCE.hunter.startingPressure,
    }),
    criminal: makeCriminalState({
      nodeId: downtown,
      travelMode: "foot",
      profile: "amateur",
      stamina: START_STAMINA,
      heat: START_HEAT,
      cash: START_CASH,
      desperation: CALM,
    }),
  }),
  casualties: options.casualties ?? NO_CASUALTIES,
  outcome: options.outcome ?? IN_PROGRESS,
});

const scoreOf = (options: HuntOptions = {}): ScoreBreakdown =>
  scoring.score({ world: seal(hunt(options)), balance: BALANCE });

const pointsFor = (breakdown: ScoreBreakdown, kind: ScoreComponentKind): number => {
  const component = breakdown.components.find((candidate) => candidate.kind === kind);
  if (!component) {
    throw new Error(`the breakdown carries no ${kind} component`);
  }
  return component.points;
};

/** The two hunts the acceptance criteria ask to be pinned, component by component. */
const CAPTURE_TURN: Turn = 6;
const CAPTURE_TRUST = 55;
const CAPTURE_SPENT = 300;
const CAPTURE_CASUALTIES = 1;

const ESCAPE_TURN: Turn = 4;
const ESCAPE_TRUST = 60;
const ESCAPE_SPENT = 120;

describe("the breakdown of a finished hunt", () => {
  it("pins a capture, base first and then what it cost", () => {
    const breakdown = scoreOf({
      outcome: { kind: "captured", turn: CAPTURE_TURN },
      trust: CAPTURE_TRUST,
      budgetSpent: CAPTURE_SPENT,
      casualties: CAPTURE_CASUALTIES,
    });

    expect(breakdown).toEqual({
      outcome: { kind: "captured", turn: CAPTURE_TURN },
      base: 1200,
      components: [
        { kind: "turns_taken", measured: 6, points: -90 },
        { kind: "budget_spent", measured: 300, points: -45 },
        { kind: "casualties", measured: 1, points: -100 },
        { kind: "trust_remaining", measured: 55, points: 110 },
      ],
      total: 1075,
    });
  });

  it("pins an escape, which scores no base and is carried by its trust", () => {
    const breakdown = scoreOf({
      outcome: { kind: "escaped", turn: ESCAPE_TURN },
      trust: ESCAPE_TRUST,
      budgetSpent: ESCAPE_SPENT,
    });

    expect(breakdown).toEqual({
      outcome: { kind: "escaped", turn: ESCAPE_TURN },
      base: 0,
      components: [
        { kind: "turns_taken", measured: 4, points: -60 },
        { kind: "budget_spent", measured: 120, points: -18 },
        { kind: "casualties", measured: 0, points: 0 },
        { kind: "trust_remaining", measured: 60, points: 120 },
      ],
      total: 42,
    });
  });

  /** PLAN M5.6a renders the components rather than the total, so it has to survive the trip. */
  it("is plain data that round-trips through JSON (architecture rule 3)", () => {
    const breakdown = scoreOf({ outcome: { kind: "escaped", turn: ESCAPE_TURN } });

    expect(JSON.parse(JSON.stringify(breakdown))).toEqual(breakdown);
  });
});

describe("the components", () => {
  const MEASURED_HUNT: HuntOptions = {
    outcome: { kind: "captured", turn: CAPTURE_TURN },
    trust: CAPTURE_TRUST,
    budgetSpent: CAPTURE_SPENT,
    casualties: CAPTURE_CASUALTIES,
  };

  /**
   * Keyed by `ScoreComponentKind`, so a fifth component - M6's captured-alive, say - stops this
   * file compiling until somebody says what it is worth, rather than going quietly unrendered.
   */
  const EXPECTED_POINTS: Readonly<Record<ScoreComponentKind, number>> = {
    turns_taken: -90,
    budget_spent: -45,
    casualties: -100,
    trust_remaining: 110,
  };

  it("carries one for every kind the breakdown declares, and nothing else", () => {
    const breakdown = scoreOf(MEASURED_HUNT);
    const scored = Object.fromEntries(
      breakdown.components.map((component) => [component.kind, component.points]),
    );

    expect(scored).toEqual(EXPECTED_POINTS);
    expect(breakdown.components.length).toBe(Object.keys(EXPECTED_POINTS).length);
  });

  it("counts the turns the outcome was stamped with, not the turn the clock stopped on", () => {
    const stampedLate = scoreOf({
      outcome: { kind: "escaped", turn: CAPTURE_TURN },
      clockTurn: CLOCK_TURN,
    });

    expect(pointsFor(stampedLate, "turns_taken")).toBe(-90);
  });

  it("counts a hunt still running by its clock, which has no stamp to read", () => {
    expect(pointsFor(scoreOf({ clockTurn: CLOCK_TURN }), "turns_taken")).toBe(-45);
  });

  it("measures budget spent as what is missing from the balance's starting budget", () => {
    const spender = scoreOf({ budgetSpent: CAPTURE_SPENT });

    expect(spender.components[1]).toEqual({
      kind: "budget_spent",
      measured: CAPTURE_SPENT,
      points: -45,
    });
  });

  it("scores a hunt that took longer at fewer points", () => {
    const quick = scoreOf({ outcome: { kind: "captured", turn: 1 } });
    const slow = scoreOf({ outcome: { kind: "captured", turn: 2 } });

    expect(slow.total).toBe(quick.total - BALANCE.score.turnPenalty);
  });

  it("scores a hunt that spent more at fewer points", () => {
    const thrifty = scoreOf({ budgetSpent: NOTHING_SPENT });
    const lavish = scoreOf({ budgetSpent: CAPTURE_SPENT });

    expect(pointsFor(lavish, "budget_spent")).toBeLessThan(pointsFor(thrifty, "budget_spent"));
  });

  it("scores every casualty as a penalty", () => {
    const unharmed = scoreOf({ casualties: NO_CASUALTIES });
    const costly = scoreOf({ casualties: 2 });

    expect(pointsFor(costly, "casualties")).toBe(
      pointsFor(unharmed, "casualties") - 2 * BALANCE.score.casualtyPenalty,
    );
  });

  it("scores the trust left over as a bonus", () => {
    const trusted = scoreOf({ trust: BALANCE.hunter.trustMax });

    expect(pointsFor(trusted, "trust_remaining")).toBe(
      BALANCE.hunter.trustMax * BALANCE.score.trustBonusPerPoint,
    );
    expect(pointsFor(trusted, "trust_remaining")).toBeGreaterThan(
      pointsFor(scoreOf({ trust: NO_TRUST }), "trust_remaining"),
    );
  });

  /** `budgetPenaltyPerUnit` is the one weight that is not a whole number of points. */
  it("rounds a fractional penalty to a whole point", () => {
    expect(pointsFor(scoreOf({ budgetSpent: 10 }), "budget_spent")).toBe(-1);
  });

  /** A `-0` survives `JSON.stringify` and PLAN M5.6a would print it as a minus sign. */
  it("scores a component that cost nothing at zero rather than at minus zero", () => {
    const quiet = scoreOf({ outcome: { kind: "escaped", turn: 0 } });
    const nothings = quiet.components.filter((component) => component.points === 0);

    expect(nothings.length).toBeGreaterThan(0);
    for (const component of nothings) {
      expect(Object.is(component.points, -0)).toBe(false);
    }
  });
});

describe("the total", () => {
  it("is the base plus every component", () => {
    const breakdown = scoreOf({
      outcome: { kind: "captured", turn: CAPTURE_TURN },
      trust: CAPTURE_TRUST,
      budgetSpent: CAPTURE_SPENT,
      casualties: CAPTURE_CASUALTIES,
    });
    const summed = breakdown.components.reduce(
      (sum, component) => sum + component.points,
      breakdown.base,
    );

    expect(breakdown.total).toBe(summed);
  });

  it("never falls below the floor the balance sets", () => {
    const disaster = scoreOf({
      outcome: { kind: "trust_collapsed", turn: MAX_TURNS },
      trust: NO_TRUST,
      budgetSpent: BALANCE.hunter.startingBudget,
      casualties: BALANCE.endConditions.casualtiesToLose,
    });

    expect(disaster.total).toBe(BALANCE.score.minimumScore);
    expect(
      disaster.components.reduce((sum, component) => sum + component.points, disaster.base),
    ).toBeLessThan(BALANCE.score.minimumScore);
  });
});

describe("what an ending is worth on its own", () => {
  /**
   * One sample per `GameOutcome` variant, including the `captured` the MVP cannot yet reach (PLAN
   * Inbox), so scoring is table-driven off `balance.score.outcomeBase` and no ending is scored by
   * a branch that no world can take.
   */
  const OUTCOMES: Readonly<Record<GameOutcome["kind"], GameOutcome>> = {
    in_progress: IN_PROGRESS,
    captured: { kind: "captured", turn: CAPTURE_TURN },
    escaped: { kind: "escaped", turn: ESCAPE_TURN },
    trust_collapsed: { kind: "trust_collapsed", turn: ESCAPE_TURN },
    casualties_exceeded: { kind: "casualties_exceeded", turn: ESCAPE_TURN },
  };

  it("scores each one at the base its balance names, and carries the outcome back", () => {
    for (const [kind, outcome] of Object.entries(OUTCOMES)) {
      const breakdown = scoreOf({ outcome });

      expect(breakdown.base).toBe(BALANCE.score.outcomeBase[kind as GameOutcome["kind"]]);
      expect(breakdown.outcome).toEqual(outcome);
    }
  });

  /**
   * The invariant `balance.test.ts` asserts from the constants, asserted here through the function
   * that has to make it true: a hunt won the ugly way - the full deadline, the whole budget, one
   * casualty short of losing and no public left - still beats one lost with the city on side.
   */
  it("makes the worst capture outscore the best loss", () => {
    const worstCapture = scoreOf({
      outcome: { kind: "captured", turn: BALANCE.time.maxTurns },
      trust: NO_TRUST,
      budgetSpent: BALANCE.hunter.startingBudget,
      casualties: BALANCE.endConditions.casualtiesToLose - 1,
    });
    const bestLoss = scoreOf({
      outcome: { kind: "escaped", turn: 0 },
      trust: BALANCE.hunter.trustMax,
      budgetSpent: NOTHING_SPENT,
      casualties: NO_CASUALTIES,
    });

    expect(worstCapture.total).toBeGreaterThan(bestLoss.total);
    expect(worstCapture.total).toBeGreaterThan(BALANCE.score.minimumScore);
  });
});
