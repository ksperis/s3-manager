import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./features/auth/LoginPage", () => ({
  default: function MockLoginPage() {
    throw new Error("sensitive route failure");
  },
}));

import { createAppRoutes } from "./router";

describe("app route error boundary", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces the default React Router crash message with the app error page", async () => {
    const router = createMemoryRouter(createAppRoutes(), {
      initialEntries: ["/login"],
    });

    render(
      <Suspense fallback={<div>Loading workspace...</div>}>
        <RouterProvider router={router} />
      </Suspense>
    );

    expect(await screen.findByRole("heading", { name: "Unexpected application error" })).toBeInTheDocument();
    expect(screen.queryByText(/You can provide a way better UX than this/i)).not.toBeInTheDocument();
  });
});
