import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo, LogoMark } from "./logo.js";

describe("Logo", () => {
  it("renders the wordmark and an svg mark", () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("GoldenRetriever")).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });
  it("LogoMark renders just the svg", () => {
    const { container } = render(<LogoMark />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
