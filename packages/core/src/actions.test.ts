import { describe, expect, it } from "vitest";
import { createActionLogic, targetKindOf } from "./actions";
import type { Balance, DistrictProperties } from "./balance";
import { BALANCE } from "./balance";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import { createGraphLogic } from "./graph";
import { blockedEdgeIdsAt, type HunterAction, type HunterState, makeHunterState } from "./hunter";
import type { NodeId } from "./ids";
import { makeEdgeId, makeNodeId } from "./ids";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import type { Report } from "./report";
import { createRng } from "./rng";
import { makeClock } from "./time";
import type { WorldState } from "./world";
import { makeWorldState } from "./world";

const rng = createRng();
const actions = createActionLogic({ rng });
const graph = createGraphLogic();

const SEED = 7;
const START_HOUR = 9;
const MAX_TURNS = 24;
const TURN = 3;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 70;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;

const ROADBLOCK = BALANCE.actions.roadblock;
const CANVASS = BALANCE.actions.canvass;

/** Enough repeats to exhaust `CANVASS_ONLY_BUDGET` several times over without looping forever. */
const MAX_SPEND_ATTEMPTS = 32;
const CANVASS_ONLY_BUDGET = CANVASS.budgetCost * 3;
const AMPLE_ACTION_POINTS = 100;

const downtown = makeNodeId("downtown");
const riverside = makeNodeId("riverside");
const airport = makeNodeId("airport");

const roadId = makeEdgeId("road");
const footpathId = makeEdgeId("footpath");
const bridgeId = makeEdgeId("bridge");
const unbuiltId = makeEdgeId("unbuilt");

/**
 * Two ways between the same pair of districts, one blockable and one not. That is the shape
 * `balance.edges` exists to guarantee (DESIGN.md: a checkpoint must never seal the city), so it
 * is the shape the roadblock tests measure against.
 */
const map: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(riverside, "park", { x: 1, y: 0 }),
    makeNode(airport, "exit", { x: 2, y: 0 }),
  ],
  edges: [
    makeEdge("road", roadId, downtown, riverside),
    makeEdge("footpath", footpathId, downtown, riverside),
    makeEdge("bridge", bridgeId, riverside, airport),
  ],
  exits: [makeExit(airport, "airport")],
  river: null,
  incidentNodeId: downtown,
};

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const hunterWith = (overrides: Partial<HunterState>): HunterState => ({
  ...makeHunterState({
    actionPoints: START_ACTION_POINTS,
    budget: START_BUDGET,
    trust: START_TRUST,
    pressure: START_PRESSURE,
  }),
  ...overrides,
});

type WorldOptions = {
  readonly hunter?: HunterState;
  readonly seed?: number;
  readonly startHour?: number;
  readonly criminalNodeId?: NodeId;
};

const worldAt = (options: WorldOptions = {}): WorldState =>
  makeWorldState({
    config,
    rng: rng.seed(options.seed ?? SEED),
    clock: makeClock(options.startHour ?? START_HOUR, TURN),
    map,
    hunter: options.hunter ?? hunterWith({}),
    criminal: makeCriminalState({
      nodeId: options.criminalNodeId ?? riverside,
      travelMode: "foot",
      profile: "amateur",
      stamina: START_STAMINA,
      heat: 0,
      cash: START_CASH,
      desperation: 0,
    }),
  });

const worldWith = (hunter: HunterState): WorldState => worldAt({ hunter });

const world = worldAt();

const blockRoad: HunterAction = { kind: "roadblock", edgeId: roadId };

const applied = (request: Parameters<typeof actions.apply>[0]): WorldState => {
  const result = actions.apply(request);
  if (result.kind !== "applied") {
    throw new Error(`expected the action to apply, got ${result.reason.kind}`);
  }
  return result.world;
};

const everyKind: readonly HunterAction[] = [
  blockRoad,
  { kind: "canvass", nodeId: downtown },
  { kind: "pull_cctv", nodeId: downtown },
  { kind: "true_briefing" },
];

describe("targetKindOf", () => {
  it("names what the player has to pick for each action", () => {
    expect(everyKind.map((action) => targetKindOf(action.kind))).toEqual([
      "edge",
      "node",
      "node",
      "global",
    ]);
  });
});

