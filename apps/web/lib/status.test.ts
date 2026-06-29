import { describe, it, expect } from "vitest";
import { statusLabel, statusBadgeClass, sourceLabel } from "./status.js";

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

describe("sourceLabel", () => {
  it("maps capture modes to Text / URL / File", () => {
    expect(sourceLabel("selection")).toBe("Text");
    expect(sourceLabel("url_fetch")).toBe("URL");
    expect(sourceLabel("full_dom")).toBe("URL");
    expect(sourceLabel("upload")).toBe("File");
  });
  it("title-cases unknown/future modes instead of blanking", () => {
    expect(sourceLabel("rss_feed")).toBe("Rss Feed");
    expect(sourceLabel("")).toBe("Other");
  });
});
