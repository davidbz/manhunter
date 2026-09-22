/**
 * The reports nobody asked for (DESIGN.md "Reports"). A canvass or a camera pull is intelligence
 * the hunter paid for and `actions.ts` owns it; this is the other half of the feed - the passer-by
 * who recognised a face, and the caller who invented one - and the hunter's only lever on either
 * is the standing and the attention they have built up.
 *
 * It is a separate producer from `actions.ts`'s `IntelSource` rather than two more entries in that
 * table, which is where the PLAN M3.4a note pointed. A requested source answers "what is at the
 * node the hunter chose", always truthfully and always about that node; an unrequested one chooses
 * its own node, may be about nobody, and has no action, no cost and no target to validate. What
 * they share is `report.ts`, which is where the formulas both of them read now live.
 *
 * `collect` returns the reports rather than a world with the reports in it. The turn loop (PLAN
 * M3.8a) is what decides when they are filed and what they cost the criminal in heat, and the
 * event feed (PLAN M3.7) needs to know which reports were new this turn to announce them; a
 * producer that appended to the world would have made both of those a diff.
 *
 * Every source costs exactly one `rng.float` in table order whether or not it fires, so a turn's
 * intake is a pure function of the world and the stream position (architecture rule 2).
 */

import type { Balance, DistrictProperties } from "./balance";
import { heatFactorOf } from "./criminal";
import { districtPropertiesAt, witnessDensityAt } from "./exposure";
import type { GraphLogic, Traversal } from "./graph";
import { trustFactorOf } from "./hunter";
import type { NodeId } from "./ids";
import type { TravelMode } from "./map";
import {
  makeReport,
  nextReportId,
  prankRate,
  type Report,
  type ReportSource,
  type ReportTruth,
  reportVolumeFactor,
  sightingAccuracy,
  UNKNOWN_TRAVEL_MODE,
} from "./report";
import type { NonEmptyArray, Rng, RngDraw, RngState } from "./rng";
import type { WorldState } from "./world";

export type IntelRequest = {
  readonly world: WorldState;
  readonly balance: Balance;
};

/** What came in this turn, and the stream position after the draws that produced it. */
export type IntelDraw = RngDraw<readonly Report[]>;

export type IntelLogic = {
  readonly collect: (request: IntelRequest) => IntelDraw;
};

type IntelDeps = {
  readonly rng: Rng;
  readonly graph: GraphLogic;
};

/** A report that is not about the criminal holds nothing true about where the criminal is. */
const UNTRUE_ACCURACY = 0;

/** Everything the sources read, derived once per turn (the `Lookout` shape in `actions.ts`). */
type Scene = {
  readonly world: WorldState;
  readonly balance: Balance;
  /** Where the criminal is standing, which is the only district a witness can see them in. */
  readonly properties: DistrictProperties;
  readonly trustFactor: number;
  readonly heatFactor: number;
};

/** What a source files when it fires. */
type Filing = {
  readonly source: ReportSource;
  readonly truth: ReportTruth;
  readonly nodeId: NodeId;
  readonly travelMode: TravelMode | typeof UNKNOWN_TRAVEL_MODE;
  readonly accuracy: number;
};

/**
 * One thing the city does unasked, as data: how often it happens, and what it files when it does.
 * A reward line (PLAN M7) or a planted trail is an entry here rather than a branch in `collect`.
 */
type UnpromptedSource = {
  readonly rate: (scene: Scene) => number;
  readonly file: (deps: IntelDeps, scene: Scene, state: RngState) => RngDraw<Filing | null>;
};

const nonEmpty = <T>(items: readonly T[]): NonEmptyArray<T> | null => {
  const [first, ...rest] = items;
  return first === undefined ? null : [first, ...rest];
};

/**
 * Somewhere a short walk from where the criminal actually is. Roadblocks are left in the graph:
 * a checkpoint stops people crossing, it does not stop a witness confusing one street with the
 * next one over.
 */
const nearbyTraversal = (scene: Scene): Traversal => ({
  graph: scene.world.map,
  balance: scene.balance,
  mode: scene.balance.map.escapeMode,
});

/**
 * A witness who was looking at somebody else. The wrong node is a neighbouring one rather than any
 * node on the map, because a mistaken witness is a near miss and a call from the far side of the
 * city with nothing behind it is the prank below - DESIGN.md has the hunter telling those apart by
 * inconsistency, which only works if they are inconsistent in different ways.
 *
 * A node with nowhere adjacent to confuse it with files nothing. The generator's connectivity rule
 * makes that unreachable in a real city; it is here so the lookup is total rather than assumed.
 */
