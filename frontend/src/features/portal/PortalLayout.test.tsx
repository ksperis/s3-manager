import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { LanguageProvider } from "../../components/language";
import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "../../components/topbarControlWidths";
import PortalLayout from "./PortalLayout";

const mocks = vi.hoisted(() => ({
  setSelectedAccountId: vi.fn(),
  generalSettings: {
    manager_enabled: true,
    ceph_admin_enabled: false,
    storage_ops_enabled: false,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: false,
    portal_enabled: true,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: true,
    bucket_purge_enabled: false,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: false,
  },
}));

vi.mock("./PortalAccountContext", () => ({
  PortalAccountProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
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

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("../../components/ThemeToggle", () => ({
  default: () => <button type="button">Theme</button>,
}));

describe("PortalLayout", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("uses the shared shell with workspace and project selectors in the topbar", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        email: "laurent@example.com",
        display_name: "Laurent",
        role: "ui_admin",
        authType: "password",
        account_links: [
          {
            account_id: 101,
            account_admin: true,
            account_role: "portal_manager",
          },
        ],
      }),
    );
    const { container } = render(
      <MemoryRouter initialEntries={["/portal"]}>
        <PortalLayout />
      </MemoryRouter>,
    );

    expect(screen.getAllByText("S3 Manager").length).toBeGreaterThan(0);
    const topbar = container.querySelector("[data-topbar]") as HTMLElement;
    expect(topbar).not.toBeNull();
    const main = container.querySelector("main");
    expect(main).toHaveClass("px-4", "sm:px-8");
    expect(main?.className).not.toMatch(/portal/);

    const nav = screen.getByRole("navigation", { name: "PORTAL navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Dashboard",
      "Spaces",
      "Collaborators",
      "External tools",
      "History",
      "Storage health",
      "Help requests",
      "Settings",
    ]);
    expect(nav).not.toHaveTextContent("Administration");
    expect(nav).not.toHaveTextContent("Browser");
    expect(nav).not.toHaveTextContent("Buckets");
    expect(nav).not.toHaveTextContent("Billing");

    const desktopSidebar = container.querySelector(
      '[data-sidebar-variant="desktop"]',
    ) as HTMLElement;
    expect(desktopSidebar).not.toBeNull();
    await waitFor(() => {
      expect(
        within(topbar).getByRole("button", { name: "Switch workspace" }),
      ).toHaveTextContent("Portal");
    });
    expect(
      within(desktopSidebar).queryByRole("button", {
        name: "Switch workspace",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(desktopSidebar).queryByRole("button", { name: "Select project" }),
    ).not.toBeInTheDocument();
    expect(
      within(desktopSidebar).queryByText("Helios Retail"),
    ).not.toBeInTheDocument();

    const accountSelector = within(topbar).getByRole("button", {
      name: "Select project",
    });
    expect(accountSelector).toHaveTextContent("Project");
    expect(accountSelector).toHaveTextContent("Helios Retail");
    expect(accountSelector.parentElement).toHaveClass(
      ...TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS.split(" "),
    );
    await user.click(accountSelector);
    await user.click(
      await screen.findByRole("option", { name: "Northwind Ops" }),
    );
    expect(mocks.setSelectedAccountId).toHaveBeenCalledWith("102");
  });

  it("renders portal navigation in French when the session language is French", () => {
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        email: "laurent@example.com",
        display_name: "Laurent",
        role: "ui_admin",
        authType: "password",
        ui_language: "fr",
        account_links: [
          {
            account_id: 101,
            account_admin: true,
            account_role: "portal_manager",
          },
        ],
      }),
    );

    render(
      <LanguageProvider>
        <MemoryRouter initialEntries={["/portal"]}>
          <PortalLayout />
        </MemoryRouter>
      </LanguageProvider>,
    );

    const nav = screen.getByRole("navigation", { name: "PORTAL navigation" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Tableau de bord",
      "Espaces",
      "Collaborateurs",
      "Outils externes",
      "Historique",
      "État du stockage",
      "Demandes d'aide",
      "Paramètres",
    ]);
  });
});
