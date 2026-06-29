import { describe, it, expect } from "vitest";
import { statusLabel, statusBadgeClass } from "./status.js";

describe("status helpers", () => {
  it("labels are uppercased", () => {
    expect(statusLabel("ready")).toBe("READY");
    expect(statusLabel("failed")).toBe("FAILED");
  });
  it("maps each status to distinct classes", () => {
    expect(statusBadgeClass("ready")).toContain("emerald");
    expect(statusBadgeClass("processing")).toContain("amber");
    expect(statusBadgeClass("failed")).toContain("red");
    expect(statusBadgeClass("queued")).toContain("slate");
    expect(statusBadgeClass("anything-else")).toContain("slate");
  });
});
