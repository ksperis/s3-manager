import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalTransfersPage from "./PortalTransfersPage";
import type { PortalWorkspaceTransfer } from "./portalWorkspaceModel";

const mocks = vi.hoisted(() => ({
  transfers: [] as PortalWorkspaceTransfer[],
  fetchPortalServerAccessLogPage: vi.fn(),
  downloadPortalServerAccessRawLogs: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  anchorClick: vi.fn(),
}));

vi.mock("../../api/portal", () => ({
  fetchPortalServerAccessLogPage: (...args: unknown[]) => mocks.fetchPortalServerAccessLogPage(...args),
  downloadPortalServerAccessRawLogs: (...args: unknown[]) => mocks.downloadPortalServerAccessRawLogs(...args),
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({
    workspace: {
      spaces: [
        { id: "research-data", name: "Research Data" },
        { id: "lab-exchange", name: "Lab Exchange" },
      ],
      transfers: mocks.transfers,
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
  }),
}));

function renderPage() {
  render(
    <MemoryRouter>
      <PortalTransfersPage />
    </MemoryRouter>
  );
}

describe("PortalTransfersPage", () => {
  beforeEach(() => {
    mocks.fetchPortalServerAccessLogPage.mockReset();
    mocks.fetchPortalServerAccessLogPage.mockResolvedValue({ entries: [], total: 0, limit: 25, offset: 0 });
    mocks.downloadPortalServerAccessRawLogs.mockReset();
    mocks.downloadPortalServerAccessRawLogs.mockResolvedValue({ blob: new Blob(["raw"]), filename: "raw.log" });
    mocks.createObjectURL.mockReset();
    mocks.createObjectURL.mockReturnValue("blob:raw-logs");
    mocks.revokeObjectURL.mockReset();
    mocks.anchorClick.mockReset();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revokeObjectURL });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", { configurable: true, value: mocks.anchorClick });
    mocks.transfers = [
      {
        id: "audit-1",
        name: "report.csv",
        direction: "Upload",
        status: "Completed",
        progress: 100,
        sizeBytes: 42,
        spaceName: "Research Data",
        startedAt: "2026-07-08T10:25:00Z",
        startedLabel: "2m ago",
        etaLabel: "Completed",
        speedLabel: "-",
      },
      {
        id: "audit-2",
        name: "results.zip",
        direction: "Download",
        status: "Queued",
        progress: 0,
        sizeBytes: 2048,
        spaceName: "Research Data",
        startedLabel: "Now",
        etaLabel: "Queued",
        speedLabel: "-",
      },
      {
        id: "audit-3",
        name: "raw-data.tar",
        direction: "Upload",
        status: "Failed",
        progress: 0,
        sizeBytes: 4096,
        spaceName: "Lab Exchange",
        startedLabel: "5m ago",
        etaLabel: "-",
        speedLabel: "-",
        errorMessage: "Quota reached.",
      },
    ];
  });

  it("shows server logs first and keeps browser transfers in a separate tab", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Operation logs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open spaces" })).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.getByText("Server-side operations")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retrieve logs" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Raw logs" })).toBeInTheDocument();
    expect(screen.queryByText("Recent browser transfers")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ mode: "operations", limit: 25, offset: 0 })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Live browser" }));

    expect(screen.getByText("Recent browser transfers")).toBeInTheDocument();
    expect(screen.getByText("Live transfer history")).toBeInTheDocument();
    expect(screen.getByText("Needs attention")).toBeInTheDocument();
    expect(screen.getByText("Retry from the related space")).toBeInTheDocument();
    expect(screen.getByText("report.csv")).toBeInTheDocument();
    expect(screen.getAllByText("Upload").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research Data").length).toBeGreaterThan(0);
    expect(screen.getByText("Available in the space.")).toBeInTheDocument();
    expect(screen.getByText("Waiting to start.")).toBeInTheDocument();
    expect(screen.getByText("Quota reached.")).toBeInTheDocument();
    expect(screen.getAllByRole("table")[0]).toHaveClass("responsive-data-table");
    expect(screen.getByText("report.csv").closest("td")).toHaveAttribute("data-mobile-primary", "true");
  });

  it("points an empty browser transfer history back to spaces", () => {
    mocks.transfers = [];

    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Live browser" }));

    expect(screen.getByRole("heading", { name: "Operation logs" })).toBeInTheDocument();
    expect(screen.getByText("No browser transfer yet")).toBeInTheDocument();
    expect(screen.getByText("Browser-side operations appear automatically after you add files to a space or download files from one.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start from spaces" })).toHaveAttribute("href", "/portal/storage-spaces");
  });

  it("automatically loads server logs for the selected date and page", async () => {
    mocks.fetchPortalServerAccessLogPage.mockResolvedValue({
      entries: [
        {
          id: "server-log-1",
          source: "server_access_logging",
          timestamp: "2026-07-08T10:30:00Z",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          bucket_name: "research-data",
          operation: "REST.POST.OBJECT",
          operation_category: "upload",
          object_key: "captures/external.csv",
          object_name: "external.csv",
          direction: "Upload",
          status_code: 204,
          object_size: 512,
          requester: "external-iam-id",
          requester_identity: {
            label: "partner@example.org",
            kind: "external_access",
            detail: "External access · portal-ext-partner · Research Data · read/write",
            access_key_id: "EXTKEY123456",
            iam_username: "portal-ext-partner",
            email: "partner@example.org",
            resolved: true,
          },
          client_ip: "10.0.0.5",
          user_agent: "aws-cli/2",
          log_object_key: "portal-server-access/research-data/2026-07-08-10-30-00-0000000001 ABCDEF",
        },
        {
          id: "server-log-2",
          source: "server_access_logging",
          timestamp: "2026-07-08T10:31:00Z",
          storage_space_id: "research-data",
          storage_space_name: "Research Data",
          bucket_name: "research-data",
          operation: "REST.GET.OBJECT",
          operation_category: "download",
          object_key: "captures/unknown.csv",
          object_name: "unknown.csv",
          direction: "Download",
          status_code: 403,
          error_code: "AccessDenied",
          object_size: 128,
          requester: "unknown-rgw-uid",
          requester_identity: {
            label: "Unknown S3 identity",
            kind: "unknown",
            detail: "unkn...-uid",
            resolved: false,
          },
          client_ip: "10.0.0.6",
          log_object_key: "portal-server-access/research-data/2026-07-08-10-31-00-0000000002 ABCDEF",
        },
      ],
      total: 26,
      limit: 25,
      offset: 0,
    });

    renderPage();
    fireEvent.change(screen.getByLabelText("Go to date"), { target: { value: "2026-07-08" } });

    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ date: "2026-07-08", mode: "operations", limit: 25, offset: 0 })
      );
    });
    expect(await screen.findByText("Added an object")).toBeInTheDocument();
    expect(screen.getByText("Added external.csv")).toBeInTheDocument();
    expect(screen.getByText("REST.POST.OBJECT")).toBeInTheDocument();
    expect(screen.getByText("Succeeded (204)")).toBeInTheDocument();
    expect(screen.getByText("partner@example.org")).toBeInTheDocument();
    expect(screen.getByText("External access")).toBeInTheDocument();
    expect(screen.getByText("External access · portal-ext-partner · Research Data · read/write")).toBeInTheDocument();
    expect(screen.getByText("UID exte...m-id · key EXTK...3456")).toBeInTheDocument();
    expect(screen.getByText("Unknown S3 identity")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("UID unkn...-uid")).toBeInTheDocument();
    expect(screen.getByText("Failed (403)")).toBeInTheDocument();
    expect(screen.getByText("AccessDenied · 128 B")).toBeInTheDocument();
    expect(screen.getByText("IP 10.0.0.5 · aws-cli/2")).toBeInTheDocument();
    expect(screen.queryByText("Portal live")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 26 server operations shown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ date: "2026-07-08", limit: 25, offset: 25 })
      );
    });
  });

  it("sends advanced server log filters to the backend", async () => {
    renderPage();

    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "upload" } });
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "captures/" } });
    fireEvent.change(screen.getByLabelText("Identity"), { target: { value: "portal-6-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() => {
      const lastCall = mocks.fetchPortalServerAccessLogPage.mock.calls.at(-1);
      const options = lastCall?.[1] as { advancedFilter?: string } | undefined;
      expect(options?.advancedFilter).toBeTruthy();
      const parsed = JSON.parse(options?.advancedFilter ?? "{}") as {
        match?: string;
        rules?: Array<{ field?: string; op?: string; value?: unknown }>;
      };
      expect(parsed).toEqual({
        match: "all",
        rules: [
          { field: "action", op: "eq", value: "upload" },
          { field: "path", op: "contains", value: "captures/" },
          { field: "identity", op: "contains", value: "portal-6-1" },
        ],
      });
    });
    expect(screen.getByText(/Action: Uploads/)).toBeInTheDocument();
    expect(screen.getByText(/Identity contains: portal-6-1/)).toBeInTheDocument();
  });

  it("downloads raw server logs for a selected date range and storage space", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Raw logs" }));

    const dialog = screen.getByRole("dialog", { name: "Retrieve raw server logs" });
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-07-07" } });
    fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: "2026-07-08" } });
    fireEvent.change(within(dialog).getByLabelText("Storage space"), { target: { value: "research-data" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Download raw logs" }));

    await waitFor(() => {
      expect(mocks.downloadPortalServerAccessRawLogs).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ dateFrom: "2026-07-07", dateTo: "2026-07-08", spaceId: "research-data" })
      );
    });
    expect(mocks.createObjectURL).toHaveBeenCalled();
    expect(mocks.anchorClick).toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:raw-logs");
  });
});
