import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalUsagePage from "./PortalUsagePage";

const mocks = vi.hoisted(() => ({
  billingMock: vi.fn(),
  hookResult: {
    workspace: {
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          usedBytes: 512,
          objectCount: 12,
        },
      ],
    },
    storageSpaces: [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        used_bytes: 512,
        object_count: 12,
        quota_max_size_bytes: 1024,
      },
    ],
    usage: {
      used_bytes: 512,
      used_objects: 12,
      quota_max_size_bytes: 1024,
      storage_spaces: [{ id: "research-data", name: "Research Data", used_bytes: 512, object_count: 12 }],
    },
    usageError: null,
    traffic: {
      series: [
        { timestamp: "2026-05-20T00:00:00Z", bytes_in: 100, bytes_out: 50, ops: 10, success_ops: 10 },
        { timestamp: "2026-05-21T00:00:00Z", bytes_in: 200, bytes_out: 75, ops: 20, success_ops: 20 },
      ],
      totals: { bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 },
    },
    trafficLoading: false,
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
    state: { quota_max_size_bytes: 1024 },
  },
}));

vi.mock("../../api/billing", () => ({
  getPortalBillingMe: (...args: unknown[]) => mocks.billingMock(...args),
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

describe("PortalUsagePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hookResult.storageSpaces = [
      {
        id: "research-data",
        name: "Research Data",
        role: "Owner",
        used_bytes: 512,
        object_count: 12,
        quota_max_size_bytes: 1024,
      },
    ];
    mocks.hookResult.usage = {
      used_bytes: 512,
      used_objects: 12,
      quota_max_size_bytes: 1024,
      storage_spaces: [{ id: "research-data", name: "Research Data", used_bytes: 512, object_count: 12 }],
    };
    mocks.hookResult.usageError = null;
    mocks.hookResult.traffic = {
      series: [
        { timestamp: "2026-05-20T00:00:00Z", bytes_in: 100, bytes_out: 50, ops: 10, success_ops: 10 },
        { timestamp: "2026-05-21T00:00:00Z", bytes_in: 200, bytes_out: 75, ops: 20, success_ops: 20 },
      ],
      totals: { bytes_in: 300, bytes_out: 125, ops: 30, success_ops: 30 },
    };
    mocks.hookResult.state = { quota_max_size_bytes: 1024 };
    mocks.billingMock.mockResolvedValue({
      month: "2026-05",
      subject_type: "account",
      subject_id: 101,
      name: "Research",
      daily: [
        { day: "2026-05-20", storage_bytes: 400, bytes_in: 100, bytes_out: 50, ops_total: 10 },
        { day: "2026-05-21", storage_bytes: 512, bytes_in: 200, bytes_out: 75, ops_total: 20 },
      ],
      usage: { bytes_in: 300, bytes_out: 125, ops_total: 30 },
      storage: { avg_bytes: 456, total_objects: 12 },
      coverage: { days_collected: 2, days_in_month: 31, coverage_ratio: 0.06 },
      cost: { total_cost: 1.25, currency: "EUR", rate_card_name: "default" },
    });
  });

  it("shows usage, traffic, per-space storage and billing source data", async () => {
    render(<PortalUsagePage />);

    expect(screen.getByRole("heading", { name: "Usage & Analytics" })).toBeInTheDocument();
    expect(screen.getByText("Usage by storage space")).toBeInTheDocument();
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(await screen.findByText("€1.25")).toBeInTheDocument();
    expect(screen.getAllByText("Billing source").length).toBeGreaterThan(0);
    expect(mocks.billingMock).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}$/), "101");
  });

  it("hides unavailable metrics cleanly when usage quota traffic and billing are absent", async () => {
    mocks.hookResult.storageSpaces = [
      { id: "empty-space", name: "Empty Space", role: "Viewer", used_bytes: null, object_count: null, quota_max_size_bytes: null },
    ];
    mocks.hookResult.usage = { used_bytes: null, used_objects: null, storage_spaces: [] };
    mocks.hookResult.traffic = null;
    mocks.hookResult.state = { quota_max_size_bytes: null };
    mocks.billingMock.mockRejectedValue(new Error("billing disabled"));

    render(<PortalUsagePage />);

    expect(screen.getAllByText("Quota unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText("Traffic unavailable")).toBeInTheDocument();
    expect(screen.getByText("Per-space usage unavailable")).toBeInTheDocument();
    expect(screen.getByText("No per-storage-space usage metrics available.")).toBeInTheDocument();
    expect(screen.getByText("No bandwidth trend available.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("Billing source is disabled or unavailable.")).toBeInTheDocument();
    });
  });
});
