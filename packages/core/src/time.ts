/**
 * Game time. One turn is one in-game hour (DESIGN.md "Time and turns"), so the clock is a turn
 * counter plus the wall hour it maps to. `Turn` and `Hour` are plain numbers rather than brands:
 * both are arithmetic all the way through, and a brand would be cast away at every `+ 1`.
 */

export type Turn = number;

/** Hour of day in [0, 24). */
export type Hour = number;

/**
 * Coarse lighting state. Districts behave differently after dark (DESIGN.md "District
 * properties"); which hours count as night is a balance knob, so the mapping lives in
 * `balance.ts` (PLAN M1.3), not here.
 */
export type TimeOfDay = "day" | "night";

export type Clock = {
  readonly turn: Turn;
  readonly hour: Hour;
};

/** Exported because the start hour is drawn uniformly over a day (PLAN M3.1a). */
export const HOURS_PER_DAY = 24;

/**
 * The clock for a turn of a hunt that began at `startHour`. Wraps past midnight, and tolerates
 * a negative `startHour` so callers never have to normalise before calling.
 */
export const makeClock = (startHour: Hour, turn: Turn): Clock => ({
  turn,
  hour: (((startHour + turn) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY,
});

/**
 * The part of `balance.time` that decides whether the lights are on. Structural rather than
 * `Balance` itself, for the reason `TraversableGraph` is structural: it keeps the dependency
 * pointing one way, since `balance.ts` already reads this module's siblings.
 */
export type DaylightHours = {
  readonly nightStartHour: Hour;
  readonly dayStartHour: Hour;
};

/**
 * Night is `[nightStartHour, dayStartHour)`, wrapping past midnight. Districts behave differently
 * after dark (DESIGN.md "District properties"), which is what PLAN M3.4a's canvass reads and what
 * M3.7's nightfall event fires on.
 */
export const timeOfDayAt = (hours: DaylightHours, hour: Hour): TimeOfDay =>
  hour >= hours.nightStartHour || hour < hours.dayStartHour ? "night" : "day";
