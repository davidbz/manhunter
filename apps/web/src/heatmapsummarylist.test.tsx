import { makeNodeId } from "@manhunter/core";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { HeatmapSummary, PinnedReport, SuspectedDistrict } from "./heatmapsummary";
import {
  HEATMAP_REPORT_TEST_ID,
  HEATMAP_SUMMARY_TEST_ID,
  HEATMAP_SUSPECT_TEST_ID,
  HEATMAP_WITHHELD_TEST_ID,
  HeatmapSummaryList,
  reportTextOf,
  suspectTextOf,
} from "./heatmapsummarylist";

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const SUSPECT: SuspectedDistrict = {
  nodeId: makeNodeId("n4"),
  district: "industrial",
  percent: 42,
  topTier: true,
};

const REPORT: PinnedReport = {
  nodeId: makeNodeId("n7"),
  district: "park",
  kind: "sighting",
  source: "cctv",
  age: 0,
  staleness: "fresh",
  count: 1,
};

const EMPTY: HeatmapSummary = {
  suspects: { entries: [], withheld: 0 },
  reports: { entries: [], withheld: 0 },
};

let root: Root | null = null;
let container: HTMLElement | null = null;

const render = async (summary: HeatmapSummary): Promise<void> => {
  container = document.createElement("div");
  document.body.append(container);
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(<HeatmapSummaryList summary={summary} />));
};

const all = (testId: string): readonly Element[] =>
  Array.from(container?.querySelectorAll(`[data-testid="${testId}"]`) ?? []);

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the wording", () => {
  it("names a suspect by node and district, with its share and its tier", () => {
    expect(suspectTextOf(SUSPECT)).toBe("n4 - industrial: 42%, top tier");
    expect(suspectTextOf({ ...SUSPECT, topTier: false })).toBe("n4 - industrial: 42%");
  });

  it("says a share that rounds to nothing is under one percent, not zero", () => {
    expect(suspectTextOf({ ...SUSPECT, percent: 0, topTier: false })).toBe(
      "n4 - industrial: under 1%",
    );
  });

  it("reads a report the way the feed does: what, where, how old, from whom", () => {
    expect(reportTextOf(REPORT)).toBe("Sighting at n7 - park, Live from CCTV");
    expect(reportTextOf({ ...REPORT, kind: "no_sighting", age: 3, source: "patrol" })).toBe(
      "Nothing seen at n7 - park, 3h old from Patrol",
    );
  });

  it("counts the reports a pin stands for when there is more than one", () => {
    expect(reportTextOf({ ...REPORT, count: 3 })).toBe(
      "Sighting at n7 - park, Live from CCTV, 3 reports here",
    );
  });

  it("names the node alone when the map has no district for it", () => {
    expect(reportTextOf({ ...REPORT, district: null })).toBe("Sighting at n7, Live from CCTV");
  });
});

describe("the list", () => {
  it("is a named region that is hidden from sight, not from the accessibility tree", async () => {
    await render(EMPTY);

    const region = all(HEATMAP_SUMMARY_TEST_ID)[0];
    expect(region?.getAttribute("aria-label")).toBe("Map summary");
    expect(region?.classList.contains("mh-visually-hidden")).toBe(true);
    expect(region?.getAttribute("aria-hidden")).toBeNull();
    expect(
      Array.from(region?.querySelectorAll("ul") ?? []).map((list) =>
        list.getAttribute("aria-label"),
      ),
    ).toEqual(["Most suspected districts", "Reports pinned on the map"]);
  });

  it("says so when there is nothing to list, rather than reading an empty list", async () => {
    await render(EMPTY);

    expect(container?.textContent).toContain("No district is suspected yet");
    expect(container?.textContent).toContain("No reports pinned");
    expect(all(HEATMAP_WITHHELD_TEST_ID)).toHaveLength(0);
  });

  it("reads each entry, and how many more were held back", async () => {
    await render({
      suspects: { entries: [SUSPECT], withheld: 4 },
      reports: { entries: [REPORT], withheld: 0 },
    });

    expect(all(HEATMAP_SUSPECT_TEST_ID).map((row) => row.textContent)).toEqual([
      suspectTextOf(SUSPECT),
    ]);
    expect(all(HEATMAP_REPORT_TEST_ID).map((row) => row.textContent)).toEqual([
      reportTextOf(REPORT),
    ]);
    expect(all(HEATMAP_WITHHELD_TEST_ID).map((row) => row.textContent)).toEqual([
      "4 more not listed",
    ]);
  });
});
