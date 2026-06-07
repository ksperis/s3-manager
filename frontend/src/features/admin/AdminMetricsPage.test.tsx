import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMetricsPage from "./AdminMetricsPage";

const listStorageEndpointsMock = vi.fn();
const fetchAdminStorageMock = vi.fn();
const fetchAdminTrafficMock = vi.fn();

function makeAxiosError(detail: string) {
  return {
    isAxiosError: true,
    response: { data: { detail } },
    message: "Request failed with status code 403",
  };
}

function makeCephEndpoint() {
  return {
    id: 7,
    name: "Ceph main",
    provider: "ceph",
    endpoint_url: "https://ceph.example.test",
    is_default: true,
  };
}

function makeStorageStats() {
  return {
    total_accounts: 1,
    total_users: 1,
    total_admins: 1,
    total_s3_users: 1,
    total_buckets: 1,
    account_usage: [{ account_id: "tenant-a", account_name: "Tenant A", used_bytes: 2048, object_count: 4 }],
    s3_user_usage: [{ user_id: 1, user_name: "User A", rgw_user_uid: "user-a", used_bytes: 1024, object_count: 2 }],
    storage_totals: { used_bytes: 2048, object_count: 4, bucket_count: 1 },
    generated_at: "2026-05-04T10:00:00Z",
  };
}

function makeTrafficStats() {
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

vi.mock("../../api/storageEndpoints", async () => {
  const actual = await vi.importActual<typeof import("../../api/storageEndpoints")>("../../api/storageEndpoints");
  return {
    ...actual,
    listStorageEndpoints: () => listStorageEndpointsMock(),
  };
});

vi.mock("../../api/stats", async () => {
  const actual = await vi.importActual<typeof import("../../api/stats")>("../../api/stats");
  return {
    ...actual,
    fetchAdminStorage: (...args: unknown[]) => fetchAdminStorageMock(...args),
    fetchAdminTraffic: (...args: unknown[]) => fetchAdminTrafficMock(...args),
  };
});

describe("AdminMetricsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listStorageEndpointsMock.mockResolvedValue([]);
    fetchAdminStorageMock.mockResolvedValue(makeStorageStats());
    fetchAdminTrafficMock.mockResolvedValue(makeTrafficStats());
  });

  it("renders the admin control strip and empty state when no ceph endpoint is available", async () => {
    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Metrics scope")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("No Ceph endpoint available for metrics")).toBeInTheDocument();
    });
  });

  it("keeps disabled storage metrics inside the storage snapshot card", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);
    fetchAdminStorageMock.mockRejectedValueOnce(makeAxiosError("Storage metrics are disabled for this endpoint"));

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    const message = await screen.findByText("Storage metrics are disabled for this endpoint");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage snapshot")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).getByText("Stored volume & objects")).toBeInTheDocument();
    expect(screen.queryByText("Accounts & users")).not.toBeInTheDocument();
    expect(screen.getByText("Bandwidth & requests")).toBeInTheDocument();
  });

  it("renders the storage snapshot with the shared card surface", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    const storageCard = (await screen.findByText("Storage snapshot")).closest("section");

    expect(storageCard).not.toBeNull();
    expect(storageCard).toHaveClass("ui-surface-card");
    expect(storageCard).not.toHaveClass("rounded-2xl");
    expect(storageCard?.className).not.toContain("bg-gradient-to-br");
  });

  it("keeps disabled usage logs inside the traffic card without empty counters", async () => {
    listStorageEndpointsMock.mockResolvedValue([makeCephEndpoint()]);
    fetchAdminTrafficMock.mockRejectedValueOnce(makeAxiosError("Usage logs are disabled for this endpoint"));

    render(
      <MemoryRouter>
        <AdminMetricsPage />
      </MemoryRouter>
    );

    const message = await screen.findByText("Usage logs are disabled for this endpoint");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("RGW traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).getByText("Bandwidth & requests")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).queryByText("Egress")).not.toBeInTheDocument();
    expect(screen.getByText("Accounts & users")).toBeInTheDocument();
  });
});
