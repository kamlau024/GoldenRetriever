import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import { MobileNav } from "./mobile-nav.js";

describe("MobileNav", () => {
  it("opens a menu listing the four destinations", async () => {
    render(<MobileNav />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(await screen.findByText("Library")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("Search")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });
});
