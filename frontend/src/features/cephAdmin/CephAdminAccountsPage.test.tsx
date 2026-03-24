import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import CephAdminAccountsPage from "./CephAdminAccountsPage";

const useCephAdminEndpointMock = vi.fn();
const listCephAdminAccountsMock = vi.fn();

vi.mock("./CephAdminEndpointContext", () => ({
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
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
});
