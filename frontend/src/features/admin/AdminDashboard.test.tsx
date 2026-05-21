import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralSettings } from "../../api/appSettings";
import AdminDashboard from "./AdminDashboard";

const mocks = vi.hoisted(() => ({
  dismissOnboarding: vi.fn(),
  fetchAdminSummary: vi.fn(),
  fetchHealthSummary: vi.fn(),
  fetchHealthWorkspaceOverview: vi.fn(),
  fetchOnboardingStatus: vi.fn(),
  generalSettings: {} as GeneralSettings,
  getBillingSummary: vi.fn(),
}));

vi.mock("../../api/billing", () => ({
  getBillingSummary: mocks.getBillingSummary,
}));

vi.mock("../../api/healthchecks", () => ({
  fetchHealthSummary: mocks.fetchHealthSummary,
  fetchHealthWorkspaceOverview: mocks.fetchHealthWorkspaceOverview,
}));

vi.mock("../../api/onboarding", () => ({
  dismissOnboarding: mocks.dismissOnboarding,
  fetchOnboardingStatus: mocks.fetchOnboardingStatus,
}));

vi.mock("../../api/stats", () => ({
  fetchAdminSummary: mocks.fetchAdminSummary,
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

function buildGeneralSettings(overrides: Partial<GeneralSettings> = {}): GeneralSettings {
  return {
    manager_enabled: true,
    ceph_admin_enabled: false,
    storage_ops_enabled: false,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_ceph_admin_enabled: true,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: false,
    bucket_compare_enabled: false,
    bucket_integrity_check_enabled: false,
    manager_ceph_s3_user_keys_enabled: false,
    allow_ui_user_bucket_migration: false,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: false,
    ...overrides,
  };
}

async function renderDashboard(role = "ui_superadmin") {
  window.localStorage.setItem("user", JSON.stringify({ role }));

  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>
  );

  await screen.findByText("Shared S3 Connections");
}

describe("AdminDashboard core feature cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.generalSettings = buildGeneralSettings();
    mocks.fetchAdminSummary.mockResolvedValue({
      assigned_accounts: 0,
      assigned_s3_users: 0,
      total_accounts: 0,
      total_admins: 0,
      total_ceph_endpoints: 0,
      total_connections: 0,
      total_endpoints: 0,
      total_none_users: 0,
      total_other_endpoints: 0,
      total_private_connections: 0,
      total_s3_users: 0,
      total_shared_connections: 0,
      total_users: 0,
      unassigned_accounts: 0,
      unassigned_s3_users: 0,
    });
    mocks.fetchOnboardingStatus.mockResolvedValue({
      can_dismiss: true,
      dismissed: true,
      endpoint_configured: true,
      seed_user_configured: true,
    });
  });

  it("renders all core features with enabled and disabled states", async () => {
    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Core features" })).toBeInTheDocument();
    expect(screen.getByText("2 / 4 enabled")).toBeInTheDocument();

    const managerCard = screen.getByRole("link", { name: /Manager/i });
    const browserCard = screen.getByRole("link", { name: /Browser/i });
    const cephAdminCard = screen.getByRole("link", { name: /Ceph Admin/i });
    const storageOpsCard = screen.getByRole("link", { name: /Storage Ops/i });

    expect(managerCard).toHaveClass("border-emerald-200");
    expect(browserCard).toHaveClass("border-emerald-200");
    expect(within(managerCard).getByText("ON")).toBeInTheDocument();
    expect(within(browserCard).getByText("ON")).toBeInTheDocument();

    expect(cephAdminCard).toHaveClass("border-slate-200");
    expect(storageOpsCard).toHaveClass("border-slate-200");
    expect(within(cephAdminCard).getByText("OFF")).toBeInTheDocument();
    expect(within(storageOpsCard).getByText("OFF")).toBeInTheDocument();
    expect(screen.getAllByText("Mass management")).toHaveLength(2);
  });

  it("keeps mass-management feature cards green when enabled and shows the orange tag", async () => {
    mocks.generalSettings = buildGeneralSettings({
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
    });

    await renderDashboard();

    const cephAdminCard = screen.getByRole("link", { name: /Ceph Admin/i });
    const storageOpsCard = screen.getByRole("link", { name: /Storage Ops/i });

    expect(cephAdminCard).toHaveClass("border-emerald-200");
    expect(storageOpsCard).toHaveClass("border-emerald-200");
    expect(within(cephAdminCard).getByText("ON")).toBeInTheDocument();
    expect(within(storageOpsCard).getByText("ON")).toBeInTheDocument();

    const massManagementTags = screen.getAllByText("Mass management");
    expect(massManagementTags).toHaveLength(2);
    massManagementTags.forEach((tag) => {
      expect(tag).toHaveClass("border-amber-200");
    });
  });

  it("links feature cards to general settings for superadmins", async () => {
    await renderDashboard("ui_superadmin");

    expect(screen.getByRole("link", { name: /Manager/i })).toHaveAttribute("href", "/admin/general-settings");
    expect(screen.getByRole("link", { name: /Browser/i })).toHaveAttribute("href", "/admin/general-settings");
    expect(screen.getByRole("link", { name: /Ceph Admin/i })).toHaveAttribute("href", "/admin/general-settings");
    expect(screen.getByRole("link", { name: /Storage Ops/i })).toHaveAttribute("href", "/admin/general-settings");
  });

  it("renders feature cards as read-only for non-superadmin admins", async () => {
    await renderDashboard("ui_admin");

    expect(screen.getByText("Superadmin required")).toBeInTheDocument();
    expect(screen.getByText("Manager").closest("a")).toBeNull();
    expect(screen.getByText("Browser").closest("a")).toBeNull();
    expect(screen.getByText("Ceph Admin").closest("a")).toBeNull();
    expect(screen.getByText("Storage Ops").closest("a")).toBeNull();
  });
});
