import { render, screen, waitFor, within } from "@testing-library/react";
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
  listStorageEndpoints: vi.fn(),
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

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: mocks.listStorageEndpoints,
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
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: false,
    bucket_purge_enabled: false,
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
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 1,
        name: "INRAE-eprod-debug",
        endpoint_url: "https://s3.example.test",
        provider: "ceph",
        force_path_style: false,
        verify_tls: true,
        latitude: 48.8566,
        longitude: 2.3522,
        is_default: true,
        is_editable: true,
        tags: [],
        has_admin_secret: false,
        has_supervision_secret: false,
        has_ceph_admin_secret: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        name: "INRAE-eprod-idf",
        endpoint_url: "https://s3-idf.example.test",
        provider: "ceph",
        force_path_style: false,
        verify_tls: true,
        latitude: 48.0707,
        longitude: -0.7702,
        is_default: false,
        is_editable: true,
        tags: [],
        has_admin_secret: false,
        has_supervision_secret: false,
        has_ceph_admin_secret: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
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

  it("renders the compact operational feature summary with enabled features only", async () => {
    mocks.generalSettings = buildGeneralSettings({
      billing_enabled: true,
      usage_history_enabled: true,
    });

    await renderDashboard();

    expect(screen.getAllByRole("region", { name: /features summary/i })).toHaveLength(1);
    expect(screen.queryByText("Configure features")).not.toBeInTheDocument();

    const operationalSummary = screen.getByRole("region", { name: "Operational features summary" });

    expect(within(operationalSummary).getByRole("heading", { name: "Operational features" })).toBeInTheDocument();
    expect(within(operationalSummary).getByText("2 enabled")).toBeInTheDocument();
    expect(within(operationalSummary).getByText("Billing")).toBeInTheDocument();
    expect(within(operationalSummary).getByText("Usage history")).toBeInTheDocument();
    expect(within(operationalSummary).queryByText("Endpoint Status")).not.toBeInTheDocument();
    expect(within(operationalSummary).queryByText("Quota alerts")).not.toBeInTheDocument();
  });

  it("does not render mass-management markers for operational features", async () => {
    mocks.generalSettings = buildGeneralSettings({
      billing_enabled: true,
      endpoint_status_enabled: true,
    });

    await renderDashboard();

    const operationalSummary = screen.getByRole("region", { name: "Operational features summary" });

    expect(within(operationalSummary).getByText("Billing")).toBeInTheDocument();
    expect(within(operationalSummary).getByText("Endpoint Status")).toBeInTheDocument();
    expect(within(operationalSummary).queryByTitle("Mass management")).not.toBeInTheDocument();
    expect(within(operationalSummary).queryByText("MM")).not.toBeInTheDocument();
  });

  it("shows a muted empty state when a feature group has no enabled features", async () => {
    mocks.generalSettings = buildGeneralSettings({
    });

    await renderDashboard();

    const operationalSummary = screen.getByRole("region", { name: "Operational features summary" });

    expect(within(operationalSummary).getByText("0 enabled")).toBeInTheDocument();
    expect(within(operationalSummary).getByText("None enabled")).toBeInTheDocument();
  });

  it("renders feature summaries without feature configuration links or disabled badges", async () => {
    mocks.generalSettings = buildGeneralSettings({
      billing_enabled: true,
    });

    await renderDashboard("ui_superadmin");

    const operationalSummary = screen.getByRole("region", { name: "Operational features summary" });

    expect(screen.queryByText("Configure features")).not.toBeInTheDocument();
    expect(screen.queryByText("Superadmin required")).not.toBeInTheDocument();
    expect(screen.queryByText("OFF")).not.toBeInTheDocument();
    expect(screen.queryByText("ON")).not.toBeInTheDocument();
    expect(within(operationalSummary).getByText("Billing").closest("a")).toBeNull();
  });

  it("renders the redesigned dashboard sections with real health, metrics, and activity data", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: true,
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
    const infrastructureMap = await screen.findByRole("img", { name: "Infrastructure endpoint map" });
    expect(infrastructureMap).toBeInTheDocument();
    expect(infrastructureMap).toHaveAttribute("preserveAspectRatio", "xMidYMid meet");
    expect(infrastructureMap.closest("div")).toHaveClass("h-[220px]");
    const geography = screen.getByTestId("admin-dashboard-map-geography");
    expect(geography).toHaveAttribute("data-basemap", "france");
    expect(geography).toHaveAttribute("data-x-scale", "0.69");
    expect(screen.getAllByTestId("admin-dashboard-map-marker")).toHaveLength(2);
    expect(infrastructureMap.querySelector("polyline")).toBeNull();
    expect(screen.getByText("Infrastructure map")).toBeInTheDocument();
    expect(screen.getByText("12.4M")).toBeInTheDocument();
    expect(within(platformSummary!).getByText("98%")).toBeInTheDocument();
    expect(screen.getByText("User admin@example.com logged in")).toBeInTheDocument();
    expect(mocks.listAuditLogs).toHaveBeenCalledWith({ limit: 3 });
    expect(mocks.fetchAdminTraffic).toHaveBeenCalledWith("day");
    expect(mocks.fetchHealthOverview).toHaveBeenCalledWith("week");
    expect(mocks.fetchHealthWorkspaceOverview).toHaveBeenCalledWith(undefined, 10080);
    expect(mocks.listStorageEndpoints).toHaveBeenCalled();
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

  it("keeps endpoint status visible without fallback values when the feature is disabled", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: false,
    });

    await renderDashboard();

    expect(screen.getByText("Endpoint Health")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ongoing / Recent Incidents" })).toBeInTheDocument();
    expect(screen.queryByText("Endpoint Status feature is disabled.")).not.toBeInTheDocument();
    expect(screen.queryByText("INRAE-eprod-geo-tls")).not.toBeInTheDocument();
    expect(screen.queryByText("LAB 81")).not.toBeInTheDocument();
    expect(screen.queryByText("98%")).not.toBeInTheDocument();
    expect(mocks.fetchHealthOverview).not.toHaveBeenCalled();
    expect(mocks.fetchHealthWorkspaceOverview).not.toHaveBeenCalled();
    expect(mocks.listStorageEndpoints).not.toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Infrastructure endpoint map" })).not.toBeInTheDocument();
  });

  it("shows an empty map state when endpoints have no GPS coordinates", async () => {
    mocks.generalSettings = buildGeneralSettings({
      endpoint_status_enabled: true,
    });
    mocks.listStorageEndpoints.mockResolvedValue([
      {
        id: 1,
        name: "INRAE-eprod-debug",
        endpoint_url: "https://s3.example.test",
        provider: "ceph",
        force_path_style: false,
        verify_tls: true,
        latitude: null,
        longitude: null,
        is_default: true,
        is_editable: true,
        tags: [],
        has_admin_secret: false,
        has_supervision_secret: false,
        has_ceph_admin_secret: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);

    await renderDashboard();

    expect(await screen.findByRole("img", { name: "Infrastructure endpoint map" })).toBeInTheDocument();
    expect(screen.getByTestId("admin-dashboard-map-geography")).toHaveAttribute("data-basemap", "world");
    expect(screen.getByText("No GPS coordinates available for endpoints.")).toBeInTheDocument();
    expect(screen.queryAllByTestId("admin-dashboard-map-marker")).toHaveLength(0);
    expect(mocks.fetchHealthWorkspaceOverview).toHaveBeenCalledTimes(1);
    expect(mocks.listStorageEndpoints).toHaveBeenCalledTimes(1);
  });

  it("keeps platform cards present without unavailable text or fallback values when metrics are unavailable", async () => {
    mocks.fetchAdminStorage.mockRejectedValue(new Error("metrics disabled"));
    mocks.fetchAdminTraffic.mockRejectedValue(new Error("usage disabled"));

    await renderDashboard();

    expect(screen.getByRole("heading", { name: "Platform summary" })).toBeInTheDocument();
    expect(screen.queryByText("metrics disabled")).not.toBeInTheDocument();
    expect(screen.queryByText("usage disabled")).not.toBeInTheDocument();
    expect(screen.queryByText("1,850")).not.toBeInTheDocument();
    expect(screen.queryByText("12.4M")).not.toBeInTheDocument();
  });

  it("keeps recent activity present without fallback logs when audit logs are unavailable", async () => {
    mocks.listAuditLogs.mockRejectedValue(new Error("audit unavailable"));

    await renderDashboard();

    await waitFor(
      () => {
        expect(screen.getByTestId("admin-dashboard")).toHaveTextContent("Recent activity");
      },
      { timeout: 5000 },
    );
    expect(screen.queryByText("audit unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("User admin@example.com logged in")).not.toBeInTheDocument();
    expect(screen.queryByText(/Endpoint INRAE-eprod-idf/)).not.toBeInTheDocument();
  });
});