describe("validate", () => {
  it("allows a roadblock on a blockable edge the hunter can afford", () => {
    expect(actions.validate({ world, action: blockRoad, balance: BALANCE })).toEqual({
      kind: "allowed",
      cost: { actionPoints: ROADBLOCK.actionPointCost, budget: ROADBLOCK.budgetCost },
    });
  });

  it("refuses an edge the map does not have", () => {
    const action: HunterAction = { kind: "roadblock", edgeId: unbuiltId };

    expect(actions.validate({ world, action, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: { kind: "unknown_edge", edgeId: unbuiltId },
    });
  });

  it("refuses a footpath, which balance keeps unblockable so the city cannot be sealed", () => {
    const action: HunterAction = { kind: "roadblock", edgeId: footpathId };

    expect(actions.validate({ world, action, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: { kind: "edge_not_blockable", edgeId: footpathId },
    });
  });

  it("refuses an edge that is already blocked", () => {
    const blocked = worldWith(
      hunterWith({ containments: [{ kind: "roadblock", edgeId: roadId, expiresAt: TURN + 1 }] }),
    );

    expect(actions.validate({ world: blocked, action: blockRoad, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: { kind: "edge_already_blocked", edgeId: roadId },
    });
  });

  it("allows an edge whose earlier block has expired", () => {
    const expired = worldWith(
      hunterWith({ containments: [{ kind: "roadblock", edgeId: roadId, expiresAt: TURN }] }),
    );

    expect(actions.validate({ world: expired, action: blockRoad, balance: BALANCE }).kind).toBe(
      "allowed",
    );
  });

  it("refuses an action that costs more points than the turn has left", () => {
    const spent = worldWith(hunterWith({ actionPoints: ROADBLOCK.actionPointCost - 1 }));

    expect(actions.validate({ world: spent, action: blockRoad, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: {
        kind: "not_enough_action_points",
        required: ROADBLOCK.actionPointCost,
        available: ROADBLOCK.actionPointCost - 1,
      },
    });
  });

  it("allows an action costing exactly the points that remain", () => {
    const last = worldWith(hunterWith({ actionPoints: ROADBLOCK.actionPointCost }));

    expect(actions.validate({ world: last, action: blockRoad, balance: BALANCE }).kind).toBe(
      "allowed",
    );
  });

  it("refuses an action one unit of budget short", () => {
    const poor = worldWith(hunterWith({ budget: ROADBLOCK.budgetCost - 1 }));

    expect(actions.validate({ world: poor, action: blockRoad, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: {
        kind: "not_enough_budget",
        required: ROADBLOCK.budgetCost,
        available: ROADBLOCK.budgetCost - 1,
      },
    });
  });

  /**
   * The rejection that makes the cut bankruptcy end condition unreachable (PLAN "Decisions"), and
   * the reason the cut survives: a briefing is free, so a broke hunter always has something left
   * to do and can never be stuck.
   */
  it("refuses every priced action at a zero budget, and still allows the free one", () => {
    const broke = worldWith(hunterWith({ budget: 0 }));
    const verdicts = everyKind.map(
      (action) => actions.validate({ world: broke, action, balance: BALANCE }).kind,
    );

    expect(verdicts).toEqual(["rejected", "rejected", "rejected", "allowed"]);
  });
});

describe("apply", () => {
  it("charges the action's points and budget", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });

    expect(after.hunter.actionPoints).toBe(START_ACTION_POINTS - ROADBLOCK.actionPointCost);
    expect(after.hunter.budget).toBe(START_BUDGET - ROADBLOCK.budgetCost);
  });

  it("charges the action's trust cost", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });

    expect(after.hunter.trust).toBe(START_TRUST - ROADBLOCK.trustCost);
  });

  it("floors trust at its minimum rather than letting a cost push it negative", () => {
    const distrusted = worldWith(hunterWith({ trust: BALANCE.hunter.trustMin }));
    const after = applied({ world: distrusted, action: blockRoad, balance: BALANCE });

    expect(after.hunter.trust).toBe(BALANCE.hunter.trustMin);
  });

  it("caps trust at its maximum rather than letting a gain push it over", () => {
    const trusted = worldWith(hunterWith({ trust: BALANCE.hunter.trustMax }));
    const after = applied({ world: trusted, action: { kind: "true_briefing" }, balance: BALANCE });

    expect(after.hunter.trust).toBe(BALANCE.hunter.trustMax);
  });

  it("stands the roadblock up for its duration, and not one turn longer", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });
    const blockedOn = (turn: number): boolean =>
      blockedEdgeIdsAt(after.hunter.containments, turn).has(roadId);
    const duration = ROADBLOCK.durationTurns;

    expect(Array.from({ length: duration }, (_, offset) => blockedOn(TURN + offset))).toEqual(
      Array.from({ length: duration }, () => true),
    );
    expect(blockedOn(TURN + duration)).toBe(false);
  });

  it("takes the blocked edge out of every search while it stands", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });
    const traversal = {
      graph: after.map,
      balance: BALANCE,
      mode: "car",
      blockedEdgeIds: blockedEdgeIdsAt(after.hunter.containments, TURN),
    } as const;

    expect(graph.neighbors(traversal, downtown)).toEqual([]);
    expect(graph.shortestPath(traversal, downtown, airport).kind).toBe("unreachable");
  });

  it("leaves the footpath open, so a checkpoint never seals the city", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });
    const traversal = {
      graph: after.map,
      balance: BALANCE,
      mode: "foot",
      blockedEdgeIds: blockedEdgeIdsAt(after.hunter.containments, TURN),
    } as const;

    expect(graph.neighbors(traversal, downtown).map((one) => one.edgeId)).toEqual([footpathId]);
  });

  it("returns the rejection rather than throwing it", () => {
    const action: HunterAction = { kind: "roadblock", edgeId: footpathId };

    expect(() => actions.apply({ world, action, balance: BALANCE })).not.toThrow();
    expect(actions.apply({ world, action, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: { kind: "edge_not_blockable", edgeId: footpathId },
    });
  });

  it("charges nothing when the action is rejected", () => {
    const poor = worldWith(hunterWith({ budget: 0 }));

    expect(actions.apply({ world: poor, action: blockRoad, balance: BALANCE })).toEqual({
      kind: "rejected",
      reason: { kind: "not_enough_budget", required: ROADBLOCK.budgetCost, available: 0 },
    });
    expect(poor.hunter).toEqual(hunterWith({ budget: 0 }));
  });

  it("leaves the world it was given untouched (architecture rule 3)", () => {
    const before = JSON.parse(JSON.stringify(world));
    applied({ world, action: blockRoad, balance: BALANCE });

    expect(JSON.parse(JSON.stringify(world))).toEqual(before);
  });

  it("returns a world that still round-trips through JSON", () => {
    const after = applied({ world, action: blockRoad, balance: BALANCE });

    expect(JSON.parse(JSON.stringify(after))).toEqual(after);
  });

  /**
   * The budget floor, stated as the property the cut end condition relied on: whatever sequence
   * of affordable actions is applied, no balance below zero is ever produced.
   */
  it("never spends past zero, however often it is asked to", () => {
    let current = worldWith(
      hunterWith({ actionPoints: AMPLE_ACTION_POINTS, budget: CANVASS_ONLY_BUDGET }),
    );
    let rejections = 0;
    for (let attempt = 0; attempt < MAX_SPEND_ATTEMPTS; attempt += 1) {
      const result = actions.apply({
        world: current,
        action: { kind: "canvass", nodeId: downtown },
        balance: BALANCE,
      });
      if (result.kind === "rejected") {
        rejections += 1;
        continue;
      }
      current = result.world;
      expect(current.hunter.budget).toBeGreaterThanOrEqual(0);
    }

    expect(current.hunter.budget).toBe(0);
    expect(rejections).toBe(MAX_SPEND_ATTEMPTS - CANVASS_ONLY_BUDGET / CANVASS.budgetCost);
  });

  /** PLAN M3.4b owns the briefing's effects; what it inherits working is the billing. */
  it("bills the briefing whose effects are still to come, and changes nothing else", () => {
    const after = applied({ world, action: { kind: "true_briefing" }, balance: BALANCE });

    expect(after.hunter.actionPoints).toBeLessThan(START_ACTION_POINTS);
    expect({ ...after, hunter: world.hunter }).toEqual(world);
  });
});

