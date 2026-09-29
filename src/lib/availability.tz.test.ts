import { describe, expect, it } from "vitest";
import { getFreeRanges } from "./availability";

const CHI = "America/Chicago";
const iso = (d: Date) => d.toISOString();

describe("getFreeRanges in a tutor's timezone", () => {
  const base = {
    now: new Date("2026-01-01T00:00:00.000Z"),
    minBookingNoticeHours: 0,
    maxBookingWindowHours: 24 * 365,
    // Sundays 3pm–5pm, Chicago time
    recurringBlocks: [{ dayOfWeek: 0, startTime: "15:00", endTime: "17:00" }],
    exceptions: [],
    busyRanges: [],
    timeZone: CHI,
  };

  it("keeps 3pm local on both sides of the November clock change", () => {
    const result = getFreeRanges({
      ...base,
      rangeStart: new Date("2026-10-25T00:00:00.000Z"),
      rangeEnd: new Date("2026-11-09T00:00:00.000Z"),
    });
    const ranges = result.days.flatMap((d) => d.ranges.map((r) => [d.date, iso(r.start), iso(r.end)]));
    expect(ranges).toEqual([
      ["2026-10-25", "2026-10-25T20:00:00.000Z", "2026-10-25T22:00:00.000Z"], // CDT, UTC-5
      ["2026-11-01", "2026-11-01T21:00:00.000Z", "2026-11-01T23:00:00.000Z"], // CST, UTC-6
      ["2026-11-08", "2026-11-08T21:00:00.000Z", "2026-11-08T23:00:00.000Z"],
    ]);
  });

  it("uses the tutor's local weekday, not the UTC one", () => {
    // Sunday 9pm–11pm Chicago is Monday 02:00–04:00 UTC.
    const result = getFreeRanges({
      ...base,
      recurringBlocks: [{ dayOfWeek: 0, startTime: "21:00", endTime: "23:00" }],
      rangeStart: new Date("2026-07-05T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-07T00:00:00.000Z"),
    });
    const ranges = result.days.flatMap((d) => d.ranges.map((r) => [d.date, iso(r.start)]));
    expect(ranges).toEqual([["2026-07-05", "2026-07-06T02:00:00.000Z"]]);
  });

  it("applies exceptions on the tutor's local date", () => {
    const result = getFreeRanges({
      ...base,
      exceptions: [
        { date: new Date("2026-07-05T00:00:00.000Z"), startTime: "15:00", endTime: "16:00", isAvailable: false },
        { date: new Date("2026-07-06T00:00:00.000Z"), startTime: "09:00", endTime: "10:00", isAvailable: true },
      ],
      rangeStart: new Date("2026-07-05T05:00:00.000Z"),
      rangeEnd: new Date("2026-07-07T05:00:00.000Z"),
    });
    const ranges = result.days.flatMap((d) => d.ranges.map((r) => [d.date, iso(r.start), iso(r.end)]));
    expect(ranges).toEqual([
      ["2026-07-05", "2026-07-05T21:00:00.000Z", "2026-07-05T22:00:00.000Z"],
      ["2026-07-06", "2026-07-06T14:00:00.000Z", "2026-07-06T15:00:00.000Z"],
    ]);
  });
});
