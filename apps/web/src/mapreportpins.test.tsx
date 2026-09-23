import type { HunterReport, HunterView, MapNode, NodeId, ReportSource } from "@manhunter/core";
import {
  IN_PROGRESS,
  makeClock,
  makeEdge,
  makeEdgeId,
  makeExit,
  makeHunterState,
  makeNode,
  makeNodeId,
  makeReportId,
  UNKNOWN_TRAVEL_MODE,
  uniformBelief,
} from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import STYLESHEET from "./index.css?raw";
import { LIMITS } from "./limits";
import {
  MAP_EXIT_GATES_TEST_ID,
  MAP_INCIDENTS_TEST_ID,
  MAP_NODE_TEST_ID,
  MAP_REPORT_PIN_TEST_ID,
  MAP_REPORT_PINS_TEST_ID,
  MapRenderer,
  type MapSelection,
} from "./maprenderer";
import { REPORT_PIN_CLASS } from "./mapreportpins";
import { type ReportPinKind, reportPinsOf } from "./reportpins";
import { MAP_THEME } from "./theme";

/**
 * PLAN M6.6's pins as the renderer draws them: where the layer sits, what each pin says, and that
 * a pin over a node never takes the click meant for it. Mappings, never a snapshot of the SVG.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const PIN = MAP_THEME.reportPin;

const DOWNTOWN = makeNodeId("n-downtown");
const PARK = makeNodeId("n-park");
const BORDER = makeNodeId("n-border");

const NODES: readonly MapNode[] = [
  makeNode(DOWNTOWN, "downtown", { x: 10, y: 20 }),
  makeNode(PARK, "park", { x: 60, y: 20 }),
  makeNode(BORDER, "exit", { x: 60, y: 70 }),
];

const START_HOUR = 9;
const NOW = 8;
const TURNS_REMAINING = 16;

const report = (
  id: string,
  kind: ReportPinKind,
  nodeId: NodeId,
  observedAtTurn: number,
  source: ReportSource = "witness",
): HunterReport => ({
  id: makeReportId(id),
  source,
  observedAtTurn,
  receivedAtTurn: observedAtTurn,
  content:
    kind === "sighting" ? { kind, nodeId, travelMode: UNKNOWN_TRAVEL_MODE } : { kind, nodeId },
});

const viewWith = (
  reports: readonly HunterReport[],
  nodes: readonly MapNode[] = NODES,
): HunterView => ({
  clock: makeClock(START_HOUR, NOW),
  map: {
    nodes,
    edges: [makeEdge("road", makeEdgeId("e-road"), DOWNTOWN, PARK)],
    exits: [makeExit(BORDER, "border")],
    river: null,
    incidentNodeId: DOWNTOWN,
  },
  hunter: {
    ...makeHunterState({ actionPoints: 3, budget: 100, trust: 60, pressure: 10 }),
    containments: [],
  },
  reports,
  events: [{ kind: "civilian_hurt", turn: 1, nodeId: DOWNTOWN }],
  belief: uniformBelief(nodes.map((each) => each.id)),
  casualties: 1,
  turnsRemaining: TURNS_REMAINING,
  outcome: IN_PROGRESS,
});

const REPORTS: readonly HunterReport[] = [
  report("seen", "sighting", PARK, NOW - 1, "cctv"),
  report("clear", "no_sighting", DOWNTOWN, NOW - 3, "patrol"),
  report("also", "no_sighting", PARK, NOW - 2),
  report("old", "sighting", BORDER, NOW - PIN.maxAge - 1),
];

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

const pinAt = (nodeId: NodeId): Element | undefined =>
  all(MAP_REPORT_PIN_TEST_ID).find((pin) => pin.getAttribute("data-nodeid") === nodeId);

const followedBy = (earlier: Element | null, later: Element | null): boolean =>
  earlier !== null &&
  later !== null &&
  Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);

const nothingSelected = () => {
  /* a renderer under test needs a callback it can ignore */
};

