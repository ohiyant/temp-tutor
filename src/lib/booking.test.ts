import { describe, expect, it } from "vitest";
import { checkSessionFits, hasOverlap, type CheckSessionFitsInput } from "./booking";
import { CONFIG } from "../config";

// Monday 2030-01-07; tutor free Mondays 15:00–19:00.
const now = new Date("2030-01-01T12:00:00.000Z");
const base: Omit<CheckSessionFitsInput, "startAt" | "durationMin"> = {
  now,
  minBookingNoticeHours: 24,
  maxBookingWindowHours: 24 * 30,
  recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "19:00" }],
  exceptions: [],
  busyRanges: [],
  bufferMin: 30,
  timeZone: "UTC",
};
const at = (hhmm: string) => new Date(`2030-01-07T${hhmm}:00.000Z`);

describe("checkSessionFits", () => {
  it("accepts a session inside a free block", () => {
    expect(checkSessionFits({ ...base, startAt: at("15:00"), durationMin: 60 })).toBeNull();
    expect(checkSessionFits({ ...base, startAt: at("18:00"), durationMin: 60 })).toBeNull();
  });

  it("rejects a session running past the end of the block", () => {
    expect(checkSessionFits({ ...base, startAt: at("18:30"), durationMin: 60 })).toMatch(/no longer available/);
  });

  it("rejects a session outside availability", () => {
    expect(checkSessionFits({ ...base, startAt: at("12:00"), durationMin: 60 })).toMatch(/no longer available/);
  });

  it("rejects bad durations", () => {
    const { MIN_SESSION_LENGTH_MIN: min, MAX_SESSION_LENGTH_MIN: max, SESSION_DURATION_INCREMENT_MIN: step } = CONFIG;
    expect(checkSessionFits({ ...base, startAt: at("15:00"), durationMin: min - step })).toMatch(/between/);
    expect(checkSessionFits({ ...base, startAt: at("15:00"), durationMin: max + step })).toMatch(/between/);
    expect(checkSessionFits({ ...base, startAt: at("15:00"), durationMin: min + 1 })).toMatch(/steps/);
  });

  it("rejects overlap with a confirmed session", () => {
    const busyRanges = [{ start: at("16:00"), end: at("17:00"), mode: "online" as const }];
    expect(checkSessionFits({ ...base, busyRanges, startAt: at("15:30"), durationMin: 60 })).toMatch(/no longer/);
    expect(checkSessionFits({ ...base, busyRanges, startAt: at("17:00"), durationMin: 60 })).toBeNull();
  });

  it("keeps the travel buffer around in-person sessions", () => {
    const busyRanges = [{ start: at("16:00"), end: at("17:00"), mode: "in_person" as const }];
    expect(checkSessionFits({ ...base, busyRanges, startAt: at("17:00"), durationMin: 60 })).toMatch(/no longer/);
    expect(checkSessionFits({ ...base, busyRanges, startAt: at("17:30"), durationMin: 60 })).toBeNull();
  });

  it("enforces minimum notice and the booking window", () => {
    const tooSoon = { ...base, now: new Date("2030-01-07T00:00:00.000Z") };
    expect(checkSessionFits({ ...tooSoon, startAt: at("15:00"), durationMin: 60 })).toMatch(/notice/);
    const tooFar = { ...base, maxBookingWindowHours: 24 };
    expect(checkSessionFits({ ...tooFar, startAt: at("15:00"), durationMin: 60 })).toMatch(/too far/);
  });
});

describe("hasOverlap", () => {
  it("detects overlaps but allows touching ranges", () => {
    expect(hasOverlap([{ start: at("15:00"), end: at("16:00") }, { start: at("16:00"), end: at("17:00") }])).toBe(false);
    expect(hasOverlap([{ start: at("16:30"), end: at("17:00") }, { start: at("15:00"), end: at("16:45") }])).toBe(true);
  });
});

describe("checkSessionFits in the tutor's timezone", () => {
  // Chicago tutor, Mondays 15:00–19:00 local = 21:00–01:00 UTC in January (CST, UTC-6).
  const chi = { ...base, timeZone: "America/Chicago" };

  it("accepts a session at 3pm Chicago time", () => {
    expect(checkSessionFits({ ...chi, startAt: new Date("2030-01-07T21:00:00.000Z"), durationMin: 60 })).toBeNull();
  });

  it("accepts the last hour even though it runs past UTC midnight", () => {
    expect(checkSessionFits({ ...chi, startAt: new Date("2030-01-08T00:00:00.000Z"), durationMin: 60 })).toBeNull();
  });

  it("rejects 3pm UTC, which is 9am in Chicago", () => {
    expect(checkSessionFits({ ...chi, startAt: new Date("2030-01-07T15:00:00.000Z"), durationMin: 60 })).toMatch(
      /no longer available/
    );
  });
});
