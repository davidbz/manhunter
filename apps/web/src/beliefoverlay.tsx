/**
 * The heatmap (PLAN M5.3b, DESIGN.md "Probability heatmap"): where the hunter thinks the criminal
 * is, drawn over the city and under the nodes and edges.
 *
 * It is a pure render of `HunterView.belief`, which PLAN M3.6b made state the world carries and
 * M3.8a advances once per turn ("Decisions": where the belief distribution lives). There is no
 * distribution to accumulate here and no history to keep - the overlay draws the field the store
 * already holds, and holds nothing itself.
 *
 * It draws into the layer `maprenderer.tsx` opens for it, which already takes no pointer events,
 * so heat under a node cannot swallow the click that selects it.
 *
 * **The ramp is normalised against the busiest node, not against probability 1.** A hunt's mass
 * is spread over tens of nodes, so the strongest cell on a 48-node map is rarely above a few per
 * cent and a ramp keyed to absolute probability would render a map of near-invisible dots. Peak
 * normalisation costs the reading "how sure is the hunter overall", which no pixel could carry
 * legibly anyway, and buys the one the player acts on: which node is the best guess right now.
 * Nothing but zero is invisible - the faintest live cell still renders at `minOpacity`.
 *
 * `heatOf` is the whole of the mapping and it is a pure function of ramp, mass and peak, so what
 * a probability becomes can be asserted directly rather than fished out of the SVG (AGENTS.md
 * "Testing expectations": do not snapshot-test the SVG).
 *
 * **PLAN M6.6 made the drawing a field; the mapping is unchanged.** Each blob is filled with one
 * shared radial gradient that fades to nothing at its rim, and the blobs blend additively with
 * each other (`mix-blend-mode: plus-lighter` inside an isolated group, in `index.css`), so two
 * suspected neighbours run together into one hot region instead of stacking translucent discs. The
 * blend is isolated to the blobs, so the map beneath is never lightened by it. Over the field a
 * threshold contour outlines the top tier: every node at or over `contourFrom` of the peak, drawn
 * as the outline of those nodes' district cells (`beliefcontour.ts`), the same cells the blocks
 * are cut from, so the line runs along the streets.
 *
 * Colours and measurements are tables passed in rather than captured, the way
 * `DEFAULT_MAP_THEME` is. The values are `theme.ts`'s `HEAT_RAMP` (PLAN M5.7) and `BELIEF_FIELD`
 * (PLAN M6.6); this file keeps only the types, which are the overlay's own contract.
 */

import {
  BELIEF_MASS_TOLERANCE,
  type Belief,
  type BeliefCell,
  type MapNode,
  type NodeId,
  type Position,
} from "@manhunter/core";
import { contourOf } from "./beliefcontour";
import { type CellBounds, districtCellsOf, paddedBoundsOf } from "./districtcells";
import { segmentPathOf } from "./mapgeometry";
import { positionIndexOf } from "./mapnodes";
import { BELIEF_FIELD, HEAT_RAMP } from "./theme";

/** How a normalised belief mass is turned into a blob. Both ends are drawn, neither is a default. */
export type HeatRamp = {
  readonly fill: string;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly minOpacity: number;
  readonly maxOpacity: number;
};

/** The red of DESIGN.md "Visual direction", shared with the incident marker, from `theme.ts`. */
export const DEFAULT_HEAT_RAMP: HeatRamp = HEAT_RAMP;

/** One node's worth of heat, ready to draw. `intensity` is the mass as a fraction of the peak. */
export type Heat = {
  readonly intensity: number;
  readonly radius: number;
  readonly opacity: number;
};

/** A node the map places, the heat it carries, and nothing else. */
export type BeliefHeat = {
  readonly nodeId: NodeId;
  readonly position: Position;
  readonly heat: Heat;
};

/** One stop of the blob gradient: `offset` from the centre (0) to the rim (1), and its opacity. */
export type BeliefFieldStop = {
  readonly offset: number;
  readonly opacity: number;
};

/**
 * How the field is drawn beyond the ramp (PLAN M6.6): the blob's gradient, and the contour round
 * the top tier. `padding` is only for a caller that passes no plate bounds, and is the map's own.
 */
