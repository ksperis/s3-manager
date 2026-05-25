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
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: true,
    portal_enabled: false,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: false,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
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

describe("AdminDashboard feature summary", () => {
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
    mocks.getBillingSummary.mockResolvedValue({
      coverage: {
        days_collected: 31,
      },
    });
    mocks.fetchHealthSummary.mockResolvedValue({
      generated_at: "2026-05-25T00:00:00Z",
      endpoints: [],
    });
    mocks.fetchHealthWorkspaceOverview.mockResolvedValue({
      generated_at: "2026-05-25T00:00:00Z",
      incident_highlight_minutes: 720,
      endpoint_count: 0,
      up_count: 0,
      degraded_count: 0,
      down_count: 0,
      unknown_count: 0,
      endpoints: [],
      incidents: [],
    });
  });

  it("renders exactly two compact feature summary cards with enabled features only", async () => {
    mocks.generalSettings = buildGeneralSettings({
      portal_enabled: true,
      ceph_admin_enabled: true,
      billing_enabled: true,
      usage_history_enabled: true,
    });

    await renderDashboard();

    expect(screen.getAllByRole("region", { name: /features summary/i })).toHaveLength(2);
    expect(screen.queryByText("Configure features")).not.toBeInTheDocument();

    const coreSummary = screen.getByRole("region", { name: "Core features summary" });
    const extraSummary = screen.getByRole("region", { name: "Extra features summary" });

    expect(within(coreSummary).getByRole("heading", { name: "Core features" })).toBeInTheDocument();
    expect(within(coreSummary).getByText("4 enabled")).toBeInTheDocument();
    expect(within(coreSummary).getByText("Manager")).toBeInTheDocument();
    expect(within(coreSummary).getByText("Browser")).toBeInTheDocument();
    expect(within(coreSummary).getByText("Portal")).toBeInTheDocument();
    expect(within(coreSummary).getByText("Ceph Admin")).toBeInTheDocument();
    expect(within(coreSummary).queryByText("Storage Ops")).not.toBeInTheDocument();

    expect(within(extraSummary).getByRole("heading", { name: "Extra features" })).toBeInTheDocument();
    expect(within(extraSummary).getByText("2 enabled")).toBeInTheDocument();
    expect(within(extraSummary).getByText("Billing")).toBeInTheDocument();
    expect(within(extraSummary).getByText("Usage history")).toBeInTheDocument();
    expect(within(extraSummary).queryByText("Endpoint Status")).not.toBeInTheDocument();
    expect(within(extraSummary).queryByText("Quota alerts")).not.toBeInTheDocument();
  });

  it("shows compact mass-management markers only for enabled mass-management features", async () => {
    mocks.generalSettings = buildGeneralSettings({
      manager_enabled: false,
      browser_enabled: false,
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
    });

    await renderDashboard();

    const coreSummary = screen.getByRole("region", { name: "Core features summary" });

    expect(within(coreSummary).getByText("Ceph Admin")).toBeInTheDocument();
    expect(within(coreSummary).getByText("Storage Ops")).toBeInTheDocument();
    expect(within(coreSummary).getAllByTitle("Mass management")).toHaveLength(2);
    expect(within(coreSummary).getAllByText("MM")).toHaveLength(2);
  });

  it("shows a muted empty state when a feature group has no enabled features", async () => {
    mocks.generalSettings = buildGeneralSettings({
      manager_enabled: false,
      browser_enabled: false,
    });

    await renderDashboard();

    const coreSummary = screen.getByRole("region", { name: "Core features summary" });
    const extraSummary = screen.getByRole("region", { name: "Extra features summary" });

    expect(within(coreSummary).getByText("0 enabled")).toBeInTheDocument();
    expect(within(coreSummary).getByText("None enabled")).toBeInTheDocument();
    expect(within(extraSummary).getByText("0 enabled")).toBeInTheDocument();
    expect(within(extraSummary).getByText("None enabled")).toBeInTheDocument();
  });

  it("renders feature summaries without feature configuration links or disabled badges", async () => {
    await renderDashboard("ui_superadmin");

    const coreSummary = screen.getByRole("region", { name: "Core features summary" });

    expect(screen.queryByText("Configure features")).not.toBeInTheDocument();
    expect(screen.queryByText("Superadmin required")).not.toBeInTheDocument();
    expect(screen.queryByText("OFF")).not.toBeInTheDocument();
    expect(screen.queryByText("ON")).not.toBeInTheDocument();
    ["Manager", "Browser"].forEach((label) => {
      expect(within(coreSummary).getByText(label).closest("a")).toBeNull();
    });
  });
});
