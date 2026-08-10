import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import AccountProfilePage from "./AccountProfilePage";

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({ generalSettings: {} }),
}));

vi.mock("./ProfilePage", () => ({
  default: ({ showConnectionsSection, onUnsavedChangesChange }: { showConnectionsSection?: boolean; onUnsavedChangesChange?: (dirty: boolean) => void }) => (
    <div>
      {showConnectionsSection ? "Connections content" : "Profile content"}
      <button type="button" onClick={() => onUnsavedChangesChange?.(true)}>Make dirty</button>
    </div>
  ),
}));

vi.mock("../admin/ApiTokensPage", () => ({
  default: () => <div>API tokens content</div>,
}));

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}

function renderPage(initialEntry = "/profile") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/profile" element={<><AccountProfilePage /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AccountProfilePage", () => {
  beforeEach(() => {
    window.localStorage.setItem("user", JSON.stringify({
      role: "ui_superadmin",
      authType: "password",
      effective_access: {
        can_create_manual_private_connections: true,
        can_provision_managed_private_connections: false,
        has_owned_private_connections: false,
      },
    }));
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows permitted tabs and synchronizes the selected tab with the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByText("Profile content")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Private S3 connections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "API tokens" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Private S3 connections" }));
    expect(screen.getByText("Connections content")).toBeInTheDocument();
    expect(screen.getByText("/profile?tab=connections")).toBeInTheDocument();
  });

  it("hides forbidden tabs and replaces a forbidden direct URL with profile", async () => {
    window.localStorage.setItem("user", JSON.stringify({ role: "ui_user", authType: "password" }));
    renderPage("/profile?tab=api-tokens");

    expect(screen.queryByRole("button", { name: "Private S3 connections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "API tokens" })).not.toBeInTheDocument();
    expect(await screen.findByText("/profile?tab=profile")).toBeInTheDocument();
  });

  it("keeps the connections tab after permission revocation when a connection is owned", () => {
    window.localStorage.setItem("user", JSON.stringify({
      role: "ui_user",
      authType: "password",
      effective_access: {
        can_create_manual_private_connections: false,
        can_provision_managed_private_connections: false,
        has_owned_private_connections: true,
      },
    }));

    renderPage();

    expect(screen.getByRole("tab", { name: "Private S3 connections" })).toBeInTheDocument();
  });

  it("protects dirty content before changing tabs", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    await user.click(screen.getByRole("button", { name: "Make dirty" }));
    await user.click(screen.getByRole("tab", { name: "API tokens" }));

    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved changes?");
    expect(screen.getByText("Profile content")).toBeInTheDocument();
  });
});
