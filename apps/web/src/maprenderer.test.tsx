import type {
  Containment,
  DistrictType,
  EdgeKind,
  ExitKind,
  HunterEvent,
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
import STYLESHEET from "./index.css?raw";
import {
  EDGE_LAYERS,
  MAP_BLOCK_CELL_TEST_ID,
  MAP_BLOCK_TEST_ID,
  MAP_BRIDGE_DECK_TEST_ID,
  MAP_CHECKPOINT_TEST_ID,
  MAP_CLASSES,
  MAP_EDGE_TEST_ID,
  MAP_EXIT_GATE_TEST_ID,
  MAP_EXIT_GATES_TEST_ID,
  MAP_FOCUS_TEST_ID,
  MAP_INCIDENT_RING_TEST_ID,
  MAP_INCIDENT_TEST_ID,
  MAP_INCIDENTS_TEST_ID,
  MAP_NODE_TEST_ID,
  MAP_OVERLAY_TEST_ID,
  MAP_PIP_TEST_ID,
  MAP_PLATE_TEST_ID,
  MAP_RIVER_CHANNEL_TEST_ID,
  MAP_RIVER_CURRENT_TEST_ID,
  MAP_RIVER_TEST_ID,
  MAP_SELECTION_TEST_ID,
  MAP_TEST_ID,
  MAP_WASH_TEST_ID,
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
    readonly events?: readonly HunterEvent[];
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
  events: parts.events ?? [],
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

    expect(one(MAP_RIVER_TEST_ID)).not.toBeNull();
    expect(one(MAP_RIVER_CURRENT_TEST_ID)?.getAttribute("points")).toBe("0,35 50,35");
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

/**
 * PLAN M6.4's map surface, asserted structurally: which layers exist, what they carry, and the
 * order they are drawn in. Never pixels; the look is judged by eye in the running app.
 */
describe("the map surface", () => {
  const DISTRICTS: readonly DistrictType[] = [
    "downtown",
    "residential",
    "suburb",
    "industrial",
    "park",
    "transit_hub",
    "exit",
  ];
  const EXIT_KINDS: readonly ExitKind[] = ["airport", "port", "border", "highway"];
  const EDGE_KINDS: readonly EdgeKind[] = ["road", "footpath", "rail", "tunnel", "bridge"];
  const SPACING = 100;
  const NIGHT_TURN = 13;

  const cityNodes: readonly MapNode[] = DISTRICTS.map((districtType, index) =>
    node(makeNodeId(`n-${districtType}`), districtType, index * SPACING, 0),
  );
  const exitNodes: readonly MapNode[] = EXIT_KINDS.map((kind, index) =>
    node(makeNodeId(`n-exit-${kind}`), "exit", index * SPACING, SPACING * 2),
  );
  const nodeIdAt = (index: number): NodeId => cityNodes[index]?.id ?? makeNodeId("n-missing");
  const kindEdges: readonly MapEdge[] = EDGE_KINDS.map((kind, index) =>
    makeEdge(kind, makeEdgeId(`e-${kind}`), nodeIdAt(index), nodeIdAt(index + 1)),
  );
  const crossing = makeEdgeId("e-crossing");
  const clearOfRiver = makeEdgeId("e-clear");
  const bridges: readonly MapEdge[] = [
    makeEdge("bridge", crossing, nodeIdAt(0), exitNodes[0]?.id ?? makeNodeId("n-missing")),
    makeEdge("bridge", clearOfRiver, nodeIdAt(1), nodeIdAt(2)),
  ];

  const surfaceView = (turn: number): HunterView => {
    const base = viewWith();

    return {
      ...base,
      clock: makeClock(START_HOUR, turn),
      map: {
        nodes: [...cityNodes, ...exitNodes],
        edges: [...kindEdges, ...bridges],
        exits: exitNodes.map((each, index) => makeExit(each.id, EXIT_KINDS[index] ?? "border")),
        river: {
          points: [
            { x: -SPACING, y: SPACING },
            { x: SPACING * 3, y: SPACING },
            { x: SPACING * 3, y: SPACING },
            { x: SPACING * 7, y: SPACING },
          ],
        },
        incidentNodeId: nodeIdAt(0),
      },
    };
  };

  const renderSurface = (turn = NOW) =>
    render(<MapRenderer view={surfaceView(turn)} selection={null} onSelect={nothingSelected} />);

  const drawnBefore = (earlier: Element | null, later: Element | null): boolean =>
    earlier !== null &&
    later !== null &&
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("draws one block per district type, each filled with its own pattern and tone", async () => {
    await renderSurface();

    const blocks = all(MAP_BLOCK_TEST_ID);
    expect(blocks.map((each) => each.getAttribute("data-district"))).toEqual(DISTRICTS);
    const tones = DISTRICTS.map((districtType) =>
      container?.querySelector(`pattern#map-block-${districtType} rect`)?.getAttribute("fill"),
    );
    expect(new Set(tones).size).toBe(DISTRICTS.length);
    const fills = blocks.map((each) => each.getAttribute("fill"));
    expect(new Set(fills).size).toBe(DISTRICTS.length);
    for (const fill of fills) expect(fill).toMatch(/^url\(#map-block-/);
  });

  it("gives every node a block footprint of its own", async () => {
    await renderSurface();

    const footprints = all(MAP_BLOCK_CELL_TEST_ID).map((each) => each.getAttribute("data-nodeid"));
    expect(new Set(footprints).size).toBe(cityNodes.length + exitNodes.length);
  });

  it("builds the river as a channel with a dashed current down the course", async () => {
    await renderSurface();

    const channel = one(MAP_RIVER_CHANNEL_TEST_ID);
    expect(channel?.tagName).toBe("polygon");
    expect(channel?.getAttribute("points")?.split(" ").length).toBeGreaterThan(2);
    expect(one(MAP_RIVER_CURRENT_TEST_ID)?.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(one(MAP_RIVER_TEST_ID)?.contains(channel ?? null)).toBe(true);
  });

  it("lays a deck under every bridge that crosses the river and none under one that does not", async () => {
    await renderSurface();

    const decks = all(MAP_BRIDGE_DECK_TEST_ID).map((each) => each.getAttribute("data-edgeid"));
    expect(decks).toContain(String(crossing));
    expect(decks).not.toContain(String(clearOfRiver));
    expect(decks).toHaveLength(1);
  });

  it("draws each edge kind as casing plus fill with a treatment of its own", async () => {
    await renderSurface();

    const treatments = EDGE_KINDS.map((kind) => {
      const edge = withAttribute(MAP_EDGE_TEST_ID, "data-edgeid", `e-${kind}`)[0];
      const layer = (name: string) => edge?.querySelector(`[data-layer="${name}"]`);
      const casing = layer(EDGE_LAYERS.casing);
      const fill = layer(EDGE_LAYERS.fill);
      expect(layer(EDGE_LAYERS.glow)).not.toBeNull();

      return [
        casing?.getAttribute("stroke-width"),
        casing?.getAttribute("stroke-dasharray"),
        fill?.getAttribute("stroke"),
        fill?.getAttribute("stroke-width"),
        fill?.getAttribute("stroke-dasharray"),
      ].join("|");
    });
    expect(new Set(treatments).size).toBe(EDGE_KINDS.length);
  });

  it("marks every exit with a gate carrying its own kind", async () => {
    await renderSurface();

    const gates = all(MAP_EXIT_GATE_TEST_ID);
    expect(gates.map((each) => each.getAttribute("data-exit"))).toEqual(EXIT_KINDS);
    const glyphs = gates.map((each) => each.querySelector("path")?.getAttribute("d"));
    expect(new Set(glyphs).size).toBe(EXIT_KINDS.length);
    expect(one(MAP_EXIT_GATES_TEST_ID)?.getAttribute("style")).toContain("pointer-events: none");
  });

  it("washes the map for the hour on the clock, day at noon and night at ten", async () => {
    await renderSurface(NOW);
    expect(one(MAP_WASH_TEST_ID)?.getAttribute("data-timeofday")).toBe("day");
    expect(one(MAP_TEST_ID)?.getAttribute("data-timeofday")).toBe("day");
    const dayOpacity = Number(one(MAP_WASH_TEST_ID)?.getAttribute("fill-opacity"));

    await act(async () => root?.unmount());
    container?.remove();
    await renderSurface(NIGHT_TURN);
    expect(one(MAP_WASH_TEST_ID)?.getAttribute("data-timeofday")).toBe("night");
    expect(Number(one(MAP_WASH_TEST_ID)?.getAttribute("fill-opacity"))).toBeGreaterThan(dayOpacity);
  });

  it("reads night from the daylight hours it is given, not from a fixed table", async () => {
    await render(
      <MapRenderer
        view={surfaceView(NOW)}
        selection={null}
        onSelect={nothingSelected}
        daylight={{ ...BALANCE.time, nightStartHour: START_HOUR + NOW }}
      />,
    );

    expect(one(MAP_WASH_TEST_ID)?.getAttribute("data-timeofday")).toBe("night");
  });

  it("draws the new layers below the river or above the nodes, never between", async () => {
    await renderSurface();

    const river = one(MAP_RIVER_TEST_ID);
    const lastNode = all(MAP_NODE_TEST_ID).at(-1) ?? null;
    expect(drawnBefore(one(MAP_PLATE_TEST_ID), all(MAP_BLOCK_TEST_ID)[0] ?? null)).toBe(true);
    expect(drawnBefore(all(MAP_BLOCK_TEST_ID).at(-1) ?? null, one(MAP_WASH_TEST_ID))).toBe(true);
    expect(drawnBefore(one(MAP_WASH_TEST_ID), river)).toBe(true);
    expect(drawnBefore(river, one(MAP_OVERLAY_TEST_ID))).toBe(true);
    expect(drawnBefore(lastNode, one(MAP_EXIT_GATES_TEST_ID))).toBe(true);
    expect(one(MAP_WASH_TEST_ID)?.getAttribute("style")).toContain("pointer-events: none");
  });

  it("sizes the plate to the viewBox, so the ground covers the whole canvas", async () => {
    await renderSurface();

    const plate = one(MAP_PLATE_TEST_ID);
    const plateBox = ["x", "y", "width", "height"].map((name) => plate?.getAttribute(name));
    expect(plateBox.join(" ")).toBe(one(MAP_TEST_ID)?.getAttribute("viewBox"));
  });
});

describe("the map actors (PLAN M6.5)", () => {
  const within = (element: Element | undefined, testId: string): readonly Element[] =>
    Array.from(element?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

  const edgeNamed = (edgeId: string): Element | undefined =>
    withAttribute(MAP_EDGE_TEST_ID, "data-edgeid", edgeId)[0];

  const nodeNamed = (nodeId: string): Element | undefined =>
    withAttribute(MAP_NODE_TEST_ID, "data-nodeid", nodeId)[0];

  const followedBy = (earlier: Element | null, later: Element | null): boolean =>
    earlier !== null &&
    later !== null &&
    Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("draws every node as a pip carrying its district, and rings only the incident node", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    for (const marker of all(MAP_NODE_TEST_ID)) {
      const pips = within(marker, MAP_PIP_TEST_ID);
      expect(pips).toHaveLength(1);
      expect(pips[0]?.getAttribute("data-district")).toBe(marker.getAttribute("data-district"));
    }
    expect(all(MAP_INCIDENT_RING_TEST_ID)).toHaveLength(1);
    expect(within(nodeNamed(String(DOWNTOWN)), MAP_INCIDENT_RING_TEST_ID)).toHaveLength(1);
  });

  it("gives every node and edge a focus outline the stylesheet shows only on keyboard focus", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    for (const target of [...all(MAP_NODE_TEST_ID), ...all(MAP_EDGE_TEST_ID)]) {
      expect(target.getAttribute("tabindex")).toBe("0");
      expect(target.classList.contains(MAP_CLASSES.target)).toBe(true);
      const outlines = within(target, MAP_FOCUS_TEST_ID);
      expect(outlines).toHaveLength(1);
      expect(outlines[0]?.classList.contains(MAP_CLASSES.focus)).toBe(true);
    }
    expect(STYLESHEET).toContain(`.${MAP_CLASSES.focus} {\n  opacity: 0;`);
    expect(STYLESHEET).toContain(
      `.${MAP_CLASSES.target}:focus-visible .${MAP_CLASSES.focus} {\n  opacity: 1;`,
    );
  });

  it("keeps the one glow line per edge, so the focus and checkpoint strokes are paths", async () => {
    const view = viewWith({
      containments: [{ kind: "roadblock", edgeId: ROAD, expiresAt: NOW + 1 }],
    });

    await render(
      <MapRenderer
        view={view}
        selection={{ kind: "edge", edgeId: ROAD }}
        onSelect={nothingSelected}
      />,
    );

    expect(container?.querySelectorAll("line")).toHaveLength(EDGES.length);
  });

  it("leaves every target live when nothing is armed", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    expect(withAttribute(MAP_NODE_TEST_ID, "data-selectable", "true")).toHaveLength(NODES.length);
    expect(withAttribute(MAP_EDGE_TEST_ID, "data-selectable", "true")).toHaveLength(EDGES.length);
  });

  it("dims what the armed action cannot target and still reports a click on it", async () => {
    const picked: MapSelection[] = [];

    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={(selection) => picked.push(selection)}
        selectableKind={{ kind: "edge", edgeKinds: ["road", "bridge"] }}
      />,
    );

    expect(withAttribute(MAP_NODE_TEST_ID, "data-selectable", "false")).toHaveLength(NODES.length);
    expect(edgeNamed(String(FOOTPATH))?.getAttribute("data-selectable")).toBe("false");
    expect(edgeNamed(String(ROAD))?.getAttribute("data-selectable")).toBe("true");
    expect(STYLESHEET).toContain(
      `.${MAP_CLASSES.target}[data-selectable="false"] {\n  opacity: var(--mh-fade-disabled);`,
    );

    const footpath = edgeNamed(String(FOOTPATH));
    const residential = nodeNamed(String(RESIDENTIAL));
    if (footpath !== undefined) await clickOn(footpath);
    if (residential !== undefined) await pressOn(residential, "Enter");

    expect(picked).toEqual([
      { kind: "edge", edgeId: FOOTPATH },
      { kind: "node", nodeId: RESIDENTIAL },
    ]);
  });

  it("dims every edge and keeps every node for a node action", async () => {
    await render(
      <MapRenderer
        view={viewWith()}
        selection={null}
        onSelect={nothingSelected}
        selectableKind={{ kind: "node" }}
      />,
    );

    expect(withAttribute(MAP_NODE_TEST_ID, "data-selectable", "true")).toHaveLength(NODES.length);
    expect(withAttribute(MAP_EDGE_TEST_ID, "data-selectable", "false")).toHaveLength(EDGES.length);
  });

  it("locks a reticle onto a selected edge, inside that edge and no other", async () => {
    await render(
      <MapRenderer
        view={viewWith()}
        selection={{ kind: "edge", edgeId: BRIDGE }}
        onSelect={nothingSelected}
      />,
    );

    expect(all(MAP_SELECTION_TEST_ID)).toHaveLength(1);
    expect(within(edgeNamed(String(BRIDGE)), MAP_SELECTION_TEST_ID)).toHaveLength(1);
    expect(all(MAP_SELECTION_TEST_ID)[0]?.classList.contains(MAP_CLASSES.reticle)).toBe(true);
  });

  it("animates the reticle only for someone who has not asked for reduced motion", () => {
    const guard = STYLESHEET.lastIndexOf("@media (prefers-reduced-motion: no-preference) {");
    expect(guard).toBeGreaterThan(0);
    const beforeGuard = STYLESHEET.slice(0, guard);
    const insideGuard = STYLESHEET.slice(guard);

    expect(insideGuard).toContain("animation: mh-map-lock-on");
    expect(insideGuard).toContain("@keyframes mh-map-lock-on");
    expect(beforeGuard).not.toContain("animation:");
    expect(beforeGuard).not.toContain("@keyframes");
  });

  it("stands a checkpoint barrier on a closed edge and nowhere else", async () => {
    const view = viewWith({
      containments: [{ kind: "roadblock", edgeId: ROAD, expiresAt: NOW + 1 }],
    });

    await render(<MapRenderer view={view} selection={null} onSelect={nothingSelected} />);

    expect(all(MAP_CHECKPOINT_TEST_ID)).toHaveLength(1);
    expect(within(edgeNamed(String(ROAD)), MAP_CHECKPOINT_TEST_ID)).toHaveLength(1);
    expect(all(MAP_CHECKPOINT_TEST_ID)[0]?.getAttribute("data-edgeid")).toBe(String(ROAD));
    expect(edgeNamed(String(ROAD))?.querySelector("circle")).toBeNull();
  });

  it("marks each node a civilian was hurt at, once per node, over the nodes and the gates", async () => {
    const events: readonly HunterEvent[] = [
      { kind: "civilian_hurt", turn: 1, nodeId: RESIDENTIAL },
      { kind: "nightfall", turn: 2 },
      { kind: "civilian_hurt", turn: 3, nodeId: RESIDENTIAL },
      { kind: "civilian_hurt", turn: 2, nodeId: makeNodeId("n-missing") },
    ];

    await render(
      <MapRenderer view={viewWith({ events })} selection={null} onSelect={nothingSelected} />,
    );

    const markers = all(MAP_INCIDENT_TEST_ID);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.getAttribute("data-nodeid")).toBe(String(RESIDENTIAL));
    expect(markers[0]?.getAttribute("data-count")).toBe("2");
    expect(markers[0]?.getAttribute("data-turn")).toBe("3");
    const layer = one(MAP_INCIDENTS_TEST_ID);
    expect(layer?.getAttribute("style")).toContain("pointer-events: none");
    expect(followedBy(one(MAP_EXIT_GATES_TEST_ID), layer)).toBe(true);
    expect(nodeNamed(String(RESIDENTIAL))?.getAttribute("aria-label")).toContain("civilian hurt");
    expect(nodeNamed(String(DOWNTOWN))?.getAttribute("aria-label")).not.toContain("civilian hurt");
  });

  it("draws no incident layer for a hunt nobody has been hurt in", async () => {
    await render(<MapRenderer view={viewWith()} selection={null} onSelect={nothingSelected} />);

    expect(one(MAP_INCIDENTS_TEST_ID)).toBeNull();
  });
});
