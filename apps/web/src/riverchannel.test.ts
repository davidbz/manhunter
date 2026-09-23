import { fc, test } from "@fast-check/vitest";
import type { Position } from "@manhunter/core";
import { makeEdgeId } from "@manhunter/core";
import { describe, expect, it } from "vitest";
import type { CellPolygon } from "./districtcells";
import { LIMITS } from "./limits";
import { type BridgeDeck, bridgeDecksOf, riverChannelOf } from "./riverchannel";

const WIDTH = 20;
const MEASURE = { channelWidth: WIDTH, deckWidth: 10, overhang: 3 };
const BRIDGE = makeEdgeId("e-bridge");

const channelOf = (points: readonly Position[], width = WIDTH) => {
  const result = riverChannelOf(points, width);
  if (result.kind !== "channel") throw new Error(`expected a channel, got ${result.kind}`);
  return result;
};

const ysOf = (polygon: CellPolygon): readonly number[] => polygon.map((point) => point.y);
const xsOf = (polygon: CellPolygon): readonly number[] => polygon.map((point) => point.x);

const deckOf = (decks: readonly BridgeDeck[]): CellPolygon => {
  const deck = decks[0];
  if (deck === undefined) throw new Error("no deck was laid");
  return deck.polygon;
};

describe("the river channel", () => {
  it("is a band the channel's width wide around a straight course", () => {
    const { outline } = channelOf([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);

    expect(outline).toHaveLength(4);
    expect(Math.min(...ysOf(outline))).toBeCloseTo(50 - WIDTH / 2);
    expect(Math.max(...ysOf(outline))).toBeCloseTo(50 + WIDTH / 2);
    expect(Math.min(...xsOf(outline))).toBeCloseTo(0);
    expect(Math.max(...xsOf(outline))).toBeCloseTo(100);
  });

  it("mitres a staircase corner so both banks stay half a width from the course", () => {
    const { outline } = channelOf([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ]);
    const corners = outline.filter(
      (point) =>
        Math.abs(Math.abs(point.x - 100) - WIDTH / 2) < 1e-9 &&
        Math.abs(Math.abs(point.y) - WIDTH / 2) < 1e-9,
    );

    expect(outline).toHaveLength(6);
    expect(corners).toHaveLength(2);
  });

  it("drops the repeated corners core's staircase carries", () => {
    const { course } = channelOf([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);

    expect(course).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]);
  });

  it("is no channel at all for a river of fewer than two distinct points", () => {
    expect(channelOf([])).toEqual({ kind: "channel", outline: [], course: [] });
    expect(
      channelOf([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
    ).toEqual({ kind: "channel", outline: [], course: [] });
  });

  it("caps a hairpin's mitre rather than throwing a spike across the map", () => {
    const { outline } = channelOf([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 1 },
    ]);
    const corners = [outline[1], outline[4]];
    const reach = Math.max(
      ...corners.map((point) => Math.hypot((point?.x ?? 0) - 100, point?.y ?? 0)),
    );

    expect(reach).toBeLessThanOrEqual(WIDTH * 2 + 1e-9);
  });

  it("offsets a course that doubles straight back on itself without dividing by zero", () => {
    const { outline } = channelOf([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);

    for (const point of outline) expect(Number.isFinite(point.x + point.y)).toBe(true);
  });

  it("offsets a river right up to the bound", () => {
    const full = Array.from({ length: LIMITS.maxRiverPoints }, (_, index) => ({ x: index, y: 0 }));

    expect(channelOf(full).course).toHaveLength(LIMITS.maxRiverPoints);
  });

  /** AGENTS.md section 5: one point over the bound is refused before any offsetting runs. */
  it("refuses a river one point past the bound", () => {
    const over = Array.from({ length: LIMITS.maxRiverPoints + 1 }, (_, index) => ({
      x: index,
      y: 0,
    }));

    expect(riverChannelOf(over, WIDTH)).toEqual({
      kind: "too_many_river_points",
      points: LIMITS.maxRiverPoints + 1,
      maxPoints: LIMITS.maxRiverPoints,
    });
  });
});

describe("bridge decks", () => {
  const course = [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];

  it("lays a deck across the channel where a square bridge crosses, with overhang on both banks", () => {
    const deck = deckOf(
      bridgeDecksOf(
        [{ edgeId: BRIDGE, from: { x: 40, y: 0 }, to: { x: 40, y: 100 } }],
        course,
        MEASURE,
      ),
    );
    const reach = WIDTH / 2 + MEASURE.overhang;

    expect(Math.min(...ysOf(deck))).toBeCloseTo(50 - reach);
    expect(Math.max(...ysOf(deck))).toBeCloseTo(50 + reach);
    expect(Math.min(...xsOf(deck))).toBeCloseTo(40 - MEASURE.deckWidth / 2);
    expect(Math.max(...xsOf(deck))).toBeCloseTo(40 + MEASURE.deckWidth / 2);
  });

  it("lengthens the deck for a bridge crossing at a slant, so it still reaches both banks", () => {
    const deck = deckOf(
      bridgeDecksOf(
        [{ edgeId: BRIDGE, from: { x: 0, y: 0 }, to: { x: 100, y: 100 } }],
        course,
        MEASURE,
      ),
    );
    const ends = [0, 1].map((index) => {
      const a = deck[index] ?? { x: 0, y: 0 };
      const b = deck[3 - index] ?? { x: 0, y: 0 };
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    });

    for (const end of ends) expect(Math.abs(end.y - 50)).toBeGreaterThan(WIDTH / 2);
    expect(Math.abs((ends[0]?.x ?? 0) - (ends[0]?.y ?? 0))).toBeCloseTo(0);
  });

  it("names the bridge edge on its deck", () => {
    const decks = bridgeDecksOf(
      [{ edgeId: BRIDGE, from: { x: 40, y: 0 }, to: { x: 40, y: 100 } }],
      course,
      MEASURE,
    );

    expect(decks.map((deck) => deck.edgeId)).toEqual([BRIDGE]);
  });

  it("lays no deck for a bridge that never meets the river, or has no length", () => {
    expect(
      bridgeDecksOf(
        [
          { edgeId: BRIDGE, from: { x: 40, y: 0 }, to: { x: 40, y: 30 } },
          { edgeId: BRIDGE, from: { x: 40, y: 50 }, to: { x: 40, y: 50 } },
          { edgeId: BRIDGE, from: { x: 0, y: 50 }, to: { x: 100, y: 50 } },
        ],
        course,
        MEASURE,
      ),
    ).toEqual([]);
  });

  it("lays no deck on a river with no course", () => {
    expect(
      bridgeDecksOf(
        [{ edgeId: BRIDGE, from: { x: 40, y: 0 }, to: { x: 40, y: 100 } }],
        [],
        MEASURE,
      ),
    ).toEqual([]);
  });
});

const COORDINATE_RANGE = 1000;
const MAX_PROPERTY_POINTS = 20;

const pointArbitrary = fc.record({
  x: fc.integer({ min: 0, max: COORDINATE_RANGE }),
  y: fc.integer({ min: 0, max: COORDINATE_RANGE }),
});

describe("river channel invariants", () => {
  test.prop([fc.array(pointArbitrary, { maxLength: MAX_PROPERTY_POINTS })])(
    "every bank point is finite and two per distinct course point",
    (points) => {
      const { outline, course } = channelOf(points);

      expect(outline.length).toBe(course.length < 2 ? 0 : course.length * 2);
      for (const point of outline) expect(Number.isFinite(point.x + point.y)).toBe(true);
    },
  );
});
