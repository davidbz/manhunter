/**
 * The five numbers the hunter is playing against (PLAN M5.4): action points, budget, public
 * trust, political pressure and the clock. The set is settled - it is the `HunterState` M1.2
 * fixed, plus the clock - and there is no fatigue meter, because no MVP action deploys a unit and
 * DESIGN.md lists it out of scope. Pressure is display-only: M3.8a's consequences phase raises
 * it, and nothing in the MVP reads it back.
 *
 * Presentational and controlled, like `maprenderer.tsx`. The **bounds arrive as data**, never as
 * literals: a meter's maximum is a balance knob (`balance.hunter`), so this file must not know
 * that trust runs to 100 - `meterspanel.tsx` reads it off the store and passes it in. The clock is
 * the one meter whose range is the hunt's rather than the balance's, and it comes from the view:
 * `clock.turn` elapsed out of `clock.turn + turnsRemaining`.
 *
 * `metersOf` is the whole of the derivation, and it is a pure function from view plus bounds to a
 * list of `Meter` data. The component only draws what it returns, so what is shown and how it is
 * shown can be tested apart.
 *
 * **Each meter the plan moves shows a forecast (PLAN M7.4).** `remaining` is what the queued plan
 * leaves (`actionqueue.ts`'s `remainingAfter`); a meter it moves reads "now -> after" and draws a
 * hatched segment over the stretch of bar the plan spends or gains. Action points, budget and
 * trust move; pressure and the clock do not, because nothing the hunter queues moves them. The
 * bar and `data-value` stay on the current value: the forecast is what End Turn would do, not what
 * the hunter holds, and `turn.spec.ts` reads the clock off `data-value`.
 */

import type { Hour, HunterView } from "@manhunter/core";
import type { CSSProperties } from "react";
import type { PlanResources } from "./plancost";
import { METER_THEME, PALETTE } from "./theme";

/**
 * Declared as data so the list and the type cannot drift, and so a test can assert that every
 * kind reaches the DOM - the same guard PLAN M5.6a puts on score components.
 */
export const METER_KINDS = ["action_points", "budget", "trust", "pressure", "clock"] as const;

export type MeterKind = (typeof METER_KINDS)[number];

/**
 * How a meter is cut into segments (PLAN M6.8). A `unit` meter counts whole things - action
 * points, turns - so it gets one segment per unit and a player can count what is left; a `scaled`
 * meter is a quantity with a large range and gets the stylesheet's fixed count instead.
 */
export type MeterSegmenting = "unit" | "scaled";

export const METER_SEGMENTING: Readonly<Record<MeterKind, MeterSegmenting>> = {
  action_points: "unit",
  budget: "scaled",
  trust: "scaled",
  pressure: "scaled",
  clock: "unit",
};

export type MeterTheme = {
  /** The most segments a `unit` meter is drawn with; a wider range falls back to `scaled`. */
  readonly maxUnitSegments: number;
};

/**
 * Which of the plan's resources each meter reads, or `null` for a meter no order moves. A table
 * rather than a branch, so a new meter kind is a compile error here until it says.
 */
export const METER_PLANNED_RESOURCE: Readonly<Record<MeterKind, keyof PlanResources | null>> = {
  action_points: "actionPoints",
  budget: "budget",
  trust: "trust",
  pressure: null,
  clock: null,
};

/**
 * One meter, ready to draw. `display` is the reading; `value`, `min` and `max` are the bar.
 * `segments` is the unit count a `unit` meter is cut into, or `null` for the stylesheet default.
 * `forecast` is what the plan leaves the meter at, or `null` when the plan does not move it.
 */
export type Meter = {
  readonly kind: MeterKind;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly display: string;
  readonly segments: number | null;
  readonly forecast: number | null;
};

type MeterReading = Omit<Meter, "segments" | "forecast">;

/** Whether the plan spends from a meter or adds to it, which the hatch is drawn in. */
export type ForecastDirection = "spend" | "gain";

/**
 * The stretch of bar the plan moves, as fractions of the bar from its left end. A plan that
 * overspends is drawn to the end of the bar, not past it; the reading still says how far over.
 */
export type ForecastSpan = {
  readonly from: number;
  readonly to: number;
  readonly direction: ForecastDirection;
};

/**
 * The part of `balance.hunter` the meters are scaled by. Structural rather than `Balance` itself,
 * for the reason `TrustBounds` in `core/src/hunter.ts` is: it names exactly what is read.
 */
export type MeterBounds = {
  readonly actionPointsPerTurn: number;
  readonly startingBudget: number;
  readonly trustMin: number;
  readonly trustMax: number;
  readonly pressureMin: number;
  readonly pressureMax: number;
};

export type MetersProps = {
  readonly view: HunterView;
  readonly bounds: MeterBounds;
  /** What the queued plan leaves (PLAN M7.4). Without one, nothing is planned. */
  readonly remaining?: PlanResources;
};

