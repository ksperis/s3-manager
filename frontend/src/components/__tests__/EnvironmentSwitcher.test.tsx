import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { GeneralSettings } from "../../api/appSettings";
import EnvironmentSwitcher from "../EnvironmentSwitcher";

const mocks = vi.hoisted(() => ({
  generalSettings: {} as GeneralSettings,
  listExecutionContexts: vi.fn(),
}));

vi.mock("../GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: mocks.listExecutionContexts,
}));

const baseSettings: GeneralSettings = {
  manager_enabled: true,
  ceph_admin_enabled: false,
  storage_ops_enabled: false,
  browser_enabled: true,
  browser_root_enabled: true,
  browser_manager_enabled: true,
  browser_portal_enabled: true,
  browser_ceph_admin_enabled: false,
  portal_enabled: true,
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

function CurrentPathProbe() {
  const location = useLocation();
  return <output aria-label="Current path">{location.pathname}</output>;
}

function renderSwitcher(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <EnvironmentSwitcher />
              <CurrentPathProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function storePortalAdminUser() {
  window.localStorage.setItem(
    "user",
    JSON.stringify({
      id: 1,
      email: "admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 101, account_admin: true, account_role: "portal_manager" }],
    })
  );
}

describe("EnvironmentSwitcher Portal workspace", () => {
  beforeEach(() => {
    mocks.generalSettings = { ...baseSettings };
    mocks.listExecutionContexts.mockResolvedValue([]);
    storePortalAdminUser();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("recognizes Portal as the current workspace and persists it", async () => {
    const user = userEvent.setup();
    renderSwitcher("/portal");

    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveTextContent("Portal (self-service)");

    await waitFor(() => {
      expect(window.localStorage.getItem("selectedWorkspace")).toBe("portal");
    });

    await user.click(trigger);
    const portalOption = await screen.findByRole("option", { name: /Portal \(self-service\)/ });
    expect(portalOption).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Admin \(platform\)/ })).toBeInTheDocument();
  });

  it("navigates away from Portal without clearing the selected portal account", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("selectedPortalAccountId", "101");
    renderSwitcher("/portal");

    await user.click(screen.getByRole("button", { name: "Switch workspace" }));
    await user.click(await screen.findByRole("option", { name: /Admin \(platform\)/ }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent("/admin");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("admin");
    expect(window.localStorage.getItem("selectedPortalAccountId")).toBe("101");
  });
});
