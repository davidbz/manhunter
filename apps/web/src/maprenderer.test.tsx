import type {
  Containment,
  DistrictType,
  HunterView,
  MapEdge,
  MapNode,
  NodeId,
} from "@manhunter/core";
import {
  BALANCE,
  createDistrictLogic,
  createGameLogic,
  createGenerationLogic,
  createGraphLogic,
  createMinCutLogic,
  createRiverLogic,
  createRng,
  createTopologyLogic,
  createValidatorLogic,
  IN_PROGRESS,
  makeClock,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeHunterState,
  makeNode,
  makeNodeId,
  toHunterView,
  uniformBelief,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAP_EDGE_TEST_ID,
  MAP_NODE_TEST_ID,
  MAP_OVERLAY_TEST_ID,
  MAP_RIVER_TEST_ID,
  MAP_SELECTION_TEST_ID,
  MAP_TEST_ID,
  MapRenderer,
  type MapSelection,
  ROAD_GLOW_FILTER_ID,
} from "./maprenderer";

/**
 * The renderer driven the way a player drives it, under the jsdom environment PLAN M5.2 installs
 * ("Decisions": M5.3a asserts here, not in Playwright). Structure and behaviour only - counts, the
 * selection callback, the river element - never a snapshot of the SVG (AGENTS.md "Testing
 * expectations").
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const DOWNTOWN = makeNodeId("n-downtown");
const RESIDENTIAL = makeNodeId("n-residential");
const BORDER = makeNodeId("n-border");

const ROAD = makeEdgeId("e-road");
const FOOTPATH = makeEdgeId("e-footpath");
const BRIDGE = makeEdgeId("e-bridge");

const node = (id: NodeId, districtType: DistrictType, x: number, y: number): MapNode =>
  makeNode(id, districtType, { x, y });

const NODES: readonly MapNode[] = [
  node(DOWNTOWN, "downtown", 10, 10),
  node(RESIDENTIAL, "residential", 40, 10),
  node(BORDER, "exit", 40, 60),
];

const EDGES: readonly MapEdge[] = [
  makeEdge("road", ROAD, DOWNTOWN, RESIDENTIAL),
  makeEdge("footpath", FOOTPATH, RESIDENTIAL, BORDER),
  makeEdge("bridge", BRIDGE, DOWNTOWN, BORDER),
];

const RIVER_POINTS = [
  { x: 0, y: 35 },
  { x: 50, y: 35 },
];

const START_HOUR = 9;
const NOW = 3;
const TURNS_REMAINING = 21;

const viewWith = (
  parts: {
    readonly river?: boolean;
    readonly edges?: readonly MapEdge[];
    readonly containments?: readonly Containment[];
  } = {},
): HunterView => ({
  clock: makeClock(START_HOUR, NOW),
  map: {
    nodes: NODES,
    edges: parts.edges ?? EDGES,
    exits: [makeExit(BORDER, "border")],
    river: parts.river === false ? null : { points: RIVER_POINTS },
    incidentNodeId: DOWNTOWN,
  },
  hunter: {
    ...makeHunterState({ actionPoints: 3, budget: 100, trust: 60, pressure: 10 }),
    containments: parts.containments ?? [],
  },
  reports: [],
  events: [],
  belief: uniformBelief(NODES.map((each) => each.id)),
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

const withAttribute = (testId: string, attribute: string, value: string): readonly Element[] =>
  all(testId).filter((element) => element.getAttribute(attribute) === value);

const clickOn = async (element: Element): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

const pressOn = async (element: Element, key: string): Promise<void> => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
};

const nothingSelected = () => {
  /* a renderer under test needs a callback it can ignore */
};

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the map renderer", () => {
  it("draws one marker per node and one line per edge in the view", async () => {
    const view = viewWith();

    await render(<MapRenderer view={view} selection={null} onSelect={nothingSelected} />);

    expect(all(MAP_NODE_TEST_ID)).toHaveLength(view.map.nodes.length);
    expect(all(MAP_EDGE_TEST_ID)).toHaveLength(view.map.edges.length);
  });

  it("draws an edge with its own kind, so a footpath is not a road", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    expect(withAttribute(MAP_EDGE_TEST_ID, "data-edgekind", "footpath")).toHaveLength(1);
    expect(withAttribute(MAP_EDGE_TEST_ID, "data-edgekind", "bridge")).toHaveLength(1);
  });

  it("glows every edge line with the shared road-glow filter (PLAN M5.7)", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    const filterElement = container?.querySelector(`filter#${ROAD_GLOW_FILTER_ID}`);
    expect(filterElement).not.toBeNull();
    expect(filterElement?.querySelector("feGaussianBlur")).not.toBeNull();

    const lines = Array.from(container?.querySelectorAll("line") ?? []);
    expect(lines.length).toBe(EDGES.length);
    for (const line of lines) {
      expect(line.getAttribute("filter")).toBe(`url(#${ROAD_GLOW_FILTER_ID})`);
    }
  });

  it("names the exits and the incident node, so the two are not just circles", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    expect(withAttribute(MAP_NODE_TEST_ID, "data-exit", "border")).toHaveLength(1);
    expect(withAttribute(MAP_NODE_TEST_ID, "data-incident", "true")).toHaveLength(1);
  });

  it("draws the river a view carries", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    expect(one(MAP_RIVER_TEST_ID)?.getAttribute("points")).toBe("0,35 50,35");
  });

  it("draws no river on a city that has none", async () => {
    await render(
      <MapRenderer view={viewWith({ river: false })} selection={null} onSelect={nothingSelected} />,
    );

    expect(one(MAP_RIVER_TEST_ID)).toBeNull();
  });

  it("selects the node the player clicked", async () => {
    const selected: MapSelection[] = [];
    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={(selection) => selected.push(selection)}
      />,
    );

    const target = withAttribute(MAP_NODE_TEST_ID, "data-nodeid", String(RESIDENTIAL))[0];
    if (!target) throw new Error("the residential node was not rendered");
    await clickOn(target);

    expect(selected).toEqual([{ kind: "node", nodeId: RESIDENTIAL }]);
  });

  it("selects the edge the player clicked, which is the target a roadblock needs", async () => {
    const selected: MapSelection[] = [];
    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={(selection) => selected.push(selection)}
      />,
    );

    const target = withAttribute(MAP_EDGE_TEST_ID, "data-edgeid", String(ROAD))[0];
    if (!target) throw new Error("the road edge was not rendered");
    await clickOn(target);

    expect(selected).toEqual([{ kind: "edge", edgeId: ROAD }]);
  });

  it("selects from the keyboard as well as the pointer", async () => {
    const selected: MapSelection[] = [];
    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={(selection) => selected.push(selection)}
      />,
    );

    const target = withAttribute(MAP_NODE_TEST_ID, "data-nodeid", String(BORDER))[0];
    if (!target) throw new Error("the border node was not rendered");
    await pressOn(target, "Enter");
    await pressOn(target, "Escape");

    expect(selected).toEqual([{ kind: "node", nodeId: BORDER }]);
  });

  it("marks the selected node and no other", async () => {
    await render(
      <MapRenderer
        view={viewWith()}
        selection={{ kind: "node", nodeId: RESIDENTIAL }}
        onSelect={nothingSelected}
      />,
    );

    expect(withAttribute(MAP_NODE_TEST_ID, "data-selected", "true")).toHaveLength(1);
    expect(withAttribute(MAP_NODE_TEST_ID, "data-nodeid", String(RESIDENTIAL))[0]).toBe(
      withAttribute(MAP_NODE_TEST_ID, "data-selected", "true")[0],
    );
    expect(all(MAP_SELECTION_TEST_ID)).toHaveLength(1);
  });

  it("marks the selected edge and no node", async () => {
    await render(
      <MapRenderer
        view={viewWith()}
        selection={{ kind: "edge", edgeId: BRIDGE }}
        onSelect={nothingSelected}
      />,
    );

    expect(withAttribute(MAP_EDGE_TEST_ID, "data-edgeid", String(BRIDGE))[0]).toBe(
      withAttribute(MAP_EDGE_TEST_ID, "data-selected", "true")[0],
    );
    expect(withAttribute(MAP_NODE_TEST_ID, "data-selected", "true")).toHaveLength(0);
  });

  it("marks the edges standing containment has closed, and not one that has expired", async () => {
    const view = viewWith({
      containments: [
        { kind: "roadblock", edgeId: ROAD, expiresAt: NOW + 1 },
        { kind: "roadblock", edgeId: BRIDGE, expiresAt: NOW },
      ],
    });

    await render(<MapRenderer view={view} selection={null} onSelect={nothingSelected} />);

    expect(withAttribute(MAP_EDGE_TEST_ID, "data-blocked", "true")).toHaveLength(1);
    expect(withAttribute(MAP_EDGE_TEST_ID, "data-edgeid", String(ROAD))[0]).toBe(
      withAttribute(MAP_EDGE_TEST_ID, "data-blocked", "true")[0],
    );
  });

  it("skips an edge naming a node the map does not have, rather than drawing it to nowhere", async () => {
    const dangling = makeEdge("rail", makeEdgeId("e-dangling"), DOWNTOWN, makeNodeId("n-missing"));

    await render(
      <MapRenderer
        view={viewWith({ edges: [...EDGES, dangling] })}
        selection={null}
        onSelect={nothingSelected}
      />,
    );

    expect(all(MAP_EDGE_TEST_ID)).toHaveLength(EDGES.length);
  });

  it("draws the overlay layer under the edges and the nodes, taking no pointer events", async () => {
    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={nothingSelected}
        overlay={<circle data-testid="overlay-mark" r={1} />}
      />,
    );

    const drawnBefore = (earlier: Element | undefined, later: Element | undefined): boolean =>
      earlier !== undefined &&
      later !== undefined &&
      Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
    const overlay = one(MAP_OVERLAY_TEST_ID) ?? undefined;

    expect(drawnBefore(one(MAP_RIVER_TEST_ID) ?? undefined, overlay)).toBe(true);
    expect(drawnBefore(overlay, all(MAP_EDGE_TEST_ID)[0])).toBe(true);
    expect(drawnBefore(all(MAP_EDGE_TEST_ID)[0], all(MAP_NODE_TEST_ID)[0])).toBe(true);
    expect(overlay?.querySelector('[data-testid="overlay-mark"]')).not.toBeNull();
    expect(overlay?.getAttribute("style")).toContain("pointer-events: none");
  });

  it("gives a map with nothing on it a finite canvas rather than an infinite one", async () => {
    const empty = viewWith({ river: false, edges: [] });

    await render(
      <MapRenderer
        view={{ ...empty, map: { ...empty.map, nodes: [], exits: [] } }}
        selection={null}
        onSelect={nothingSelected}
      />,
    );

    const viewBox = one(MAP_TEST_ID)?.getAttribute("viewBox") ?? "";
    for (const part of viewBox.split(" ")) expect(Number.isFinite(Number(part))).toBe(true);
  });
});