export const METERS_TEST_ID = "meters";
export const METER_TEST_ID = "meter";
export const METER_VALUE_TEST_ID = "meter-value";
export const METER_FORECAST_TEST_ID = "meter-forecast";

/** Every word the meters say, in one table, for the reason `REPORT_SOURCE_LABELS` is one. */
export const METER_LABELS: Readonly<Record<MeterKind, string>> = {
  action_points: "Action points",
  budget: "Budget",
  trust: "Public trust",
  pressure: "Political pressure",
  clock: "Clock",
};

const METERS_LABEL = "Hunter meters";
const METERS_TITLE = "Status";
const OF_SEPARATOR = " of ";
const CLOCK_SEPARATOR = " - turn ";
const REMAINING_SUFFIX = " left";
const TURNS_REMAINING_SEPARATOR = ", ";
const HOUR_DIGITS = 2;
const HOUR_PAD = "0";
const ON_THE_HOUR = ":00";

const FORECAST_ARROW = " -> ";

const NONE = 0;
const WHOLE = 1;

export const hourLabel = (hour: Hour): string =>
  `${String(hour).padStart(HOUR_DIGITS, HOUR_PAD)}${ON_THE_HOUR}`;

/** A value, or the value and where the plan takes it: "1000 -> 850". The rail reads it too. */
export const forecastReading = (value: number, forecast: number | null): string =>
  forecast === null ? String(value) : `${value}${FORECAST_ARROW}${forecast}`;

const outOf = (value: number | string, maximum: number): string =>
  `${value}${OF_SEPARATOR}${maximum}`;

/**
 * The clock reads as a wall hour and a deadline at once, because DESIGN.md's pressure is both:
 * one turn is one in-game hour, and a hunt has at most a day of them.
 */
const clockDisplay = (view: HunterView, totalTurns: number): string =>
  [
    hourLabel(view.clock.hour),
    CLOCK_SEPARATOR,
    outOf(view.clock.turn, totalTurns),
    TURNS_REMAINING_SEPARATOR,
    view.turnsRemaining,
    REMAINING_SUFFIX,
  ].join("");

/** One segment per unit, while that stays countable; otherwise the stylesheet's default. */
export const segmentsOf = (reading: MeterReading, theme: MeterTheme): number | null => {
  if (METER_SEGMENTING[reading.kind] === "scaled") return null;

  const span = reading.max - reading.min;
  if (span < 1 || span > theme.maxUnitSegments) return null;

  return span;
};

const readingsOf = (view: HunterView, bounds: MeterBounds): readonly MeterReading[] => {
  const { hunter, clock } = view;
  const totalTurns = clock.turn + view.turnsRemaining;

  return [
    {
      kind: "action_points",
      label: METER_LABELS.action_points,
      value: hunter.actionPoints,
      min: NONE,
      max: bounds.actionPointsPerTurn,
      display: outOf(hunter.actionPoints, bounds.actionPointsPerTurn),
    },
    {
      kind: "budget",
      label: METER_LABELS.budget,
      value: hunter.budget,
      min: NONE,
      max: bounds.startingBudget,
      display: outOf(hunter.budget, bounds.startingBudget),
    },
    {
      kind: "trust",
      label: METER_LABELS.trust,
      value: hunter.trust,
      min: bounds.trustMin,
      max: bounds.trustMax,
      display: outOf(hunter.trust, bounds.trustMax),
    },
    {
      kind: "pressure",
      label: METER_LABELS.pressure,
      value: hunter.pressure,
      min: bounds.pressureMin,
      max: bounds.pressureMax,
      display: outOf(hunter.pressure, bounds.pressureMax),
    },
    {
      kind: "clock",
      label: METER_LABELS.clock,
      value: clock.turn,
      min: NONE,
      max: totalTurns,
      display: clockDisplay(view, totalTurns),
    },
  ];
};

/** Where the plan leaves a meter, or `null` when no order moves it or the plan leaves it level. */
export const forecastOf = (reading: MeterReading, remaining: PlanResources): number | null => {
  const resource = METER_PLANNED_RESOURCE[reading.kind];
  if (resource === null) return null;

  const after = remaining[resource];
  return after === reading.value ? null : after;
};

const displayOf = (reading: MeterReading, forecast: number | null): string =>
  forecast === null
    ? reading.display
    : outOf(forecastReading(reading.value, forecast), reading.max);

export const metersOf = (
  view: HunterView,
  bounds: MeterBounds,
  remaining: PlanResources = view.hunter,
  theme: MeterTheme = METER_THEME,
): readonly Meter[] =>
  readingsOf(view, bounds).map((reading) => {
    const forecast = forecastOf(reading, remaining);

    return {
      ...reading,
      display: displayOf(reading, forecast),
      segments: segmentsOf(reading, theme),
      forecast,
    };
  });

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