export type BeliefFieldTheme = {
  readonly stops: readonly BeliefFieldStop[];
  /** A node at or over this fraction of the peak is in the top tier the contour outlines. */
  readonly contourFrom: number;
  readonly contourStroke: string;
  readonly contourWidth: number;
  readonly contourDash: string;
  readonly contourCasing: string;
  readonly contourCasingWidth: number;
  readonly padding: number;
};

export const DEFAULT_BELIEF_FIELD: BeliefFieldTheme = BELIEF_FIELD;

export type BeliefOverlayProps = {
  readonly belief: Belief;
  readonly nodes: readonly MapNode[];
  readonly ramp?: HeatRamp;
  /**
   * The map's plate (`mapgeometry.ts`'s `plateBoundsOf`), which the contour's cells are clipped
   * from. Absent, the nodes alone are padded, which differs only along the plate's outer edge.
   */
  readonly bounds?: CellBounds;
  readonly field?: BeliefFieldTheme;
};

export const BELIEF_OVERLAY_TEST_ID = "belief-overlay";
export const BELIEF_HEAT_TEST_ID = "belief-heat";
export const BELIEF_CONTOUR_TEST_ID = "belief-contour";

/** The one gradient every blob is filled with. Exported so tests read the same id. */
export const BELIEF_FIELD_GRADIENT_ID = "belief-field-gradient";

/** Class names `index.css` keys the additive blend on. */
export const BELIEF_FIELD_CLASSES = {
  blobs: "mh-belief-field",
  blob: "mh-belief-field__blob",
  contour: "mh-belief-contour",
} as const;

const NO_HEAT = 0;
const FULL_HEAT = 1;
const NO_FILL = "none";
const ROUND = "round";

/** Decimals kept on a rendered number, for the reason `maprenderer.tsx` rounds coordinates. */
const HEAT_DECIMALS = 3;

const rounded = (value: number): number => Number(value.toFixed(HEAT_DECIMALS));

const between = (least: number, greatest: number, at: number): number =>
  least + (greatest - least) * at;

/**
 * What a probability becomes. `null` is "draw nothing": a node the hunter does not suspect at all
 * gets no element, rather than a transparent one that would still be in the DOM and still be over
 * the node. Mass is compared against `BELIEF_MASS_TOLERANCE` and not against zero, because the
 * distribution is normalised by division and an emptied cell lands near zero, not on it.
 */
export const heatOf = (ramp: HeatRamp, mass: number, peak: number): Heat | null => {
  if (mass <= BELIEF_MASS_TOLERANCE) return null;
  if (peak <= BELIEF_MASS_TOLERANCE) return null;

  const intensity = Math.min(mass / peak, FULL_HEAT);

  return {
    intensity: rounded(intensity),
    radius: rounded(between(ramp.minRadius, ramp.maxRadius, intensity)),
    opacity: rounded(between(ramp.minOpacity, ramp.maxOpacity, intensity)),
  };
};

/** The busiest cell, which is what the ramp is keyed to. An empty distribution peaks at nothing. */
export const peakBeliefMass = (cells: readonly BeliefCell[]): number =>
  cells.reduce((peak, cell) => Math.max(peak, cell.mass), NO_HEAT);

type PlacedCell = {
  readonly cell: BeliefCell;
  readonly position: Position;
};

/**
 * A cell naming a node the map does not have is dropped rather than drawn at the origin, and it
 * is dropped before the peak is taken, so a stale cell cannot dim every node that is on the map.
 */
const placedCells = (
  belief: Belief,
  positions: ReadonlyMap<NodeId, Position>,
): readonly PlacedCell[] =>
  belief.flatMap((cell) => {
    const position = positions.get(cell.nodeId);
    if (position === undefined) return [];

    return [{ cell, position }];
  });