const CCTV = BALANCE.actions.pullCctv;
const REPORTS = BALANCE.reports;

/** Hard-coded, never generated: a statistical assertion that re-rolls per run is not a target. */
const SEEDS: readonly number[] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

const NIGHT_HOUR = 22;
const HALF_TRUST = BALANCE.hunter.trustMax / 2;

/**
 * A density above one, so every canvass is heard whatever the hunter's standing. It is what lets
 * a report's accuracy be compared at two trust levels without the trust also deciding whether
 * there is a report to compare.
 */
const CERTAIN_DENSITY = 4;

const downtownBalance = (properties: Partial<DistrictProperties>): Balance => ({
  ...BALANCE,
  districts: {
    ...BALANCE.districts,
    downtown: { ...BALANCE.districts.downtown, ...properties },
  },
});

const ALWAYS_HEARD = downtownBalance({ witnessDensity: CERTAIN_DENSITY });
const ALWAYS_FILMED = downtownBalance({ cctvCoverage: 1 });

const canvassDowntown: HunterAction = { kind: "canvass", nodeId: downtown };
const pullDowntown: HunterAction = { kind: "pull_cctv", nodeId: downtown };

const onlyReport = (after: WorldState): Report => {
  const [report, ...rest] = after.reports;
  if (report === undefined || rest.length > 0) {
    throw new Error(`expected exactly one report, got ${after.reports.length}`);
  }
  return report;
};

