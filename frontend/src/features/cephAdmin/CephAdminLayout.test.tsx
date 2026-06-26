import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarSection } from "../../components/Sidebar";
import type { TopbarDropdownOption } from "../../components/TopbarDropdownSelect";
import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "../../components/topbarControlWidths";
import { SELECTOR_TAGS_PREFERENCE_KEY } from "../../utils/selectorTagsPreference";
import CephAdminLayout from "./CephAdminLayout";

const useCephAdminEndpointMock = vi.fn();

let capturedNavSections: SidebarSection[] = [];
let capturedEndpointSelectProps: { options?: TopbarDropdownOption[]; widthClassName?: string; menuMinWidthClassName?: string } | null = null;

vi.mock("./CephAdminEndpointContext", () => ({
  CephAdminEndpointProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useCephAdminEndpoint: () => useCephAdminEndpointMock(),
}));

vi.mock("../../components/Layout", () => ({
  default: ({
    navSections,
    topbarControlDescriptors,
  }: {
    navSections?: SidebarSection[];
    topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
  }) => {
    capturedNavSections = navSections ?? [];
    return (
      <div>
        {topbarControlDescriptors?.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
      </div>
    );
  },
}));

vi.mock("../../components/TopbarDropdownSelect", () => ({
  __esModule: true,
  default: (props: { options?: TopbarDropdownOption[] }) => {
    capturedEndpointSelectProps = props;
    return null;
  },
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

function getNavLink(label: string) {
  return capturedNavSections.flatMap((section) => section.links).find((link) => link.label === label);
}

describe("CephAdminLayout", () => {
  beforeEach(() => {
    capturedNavSections = [];
    capturedEndpointSelectProps = null;
    localStorage.clear();
    useCephAdminEndpointMock.mockReset();
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

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    for (const label of ["Usage & Metrics", "RGW Accounts", "RGW Users", "Buckets", "Browser"]) {
      const link = getNavLink(label);
      expect(link?.disabled).toBe(true);
      expect(link?.disabledHint).toBe("Select a Ceph endpoint first.");
    }
  });

  it("uses loading hint while endpoint access is loading", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext({ selectedEndpointAccessLoading: true }));

    render(
      <MemoryRouter initialEntries={["/ceph-admin/buckets"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    for (const label of ["Usage & Metrics", "RGW Accounts", "RGW Users", "Buckets", "Browser"]) {
      const link = getNavLink(label);
      expect(link?.disabled).toBe(true);
      expect(link?.disabledHint).toBe("Endpoint access is loading.");
    }
  });

  it("shows metrics permission hint when neither metrics nor admin access is granted", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: false, can_metrics: false, can_accounts: true } })
    );

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const metricsLink = getNavLink("Usage & Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics access is not granted for this endpoint.");
  });

  it("keeps Usage & Metrics enabled for endpoint admins even when live metrics access is not granted", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: true, can_metrics: false, can_accounts: true } })
    );

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const metricsLink = getNavLink("Usage & Metrics");
    expect(metricsLink?.disabled).toBe(false);
    expect(metricsLink?.disabledHint).toBeUndefined();
  });

  it("shows endpoint capabilities hint when metrics capabilities are unavailable", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({
        selectedEndpoint: { id: 7, capabilities: { metrics: false, usage: false } },
        selectedEndpointAccess: { can_admin: false, can_metrics: true, can_accounts: true },
      })
    );

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const metricsLink = getNavLink("Usage & Metrics");
    expect(metricsLink?.disabled).toBe(true);
    expect(metricsLink?.disabledHint).toBe("Metrics are unavailable for this endpoint capabilities.");
  });

  it("shows RGW accounts admin hint when admin access is missing", () => {
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({ selectedEndpointAccess: { can_admin: false, can_metrics: true, can_accounts: true } })
    );

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

  it("disables Browser outside /ceph-admin/browser and shows the Buckets hint", () => {
    useCephAdminEndpointMock.mockReturnValue(buildEndpointContext());

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

    render(
      <MemoryRouter initialEntries={["/ceph-admin/browser"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    const browserLink = getNavLink("Browser");
    expect(browserLink?.disabled).toBe(false);
    expect(browserLink?.disabledHint).toBeUndefined();
  });

  it("passes endpoint tag details to the selector when the preference is enabled", () => {
    localStorage.setItem(SELECTOR_TAGS_PREFERENCE_KEY, "1");
    useCephAdminEndpointMock.mockReturnValue(
      buildEndpointContext({
        endpoints: [
          {
            id: 7,
            name: "Ceph Endpoint",
            is_default: true,
            endpoint_url: "https://ceph.example.test",
            tags: [
              { id: 1, label: "prod", color_key: "emerald", scope: "standard" },
              { id: 2, label: "ops-note", color_key: "amber", scope: "administrative" },
            ],
            capabilities: {
              metrics: true,
              usage: true,
            },
          },
          {
            id: 8,
            name: "Backup Endpoint",
            is_default: false,
            endpoint_url: "https://backup.example.test",
            tags: [],
            capabilities: {
              metrics: true,
              usage: true,
            },
          },
        ],
      })
    );

    render(
      <MemoryRouter initialEntries={["/ceph-admin"]}>
        <CephAdminLayout />
      </MemoryRouter>
    );

    expect(capturedEndpointSelectProps?.options).toHaveLength(2);
    expect(capturedEndpointSelectProps?.options?.[0].inlineAddon).toBeTruthy();
    expect(capturedEndpointSelectProps?.options?.[0].triggerAddon).toBeTruthy();
    expect(capturedEndpointSelectProps?.options?.[1].inlineAddon).toBeUndefined();
    const { getByText, queryByText } = render(<>{capturedEndpointSelectProps?.options?.[0].triggerAddon}</>);
    expect(getByText("prod")).toBeInTheDocument();
    expect(queryByText("ops-note")).not.toBeInTheDocument();
    expect(capturedEndpointSelectProps).toEqual(
      expect.objectContaining({
        widthClassName: TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
        menuMinWidthClassName: "min-w-[24rem]",
      })
    );
  });
});
