/**
 * The city, drawn (PLAN M5.3a). Nodes, typed edges, exits, standing roadblocks, the river, and
 * whatever the player has selected - everything the map is made of, and nothing else.
 *
 * This is the `MapRenderer` seam AGENTS.md names ("SVG via React for now; PixiJS may replace it
 * later behind `MapRenderer`). `MapRendererProps` is therefore the contract, not the SVG: a
 * different renderer satisfies the same props, because everything in them is data the view
 * already carries plus the two seams a renderer cannot avoid - a selection callback and a layer
 * to draw an overlay into.
 *
 * It is presentational and controlled: it holds no state. Selection is UI state that PLAN M5.5's
 * action panel has to read as well, so it is owned above both of them and arrives as a prop;
 * `mappanel.tsx` is the thin wrapper that reads the view off the store.
 *
 * The overlay layer is drawn over the river and under the edges and nodes, which is where PLAN
 * M5.3b's belief heatmap belongs, and it does not take pointer events, so a node click cannot be
 * swallowed by the heat drawn beneath it.
 *
 * Nodes and edges are ARIA options inside one listbox rather than buttons: SVG has no native
 * button, `role="button"` on a `<g>` is what Biome's `useSemanticElements` refuses, and an option
 * is the role that can carry `aria-selected`, which is the state this map actually has.
 *
 * Colours and measurements are one table, `DEFAULT_MAP_THEME`, passed in rather than captured
 * (the `SvgTheme` precedent in `packages/sim/src/svg.ts`). PLAN M5.7 lifts the palette into
 * `theme.ts`; until then this is the one place in the renderer a colour appears.
 */

import {
  blockedEdgeIdsAt,
  type DistrictType,
  type EdgeId,
  type EdgeKind,
  type Exit,
  type ExitKind,
  type HunterView,
  type MapEdge,
  type MapNode,
  type NodeId,
  type Position,
  type River,
} from "@manhunter/core";
import type { KeyboardEvent, ReactNode } from "react";
import { positionIndexOf } from "./mapnodes";

/** What the player has picked on the map. PLAN M5.5 turns one of these into an action target. */
export type MapSelection =
  | { readonly kind: "node"; readonly nodeId: NodeId }
  | { readonly kind: "edge"; readonly edgeId: EdgeId };

/** How one edge kind is drawn. `dash` is `null` for a solid line rather than an empty string. */
export type MapEdgeStyle = {
  readonly stroke: string;
  readonly width: number;
  readonly dash: string | null;
};

/**
 * Keyed by `EdgeKind` and `DistrictType` rather than switched on, so a new variant is a compile
 * error here instead of a missing branch at render time (architecture rule 6, and the same shape
 * `balance.ts` and the debug export already use).
 */
export type MapTheme = {
  readonly padding: number;
  readonly river: string;
  readonly riverWidth: number;
  readonly nodeRadius: number;
  readonly incidentRadius: number;
  readonly nodeStroke: string;
  readonly exitStroke: string;
  readonly incidentStroke: string;
  readonly markerWidth: number;
  readonly selectionStroke: string;
  readonly selectionWidth: number;
  readonly selectionGap: number;
  readonly blockedStroke: string;
  readonly blockedRadius: number;
  readonly edges: Readonly<Record<EdgeKind, MapEdgeStyle>>;
  readonly districts: Readonly<Record<DistrictType, string>>;
};

/** The dispatch palette of DESIGN.md "Visual direction". PLAN M5.7 lifts it into `theme.ts`. */
export const DEFAULT_MAP_THEME: MapTheme = {
  padding: 24,
  river: "#1d4e6b",
  riverWidth: 6,
  nodeRadius: 6,
  incidentRadius: 9,
  nodeStroke: "#0b0f14",
  exitStroke: "#f2b134",
  incidentStroke: "#e8483f",
  markerWidth: 2.5,
  selectionStroke: "#e8f1ff",
  selectionWidth: 2,
  selectionGap: 4,
  blockedStroke: "#e8483f",
  blockedRadius: 3.5,
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

export type MapRendererProps = {
  readonly view: HunterView;
  readonly selection: MapSelection | null;
  readonly onSelect: (selection: MapSelection) => void;
  /** Drawn over the river and under the edges and nodes. PLAN M5.3b's heatmap goes here. */
  readonly overlay?: ReactNode;
  readonly theme?: MapTheme;
};

export const MAP_TEST_ID = "map";
export const MAP_NODE_TEST_ID = "map-node";
export const MAP_EDGE_TEST_ID = "map-edge";
export const MAP_RIVER_TEST_ID = "map-river";
export const MAP_SELECTION_TEST_ID = "map-selection";
export const MAP_OVERLAY_TEST_ID = "map-overlay";

const MAP_LABEL = "City map";
const TARGETS_LABEL = "Selectable map targets";
const NO_FILL = "none";
const NO_POINTER_EVENTS = "none";
const ROUND_CAP = "round";
const LABEL_SEPARATOR = " - ";
const INCIDENT_LABEL = "incident";
const EXIT_LABEL = "exit";

/** Keys that pick the focused node or edge, so the map is reachable without a pointer. */
const SELECT_KEYS: readonly string[] = ["Enter", " "];

/** A polyline needs two points; a river of fewer is a city with none. */
const RIVER_MIN_POINTS = 2;

/** Decimals kept on a coordinate. Positions are jittered floats; two is under a pixel at any zoom. */
const COORDINATE_DECIMALS = 2;

const MIDPOINT_FRACTION = 0.5;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
};

