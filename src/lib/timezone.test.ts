import { describe, expect, it } from "vitest";
import { addDays, formatDateTime, isValidTimeZone, timeZoneOptionLabel, zonedParts, zonedTimeToUtc } from "./timezone";

const CHI = "America/Chicago";

describe("zonedTimeToUtc", () => {
  it("converts Chicago wall-clock times in summer (CDT, UTC-5) and winter (CST, UTC-6)", () => {
    expect(zonedTimeToUtc("2026-07-01", 15 * 60, CHI).toISOString()).toBe("2026-07-01T20:00:00.000Z");
    expect(zonedTimeToUtc("2026-01-15", 15 * 60, CHI).toISOString()).toBe("2026-01-15T21:00:00.000Z");
  });

  it("handles the day clocks change (US DST ends 2026-11-01)", () => {
    // Midnight is still CDT, 3pm is CST.
    expect(zonedTimeToUtc("2026-11-01", 0, CHI).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(zonedTimeToUtc("2026-11-01", 15 * 60, CHI).toISOString()).toBe("2026-11-01T21:00:00.000Z");
  });

  it("moves a time skipped by spring-forward an hour later", () => {
    // 2026-03-08 02:30 doesn't exist in Chicago.
    expect(zonedTimeToUtc("2026-03-08", 2 * 60 + 30, CHI).toISOString()).toBe("2026-03-08T08:30:00.000Z");
  });

  it("accepts 1440 minutes as the next midnight", () => {
    expect(zonedTimeToUtc("2026-07-01", 1440, CHI).toISOString()).toBe("2026-07-02T05:00:00.000Z");
  });

  it("works for zones east of UTC and half-hour offsets", () => {
    expect(zonedTimeToUtc("2026-07-01", 9 * 60, "Asia/Kolkata").toISOString()).toBe("2026-07-01T03:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", 9 * 60, "UTC").toISOString()).toBe("2026-07-01T09:00:00.000Z");
  });
});

describe("zonedParts", () => {
  it("reads the wall clock and calendar date in a zone", () => {
    const instant = new Date("2026-07-02T03:00:00.000Z");
    expect(zonedParts(instant, CHI)).toEqual({ date: "2026-07-01", minutes: 22 * 60, dayOfWeek: 3 });
    expect(zonedParts(instant, "UTC")).toEqual({ date: "2026-07-02", minutes: 3 * 60, dayOfWeek: 4 });
  });

  it("round-trips with zonedTimeToUtc", () => {
    for (const tz of [CHI, "Europe/London", "Asia/Tokyo", "Australia/Adelaide"]) {
      const instant = zonedTimeToUtc("2026-10-04", 17 * 60 + 15, tz);
      expect(zonedParts(instant, tz)).toMatchObject({ date: "2026-10-04", minutes: 17 * 60 + 15 });
    }
  });
});

describe("misc", () => {
  it("validates zones", () => {
    expect(isValidTimeZone(CHI)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("formats with a zone abbreviation", () => {
    expect(formatDateTime(new Date("2026-10-01T22:00:00.000Z"), CHI)).toBe("Thu, Oct 1, 5:00 PM CDT");
  });
});

describe("repeated hour at fall-back", () => {
  it("picks the first 1:30am on 2026-11-01 in Chicago (CDT)", () => {
    expect(zonedTimeToUtc("2026-11-01", 90, CHI).toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
});

describe("picker labels", () => {
  const july = new Date("2026-07-01T12:00:00.000Z");
  it("names common US zones with their abbreviation", () => {
    expect(timeZoneOptionLabel("America/Chicago", july)).toBe("Central Time (CDT)");
    expect(timeZoneOptionLabel("America/New_York", new Date("2026-01-15T12:00:00.000Z"))).toBe("Eastern Time (EST)");
    expect(timeZoneOptionLabel("America/Phoenix", july)).toBe("Mountain Time – Arizona (MST)");
  });
  it("labels other zones by place and offset", () => {
    expect(timeZoneOptionLabel("Europe/London", july)).toBe("London, Europe (UTC+1)");
    expect(timeZoneOptionLabel("Asia/Kolkata", july)).toBe("Kolkata, Asia (UTC+5:30)");
    expect(timeZoneOptionLabel("America/Argentina/Buenos_Aires", july)).toBe("Buenos Aires, Argentina, America (UTC−3)");
    expect(timeZoneOptionLabel("UTC", july)).toBe("UTC (UTC)");
  });
});
