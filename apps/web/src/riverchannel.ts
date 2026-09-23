/**
 * The river as a channel and the bridge decks across it (PLAN M6.4).
 *
 * `MapGraph.river` is an open staircase polyline running half a cell past each end of the city.
 * Stroking it wider is not a channel: a wide stroke has no banks to draw and no outline a deck can
 * be measured against. So the polyline is offset to either side by half the channel's width, with
 * mitred joins, and the two offsets are joined into one closed band. The staircase turns at right
 * angles, where a mitre is exact; any sharper turn is capped at `MITER_LIMIT` half-widths so a
 * hairpin cannot throw a spike across the map.
 *
 * A bridge deck is placed where a `bridge` edge first crosses the centreline, long enough to span
 * the channel at the angle the edge crosses it, plus an overhang onto each bank.
 *
 * Pure data in, pure data out, bounded by `LIMITS.maxRiverPoints` before any work runs.
 */

import type { EdgeId, Position } from "@manhunter/core";
import type { CellPolygon } from "./districtcells";
import { LIMITS } from "./limits";

export type RiverRefusal = {
  readonly kind: "too_many_river_points";
  readonly points: number;
  readonly maxPoints: number;
};

export type RiverChannelResult =
  | { readonly kind: "channel"; readonly outline: CellPolygon; readonly course: CellPolygon }
  | RiverRefusal;

/** A bridge edge placed on the map, in the renderer's coordinates. */
export type BridgeSpan = {
  readonly edgeId: EdgeId;
  readonly from: Position;
  readonly to: Position;
};

export type BridgeDeck = {
  readonly edgeId: EdgeId;
  readonly polygon: CellPolygon;
};

/** How a deck is sized, in map units. */
export type DeckMeasure = {
  readonly channelWidth: number;
  readonly deckWidth: number;
  readonly overhang: number;
};

const HALF = 0.5;

/** A course needs two distinct points to have a direction at all. */
const MIN_COURSE_POINTS = 2;

/** The longest a mitred join or a deck may reach, in half-widths of the channel. */
const MITER_LIMIT = 4;

/** Two points closer than this are one point: the staircase repeats a corner where it runs straight. */
const COINCIDENT_DISTANCE = 1e-9;

/** Below this a sum of unit normals has no direction: the course has doubled back on itself. */
const DEGENERATE_LENGTH = 1e-9;

const lengthOf = (vector: Position): number => Math.hypot(vector.x, vector.y);

const minus = (a: Position, b: Position): Position => ({ x: a.x - b.x, y: a.y - b.y });

const along = (origin: Position, direction: Position, distance: number): Position => ({
  x: origin.x + direction.x * distance,
  y: origin.y + direction.y * distance,
});

const unitOf = (vector: Position): Position => {
  const length = lengthOf(vector);

  return { x: vector.x / length, y: vector.y / length };
};

/** Left-hand unit normal of the segment `from -> to`. */
const normalOf = (from: Position, to: Position): Position => {
  const direction = unitOf(minus(to, from));

  return { x: -direction.y, y: direction.x };
};

const dot = (a: Position, b: Position): number => a.x * b.x + a.y * b.y;

const cross = (a: Position, b: Position): number => a.x * b.y - a.y * b.x;

const withoutRepeats = (points: readonly Position[]): readonly Position[] =>
  points.filter((point, index) => {
    const previous = points[index - 1];

    return previous === undefined || lengthOf(minus(point, previous)) > COINCIDENT_DISTANCE;
  });

/**
 * The offset of one course point: along the mitre between the segments either side of it, far
 * enough that both offset segments stay `halfWidth` from the course, and no further than the cap.
 */
const offsetAt = (
  point: Position,
  incoming: Position,
  outgoing: Position,
  halfWidth: number,
): Position => {
  const sum = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
  if (lengthOf(sum) < DEGENERATE_LENGTH) return along(point, incoming, halfWidth);
  const miter = unitOf(sum);

  return along(point, miter, halfWidth / Math.max(dot(miter, incoming), 1 / MITER_LIMIT));
};

