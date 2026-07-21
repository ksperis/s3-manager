import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalDashboard from "./PortalDashboard";

const mocks = vi.hoisted(() => {
  const trafficStats = (
    window: string,
    bytesIn: number,
    bytesOut: number,
    series: Array<{ timestamp: string; bytes_in: number; bytes_out: number; ops: number; success_ops: number }>
  ) => ({
    window,
    start: series[0]?.timestamp ?? "2026-06-10T00:00:00Z",
    end: series.at(-1)?.timestamp ?? "2026-06-10T23:59:59Z",
    resolution: "day",
    data_points: series.length,
    series,
    totals: { bytes_in: bytesIn, bytes_out: bytesOut, ops: 12600, success_ops: 12500 },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  });
  const dayTraffic = trafficStats("day", 256, 128, [
    { timestamp: "2026-06-10T00:00:00Z", bytes_in: 256, bytes_out: 128, ops: 600, success_ops: 590 },
  ]);
  const weekTraffic = trafficStats("week", 512, 256, [
    { timestamp: "2026-06-03T00:00:00Z", bytes_in: 140, bytes_out: 70, ops: 400, success_ops: 390 },
    { timestamp: "2026-06-10T00:00:00Z", bytes_in: 372, bytes_out: 186, ops: 500, success_ops: 490 },
  ]);
  const monthTraffic = trafficStats("month", 1024, 1024, [
    { timestamp: "2026-05-10T00:00:00Z", bytes_in: 256, bytes_out: 256, ops: 400, success_ops: 390 },
    { timestamp: "2026-06-10T00:00:00Z", bytes_in: 768, bytes_out: 768, ops: 500, success_ops: 490 },
  ]);
  const createHookResult = () => ({
    workspace: {
      accountName: "Laurent",
      userEmail: "manager@example.com",
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
      quotaObjects: 100,
      maxBuckets: 4,
      requestCount: 12600,
      dataInBytes: 256,
      dataOutBytes: 128,
      usageTrend: [
        { label: "May 10", value: 100 },
        { label: "May 17", value: 120 },
        { label: "Jun 10", value: 180 },
      ],
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          internalName: "research-data",
          description: "Research Data shared storage",
          role: "Owner",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          region: "eu-west-3",
          createdLabel: "May 10, 2023",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
        },
      ],
      activity: [
        {
          id: "activity-1",
          actor: "manager@example.com",
          action: "Uploaded",
          target: "report.pdf",
          spaceId: "research-data",
          spaceName: "Research Data",
          timeLabel: "4 min ago",
          ipAddress: "192.168.1.10",
        },
      ],
      transfers: [
        {
          id: "transfer-1",
          name: "report.pdf",
          direction: "Upload",
          status: "Completed",
          progress: 100,
          sizeBytes: 512,
          spaceName: "Research Data",
          startedLabel: "4 min ago",
          etaLabel: "Completed",
          speedLabel: "-",
        },
      ],
      alerts: [
        {
          id: "quota-near",
          tone: "warning",
          title: "Storage quota is getting close",
          description: "50% used.",
          severityLabel: "Warning",
        },
      ],
    },
    traffic: dayTraffic,
    trafficByWindow: {
      day: dayTraffic,
      week: weekTraffic,
      month: monthTraffic,
    },
    usage: null,
    collaborators: {
      summary: {
        collaborator_count: 3,
        external_access_key_count: 2,
        trend: { window: "month", label: "last 30 days", period_start: "2026-05-10", collaborator_count: 2 },
      },
      collaborators: [],
    },
    collaboratorsError: null,
    usageTrends: {
      storage: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_bytes: 256 },
      buckets: { window: "month", label: "last 30 days", period_start: "2026-05-10", bucket_count: 0 },
      objects: { window: "month", label: "last 30 days", period_start: "2026-05-10", used_objects: 8 },
    },
    health: {
      generated_at: "2026-06-10T10:00:00Z",
      incident_highlight_minutes: 1440,
      endpoint_count: 1,
      up_count: 1,
      degraded_count: 0,
      down_count: 0,
      unknown_count: 0,
      endpoints: [
        {
          endpoint_id: 1,
          name: "Primary storage",
          endpoint_url: "https://s3.example.test",
          status: "up",
          checked_at: new Date().toISOString(),
          latency_ms: 25,
          check_mode: "http",
        },
      ],
      incidents: [],
    },
    healthAlerts: [],
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    usageError: null,
    usageTrendsError: null,
    trafficLoading: false,
    usageTrendsLoading: false,
    trafficError: null,
    hasAccountContext: true,
  });

  return {
    createHookResult,
    hookResult: createHookResult(),
  };
});

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

