import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  BELIEF_LEGEND_ITEM_TEST_ID,
  BELIEF_LEGEND_TEST_ID,
  BeliefLegend,
  contourLabelOf,
  pinAgeLabelOf,
} from "./belieflegend";
import { DEFAULT_BELIEF_FIELD, DEFAULT_HEAT_RAMP } from "./beliefoverlay";
import { REPORT_PIN_KINDS } from "./reportpins";
import { MAP_THEME } from "./theme";

/**
 * PLAN M6.6's map key: that it names every mark the map draws, from the same tables the map draws
 * with, so a retuned ramp or pin cannot leave the key behind.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const renderLegend = async (): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(<BeliefLegend />);
  });
};

const item = (name: string): Element | null =>
  container?.querySelector(`[data-testid="${BELIEF_LEGEND_ITEM_TEST_ID}"][data-item="${name}"]`) ??
  null;

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the map legend", () => {
  it("names the ramp, the contour, every pin kind and the pins' age, in that order", async () => {
    await renderLegend();

    const items = Array.from(
      container?.querySelectorAll(`[data-testid="${BELIEF_LEGEND_ITEM_TEST_ID}"]`) ?? [],
    ).map((each) => each.getAttribute("data-item"));
    expect(items).toEqual(["ramp", "contour", ...REPORT_PIN_KINDS, "age"]);
    expect(container?.querySelector(`[data-testid="${BELIEF_LEGEND_TEST_ID}"]`)?.tagName).toBe(
      "UL",
    );
  });

  it("states the contour's threshold and the pins' age from the tables the map uses", async () => {
    await renderLegend();

    expect(contourLabelOf(0.75)).toBe("Top tier: 75% of peak or more");
    expect(item("contour")?.textContent).toBe(contourLabelOf(DEFAULT_BELIEF_FIELD.contourFrom));
    expect(item("age")?.textContent).toBe(pinAgeLabelOf(MAP_THEME.reportPin.maxAge));
  });

  it("draws the ramp swatch in the ramp's hue from its faintest to its strongest", async () => {
    await renderLegend();

    const stops = Array.from(item("ramp")?.querySelectorAll("stop") ?? []);
    expect(stops.map((stop) => stop.getAttribute("stop-color"))).toEqual([
      DEFAULT_HEAT_RAMP.fill,
      DEFAULT_HEAT_RAMP.fill,
    ]);
    expect(stops.map((stop) => Number(stop.getAttribute("stop-opacity")))).toEqual([
      DEFAULT_HEAT_RAMP.minOpacity,
      DEFAULT_HEAT_RAMP.maxOpacity,
    ]);
  });

  it("draws the contour swatch with the map contour's stroke and dash", async () => {
    await renderLegend();

    const dashed = item("contour")?.querySelector("path[stroke-dasharray]");
    expect(dashed?.getAttribute("stroke")).toBe(DEFAULT_BELIEF_FIELD.contourStroke);
    expect(dashed?.getAttribute("stroke-dasharray")).toBe(DEFAULT_BELIEF_FIELD.contourDash);
  });

  it("draws each pin swatch with the map pin's own outline and mark", async () => {
    await renderLegend();

    for (const kind of REPORT_PIN_KINDS) {
      const paths = Array.from(item(kind)?.querySelectorAll("path") ?? []).map((each) =>
        each.getAttribute("d"),
      );
      expect(paths).toEqual([MAP_THEME.reportPin.outline, MAP_THEME.reportPin.kinds[kind].mark]);
    }
  });

  it("hides its swatches from assistive technology, which reads the labels", async () => {
    await renderLegend();

    const swatches = Array.from(container?.querySelectorAll("svg") ?? []);
    expect(swatches.length).toBeGreaterThan(0);
    for (const swatch of swatches) expect(swatch.getAttribute("aria-hidden")).toBe("true");
  });
});
