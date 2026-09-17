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

const HOURS_PER_DAY = 24;

/**
 * The clock for a turn of a hunt that began at `startHour`. Wraps past midnight, and tolerates
 * a negative `startHour` so callers never have to normalise before calling.
 */
export const makeClock = (startHour: Hour, turn: Turn): Clock => ({
  turn,
  hour: (((startHour + turn) % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY,
});
