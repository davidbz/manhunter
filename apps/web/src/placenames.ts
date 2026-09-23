/**
 * Readable, seeded names for every place on the map (PLAN M7.1), so the feed, the board, the queue
 * and the map's own labels say "Downtown - 5th Ave & Harbor St" where they used to say `n-3-2`.
 *
 * **The grid is recovered from positions, never by parsing ids.** An id is `core`'s business and
 * may change shape; a position is what the player sees. Generated positions are jittered off their
 * cell by less than half a cell (`balance.test.ts` pins `positionJitter` below one half), so every
 * coordinate is first snapped to the grid pitch, and the sorted distinct snapped values are the
 * column (x) and row (y) indices. Ranking distinct values rather than dividing by the pitch is what
 * keeps a map whose grid does not start at the origin numbered from its own first column.
 *
 * Each column is an avenue and each row a street, drawn from the word tables below and shuffled
 * by the seed through `seedhash.ts`, the same cosmetic hash the avatars use. A seed-derived name
 * is no spoiler: the seed is already on screen as the case number.
 *
 * Pure data in, plain records out. `mapnodes.ts` memoises the result per hunt.
 */

import type {
  DistrictType,
  EdgeId,
  EdgeKind,
  ExitKind,
  MapEdge,
  MapGraph,
  NodeId,
  Position,
} from "@manhunter/core";
import { drawOf, streamBaseOf } from "./seedhash";

/** One avenue (a column) or street (a row), and where it runs: the mean x or y of its nodes. */
export type StreetLine = {
  readonly index: number;
  readonly name: string;
  readonly at: number;
};

/** Keyed by id. A node or edge with no entry falls back to `UNKNOWN_PLACE` at lookup. */
export type PlaceNames = {
  readonly nodes: Readonly<Record<string, string>>;
  readonly edges: Readonly<Record<string, string>>;
  /** West to east. */
  readonly avenues: readonly StreetLine[];
  /** North to south. */
  readonly streets: readonly StreetLine[];
};

/**
 * Twelve of each covers the shipped 8x6 grid with room to spare. A grid wider or taller than its
 * table goes round the shuffled table again with a pass number, so names stay distinct at any
 * size `core`'s `maxMapNodes` allows.
 */
const AVENUE_WORDS: readonly string[] = [
  "1st",
  "2nd",
  "3rd",
  "4th",
  "5th",
  "6th",
  "7th",
  "8th",
  "9th",
  "10th",
  "11th",
  "12th",
];

const STREET_WORDS: readonly string[] = [
  "Harbor",
  "Mill",
  "Canal",
  "Market",
  "Foundry",
  "Chapel",
  "Quarry",
  "Orchard",
  "Beacon",
  "Tanner",
  "Granite",
  "Ferry",
];

const AVENUE_SUFFIX = "Ave";
const STREET_SUFFIX = "St";
const AVENUE_SALT = "avenue";
const STREET_SALT = "street";
const WORD_SEPARATOR = " ";
const PLACE_SEPARATOR = " - ";
const CROSSING_SEPARATOR = " & ";

/** What a lookup says for an id the names do not carry. Never the raw id. */
export const UNKNOWN_PLACE = "Unknown place";

export const DISTRICT_LABELS: Readonly<Record<DistrictType, string>> = {
  downtown: "Downtown",
  residential: "Residential",
  suburb: "Suburbs",
  industrial: "Industrial",
  park: "Park",
  transit_hub: "Transit hub",
  exit: "Exit",
};

/**
 * An exit is named for its kind in place of its district. Its crossing still follows, because a
 * map may carry two exits of one kind and every node name is unique.
 */
export const EXIT_LABELS: Readonly<Record<ExitKind, string>> = {
  airport: "Airport exit",
  port: "Port exit",
  border: "Border exit",
  highway: "Highway exit",
};

/** Appended to the avenue or street an edge runs along. A road is the street itself. */
const EDGE_SUFFIXES: Readonly<Record<EdgeKind, string>> = {
  road: "",
  footpath: " footpath",
  rail: " rail",
  tunnel: " Tunnel",
  bridge: " Bridge",
};

type GridCell = {
  readonly column: number;
  readonly row: number;
};

/** Seeded Fisher-Yates over a copy of `words`. */
const shuffledOf = (words: readonly string[], seed: number, salt: string): readonly string[] => {
  const base = streamBaseOf(seed, salt);
  const shuffled = [...words];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = drawOf(base, index) % (index + 1);
    const held = shuffled[index] ?? "";
    shuffled[index] = shuffled[other] ?? held;
    shuffled[other] = held;
  }

  return shuffled;
};

const lineNameOf = (words: readonly string[], suffix: string, index: number): string => {
  const word = words[index % words.length] ?? "";
  const pass = Math.floor(index / words.length);
  const name = `${word}${WORD_SEPARATOR}${suffix}`;

  return pass === 0 ? name : `${name}${WORD_SEPARATOR}${pass + 1}`;
};

