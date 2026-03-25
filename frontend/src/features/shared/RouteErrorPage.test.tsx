import { render, screen } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../components/theme";
import RouteErrorPage from "./RouteErrorPage";

function ThrowingRoute({ error }: { error: unknown }) {
  throw error;
}

function renderRouteError(error: unknown) {
  const router = createMemoryRouter(
    createRoutesFromElements(
      <Route element={<Outlet />} errorElement={<RouteErrorPage />}>
        <Route path="/" element={<ThrowingRoute error={error} />} />
      </Route>
    ),
    { initialEntries: ["/"] }
  );

  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

describe("RouteErrorPage", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    document.documentElement.className = "";
    vi.restoreAllMocks();
  });

  it("shows the backend outage copy with light theme styling and home actions", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        email: "admin@example.com",
        role: "ui_admin",
      })
    );
    window.localStorage.setItem("theme", "light");

    const { container } = renderRouteError({
      isAxiosError: true,
      message: "Network Error",
    });

    expect(document.documentElement).not.toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(await screen.findByRole("heading", { name: "Backend temporarily unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/admin");
  });

  it("shows generic copy in dark mode without exposing the raw error detail", async () => {
    window.localStorage.setItem("theme", "dark");

    const { container } = renderRouteError(new Error("super secret backend stack"));

    expect(document.documentElement).toHaveClass("dark");
    expect(container.querySelector("main")).toHaveClass("bg-slate-50", "dark:bg-slate-950");
    expect(container.querySelector("section")).toHaveClass("ui-surface-card");
    expect(await screen.findByRole("heading", { name: "Unexpected application error" })).toBeInTheDocument();
    expect(screen.queryByText("super secret backend stack")).not.toBeInTheDocument();
  });
});
