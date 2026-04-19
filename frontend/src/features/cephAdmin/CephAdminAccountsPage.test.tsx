import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountsPage from "./CephAdminAccountsPage";

const useCephAdminEndpointMock = vi.fn();
const listCephAdminAccountsMock = vi.fn();

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
  };
});

describe("CephAdminAccountsPage", () => {
  beforeEach(() => {
    useCephAdminEndpointMock.mockReset();
    listCephAdminAccountsMock.mockReset();
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

    render(
      <MemoryRouter>
        <CephAdminAccountsPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No accounts found.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));
    fireEvent.change(screen.getByLabelText("Quota usage size % >="), { target: { value: "80" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply filter" }));

    await waitFor(() => {
      expect(listCephAdminAccountsMock).toHaveBeenCalledTimes(2);
    });

    const lastCall = listCephAdminAccountsMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(7);
    expect(JSON.parse(lastCall?.[1]?.advanced_filter as string)).toEqual({
      match: "all",
      rules: [{ field: "quota_usage_size_percent", op: "gte", value: 80 }],
    });
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

    expect(await screen.findByText("No accounts found.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /advanced filter/i }));

    expect(screen.queryByText("Quota usage %")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Quota usage size % >=")).not.toBeInTheDocument();
  });
});
