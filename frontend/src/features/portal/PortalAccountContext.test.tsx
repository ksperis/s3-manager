import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalAccount } from "../../api/portal";
import { PortalAccountProvider, usePortalAccountContext } from "./PortalAccountContext";

const listPortalAccountsMock = vi.fn();

vi.mock("../../api/portal", () => ({
  listPortalAccounts: (...args: unknown[]) => listPortalAccountsMock(...args),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (values: { en: string }) => values.en,
  }),
}));

const ACCOUNTS = [
  {
    id: "101",
    name: "Project 101",
    rgw_account_id: "rgw-101",
    account_role: "portal_user",
    storage_endpoint_name: "Primary",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
  },
  {
    id: "102",
    name: "Project 102",
    rgw_account_id: "rgw-102",
    account_role: "portal_manager",
    storage_endpoint_name: "Primary",
    storage_endpoint_url: "https://s3.example.test",
    storage_endpoint_is_default: true,
    storage_endpoint_capabilities: {},
  },
] satisfies PortalAccount[];

function Probe() {
  const { selectedAccountId } = usePortalAccountContext();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedAccountId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/portal/spaces")}>Navigate without project</button>
      <button type="button" onClick={() => navigate("/portal?project=102")}>Open project 102</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="*" element={<PortalAccountProvider><Probe /></PortalAccountProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PortalAccountProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    listPortalAccountsMock.mockReset();
    listPortalAccountsMock.mockResolvedValue(ACCOUNTS);
  });

  it("uses the project query parameter as the tab authority", async () => {
    localStorage.setItem("selectedPortalAccountId", "101");
    renderProvider("/portal?project=102");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("102"));
    expect(localStorage.getItem("selectedPortalAccountId")).toBe("102");
  });

  it("keeps the mounted tab project when another tab changes the preference", async () => {
    const user = userEvent.setup();
    renderProvider("/portal?project=101");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("101"));

    localStorage.setItem("selectedPortalAccountId", "102");
    await user.click(screen.getByRole("button", { name: "Navigate without project" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/portal/spaces?project=101"));
    expect(screen.getByTestId("selected")).toHaveTextContent("101");
  });

  it("switches the mounted tab when its URL selects another project", async () => {
    const user = userEvent.setup();
    renderProvider("/portal?project=101");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("101"));

    await user.click(screen.getByRole("button", { name: "Open project 102" }));

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("102"));
  });
});
