import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountsPage from "./CephAdminAccountsPage";

const useCephAdminEndpointMock = vi.fn();
const listCephAdminAccountsMock = vi.fn();
const streamCephAdminAccountsMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("./CephAdminAccountCreateModal", () => ({
  default: () => null,
}));

vi.mock("./CephAdminAccountEditModal", () => ({
  default: () => null,
}));

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminAccounts: (...args: unknown[]) => listCephAdminAccountsMock(...args),
    streamCephAdminAccounts: (...args: unknown[]) => streamCephAdminAccountsMock(...args),
  };
});

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

describe("CephAdminAccountsPage", () => {
  beforeEach(() => {
    useCephAdminEndpointMock.mockReset();
    listCephAdminAccountsMock.mockReset();
    streamCephAdminAccountsMock.mockReset();
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: null,
      selectedEndpoint: null,
      selectedEndpointAccess: null,
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({
      items: [],
      total: 0,
    });
    streamCephAdminAccountsMock.mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  it("shows an empty state without a page-level context strip when no endpoint is selected", async () => {
    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Select a Ceph endpoint before listing RGW accounts")).toBeInTheDocument();
    expect(screen.queryByText("Endpoint context")).not.toBeInTheDocument();
    expect(screen.queryByText("Select a Ceph endpoint first.")).not.toBeInTheDocument();
  });

  it("serializes quota usage percent filters only when metrics are available", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 7,
      selectedEndpoint: { id: 7, name: "Ceph A", capabilities: {} },
      selectedEndpointAccess: { can_metrics: true },
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });
    streamCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByLabelText("Quota usage size % >="), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() => {
      expect(streamCephAdminAccountsMock).toHaveBeenCalledTimes(1);
    });

    const lastCall = streamCephAdminAccountsMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(7);
    expect(JSON.parse(lastCall?.[1]?.advanced_filter as string)).toEqual({
      match: "all",
      rules: [{ field: "quota_usage_size_percent", op: "gte", value: 80 }],
    });
  });

  it("shows advanced search progress while account filtering is running", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 7,
      selectedEndpoint: { id: 7, name: "Ceph A", capabilities: {} },
      selectedEndpointAccess: { can_metrics: true },
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });
    const pending = deferred<{ items: never[]; total: number }>();
    streamCephAdminAccountsMock.mockImplementationOnce((...args: unknown[]) => {
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
        percent: 58,
        stage: "detail_enrichment",
        processed: 5,
        total: 12,
        message: "Loading account details",
      });
      return pending.promise;
    });

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByPlaceholderText("account-a, account-b"), { target: { value: "Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    expect(await screen.findByText(/Advanced search in progress/)).toBeInTheDocument();
    expect(screen.getByText(/Loading account details · 5 \/ 12/)).toBeInTheDocument();

    pending.resolve({ items: [], total: 0 });
    await waitFor(() => {
      expect(screen.queryByText(/Advanced search in progress/)).not.toBeInTheDocument();
    });
  });

  it("marks account profile filters as medium cost", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 7,
      selectedEndpoint: { id: 7, name: "Ceph A", capabilities: {} },
      selectedEndpointAccess: { can_metrics: true },
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.getByLabelText("Medium cost: account name filters may require per-account profile lookups.")).toBeInTheDocument();
    expect(screen.getByLabelText("Medium cost: email filters may require per-account profile lookups.")).toBeInTheDocument();
  });

  it("hides the horizontal table overflow behind the advanced filter drawer", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 7,
      selectedEndpoint: { id: 7, name: "Ceph A", capabilities: {} },
      selectedEndpointAccess: { can_metrics: true },
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-auto");

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.getByText("RGW Accounts listing").closest(".fixed")).toHaveClass("z-[46]");
    expect(getTableOverflowContainer()).toHaveClass("overflow-x-hidden");
    expect(getTableOverflowContainer()).not.toHaveClass("overflow-x-auto");
  });

  it("hides quota usage percent filters when metrics are unavailable", async () => {
    useCephAdminEndpointMock.mockReturnValue({
      loading: false,
      selectedEndpointId: 8,
      selectedEndpoint: { id: 8, name: "Ceph B", capabilities: {} },
      selectedEndpointAccess: { can_metrics: false },
      selectedEndpointAccessLoading: false,
      selectedEndpointAccessError: null,
    });
    listCephAdminAccountsMock.mockResolvedValue({ items: [], total: 0 });

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.queryByText("Quota usage %")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quota usage size % >=")).not.toBeInTheDocument();
  });
});
