import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../../api/client";
import CephAdminUsersPage from "./CephAdminUsersPage";

const listCephAdminUsersMock = vi.fn();
const streamCephAdminUsersMock = vi.fn();
const useCephAdminEndpointMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("./CephAdminUserCreateModal", () => ({
  default: () => null,
}));

vi.mock("./CephAdminUserEditModal", () => ({
  default: () => null,
}));

vi.mock("../../api/cephAdmin", () => ({
  listCephAdminUsers: (...args: unknown[]) => listCephAdminUsersMock(...args),
  streamCephAdminUsers: (...args: unknown[]) => streamCephAdminUsersMock(...args),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CephAdminUsersPage />
    </MemoryRouter>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function getTableOverflowContainer() {
  const container = screen.getByRole("table").parentElement;
  expect(container).not.toBeNull();
  return container as HTMLElement;
}

describe("CephAdminUsersPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        id: 1,
        name: "Ceph Endpoint 1",
        capabilities: {},
      },
      selectedEndpointAccess: {
        can_metrics: true,
      },
    });
  });

  it("opens delete User from the row menu and protects the active RGW identity", async () => {
    listCephAdminUsersMock.mockResolvedValueOnce({
      items: [
        { uid: "alice", tenant: "tenant-a", full_name: "Alice" },
        { uid: "ceph-admin", full_name: "Service identity" },
      ],
      total: 2,
    });
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: { id: 1, name: "Ceph Endpoint 1", capabilities: {} },
      selectedEndpointAccess: {
        can_metrics: true,
        can_accounts: true,
        active_rgw_uid: "ceph-admin",
        active_rgw_tenant: null,
      },
    });

    renderPage();

    expect(await screen.findByText("alice")).toBeInTheDocument();
    const menus = screen.getAllByLabelText("More actions");
    fireEvent.click(menus[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete user" })[0]);
    expect(screen.getByRole("heading", { name: "Delete RGW User" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close modal" }));
    fireEvent.click(menus[1]);
    expect(screen.getAllByRole("button", { name: "Delete user" }).at(-1)).toBeDisabled();
  });

  it("shows loading state before displaying empty results", async () => {
    const pending = deferred<{ items: never[]; total: number }>();
    listCephAdminUsersMock.mockReturnValueOnce(pending.promise);

    renderPage();

    expect(await screen.findByText("Loading users...")).toBeInTheDocument();

    pending.resolve({ items: [], total: 0 });

    expect(await screen.findByText("No users.")).toBeInTheDocument();
  });

  it("shows empty state when endpoint returns no users", async () => {
    listCephAdminUsersMock.mockResolvedValueOnce({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();
  });

  it("shows error banner and error row when list loading fails with no rows", async () => {
    listCephAdminUsersMock.mockRejectedValueOnce(new Error("Users API down"));

    renderPage();

    expect(await screen.findByText("Users API down")).toBeInTheDocument();
    expect(screen.getByText("Unable to load users.")).toBeInTheDocument();
    await waitFor(() => {
      expect(listCephAdminUsersMock).toHaveBeenCalled();
    });
  });

  it("shows backend detail when list loading fails with detail payload", async () => {
    listCephAdminUsersMock.mockRejectedValueOnce(new ApiError("Request failed", {
      response: { status: 403, data: { detail: "Forbidden by policy" }, headers: {} },
    }));

    renderPage();

    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
    expect(screen.getByText("Unable to load users.")).toBeInTheDocument();
  });

  it("serializes quota usage percent filters only when metrics are available", async () => {
    listCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });
    streamCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByLabelText("Quota usage size % >="), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() => {
      expect(streamCephAdminUsersMock).toHaveBeenCalledTimes(1);
    });

    const lastCall = streamCephAdminUsersMock.mock.calls.at(-1);
    expect(JSON.parse(lastCall?.[1]?.advanced_filter as string)).toEqual({
      match: "all",
      rules: [{ field: "quota_usage_size_percent", op: "gte", value: 75 }],
    });
  });

  it("shows advanced search progress while user filtering is running", async () => {
    listCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });
    const pending = deferred<{ items: never[]; total: number }>();
    streamCephAdminUsersMock.mockImplementationOnce((...args: unknown[]) => {
      const options = args[2] as
        | {
            onProgress?: (event: {
              request_id: string;
              percent: number;
              stage: string;
              processed: number;
              total: number;
              message: string;
            }) => void;
          }
        | undefined;
      options?.onProgress?.({
        request_id: "progress-1",
        percent: 56,
        stage: "detail_enrichment",
        processed: 42,
        total: 180,
        message: "Loading user details",
      });
      return pending.promise;
    });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByPlaceholderText("John Doe"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(await screen.findByText(/Advanced search in progress/)).toBeInTheDocument();
    expect(screen.getByText(/Loading user details · 42 \/ 180/)).toBeInTheDocument();

    pending.resolve({ items: [], total: 0 });
    await waitFor(() => {
      expect(screen.queryByText(/Advanced search in progress/)).not.toBeInTheDocument();
    });
  });

  it("keeps an indeterminate progress panel when user streaming falls back", async () => {
    listCephAdminUsersMock.mockResolvedValueOnce({ items: [], total: 0 });
    const fallback = deferred<{ items: never[]; total: number }>();
    listCephAdminUsersMock.mockReturnValueOnce(fallback.promise);
    streamCephAdminUsersMock.mockRejectedValueOnce(new Error("stream unavailable"));

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByPlaceholderText("John Doe"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() => {
      expect(screen.getAllByText("Advanced search in progress...").length).toBeGreaterThan(0);
    });

    fallback.resolve({ items: [], total: 0 });
    await waitFor(() => {
      expect(screen.queryAllByText("Advanced search in progress...")).toHaveLength(0);
    });
  });

  it("marks enriched identity filters as medium cost", async () => {
    listCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.getByLabelText("Medium cost: full name filters require per-user profile lookups.")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium cost: account ID filters require per-user account details.")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium cost: status filters require per-user status details.")).toBeInTheDocument();
  });

  it("hides the horizontal table overflow behind the advanced filter drawer", async () => {
    listCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-hidden", "md:overflow-x-auto");
    expect(screen.getByRole("table")).toHaveClass("!table-auto", "!w-max", "min-w-full", "responsive-data-table");

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    const backdrop = screen.getByLabelText("Close advanced filter drawer");
    expect(backdrop).toHaveClass("bg-black/50");
    expect(backdrop).not.toHaveClass("bg-slate-950/45");
    expect(screen.getByText("RGW Users listing").closest(".fixed")).toHaveClass("z-[46]");
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-hidden");
    expect(getTableOverflowContainer()).not.toHaveClass("md:overflow-x-auto");
  });

  it("hides quota usage percent filters when metrics are unavailable", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      selectedEndpointId: 1,
      selectedEndpoint: {
        id: 1,
        name: "Ceph Endpoint 1",
        capabilities: {},
      },
      selectedEndpointAccess: {
        can_metrics: false,
      },
    });
    listCephAdminUsersMock.mockResolvedValue({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.queryByText("Quota usage %")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quota usage size % >=")).not.toBeInTheDocument();
  });
});
