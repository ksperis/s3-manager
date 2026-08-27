import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import FirstAdminSetupPage from "./FirstAdminSetupPage";

const mocks = vi.hoisted(() => ({
  bootstrapFirstAdmin: vi.fn(),
  fetchFirstAdminBootstrapStatus: vi.fn(),
}));

vi.mock("../../api/auth", () => ({
  bootstrapFirstAdmin: (...args: unknown[]) =>
    mocks.bootstrapFirstAdmin(...args),
  fetchFirstAdminBootstrapStatus: (...args: unknown[]) =>
    mocks.fetchFirstAdminBootstrapStatus(...args),
}));

function LocationProbe() {
  const location = useLocation();
  return <div>Location: {location.pathname + location.search}</div>;
}

function renderSetup() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/setup/first-admin"]}>
        <Routes>
          <Route path="/setup/first-admin" element={<FirstAdminSetupPage />} />
          <Route path="/login" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe("FirstAdminSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/setup/first-admin#token=one-time-secret");
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.fetchFirstAdminBootstrapStatus.mockResolvedValue({ available: true });
    mocks.bootstrapFirstAdmin.mockResolvedValue({
      status: "mfa_enrollment_required",
      user: {
        id: 1,
        email: "admin@example.com",
        role: "ui_superadmin",
        is_admin: true,
        account_links: [],
        s3_user_details: [],
        s3_connection_details: [],
      },
    });
  });

  it("removes the token fragment immediately and never persists it", async () => {
    renderSetup();

    expect(window.location.hash).toBe("");
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
    expect(await screen.findByRole("heading", { name: "Create the first administrator" })).toBeVisible();
  });

  it("submits the in-memory token and continues directly to passkey enrollment", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.type(await screen.findByLabelText("Full name"), "Platform Admin");
    await user.type(screen.getByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    await waitFor(() => {
      expect(mocks.bootstrapFirstAdmin).toHaveBeenCalledWith(
        "one-time-secret",
        expect.objectContaining({
          email: "admin@example.com",
          full_name: "Platform Admin",
        }),
      );
    });
    expect(
      await screen.findByText("Location: /login?mfa=mfa_enrollment_required"),
    ).toBeVisible();
    expect(window.localStorage.getItem("token")).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("keeps mismatched passwords client-side", async () => {
    const user = userEvent.setup();
    renderSetup();

    await user.type(await screen.findByLabelText("Email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse battery staple");
    await user.type(screen.getByLabelText("Confirm password"), "different secure password");
    await user.click(screen.getByRole("button", { name: "Create administrator" }));

    expect(await screen.findByText("Passwords do not match.")).toBeVisible();
    expect(mocks.bootstrapFirstAdmin).not.toHaveBeenCalled();
  });

  it("redirects to sign-in when bootstrap is closed", async () => {
    mocks.fetchFirstAdminBootstrapStatus.mockResolvedValue({ available: false });

    renderSetup();

    expect(await screen.findByText("Location: /login")).toBeVisible();
    expect(mocks.bootstrapFirstAdmin).not.toHaveBeenCalled();
  });
});
