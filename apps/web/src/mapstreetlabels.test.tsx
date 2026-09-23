import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAP_STREET_LABEL_TEST_ID,
  MAP_STREET_LABELS_TEST_ID,
  MapStreetLabels,
  STREET_LABEL_AXES,
} from "./mapstreetlabels";
import type { PlaceNames } from "./placenames";
import { MAP_THEME } from "./theme";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const BOUNDS = { minX: -24, minY: -24, maxX: 324, maxY: 224 };

const NAMES: PlaceNames = {
  nodes: {},
  edges: {},
  avenues: [
    { index: 0, name: "5th Ave", at: 2 },
    { index: 1, name: "1st Ave", at: 101 },
  ],
  streets: [{ index: 0, name: "Harbor St", at: 3 }],
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (names: PlaceNames): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => {
    mounted.render(
      <svg aria-label="Test map">
        <MapStreetLabels names={names} bounds={BOUNDS} style={MAP_THEME.streetLabels} />
      </svg>,
    );
  });
};

const labels = (): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${MAP_STREET_LABEL_TEST_ID}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the street index", () => {
  it("names every avenue along the top margin and every street along the left", async () => {
    await render(NAMES);

    expect(labels().map((label) => label.textContent)).toEqual(["5th Ave", "1st Ave", "Harbor St"]);
    expect(labels().map((label) => label.getAttribute("data-axis"))).toEqual([
      STREET_LABEL_AXES.avenue,
      STREET_LABEL_AXES.avenue,
      STREET_LABEL_AXES.street,
    ]);
  });

  it("puts an avenue over its column and a street beside its row, inside the plate", async () => {
    await render(NAMES);

    const [firstAvenue, , street] = labels();
    const inset = MAP_THEME.streetLabels.inset;
    expect(Number(firstAvenue?.getAttribute("x"))).toBe(2);
    expect(Number(firstAvenue?.getAttribute("y"))).toBe(BOUNDS.minY + inset);
    expect(Number(street?.getAttribute("x"))).toBe(BOUNDS.minX + inset);
    expect(Number(street?.getAttribute("y"))).toBe(3);
  });

  it("takes no pointer events and says nothing to assistive technology", async () => {
    await render(NAMES);

    const layer = container?.querySelector(`[data-testid="${MAP_STREET_LABELS_TEST_ID}"]`);
    expect(layer?.getAttribute("style")).toContain("pointer-events: none");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws an empty layer for a map with no grid", async () => {
    await render({ nodes: {}, edges: {}, avenues: [], streets: [] });

    expect(labels()).toHaveLength(0);
  });
});