/**
 * The same assertions against a city the generator actually produced, rather than a hand-built
 * one: every valid map carries a river (PLAN "What 'a chokepoint that matters' means"), so this is
 * where the river AC is proved against real data and the counts against a real graph.
 */
describe("the map renderer on a generated city", () => {
  const rng = createRng();
  const graph = createGraphLogic();

  const game = createGameLogic({
    rng,
    generation: createGenerationLogic({
      rng,
      topology: createTopologyLogic({ rng, graph }),
      river: createRiverLogic({ rng, graph }),
      districts: createDistrictLogic({ rng, graph }),
      validator: createValidatorLogic({ graph, minCut: createMinCutLogic({ graph }) }),
    }),
  });

  const created = game.create({
    setup: { map: { columns: 8, rows: 6, exitCount: 3 }, maxTurns: 24, difficulty: "standard" },
    seed: 1,
    balance: BALANCE,
  });

  it("matches the node and edge counts of the view and draws the river", async () => {
    if (created.kind !== "game") throw new Error(`seed 1 produced no game: ${created.kind}`);
    const view = toHunterView(created.world);

    await render(<MapRenderer view={view} selection={null} onSelect={nothingSelected} />);

    expect(all(MAP_NODE_TEST_ID)).toHaveLength(view.map.nodes.length);
    expect(all(MAP_EDGE_TEST_ID)).toHaveLength(view.map.edges.length);
    expect(one(MAP_RIVER_TEST_ID)).not.toBeNull();
  });
});
