import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import CephAdminLayout from "./CephAdminLayout";

const useCephAdminEndpointMock = vi.fn();
const useGeneralSettingsMock = vi.fn();

let capturedNavSections: SidebarSection[] = [];

vi.mock("./CephAdminEndpointContext", () => ({
  CephAdminEndpointProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => useGeneralSettingsMock(),
}));

vi.mock("../../components/Layout", () => ({
  default: ({ navSections }: { navSections?: SidebarSection[] }) => {
    capturedNavSections = navSections ?? [];
    return <div />;
  },
}));

vi.mock("../../components/TopbarDropdownSelect", () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock("../../components/PageBanner", () => ({
  __esModule: true,
  default: () => null,
}));

function buildEndpointContext(overrides?: Record<string, unknown>) {
  const endpoint = {
    id: 7,
    name: "Ceph Endpoint",
    is_default: true,
    endpoint_url: "https://ceph.example.test",
    capabilities: {
      metrics: true,
      usage: true,
    },
  };
  return {
    endpoints: [endpoint],
    selectedEndpointId: endpoint.id,
    setSelectedEndpointId: vi.fn(),
    selectedEndpoint: endpoint,
    selectedEndpointAccess: {
      can_admin: true,
      can_metrics: true,
      can_accounts: true,
      admin_warning: null,
    },
    selectedEndpointAccessLoading: false,
    selectedEndpointAccessError: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

function buildGeneralSettings(overrides?: Record<string, unknown>) {
  return {
    browser_enabled: true,
    browser_ceph_admin_enabled: true,
    ...overrides,
  };
}

function getNavLink(label: string) {
  return capturedNavSections.flatMap((section) => section.links).find((link) => link.label === label);
}

describe("CephAdminLayout", () => {
  beforeEach(() => {
    capturedNavSections = [];
    useCephAdminEndpointMock.mockReset();
    useGeneralSettingsMock.mockReset();
  });

  it("uses endpoint-selection hint when no endpoint is selected", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({
        endpoints: [],
        selectedEndpointId: null,
        selectedEndpoint: null,
        selectedEndpointAccess: null,
      })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    for (const label of ["Metrics", "RGW Accounts", "RGW Users", "Buckets", "Browser"]) {
      const link = getNavLink(label);
      expect(link?.disabled).toBe(true);
      expect(link?.disabledHint).toBe("Select a Ceph endpoint first.");
    }
  });

  it("uses loading hint while endpoint access is loading", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ selectedEndpointAccessLoading: true }));
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    for (const label of ["Metrics", "RGW Accounts", "RGW Users", "Buckets", "Browser"]) {
      const link = getNavLink(label);
      expect(link?.disabled).toBe(true);
      expect(link?.disabledHint).toBe("Endpoint access is loading.");
    }
  });

  it("shows metrics permission hint when metrics access is not granted", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: true, can_metrics: false, can_accounts: true } })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const metricsLink = getNavLink("Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics access is not granted for this endpoint.");
  });

  it("shows endpoint capabilities hint when metrics capabilities are unavailable", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpoint: { id: 7, capabilities: { metrics: false, usage: false } } })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const metricsLink = getNavLink("Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics are unavailable for this endpoint capabilities.");
  });

  it("shows RGW accounts admin hint when admin access is missing", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: false, can_metrics: true, can_accounts: true } })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const accountsLink = getNavLink("RGW Accounts");
    expect(accountsLink?.disabled).toBe(true);
    expect(accountsLink?.disabledHint).toBe("Administrator access is required for RGW account management.");
  });

  it("shows RGW accounts permission hint when account management is not granted", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: true, can_metrics: true, can_accounts: false } })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const accountsLink = getNavLink("RGW Accounts");
    expect(accountsLink?.disabled).toBe(true);
    expect(accountsLink?.disabledHint).toBe("RGW account management is not granted for this endpoint.");
  });

  it("shows endpoint admin hint for RGW users and buckets when admin access is missing", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: false, can_metrics: true, can_accounts: true } })
    );
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const usersLink = getNavLink("RGW Users");
    const bucketsLink = getNavLink("Buckets");
    expect(usersLink?.disabledHint).toBe("Administrator access is required for this endpoint.");
    expect(bucketsLink?.disabledHint).toBe("Administrator access is required for this endpoint.");
  });

  it("shows Browser feature hint when global browser feature is disabled", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings({ browser_enabled: false }) });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const browserLink = getNavLink("Browser");
    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Browser feature is disabled in General settings.");
  });

  it("shows Ceph Admin Browser hint when the ceph-admin browser surface is disabled", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    useGeneralSettingsMock.mockReturnValue({
      generalSettings: buildGeneralSettings({ browser_ceph_admin_enabled: false }),
    });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const browserLink = getNavLink("Browser");
    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Ceph Admin Browser is disabled in Browser settings.");
  });

  it("disables Browser outside /ceph-admin/browser and shows the Buckets hint", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const browserLink = getNavLink("Browser");
    expect(browserLink?.disabled).toBe(true);
    expect(browserLink?.disabledHint).toBe("Open the bucket from the Buckets list.");
  });

  it("keeps Browser enabled on /ceph-admin/browser so active styling can be applied", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());
    useGeneralSettingsMock.mockReturnValue({ generalSettings: buildGeneralSettings() });

    render(
      <MemoryRouter initialEntries={["/ceph-admin/browser"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const browserLink = getNavLink("Browser");
    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
  });
});
