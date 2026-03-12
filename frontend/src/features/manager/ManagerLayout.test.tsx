import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import ManagerLayout from "./ManagerLayout";

const useS3AccountContextMock = vi.fn();
const useGeneralSettingsMock = vi.fn();

let capturedNavSections: SidebarSection[] = [];

vi.mock("./S3AccountContext", () => ({
  S3AccountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => useGeneralSettingsMock(),
}));

vi.mock("../../components/Layout", () => ({
  default: ({ navSections, children }: { navSections?: SidebarSection[]; children: ReactNode }) => {
    capturedNavSections = navSections ?? [];
    return <div>{children}</div>;
  },
}));

vi.mock("../../components/TopbarContextAccountSelector", () => ({
  __esModule: true,
  default: () => null,
  getContextAccessModeVisual: () => ({ shortLabel: "Admin", classes: "" }),
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  formatAccountLabel: () => "Context",
  useDefaultStorageEndpoint: () => ({ defaultEndpointId: null, defaultEndpointName: null }),
}));

function buildContext(overrides?: Record<string, unknown>) {
  return {
    accounts: [
      {
        id: "s3u-1",
        display_name: "Managed S3 User",
        storage_endpoint_capabilities: { iam: false, usage: false, metrics: false, sns: false },
      },
    ],
    selectedS3AccountId: "s3u-1",
    setSelectedS3AccountId: vi.fn(),
    requiresS3AccountSelection: true,
    sessionS3AccountName: null,
    selectedS3AccountType: "s3_user",
    accessError: null,
    iamIdentity: "uid-1",
    accessMode: "s3_user",
    setAccessMode: vi.fn(),
    canSwitchAccess: false,
    managerStatsEnabled: false,
    managerBrowserEnabled: true,
    managerCephKeysEnabled: true,
    ...overrides,
  };
}

function buildGeneralSettings(overrides?: Record<string, unknown>) {
  return {
    manager_enabled: true,
    ceph_admin_enabled: false,
    storage_ops_enabled: false,
    browser_enabled: true,
    browser_root_enabled: true,
    browser_manager_enabled: true,
    browser_portal_enabled: true,
    browser_ceph_admin_enabled: true,
    allow_portal_manager_workspace: false,
    portal_enabled: false,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: false,
    bucket_compare_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_ui_user_bucket_migration: false,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: false,
    ...overrides,
  };
}

describe("ManagerLayout", () => {
  beforeEach(() => {
    capturedNavSections = [];
    useS3AccountContextMock.mockReset();
    useGeneralSettingsMock.mockReset();
    localStorage.clear();
  });

  it("shows Ceph section above Tools when manager_ceph_keys_enabled is true", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerCephKeysEnabled: true }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const labels = capturedNavSections.map((section) => section.label);
    expect(labels).toContain("Ceph");
    expect(labels).toContain("Tools");
    expect(labels.indexOf("Ceph")).toBeLessThan(labels.indexOf("Tools"));

    const cephSection = capturedNavSections.find((section) => section.label === "Ceph");
    expect(cephSection?.links.map((link) => link.label)).toEqual(["Access keys"]);
  });

  it("hides Ceph section when manager_ceph_keys_enabled is false", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerCephKeysEnabled: false }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const labels = capturedNavSections.map((section) => section.label);
    expect(labels).not.toContain("Ceph");
  });
});
