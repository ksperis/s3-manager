import { render, screen } from "@testing-library/react";
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

describe("ManagerMetricsPage", () => {
  beforeEach(() => {
    useManagerStatsMock.mockReset();
    useS3AccountContextMock.mockReset();
  });

  it("renders usage and traffic widgets for eligible connection context", () => {
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "conn-1",
          display_name: "Ceph connection",
          storage_endpoint_capabilities: { metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "conn-1",
      requiresS3AccountSelection: true,
      hasS3AccountContext: true,
      accountIdForApi: "conn-1",
      accessMode: "connection",
      managerStatsEnabled: true,
      managerStatsMessage: null,
    });
    useManagerStatsMock.mockReturnValue({
      stats: {
        bucket_usage: [{ name: "alpha", used_bytes: 42, object_count: 2 }],
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    });

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
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "conn-1",
          display_name: "Ceph connection",
          storage_endpoint_capabilities: { metrics: true, usage: true },
        },
      ],
      selectedS3AccountId: "conn-1",
      requiresS3AccountSelection: true,
      hasS3AccountContext: true,
      accountIdForApi: "conn-1",
      accessMode: "connection",
      managerStatsEnabled: false,
      managerStatsMessage: "Metrics are unavailable: unable to resolve RGW identity for this connection.",
    });
    useManagerStatsMock.mockReturnValue({
      stats: null,
      loading: false,
      error: null,
      reload: vi.fn(),
    });

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
});
