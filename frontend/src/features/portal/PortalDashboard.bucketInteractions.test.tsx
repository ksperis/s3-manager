import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalDashboard from "./PortalDashboard";

const mocks = vi.hoisted(() => ({
  hookResult: {
    workspace: {
      accountName: "Laurent",
      userEmail: "manager@example.com",
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
      quotaObjects: 100,
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
          access: "Private",
          region: "eu-west-3",
          createdLabel: "May 10, 2023",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
          files: [],
          objectDetail: {
            name: "image_001.jpg",
            path: "research-data/2024/image_001.jpg",
            sizeBytes: 512,
            type: "image/jpeg",
            lastModified: "Jun 10, 2024",
            etag: "mock",
            storageClass: "STANDARD",
            encryption: "AES-256",
            objectUrl: "https://s3.example.com/research-data/image_001.jpg",
            downloadUrl: "https://s3.example.com/research-data/image_001.jpg?download=1",
          },
        },
      ],
      sharesWithMe: [],
      sharesByMe: [],
      publicLinks: [],
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
      adminUsers: [],
      groups: [],
      policies: [],
      accessKeys: [],
    },
    traffic: {
      series: [],
      totals: { bytes_in: 0, bytes_out: 0, ops: 0, success_ops: 0 },
    },
    healthAlerts: [],
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    usageError: null,
    trafficLoading: false,
    hasAccountContext: true,
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

describe("PortalDashboard storage workspace UX", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the v3 dashboard structure without advanced browser actions", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("Storage usage")).toBeInTheDocument();
    expect(screen.getByText("Usage over time")).toBeInTheDocument();
    expect(screen.getByText("Top storage spaces")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Recent transfers")).toBeInTheDocument();
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.queryByText(/Open in Browser/i)).not.toBeInTheDocument();
  });

  it("opens storage space detail routes from dashboard rows", () => {
    render(
      <MemoryRouter>
        <PortalDashboard />
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "Research Data" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
  });
});
