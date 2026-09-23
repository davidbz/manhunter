/**
 * Recent reports pinned on the map (PLAN M6.6). `reportpins.ts` decides which pins there are; this
 * draws them, in a layer of their own after the nodes, so the pinned river -> overlay -> edges ->
 * nodes order is untouched. The layer takes no pointer events, inline like the exit gates and
 * incidents, so a pin standing over a node never swallows the click that selects it.
 *
 * A pin stands with its tip on the top edge of the node's pip rather than on the node itself, so
 * the district glyph stays readable under it. The kinds differ by mark shape as well as by hue - a
 * sighting carries a filled red dot (a claim about the criminal, DESIGN.md's red), a clearance a
 * muted bar - so the distinction survives a reader who cannot separate the hues.
 *
 * Age is drawn by the stylesheet, keyed on `data-staleness` (the feed's own tiers), so the fade is
 * a token rather than a number here.
 */

import type { NodeId, Position, Turn } from "@manhunter/core";
import type { FeedRowTheme } from "./feedrow";
import { glyphTransformOf } from "./mapactors";
import { MIDPOINT_FRACTION } from "./mapgeometry";
import type { ReportPin, ReportPinKind, ReportPinSet } from "./reportpins";

/** How one kind of pin is drawn. `mark` is path data on the glyph box, filled or stroked. */
export type ReportPinKindStyle = {
  readonly stroke: string;
  readonly mark: string;
  readonly markFill: string;
  readonly markStroke: string;
};

/**
 * A pin is `outline` and a kind's `mark`, both path data on a `glyphBox`-unit square whose bottom
 * centre is the tip, scaled to `size`. Stroke widths are in glyph units, as the pips' are.
 */
export type MapReportPinStyle = {
  readonly size: number;
  /** How far above the node's centre the tip stands: the pip's half-height. */
  readonly lift: number;
  readonly glyphBox: number;
  readonly outline: string;
  readonly plate: string;
  readonly strokeWidth: number;
  readonly markWidth: number;
  readonly kinds: Readonly<Record<ReportPinKind, ReportPinKindStyle>>;
  /** A report observed more than this many turns ago is no longer pinned. */
  readonly maxAge: number;
  /** The feed's age tiers, so a pin and its feed row agree on staleness. */
  readonly staleness: FeedRowTheme;
};

export const MAP_REPORT_PINS_TEST_ID = "map-report-pins";
export const MAP_REPORT_PIN_TEST_ID = "map-report-pin";

export const REPORT_PIN_CLASS = "mh-map-pin";

const NO_POINTER_EVENTS = "none";
const ROUND = "round";
const NO_INSET = 0;

type ReportPinGlyphProps = {
  readonly kind: ReportPinKind;
  readonly style: MapReportPinStyle;
  readonly transform?: string;
};

/** The pin shape alone, in glyph units. The map places it; the legend draws it as a swatch. */
export const ReportPinGlyph = ({ kind, style, transform }: ReportPinGlyphProps) => {
  const look = style.kinds[kind];

  return (
    <g transform={transform}>
      <path
        d={style.outline}
        fill={style.plate}
        stroke={look.stroke}
        strokeWidth={style.strokeWidth}
        strokeLinejoin={ROUND}
      />
      <path
        d={look.mark}
        fill={look.markFill}
        stroke={look.markStroke}
        strokeWidth={style.markWidth}
        strokeLinecap={ROUND}
      />
    </g>
  );
};

/** The top-left corner of the pin's box, placed so its tip lands `lift` above `position`. */
const pinCornerOf = (position: Position, style: MapReportPinStyle): Position => ({
  x: position.x - style.size * MIDPOINT_FRACTION,
  y: position.y - style.lift - style.size,
});

type MapReportPinProps = {
  readonly pin: ReportPin;
  /** A report at this pin's node landed this turn, the feed's `data-new`. */
  readonly arrived: boolean;
  readonly position: Position;
  readonly style: MapReportPinStyle;
};

const MapReportPin = ({ pin, arrived, position, style }: MapReportPinProps) => (
  <g
    className={REPORT_PIN_CLASS}
    data-testid={MAP_REPORT_PIN_TEST_ID}
    data-nodeid={pin.nodeId}
    data-kind={pin.kind}
    data-source={pin.source}
    data-count={pin.count}
    data-age={pin.age}
    data-staleness={pin.staleness}
    data-new={arrived}
  >
    <ReportPinGlyph
      kind={pin.kind}
      style={style}
      transform={glyphTransformOf(
        pinCornerOf(position, style),
        style.size,
        NO_INSET,
        style.glyphBox,
      )}
    />
  </g>
);

type MapReportPinsProps = {
  readonly pinSet: ReportPinSet;
  /** `lastHeardByNodeOf` over the same reports, and the turn it is now. */
  readonly lastHeard: ReadonlyMap<NodeId, Turn>;
  readonly currentTurn: Turn;
  readonly positions: ReadonlyMap<NodeId, Position>;
  readonly style: MapReportPinStyle;
};

/** Omitted when nothing recent has been reported, the way the incident layer is. */
/**
 * Each pin is keyed by its node and the turn that node last heard a report, so a report landing
 * where a pin already stands is a new element to React and the report-arrival motion replays on
 * it (PLAN M6.10), while a pin that only aged keeps its element and does not move.
 */
export const MapReportPins = ({
  pinSet,
  lastHeard,
  currentTurn,
  positions,
  style,
}: MapReportPinsProps) => {
  if (pinSet.pins.length === 0) return null;

  return (
    <g
      data-testid={MAP_REPORT_PINS_TEST_ID}
      data-withheld={pinSet.withheld}
      style={{ pointerEvents: NO_POINTER_EVENTS }}
    >
      {pinSet.pins.flatMap((pin) => {
        const position = positions.get(pin.nodeId);
        if (position === undefined) return [];

        const heard = lastHeard.get(pin.nodeId);

        return [
          <MapReportPin
            key={`${pin.nodeId}-${heard}`}
            pin={pin}
            arrived={heard === currentTurn}
            position={position}
            style={style}
          />,
        ];
      })}
    </g>
  );
};
