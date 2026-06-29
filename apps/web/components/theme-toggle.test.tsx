import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const setTheme = vi.fn();
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme }) }));
import { ThemeToggle } from "./theme-toggle.js";

describe("ThemeToggle", () => {
  it("switches to dark when currently light", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
