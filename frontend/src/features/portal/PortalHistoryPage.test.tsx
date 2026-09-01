import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalHistoryPage from "./PortalHistoryPage";

const mocks = vi.hoisted(() => ({
  serverAccessLoggingEnabled: true,
  accountRole: "portal_manager",
  workspaceLoading: false,
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

vi.mock("./PortalActivityPanel", () => ({
  default: () => <div>Activity panel content</div>,
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => ({
    workspace: {
      spaces: [
        { id: "research-data", name: "Research Data" },
        { id: "lab-exchange", name: "Lab Exchange" },
      ],
      activity: [],
    },
    state: {
      server_access_logging_enabled: mocks.serverAccessLoggingEnabled,
      portal_role: mocks.accountRole,
    },
    selectedAccount: { portal_role: mocks.accountRole },
    loading: mocks.workspaceLoading,
    accountLoading: false,
    activityLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
    accountIdForApi: "101",
  }),
}));

function renderPage(initialEntry = "/portal/history") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalHistoryPage />
    </MemoryRouter>
  );
}

describe("PortalHistoryPage", () => {
  beforeEach(() => {
    mocks.fetchPortalServerAccessLogPage.mockReset();
    mocks.fetchPortalServerAccessLogPage.mockResolvedValue({ entries: [], total: 0, limit: 25, offset: 0 });
    mocks.downloadPortalServerAccessRawLogs.mockReset();
    mocks.downloadPortalServerAccessRawLogs.mockResolvedValue({ blob: new Blob(["raw"]), filename: "raw.log" });
    mocks.createObjectURL.mockReset();
    mocks.createObjectURL.mockReturnValue("blob:raw-logs");
    mocks.revokeObjectURL.mockReset();
    mocks.anchorClick.mockReset();
    mocks.serverAccessLoggingEnabled = true;
    mocks.accountRole = "portal_manager";
    mocks.workspaceLoading = false;
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: mocks.createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: mocks.revokeObjectURL });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", { configurable: true, value: mocks.anchorClick });
  });

  it("opens activity by default without loading transfer or access-log content", () => {
    renderPage("/portal/history");

    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Activity panel content")).toBeInTheDocument();
    expect(screen.queryByText("Latest transfer history")).not.toBeInTheDocument();
    expect(mocks.fetchPortalServerAccessLogPage).not.toHaveBeenCalled();
  });

  it("switches from governance activity to manager access logs", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open spaces" })).toHaveAttribute("href", "/portal/storage-spaces");
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Transfers" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Access logs" })).toBeInTheDocument();
    expect(screen.getByText("Activity panel content")).toBeInTheDocument();
    expect(screen.queryByText("Technical access logs")).not.toBeInTheDocument();
    expect(mocks.fetchPortalServerAccessLogPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("tab", { name: "Access logs" }));

    expect(screen.getByText("Technical access logs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retrieve logs" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export logs" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ limit: 25, offset: 0 })
      );
    });
  });

  it("preserves a manager access-log deep link while permissions are loading", async () => {
    mocks.workspaceLoading = true;
    mocks.accountRole = "portal_user";
    const view = renderPage("/portal/history?view=access");

    expect(screen.getByText("Loading history...")).toBeInTheDocument();
    expect(mocks.fetchPortalServerAccessLogPage).not.toHaveBeenCalled();

    mocks.workspaceLoading = false;
    mocks.accountRole = "portal_manager";
    view.rerender(
      <MemoryRouter initialEntries={["/portal/history?view=access"]}>
        <PortalHistoryPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("tab", { name: "Access logs" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalled();
    });
  });

  it("hides access logs when detailed logging is disabled for the active account", () => {
    mocks.serverAccessLoggingEnabled = false;

    renderPage();

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Access logs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Technical access logs")).not.toBeInTheDocument();
    expect(mocks.fetchPortalServerAccessLogPage).not.toHaveBeenCalled();
  });

  it("hides access logs and does not load sensitive logs for portal users", () => {
    mocks.accountRole = "portal_user";

    renderPage();

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Access logs" })).not.toBeInTheDocument();
    expect(screen.queryByText("Technical access logs")).not.toBeInTheDocument();
    expect(screen.getByText("Review governance activity and, for project managers, provider S3 access logs.")).toBeInTheDocument();
    expect(mocks.fetchPortalServerAccessLogPage).not.toHaveBeenCalled();
  });

  it("automatically loads access history for the selected date and page", async () => {
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
            label: "Unknown identity",
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
    fireEvent.click(screen.getByRole("tab", { name: "Access logs" }));
    fireEvent.change(screen.getByLabelText("Go to date"), { target: { value: "2026-07-08" } });

    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ date: "2026-07-08", limit: 25, offset: 0 })
      );
    });
    expect(await screen.findByText("Added a file")).toBeInTheDocument();
    expect(screen.getByText("Added external.csv")).toBeInTheDocument();
    expect(screen.getByText("REST.POST.OBJECT")).toBeInTheDocument();
    expect(screen.getByText("Succeeded (204)")).toBeInTheDocument();
    expect(screen.getByText("partner@example.org")).toBeInTheDocument();
    expect(screen.getByText("External access")).toBeInTheDocument();
    expect(screen.getByText("External access · portal-ext-partner · Research Data · read/write")).toBeInTheDocument();
    expect(screen.getByText("UID exte...m-id · key EXTK...3456")).toBeInTheDocument();
    expect(screen.getByText("Unknown identity")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("UID unkn...-uid")).toBeInTheDocument();
    expect(screen.getByText("Failed (403)")).toBeInTheDocument();
    expect(screen.getByText("AccessDenied · 128 B")).toBeInTheDocument();
    expect(screen.getByText("IP 10.0.0.5 · aws-cli/2")).toBeInTheDocument();
    expect(screen.queryByText("Portal live")).not.toBeInTheDocument();
    expect(screen.getByText("2 of 26 access events shown")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalledWith(
        "101",
        expect.objectContaining({ date: "2026-07-08", limit: 25, offset: 25 })
      );
    });
  });

  it("sends advanced access history filters to the backend", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Access logs" }));

    await waitFor(() => {
      expect(mocks.fetchPortalServerAccessLogPage).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Advanced filter/i }));
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "upload" } });
    fireEvent.change(screen.getByLabelText("Result"), { target: { value: "failure" } });
    fireEvent.change(screen.getByLabelText("Path"), { target: { value: "captures/" } });
    fireEvent.change(screen.getByLabelText("Person or key"), { target: { value: "portal-6-1" } });
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
          { field: "result", op: "eq", value: "failure" },
          { field: "path", op: "contains", value: "captures/" },
          { field: "identity", op: "contains", value: "portal-6-1" },
        ],
      });
    });
    expect(screen.getByText(/Action: Uploads/)).toBeInTheDocument();
    expect(screen.getByText(/Result: Failed/)).toBeInTheDocument();
    expect(screen.getByText(/Person or key contains: portal-6-1/)).toBeInTheDocument();
  });

  it("exports raw access logs for a selected date range and storage space", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Access logs" }));
    fireEvent.click(screen.getByRole("button", { name: "Export logs" }));

    const dialog = screen.getByRole("dialog", { name: "Export raw access logs" });
    fireEvent.change(within(dialog).getByLabelText("From"), { target: { value: "2026-07-07" } });
    fireEvent.change(within(dialog).getByLabelText("To"), { target: { value: "2026-07-08" } });
    fireEvent.change(within(dialog).getByLabelText("Storage space"), { target: { value: "research-data" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Download export" }));

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
