import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CephAdminEndpointProvider, useCephAdminEndpoint } from "./CephAdminEndpointContext";

const listCephAdminEndpointsMock = vi.fn();
const getCephAdminEndpointAccessMock = vi.fn();

vi.mock("../../api/cephAdmin", () => ({
  listCephAdminEndpoints: (...args: unknown[]) => listCephAdminEndpointsMock(...args),
  getCephAdminEndpointAccess: (...args: unknown[]) => getCephAdminEndpointAccessMock(...args),
}));

const ENDPOINTS = [
  { id: 1, name: "Primary", endpoint_url: "https://one.test", is_default: true, tags: [] },
  { id: 2, name: "Archive", endpoint_url: "https://two.test", is_default: false, tags: [] },
];

function Probe() {
  const { selectedEndpointId } = useCephAdminEndpoint();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedEndpointId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/ceph-admin/buckets?ep=2")}>Open endpoint 2</button>
      <button type="button" onClick={() => navigate("/ceph-admin/users")}>Navigate without endpoint</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<CephAdminEndpointProvider><Probe /></CephAdminEndpointProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("CephAdminEndpointProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    listCephAdminEndpointsMock.mockReset();
    getCephAdminEndpointAccessMock.mockReset();
    listCephAdminEndpointsMock.mockResolvedValue(ENDPOINTS);
    getCephAdminEndpointAccessMock.mockImplementation(async (endpointId: number) => ({
      endpoint_id: endpointId,
      can_admin: true,
      can_accounts: true,
      can_metrics: true,
    }));
  });

  it("treats the endpoint query parameter as authoritative", async () => {
    localStorage.setItem("selectedCephAdminEndpointId", "1");
    renderProvider("/ceph-admin/buckets?ep=2");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("2"));
    expect(localStorage.getItem("selectedCephAdminEndpointId")).toBe("2");
  });

  it("keeps the mounted endpoint when navigation omits the query parameter", async () => {
    const user = userEvent.setup();
    renderProvider("/ceph-admin/buckets?ep=1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("1"));

    localStorage.setItem("selectedCephAdminEndpointId", "2");
    await user.click(screen.getByRole("button", { name: "Navigate without endpoint" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/ceph-admin/users?ep=1"));
    expect(screen.getByTestId("selected")).toHaveTextContent("1");
  });

  it("switches the mounted tab when its URL selects another endpoint", async () => {
    const user = userEvent.setup();
    renderProvider("/ceph-admin/buckets?ep=1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("1"));

    await user.click(screen.getByRole("button", { name: "Open endpoint 2" }));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("2"));
  });
});