const drawn = (view: HunterView, onSelect: (selection: MapSelection) => void = nothingSelected) =>
  render(<MapRenderer view={view} selection={null} onSelect={onSelect} />);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the report pin layer", () => {
  it("sits above the nodes and gates, under the incidents, and takes no pointer events", async () => {
    await drawn(viewWith(REPORTS));

    const layer = one(MAP_REPORT_PINS_TEST_ID);
    const lastNode = all(MAP_NODE_TEST_ID).at(-1) ?? null;
    expect(followedBy(lastNode, layer)).toBe(true);
    expect(followedBy(one(MAP_EXIT_GATES_TEST_ID), layer)).toBe(true);
    expect(followedBy(layer, one(MAP_INCIDENTS_TEST_ID))).toBe(true);
    expect(layer?.getAttribute("style")).toContain("pointer-events: none");
  });

  it("draws the pins the pin logic chooses, carrying what it chose", async () => {
    const view = viewWith(REPORTS);
    const expected = reportPinsOf(
      view.reports,
      view.clock.turn,
      { maxAge: PIN.maxAge, maxPins: LIMITS.maxReportPins },
      PIN.staleness,
    );

    await drawn(view);

    const drawnPins = all(MAP_REPORT_PIN_TEST_ID).map((pin) => ({
      nodeId: pin.getAttribute("data-nodeid"),
      kind: pin.getAttribute("data-kind"),
      source: pin.getAttribute("data-source"),
      age: Number(pin.getAttribute("data-age")),
      staleness: pin.getAttribute("data-staleness"),
      count: Number(pin.getAttribute("data-count")),
    }));
    expect(drawnPins).toEqual(expected.pins.map((pin) => ({ ...pin, nodeId: String(pin.nodeId) })));
    expect(pinAt(PARK)?.getAttribute("data-kind")).toBe("sighting");
    expect(pinAt(PARK)?.getAttribute("data-count")).toBe("2");
    expect(pinAt(BORDER)).toBeUndefined();
    expect(pinAt(PARK)?.getAttribute("class")).toBe(REPORT_PIN_CLASS);
  });

  it("declares the pins it held back, and none when it held none back", async () => {
    await drawn(viewWith(REPORTS));

    expect(one(MAP_REPORT_PINS_TEST_ID)?.getAttribute("data-withheld")).toBe("0");
  });

  it("holds back the pins over the limit and says how many", async () => {
    const crowd = Array.from({ length: LIMITS.maxReportPins + 1 }, (_, index) =>
      makeNode(makeNodeId(`n-${index}`), "downtown", { x: index * 10, y: 0 }),
    );
    const reports = crowd.map((each, index) => report(`r${index}`, "no_sighting", each.id, NOW));

    await drawn(viewWith(reports, [...NODES, ...crowd]));

    expect(all(MAP_REPORT_PIN_TEST_ID)).toHaveLength(LIMITS.maxReportPins);
    expect(one(MAP_REPORT_PINS_TEST_ID)?.getAttribute("data-withheld")).toBe("1");
  });

  it("draws no layer when nothing recent has been reported", async () => {
    await drawn(viewWith([report("old", "sighting", PARK, NOW - PIN.maxAge - 1)]));

    expect(one(MAP_REPORT_PINS_TEST_ID)).toBeNull();
  });

  it("stands a pin's tip on the top of its node's pip", async () => {
    await drawn(viewWith(REPORTS));

    const transform = pinAt(PARK)?.querySelector("g")?.getAttribute("transform") ?? "";
    const [x, y, scale] = (transform.match(/-?[\d.]+/g) ?? []).map(Number);
    const tip = {
      x: (x ?? Number.NaN) + (scale ?? Number.NaN) * PIN.glyphBox * 0.5,
      y: (y ?? Number.NaN) + (scale ?? Number.NaN) * PIN.glyphBox,
    };

    // The transform's scale is written to two decimals, so the tip lands within a fraction of a unit.
    expect(PIN.lift).toBe(MAP_THEME.pip.size * 0.5);
    expect(tip.x).toBeCloseTo(60, 0);
    expect(tip.y).toBeCloseTo(20 - PIN.lift, 0);
  });

  it("still selects a node a pin stands over", async () => {
    const selected: MapSelection[] = [];
    await drawn(viewWith(REPORTS), (selection) => selected.push(selection));

    const target = all(MAP_NODE_TEST_ID).find((each) => each.getAttribute("data-nodeid") === PARK);
    if (target === undefined) throw new Error("the park node was not rendered");
    await act(async () => {
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(selected).toEqual([{ kind: "node", nodeId: PARK }]);
  });

  it("marks a pin whose node heard a report this turn as new, the feed's own test", async () => {
    await drawn(viewWith([...REPORTS, report("now", "no_sighting", DOWNTOWN, NOW)]));

    expect(pinAt(DOWNTOWN)?.getAttribute("data-new")).toBe("true");
    expect(pinAt(PARK)?.getAttribute("data-new")).toBe("false");
  });

  it("replaces a pin's element when a new report lands on it, so its arrival replays", async () => {
    await drawn(viewWith(REPORTS));
    const before = pinAt(PARK);
    const unchanged = pinAt(DOWNTOWN);

    const landed = viewWith([...REPORTS, report("again", "sighting", PARK, NOW)]);
    await act(async () =>
      root?.render(<MapRenderer view={landed} selection={null} onSelect={nothingSelected} />),
    );

    expect(pinAt(PARK)).not.toBe(before);
    expect(pinAt(DOWNTOWN)).toBe(unchanged);
  });

  it("plays the report-arrival motion only on a new pin", () => {
    expect(STYLESHEET).toMatch(
      /\.mh-map-pin\[data-new="true"\]\s*\{\s*animation:\s*mh-report-arrival/,
    );
  });

  it("fades an aging and a stale pin through the stylesheet's fade tokens", () => {
    expect(STYLESHEET).toMatch(
      /\.mh-map-pin\[data-staleness="aging"\]\s*\{\s*opacity:\s*var\(--mh-fade-aging\)/,
    );
    expect(STYLESHEET).toMatch(
      /\.mh-map-pin\[data-staleness="stale"\]\s*\{\s*opacity:\s*var\(--mh-fade-stale\)/,
    );
  });
});