const mistakenWitness = (
  deps: IntelDeps,
  scene: Scene,
  state: RngState,
): RngDraw<Filing | null> => {
  const nearby = nonEmpty(
    deps.graph
      .neighbors(nearbyTraversal(scene), scene.world.criminal.nodeId)
      .map((neighbor) => neighbor.nodeId),
  );
  if (nearby === null) {
    return { state, value: null };
  }
  const picked = deps.rng.pick(state, nearby);
  return {
    state: picked.state,
    value: {
      source: "witness",
      truth: "false",
      nodeId: picked.value,
      travelMode: UNKNOWN_TRAVEL_MODE,
      accuracy: UNTRUE_ACCURACY,
    },
  };
};

/**
 * The public, unprompted. How many of them come forward is the district's witness density at this
 * hour, scaled by how much the city trusts the hunt enough to ring in, by how much of the news it
 * has heard, and by how recognisable the criminal has made themselves - DESIGN.md lists all four
 * against a sighting, and heat is the term that separates this from a canvass: the hunter can
 * stand in a district and ask, but the city only volunteers a face it already knows.
 *
 * `falseReportRate` of them are about somebody else. Trust decides both how many calls there are
 * and how far any of them can be taken (`sightingAccuracy`); the rest of the terms decide only
 * whether the phone rings at all.
 */
const WITNESS: UnpromptedSource = {
  rate: (scene) =>
    witnessDensityAt(scene.balance.time, scene.properties, scene.world.clock.hour) *
    scene.trustFactor *
    reportVolumeFactor(
      scene.balance.actions.trueBriefing,
      scene.world.hunter.briefingTurns.length,
    ) *
    scene.heatFactor,
  file: (deps, scene, state) => {
    const drawn = deps.rng.float(state);
    if (drawn.value < scene.balance.reports.falseReportRate) {
      return mistakenWitness(deps, scene, drawn.state);
    }
    return {
      state: drawn.state,
      value: {
        source: "witness",
        truth: "true",
        nodeId: scene.world.criminal.nodeId,
        travelMode: scene.world.criminal.travelMode,
        accuracy: sightingAccuracy(scene.balance.reports, scene.trustFactor),
      },
    };
  },
};

/**
 * The caller with nothing to report and a reason to ring anyway. Uniform over the whole map rather
 * than anywhere near the criminal: a prank has no source of truth to be near, and a feed whose
 * invented calls clustered where the criminal was would be the opposite of noise.
 *
 * An empty map has nowhere to invent, which no generated city is, but the lookup is total.
 */
const PRANK: UnpromptedSource = {
  rate: (scene) => prankRate(scene.balance.reports, scene.world.hunter.briefingTurns.length),
  file: (deps, scene, state) => {
    const anywhere = nonEmpty(scene.world.map.nodes.map((node) => node.id));
    if (anywhere === null) {
      return { state, value: null };
    }
    const picked = deps.rng.pick(state, anywhere);
    return {
      state: picked.state,
      value: {
        source: "tip",
        truth: "prank",
        nodeId: picked.value,
        travelMode: UNKNOWN_TRAVEL_MODE,
        accuracy: UNTRUE_ACCURACY,
      },
    };
  },
};

const SOURCES: readonly UnpromptedSource[] = [WITNESS, PRANK];

/**
 * Ids continue past the reports already in the world *and* past the ones drawn earlier in this
 * turn, because `nextReportId` counts a list and the world has not been given these yet.
 */
const fileOne = (
  deps: IntelDeps,
  scene: Scene,
  drawn: IntelDraw,
  source: UnpromptedSource,
): IntelDraw => {
  const rolled = deps.rng.float(drawn.state);
  if (rolled.value >= source.rate(scene)) {
    return { state: rolled.state, value: drawn.value };
  }
  const filed = source.file(deps, scene, rolled.state);
  if (filed.value === null) {
    return { state: filed.state, value: drawn.value };
  }
  const report = makeReport({
    id: nextReportId([...scene.world.reports, ...drawn.value]),
    source: filed.value.source,
    observedAtTurn: scene.world.clock.turn,
    deliveryDelayTurns: scene.balance.reports.unpromptedDelayTurns,
    content: {
      kind: "sighting",
      nodeId: filed.value.nodeId,
      travelMode: filed.value.travelMode,
    },
    truth: filed.value.truth,
    accuracy: filed.value.accuracy,
  });
  return { state: filed.state, value: [...drawn.value, report] };
};

export const createIntelLogic = (deps: IntelDeps): IntelLogic => ({
  collect: ({ world, balance }) => {
    const scene: Scene = {
      world,
      balance,
      properties: districtPropertiesAt(balance.districts, world.map, world.criminal.nodeId),
      trustFactor: trustFactorOf(balance.hunter, world.hunter.trust),
      heatFactor: heatFactorOf(balance.criminal, world.criminal.heat),
    };
    const nothingYet: IntelDraw = { state: world.rng, value: [] };
    return SOURCES.reduce((drawn, source) => fileOne(deps, scene, drawn, source), nothingYet);
  },
});
