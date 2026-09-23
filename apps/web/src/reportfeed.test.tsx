import type { HunterReport, NodeId, ReportContent, ReportSource } from "@manhunter/core";
import { makeNodeId, makeReportId, UNKNOWN_TRAVEL_MODE } from "@manhunter/core";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AVATAR_TEST_ID } from "./avatarportrait";
import { LIMITS } from "./limits";
import {
  ageText,
  REPORT_AGE_TEST_ID,
  REPORT_CONTENT_TEST_ID,
  REPORT_ENTRY_TEST_ID,
  REPORT_FEED_EMPTY_TEST_ID,
  REPORT_FEED_OVERFLOW_TEST_ID,
  REPORT_FEED_TEST_ID,
  REPORT_OBSERVED_TEST_ID,
  REPORT_RECEIVED_TEST_ID,
  REPORT_RELIABILITY_TEST_ID,
  ReportFeed,
  reliabilityText,
} from "./reportfeed";
import { FEED_ROW_THEME } from "./theme";

/**
 * The feed under jsdom, per the plan's "How much of M5 is Playwright's": M5.4 asserts here.
 * Structure and behaviour only, never a snapshot.
 *
 * Reports are built as literals rather than with `makeReport`, which `biome.json` denies to
 * `apps/web` along with `Report` itself - the UI only ever holds the redacted `HunterReport`,
 * which is the point of the test as much as of the component.
 */

type ActEnvironment = { IS_REACT_ACT_ENVIRONMENT?: boolean };
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

const DOWNTOWN = makeNodeId("n-downtown");
const PARK = makeNodeId("n-park");

const NOW = 5;

const sighting = (nodeId: NodeId): ReportContent => ({
  kind: "sighting",
  nodeId,
  travelMode: "foot",
});

const report = (parts: {
  readonly id: string;
  readonly source?: ReportSource;
  readonly observedAtTurn: number;
  readonly receivedAtTurn: number;
  readonly content?: ReportContent;
}): HunterReport => ({
  id: makeReportId(parts.id),
  source: parts.source ?? "witness",
  observedAtTurn: parts.observedAtTurn,
  receivedAtTurn: parts.receivedAtTurn,
  content: parts.content ?? sighting(DOWNTOWN),
});

const LATE = report({ id: "report-late", observedAtTurn: 2, receivedAtTurn: NOW });
const OLD = report({ id: "report-old", observedAtTurn: 1, receivedAtTurn: 1 });

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

const attributes = (testId: string, attribute: string): readonly (string | null)[] =>
  all(testId).map((element) => element.getAttribute(attribute));

const texts = (testId: string): readonly string[] =>
  all(testId).map((element) => element.textContent ?? "");

