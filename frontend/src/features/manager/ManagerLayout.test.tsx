import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import ManagerLayout from "./ManagerLayout";

const useS3AccountContextMock = vi.fn();
const useGeneralSettingsMock = vi.fn();

let capturedNavSections: SidebarSection[] = [];
let capturedTopbarControlDescriptors: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }> = [];
let capturedAccountSelectorProps: { selectedContextId?: string | null; selectedLabel?: string } | null = null;

vi.mock("./S3AccountContext", () => ({
  S3AccountProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => useGeneralSettingsMock(),
}));

vi.mock("../../components/Layout", () => ({
  default: ({
    navSections,
    topbarControlDescriptors,
    children,
  }: {
    navSections?: SidebarSection[];
    topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
    children: ReactNode;
  }) => {
    capturedNavSections = navSections ?? [];
    capturedTopbarControlDescriptors = topbarControlDescriptors ?? [];
    return (
      <div>
        {capturedTopbarControlDescriptors.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
        {children}
      </div>
    );
  },
}));

vi.mock("../../components/TopbarContextAccountSelector", () => ({
  __esModule: true,
  default: (props: { selectedContextId?: string | null; selectedLabel?: string }) => {
    capturedAccountSelectorProps = props;
    return <button type="button">Manager account selector</button>;
  },
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
    managerStatsEnabled: false,
    managerStatsMessage: null,
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
    browser_ceph_admin_enabled: true,
    billing_enabled: false,
    endpoint_status_enabled: false,
    quota_alerts_enabled: false,
    usage_history_enabled: false,
    bucket_migration_enabled: false,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: false,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
    allow_user_private_connections: false,
    ...overrides,
  };
}

function setStoredManagerUser(overrides?: Record<string, unknown>) {
  localStorage.setItem(
    "user",
    JSON.stringify({
      role: "ui_user",
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: false,
        bucket_migration: false,
        ceph_s3_user_keys: true,
      },
      ...overrides,
    })
  );
}

describe("ManagerLayout", () => {
  beforeEach(() => {
    capturedNavSections = [];
    capturedTopbarControlDescriptors = [];
    capturedAccountSelectorProps = null;
    useS3AccountContextMock.mockReset();
    useGeneralSettingsMock.mockReset();
    localStorage.clear();
  });

  it("shows Ceph section above Tools when manager_ceph_keys_enabled is true", () => {
    setStoredManagerUser();
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
    setStoredManagerUser();
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

  it("shows Integrity tool when bucket integrity flag is enabled", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: true,
        bucket_migration: false,
        ceph_s3_user_keys: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({
        bucket_compare_enabled: false,
        bucket_integrity_check_enabled: true,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const toolsSection = capturedNavSections.find((section) => section.label === "Tools");
    expect(toolsSection?.links.map((link) => link.label)).toEqual(["Integrity"]);
  });

  it("shows bucket inventories in the manager Storage navigation", () => {
    setStoredManagerUser();
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const storageSection = capturedNavSections.find((section) => section.label === "Storage");
    expect(storageSection?.links.map((link) => link.label)).toEqual(["Buckets", "Lifecycles", "Bucket policies", "Browser"]);
    expect(storageSection?.links.map((link) => link.to)).toEqual([
      "/manager/buckets",
      "/manager/lifecycles",
      "/manager/bucket-policies",
      "/manager/browser",
    ]);
  });

  it("shows a loading hint for disabled Metrics while manager context is loading", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerStatsEnabled: null }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics availability is loading for this context.");
  });

  it("uses backend metrics message when Metrics is disabled", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerStatsEnabled: false,
        managerStatsMessage: "Manager metrics are temporarily blocked for this account.",
      })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Manager metrics are temporarily blocked for this account.");
  });

  it("uses a default message when Metrics is disabled without backend reason", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerStatsEnabled: false, managerStatsMessage: null }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics are disabled for this context.");
  });

  it("shows endpoint capability hint when metrics capabilities are unavailable", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerStatsEnabled: true,
        accounts: [
          {
            id: "s3u-1",
            display_name: "Managed S3 User",
            storage_endpoint_capabilities: { iam: true, usage: false, metrics: false, sns: true },
          },
        ],
      })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics are unavailable for this endpoint capabilities.");
  });

  it("shows IAM navigation for IAM-capable connection contexts", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        accounts: [
          {
            id: "conn-1",
            display_name: "AWS/tests3",
            storage_endpoint_capabilities: { iam: true, usage: false, metrics: false, sns: false },
          },
        ],
        selectedS3AccountId: "conn-1",
        selectedS3AccountType: "connection",
        accessMode: "connection",
        managerStatsEnabled: false,
      })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const iamSection = capturedNavSections.find((section) => section.label === "IAM");
    expect(iamSection?.links.map((link) => link.label)).toEqual(["Users", "Groups", "Roles", "Policies"]);
  });

  it("keeps the manager account context selector in the topbar controls", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        accounts: [
          { id: "ctx-1", display_name: "Primary", storage_endpoint_capabilities: {} },
          { id: "ctx-2", display_name: "Archive", storage_endpoint_capabilities: {} },
        ],
        selectedS3AccountId: "ctx-1",
        selectedS3AccountType: "connection",
        accessMode: "connection",
        iamIdentity: "ak-1",
      })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    expect(capturedTopbarControlDescriptors.map((descriptor) => descriptor.id)).toEqual(["account"]);
    expect(capturedAccountSelectorProps).toEqual(expect.objectContaining({ selectedContextId: "ctx-1", selectedLabel: "Context" }));
  });
});
