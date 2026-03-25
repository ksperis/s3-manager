import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../../components/theme";
import FeatureDisabledPage from "./FeatureDisabledPage";

function renderPage(theme?: "light" | "dark") {
  if (theme) {
    window.localStorage.setItem("theme", theme);
  }

  return render(
    <ThemeProvider>
      <MemoryRouter>
        <FeatureDisabledPage feature="Browser" />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe("FeatureDisabledPage", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  it("renders with the light theme shell and expected actions", () => {
    const { container } = renderPage("light");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(container.querySelector("section")).toHaveClass("ui-surface-card");
    expect(screen.getByRole("heading", { name: "Browser disabled" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Switch account" })).toHaveAttribute("href", "/login");
  });

  it("renders with the dark theme shell", () => {
    const { container } = renderPage("dark");

    expect(document.documentElement).toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(container.querySelector("section")).toHaveClass("ui-surface-card");
  });
});
