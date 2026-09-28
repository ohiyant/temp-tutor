import { describe, it, expect } from "vitest";
import { getAvailableSlots, getFreeRanges, computeBufferPadding } from "./availability";

// Fixed reference "now": a Sunday, so Monday/Wednesday/Saturday below are
// predictable days in the near future.
const NOW = new Date("2026-09-27T00:00:00Z"); // a Sunday

const baseInput = {
  now: NOW,
  rangeStart: new Date("2026-09-27T00:00:00Z"),
  rangeEnd: new Date("2026-10-11T00:00:00Z"), // 2-week window
  durationMin: 60,
  startIncrementMin: 30,
  minBookingNoticeHours: 24,
  maxBookingWindowHours: 24 * 30,
  exceptions: [],
  busyRanges: [],
};

describe("getAvailableSlots", () => {
  it("returns slots for a simple recurring block", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }], // Monday
    });

    // Monday 2026-09-28, 15:00-18:00, 60-min sessions every 30 min -> 15:00, 15:30, ..., 17:00
    const mondaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-28"));
    expect(mondaySlots.length).toBeGreaterThan(0);
    expect(mondaySlots[0].toISOString()).toBe("2026-09-28T15:00:00.000Z");
    // last valid start must leave a full hour before 18:00
    const lastStart = mondaySlots[mondaySlots.length - 1];
    expect(lastStart.getTime() + 60 * 60 * 1000).toBeLessThanOrEqual(
      new Date("2026-09-28T18:00:00Z").getTime()
    );
  });

  it("respects a blackout exception", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
      exceptions: [
        {
          date: new Date("2026-09-28T00:00:00Z"),
          startTime: "15:00",
          endTime: "18:00",
          isAvailable: false,
        },
      ],
    });
    const mondaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-28"));
    expect(mondaySlots.length).toBe(0);
  });

  it("adds an extra one-off availability exception outside the recurring schedule", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      recurringBlocks: [], // no recurring availability at all
      exceptions: [
        {
          date: new Date("2026-09-29T00:00:00Z"), // Tuesday
          startTime: "10:00",
          endTime: "12:00",
          isAvailable: true,
        },
      ],
    });
    const tuesdaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-29"));
    expect(tuesdaySlots.length).toBe(3); // 60-min sessions at 30-min increments in a 10:00-12:00 window -> 10:00, 10:30, 11:00
    expect(tuesdaySlots[0].toISOString()).toBe("2026-09-29T10:00:00.000Z");
  });

  it("removes slots that overlap an existing confirmed booking", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
      busyRanges: [
        { start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T16:00:00Z") },
      ],
    });
    const mondaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-28"));
    // 15:00 and 15:30 starts would overlap the 15:00-16:00 booking, so first free start is 16:00
    expect(mondaySlots[0].toISOString()).toBe("2026-09-28T16:00:00.000Z");
  });

  it("excludes slots that violate minimum booking notice", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      now: new Date("2026-09-28T14:30:00Z"), // 30 min before a 15:00 Monday slot
      minBookingNoticeHours: 24,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
    });
    const mondaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-28"));
    expect(mondaySlots.length).toBe(0); // everything today is within the 24h notice window
  });

  it("excludes slots beyond the maximum booking window", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      maxBookingWindowHours: 24, // only 1 day out allowed
      recurringBlocks: [{ dayOfWeek: 6, startTime: "10:00", endTime: "14:00" }], // Saturday, far away
    });
    const saturdaySlots = slots.filter((s) => s.toISOString().startsWith("2026-10-03"));
    expect(saturdaySlots.length).toBe(0);
  });

  it("returns no slots when the session duration doesn't fit in any window", () => {
    const slots = getAvailableSlots({
      ...baseInput,
      durationMin: 180, // 3 hours
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "16:00" }], // only 1hr block
    });
    const mondaySlots = slots.filter((s) => s.toISOString().startsWith("2026-09-28"));
    expect(mondaySlots.length).toBe(0);
  });
});

