/**
 * Map debug export (PLAN M2.4): a generated city rendered as a standalone SVG string, so a seed
 * can be eyeballed without a browser or a running game.
 *
 * It lives in `sim` rather than `core` because an SVG is presentation and `core` holds no
 * user-facing strings (architecture rule 1, M1.2's note). `web` does not reuse it either: the
 * renderer (PLAN M5.3a) draws React elements, not a string, and the two have no shared output.
 *
 * `createMapSvgLogic()` takes no deps because, like `createRng()` (M1.1), it is at the bottom of
 * the graph; the theme is data it receives rather than captures. M4.2 wires it beside the
 * artefact writer at `main.ts`.
 */

import type {
  DistrictType,
  EdgeKind,
  Exit,
  ExitKind,
  MapEdge,
  MapGraph,
  MapNode,
  NodeId,
  Position,
  River,
} from "@manhunter/core";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Decimals kept on a coordinate. Positions are jittered floats; two is under a pixel at any zoom. */
const COORDINATE_DECIMALS = 2;

/** How an edge kind is drawn. `dash` is `null` for a solid line rather than an empty string. */
export type EdgeStyle = {
  readonly stroke: string;
  readonly width: number;
  readonly dash: string | null;
};

/**
 * Every colour and measurement the export uses. Annotated as a type rather than inferred from
 * `as const` so a caller can override one field, and keyed by `EdgeKind`/`DistrictType` so a new
 * variant is a compile error here rather than a missing entry at render time (the M1.3 precedent).
 */
export type SvgTheme = {
  readonly background: string;
  readonly padding: number;
  readonly river: string;
  readonly riverWidth: number;
  readonly nodeRadius: number;
  readonly incidentRadius: number;
  readonly nodeStroke: string;
  readonly exitStroke: string;
  readonly incidentStroke: string;
  readonly markerWidth: number;
  readonly edges: Readonly<Record<EdgeKind, EdgeStyle>>;
  readonly districts: Readonly<Record<DistrictType, string>>;
};

/** The dispatch-screen palette of DESIGN.md "Visual direction". M5.7 owns `web`'s own tokens. */
export const DEFAULT_SVG_THEME: SvgTheme = {
  background: "#0b0f14",
  padding: 24,
  river: "#1d4e6b",
  riverWidth: 6,
  nodeRadius: 6,
  incidentRadius: 9,
  nodeStroke: "#0b0f14",
  exitStroke: "#f2b134",
  incidentStroke: "#e8483f",
  markerWidth: 2.5,
  edges: {
    road: { stroke: "#4c6378", width: 2, dash: null },
    footpath: { stroke: "#3c5a44", width: 1.5, dash: "3 3" },
    rail: { stroke: "#7a6ea8", width: 2, dash: "8 4" },
    tunnel: { stroke: "#6b5a4a", width: 2, dash: "1 4" },
    bridge: { stroke: "#d9e2ec", width: 3, dash: null },
  },
  districts: {
    downtown: "#5fb0d9",
    residential: "#7fbf7f",
    suburb: "#b5c46a",
    industrial: "#b58a5a",
    park: "#4f9a6a",
    transit_hub: "#c07fc0",
    exit: "#f2b134",
  },
};

export type MapSvgRequest = {
  readonly graph: MapGraph;
  /** Defaults to `DEFAULT_SVG_THEME`. */
  readonly theme?: SvgTheme;
};

export type MapSvgLogic = {
  readonly render: (request: MapSvgRequest) => string;
};

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/**
 * Serializing a string into markup is a boundary even when the string came from the generator:
 * node ids are code-authored today, and an unescaped one would produce a file no parser accepts.
 */
const escapeXml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character] ?? character);

const coordinate = (value: number): string => String(Number(value.toFixed(COORDINATE_DECIMALS)));

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
};

const leastOf = (values: readonly number[]): number =>
  values.reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY);

const greatestOf = (values: readonly number[]): number =>
  values.reduce((greatest, value) => Math.max(greatest, value), Number.NEGATIVE_INFINITY);

/**
 * Bounds over every drawn point, nodes and river alike, so a river that wanders past the outermost
 * node is not clipped. Total on an empty map: a degenerate graph gets a padding-sized canvas
 * rather than an `Infinity` in the viewBox.
 */
