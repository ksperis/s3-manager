import { render, screen } from "@testing-library/react";
import { Outlet, Route, RouterProvider, createMemoryRouter, createRoutesFromElements } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  return render(<RouterProvider router={router} />);
}

describe("RouteErrorPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the backend outage copy with retry and home actions", async () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        email: "admin@example.com",
        role: "ui_admin",
      })
    );

    renderRouteError({
      isAxiosError: true,
      message: "Network Error",
    });

    expect(await screen.findByRole("heading", { name: "Backend temporarily unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/admin");
  });

  it("shows generic copy without exposing the raw error detail", async () => {
    renderRouteError(new Error("super secret backend stack"));

    expect(await screen.findByRole("heading", { name: "Unexpected application error" })).toBeInTheDocument();
    expect(screen.queryByText("super secret backend stack")).not.toBeInTheDocument();
  });
});