const fullTrust = hunterWith({ trust: BALANCE.hunter.trustMax });

describe("canvass", () => {
  it("files what the witnesses saw when the criminal is at the door", () => {
    const seen = worldAt({ hunter: fullTrust, criminalNodeId: downtown });
    const report = onlyReport(
      applied({ world: seen, action: canvassDowntown, balance: ALWAYS_HEARD }),
    );

    expect(report.source).toBe("witness");
    expect(report.content).toEqual({ kind: "sighting", nodeId: downtown, travelMode: "foot" });
  });

  /** Negative evidence is the point, not a leftover: M3.6b's heatmap prunes with it. */
  it("files where the criminal was not, when nobody saw anything", () => {
    const report = onlyReport(
      applied({
        world: worldAt({ hunter: fullTrust }),
        action: canvassDowntown,
        balance: ALWAYS_HEARD,
      }),
    );

    expect(report.content).toEqual({ kind: "no_sighting", nodeId: downtown });
  });

  it("lands the turn it is taken, because knocking on doors is done in person", () => {
    const report = onlyReport(
      applied({
        world: worldAt({ hunter: fullTrust }),
        action: canvassDowntown,
        balance: ALWAYS_HEARD,
      }),
    );

    expect(report.observedAtTurn).toBe(TURN);
    expect(report.receivedAtTurn).toBe(TURN);
  });

  it("trusts a witness further the better the hunter's standing with the public", () => {
    const accuracyAt = (trust: number): number =>
      onlyReport(
        applied({
          world: worldAt({ hunter: hunterWith({ trust }) }),
          action: canvassDowntown,
          balance: ALWAYS_HEARD,
        }),
      ).accuracy;

    expect(accuracyAt(BALANCE.hunter.trustMax)).toBeCloseTo(
      REPORTS.baseSightingAccuracy + REPORTS.trustAccuracyWeight,
    );
    expect(accuracyAt(HALF_TRUST)).toBeCloseTo(
      REPORTS.baseSightingAccuracy + REPORTS.trustAccuracyWeight / 2,
    );
    expect(accuracyAt(HALF_TRUST)).toBeLessThan(accuracyAt(BALANCE.hunter.trustMax));
  });

  it("finds fewer people willing to talk the lower the hunter's standing", () => {
    const talkers = (trust: number): number =>
      SEEDS.filter(
        (seed) =>
          applied({
            world: worldAt({ hunter: hunterWith({ trust }), seed }),
            action: canvassDowntown,
            balance: BALANCE,
          }).reports.length > 0,
      ).length;

    expect(talkers(BALANCE.hunter.trustMin)).toBe(0);
    expect(talkers(BALANCE.hunter.trustMax)).toBeGreaterThan(talkers(BALANCE.hunter.trustMin));
  });

  it("knocks on doors nobody is behind after dark", () => {
    const emptiesAtNight = downtownBalance({
      witnessDensity: CERTAIN_DENSITY,
      nightWitnessMultiplier: 0,
    });
    const canvassAt = (startHour: number): readonly Report[] =>
      applied({
        world: worldAt({ hunter: fullTrust, startHour }),
        action: canvassDowntown,
        balance: emptiesAtNight,
      }).reports;

    expect(canvassAt(NIGHT_HOUR - TURN)).toEqual([]);
    expect(canvassAt(START_HOUR)).toHaveLength(1);
  });

  it("advances the stream even when it learns nothing, so a turn replays the same way", () => {
    const quiet = downtownBalance({ witnessDensity: 0 });
    const after = applied({ world, action: canvassDowntown, balance: quiet });

    expect(after.reports).toEqual([]);
    expect(after.rng).not.toEqual(world.rng);
  });

  it("numbers the reports it files in the order they are filed", () => {
    const request = { action: canvassDowntown, balance: ALWAYS_HEARD } as const;
    const once = applied({ ...request, world: worldAt({ hunter: fullTrust }) });
    const twice = applied({ ...request, world: once });

    expect(twice.reports.map((report) => report.id)).toEqual(["report-0", "report-1"]);
  });
});

