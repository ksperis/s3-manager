import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { GeneralSettings } from "../../api/appSettings";
import PortalLayout from "./PortalLayout";

const mocks = vi.hoisted(() => ({
  setSelectedAccountId: vi.fn(),
  generalSettings: {} as GeneralSettings,
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("./PortalAccountContext", () => ({
  PortalAccountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  usePortalAccountContext: () => ({
    accounts: [
      {
        id: "101",
        name: "Helios Retail",
        tags: [],
        storage_endpoint_id: 11,
        storage_endpoint_name: "Default",
        storage_endpoint_url: "https://s3-default.docs.example.com",
      },
      {
        id: "102",
        name: "Northwind Ops",
        tags: [],
        storage_endpoint_id: 12,
        storage_endpoint_name: "Archive",
        storage_endpoint_url: "https://s3-archive.docs.example.com",
      },
    ],
    selectedAccountId: "101",
    selectedAccount: {
      id: "101",
      name: "Helios Retail",
      tags: [],
      storage_endpoint_id: 11,
      storage_endpoint_name: "Default",
      storage_endpoint_url: "https://s3-default.docs.example.com",
    },
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

vi.mock("../../components/Layout", () => ({
  default: ({
    headerTitle,
    sidebarTitle,
    hideTopbar,
    topbarControlDescriptors,
  }: {
    headerTitle: string;
    sidebarTitle?: string;
    hideTopbar?: boolean;
    topbarControlDescriptors?: Array<{
      id: string;
      renderControl: (mode: "icon" | "icon_label") => ReactNode;
    }>;
  }) => (
    <div data-testid="portal-layout" data-hide-topbar={String(Boolean(hideTopbar))}>
      <div data-testid="header-title">{headerTitle}</div>
      <div data-testid="sidebar-title">{sidebarTitle}</div>
      <div data-testid="topbar-descriptors">{topbarControlDescriptors?.map((descriptor) => descriptor.id).join(",")}</div>
      <div data-testid="topbar-controls">
        {topbarControlDescriptors?.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
      </div>
    </div>
  ),
}));

const baseSettings: GeneralSettings = {
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
  bucket_compare_enabled: true,
  bucket_integrity_check_enabled: true,
  manager_ceph_s3_user_keys_enabled: true,
  allow_login_access_keys: false,
  allow_login_endpoint_list: false,
  allow_login_custom_endpoint: false,
  allow_user_private_connections: false,
};

describe("PortalLayout", () => {
  beforeEach(() => {
    mocks.generalSettings = { ...baseSettings };
    window.localStorage.setItem(
      "user",
      JSON.stringify({
        role: "ui_user",
        authType: "password",
        account_links: [{ account_id: 101, account_role: "portal_manager" }],
      })
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps the common topbar available and registers the portal account selector", () => {
    render(
      <MemoryRouter initialEntries={["/portal"]}>
        <PortalLayout />
      </MemoryRouter>
    );

    expect(screen.getByTestId("portal-layout")).toHaveAttribute("data-hide-topbar", "false");
    expect(screen.getByTestId("header-title")).toHaveTextContent("Portal");
    expect(screen.getByTestId("sidebar-title")).toHaveTextContent("PORTAL");
    expect(screen.getByTestId("topbar-descriptors")).toHaveTextContent("account");
    expect(screen.getByRole("button", { name: "Select portal account" })).toHaveTextContent("Helios Retail");
  });
});