export const beliefHeatOf = (
  belief: Belief,
  nodes: readonly MapNode[],
  ramp: HeatRamp,
): readonly BeliefHeat[] => {
  const placed = placedCells(belief, positionIndexOf(nodes));
  const peak = peakBeliefMass(placed.map((each) => each.cell));

  return placed.flatMap(({ cell, position }) => {
    const heat = heatOf(ramp, cell.mass, peak);
    if (heat === null) return [];

    return [{ nodeId: cell.nodeId, position, heat }];
  });
};

/** The nodes the contour outlines: every one drawn at or over `contourFrom` of the peak. */
export const topTierOf = (heats: readonly BeliefHeat[], contourFrom: number): ReadonlySet<NodeId> =>
  new Set(heats.filter((each) => each.heat.intensity >= contourFrom).map((each) => each.nodeId));

const BeliefFieldGradient = ({
  ramp,
  field,
}: {
  readonly ramp: HeatRamp;
  readonly field: BeliefFieldTheme;
}) => (
  <defs>
    <radialGradient id={BELIEF_FIELD_GRADIENT_ID}>
      {field.stops.map((stop) => (
        <stop
          key={stop.offset}
          offset={stop.offset}
          stopColor={ramp.fill}
          stopOpacity={stop.opacity}
        />
      ))}
    </radialGradient>
  </defs>
);

type BeliefContourProps = {
  readonly nodes: readonly MapNode[];
  readonly bounds: CellBounds;
  readonly topTier: ReadonlySet<NodeId>;
  readonly field: BeliefFieldTheme;
};

/**
 * The outline of the top tier, a dark casing under a dashed red line so it reads over the blocks
 * and the heat alike. A node list over the cell cap draws no contour rather than throwing.
 */
const BeliefContour = ({ nodes, bounds, topTier, field }: BeliefContourProps) => {
  const cells = districtCellsOf(nodes, bounds);
  if (cells.kind !== "cells") return null;
  const segments = contourOf(cells.cells, topTier);
  if (segments.length === 0) return null;
  const outline = segments.map((segment) => segmentPathOf(segment.from, segment.to)).join(" ");

  return (
    <g
      data-testid={BELIEF_CONTOUR_TEST_ID}
      data-nodeids={[...topTier].join(" ")}
      className={BELIEF_FIELD_CLASSES.contour}
      fill={NO_FILL}
      strokeLinecap={ROUND}
    >
      <path d={outline} stroke={field.contourCasing} strokeWidth={field.contourCasingWidth} />
      <path
        d={outline}
        stroke={field.contourStroke}
        strokeWidth={field.contourWidth}
        strokeDasharray={field.contourDash}
      />
    </g>
  );
};

/**
 * Unlabelled shapes, so the heat adds nothing to the accessibility tree: every blob restates a
 * node the marker layer already names. The reading itself is read out by `heatmapsummary.ts`.
 */
export const BeliefOverlay = ({
  belief,
  nodes,
  ramp = DEFAULT_HEAT_RAMP,
  bounds,
  field = DEFAULT_BELIEF_FIELD,
}: BeliefOverlayProps) => {
  const heats = beliefHeatOf(belief, nodes, ramp);
  if (heats.length === 0) return null;
  const topTier = topTierOf(heats, field.contourFrom);
  const plate =
    bounds ??
    paddedBoundsOf(
      nodes.map((each) => each.position),
      field.padding,
    );

  return (
    <g data-testid={BELIEF_OVERLAY_TEST_ID}>
      <BeliefFieldGradient ramp={ramp} field={field} />
      <g className={BELIEF_FIELD_CLASSES.blobs}>
        {heats.map(({ nodeId, position, heat }) => (
          <circle
            key={nodeId}
            className={BELIEF_FIELD_CLASSES.blob}
            data-testid={BELIEF_HEAT_TEST_ID}
            data-nodeid={nodeId}
            data-intensity={heat.intensity}
            data-top-tier={topTier.has(nodeId)}
            cx={rounded(position.x)}
            cy={rounded(position.y)}
            r={heat.radius}
            fill={`url(#${BELIEF_FIELD_GRADIENT_ID})`}
            fillOpacity={heat.opacity}
          />
        ))}
      </g>
      <BeliefContour nodes={nodes} bounds={plate} topTier={topTier} field={field} />
    </g>
  );
};
