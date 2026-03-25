import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "../../components/theme";
import UnauthorizedPage from "./UnauthorizedPage";

function renderPage(theme?: "light" | "dark") {
  if (theme) {
    window.localStorage.setItem("theme", theme);
  }

  return render(
    <ThemeProvider>
      <MemoryRouter>
        <UnauthorizedPage />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe("UnauthorizedPage", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
  });

  it("uses the active light theme and keeps the workspace action", () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        email: "admin@example.com",
        role: "ui_admin",
      })
    );

    const { container } = renderPage("light");

    expect(document.documentElement).not.toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(container.querySelector("section")).toHaveClass("ui-surface-card");
    expect(screen.getByRole("heading", { name: "Unauthorized access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to workspace" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Switch account" })).toHaveAttribute("href", "/login");
  });

  it("uses the active dark theme and hides the workspace action when no home is available", () => {
    const { container } = renderPage("dark");

    expect(document.documentElement).toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(container.querySelector("section")).toHaveClass("ui-surface-card");
    expect(screen.queryByRole("link", { name: "Back to workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Switch account" })).toHaveAttribute("href", "/login");
  });
});
