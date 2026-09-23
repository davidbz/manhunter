/**
 * The street map's index (PLAN M7.1): every avenue named along the plate's top margin over its
 * column, and every street along the left margin beside its row, muted and in the display face.
 *
 * The layer sits after the blocks and the wash and before `map-river`, so the pinned river ->
 * overlay -> edges -> nodes order is untouched and night never dims the index. It takes no pointer
 * events, and it is hidden from assistive technology because every node's own label already names
 * its crossing; read aloud, the index would be a second copy of the same words.
 */

import type { CellBounds } from "./districtcells";
import { coordinate } from "./mapgeometry";
import type { PlaceNames, StreetLine } from "./placenames";

export type MapStreetLabelStyle = {
  readonly fill: string;
  readonly fontFamily: string;
  readonly fontSize: number;
  /** Distance from the plate's edge to the label's near side, in map units. */
  readonly inset: number;
  readonly letterSpacing: number;
};

export const MAP_STREET_LABELS_TEST_ID = "map-street-labels";
export const MAP_STREET_LABEL_TEST_ID = "map-street-label";

/** Which margin a label sits in; exported so tests name the same strings. */
export const STREET_LABEL_AXES = {
  avenue: "avenue",
  street: "street",
} as const;

const NO_POINTER_EVENTS = "none";
const MIDDLE_ANCHOR = "middle";
const HANGING_BASELINE = "hanging";
const ARIA_HIDDEN = true;

/** A street label reads bottom to top, up the left margin. */
const LEFT_MARGIN_TURN_DEGREES = -90;

type LabelProps = {
  readonly line: StreetLine;
  readonly bounds: CellBounds;
  readonly style: MapStreetLabelStyle;
};

const AvenueLabel = ({ line, bounds, style }: LabelProps) => (
  <text
    data-testid={MAP_STREET_LABEL_TEST_ID}
    data-axis={STREET_LABEL_AXES.avenue}
    data-index={line.index}
    x={coordinate(line.at)}
    y={coordinate(bounds.minY + style.inset)}
    textAnchor={MIDDLE_ANCHOR}
    dominantBaseline={HANGING_BASELINE}
  >
    {line.name}
  </text>
);

const StreetLabel = ({ line, bounds, style }: LabelProps) => {
  const x = coordinate(bounds.minX + style.inset);
  const y = coordinate(line.at);

  return (
    <text
      data-testid={MAP_STREET_LABEL_TEST_ID}
      data-axis={STREET_LABEL_AXES.street}
      data-index={line.index}
      x={x}
      y={y}
      transform={`rotate(${LEFT_MARGIN_TURN_DEGREES} ${x} ${y})`}
      textAnchor={MIDDLE_ANCHOR}
      dominantBaseline={HANGING_BASELINE}
    >
      {line.name}
    </text>
  );
};

export type MapStreetLabelsProps = {
  readonly names: PlaceNames;
  readonly bounds: CellBounds;
  readonly style: MapStreetLabelStyle;
};

export const MapStreetLabels = ({ names, bounds, style }: MapStreetLabelsProps) => (
  <g
    data-testid={MAP_STREET_LABELS_TEST_ID}
    aria-hidden={ARIA_HIDDEN}
    fill={style.fill}
    fontFamily={style.fontFamily}
    fontSize={style.fontSize}
    letterSpacing={style.letterSpacing}
    style={{ pointerEvents: NO_POINTER_EVENTS }}
  >
    {names.avenues.map((line) => (
      <AvenueLabel key={line.index} line={line} bounds={bounds} style={style} />
    ))}
    {names.streets.map((line) => (
      <StreetLabel key={line.index} line={line} bounds={bounds} style={style} />
    ))}
  </g>
);
