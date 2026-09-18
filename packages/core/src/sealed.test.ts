import { describe, expect, it } from "vitest";
import type { GameConfig } from "./config";
import { makeCriminalState } from "./criminal";
import { makeHunterState } from "./hunter";
import { makeEdgeId, makeNodeId } from "./ids";
import type { MapGraph } from "./map";
import { makeEdge, makeExit, makeNode } from "./map";
import { createRng } from "./rng";
import { type SealedWorld, seal, unseal } from "./sealed";
import { makeClock } from "./time";
import { makeWorldState, type WorldState } from "./world";

// Architecture rule 4, checked in the type layer the way `view.test.ts` checks the view. A seal
// that stops branding, or that leaks a member of the world it wraps, fails `bun run typecheck`
// before any test runs.
type AssertTrue<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type NotAssignable<A, B> = [A] extends [B] ? false : true;

export type SealedWorldNamesNoMember = AssertTrue<IsNever<Extract<keyof SealedWorld, string>>>;
export type SealedWorldHidesEveryWorldMember = AssertTrue<
  IsNever<Extract<keyof WorldState, keyof SealedWorld>>
>;
export type PlainWorldIsNotSealed = AssertTrue<NotAssignable<WorldState, SealedWorld>>;
export type SealedWorldIsNotAWorld = AssertTrue<NotAssignable<SealedWorld, WorldState>>;

const rng = createRng();

const SEED = 1;
const START_HOUR = 21;
const MAX_TURNS = 24;
const START_ACTION_POINTS = 3;
const START_BUDGET = 1000;
const START_TRUST = 60;
const START_PRESSURE = 10;
const START_STAMINA = 100;
const START_CASH = 250;

const downtown = makeNodeId("downtown");
const airport = makeNodeId("airport");

const config: GameConfig = {
  criminalProfile: "amateur",
  startHour: START_HOUR,
  maxTurns: MAX_TURNS,
  map: { columns: 8, rows: 6, exitCount: 3 },
  difficulty: "standard",
};

const map: MapGraph = {
  nodes: [
    makeNode(downtown, "downtown", { x: 0, y: 0 }),
    makeNode(airport, "exit", { x: 1, y: 0 }),
  ],
  edges: [makeEdge("road", makeEdgeId("e1"), downtown, airport)],
  exits: [makeExit(airport, "airport")],
  river: null,
  incidentNodeId: downtown,
};

const sampleWorld = (): WorldState =>
  makeWorldState({
    config,
    rng: rng.seed(SEED),
    clock: makeClock(START_HOUR, 0),
    map,
    hunter: makeHunterState({
      actionPoints: START_ACTION_POINTS,
      budget: START_BUDGET,
      trust: START_TRUST,
      pressure: START_PRESSURE,
    }),
    criminal: makeCriminalState({
      nodeId: downtown,
      travelMode: "foot",
      profile: "amateur",
      stamina: START_STAMINA,
      heat: 0,
      cash: START_CASH,
      desperation: 0,
    }),
  });

describe("sealing a world", () => {
  it("hands back the same world it was given", () => {
    const world = sampleWorld();
    expect(unseal(seal(world))).toBe(world);
  });

  it("changes nothing a game function reads off the world", () => {
    const world = sampleWorld();
    expect(unseal(seal(world))).toEqual(world);
  });

  // The limit AGENTS.md rule 4 accepts by name: the seal is a type-level guarantee, and the
  // bytes stay readable because a replay has to be able to serialize the game it stores.
  it("leaves the bytes intact, so a sealed world still serializes for replays", () => {
    const world = sampleWorld();
    expect(JSON.stringify(seal(world))).toBe(JSON.stringify(world));
  });

  it("round-trips a sealed world through JSON (architecture rule 3)", () => {
    const world = sampleWorld();
    const restored: SealedWorld = JSON.parse(JSON.stringify(seal(world)));
    expect(unseal(restored)).toEqual(world);
  });
});
