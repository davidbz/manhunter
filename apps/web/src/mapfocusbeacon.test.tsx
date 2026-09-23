import { type MapNode, makeNode, makeNodeId } from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { CellBounds } from "./districtcells";
import STYLESHEET from "./index.css?raw";
import {
  BEACON_MARGINS,
  beaconLeaderOf,
  MAP_FOCUS_BEACON_LEADER_TEST_ID,
  MAP_FOCUS_BEACON_RING_CLASS,
  MAP_FOCUS_BEACON_RING_TEST_ID,
  MAP_FOCUS_BEACON_TEST_ID,
  MapFocusBeacon,
} from "./mapfocusbeacon";
import { MAP_FOCUS_BEACON_THEME } from "./theme";

/**
 * PLAN M7.2's beacon: where the ring lands, which margin its leader runs to, and that the layer
 * never takes a pointer event. Mappings and attributes, never a snapshot of the SVG.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const STYLE = MAP_FOCUS_BEACON_THEME;
const BOUNDS: CellBounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };

const NEAR_TOP = makeNodeId("n-near-top");
const NEAR_LEFT = makeNodeId("n-near-left");

const NODES: readonly MapNode[] = [
  makeNode(NEAR_TOP, "downtown", { x: 200, y: 60 }),
  makeNode(NEAR_LEFT, "park", { x: 60, y: 200 }),
];

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

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the beacon's leader", () => {
  it("runs up from the ring to the top margin when that is the nearer", () => {
    expect(beaconLeaderOf({ x: 200, y: 60 }, BOUNDS, STYLE)).toEqual({
      margin: BEACON_MARGINS.top,
      from: { x: 200, y: 60 - STYLE.radius },
      to: { x: 200, y: STYLE.leaderStop },
    });
  });

  it("runs left from the ring to the left margin when that is the nearer", () => {
    expect(beaconLeaderOf({ x: 60, y: 200 }, BOUNDS, STYLE)).toEqual({
      margin: BEACON_MARGINS.left,
      from: { x: 60 - STYLE.radius, y: 200 },
      to: { x: STYLE.leaderStop, y: 200 },
    });
  });

  it("gives a tie to the top margin", () => {
    expect(beaconLeaderOf({ x: 100, y: 100 }, BOUNDS, STYLE)?.margin).toBe(BEACON_MARGINS.top);
  });

  it("draws no leader for a node whose ring already reaches the margin's stop", () => {
    expect(beaconLeaderOf({ x: 200, y: STYLE.leaderStop }, BOUNDS, STYLE)).toBeNull();
    expect(beaconLeaderOf({ x: STYLE.leaderStop, y: 200 }, BOUNDS, STYLE)).toBeNull();
  });
});

describe("the focus beacon", () => {
  it("rings the focused node and leads to its margin", async () => {
    await render(<MapFocusBeacon nodeId={NEAR_LEFT} nodes={NODES} bounds={BOUNDS} style={STYLE} />);

    const ring = one(MAP_FOCUS_BEACON_RING_TEST_ID);
    expect(ring?.getAttribute("data-nodeid")).toBe(String(NEAR_LEFT));
    expect(ring?.getAttribute("cx")).toBe("60");
    expect(ring?.getAttribute("cy")).toBe("200");
    expect(ring?.getAttribute("r")).toBe(String(STYLE.radius));
    expect(ring?.getAttribute("stroke")).toBe(STYLE.stroke);
    expect(ring?.getAttribute("class")).toBe(MAP_FOCUS_BEACON_RING_CLASS);
    expect(one(MAP_FOCUS_BEACON_LEADER_TEST_ID)?.getAttribute("data-margin")).toBe(
      BEACON_MARGINS.left,
    );
  });

  it("keeps an empty layer when nothing is in focus", async () => {
    await render(<MapFocusBeacon nodeId={null} nodes={NODES} bounds={BOUNDS} style={STYLE} />);

    expect(one(MAP_FOCUS_BEACON_TEST_ID)?.childElementCount).toBe(0);
    expect(one(MAP_FOCUS_BEACON_TEST_ID)?.hasAttribute("data-nodeid")).toBe(false);
  });

  it("draws nothing for a node the map does not contain", async () => {
    await render(
      <MapFocusBeacon
        nodeId={makeNodeId("n-missing")}
        nodes={NODES}
        bounds={BOUNDS}
        style={STYLE}
      />,
    );

    expect(one(MAP_FOCUS_BEACON_RING_TEST_ID)).toBeNull();
  });

  it("takes no pointer events and says nothing to assistive technology", async () => {
    await render(<MapFocusBeacon nodeId={NEAR_TOP} nodes={NODES} bounds={BOUNDS} style={STYLE} />);

    const layer = one(MAP_FOCUS_BEACON_TEST_ID);
    expect(layer?.getAttribute("style")).toContain("pointer-events: none");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
  });

  it("replaces the ring when the focus moves, so its pulse replays", async () => {
    await render(<MapFocusBeacon nodeId={NEAR_TOP} nodes={NODES} bounds={BOUNDS} style={STYLE} />);
    const before = one(MAP_FOCUS_BEACON_RING_TEST_ID);

    await act(async () =>
      root?.render(
        <svg aria-label="Test map">
          <MapFocusBeacon nodeId={NEAR_LEFT} nodes={NODES} bounds={BOUNDS} style={STYLE} />
        </svg>,
      ),
    );

    expect(one(MAP_FOCUS_BEACON_RING_TEST_ID)).not.toBe(before);
  });

  it("pulses only inside the reduced-motion guard", () => {
    const guard = STYLESHEET.lastIndexOf("@media (prefers-reduced-motion: no-preference) {");
    const pulse = STYLESHEET.indexOf(
      `.${MAP_FOCUS_BEACON_RING_CLASS} {\n    animation: mh-map-beacon-pulse`,
    );

    expect(guard).toBeGreaterThan(0);
    expect(pulse).toBeGreaterThan(guard);
    expect(STYLESHEET).toContain("var(--mh-motion-focus-pulse)");
  });
});
