/**
 * The operations board's header rail (PLAN M6.2): the case number, the clock, the difficulty and
 * the pressure ticker, read at a glance across the top of the frame.
 *
 * Presentational and controlled, the `meters.tsx` split: `headerRailOf` is the whole derivation,
 * a pure function from what the hunt already holds to a list of `HeaderRailItem` data, and the
 * component only draws what it returns. `headerrailpanel.tsx` is the half that knows the store.
 *
 * **These are readouts, not a second copy of the meters.** The clock and pressure also have
 * `<meter>`s in the intel column, and `turn.spec.ts` reads the clock through
 * `[data-testid="meter"][data-meter="clock"]`, so the rail carries its own test ids and never
 * `meter`'s: a second element matching that selector would make the spec's locator ambiguous.
 */

import type { Difficulty, HunterView } from "@manhunter/core";
import { hourLabel } from "./meters";
import { DIFFICULTY_OPTIONS } from "./newhuntform";

/** Declared as data so a test can assert every kind reaches the DOM, `METER_KINDS`'s precedent. */
export const HEADER_RAIL_KINDS = ["case", "clock", "difficulty", "pressure"] as const;

export type HeaderRailKind = (typeof HEADER_RAIL_KINDS)[number];

export type HeaderRailItem = {
  readonly kind: HeaderRailKind;
  readonly label: string;
  readonly display: string;
};

export type HeaderRailInput = {
  readonly seed: number;
  readonly difficulty: Difficulty;
  readonly view: HunterView;
  /** `balance.hunter.pressureMax`, passed in so this file knows no balance number of its own. */
  readonly pressureMax: number;
};

export const HEADER_RAIL_TEST_ID = "header-rail";
export const HEADER_RAIL_ITEM_TEST_ID = "header-rail-item";

export const HEADER_RAIL_LABELS: Readonly<Record<HeaderRailKind, string>> = {
  case: "Case",
  clock: "Clock",
  difficulty: "Difficulty",
  pressure: "Pressure",
};

const RAIL_LABEL = "Case status";
const CASE_PREFIX = "#";
const TURN_SEPARATOR = " / turn ";
const OF_SEPARATOR = " of ";

/** The hunt's seed is its case number: it is what names the hunt in a share link, too. */
const caseDisplay = (seed: number): string => `${CASE_PREFIX}${seed}`;

const clockDisplay = (view: HunterView): string =>
  `${hourLabel(view.clock.hour)}${TURN_SEPARATOR}${view.clock.turn}`;

const difficultyDisplay = (difficulty: Difficulty): string =>
  DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.label ?? difficulty;

export const headerRailOf = (input: HeaderRailInput): readonly HeaderRailItem[] => [
  { kind: "case", label: HEADER_RAIL_LABELS.case, display: caseDisplay(input.seed) },
  { kind: "clock", label: HEADER_RAIL_LABELS.clock, display: clockDisplay(input.view) },
  {
    kind: "difficulty",
    label: HEADER_RAIL_LABELS.difficulty,
    display: difficultyDisplay(input.difficulty),
  },
  {
    kind: "pressure",
    label: HEADER_RAIL_LABELS.pressure,
    display: `${input.view.hunter.pressure}${OF_SEPARATOR}${input.pressureMax}`,
  },
];

export type HeaderRailProps = {
  readonly items: readonly HeaderRailItem[];
};

export const HeaderRail = ({ items }: HeaderRailProps) => (
  <dl aria-label={RAIL_LABEL} className="mh-rail" data-testid={HEADER_RAIL_TEST_ID}>
    {items.map((item) => (
      <div
        key={item.kind}
        className="mh-rail__item"
        data-testid={HEADER_RAIL_ITEM_TEST_ID}
        data-rail={item.kind}
      >
        <dt className="mh-rail__label">{item.label}</dt>
        {/* Keyed by what it reads, so a new reading remounts and replays the turn-advance motion. */}
        <dd key={item.display} className="mh-rail__value">
          {item.display}
        </dd>
      </div>
    ))}
  </dl>
);