/** The hatched stretch of a meter's bar, or `null` when there is no forecast or no bar to mark. */
export const forecastSpanOf = (meter: Meter): ForecastSpan | null => {
  if (meter.forecast === null) return null;

  const span = meter.max - meter.min;
  if (span <= NONE) return null;

  const fractionOf = (value: number): number => clamp((value - meter.min) / span, NONE, WHOLE);
  const now = fractionOf(meter.value);
  const after = fractionOf(meter.forecast);

  return {
    from: Math.min(now, after),
    to: Math.max(now, after),
    direction: meter.forecast < meter.value ? "spend" : "gain",
  };
};

/**
 * `index.css` reads the segment count from this custom property; `theme.ts` publishes its default
 * on the root, and a `unit` meter overrides it here on its own element.
 */
type MeterStyle = CSSProperties & { readonly "--mh-meter-segments"?: number };

const meterStyleOf = (meter: Meter): MeterStyle =>
  meter.segments === null
    ? { accentColor: PALETTE.accent }
    : { accentColor: PALETTE.accent, "--mh-meter-segments": meter.segments };

/**
 * The track carries the segment count as well as the bar, because the segment mask sits on the
 * track so that it cuts the forecast hatch by the same gaps as the bar under it.
 */
const trackStyleOf = (meter: Meter): MeterStyle =>
  meter.segments === null ? {} : { "--mh-meter-segments": meter.segments };

type ForecastStyle = CSSProperties & {
  readonly "--mh-meter-forecast-from": number;
  readonly "--mh-meter-forecast-to": number;
};

const MeterForecast = ({ meter }: { readonly meter: Meter }) => {
  const span = forecastSpanOf(meter);
  if (span === null) return null;

  const style: ForecastStyle = {
    "--mh-meter-forecast-from": span.from,
    "--mh-meter-forecast-to": span.to,
  };

  return (
    <span
      aria-hidden="true"
      className="mh-meter__forecast"
      data-testid={METER_FORECAST_TEST_ID}
      data-direction={span.direction}
      style={style}
    />
  );
};

/**
 * **A native `<meter>`, kept rather than swapped, closing the standing Inbox item (PLAN M5.7).**
 * The Inbox's other option - `role="meter"` on a styled div - is not available: Biome's
 * `useSemanticElements` rejects a `meter` ARIA role on anything but the native element ("Replace
 * with one of these elements: `<meter>`"), and AGENTS.md is explicit that Biome is the source of
 * truth to run, not argue with. `accentColor` is the confirmation the Inbox asked for: it computes
 * correctly (checked against a real render's `getComputedStyle`, not assumed) but Chromium's
 * `<meter>` still paints its own value-range heuristic (green/yellow/red by ratio) over the value
 * segment regardless, and this project tests Chromium only (AGENTS.md, M0.5's note), so the
 * dispatch-teal fill this task wanted is not reachable there today. Left in place anyway - it is
 * the standards-correct property, harmless where the browser ignores it, and effective wherever a
 * `<meter>` does respect it - and the finding is recorded in this task's Inbox note rather than
 * worked around with a suppressed lint rule.
 *
 * **PLAN M6.8 then styles it from the stylesheet**, which is the option M5.7 did not have:
 * `appearance: none` plus the vendor `::-webkit-meter-*` and `::-moz-meter-bar` pseudo-elements
 * replace Chromium's heuristic colours with the board's own, and a mask cuts the bar into chunky
 * segments. `accentColor` stays inline, where `meters.test.tsx` pins it.
 */
const MeterReadout = ({ meter }: { readonly meter: Meter }) => (
  <div
    className="mh-meter"
    data-testid={METER_TEST_ID}
    data-meter={meter.kind}
    data-value={meter.value}
    data-min={meter.min}
    data-max={meter.max}
    data-segments={meter.segments ?? undefined}
    data-forecast={meter.forecast ?? undefined}
  >
    <dt className="mh-meter__label">{meter.label}</dt>
    <dd className="mh-meter__reading">
      {/* Keyed by what it reads, so a moved meter remounts and replays its motion (PLAN M6.10). */}
      <span key={meter.display} className="mh-meter__value" data-testid={METER_VALUE_TEST_ID}>
        {meter.display}
      </span>
      <span className="mh-meter__track" style={trackStyleOf(meter)}>
        <meter
          className="mh-meter__bar"
          aria-label={meter.label}
          min={meter.min}
          max={meter.max}
          value={meter.value}
          style={meterStyleOf(meter)}
        />
        <MeterForecast meter={meter} />
      </span>
    </dd>
  </div>
);

export const Meters = ({ view, bounds, remaining }: MetersProps) => (
  <section aria-label={METERS_LABEL} className="mh-card" data-testid={METERS_TEST_ID}>
    <h2 className="mh-card__title">{METERS_TITLE}</h2>
    <dl className="mh-meters">
      {metersOf(view, bounds, remaining).map((meter) => (
        <MeterReadout key={meter.kind} meter={meter} />
      ))}
    </dl>
  </section>
);
