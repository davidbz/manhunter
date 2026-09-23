import {
  BALANCE,
  type HunterAction,
  makeEdge,
  makeEdgeId,
  makeNodeId,
  type NodeId,
  type Position,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CellBounds } from "./districtcells";
import STYLESHEET from "./index.css?raw";
import {
  costTagOf,
  MAP_PLAN_COST_TAG_TEST_ID,
  MAP_PLAN_GHOST_TEST_ID,
  MAP_PLANNED_ORDER_CLASS,
  MAP_PLANNED_ORDER_TEST_ID,
  MAP_PLANNED_ORDERS_TEST_ID,
  MapPlannedOrders,
  type PlanGhost,
  plannedMarksOf,
  planPlaceOf,
  TAG_SIDES,
  tagSideOf,
} from "./mapplannedorders";
import { planCostOf } from "./plancost";
import { MAP_PLAN_THEME, PALETTE } from "./theme";

/**
 * PLAN M7.3's plan layer: where each order lands, what the ghost's tag reads, and which parts of
 * the layer take a pointer. Mappings and attributes, never a snapshot of the SVG.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const A = makeNodeId("n-a");
const B = makeNodeId("n-b");
const ROAD = makeEdge("road", makeEdgeId("e-ab"), A, B);
const EDGES = [ROAD];
const POSITIONS: ReadonlyMap<NodeId, Position> = new Map([
  [A, { x: 0, y: 0 }],
  [B, { x: 100, y: 0 }],
]);
const BOUNDS: CellBounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

const CANVASS_A: HunterAction = { kind: "canvass", nodeId: A };
const CCTV_A: HunterAction = { kind: "pull_cctv", nodeId: A };
const CANVASS_B: HunterAction = { kind: "canvass", nodeId: B };
const BLOCK: HunterAction = { kind: "roadblock", edgeId: ROAD.id };
const BRIEFING: HunterAction = { kind: "true_briefing" };

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (children: ReactNode): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<svg aria-label="Test map">{children}</svg>);
  });
};

const one = (testId: string): Element | null =>
  container?.querySelector(`[data-testid="${testId}"]`) ?? null;

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("where an order sits", () => {
  it("puts a node order on its node, and a roadblock at its road's midpoint", () => {
    expect(planPlaceOf(CANVASS_A, POSITIONS, EDGES)).toEqual({
      kind: "node",
      key: A,
      at: { x: 0, y: 0 },
    });
    expect(planPlaceOf(BLOCK, POSITIONS, EDGES)).toEqual({
      kind: "edge",
      key: ROAD.id,
      at: { x: 50, y: 0 },
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
    });
  });

  it("has no place for a global order, or for a target the map does not hold", () => {
    expect(planPlaceOf(BRIEFING, POSITIONS, EDGES)).toBeNull();
    expect(planPlaceOf({ kind: "canvass", nodeId: makeNodeId("n-gone") }, POSITIONS, EDGES)).toBe(
      null,
    );
    expect(planPlaceOf({ kind: "roadblock", edgeId: makeEdgeId("e-gone") }, POSITIONS, [])).toBe(
      null,
    );
  });

  it("numbers marks by queue position, skipping global orders, and steps aside on a shared target", () => {
    const marks = plannedMarksOf([CANVASS_A, BRIEFING, CCTV_A, CANVASS_B], POSITIONS, EDGES);

    expect(marks.map((mark) => mark.index)).toEqual([0, 2, 3]);
    expect(marks.map((mark) => mark.stack)).toEqual([0, 1, 0]);
  });
});

describe("the ghost's cost tag", () => {
  it("reads the price as signed changes, then the place", () => {
    expect(costTagOf(planCostOf("roadblock", BALANCE), "Harbor St")).toBe(
      "-1 AP -50 -3 trust - Harbor St",
    );
    expect(costTagOf(planCostOf("true_briefing", BALANCE), "the press")).toBe(
      "-1 AP +4 trust - the press",
    );
  });

  it("leaves out a meter the order does not move", () => {
    expect(costTagOf(planCostOf("pull_cctv", BALANCE), "Downtown")).toBe("-1 AP -30 - Downtown");
  });

  it("reads leftwards right of centre, so the tag stays on the plate", () => {
    expect(tagSideOf({ x: 100, y: 0 }, BOUNDS)).toBe(TAG_SIDES.start);
    expect(tagSideOf({ x: 300, y: 0 }, BOUNDS)).toBe(TAG_SIDES.end);
  });
});

describe("the plan layer", () => {
  const GHOST: PlanGhost = {
    action: CANVASS_B,
    place: { kind: "node", key: B, at: { x: 100, y: 0 } },
    tag: "-1 AP -20 -1 trust - Harbor",
    side: TAG_SIDES.start,
  };

  it("draws one marker per mark, and the ghost with its tag", async () => {
    await render(
      <MapPlannedOrders
        marks={plannedMarksOf([CANVASS_A, BLOCK], POSITIONS, EDGES)}
        ghost={GHOST}
        style={MAP_PLAN_THEME}
      />,
    );

    expect(all(MAP_PLANNED_ORDER_TEST_ID).map((mark) => mark.getAttribute("data-action"))).toEqual([
      "canvass",
      "roadblock",
    ]);
    expect(one(MAP_PLAN_GHOST_TEST_ID)?.getAttribute("data-target")).toBe(B);
    expect(one(MAP_PLAN_COST_TAG_TEST_ID)?.textContent).toBe(GHOST.tag);
  });

  it("takes no pointer events, except a marker's badge when there is a handler", async () => {
    await render(
      <MapPlannedOrders
        marks={plannedMarksOf([CANVASS_A], POSITIONS, EDGES)}
        ghost={GHOST}
        style={MAP_PLAN_THEME}
        onRemove={() => undefined}
      />,
    );

    expect(one(MAP_PLANNED_ORDERS_TEST_ID)?.getAttribute("style")).toContain(
      "pointer-events: none",
    );
    expect(one(MAP_PLANNED_ORDERS_TEST_ID)?.getAttribute("aria-hidden")).toBe("true");
    expect(one(MAP_PLAN_GHOST_TEST_ID)?.getAttribute("style")).toContain("pointer-events: none");
    expect(
      container?.querySelector(`.${MAP_PLANNED_ORDER_CLASS}`)?.getAttribute("style"),
    ).toContain("pointer-events: visiblepainted");
  });

  it("keeps the badges inert without a handler", async () => {
    await render(
      <MapPlannedOrders
        marks={plannedMarksOf([CANVASS_A], POSITIONS, EDGES)}
        ghost={null}
        style={MAP_PLAN_THEME}
      />,
    );

    expect(
      container?.querySelector(`.${MAP_PLANNED_ORDER_CLASS}`)?.getAttribute("style"),
    ).toContain("pointer-events: none");
    expect(one(MAP_PLAN_GHOST_TEST_ID)).toBeNull();
  });

  it("removes the order whose badge is released on", async () => {
    const removed: number[] = [];
    await render(
      <MapPlannedOrders
        marks={plannedMarksOf([CANVASS_A, CANVASS_B], POSITIONS, EDGES)}
        ghost={null}
        style={MAP_PLAN_THEME}
        onRemove={(index) => removed.push(index)}
      />,
    );
    const badge = all(MAP_PLANNED_ORDER_TEST_ID)[1]?.querySelector(`.${MAP_PLANNED_ORDER_CLASS}`);

    await act(async () => {
      badge?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    });

    expect(removed).toEqual([1]);
  });

  it("gives a removable marker a pointer in the stylesheet", () => {
    expect(STYLESHEET).toContain(`.${MAP_PLANNED_ORDER_CLASS} {\n  cursor: pointer;`);
  });

  it("draws in the player's cyan, the accent", () => {
    expect(MAP_PLAN_THEME.stroke).toBe(PALETTE.accent);
    expect(MAP_PLAN_THEME.ghostOpacity).toBeLessThan(1);
  });
});