const boundsOf = (points: readonly Position[], padding: number): Bounds => {
  if (points.length === 0) {
    return { minX: 0, minY: 0, width: padding * 2, height: padding * 2 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = leastOf(xs) - padding;
  const minY = leastOf(ys) - padding;
  return {
    minX,
    minY,
    width: greatestOf(xs) + padding - minX,
    height: greatestOf(ys) + padding - minY,
  };
};

const positionIndex = (nodes: readonly MapNode[]): ReadonlyMap<NodeId, Position> =>
  new Map(nodes.map((node) => [node.id, node.position]));

const exitIndex = (exits: readonly Exit[]): ReadonlyMap<NodeId, ExitKind> =>
  new Map(exits.map((exit) => [exit.nodeId, exit.kind]));

/**
 * A shape plus its hover label. The `<title>` is a sibling inside a `<g>` rather than a child of
 * the shape, which is the interoperable spelling: both are valid SVG, but ImageMagick's built-in
 * renderer silently drops any shape that has element children, so the child form rasterizes to an
 * empty city. Verified by rendering one both ways.
 */
const labelled = (label: string, shape: string): string =>
  `<g><title>${escapeXml(label)}</title>${shape}</g>`;

/** An edge naming a node the map does not contain is skipped rather than drawn to nowhere. */
const edgeLine = (
  edge: MapEdge,
  positions: ReadonlyMap<NodeId, Position>,
  theme: SvgTheme,
): string | null => {
  const from = positions.get(edge.from);
  const to = positions.get(edge.to);
  if (from === undefined || to === undefined) {
    return null;
  }
  const style = theme.edges[edge.kind];
  const dash = style.dash === null ? "" : ` stroke-dasharray="${style.dash}"`;
  return labelled(
    `${edge.id} ${edge.kind}`,
    `<line x1="${coordinate(from.x)}" y1="${coordinate(from.y)}" ` +
      `x2="${coordinate(to.x)}" y2="${coordinate(to.y)}" ` +
      `stroke="${style.stroke}" stroke-width="${style.width}"${dash} />`,
  );
};

const RIVER_MIN_POINTS = 2;

const riverPolyline = (river: River | null, theme: SvgTheme): readonly string[] => {
  if (river === null || river.points.length < RIVER_MIN_POINTS) {
    return [];
  }
  const points = river.points
    .map((point) => `${coordinate(point.x)},${coordinate(point.y)}`)
    .join(" ");
  return [
    `<polyline points="${points}" fill="none" stroke="${theme.river}" ` +
      `stroke-width="${theme.riverWidth}" stroke-linejoin="round" stroke-linecap="round" />`,
  ];
};

const markerStroke = (theme: SvgTheme, isIncident: boolean, isExit: boolean): string => {
  if (isIncident) {
    return theme.incidentStroke;
  }
  if (isExit) {
    return theme.exitStroke;
  }
  return theme.nodeStroke;
};

const nodeLabel = (node: MapNode, exitKind: ExitKind | undefined, isIncident: boolean): string => {
  const parts = [String(node.id), String(node.districtType)];
  if (exitKind !== undefined) {
    parts.push(`exit ${exitKind}`);
  }
  if (isIncident) {
    parts.push("incident");
  }
  return parts.join(" - ");
};

const nodeCircle = (
  node: MapNode,
  exits: ReadonlyMap<NodeId, ExitKind>,
  incidentNodeId: NodeId,
  theme: SvgTheme,
): string => {
  const exitKind = exits.get(node.id);
  const isIncident = node.id === incidentNodeId;
  const radius = isIncident ? theme.incidentRadius : theme.nodeRadius;
  return labelled(
    nodeLabel(node, exitKind, isIncident),
    `<circle cx="${coordinate(node.position.x)}" cy="${coordinate(node.position.y)}" ` +
      `r="${radius}" fill="${theme.districts[node.districtType]}" ` +
      `stroke="${markerStroke(theme, isIncident, exitKind !== undefined)}" ` +
      `stroke-width="${theme.markerWidth}" />`,
  );
};

const isPresent = (line: string | null): line is string => line !== null;

const document = (bounds: Bounds, background: string, body: readonly string[]): string =>
  [
    `<svg xmlns="${SVG_NAMESPACE}" viewBox="${coordinate(bounds.minX)} ${coordinate(bounds.minY)} ` +
      `${coordinate(bounds.width)} ${coordinate(bounds.height)}" ` +
      `width="${coordinate(bounds.width)}" height="${coordinate(bounds.height)}">`,
    `  <rect x="${coordinate(bounds.minX)}" y="${coordinate(bounds.minY)}" ` +
      `width="${coordinate(bounds.width)}" height="${coordinate(bounds.height)}" fill="${background}" />`,
    ...body.map((line) => `  ${line}`),
    "</svg>",
    "",
  ].join("\n");

/**
 * The file name a map export is written under. Seeds are numbers, so no path separator can reach
 * it; M4.2's CLI parsing is what bounds where the seed itself comes from.
 */
export const makeMapSvgFileName = (seed: number): string => `map-${seed}.svg`;

export const createMapSvgLogic = (): MapSvgLogic => ({
  render: ({ graph, theme = DEFAULT_SVG_THEME }) => {
    const positions = positionIndex(graph.nodes);
    const exits = exitIndex(graph.exits);
    const drawn = [...graph.nodes.map((node) => node.position), ...(graph.river?.points ?? [])];
    const body = [
      ...riverPolyline(graph.river, theme),
      ...graph.edges.map((edge) => edgeLine(edge, positions, theme)).filter(isPresent),
      ...graph.nodes.map((node) => nodeCircle(node, exits, graph.incidentNodeId, theme)),
    ];
    return document(boundsOf(drawn, theme.padding), theme.background, body);
  },
});
