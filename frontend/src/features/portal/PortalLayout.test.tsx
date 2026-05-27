import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import PortalLayout from "./PortalLayout";

const mocks = vi.hoisted(() => ({
  setSelectedAccountId: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  PortalAccountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePortalAccountContext: () => ({
    accounts: [
      { id: "101", name: "Helios Retail", tags: [] },
      { id: "102", name: "Northwind Ops", tags: [] },
    ],
    selectedAccountId: "101",
    selectedAccount: { id: "101", name: "Helios Retail", tags: [] },
    setSelectedAccountId: mocks.setSelectedAccountId,
    loading: false,
    error: null,
  }),
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  useDefaultStorageEndpoint: () => ({
    defaultEndpointId: 11,
    defaultEndpointName: "Default",
  }),
  formatAccountLabel: (account: { name: string }) => account.name,
}));

describe("PortalLayout", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders the portal v3 navigation with administration and no browser entry", () => {
    window.localStorage.setItem("user", JSON.stringify({ email: "laurent@example.com", display_name: "Laurent" }));
    render(
      <MemoryRouter initialEntries={["/portal"]}>
        <PortalLayout />
      </MemoryRouter>
    );

    expect(screen.getByText("S3 Manager")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Portal navigation" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Storage Spaces",
      "Shares",
      "Activity",
      "Transfers",
      "Usage & Analytics",
      "Users",
      "Groups",
      "Policies",
      "Access Keys",
      "Settings",
    ]);
    expect(nav).toHaveTextContent("Administration");
    expect(nav).not.toHaveTextContent("Browser");
    expect(nav).not.toHaveTextContent("Buckets");
    expect(nav).not.toHaveTextContent("Billing");
    expect(screen.getByRole("combobox", { name: "Select portal account" })).toHaveValue("101");
    expect(screen.getByText("Laurent")).toBeInTheDocument();
  });
});
