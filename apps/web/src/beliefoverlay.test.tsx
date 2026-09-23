import { fc, test } from "@fast-check/vitest";
import type { Belief, HunterView, MapNode, NodeId } from "@manhunter/core";
import {
  BELIEF_MASS_TOLERANCE,
  beliefMassAt,
  IN_PROGRESS,
  makeClock,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeHunterState,
  makeNode,
  makeNodeId,
  uniformBelief,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELIEF_CONTOUR_TEST_ID,
  BELIEF_FIELD_CLASSES,
  BELIEF_FIELD_GRADIENT_ID,
  BELIEF_HEAT_TEST_ID,
  BELIEF_OVERLAY_TEST_ID,
  BeliefOverlay,
  beliefHeatOf,
  DEFAULT_BELIEF_FIELD,
  DEFAULT_HEAT_RAMP,
  heatOf,
  peakBeliefMass,
  topTierOf,
} from "./beliefoverlay";
import STYLESHEET from "./index.css?raw";
import {
  MAP_NODE_TEST_ID,
  MAP_OVERLAY_TEST_ID,
  MapRenderer,
  type MapSelection,
} from "./maprenderer";

/**
 * The mapping first and the DOM second, under the jsdom environment PLAN M5.2 installs
 * ("Decisions": M5.3b asserts here, not in Playwright). What a probability becomes is asserted
 * against `heatOf` directly, never against a snapshot of the SVG (AGENTS.md "Testing
 * expectations"); the rendering tests only check that the mapping reaches the attributes.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const RAMP = DEFAULT_HEAT_RAMP;

const HOT = makeNodeId("n-hot");
const WARM = makeNodeId("n-warm");
const COLD = makeNodeId("n-cold");
const OFF_MAP = makeNodeId("n-off-map");

const node = (id: NodeId, x: number): MapNode => makeNode(id, "downtown", { x, y: 10 });

const NODES: readonly MapNode[] = [node(HOT, 10), node(WARM, 40), node(COLD, 70)];

const HOT_MASS = 0.6;
const WARM_MASS = 0.4;

const BELIEF: Belief = [
  { nodeId: HOT, mass: HOT_MASS },
  { nodeId: WARM, mass: WARM_MASS },
  { nodeId: COLD, mass: 0 },
];

const START_HOUR = 9;
const NOW = 3;
const TURNS_REMAINING = 21;

const viewWith = (belief: Belief): HunterView => ({
  clock: makeClock(START_HOUR, NOW),
  map: {
    nodes: NODES,
    edges: [makeEdge("road", makeEdgeId("e-road"), HOT, WARM)],
    exits: [makeExit(COLD, "border")],
    river: null,
    incidentNodeId: HOT,
  },
  hunter: makeHunterState({ actionPoints: 3, budget: 100, trust: 60, pressure: 10 }),
  reports: [],
  events: [],
  belief,
  casualties: 0,
  turnsRemaining: TURNS_REMAINING,
  outcome: IN_PROGRESS,
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

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const heatFor = (nodeId: NodeId): Element | undefined =>
  all(BELIEF_HEAT_TEST_ID).find(
    (element) => element.getAttribute("data-nodeid") === String(nodeId),
  );

const opacityOf = (element: Element | undefined): number =>
  Number(element?.getAttribute("fill-opacity") ?? Number.NaN);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the probability-to-heat mapping", () => {
  it("gives a node the hunter does not suspect no heat at all", () => {
    expect(heatOf(RAMP, 0, HOT_MASS)).toBeNull();
  });

  it("gives a cell normalisation emptied no heat, rather than heat too faint to mean anything", () => {
    expect(heatOf(RAMP, BELIEF_MASS_TOLERANCE, HOT_MASS)).toBeNull();
  });

  it("draws the busiest node at the top of the ramp", () => {
    expect(heatOf(RAMP, HOT_MASS, HOT_MASS)).toEqual({
      intensity: 1,
      radius: RAMP.maxRadius,
      opacity: RAMP.maxOpacity,
    });
  });

  it("keys the ramp to the busiest cell, so a thinly spread hunt is still visible", () => {
    const thin = 0.03;

    expect(heatOf(RAMP, thin, thin)?.opacity).toBe(RAMP.maxOpacity);
  });

  it("never draws a live cell at nothing, however little of the mass it holds", () => {
    const faint = heatOf(RAMP, BELIEF_MASS_TOLERANCE * 2, HOT_MASS);

    expect(faint?.opacity).toBeGreaterThanOrEqual(RAMP.minOpacity);
    expect(faint?.radius).toBeGreaterThanOrEqual(RAMP.minRadius);
  });

  it("has no ramp to key when every cell is empty", () => {
    expect(heatOf(RAMP, HOT_MASS, 0)).toBeNull();
  });

  test.prop([
    fc.double({ min: Number.MIN_VALUE, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  ])("never draws a smaller mass more strongly than a larger one", (peak, first, second) => {
    const lower = heatOf(RAMP, Math.min(first, second) * peak, peak);
    const higher = heatOf(RAMP, Math.max(first, second) * peak, peak);
    if (higher === null) {
      expect(lower).toBeNull();
      return;
    }
    expect(higher.opacity).toBeGreaterThanOrEqual(lower?.opacity ?? 0);
    expect(higher.radius).toBeGreaterThanOrEqual(lower?.radius ?? 0);
  });
});

describe("the peak the ramp is keyed to", () => {
  it("is the busiest cell of the distribution", () => {
    expect(peakBeliefMass(BELIEF)).toBe(HOT_MASS);
  });

  it("is nothing at all when the hunter has no distribution", () => {
    expect(peakBeliefMass([])).toBe(0);
  });
});

describe("the heat of a whole distribution", () => {
  it("drops a cell naming a node the map does not have, before it takes the peak", () => {
    const stale: Belief = [...BELIEF, { nodeId: OFF_MAP, mass: 1 }];

    const heats = beliefHeatOf(stale, NODES, RAMP);

    expect(heats.map((each) => each.nodeId)).toEqual([HOT, WARM]);
    expect(heats[0]?.heat.opacity).toBe(RAMP.maxOpacity);
  });

  it("draws nothing for a hunter with no distribution at all", () => {
    expect(beliefHeatOf([], NODES, RAMP)).toEqual([]);
  });

  it("draws nothing when every cell of the distribution is empty", () => {
    const empty: Belief = NODES.map((each) => ({ nodeId: each.id, mass: 0 }));

    expect(beliefHeatOf(empty, NODES, RAMP)).toEqual([]);
  });

  it("places heat where the map places the node", () => {
    const placed = beliefHeatOf(BELIEF, NODES, RAMP)[0];

    expect(placed?.position).toEqual(NODES[0]?.position);
  });
});

describe("the drawn overlay", () => {
  it("draws no heat on a node the hunter does not suspect", async () => {
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} />);

    expect(all(BELIEF_HEAT_TEST_ID)).toHaveLength(2);
    expect(heatFor(COLD)).toBeUndefined();
    expect(beliefMassAt(BELIEF, COLD)).toBe(0);
  });

  it("draws a node's heat where the map draws the node", async () => {
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} />);

    const hot = NODES[0];

    expect(Number(heatFor(HOT)?.getAttribute("cx"))).toBe(hot?.position.x);
    expect(Number(heatFor(HOT)?.getAttribute("cy"))).toBe(hot?.position.y);
  });

  it("draws the highest-belief node the most strongly", async () => {
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} />);

    expect(opacityOf(heatFor(HOT))).toBe(RAMP.maxOpacity);
    expect(opacityOf(heatFor(HOT))).toBeGreaterThan(opacityOf(heatFor(WARM)));
  });

  it("draws no layer at all when nothing is suspected, rather than an empty one", async () => {
    const empty: Belief = NODES.map((each) => ({ nodeId: each.id, mass: 0 }));

    await render(<BeliefOverlay belief={empty} nodes={NODES} />);

    expect(one(BELIEF_OVERLAY_TEST_ID)).toBeNull();
  });

  it("draws one blob per suspected node of a uniform distribution", async () => {
    await render(
      <BeliefOverlay belief={uniformBelief(NODES.map((each) => each.id))} nodes={NODES} />,
    );

    expect(all(BELIEF_HEAT_TEST_ID)).toHaveLength(NODES.length);
  });
});

describe("the overlay drawn into the map", () => {
  const drawInto = (selected: MapSelection[]): ReactNode => (
    <MapRenderer
      view={viewWith(BELIEF)}
      selection={null}
      onSelect={(selection) => selected.push(selection)}
      overlay={<BeliefOverlay belief={BELIEF} nodes={NODES} />}
    />
  );

  it("draws its heat inside the layer that takes no pointer events", async () => {
    await render(drawInto([]));

    const overlay = one(MAP_OVERLAY_TEST_ID);

    expect(overlay?.getAttribute("style")).toContain("pointer-events: none");
    expect(overlay?.querySelectorAll(`[data-testid="${BELIEF_HEAT_TEST_ID}"]`)).toHaveLength(2);
  });

  it("does not intercept the click that selects the node beneath it", async () => {
    const selected: MapSelection[] = [];
    await render(drawInto(selected));

    const target = all(MAP_NODE_TEST_ID).find(
      (element) => element.getAttribute("data-nodeid") === String(HOT),
    );
    if (!target) throw new Error("the hottest node was not rendered");
    await act(async () => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selected).toEqual([{ kind: "node", nodeId: HOT }]);
  });
});

describe("the belief field (PLAN M6.6)", () => {
  const FIELD = DEFAULT_BELIEF_FIELD;

  it("fills every blob from the one radial gradient, whose stops are the ramp's hue", async () => {
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} />);

    for (const blob of all(BELIEF_HEAT_TEST_ID)) {
      expect(blob.getAttribute("fill")).toBe(`url(#${BELIEF_FIELD_GRADIENT_ID})`);
      expect(blob.getAttribute("class")).toBe(BELIEF_FIELD_CLASSES.blob);
    }
    const stops = Array.from(
      container?.querySelectorAll(`#${BELIEF_FIELD_GRADIENT_ID} stop`) ?? [],
    );
    expect(stops).toHaveLength(FIELD.stops.length);
    for (const stop of stops) expect(stop.getAttribute("stop-color")).toBe(RAMP.fill);
  });

  it("fades the gradient from a solid core to nothing at the rim", () => {
    const opacities = FIELD.stops.map((stop) => stop.opacity);

    expect(opacities[0]).toBe(1);
    expect(opacities.at(-1)).toBe(0);
    expect([...opacities].sort((first, second) => second - first)).toEqual(opacities);
  });

  it("blends the blobs additively, isolated from the plate under them", () => {
    expect(STYLESHEET).toMatch(/\.mh-belief-field\s*\{\s*isolation:\s*isolate/);
    expect(STYLESHEET).toMatch(/\.mh-belief-field__blob\s*\{\s*mix-blend-mode:\s*plus-lighter/);
  });

  it("puts a node in the top tier from the contour's threshold of the peak, and no lower", () => {
    const heats = beliefHeatOf(BELIEF, NODES, RAMP);
    const warm = heats.find((each) => each.nodeId === WARM)?.heat.intensity ?? Number.NaN;

    expect(warm).toBeLessThan(FIELD.contourFrom);
    expect(topTierOf(heats, FIELD.contourFrom)).toEqual(new Set([HOT]));
    expect(topTierOf(heats, warm)).toEqual(new Set([HOT, WARM]));
  });

  it("marks the top tier on its blobs", async () => {
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} />);

    expect(heatFor(HOT)?.getAttribute("data-top-tier")).toBe("true");
    expect(heatFor(WARM)?.getAttribute("data-top-tier")).toBe("false");
  });

  it("outlines the top tier with one contour, inside the layer that takes no pointer events", async () => {
    await render(
      <MapRenderer
        view={viewWith(BELIEF)}
        selection={null}
        onSelect={() => undefined}
        overlay={<BeliefOverlay belief={BELIEF} nodes={NODES} />}
      />,
    );

    const contour = one(BELIEF_CONTOUR_TEST_ID);
    expect(all(BELIEF_CONTOUR_TEST_ID)).toHaveLength(1);
    expect(contour?.getAttribute("data-nodeids")).toBe(String(HOT));
    expect(contour?.closest(`[data-testid="${MAP_OVERLAY_TEST_ID}"]`)).not.toBeNull();
    expect(contour?.querySelector("path[stroke-dasharray]")?.getAttribute("stroke")).toBe(
      FIELD.contourStroke,
    );
  });

  it("draws the contour from the bounds it is given", async () => {
    const wide = { minX: -500, minY: -500, maxX: 500, maxY: 500 };
    await render(<BeliefOverlay belief={BELIEF} nodes={NODES} bounds={wide} />);

    const outline = one(BELIEF_CONTOUR_TEST_ID)?.querySelector("path")?.getAttribute("d") ?? "";
    expect(outline).toContain("-500");
  });

  it("draws no contour when there is no heat", async () => {
    const empty: Belief = NODES.map((each) => ({ nodeId: each.id, mass: 0 }));
    await render(<BeliefOverlay belief={empty} nodes={NODES} />);

    expect(one(BELIEF_CONTOUR_TEST_ID)).toBeNull();
  });
});