afterEach(async () => {
  const mounted = root;
  if (mounted) await act(async () => mounted.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("the report feed", () => {
  it("says so rather than showing nothing when no report has landed", async () => {
    await render(<ReportFeed reports={[]} currentTurn={NOW} />);

    expect(one(REPORT_FEED_TEST_ID)).not.toBeNull();
    expect(one(REPORT_FEED_EMPTY_TEST_ID)).not.toBeNull();
    expect(all(REPORT_ENTRY_TEST_ID)).toHaveLength(0);
  });

  it("draws one line per report in the view", async () => {
    await render(<ReportFeed reports={[OLD, LATE]} currentTurn={NOW} />);

    expect(all(REPORT_ENTRY_TEST_ID)).toHaveLength(2);
    expect(one(REPORT_FEED_EMPTY_TEST_ID)).toBeNull();
  });

  it("shows when a report was observed and when it arrived, distinguishably", async () => {
    await render(<ReportFeed reports={[LATE]} currentTurn={NOW} />);

    expect(texts(REPORT_OBSERVED_TEST_ID)).toEqual(["Observed turn 2"]);
    expect(texts(REPORT_RECEIVED_TEST_ID)).toEqual(["Received turn 5"]);
    expect(attributes(REPORT_ENTRY_TEST_ID, "data-observed")).toEqual(["2"]);
    expect(attributes(REPORT_ENTRY_TEST_ID, "data-received")).toEqual(["5"]);
  });

  it("highlights only the reports that landed this turn", async () => {
    await render(<ReportFeed reports={[OLD, LATE]} currentTurn={NOW} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-new")).toEqual(["true", "false"]);
  });

  it("stops highlighting a report once the turn has moved on", async () => {
    await render(<ReportFeed reports={[LATE]} currentTurn={NOW + 1} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-new")).toEqual(["false"]);
  });

  it("puts the newest arrival first, whatever order the view holds them in", async () => {
    const middle = report({ id: "report-middle", observedAtTurn: 1, receivedAtTurn: 3 });

    await render(<ReportFeed reports={[OLD, LATE, middle]} currentTurn={NOW} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-reportid")).toEqual([
      "report-late",
      "report-middle",
      "report-old",
    ]);
  });

  it("keeps two reports that landed together in the order the view gave them", async () => {
    const first = report({ id: "report-first", observedAtTurn: 4, receivedAtTurn: NOW });
    const second = report({ id: "report-second", observedAtTurn: 3, receivedAtTurn: NOW });

    await render(<ReportFeed reports={[first, second]} currentTurn={NOW} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-reportid")).toEqual([
      "report-first",
      "report-second",
    ]);
  });

  it("reads out a sighting with where and how, and negative evidence without a how", async () => {
    const seen = report({
      id: "report-seen",
      source: "cctv",
      observedAtTurn: 4,
      receivedAtTurn: NOW,
      content: { kind: "sighting", nodeId: PARK, travelMode: UNKNOWN_TRAVEL_MODE },
    });
    const unseen = report({
      id: "report-unseen",
      observedAtTurn: 4,
      receivedAtTurn: 4,
      content: { kind: "no_sighting", nodeId: DOWNTOWN },
    });

    await render(<ReportFeed reports={[seen, unseen]} currentTurn={NOW} />);

    expect(texts(REPORT_CONTENT_TEST_ID)).toEqual([
      "Sighting at n-park (unknown)",
      "Nothing seen at n-downtown",
    ]);
    expect(attributes(REPORT_ENTRY_TEST_ID, "data-source")).toEqual(["cctv", "witness"]);
  });

  it("names no report by anything a HunterReport does not carry", async () => {
    await render(<ReportFeed reports={[LATE, OLD]} currentTurn={NOW} />);

    const rendered = container?.textContent ?? "";
    for (const leak of ["prank", "planted", "true", "false", "accuracy"]) {
      expect(rendered.toLowerCase()).not.toContain(leak);
    }
  });
});

describe("the report feed's bound", () => {
  const overLimit: readonly HunterReport[] = Array.from(
    { length: LIMITS.maxReportsInFeed + 1 },
    (_unused, index) =>
      report({ id: `report-${index}`, observedAtTurn: index, receivedAtTurn: index }),
  );

  it("draws every report of a feed exactly at the limit, and withholds none", async () => {
    await render(<ReportFeed reports={overLimit.slice(1)} currentTurn={NOW} />);

    expect(all(REPORT_ENTRY_TEST_ID)).toHaveLength(LIMITS.maxReportsInFeed);
    expect(one(REPORT_FEED_OVERFLOW_TEST_ID)).toBeNull();
  });

  it("keeps the most recent when given one report over the limit, and says how many it dropped", async () => {
    await render(<ReportFeed reports={overLimit} currentTurn={NOW} />);

    const entries = all(REPORT_ENTRY_TEST_ID);
    expect(entries).toHaveLength(LIMITS.maxReportsInFeed);
    expect(entries.at(0)?.getAttribute("data-reportid")).toBe(`report-${LIMITS.maxReportsInFeed}`);
    expect(entries.at(-1)?.getAttribute("data-reportid")).toBe("report-1");
    expect(one(REPORT_FEED_OVERFLOW_TEST_ID)?.getAttribute("data-withheld")).toBe("1");
  });

  it("holds a caller to a smaller cap than the limit when it asks for one", async () => {
    await render(<ReportFeed reports={[OLD, LATE]} currentTurn={NOW} maxEntries={1} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-reportid")).toEqual(["report-late"]);
    expect(one(REPORT_FEED_OVERFLOW_TEST_ID)?.getAttribute("data-withheld")).toBe("1");
  });
});

describe("the report feed's row chrome (PLAN M6.8)", () => {
  const bySource = (["cctv", "patrol", "witness", "tip"] as const).map((source, index) =>
    report({ id: `report-${source}`, source, observedAtTurn: NOW, receivedAtTurn: NOW - index }),
  );

  it("badges each row with its source's weight from BALANCE", async () => {
    await render(<ReportFeed reports={bySource} currentTurn={NOW} />);

    expect(attributes(REPORT_RELIABILITY_TEST_ID, "data-reliability")).toEqual([
      "high",
      "fair",
      "fair",
      "low",
    ]);
    expect(texts(REPORT_RELIABILITY_TEST_ID)).toEqual(["Rel 90%", "Rel 60%", "Rel 50%", "Rel 20%"]);
  });

  it("reads the weights it is given rather than its own", async () => {
    const weights = { cctv: 0.1, patrol: 0.1, witness: 0.1, tip: 0.8 };

    await render(
      <ReportFeed reports={[bySource[3] ?? LATE]} currentTurn={NOW} sourceWeights={weights} />,
    );

    expect(attributes(REPORT_RELIABILITY_TEST_ID, "data-reliability")).toEqual(["high"]);
    expect(attributes(REPORT_RELIABILITY_TEST_ID, "data-weight")).toEqual(["0.8"]);
  });

  it("ages each row from when it was observed, not when it arrived", async () => {
    const fresh = report({ id: "r-fresh", observedAtTurn: NOW, receivedAtTurn: NOW });
    const aging = report({
      id: "r-aging",
      observedAtTurn: NOW - FEED_ROW_THEME.agingFromAge,
      receivedAtTurn: NOW - 1,
    });
    const stale = report({
      id: "r-stale",
      observedAtTurn: NOW - FEED_ROW_THEME.staleFromAge,
      receivedAtTurn: NOW - 2,
    });

    await render(<ReportFeed reports={[fresh, aging, stale]} currentTurn={NOW} />);

    expect(attributes(REPORT_ENTRY_TEST_ID, "data-staleness")).toEqual(["fresh", "aging", "stale"]);
    expect(attributes(REPORT_ENTRY_TEST_ID, "data-age")).toEqual([
      "0",
      String(FEED_ROW_THEME.agingFromAge),
      String(FEED_ROW_THEME.staleFromAge),
    ]);
    expect(texts(REPORT_AGE_TEST_ID)).toEqual([
      ageText(0),
      ageText(FEED_ROW_THEME.agingFromAge),
      ageText(FEED_ROW_THEME.staleFromAge),
    ]);
  });

  it("says a report of this turn is live and an older one how old", () => {
    expect(ageText(0)).toBe("Live");
    expect(ageText(3)).toBe("3h old");
    expect(reliabilityText(0.5)).toBe("Rel 50%");
  });

  it("draws one source face per row, and never the criminal's", async () => {
    await render(<ReportFeed reports={bySource} currentTurn={NOW} />);

    expect(all(AVATAR_TEST_ID)).toHaveLength(bySource.length);
    expect(attributes(AVATAR_TEST_ID, "data-subject")).toEqual([
      "cctv",
      "patrol",
      "witness",
      "tip",
    ]);
  });
});