describe("getFreeRanges", () => {
  const rangesInput = {
    now: NOW,
    rangeStart: new Date("2026-09-27T00:00:00Z"),
    rangeEnd: new Date("2026-10-04T00:00:00Z"), // 1-week window
    minBookingNoticeHours: 24,
    maxBookingWindowHours: 24 * 30,
    exceptions: [],
    busyRanges: [],
  };

  it("returns one continuous free range for a plain recurring block", () => {
    const result = getFreeRanges({
      ...rangesInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }], // Monday
    });
    const monday = result.days.find((d) => d.date === "2026-09-28");
    expect(monday?.ranges.length).toBe(1);
    expect(monday?.ranges[0].start.toISOString()).toBe("2026-09-28T15:00:00.000Z");
    expect(monday?.ranges[0].end.toISOString()).toBe("2026-09-28T18:00:00.000Z");
  });

  it("clips the free range's start to the min-notice cutoff instead of dropping the whole day", () => {
    const result = getFreeRanges({
      ...rangesInput,
      now: new Date("2026-09-28T14:00:00Z"), // 1h before the block opens, 24h notice required
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
    });
    const monday = result.days.find((d) => d.date === "2026-09-28");
    // earliest allowed start is 2026-09-29T14:00Z, entirely past this block -> no free range left
    expect(monday?.ranges.length ?? 0).toBe(0);
  });

  it("does not clip the free range by the max booking window (only start times are bounded)", () => {
    const result = getFreeRanges({
      ...rangesInput,
      maxBookingWindowHours: 1, // only the next hour is a valid *start* time
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
    });
    const monday = result.days.find((d) => d.date === "2026-09-28");
    // the full 15:00-18:00 range is still returned for display/dragging...
    expect(monday?.ranges[0].end.toISOString()).toBe("2026-09-28T18:00:00.000Z");
    // ...but latestAllowedStart tells the caller a booking can't actually start that late
    expect(result.latestAllowedStart < monday!.ranges[0].end).toBe(true);
  });

  it("pads an in-person busy range with transport buffer on both sides", () => {
    const result = getFreeRanges({
      ...rangesInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
      busyRanges: [
        { start: new Date("2026-09-28T16:00:00Z"), end: new Date("2026-09-28T17:00:00Z"), mode: "in_person" },
      ],
      bufferMin: 30,
    });
    const monday = result.days.find((d) => d.date === "2026-09-28");
    // 15:00-18:00 minus (16:00-17:00 +/- 30min buffer = 15:30-17:30) -> two slivers: 15:00-15:30 and 17:30-18:00
    expect(monday?.ranges).toEqual([
      { start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T15:30:00Z") },
      { start: new Date("2026-09-28T17:30:00Z"), end: new Date("2026-09-28T18:00:00Z") },
    ]);
  });

  it("does not pad an online busy range", () => {
    const result = getFreeRanges({
      ...rangesInput,
      recurringBlocks: [{ dayOfWeek: 1, startTime: "15:00", endTime: "18:00" }],
      busyRanges: [
        { start: new Date("2026-09-28T16:00:00Z"), end: new Date("2026-09-28T17:00:00Z"), mode: "online" },
      ],
      bufferMin: 30,
    });
    const monday = result.days.find((d) => d.date === "2026-09-28");
    expect(monday?.ranges).toEqual([
      { start: new Date("2026-09-28T15:00:00Z"), end: new Date("2026-09-28T16:00:00Z") },
      { start: new Date("2026-09-28T17:00:00Z"), end: new Date("2026-09-28T18:00:00Z") },
    ]);
  });
});

describe("computeBufferPadding", () => {
  it("returns the two padding slivers around an in-person session, and none for online", () => {
    const pads = computeBufferPadding(
      [
        { start: new Date("2026-09-28T16:00:00Z"), end: new Date("2026-09-28T17:00:00Z"), mode: "in_person" },
        { start: new Date("2026-09-28T10:00:00Z"), end: new Date("2026-09-28T11:00:00Z"), mode: "online" },
      ],
      30
    );
    expect(pads).toEqual([
      { start: new Date("2026-09-28T15:30:00Z"), end: new Date("2026-09-28T16:00:00Z") },
      { start: new Date("2026-09-28T17:00:00Z"), end: new Date("2026-09-28T17:30:00Z") },
    ]);
  });

  it("returns nothing when bufferMin is 0", () => {
    const pads = computeBufferPadding(
      [{ start: new Date("2026-09-28T16:00:00Z"), end: new Date("2026-09-28T17:00:00Z"), mode: "in_person" }],
      0
    );
    expect(pads).toEqual([]);
  });
});
