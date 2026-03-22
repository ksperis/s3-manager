import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminMetricsPage from "./AdminMetricsPage";

const listStorageEndpointsMock = vi.fn();
const fetchAdminStorageMock = vi.fn();
const fetchAdminTrafficMock = vi.fn();

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
    fetchAdminStorageMock.mockResolvedValue(null);
    fetchAdminTrafficMock.mockResolvedValue(null);
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
});
