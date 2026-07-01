import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time.js";

const now = new Date("2026-06-30T12:00:00Z");
describe("relativeTime", () => {
  it("formats minutes, hours, and days in the past", () => {
    expect(relativeTime(new Date("2026-06-30T11:58:00Z"), now)).toMatch(/2 min/);
    expect(relativeTime(new Date("2026-06-30T09:00:00Z"), now)).toMatch(/3 hour/);
    expect(relativeTime(new Date("2026-06-27T12:00:00Z"), now)).toMatch(/3 day/);
  });
  it("shows 'just now' for very recent times", () => {
    expect(relativeTime(new Date("2026-06-30T11:59:50Z"), now)).toBe("just now");
  });
});