const coordinate = (value: number): number => Number(value.toFixed(COORDINATE_DECIMALS));

const leastOf = (values: readonly number[]): number =>
  values.reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY);

const greatestOf = (values: readonly number[]): number =>
  values.reduce((greatest, value) => Math.max(greatest, value), Number.NEGATIVE_INFINITY);

/**
 * Bounds over every drawn point, nodes and river alike, so a river that wanders past the outermost
 * node is not clipped. A map with nothing on it gets a padding-sized canvas rather than an
 * `Infinity` in the `viewBox`.
 */
const boundsOf = (points: readonly Position[], padding: number): Bounds => {
  if (points.length === 0) {
    return { minX: 0, minY: 0, width: padding + padding, height: padding + padding };
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

const viewBoxOf = (bounds: Bounds): string =>
  [bounds.minX, bounds.minY, bounds.width, bounds.height].map(coordinate).join(" ");

const exitIndex = (exits: readonly Exit[]): ReadonlyMap<NodeId, ExitKind> =>
  new Map(exits.map((exit) => [exit.nodeId, exit.kind]));

/** An edge naming a node the map does not contain is skipped rather than drawn to nowhere. */
type PlacedEdge = {
  readonly edge: MapEdge;
  readonly from: Position;
  readonly to: Position;
};

const placedEdges = (
  edges: readonly MapEdge[],
  positions: ReadonlyMap<NodeId, Position>,
): readonly PlacedEdge[] =>
  edges.flatMap((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from === undefined || to === undefined) return [];

    return [{ edge, from, to }];
  });

const onSelectKey = (event: KeyboardEvent<SVGGElement>, select: () => void): void => {
  if (!SELECT_KEYS.includes(event.key)) return;

  event.preventDefault();
  select();
};

const nodeStrokeOf = (theme: MapTheme, isIncident: boolean, isExit: boolean): string => {
  if (isIncident) return theme.incidentStroke;
  if (isExit) return theme.exitStroke;

  return theme.nodeStroke;
};

const nodeLabelOf = (
  node: MapNode,
  exitKind: ExitKind | undefined,
  isIncident: boolean,
): string => {
  const parts = [String(node.id), node.districtType];
  if (exitKind !== undefined) parts.push(`${EXIT_LABEL} ${exitKind}`);
  if (isIncident) parts.push(INCIDENT_LABEL);

  return parts.join(LABEL_SEPARATOR);
};

type MapEdgeLineProps = {
  readonly placed: PlacedEdge;
  readonly blocked: boolean;
  readonly selected: boolean;
  readonly theme: MapTheme;
  readonly onSelect: (selection: MapSelection) => void;
};

const MapEdgeLine = ({ placed, blocked, selected, theme, onSelect }: MapEdgeLineProps) => {
  const { edge, from, to } = placed;
  const style = theme.edges[edge.kind];
  const select = () => onSelect({ kind: "edge", edgeId: edge.id });

  return (
    <g
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`${edge.id}${LABEL_SEPARATOR}${edge.kind}`}
      data-testid={MAP_EDGE_TEST_ID}
      data-edgeid={edge.id}
      data-edgekind={edge.kind}
      data-blocked={blocked}
      data-selected={selected}
      onClick={select}
      onKeyDown={(event) => onSelectKey(event, select)}
    >
      <line
        x1={coordinate(from.x)}
        y1={coordinate(from.y)}
        x2={coordinate(to.x)}
        y2={coordinate(to.y)}
        stroke={selected ? theme.selectionStroke : style.stroke}
        strokeWidth={style.width}
        strokeDasharray={style.dash ?? undefined}
      />
      {blocked ? (
        <circle
          cx={coordinate((from.x + to.x) * MIDPOINT_FRACTION)}
          cy={coordinate((from.y + to.y) * MIDPOINT_FRACTION)}
          r={theme.blockedRadius}
          fill={theme.blockedStroke}
        />
      ) : null}
    </g>
  );
};

