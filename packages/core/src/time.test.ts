import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { makeClock } from "./time";

const HOURS_PER_DAY = 24;
const MORNING = 9;
const LATE_EVENING = 23;
const arbitraryHour = fc.integer({ min: -HOURS_PER_DAY, max: HOURS_PER_DAY });
const arbitraryTurn = fc.integer({ min: 0, max: 1000 });

describe("makeClock", () => {
  it("starts at the hour the hunt began", () => {
    expect(makeClock(MORNING, 0)).toEqual({ turn: 0, hour: MORNING });
  });

  it("advances one hour per turn and wraps past midnight", () => {
    expect(makeClock(LATE_EVENING, 1).hour).toBe(0);
    expect(makeClock(LATE_EVENING, 2).hour).toBe(1);
  });

  test.prop([arbitraryHour, arbitraryTurn])("keeps the hour in [0, 24)", (startHour, turn) => {
    const clock = makeClock(startHour, turn);
    expect(clock.hour).toBeGreaterThanOrEqual(0);
    expect(clock.hour).toBeLessThan(HOURS_PER_DAY);
    expect(clock.turn).toBe(turn);
  });
});
