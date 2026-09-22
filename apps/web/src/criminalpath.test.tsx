import type { HunterView, MapNode, NodeId, RevealFrame } from "@manhunter/core";
import {
  IN_PROGRESS,
  makeClock,
  makeExit,
  makeHunterState,
  makeNode,
  makeNodeId,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  CRIMINAL_PATH_MARKER_TEST_ID,
  CRIMINAL_PATH_TEST_ID,
  CRIMINAL_PATH_TRAIL_TEST_ID,
  CriminalPath,
  markerOf,
  trailPositionsOf,
} from "./criminalpath";
import { positionIndexOf } from "./mapnodes";
import {
  MAP_NODE_TEST_ID,
  MAP_OVERLAY_TEST_ID,
  MapRenderer,
  type MapSelection,
} from "./maprenderer";

/**
 * The mapping first, asserted directly per AGENTS.md "do not snapshot-test the SVG", and the DOM
 * second, under the jsdom environment PLAN M5.2 installs. The AC ("scrubbing to a turn shows the
 * criminal's position for it") is proved by `markerOf` and the rendering tests together: the
 * mapping says what a turn becomes, the rendering tests say it reaches the DOM.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST = makeNodeId("n-first");
const SECOND = makeNodeId("n-second");
const THIRD = makeNodeId("n-third");
const OFF_MAP = makeNodeId("n-off-map");

const node = (id: NodeId, x: number): MapNode => makeNode(id, "downtown", { x, y: 10 });

const NODES: readonly MapNode[] = [node(FIRST, 0), node(SECOND, 20), node(THIRD, 40)];
const POSITIONS = positionIndexOf(NODES);

const START_HOUR = 9;
const TURNS_REMAINING = 21;

/** `CriminalPath` never reads `view`; a minimal but real one keeps the fixture honest. */
const viewAt = (turn: number): HunterView => ({
  clock: makeClock(START_HOUR, turn),
  map: {
    nodes: NODES,
    edges: [],
    exits: [makeExit(THIRD, "border")],
    river: null,
    incidentNodeId: FIRST,
  },
  hunter: makeHunterState({ actionPoints: 3, budget: 100, trust: 60, pressure: 10 }),
  reports: [],
  events: [],
  belief: [],
  casualties: 0,
  turnsRemaining: TURNS_REMAINING,
  outcome: IN_PROGRESS,
});

const frame = (turn: number, criminalNodeId: NodeId): RevealFrame => ({
  turn,
  view: viewAt(turn),
  criminalNodeId,
});

const FRAMES: readonly RevealFrame[] = [frame(0, FIRST), frame(1, SECOND), frame(2, THIRD)];

describe("the trail up to a scrubbed turn", () => {
  it("holds one position at turn 0", () => {
    expect(trailPositionsOf(FRAMES, POSITIONS, 0)).toEqual([NODES[0]?.position]);
  });

  it("grows by one position for every turn scrubbed past", () => {
    expect(trailPositionsOf(FRAMES, POSITIONS, 1)).toEqual([
      NODES[0]?.position,
      NODES[1]?.position,
    ]);
    expect(trailPositionsOf(FRAMES, POSITIONS, 2)).toEqual([
      NODES[0]?.position,
      NODES[1]?.position,
      NODES[2]?.position,
    ]);
  });

  it("drops a frame naming a node the map does not have", () => {
    const stale: readonly RevealFrame[] = [frame(0, FIRST), frame(1, OFF_MAP)];

    expect(trailPositionsOf(stale, POSITIONS, 1)).toEqual([NODES[0]?.position]);
  });
});

describe("the marker for a scrubbed turn", () => {
  it("is the criminal's position for that turn, which is the AC itself", () => {
    expect(markerOf(FRAMES, POSITIONS, 1)).toEqual({
      nodeId: SECOND,
      position: NODES[1]?.position,
    });
  });

  it("moves to a different position when the scrubbed turn changes", () => {
    expect(markerOf(FRAMES, POSITIONS, 0)?.nodeId).toBe(FIRST);
    expect(markerOf(FRAMES, POSITIONS, 2)?.nodeId).toBe(THIRD);
  });

  it("is nothing for a turn no frame covers", () => {
    expect(markerOf(FRAMES, POSITIONS, 99)).toBeNull();
  });

  it("is nothing for a turn between two frames, rather than the next one after it", () => {
    const gapped: readonly RevealFrame[] = [frame(0, FIRST), frame(2, THIRD)];

    expect(markerOf(gapped, POSITIONS, 1)).toBeNull();
  });

  it("is nothing for a frame naming a node the map does not have", () => {
    expect(markerOf([frame(0, OFF_MAP)], POSITIONS, 0)).toBeNull();
  });
});

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (children: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(children);
  });
};

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the drawn path", () => {
  it("draws nothing before any turn has been revealed", async () => {
    await render(<CriminalPath frames={[]} nodes={NODES} turn={0} />);

    expect(one(CRIMINAL_PATH_TEST_ID)).toBeNull();
  });

  it("draws the criminal's marker at the scrubbed turn's position", async () => {
    await render(<CriminalPath frames={FRAMES} nodes={NODES} turn={1} />);

    const marker = one(CRIMINAL_PATH_MARKER_TEST_ID);

    expect(marker?.getAttribute("data-nodeid")).toBe(String(SECOND));
    expect(Number(marker?.getAttribute("cx"))).toBe(NODES[1]?.position.x);
    expect(Number(marker?.getAttribute("cy"))).toBe(NODES[1]?.position.y);
  });

  it("moves the marker when scrubbed to a different turn", async () => {
    await render(<CriminalPath frames={FRAMES} nodes={NODES} turn={2} />);

    expect(one(CRIMINAL_PATH_MARKER_TEST_ID)?.getAttribute("data-nodeid")).toBe(String(THIRD));
  });

  it("draws no trail at turn 0, one position being a marker rather than a path", async () => {
    await render(<CriminalPath frames={FRAMES} nodes={NODES} turn={0} />);

    expect(one(CRIMINAL_PATH_TRAIL_TEST_ID)).toBeNull();
    expect(one(CRIMINAL_PATH_MARKER_TEST_ID)).not.toBeNull();
  });

  it("draws the trail through every position once more than one turn is revealed", async () => {
    await render(<CriminalPath frames={FRAMES} nodes={NODES} turn={2} />);

    const points = one(CRIMINAL_PATH_TRAIL_TEST_ID)?.getAttribute("points") ?? "";

    expect(points.trim().split(" ")).toHaveLength(3);
  });
});

describe("the path drawn into the map", () => {
  it("draws inside the layer that takes no pointer events and does not swallow a click", async () => {
    const selected: MapSelection[] = [];
    await render(
      <MapRenderer
        view={viewAt(2)}
        selection={null}
        onSelect={(selection) => selected.push(selection)}
        overlay={<CriminalPath frames={FRAMES} nodes={NODES} turn={2} />}
      />,
    );

    const overlay = one(MAP_OVERLAY_TEST_ID);
    expect(
      overlay?.querySelector(`[data-testid="${CRIMINAL_PATH_MARKER_TEST_ID}"]`),
    ).not.toBeNull();

    const target = Array.from(
      container?.querySelectorAll(`[data-testid="${MAP_NODE_TEST_ID}"]`) ?? [],
    ).find((element) => element.getAttribute("data-nodeid") === String(THIRD));
    if (!target) throw new Error("the target node was not rendered");
    await act(async () => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selected).toEqual([{ kind: "node", nodeId: THIRD }]);
  });
});
