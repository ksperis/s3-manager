import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { GeneralSettings } from "../../api/appSettings";
import { useWorkspaceSwitcherModel } from "../EnvironmentSwitcher";
import { readStoredUser, setSessionUserCache } from "../../utils/workspaces";

const mocks = vi.hoisted(() => ({
  fetchCurrentUser: vi.fn(),
  generalSettings: {} as GeneralSettings,
  getWorkspaceAccess: vi.fn(),
  sessionUser: null as Record<string, unknown> | null,
}));

vi.mock("../../auth/SessionProvider", () => ({
  useSession: () => ({
    authenticated: Boolean(mocks.sessionUser),
    loading: false,
    user: mocks.sessionUser,
  }),
}));

vi.mock("../GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("../../api/executionContexts", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));

vi.mock("../../api/users", () => ({
  fetchCurrentUser: mocks.fetchCurrentUser,
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
  bucket_purge_enabled: false,
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  bucket_usage_stats_enabled: true,
  bucket_quota_management_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
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
  const user = {
      id: 1,
      email: "admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 101, role: "account_administrator" }],
  };
  mocks.sessionUser = user;
  window.localStorage.setItem("user", JSON.stringify(user));
}

function storePlainAdminUser() {
  const user = {
      id: 2,
      email: "plain-admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [],
  };
  mocks.sessionUser = user;
  window.localStorage.setItem("user", JSON.stringify(user));
}

describe("useWorkspaceSwitcherModel Portal workspace", () => {
  beforeEach(() => {
    setSessionUserCache(null);
    mocks.generalSettings = { ...baseSettings };
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      role: "ui_admin",
      authType: "password",
      account_links: [{ account_id: 101, role: "account_administrator" }],
    });
    mocks.getWorkspaceAccess.mockResolvedValue({
      admin: { available: true, context_count: 1 },
      ceph_admin: { available: false, context_count: 0 },
      storage_ops: { available: false, context_count: 0 },
      manager: { available: false, context_count: 0 },
      browser: { available: false, context_count: 0 },
      portal: { available: true, context_count: 1 },
      default_workspace: "admin",
    });
    storePortalAdminUser();
  });

  afterEach(() => {
    setSessionUserCache(null);
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

  it("omits Portal from the model for admins without an explicit portal account role", async () => {
    storePlainAdminUser();
    mocks.getWorkspaceAccess.mockResolvedValue({
      admin: { available: true, context_count: 1 },
      ceph_admin: { available: false, context_count: 0 },
      storage_ops: { available: false, context_count: 0 },
      manager: { available: false, context_count: 0 },
      browser: { available: false, context_count: 0 },
      portal: { available: false, context_count: 0 },
      default_workspace: "admin",
    });
    renderSwitcherModel("/admin");

    await waitFor(() => {
      expect(mocks.getWorkspaceAccess).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Portal (self-service)")).not.toBeInTheDocument();
    expect(screen.getByText("No workspace switcher")).toBeInTheDocument();
  });

  it("refreshes the stored user before deciding Portal is unavailable", async () => {
    storePlainAdminUser();
    mocks.fetchCurrentUser.mockResolvedValue({
      id: 2,
      email: "plain-admin@example.com",
      role: "ui_superadmin",
      authType: "password",
      account_links: [{ account_id: 101, role: "account_administrator" }],
    });

    renderSwitcherModel("/admin");

    await waitFor(() => {
      const options = within(screen.getByRole("list", { name: "Workspace options" }));
      expect(options.getByText("Portal (self-service)")).toBeInTheDocument();
    });
    expect(readStoredUser()?.account_links?.[0]?.role).toBe(
      "account_administrator"
    );
  });

  it("shows only workspaces backed by an authorized execution context", async () => {
    mocks.generalSettings = {
      ...baseSettings,
      storage_ops_enabled: true,
    };
    const portalOnlyUser = {
        id: 3,
        email: "portal-only@example.com",
        role: "ui_user",
        authType: "password",
        can_access_storage_ops: true,
        account_links: [{ account_id: 101, role: "portal_user" }],
    };
    mocks.sessionUser = portalOnlyUser;
    mocks.fetchCurrentUser.mockResolvedValue(portalOnlyUser);
    window.localStorage.setItem("user", JSON.stringify(portalOnlyUser));
    mocks.getWorkspaceAccess.mockResolvedValue({
      admin: { available: false, context_count: 0 },
      ceph_admin: { available: false, context_count: 0 },
      storage_ops: { available: false, context_count: 0 },
      manager: { available: false, context_count: 0 },
      browser: { available: false, context_count: 0 },
      portal: { available: true, context_count: 1 },
      default_workspace: "portal",
    });

    renderSwitcherModel("/portal");

    await waitFor(() => {
      expect(mocks.getWorkspaceAccess).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("No workspace switcher")).toBeInTheDocument();
    expect(screen.queryByText("Storage Ops")).not.toBeInTheDocument();
    expect(screen.queryByText("Manager (admin tenant)")).not.toBeInTheDocument();
    expect(screen.queryByText("Browser (objects)")).not.toBeInTheDocument();
  });
});
