import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminMetricsPage from "./CephAdminMetricsPage";

const useCephAdminEndpointMock = vi.fn();
const fetchCephAdminClusterStorageMock = vi.fn();
const fetchCephAdminClusterTrafficMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    fetchCephAdminClusterStorage: (...args: unknown[]) => fetchCephAdminClusterStorageMock(...args),
    fetchCephAdminClusterTraffic: (...args: unknown[]) => fetchCephAdminClusterTrafficMock(...args),
  };
});

function makeAxiosError(detail: string) {
  return {
    isAxiosError: true,
    response: { data: { detail } },
    message: "Request failed with status code 403",
  };
}

function buildEndpoint(capabilities: { metrics?: boolean; usage?: boolean } = { metrics: true, usage: true }) {
  return {
    id: 7,
    name: "Ceph Endpoint",
    endpoint_url: "https://ceph.example.test",
    is_default: true,
    capabilities,
    tags: [],
  };
}

function buildEndpointContext(capabilities?: { metrics?: boolean; usage?: boolean }) {
  const endpoint = buildEndpoint(capabilities);
  return {
    endpoints: [endpoint],
    selectedEndpointId: endpoint.id,
    setSelectedEndpointId: vi.fn(),
    selectedEndpoint: endpoint,
    selectedEndpointAccess: {
      endpoint_id: endpoint.id,
      can_admin: true,
      can_metrics: true,
      can_accounts: true,
      admin_warning: null,
    },
    selectedEndpointAccessLoading: false,
    selectedEndpointAccessError: null,
    loading: false,
    error: null,
  };
}

function makeStorageMetrics() {
  return {
    total_buckets: 1,
    bucket_usage: [{ name: "alpha", used_bytes: 2048, object_count: 4, bucket_count: 1 }],
    owner_usage: [{ owner: "tenant-a", used_bytes: 2048, object_count: 4, bucket_count: 1 }],
    storage_totals: { used_bytes: 2048, object_count: 4, bucket_count: 1, owners_with_usage: 1 },
    generated_at: "2026-05-04T10:00:00Z",
  };
}

function makeTrafficMetrics() {
  return {
    window: "week",
    start: "2026-04-27T00:00:00Z",
    end: "2026-05-04T00:00:00Z",
    resolution: "day",
    data_points: 0,
    series: [],
    totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0, success_rate: null },
    bucket_rankings: [],
    user_rankings: [],
    request_breakdown: [],
    category_breakdown: [],
  };
}

function renderPage() {
  render(
    <MemoryRouter>
      <CephAdminMetricsPage />
    </MemoryRouter>
  );
}

describe("CephAdminMetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    fetchCephAdminClusterStorageMock.mockResolvedValue(makeStorageMetrics());
    fetchCephAdminClusterTrafficMock.mockResolvedValue(makeTrafficMetrics());
  });

  it("keeps disabled storage metrics inside the storage snapshot card", async () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: false, usage: true }));

    renderPage();

    const message = screen.getByText("Storage metrics are disabled for this endpoint.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).getByText("Stored volume & objects")).toBeInTheDocument();
    expect(screen.getByText("Bandwidth & requests")).toBeInTheDocument();
    expect(await screen.findAllByText("No usable metrics for this period yet.")).not.toHaveLength(0);
  });

  it("keeps disabled usage logs inside the traffic card", async () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: true, usage: false }));

    renderPage();

    const message = screen.getByText("Usage logs are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).getByText("Bandwidth & requests")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
    expect(screen.getByText("Owners & buckets")).toBeInTheDocument();
    expect(
      await screen.findByText((_content, element) => element?.textContent?.startsWith("Updated:") ?? false)
    ).toBeInTheDocument();
  });

  it("keeps the full-page empty state when all metrics are disabled", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ metrics: false, usage: false }));

    renderPage();

    expect(screen.getByText("Metrics are disabled for this endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Storage metrics are disabled for this endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Usage logs are disabled for this endpoint.")).not.toBeInTheDocument();
  });

  it("keeps storage load errors inside the storage snapshot card", async () => {
    fetchCephAdminClusterStorageMock.mockRejectedValueOnce(makeAxiosError("Unable to load cluster storage metrics."));

    renderPage();

    const message = await screen.findByText("Unable to load cluster storage metrics.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Owners & buckets")).not.toBeInTheDocument();
    expect(screen.getByText("Bandwidth & requests")).toBeInTheDocument();
  });

  it("keeps traffic load errors inside the traffic card without empty counters", async () => {
    fetchCephAdminClusterTrafficMock.mockRejectedValueOnce(makeAxiosError("Usage logs are disabled for this endpoint."));

    renderPage();

    const message = await screen.findByText("Usage logs are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
    expect(screen.getByText("Owners & buckets")).toBeInTheDocument();
  });
});