function kpiValue(label: string): string | null {
  return document.querySelector(`[data-kpi-value="${label}"]`)?.textContent ?? null;
}

function trendText(value: string) {
  return (_content: string, element: Element | null) => element?.tagName.toLowerCase() === "p" && element.textContent === value;
}

describe("PortalDashboard storage workspace UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hookResult = mocks.createHookResult();
  });

  it("shows the enterprise portal dashboard structure without manager-only content", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Portal dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Storage overview")).toBeInTheDocument();
    expect(screen.getByText("Top storage spaces")).toBeInTheDocument();
    expect(screen.getByText("Recent transfers")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Alerts & service status")).toBeInTheDocument();
    expect(screen.getByText("Quick links")).toBeInTheDocument();
    expect(screen.getByText("Collaborators")).toBeInTheDocument();
    expect(screen.getByText("Storage services operational")).toBeInTheDocument();
    expect(screen.getByText(/manager@example.com uploaded report.pdf/i)).toBeInTheDocument();
    expect(screen.getAllByText("report.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("Storage quota is getting close")).toBeInTheDocument();
    expect(screen.queryByText(/iam|policy|lifecycle|sns|migration|execution context/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });

  it("replaces the dashboard with onboarding when there are no spaces or files", () => {
    mocks.hookResult.workspace = {
      ...mocks.hookResult.workspace,
      usedBytes: 0,
      usedObjects: 0,
      spaces: [],
      activity: [],
      transfers: [],
      alerts: [],
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Create a space" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces?create=1"
    );
    expect(screen.getByRole("link", { name: "Upload files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces"
    );
    expect(document.querySelector('[data-workspace-dashboard-kpi-row="true"]')).not.toBeInTheDocument();
    expect(screen.queryByText("Storage overview")).not.toBeInTheDocument();
    expect(screen.queryByText("Top storage spaces")).not.toBeInTheDocument();
  });

  it("aligns the storage overview card with manager growth and projection details", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    const storageOverview = screen.getByRole("heading", { name: "Storage overview" }).closest("section");
    expect(storageOverview).not.toBeNull();
    expect(within(storageOverview!).getByText("Growth (last 30 days)")).toBeInTheDocument();
    expect(within(storageOverview!).getByText("+256 B")).toBeInTheDocument();
    expect(within(storageOverview!).getByText("Projected full")).toBeInTheDocument();
    expect(within(storageOverview!).getByText("~2 months")).toBeInTheDocument();
    expect(within(storageOverview!).queryByText("Data in")).not.toBeInTheDocument();
    expect(within(storageOverview!).queryByText("Data out")).not.toBeInTheDocument();
  });

  it("uses shared KPI cards with manager-style trends", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(document.querySelector('[data-workspace-dashboard-kpi-row="true"]')).toBeInTheDocument();
    expect(document.querySelector('[data-workspace-dashboard-kpi-row="true"]')).toHaveClass("2xl:grid-cols-5");
    expect(screen.getByText(trendText("256 B vs last 30 days"))).toBeInTheDocument();
    expect(screen.getAllByText(trendText("1 vs last 30 days")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(trendText("4 vs last 30 days"))).toBeInTheDocument();
    expect(screen.getByText(trendText("2.0 KB vs last 30 days"))).toBeInTheDocument();
    const collaboratorsCard = document.querySelector('[data-kpi-card="Collaborators"]');
    expect(collaboratorsCard).toBeInTheDocument();
    expect(kpiValue("Collaborators")).toBe("3");
    expect(within(collaboratorsCard as HTMLElement).getByText("2 active external tool accesses")).toBeInTheDocument();
    expect(within(collaboratorsCard as HTMLElement).getByText(trendText("1 vs last 30 days"))).toBeInTheDocument();
    expect(screen.getByText("1 / 4 spaces (25%)")).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Storage spaces quota usage" })).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
    expect(screen.queryByText("Last 7 days")).not.toBeInTheDocument();
    expect(screen.queryByText(/requests/i)).not.toBeInTheDocument();
  });

  it("limits the top storage spaces card to the four largest spaces", () => {
    const baseSpace = mocks.hookResult.workspace.spaces[0];
    mocks.hookResult.workspace.spaces = [
      { ...baseSpace, id: "research-data", name: "Research Data", internalName: "research-data", usedBytes: 512, objectCount: 12 },
      { ...baseSpace, id: "genomics-archive", name: "Genomics Archive", internalName: "genomics-archive", usedBytes: 2048, objectCount: 40 },
      { ...baseSpace, id: "telemetry-lake", name: "Telemetry Lake", internalName: "telemetry-lake", usedBytes: 1536, objectCount: 35 },
      { ...baseSpace, id: "lab-notes", name: "Lab Notes", internalName: "lab-notes", usedBytes: 1024, objectCount: 28 },
      { ...baseSpace, id: "cold-vault", name: "Cold Vault", internalName: "cold-vault", usedBytes: 256, objectCount: 8 },
    ];

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    const topStorageSpaces = screen.getByRole("heading", { name: "Top storage spaces" }).closest("section");
    expect(topStorageSpaces).not.toBeNull();
    expect(within(topStorageSpaces!).getByText("Genomics Archive")).toBeInTheDocument();
    expect(within(topStorageSpaces!).getByText("Telemetry Lake")).toBeInTheDocument();
    expect(within(topStorageSpaces!).getByText("Lab Notes")).toBeInTheDocument();
    expect(within(topStorageSpaces!).getByText("Research Data")).toBeInTheDocument();
    expect(within(topStorageSpaces!).queryByText("Cold Vault")).not.toBeInTheDocument();
  });

  it("shows anonymized Other usage without exposing a Storage Space link or badges", () => {
    const baseSpace = mocks.hookResult.workspace.spaces[0];
    mocks.hookResult.workspace.spaces = [
      { ...baseSpace, id: "research-data", name: "Research Data", internalName: "research-data", usedBytes: 512, objectCount: 12 },
      { ...baseSpace, id: "genomics-archive", name: "Genomics Archive", internalName: "genomics-archive", usedBytes: 2048, objectCount: 40 },
      { ...baseSpace, id: "telemetry-lake", name: "Telemetry Lake", internalName: "telemetry-lake", usedBytes: 1536, objectCount: 35 },
      { ...baseSpace, id: "lab-notes", name: "Lab Notes", internalName: "lab-notes", usedBytes: 1024, objectCount: 28 },
    ];
    mocks.hookResult.usage = {
      other_storage_space: {
        id: "__other__",
        name: "Other",
        used_bytes: 900,
        object_count: 9,
      },
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    const topStorageSpaces = screen.getByRole("heading", { name: "Top storage spaces" }).closest("section");
    expect(topStorageSpaces).not.toBeNull();
    expect(within(topStorageSpaces!).getByText("Other")).toBeInTheDocument();
    expect(within(topStorageSpaces!).queryByRole("link", { name: "Other" })).not.toBeInTheDocument();
    expect(within(topStorageSpaces!).queryByText("Research Data")).not.toBeInTheDocument();
    expect(within(topStorageSpaces!).getAllByText("Owner")).toHaveLength(3);
    expect(within(topStorageSpaces!).queryByText("Active")).not.toBeInTheDocument();
  });

  it("opens only useful portal routes from dashboard cards and rows", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Storage used/ })).toHaveAttribute("href", "/portal/usage");
    expect(screen.getByRole("link", { name: /Storage spaces 1 1 \/ 4 spaces/ })).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.getByRole("link", { name: /Files/ })).toHaveAttribute("href", "/portal/usage");
    expect(screen.getByRole("link", { name: /^Transfer\s+384 B/ })).toHaveAttribute("href", "/portal/usage");
    expect(screen.getByRole("link", { name: /Collaborators\s+3/i })).toHaveAttribute("href", "/portal/shares");
    expect(screen.getByRole("link", { name: "Research Data" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByRole("link", { name: /Shares/ })).toHaveAttribute("href", "/portal/shares");
    expect(screen.getByRole("link", { name: /Transfers/ })).toHaveAttribute("href", "/portal/transfers");
    expect(screen.queryByRole("link", { name: /Create user|Create policy|SNS|Lifecycle/i })).not.toBeInTheDocument();
  });

  it("uses day traffic stats for Transfer even when workspace transfer totals are empty", () => {
    const dayTraffic = {
      ...mocks.hookResult.traffic,
      totals: { bytes_in: 2048, bytes_out: 1024, ops: 12, success_ops: 12 },
    };
    mocks.hookResult.workspace = {
      ...mocks.hookResult.workspace,
      dataInBytes: null,
      dataOutBytes: null,
    };
    mocks.hookResult.traffic = null;
    mocks.hookResult.trafficByWindow = {
      ...mocks.hookResult.trafficByWindow,
      day: dayTraffic,
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(kpiValue("Transfer")).toBe("3.0 KB");
    expect(screen.getByText("Last 24h")).toBeInTheDocument();
  });

  it("builds the storage overview chart from storage usage trends instead of traffic", () => {
    mocks.hookResult.traffic = null;
    mocks.hookResult.trafficByWindow = {};
    mocks.hookResult.usageTrends = {
      ...mocks.hookResult.usageTrends,
      storage: {
        window: "month",
        label: "last 30 days",
        period_start: "2026-05-10",
        used_bytes: 128,
        collected_at: "2026-05-10T00:00:00Z",
      },
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByLabelText("Storage evolution chart")).toBeInTheDocument();
    expect(screen.queryByText("Storage usage unavailable.")).not.toBeInTheDocument();
  });

  it("keeps active storage spaces detail when max bucket quota is unknown", () => {
    mocks.hookResult.workspace = {
      ...mocks.hookResult.workspace,
      maxBuckets: null,
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: /Storage spaces 1 1 active/ })).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.queryByRole("meter", { name: "Storage spaces quota usage" })).not.toBeInTheDocument();
  });

  it("keeps real zero usage values visible", () => {
    mocks.hookResult.workspace = {
      ...mocks.hookResult.workspace,
      usedBytes: 0,
      usedObjects: 0,
      quotaBytes: 1024,
      quotaObjects: 100,
      requestCount: 0,
      dataInBytes: 0,
      dataOutBytes: 0,
      spaces: [
        {
          ...mocks.hookResult.workspace.spaces[0],
          usedBytes: 0,
          objectCount: 0,
        },
      ],
    };
    mocks.hookResult.traffic = {
      series: [
        { timestamp: "2026-05-10T00:00:00Z", bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 },
        { timestamp: "2026-05-17T00:00:00Z", bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 },
      ],
      totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 },
    };
    mocks.hookResult.trafficByWindow = {
      day: mocks.hookResult.traffic,
      week: mocks.hookResult.traffic,
      month: mocks.hookResult.traffic,
    };

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(kpiValue("Storage used")).toBe("0 B");
    expect(kpiValue("Files")).toBe("0");
    expect(kpiValue("Transfer")).toBe("0 B");
    const topStorageSpaces = screen.getByRole("heading", { name: "Top storage spaces" }).closest("section");
    expect(topStorageSpaces).not.toBeNull();
    expect(within(topStorageSpaces!).getByText("0 B")).toBeInTheDocument();
    expect(within(topStorageSpaces!).getByText("0")).toBeInTheDocument();
  });

  it("shows clear empty states when portal workspace signals are absent", () => {
    mocks.hookResult.workspace = {
      accountName: "Laurent",
      userEmail: "manager@example.com",
      usedBytes: null,
      usedObjects: null,
      quotaBytes: null,
      quotaObjects: null,
      maxBuckets: null,
      requestCount: null,
      dataInBytes: null,
      dataOutBytes: null,
      usageTrend: [],
      spaces: [],
      activity: [],
      transfers: [],
      alerts: [],
    };
    mocks.hookResult.traffic = null;
    mocks.hookResult.trafficByWindow = {};
    mocks.hookResult.usageTrends = null;
    mocks.hookResult.health = null;
    mocks.hookResult.healthAlerts = [];
    mocks.hookResult.collaborators = null;

    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getAllByText("Quota unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Storage usage unavailable.")).toBeInTheDocument();
    expect(screen.getByText("No Storage Spaces to display.")).toBeInTheDocument();
    expect(screen.getByText("No recent activity.")).toBeInTheDocument();
    expect(screen.getByText("No recent transfers.")).toBeInTheDocument();
    expect(screen.getByText("No alerts to display.")).toBeInTheDocument();
    expect(screen.getByText("Storage service status unavailable")).toBeInTheDocument();
  });
});
