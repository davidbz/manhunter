import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { BALANCE } from "./balance";
import { makeClock, timeOfDayAt } from "./time";

const HOURS_PER_DAY = 24;
const MORNING = 9;
const MIDDAY = 12;
const NIGHT_START_HOUR = 21;
const DAY_START_HOUR = 6;
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

describe("timeOfDayAt", () => {
  const hours = { nightStartHour: NIGHT_START_HOUR, dayStartHour: DAY_START_HOUR };

  it("calls the hour night falls night, and the hour day breaks day", () => {
    expect(timeOfDayAt(hours, NIGHT_START_HOUR)).toBe("night");
    expect(timeOfDayAt(hours, DAY_START_HOUR)).toBe("day");
  });

  it("keeps night across midnight rather than ending it there", () => {
    expect(timeOfDayAt(hours, HOURS_PER_DAY - 1)).toBe("night");
    expect(timeOfDayAt(hours, 0)).toBe("night");
    expect(timeOfDayAt(hours, DAY_START_HOUR - 1)).toBe("night");
  });

  it("calls the hours between day", () => {
    expect(timeOfDayAt(hours, NIGHT_START_HOUR - 1)).toBe("day");
    expect(timeOfDayAt(hours, MIDDAY)).toBe("day");
  });

  it("agrees with the hours shipped balance names", () => {
    expect(hours).toEqual({
      nightStartHour: BALANCE.time.nightStartHour,
      dayStartHour: BALANCE.time.dayStartHour,
    });
  });
});
