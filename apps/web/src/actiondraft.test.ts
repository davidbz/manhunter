import { type HunterActionKind, makeEdgeId, makeNodeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import {
  type ActionTarget,
  acceptsTarget,
  buildAction,
  GLOBAL_TARGET,
  targetOf,
} from "./actiondraft";

/**
 * PLAN M5.5a's second acceptance criterion: an action plus a target of the wrong kind cannot be
 * built. The type system already refuses the malformed value - `{ kind: "roadblock", nodeId }` is
 * not a `HunterAction` - so what is asserted here is that the draft stage cannot produce one
 * either, for every pair of the MVP set.
 */

const EDGE_ID = makeEdgeId("e-1-2-h");
const NODE_ID = makeNodeId("n-1-2");

const EDGE_TARGET: ActionTarget = { kind: "edge", edgeId: EDGE_ID };
const NODE_TARGET: ActionTarget = { kind: "node", nodeId: NODE_ID };

const EVERY_TARGET: readonly ActionTarget[] = [EDGE_TARGET, NODE_TARGET, GLOBAL_TARGET];

/**
 * Keyed by kind rather than listed, so a fifth `HunterActionKind` in `core` stops this file
 * compiling until it names the target it accepts (the `ACTION_SAMPLES` precedent in
 * `core/src/replay.test.ts`).
 */
const ACCEPTED_TARGET: Readonly<Record<HunterActionKind, ActionTarget>> = {
  roadblock: EDGE_TARGET,
  canvass: NODE_TARGET,
  pull_cctv: NODE_TARGET,
  true_briefing: GLOBAL_TARGET,
};

/** Read back off the exhaustive table above, so the two cannot name different sets. */
const EVERY_KIND = Object.keys(ACCEPTED_TARGET) as readonly HunterActionKind[];

describe("building an action from a draft", () => {
  it("builds every MVP action from the target it accepts", () => {
    for (const kind of EVERY_KIND) {
      expect(buildAction(kind, ACCEPTED_TARGET[kind])?.kind).toBe(kind);
    }
  });

  it("carries the selected id onto the action it builds", () => {
    expect(buildAction("roadblock", EDGE_TARGET)).toEqual({ kind: "roadblock", edgeId: EDGE_ID });
    expect(buildAction("canvass", NODE_TARGET)).toEqual({ kind: "canvass", nodeId: NODE_ID });
    expect(buildAction("pull_cctv", NODE_TARGET)).toEqual({ kind: "pull_cctv", nodeId: NODE_ID });
    expect(buildAction("true_briefing", GLOBAL_TARGET)).toEqual({ kind: "true_briefing" });
  });

  it("builds nothing from a target of the wrong kind, for every pair in the MVP set", () => {
    const wrongPairs = EVERY_KIND.flatMap((kind) =>
      EVERY_TARGET.filter((target) => target !== ACCEPTED_TARGET[kind]).map((target) => ({
        kind,
        target,
      })),
    );

    expect(wrongPairs).toHaveLength(EVERY_KIND.length * (EVERY_TARGET.length - 1));
    for (const pair of wrongPairs) {
      expect(buildAction(pair.kind, pair.target)).toBeNull();
    }
  });
});

describe("which targets an action accepts", () => {
  it("accepts exactly the target core names for it", () => {
    for (const kind of EVERY_KIND) {
      for (const target of EVERY_TARGET) {
        expect(acceptsTarget(kind, target)).toBe(target === ACCEPTED_TARGET[kind]);
      }
    }
  });

  it("gives a global action its target the moment it is armed", () => {
    expect(targetOf("true_briefing", null)).toEqual(GLOBAL_TARGET);
  });

  it("leaves a targeted action pointed at nothing until the map is used", () => {
    expect(targetOf("roadblock", null)).toBeNull();
    expect(targetOf("canvass", null)).toBeNull();
  });

  it("ignores a selection the armed action does not accept", () => {
    expect(targetOf("roadblock", { kind: "node", nodeId: NODE_ID })).toBeNull();
    expect(targetOf("canvass", { kind: "edge", edgeId: EDGE_ID })).toBeNull();
  });

  it("takes the selection when the armed action accepts it", () => {
    expect(targetOf("roadblock", { kind: "edge", edgeId: EDGE_ID })).toEqual(EDGE_TARGET);
    expect(targetOf("pull_cctv", { kind: "node", nodeId: NODE_ID })).toEqual(NODE_TARGET);
  });
});
