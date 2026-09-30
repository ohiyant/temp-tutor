import { describe, expect, it } from "vitest";
import { sessionPlace, sessionPlaceLine, tutorContactLine } from "./sessionPlace";

const tutor = { inPersonLocation: "Rivera Library, 2nd floor", meetingLink: "https://zoom.us/j/123" };
const bare = { inPersonLocation: null, meetingLink: null };

describe("sessionPlace", () => {
  it("gives the meeting link for online sessions", () => {
    expect(sessionPlace("online", tutor)).toEqual({ label: "Join online", text: tutor.meetingLink, href: tutor.meetingLink });
  });

  it("gives the location for in-person sessions", () => {
    expect(sessionPlaceLine("in_person", tutor)).toBe("Where: Rivera Library, 2nd floor");
  });

  it("prefers the place the student chose for in-person sessions", () => {
    expect(sessionPlaceLine("in_person", tutor, "Starbucks on University Ave")).toBe(
      "Where: Starbucks on University Ave"
    );
    expect(sessionPlaceLine("in_person", bare, "  ")).toBe("In person: Your tutor will confirm where to meet.");
  });

  it("says the tutor will follow up when nothing is set", () => {
    expect(sessionPlaceLine("online", bare)).toBe("Online: Your tutor will send you the meeting link.");
    expect(sessionPlaceLine("in_person", bare)).toBe("In person: Your tutor will confirm where to meet.");
  });

  it("writes the contact line", () => {
    expect(tutorContactLine({ name: "Yihao", email: "y@example.com" })).toBe("Questions? Contact Yihao at y@example.com.");
  });
});