describe("pull_cctv", () => {
  it("files reliable footage where there are cameras", () => {
    const seen = worldAt({ criminalNodeId: downtown });
    const report = onlyReport(
      applied({ world: seen, action: pullDowntown, balance: ALWAYS_FILMED }),
    );

    expect(report.source).toBe("cctv");
    expect(report.content).toEqual({ kind: "sighting", nodeId: downtown, travelMode: "foot" });
    expect(report.accuracy).toBe(REPORTS.cctvAccuracy);
  });

  it("files where the criminal was not when the footage is empty", () => {
    const report = onlyReport(applied({ world, action: pullDowntown, balance: ALWAYS_FILMED }));

    expect(report.content).toEqual({ kind: "no_sighting", nodeId: downtown });
  });

  /** DESIGN.md "Reports": reliable, delayed by one to two turns. Both delays have to be drawn. */
  it("arrives one to two turns after the footage was taken", () => {
    const delays = SEEDS.map(
      (seed) =>
        onlyReport(
          applied({ world: worldAt({ seed }), action: pullDowntown, balance: ALWAYS_FILMED }),
        ).receivedAtTurn - TURN,
    );

    expect(Math.min(...delays)).toBe(CCTV.minDelayTurns);
    expect(Math.max(...delays)).toBe(CCTV.maxDelayTurns);
    expect([...new Set(delays)].toSorted()).toEqual([CCTV.minDelayTurns, CCTV.maxDelayTurns]);
  });

  it("is as reliable at the hunter's worst standing as at their best: a camera has no opinion", () => {
    const accuracyAt = (trust: number): number =>
      onlyReport(
        applied({
          world: worldAt({ hunter: hunterWith({ trust }) }),
          action: pullDowntown,
          balance: ALWAYS_FILMED,
        }),
      ).accuracy;

    expect(accuracyAt(BALANCE.hunter.trustMin)).toBe(REPORTS.cctvAccuracy);
    expect(accuracyAt(BALANCE.hunter.trustMax)).toBe(REPORTS.cctvAccuracy);
  });

  /** A park has no cameras in shipped balance, and the hunter can read that before paying. */
  it("buys nothing but the bill where there are no cameras", () => {
    const action: HunterAction = { kind: "pull_cctv", nodeId: riverside };
    const after = applied({ world, action, balance: BALANCE });

    expect(after.reports).toEqual([]);
    expect(after.hunter.budget).toBe(START_BUDGET - CCTV.budgetCost);
    expect(after.rng).not.toEqual(world.rng);
  });
});

describe("node targets", () => {
  it("refuses a node the map does not have", () => {
    const nowhere = makeNodeId("nowhere");
    const refusals = [
      { kind: "canvass", nodeId: nowhere },
      { kind: "pull_cctv", nodeId: nowhere },
    ] as const satisfies readonly HunterAction[];

    for (const action of refusals) {
      expect(actions.validate({ world, action, balance: BALANCE })).toEqual({
        kind: "rejected",
        reason: { kind: "unknown_node", nodeId: nowhere },
      });
    }
  });
});
