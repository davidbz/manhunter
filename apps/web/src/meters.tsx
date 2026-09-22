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
 */

import type { Hour, HunterView } from "@manhunter/core";

/**
 * Declared as data so the list and the type cannot drift, and so a test can assert that every
 * kind reaches the DOM - the same guard PLAN M5.6a puts on score components.
 */
export const METER_KINDS = ["action_points", "budget", "trust", "pressure", "clock"] as const;

export type MeterKind = (typeof METER_KINDS)[number];

/** One meter, ready to draw. `display` is the reading; `value`, `min` and `max` are the bar. */
export type Meter = {
  readonly kind: MeterKind;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly display: string;
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
};

export const METERS_TEST_ID = "meters";
export const METER_TEST_ID = "meter";
export const METER_VALUE_TEST_ID = "meter-value";

/** Every word the meters say, in one table, for the reason `REPORT_SOURCE_LABELS` is one. */
export const METER_LABELS: Readonly<Record<MeterKind, string>> = {
  action_points: "Action points",
  budget: "Budget",
  trust: "Public trust",
  pressure: "Political pressure",
  clock: "Clock",
};

const METERS_LABEL = "Hunter meters";
const OF_SEPARATOR = " of ";
const CLOCK_SEPARATOR = " - turn ";
const REMAINING_SUFFIX = " left";
const TURNS_REMAINING_SEPARATOR = ", ";
const HOUR_DIGITS = 2;
const HOUR_PAD = "0";
const ON_THE_HOUR = ":00";

const NONE = 0;

const hourLabel = (hour: Hour): string =>
  `${String(hour).padStart(HOUR_DIGITS, HOUR_PAD)}${ON_THE_HOUR}`;

const outOf = (value: number, maximum: number): string => `${value}${OF_SEPARATOR}${maximum}`;

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

export const metersOf = (view: HunterView, bounds: MeterBounds): readonly Meter[] => {
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

/**
 * A native `<meter>` rather than a styled div: it carries the range in the accessibility tree for
 * free, and PLAN M5.7's visual pass can restyle it without the markup changing shape.
 */
const MeterReadout = ({ meter }: { readonly meter: Meter }) => (
  <div
    data-testid={METER_TEST_ID}
    data-meter={meter.kind}
    data-value={meter.value}
    data-min={meter.min}
    data-max={meter.max}
  >
    <dt>{meter.label}</dt>
    <dd>
      <meter aria-label={meter.label} min={meter.min} max={meter.max} value={meter.value} />
      <span data-testid={METER_VALUE_TEST_ID}>{meter.display}</span>
    </dd>
  </div>
);

export const Meters = ({ view, bounds }: MetersProps) => (
  <section aria-label={METERS_LABEL} data-testid={METERS_TEST_ID}>
    <dl>
      {metersOf(view, bounds).map((meter) => (
        <MeterReadout key={meter.kind} meter={meter} />
      ))}
    </dl>
  </section>
);
