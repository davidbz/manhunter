/**
 * The map's key (PLAN M6.6): what the belief field's ramp runs between, what the contour marks, and
 * what the two report pins mean. A strip under the map rather than a panel over it, so it covers
 * no node and needs no pointer rules.
 *
 * Every swatch is drawn from the same tables the map draws with - `HEAT_RAMP`, `BELIEF_FIELD` and
 * the map theme's `reportPin`, through `ReportPinGlyph` - so the key cannot show a colour or a
 * shape the map does not. It is presentational and reads no store: it says what the marks mean,
 * not where any of them are. The text equivalent of the heatmap's content is `heatmapsummary.ts`.
 */

import type { HeatRamp } from "./beliefoverlay";
import { type BeliefFieldTheme, DEFAULT_BELIEF_FIELD, DEFAULT_HEAT_RAMP } from "./beliefoverlay";
import { type MapReportPinStyle, ReportPinGlyph } from "./mapreportpins";
import { REPORT_PIN_KINDS, type ReportPinKind } from "./reportpins";
import { BELIEF_LEGEND, MAP_THEME } from "./theme";

/** The ramp and contour swatches' drawing box, in swatch units. */
export type BeliefLegendTheme = {
  readonly swatchWidth: number;
  readonly swatchHeight: number;
};

export type BeliefLegendProps = {
  readonly ramp?: HeatRamp;
  readonly field?: BeliefFieldTheme;
  readonly pin?: MapReportPinStyle;
  readonly theme?: BeliefLegendTheme;
};

export const BELIEF_LEGEND_TEST_ID = "belief-legend";
export const BELIEF_LEGEND_ITEM_TEST_ID = "belief-legend-item";

const LEGEND_LABEL = "Map legend";
const RAMP_GRADIENT_ID = "belief-legend-ramp";
const RAMP_LABEL = "Suspicion, faint to peak";
const SIGHTING_LABEL = "Sighting reported";
const CLEARANCE_LABEL = "Nothing seen";
const PERCENT = 100;
const ORIGIN = 0;
const GRADIENT_START = 0;
const GRADIENT_END = 1;
const MIDLINE_FRACTION = 0.5;

const PIN_LABELS: Readonly<Record<ReportPinKind, string>> = {
  sighting: SIGHTING_LABEL,
  no_sighting: CLEARANCE_LABEL,
};

export const contourLabelOf = (contourFrom: number): string =>
  `Top tier: ${Math.round(contourFrom * PERCENT)}% of peak or more`;

export const pinAgeLabelOf = (maxAge: number): string => `Pins fade, gone after ${maxAge} turns`;

const swatchBoxOf = (theme: BeliefLegendTheme): string =>
  `${ORIGIN} ${ORIGIN} ${theme.swatchWidth} ${theme.swatchHeight}`;

type SwatchProps = {
  readonly ramp: HeatRamp;
  readonly field: BeliefFieldTheme;
  readonly theme: BeliefLegendTheme;
};

const RampSwatch = ({ ramp, theme }: SwatchProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    className="mh-map-legend__ramp"
    viewBox={swatchBoxOf(theme)}
    preserveAspectRatio="none"
  >
    <defs>
      <linearGradient id={RAMP_GRADIENT_ID}>
        <stop offset={GRADIENT_START} stopColor={ramp.fill} stopOpacity={ramp.minOpacity} />
        <stop offset={GRADIENT_END} stopColor={ramp.fill} stopOpacity={ramp.maxOpacity} />
      </linearGradient>
    </defs>
    <rect
      width={theme.swatchWidth}
      height={theme.swatchHeight}
      fill={`url(#${RAMP_GRADIENT_ID})`}
    />
  </svg>
);

const ContourSwatch = ({ field, theme }: SwatchProps) => {
  const midline = `M${ORIGIN} ${theme.swatchHeight * MIDLINE_FRACTION} H${theme.swatchWidth}`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="mh-map-legend__ramp"
      viewBox={swatchBoxOf(theme)}
      preserveAspectRatio="none"
    >
      <path d={midline} stroke={field.contourCasing} strokeWidth={field.contourCasingWidth} />
      <path
        d={midline}
        stroke={field.contourStroke}
        strokeWidth={field.contourWidth}
        strokeDasharray={field.contourDash}
      />
    </svg>
  );
};

const PinSwatch = ({
  kind,
  pin,
}: {
  readonly kind: ReportPinKind;
  readonly pin: MapReportPinStyle;
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    className="mh-map-legend__pin"
    viewBox={`${ORIGIN} ${ORIGIN} ${pin.glyphBox} ${pin.glyphBox}`}
  >
    <ReportPinGlyph kind={kind} style={pin} />
  </svg>
);

export const BeliefLegend = ({
  ramp = DEFAULT_HEAT_RAMP,
  field = DEFAULT_BELIEF_FIELD,
  pin = MAP_THEME.reportPin,
  theme = BELIEF_LEGEND,
}: BeliefLegendProps) => (
  <ul aria-label={LEGEND_LABEL} className="mh-map-legend" data-testid={BELIEF_LEGEND_TEST_ID}>
    <li className="mh-map-legend__item" data-testid={BELIEF_LEGEND_ITEM_TEST_ID} data-item="ramp">
      <RampSwatch ramp={ramp} field={field} theme={theme} />
      {RAMP_LABEL}
    </li>
    <li
      className="mh-map-legend__item"
      data-testid={BELIEF_LEGEND_ITEM_TEST_ID}
      data-item="contour"
    >
      <ContourSwatch ramp={ramp} field={field} theme={theme} />
      {contourLabelOf(field.contourFrom)}
    </li>
    {REPORT_PIN_KINDS.map((kind) => (
      <li
        key={kind}
        className="mh-map-legend__item"
        data-testid={BELIEF_LEGEND_ITEM_TEST_ID}
        data-item={kind}
      >
        <PinSwatch kind={kind} pin={pin} />
        {PIN_LABELS[kind]}
      </li>
    ))}
    <li className="mh-map-legend__item" data-testid={BELIEF_LEGEND_ITEM_TEST_ID} data-item="age">
      {pinAgeLabelOf(pin.maxAge)}
    </li>
  </ul>
);
