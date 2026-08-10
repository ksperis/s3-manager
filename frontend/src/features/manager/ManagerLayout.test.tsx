import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import {
  TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS,
  TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
} from "../../components/topbarControlWidths";
import ManagerLayout from "./ManagerLayout";

const useS3AccountContextMock = vi.fn();
const useGeneralSettingsMock = vi.fn();

let capturedNavSections: SidebarSection[] = [];
let capturedTopbarControlDescriptors: Array<{
  id: string;
  estimatedIconWidth?: number;
  renderControl: (mode: "icon" | "icon_label") => ReactNode;
}> = [];
let capturedAccountSelectorProps: {
  selectedContextId?: string | null;
  selectedLabel?: string;
  triggerMode?: string;
  widthClassName?: string;
  showTriggerTags?: boolean;
} | null = null;

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
    topbarControlDescriptors?: Array<{
      id: string;
      estimatedIconWidth?: number;
      renderControl: (mode: "icon" | "icon_label") => ReactNode;
    }>;
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
  default: (props: {
    selectedContextId?: string | null;
    selectedLabel?: string;
    triggerMode?: string;
    widthClassName?: string;
    showTriggerTags?: boolean;
  }) => {
    capturedAccountSelectorProps = props;
    return <button type="button">Manager account selector</button>;
  },
  getContextAccessModeVisual: () => ({ shortLabel: "Admin", classes: "" }),
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  formatAccountLabel: () => "Context",
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
    bucket_purge_enabled: false,
    bucket_compare_enabled: true,
    bucket_integrity_check_enabled: false,
    bucket_usage_stats_enabled: true,
    manager_ceph_s3_user_keys_enabled: true,
    allow_login_access_keys: false,
    allow_login_endpoint_list: false,
    allow_login_custom_endpoint: false,
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
        bucket_purge: false,
        feature_rules: true,
        bucket_quota: false,
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

  it("shows Ceph provisioning navigation without Ceph key inventory access", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: false,
      },
    });
    useS3AccountContextMock.mockReturnValue(
      buildContext({ managerCephKeysEnabled: false, managerPrivateAccessEnabled: true })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const cephSection = capturedNavSections.find((section) => section.label === "Ceph");
    expect(cephSection?.links.map((link) => link.label)).toEqual(["Access keys"]);
  });

  it("shows Feature rules and Integrity tools when bucket integrity flag is enabled", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: true,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: true,
        bucket_quota: false,
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
    expect(toolsSection?.links.map((link) => link.label)).toEqual(["Feature rules", "Integrity"]);
    expect(toolsSection?.links.map((link) => link.to)).toEqual(["/manager/feature-rules", "/manager/bucket-integrity"]);
    expect(toolsSection?.links.map((link) => link.iconName)).toEqual(["rules", "integrity"]);
  });

  it("shows Bucket purge tool when the flag and manager tool access are enabled", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: true,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({
        bucket_purge_enabled: true,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const toolsSection = capturedNavSections.find((section) => section.label === "Tools");
    expect(toolsSection?.links.map((link) => link.label)).toEqual(["Purge"]);
    expect(toolsSection?.links.map((link) => link.to)).toEqual(["/manager/bucket-purge"]);
    expect(toolsSection?.links.map((link) => link.iconName)).toEqual(["purge"]);
  });

  it("assigns distinct icons to every Manager tool link", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: true,
        bucket_integrity_check: true,
        bucket_migration: true,
        bucket_purge: true,
        feature_rules: true,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({
        bucket_migration_enabled: true,
        bucket_purge_enabled: true,
        bucket_integrity_check_enabled: true,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const toolsSection = capturedNavSections.find((section) => section.label === "Tools");
    expect(toolsSection?.links.map((link) => [link.label, link.iconName])).toEqual([
      ["Feature rules", "rules"],
      ["Compare", "compare"],
      ["Integrity", "integrity"],
      ["Purge", "purge"],
      ["Migration", "migration"],
    ]);
    expect(new Set(toolsSection?.links.map((link) => link.iconName)).size).toBe(toolsSection?.links.length ?? 0);
  });

  it("does not expose a dedicated Usage stats tool link", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({
        bucket_usage_stats_enabled: true,
      }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const toolsSection = capturedNavSections.find((section) => section.label === "Tools");
    expect(toolsSection).toBeUndefined();
    expect(capturedNavSections.flatMap((section) => section.links).map((link) => link.to)).not.toContain(
      "/manager/bucket-usage-stats"
    );
  });

  it("hides Feature rules when the manager tool access is not enabled", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    expect(capturedNavSections.find((section) => section.label === "Tools")).toBeUndefined();
  });

  it("shows Feature rules when manager tool access is inherited from effective access", () => {
    setStoredManagerUser({
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        bucket_purge: false,
        feature_rules: false,
        bucket_quota: false,
        ceph_s3_user_keys: true,
      },
      effective_access: {
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          bucket_purge: false,
          feature_rules: true,
          bucket_quota: false,
          ceph_s3_user_keys: true,
        },
      },
    });
    useS3AccountContextMock.mockReturnValue(buildContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const toolsSection = capturedNavSections.find((section) => section.label === "Tools");
    expect(toolsSection?.links.map((link) => link.label)).toEqual(["Feature rules"]);
  });

  it("keeps Usage & Metrics enabled while manager metrics context is loading when usage stats are enabled", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerStatsEnabled: null }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Usage & Metrics");
    expect(metricsLink?.disabled).toBe(false);
    expect(metricsLink?.disabledHint).toBeUndefined();
  });

  it("uses backend metrics message when Usage & Metrics is disabled", () => {
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        managerStatsEnabled: false,
        managerStatsMessage: "Manager metrics are temporarily blocked for this account.",
      })
    );
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({ bucket_usage_stats_enabled: false }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Usage & Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Manager metrics are temporarily blocked for this account.");
  });

  it("uses a default message when Usage & Metrics is disabled without backend reason", () => {
    useS3AccountContextMock.mockReturnValue(buildContext({ managerStatsEnabled: false, managerStatsMessage: null }));
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({ bucket_usage_stats_enabled: false }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Usage & Metrics");
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
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({ bucket_usage_stats_enabled: false }),
    });

    render(
      <MemoryRouter initialEntries={["/manager"]}>
        <ManagerLayout />
      </MemoryRouter>
    );

    const metricsLink = capturedNavSections
      .find((section) => section.label === "Overview")
      ?.links.find((link) => link.label === "Usage & Metrics");
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

  it("uses the selected context IAM capability before stored user capabilities", () => {
    setStoredManagerUser({
      capabilities: {
        can_manage_iam: false,
        can_manage_buckets: true,
        can_view_traffic: true,
      },
    });
    useS3AccountContextMock.mockReturnValue(
      buildContext({
        accounts: [
          {
            id: "conn-1",
            display_name: "AWS/tests3",
            storage_endpoint_capabilities: { iam: true, usage: false, metrics: false, sns: false },
            capabilities: { can_manage_iam: true, sts_capable: false, admin_api_capable: false },
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
    expect(capturedAccountSelectorProps?.widthClassName).toBe(TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS);
    expect(capturedTopbarControlDescriptors[0]?.estimatedIconWidth).toBe(36);

    render(<>{capturedTopbarControlDescriptors[0]?.renderControl("icon")}</>);

    expect(capturedAccountSelectorProps).toEqual(
      expect.objectContaining({
        selectedContextId: "ctx-1",
        selectedLabel: "Context",
        triggerMode: "icon",
        showTriggerTags: false,
      })
    );
    expect(capturedAccountSelectorProps?.widthClassName).toBe(TOPBAR_CONTEXT_SELECTOR_ICON_WIDTH_CLASS);
  });
});