/** Snapped value to its rank among the distinct snapped values, lowest first. */
const rankIndexOf = (snapped: readonly number[]): ReadonlyMap<number, number> =>
  new Map(
    [...new Set(snapped)]
      .sort((left, right) => left - right)
      .map((value, rank): [number, number] => [value, rank]),
  );

const snapOf = (value: number, pitch: number): number =>
  pitch > 0 ? Math.round(value / pitch) : value;

type Axis = {
  readonly pitch: number;
  readonly ranks: ReadonlyMap<number, number>;
  readonly lines: readonly StreetLine[];
};

type Grid = {
  readonly columns: Axis;
  readonly rows: Axis;
};

const meanOf = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

const indexOnAxis = (axis: Pick<Axis, "pitch" | "ranks">, value: number): number =>
  axis.ranks.get(snapOf(value, axis.pitch)) ?? 0;

const axisOf = (
  values: readonly number[],
  pitch: number,
  words: readonly string[],
  suffix: string,
): Axis => {
  const ranks = rankIndexOf(values.map((value) => snapOf(value, pitch)));
  const lines = [...ranks.values()].map((index) => ({
    index,
    name: lineNameOf(words, suffix, index),
    at: meanOf(values.filter((value) => indexOnAxis({ pitch, ranks }, value) === index)),
  }));

  return { pitch, ranks, lines };
};

const gridOf = (map: MapGraph, seed: number, pitch: number): Grid => {
  const positions = map.nodes.map((node) => node.position);

  return {
    columns: axisOf(
      positions.map((position) => position.x),
      pitch,
      shuffledOf(AVENUE_WORDS, seed, AVENUE_SALT),
      AVENUE_SUFFIX,
    ),
    rows: axisOf(
      positions.map((position) => position.y),
      pitch,
      shuffledOf(STREET_WORDS, seed, STREET_SALT),
      STREET_SUFFIX,
    ),
  };
};

const cellOf = (grid: Grid, position: Position): GridCell => ({
  column: indexOnAxis(grid.columns, position.x),
  row: indexOnAxis(grid.rows, position.y),
});

const lineAt = (lines: readonly StreetLine[], index: number): string =>
  lines[index]?.name ?? UNKNOWN_PLACE;

const crossingOf = (grid: Grid, cell: GridCell): string =>
  `${lineAt(grid.columns.lines, cell.column)}${CROSSING_SEPARATOR}${lineAt(grid.rows.lines, cell.row)}`;

const nodeNamesOf = (map: MapGraph, grid: Grid): Readonly<Record<string, string>> => {
  const exitKinds = new Map<NodeId, ExitKind>(map.exits.map((exit) => [exit.nodeId, exit.kind]));

  return Object.fromEntries(
    map.nodes.map((node) => {
      const exitKind = exitKinds.get(node.id);
      const place =
        exitKind === undefined ? DISTRICT_LABELS[node.districtType] : EXIT_LABELS[exitKind];

      return [
        node.id,
        `${place}${PLACE_SEPARATOR}${crossingOf(grid, cellOf(grid, node.position))}`,
      ];
    }),
  );
};

/**
 * A horizontal edge takes its row's street and any other its column's avenue. An edge naming a
 * node the map does not carry has no ends to place, so it gets no entry.
 */
const edgeEntryOf = (
  edge: MapEdge,
  grid: Grid,
  positions: ReadonlyMap<NodeId, Position>,
): readonly [EdgeId, string][] => {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (from === undefined || to === undefined) return [];

  const start = cellOf(grid, from);
  const line =
    start.row === cellOf(grid, to).row
      ? lineAt(grid.rows.lines, start.row)
      : lineAt(grid.columns.lines, start.column);

  return [[edge.id, `${line}${EDGE_SUFFIXES[edge.kind]}`]];
};

/**
 * Every node and edge of `map`, named for `seed`. `gridPitch` is the generator's cell size,
 * `balance.map.nodeSpacing`; the same map, seed and pitch always give the same names.
 */
export const placeNamesOf = (map: MapGraph, seed: number, gridPitch: number): PlaceNames => {
  const grid = gridOf(map, seed, gridPitch);
  const positions = new Map(map.nodes.map((node) => [node.id, node.position]));

  return {
    nodes: nodeNamesOf(map, grid),
    edges: Object.fromEntries(map.edges.flatMap((edge) => edgeEntryOf(edge, grid, positions))),
    avenues: grid.columns.lines,
    streets: grid.rows.lines,
  };
};

export const nodeNameOf = (names: PlaceNames, nodeId: NodeId): string =>
  names.nodes[nodeId] ?? UNKNOWN_PLACE;

export const edgeNameOf = (names: PlaceNames, edgeId: EdgeId): string =>
  names.edges[edgeId] ?? UNKNOWN_PLACE;

/** Names for no map at all: every lookup is `UNKNOWN_PLACE`. */
export const NO_PLACE_NAMES: PlaceNames = { nodes: {}, edges: {}, avenues: [], streets: [] };
