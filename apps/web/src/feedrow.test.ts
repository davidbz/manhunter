import { fc, test } from "@fast-check/vitest";
import {
  BALANCE,
  type HunterReport,
  makeNodeId,
  makeReportId,
  type ReportSource,
} from "@manhunter/core";
import { describe, expect, it } from "vitest";
import { avatarOf, textSeedOf } from "./avatar";
import {
  ageOf,
  type FeedRowTheme,
  feedRowOf,
  reliabilityOf,
  sourceAvatarOf,
  stalenessOf,
} from "./feedrow";
import { FEED_ROW_THEME } from "./theme";

/**
 * PLAN M6.8's feed treatments, on the data rather than the drawing. The reliability tiers are
 * checked against `BALANCE`'s own weights so a rebalance that moves a source across a tier shows
 * up here, and the face is checked never to be the criminal's.
 */

const SOURCES = ["cctv", "patrol", "witness", "tip"] as const satisfies readonly ReportSource[];

const THEME: FeedRowTheme = {
  agingFromAge: 2,
  staleFromAge: 4,
  highFromWeight: 0.75,
  fairFromWeight: 0.45,
};

const report = (id: string, source: ReportSource, observedAtTurn: number): HunterReport => ({
  id: makeReportId(id),
  source,
  observedAtTurn,
  receivedAtTurn: observedAtTurn,
  content: { kind: "no_sighting", nodeId: makeNodeId("n-0-0") },
});

describe("a feed row's age", () => {
  it("counts turns since the report was observed", () => {
    expect(ageOf(report("r", "tip", 3), 7)).toBe(4);
  });

  it("never goes negative, whatever clock it is read against", () => {
    expect(ageOf(report("r", "tip", 9), 7)).toBe(0);
  });

  it("reads fresh, then aging, then stale at the theme's thresholds", () => {
    expect(stalenessOf(0, THEME)).toBe("fresh");
    expect(stalenessOf(THEME.agingFromAge - 1, THEME)).toBe("fresh");
    expect(stalenessOf(THEME.agingFromAge, THEME)).toBe("aging");
    expect(stalenessOf(THEME.staleFromAge - 1, THEME)).toBe("aging");
    expect(stalenessOf(THEME.staleFromAge, THEME)).toBe("stale");
  });

  it("ships thresholds that leave room for every tier", () => {
    expect(FEED_ROW_THEME.agingFromAge).toBeGreaterThan(0);
    expect(FEED_ROW_THEME.staleFromAge).toBeGreaterThan(FEED_ROW_THEME.agingFromAge);
  });
});

describe("a feed row's reliability", () => {
  it("tiers BALANCE's source weights as cctv high, patrol and witness fair, tip low", () => {
    const tiers = SOURCES.map((source) =>
      reliabilityOf(BALANCE.belief.sourceWeight[source], FEED_ROW_THEME),
    );

    expect(tiers).toEqual(["high", "fair", "fair", "low"]);
  });

  it("reads the weight it was given, not one of its own", () => {
    const weights = { cctv: 0.1, patrol: 0.1, witness: 0.99, tip: 0.1 };
    const row = feedRowOf(report("r", "witness", 1), 1, weights, THEME);

    expect(row.weight).toBe(weights.witness);
    expect(row.reliability).toBe("high");
  });
});

describe("a feed row's face", () => {
  test.prop([fc.string(), fc.constantFrom(...SOURCES)])(
    "is the source's kind seeded by the report id, and never the criminal",
    (id, source) => {
      const avatar = sourceAvatarOf(report(id, source, 0));

      expect(avatar.subject).toBe(source);
      expect(avatar.subject).not.toBe("criminal");
      expect(avatar).toEqual(avatarOf(textSeedOf(id), source));
    },
  );

  it("is the same face every time for the same report", () => {
    const tip = report("report-7", "tip", 2);

    expect(sourceAvatarOf(tip)).toEqual(sourceAvatarOf(tip));
  });

  it("differs between two reports from the same source", () => {
    const first = sourceAvatarOf(report("report-1", "witness", 1));
    const second = sourceAvatarOf(report("report-2", "witness", 1));

    expect(JSON.stringify(first.layers)).not.toBe(JSON.stringify(second.layers));
  });
});
