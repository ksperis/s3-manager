import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
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
    listCephAdminUsersMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: "Forbidden by policy" } },
      message: "Request failed with status code 403",
    });

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
    streamCephAdminUsersMock.mockReturnValueOnce(pending.promise);

    renderPage();

    expect(await screen.findByText("No users.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByPlaceholderText("John Doe"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(await screen.findByText(/Advanced search in progress/)).toBeInTheDocument();

    pending.resolve({ items: [], total: 0 });
    await waitFor(() => {
      expect(screen.queryByText(/Advanced search in progress/)).not.toBeInTheDocument();
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
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-auto");

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.getByText("RGW Users listing").closest(".fixed")).toHaveClass("z-[46]");
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-hidden");
    expect(getTableOverflowContainer()).not.toHaveClass("overflow-x-auto");
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