type MapNodeMarkerProps = {
  readonly node: MapNode;
  readonly exitKind: ExitKind | undefined;
  readonly isIncident: boolean;
  readonly selected: boolean;
  readonly theme: MapTheme;
  readonly onSelect: (selection: MapSelection) => void;
};

const MapNodeMarker = ({
  node,
  exitKind,
  isIncident,
  selected,
  theme,
  onSelect,
}: MapNodeMarkerProps) => {
  const radius = isIncident ? theme.incidentRadius : theme.nodeRadius;
  const select = () => onSelect({ kind: "node", nodeId: node.id });

  return (
    <g
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={nodeLabelOf(node, exitKind, isIncident)}
      data-testid={MAP_NODE_TEST_ID}
      data-nodeid={node.id}
      data-district={node.districtType}
      data-incident={isIncident}
      data-selected={selected}
      data-exit={exitKind}
      onClick={select}
      onKeyDown={(event) => onSelectKey(event, select)}
    >
      {selected ? (
        <circle
          data-testid={MAP_SELECTION_TEST_ID}
          cx={coordinate(node.position.x)}
          cy={coordinate(node.position.y)}
          r={radius + theme.selectionGap}
          fill={NO_FILL}
          stroke={theme.selectionStroke}
          strokeWidth={theme.selectionWidth}
        />
      ) : null}
      <circle
        cx={coordinate(node.position.x)}
        cy={coordinate(node.position.y)}
        r={radius}
        fill={theme.districts[node.districtType]}
        stroke={nodeStrokeOf(theme, isIncident, exitKind !== undefined)}
        strokeWidth={theme.markerWidth}
      />
    </g>
  );
};

const MapRiver = ({ river, theme }: { readonly river: River | null; readonly theme: MapTheme }) => {
  if (river === null || river.points.length < RIVER_MIN_POINTS) return null;

  return (
    <polyline
      data-testid={MAP_RIVER_TEST_ID}
      points={river.points
        .map((point) => `${coordinate(point.x)},${coordinate(point.y)}`)
        .join(" ")}
      fill={NO_FILL}
      stroke={theme.river}
      strokeWidth={theme.riverWidth}
      strokeLinecap={ROUND_CAP}
      strokeLinejoin={ROUND_CAP}
    />
  );
};

export const MapRenderer = ({
  view,
  selection,
  onSelect,
  overlay,
  theme = DEFAULT_MAP_THEME,
}: MapRendererProps) => {
  const { map } = view;
  const positions = positionIndexOf(map.nodes);
  const exits = exitIndex(map.exits);
  const blockedEdgeIds = blockedEdgeIdsAt(view.hunter.containments, view.clock.turn);
  const selectedNodeId = selection?.kind === "node" ? selection.nodeId : null;
  const selectedEdgeId = selection?.kind === "edge" ? selection.edgeId : null;
  const drawn = [...map.nodes.map((node) => node.position), ...(map.river?.points ?? [])];

  return (
    <svg
      aria-label={MAP_LABEL}
      data-testid={MAP_TEST_ID}
      viewBox={viewBoxOf(boundsOf(drawn, theme.padding))}
    >
      <MapRiver river={map.river} theme={theme} />
      <g data-testid={MAP_OVERLAY_TEST_ID} style={{ pointerEvents: NO_POINTER_EVENTS }}>
        {overlay}
      </g>
      <g role="listbox" aria-label={TARGETS_LABEL}>
        {placedEdges(map.edges, positions).map((placed) => (
          <MapEdgeLine
            key={placed.edge.id}
            placed={placed}
            blocked={blockedEdgeIds.has(placed.edge.id)}
            selected={placed.edge.id === selectedEdgeId}
            theme={theme}
            onSelect={onSelect}
          />
        ))}
        {map.nodes.map((node) => (
          <MapNodeMarker
            key={node.id}
            node={node}
            exitKind={exits.get(node.id)}
            isIncident={node.id === map.incidentNodeId}
            selected={node.id === selectedNodeId}
            theme={theme}
            onSelect={onSelect}
          />
        ))}
      </g>
    </svg>
  );
};
