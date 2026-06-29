import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/chat" }));
import { NavLink } from "./nav-link.js";

describe("NavLink", () => {
  it("marks the matching route active", () => {
    render(<><NavLink href="/chat" label="Chat" /><NavLink href="/search" label="Search" /></>);
    expect(screen.getByText("Chat").getAttribute("data-active")).toBe("true");
    expect(screen.getByText("Search").getAttribute("data-active")).toBe("false");
  });
});
