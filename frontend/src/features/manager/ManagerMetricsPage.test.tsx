import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import ManagerMetricsPage from "./ManagerMetricsPage";

const useS3AccountContextMock = vi.fn();
const useManagerStatsMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("./useManagerStats", () => ({
  useManagerStats: (...args: unknown[]) => useManagerStatsMock(...args),
}));

vi.mock("./TrafficAnalytics", () => ({
  default: () => <div data-testid="traffic-analytics">traffic</div>,
}));

function buildContext({
  managerStatsEnabled = true,
  managerStatsMessage = null,
  capabilities = { metrics: true, usage: true },
}: {
  managerStatsEnabled?: boolean;
  managerStatsMessage?: string | null;
  capabilities?: { metrics?: boolean; usage?: boolean };
} = {}) {
  return {
    accounts: [
      {
        id: "conn-1",
        display_name: "Ceph connection",
        storage_endpoint_capabilities: capabilities,
      },
    ],
    selectedS3AccountId: "conn-1",
    requiresS3AccountSelection: true,
    hasS3AccountContext: true,
    accountIdForApi: "conn-1",
    accessMode: "connection",
    managerStatsEnabled,
    managerStatsMessage,
  };
}

function buildStatsResult(overrides?: Record<string, unknown>) {
  return {
    stats: {
      total_buckets: 1,
      total_iam_users: 0,
      total_iam_groups: 0,
      total_iam_roles: 0,
      total_iam_policies: 0,
      bucket_usage: [{ name: "alpha", used_bytes: 42, object_count: 2 }],
    },
    loading: false,
    error: null,
    reload: vi.fn(),
    ...overrides,
  };
}

describe("ManagerMetricsPage", () => {
  beforeEach(() => {
    useManagerStatsMock.mockReset();
    useS3AccountContextMock.mockReset();
  });

  it("renders usage and traffic widgets for eligible connection context", () => {
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Bucket breakdown (storage)")).toBeInTheDocument();
    expect(screen.getByText("Bucket breakdown (objects)")).toBeInTheDocument();
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
    expect(
      screen.queryByText("Connection context: platform metrics are disabled. Use a platform account with supervision enabled to access usage and traffic analytics.")
    ).not.toBeInTheDocument();
  });

  it("shows backend reason when metrics are unavailable for selected context", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerStatsEnabled: false,
        managerStatsMessage: "Metrics are unavailable: unable to resolve RGW identity for this connection.",
      })
    );
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(
      screen.getByText("Metrics are unavailable: unable to resolve RGW identity for this connection.")
    ).toBeInTheDocument();
    expect(screen.getByText("Metrics are unavailable for this context")).toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    expect(screen.queryByTestId("traffic-analytics")).not.toBeInTheDocument();
  });

  it("keeps disabled storage analytics inside a storage card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: false, usage: true } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    const message = screen.getByText("Storage analytics are disabled for this endpoint.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage analytics")).toBeInTheDocument();
    expect(within(storageCard as HTMLElement).getByText("Bucket breakdown")).toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
  });

  it("keeps disabled traffic analytics inside a traffic card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: true, usage: false } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult());

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    const message = screen.getByText("Traffic analytics are disabled for this endpoint.");
    const trafficCard = message.closest("section");

    expect(trafficCard).not.toBeNull();
    expect(within(trafficCard as HTMLElement).getByText("Traffic")).toBeInTheDocument();
    expect(within(trafficCard as HTMLElement).getByText("Traffic visualization")).toBeInTheDocument();
    expect(screen.getByText("Bucket breakdown (storage)")).toBeInTheDocument();
    expect(screen.queryByTestId("traffic-analytics")).not.toBeInTheDocument();
  });

  it("keeps the full-page empty state when all metrics are disabled", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ capabilities: { metrics: false, usage: false } }));
    useManagerStatsMock.mockReturnValue(buildStatsResult({ stats: null }));

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Metrics are disabled for this endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Storage analytics are disabled for this endpoint.")).not.toBeInTheDocument();
    expect(screen.queryByText("Traffic analytics are disabled for this endpoint.")).not.toBeInTheDocument();
  });

  it("keeps manager stats errors inside the storage card", () => {
    useS3AccountContextMock.mockReturnValue(buildContext());
    useManagerStatsMock.mockReturnValue(
      buildStatsResult({
        stats: null,
        error: "Storage metrics are not available for this credential.",
      })
    );

    render(
      <MemoryRouter>
        <ManagerMetricsPage />
      </MemoryRouter>
    );

    const message = screen.getByText("Storage metrics are not available for this credential.");
    const storageCard = message.closest("section");

    expect(storageCard).not.toBeNull();
    expect(within(storageCard as HTMLElement).getByText("Storage analytics")).toBeInTheDocument();
    expect(screen.queryByText("Bucket breakdown (storage)")).not.toBeInTheDocument();
    expect(screen.getByTestId("traffic-analytics")).toBeInTheDocument();
  });
});