/** One bank: every course point offset `halfWidth` to the left, or to the right if negative. */
const bankOf = (
  course: readonly Position[],
  normals: readonly Position[],
  halfWidth: number,
): readonly Position[] =>
  course.flatMap((point, index) => {
    const incoming = normals[index - 1] ?? normals[index];
    const outgoing = normals[index] ?? normals[index - 1];
    if (incoming === undefined || outgoing === undefined) return [];

    return [offsetAt(point, incoming, outgoing, halfWidth)];
  });

const refusalFor = (points: readonly Position[]): RiverRefusal | null =>
  points.length > LIMITS.maxRiverPoints
    ? { kind: "too_many_river_points", points: points.length, maxPoints: LIMITS.maxRiverPoints }
    : null;

/**
 * The channel `width` wide around `points`: its closed `outline` (the left bank out, the right
 * bank back) and the de-duplicated `course` it was built on. Fewer than two distinct points is
 * no river, and comes back as empty polygons rather than an error.
 */
export const riverChannelOf = (points: readonly Position[], width: number): RiverChannelResult => {
  const refusal = refusalFor(points);
  if (refusal !== null) return refusal;
  const course = withoutRepeats(points);
  if (course.length < MIN_COURSE_POINTS) return { kind: "channel", outline: [], course: [] };
  const normals = course.slice(1).map((point, index) => normalOf(course[index] ?? point, point));
  const left = bankOf(course, normals, width * HALF);
  const right = bankOf(course, normals, -width * HALF);

  return { kind: "channel", outline: [...left, ...[...right].reverse()], course };
};

type Crossing = {
  readonly at: Position;
  /** Sine of the angle between the bridge and the stretch of river it crosses. */
  readonly sine: number;
};

/** Where segment `a` crosses segment `b`, or `null` if they are parallel or miss each other. */
const crossingOf = (aFrom: Position, aTo: Position, bFrom: Position, bTo: Position) => {
  const a = minus(aTo, aFrom);
  const b = minus(bTo, bFrom);
  const denominator = cross(a, b);
  if (Math.abs(denominator) < DEGENERATE_LENGTH) return null;
  const offset = minus(bFrom, aFrom);
  const alongA = cross(offset, b) / denominator;
  const alongB = cross(offset, a) / denominator;
  if (alongA < 0 || alongA > 1 || alongB < 0 || alongB > 1) return null;

  return { at: along(aFrom, a, alongA), sine: Math.abs(denominator) / (lengthOf(a) * lengthOf(b)) };
};

const firstCrossing = (span: BridgeSpan, course: readonly Position[]): Crossing | null =>
  course.reduce<Crossing | null>((found, point, index) => {
    const next = course[index + 1];
    if (found !== null || next === undefined) return found;

    return crossingOf(span.from, span.to, point, next);
  }, null);

const deckPolygon = (span: BridgeSpan, crossing: Crossing, measure: DeckMeasure): CellPolygon => {
  const direction = unitOf(minus(span.to, span.from));
  const across = { x: -direction.y, y: direction.x };
  const reach =
    (measure.channelWidth * HALF) / Math.max(crossing.sine, 1 / MITER_LIMIT) + measure.overhang;
  const halfWidth = measure.deckWidth * HALF;
  const near = along(crossing.at, direction, -reach);
  const far = along(crossing.at, direction, reach);

  return [
    along(near, across, halfWidth),
    along(far, across, halfWidth),
    along(far, across, -halfWidth),
    along(near, across, -halfWidth),
  ];
};

/**
 * One deck per bridge that crosses the river's course, in bridge order. A bridge that never meets
 * the course (a river of one point, or a bridge drawn clear of it) gets no deck; a bridge of zero
 * length has no direction to lay one along and gets none either.
 */
export const bridgeDecksOf = (
  spans: readonly BridgeSpan[],
  course: readonly Position[],
  measure: DeckMeasure,
): readonly BridgeDeck[] =>
  spans.flatMap((span) => {
    if (lengthOf(minus(span.to, span.from)) < DEGENERATE_LENGTH) return [];
    const crossing = firstCrossing(span, course);
    if (crossing === null) return [];

    return [{ edgeId: span.edgeId, polygon: deckPolygon(span, crossing, measure) }];
  });
