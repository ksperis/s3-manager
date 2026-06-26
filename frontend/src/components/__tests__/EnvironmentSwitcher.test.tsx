import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { GeneralSettings } from "../../api/appSettings";
import { useWorkspaceSwitcherModel } from "../EnvironmentSwitcher";

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
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

vi.mock("../../api/users", () => ({
  fetchCurrentUser: mocks.fetchCurrentUser,
}));

const baseSettings: GeneralSettings = {
  billing_enabled: false,
  endpoint_status_enabled: false,
  quota_alerts_enabled: false,
  usage_history_enabled: false,
  bucket_migration_enabled: true,
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_usage_stats_enabled: true,
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

function WorkspaceSwitcherModelHarness() {
  const model = useWorkspaceSwitcherModel();
  if (!model) {
    return (
      <>
        <p>No workspace switcher</p>
        <CurrentPathProbe />
      </>
    );
  }

  return (
    <>
      <CurrentPathProbe />
      <output aria-label="Current workspace id">{model.currentWorkspaceId}</output>
      <output aria-label="Current workspace">{model.currentWorkspaceLabel}</output>
      <ul aria-label="Workspace options">
        {model.options.map((option) => (
          <li key={option.value}>{option.label}</li>
        ))}
      </ul>
      {model.options.map((option) => (
        <button key={option.value} type="button" onClick={() => model.onChange(option.value)}>
          Go {option.label}
        </button>
      ))}
    </>
  );
}

function renderSwitcherModel(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<WorkspaceSwitcherModelHarness />} />
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

function storePlainAdminUser() {
  window.localStorage.setItem(
    "user",
    JSON.stringify({
      id: 2,
      email: "plain-admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 101, account_admin: true, account_role: "portal_none" }],
    })
  );
}

describe("useWorkspaceSwitcherModel Portal workspace", () => {
  beforeEach(() => {
    mocks.generalSettings = { ...baseSettings };
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 101, account_admin: true, account_role: "portal_manager" }],
    });
    mocks.listExecutionContexts.mockResolvedValue([]);
    storePortalAdminUser();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("recognizes Portal as the current workspace and persists it", async () => {
    renderSwitcherModel("/portal");

    expect(screen.getByLabelText("Current workspace id")).toHaveTextContent("portal");
    expect(screen.getByLabelText("Current workspace")).toHaveTextContent("Portal (self-service)");
    const options = within(screen.getByRole("list", { name: "Workspace options" }));
    expect(options.getByText("Portal (self-service)")).toBeInTheDocument();
    expect(options.getByText("Admin (platform)")).toBeInTheDocument();

    await waitFor(() => {
      expect(window.localStorage.getItem("selectedWorkspace")).toBe("portal");
    });
  });

  it("navigates away from Portal without clearing the selected portal account", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("selectedPortalAccountId", "101");
    renderSwitcherModel("/portal");

    await user.click(screen.getByRole("button", { name: "Go Admin (platform)" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent("/admin");
    expect(window.localStorage.getItem("selectedWorkspace")).toBe("admin");
    expect(window.localStorage.getItem("selectedPortalAccountId")).toBe("101");
  });

  it("omits Portal from the model for admins without an explicit portal account role", () => {
    storePlainAdminUser();
    renderSwitcherModel("/admin");

    const options = within(screen.getByRole("list", { name: "Workspace options" }));
    expect(options.queryByText("Portal (self-service)")).not.toBeInTheDocument();
    expect(options.getByText("Admin (platform)")).toBeInTheDocument();
  });

  it("refreshes the stored user before deciding Portal is unavailable", async () => {
    window.localStorage.setItem("token", "test-token");
    storePlainAdminUser();
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 2,
      email: "plain-admin@example.com",
      role: "ui_superadmin",
      authType: "password",
      account_links: [{ account_id: 101, account_admin: true, account_role: "portal_manager" }],
    });

    renderSwitcherModel("/admin");

    await waitFor(() => {
      const options = within(screen.getByRole("list", { name: "Workspace options" }));
      expect(options.getByText("Portal (self-service)")).toBeInTheDocument();
    });
    expect(JSON.parse(window.localStorage.getItem("user") ?? "{}").account_links[0].account_role).toBe(
      "portal_manager"
    );
  });
});
