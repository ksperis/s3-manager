import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneralSettings } from "../../api/appSettings";
import AdminDashboard from "./AdminDashboard";

const mocks = vi.hoisted(() => ({
  dismissOnboarding: vi.fn(),
  fetchAdminSummary: vi.fn(),
  fetchAdminStorage: vi.fn(),
  fetchAdminTraffic: vi.fn(),
  fetchHealthOverview: vi.fn(),
  fetchHealthSummary: vi.fn(),
  fetchHealthWorkspaceOverview: vi.fn(),
  fetchOnboardingStatus: vi.fn(),
  generalSettings: {} as GeneralSettings,
  listAuditLogs: vi.fn(),
}));

vi.mock("../../api/audit", () => ({
  listAuditLogs: mocks.listAuditLogs,
}));

vi.mock("../../api/healthchecks", () => ({
  fetchHealthOverview: mocks.fetchHealthOverview,
  fetchHealthSummary: mocks.fetchHealthSummary,
  fetchHealthWorkspaceOverview: mocks.fetchHealthWorkspaceOverview,
}));

vi.mock("../../api/onboarding", () => ({
  dismissOnboarding: mocks.dismissOnboarding,
  fetchOnboardingStatus: mocks.fetchOnboardingStatus,
}));

vi.mock("../../api/stats", () => ({
  fetchAdminSummary: mocks.fetchAdminSummary,
  fetchAdminStorage: mocks.fetchAdminStorage,
  fetchAdminTraffic: mocks.fetchAdminTraffic,
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
    mocks.fetchAdminStorage.mockResolvedValue({
      total_accounts: 12,
      total_users: 0,
      total_admins: 1,
      total_s3_users: 12,
      total_buckets: 1850,
      generated_at: "2026-06-05T11:16:46Z",
      storage_totals: {
        used_bytes: 5_320_000_000_000_000,
        object_count: 2_140_000_000,
        bucket_count: 1850,
        accounts_with_usage: 12,
      },
      account_usage: [],
      s3_user_usage: [],
    });
    mocks.fetchAdminTraffic.mockResolvedValue({
      window: "day",
      start: "2026-06-04T11:16:46Z",
      end: "2026-06-05T11:16:46Z",
      resolution: "hour",
      data_points: 3,
      series: [
        { timestamp: "2026-06-05T09:00:00Z", bytes_in: 1, bytes_out: 2, ops: 100, success_ops: 98 },
        { timestamp: "2026-06-05T10:00:00Z", bytes_in: 1, bytes_out: 2, ops: 160, success_ops: 158 },
        { timestamp: "2026-06-05T11:00:00Z", bytes_in: 1, bytes_out: 2, ops: 120, success_ops: 119 },
      ],
      totals: {
        bytes_in: 3,
        bytes_out: 6,
        ops: 12_400_000,
        success_ops: 12_200_000,
        success_rate: 0.984,
      },
      bucket_rankings: [],
      user_rankings: [],
      request_breakdown: [],
      category_breakdown: [],
    });
    mocks.fetchOnboardingStatus.mockResolvedValue({
      can_dismiss: true,
      dismissed: true,
      endpoint_configured: true,
      seed_user_configured: true,
    });
    mocks.fetchHealthSummary.mockResolvedValue({
      generated_at: "2026-05-25T00:00:00Z",
      endpoints: [
        {
          endpoint_id: 1,
          name: "INRAE-eprod-debug",
          endpoint_url: "https://s3.example.test",
          status: "up",
          checked_at: new Date().toISOString(),
          latency_ms: 76,
          check_mode: "http",
        },
      ],
    });
    mocks.fetchHealthOverview.mockResolvedValue({
      generated_at: "2026-06-05T11:16:46Z",
      window: "week",
      start: "2026-05-29T11:16:46Z",
      end: "2026-06-05T11:16:46Z",
      endpoints: [
        {
          endpoint_id: 1,
          name: "INRAE-eprod-debug",
          endpoint_url: "https://s3.example.test",
          status: "up",
          checked_at: "2026-06-05T11:15:00Z",
          latency_ms: 76,
          check_mode: "http",
          availability_pct: 100,
          baseline_latency_ms: 80,
          timeline: [],
        },
        {
          endpoint_id: 2,
          name: "INRAE-eprod-idf",
          endpoint_url: "https://s3-idf.example.test",
          status: "down",
          checked_at: "2026-06-05T11:15:00Z",
          latency_ms: null,
          check_mode: "http",
          availability_pct: 96,
          baseline_latency_ms: null,
          timeline: [],
        },
      ],
    });
    mocks.fetchHealthWorkspaceOverview.mockResolvedValue({
      generated_at: "2026-05-25T00:00:00Z",
      incident_highlight_minutes: 10080,
      endpoint_count: 9,
      up_count: 8,
      degraded_count: 0,
      down_count: 1,
      unknown_count: 0,
      endpoints: [
        {
          endpoint_id: 1,
          name: "INRAE-eprod-debug",
          endpoint_url: "https://s3.example.test",
          status: "up",
          checked_at: "2026-06-05T11:15:00Z",
          latency_ms: 76,
          check_mode: "http",
        },
        {
          endpoint_id: 2,
          name: "INRAE-eprod-idf",
          endpoint_url: "https://s3-idf.example.test",
          status: "down",
          checked_at: "2026-06-05T11:15:00Z",
          latency_ms: null,
          check_mode: "http",
        },
      ],
      incidents: [
        {
          endpoint_id: 2,
          endpoint_name: "INRAE-eprod-idf",
          status: "down",
          start: "2026-06-05T07:55:00Z",
          end: null,
          duration_minutes: null,
          check_mode: "http",
          ongoing: true,
          recent: true,
        },
      ],
    });
    mocks.listAuditLogs.mockResolvedValue({
      logs: [
        {
          id: 1,
          created_at: "2026-06-05T11:14:00Z",
          user_email: "admin@example.com",
          user_role: "ui_superadmin",
          scope: "admin",
          action: "auth.login",
          entity_type: "user",
          entity_id: "admin@example.com",
          status: "success",
        },
      ],
      next_cursor: null,
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

  it("renders the redesigned dashboard sections with real health, metrics, and activity data", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: true,
      portal_enabled: true,
      ceph_admin_enabled: true,
      storage_ops_enabled: true,
    });
    mocks.fetchAdminSummary.mockResolvedValue({
      assigned_accounts: 124,
      assigned_s3_users: 12,
      total_accounts: 124,
      total_admins: 1,
      total_ceph_endpoints: 8,
      total_connections: 3,
      total_endpoints: 9,
      total_none_users: 0,
      total_other_endpoints: 1,
      total_private_connections: 0,
      total_s3_users: 12,
      total_shared_connections: 3,
      total_users: 0,
      unassigned_accounts: 0,
      unassigned_s3_users: 0,
    });

    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Admin overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Endpoint Health" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ongoing / Recent Incidents" })).toBeInTheDocument();
    expect(screen.getByText("Ongoing incidents and incidents ended in the last 7 days.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all incidents" })).toHaveAttribute("href", "/admin/endpoint-status");
    const platformSummary = screen.getByRole("heading", { name: "Platform summary" }).closest("section");
    expect(platformSummary).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
    expect(screen.getByText("INRAE-eprod-debug")).toBeInTheDocument();
    expect(screen.getAllByText("INRAE-eprod-idf").length).toBeGreaterThan(0);
    expect(screen.getByText("12.4M")).toBeInTheDocument();
    expect(within(platformSummary!).getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("User admin@example.com logged in")).toBeInTheDocument();
    expect(mocks.listAuditLogs).toHaveBeenCalledWith({ limit: 3 });
    expect(mocks.fetchAdminTraffic).toHaveBeenCalledWith("day");
    expect(mocks.fetchHealthOverview).toHaveBeenCalledWith("week");
    expect(mocks.fetchHealthWorkspaceOverview).toHaveBeenCalledWith(undefined, 10080);
  });

  it("keeps the admin incident card visible when no incidents are returned", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: true,
    });
    mocks.fetchHealthWorkspaceOverview.mockResolvedValue({
      generated_at: "2026-05-25T00:00:00Z",
      incident_highlight_minutes: 10080,
      endpoint_count: 1,
      up_count: 1,
      degraded_count: 0,
      down_count: 0,
      unknown_count: 0,
      endpoints: [
        {
          endpoint_id: 1,
          name: "INRAE-eprod-debug",
          endpoint_url: "https://s3.example.test",
          status: "up",
          checked_at: "2026-06-05T11:15:00Z",
          latency_ms: 76,
          check_mode: "http",
        },
      ],
      incidents: [],
    });

    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Ongoing / Recent Incidents" })).toBeInTheDocument();
    expect(screen.getByText("Ongoing incidents and incidents ended in the last 7 days.")).toBeInTheDocument();
    expect(await screen.findByText("No ongoing or recent incidents.")).toBeInTheDocument();
  });

  it("keeps endpoint status visible as a blurred mock card when the feature is disabled", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: false,
    });

    await renderDashboard();

    expect(screen.getAllByText("Endpoint Status feature is disabled.").length).toBeGreaterThan(0);
    expect(screen.getByText("Endpoint Health")).toBeInTheDocument();
    expect(mocks.fetchHealthOverview).not.toHaveBeenCalled();
    expect(mocks.fetchHealthWorkspaceOverview).not.toHaveBeenCalled();
  });

  it("keeps platform cards present with a discrete reason when metrics are unavailable", async () => {
    mocks.fetchAdminStorage.mockRejectedValue(new Error("metrics disabled"));
    mocks.fetchAdminTraffic.mockRejectedValue(new Error("usage disabled"));

    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Platform summary" })).toBeInTheDocument();
    expect(screen.getAllByText("metrics disabled").length).toBeGreaterThan(0);
    expect(screen.getAllByText("usage disabled").length).toBeGreaterThan(0);
  });

  it("keeps recent activity present with a blurred mock list when audit logs are unavailable", async () => {
    mocks.listAuditLogs.mockRejectedValue(new Error("audit unavailable"));

    await renderDashboard();

    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(await screen.findByText("audit unavailable")).toBeInTheDocument();
  });
});
