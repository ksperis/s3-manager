import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import CephAdminUsersPage from "./CephAdminUsersPage";

const listCephAdminUsersMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => ({
    selectedEndpointId: 1,
    selectedEndpoint: {
      id: 1,
      name: "Ceph Endpoint 1",
      capabilities: {},
    },
    selectedEndpointAccess: {
      can_metrics: true,
    },
  }),
}));

vi.mock("./CephAdminUserCreateModal", () => ({
  default: () => null,
}));

vi.mock("./CephAdminUserEditModal", () => ({
  default: () => null,
}));

vi.mock("../../api/cephAdmin", () => ({
  listCephAdminUsers: (...args: unknown[]) => listCephAdminUsersMock(...args),
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

describe("CephAdminUsersPage list states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state before displaying empty results", async () => {
    const pending = deferred<{ items: never[]; total: number }>();
    listCephAdminUsersMock.mockReturnValueOnce(pending.promise);

    renderPage();

    expect(await screen.findByText("Loading users...")).toBeInTheDocument();

    pending.resolve({ items: [], total: 0 });

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
  });

  it("shows empty state when endpoint returns no users", async () => {
    listCephAdminUsersMock.mockResolvedValueOnce({ items: [], total: 0 });

    renderPage();

    expect(await screen.findByText("No users found.")).toBeInTheDocument();
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
});
