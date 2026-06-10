import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ComponentProps } from "react";
import PortalStorageSpaceDetailPage from "./PortalStorageSpaceDetailPage";
import BrowserEmbed from "../browser/BrowserEmbed";

const mocks = vi.hoisted(() => ({
  updateStorageSpaceMock: vi.fn(),
  generalSettings: {
    browser_enabled: true,
    browser_portal_enabled: true,
  },
  hookResult: {
    accountIdForApi: "101",
    selectedAccount: {
      id: "101",
      name: "Account 1",
      tags: [],
      quota_max_size_gb: 10,
      quota_max_objects: 1000,
      storage_endpoint_capabilities: { sse: true, sts: true },
    },
    workspace: {
      accountName: "Account 1",
      userEmail: "manager@example.com",
      usedBytes: 512,
      usedObjects: 12,
      quotaBytes: 1024,
      quotaObjects: null,
      spaces: [
        {
          id: "research-data",
          name: "Research Data",
          internalName: "research-data-internal",
          description: "Research Data shared storage",
          role: "Owner",
          status: "Active",
          access: "Private",
          region: "eu-west-3",
          createdLabel: "12 mars 2024",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
        },
      ],
      activity: [
        {
          id: "activity-1",
          actor: "manager@example.com",
          action: "Uploaded files",
          target: "sample_001.fastq.gz",
          spaceId: "research-data",
          spaceName: "Research Data",
          timeLabel: "4 min ago",
          ipAddress: "192.168.1.10",
        },
      ],
      transfers: [],
      alerts: [],
    },
    loading: false,
    accountLoading: false,
    error: null,
    accountError: null,
    hasAccountContext: true,
  },
}));

vi.mock("./usePortalWorkspaceData", () => ({
  usePortalWorkspaceData: () => mocks.hookResult,
}));

vi.mock("../../components/GeneralSettingsContext", () => ({
  useGeneralSettings: () => ({
    generalSettings: mocks.generalSettings,
  }),
}));

vi.mock("../../api/portal", () => ({
  updatePortalStorageSpace: (...args: unknown[]) => mocks.updateStorageSpaceMock(...args),
}));

vi.mock("../browser/BrowserEmbed", () => ({
  default: vi.fn(() => <div data-testid="portal-browser-embed" />),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/portal/storage-spaces/research-data"]}>
      <Routes>
        <Route path="/portal/storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("PortalStorageSpaceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generalSettings.browser_enabled = true;
    mocks.generalSettings.browser_portal_enabled = true;
  });

  it("embeds the main Browser in locked portal-basic mode for the storage space", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Research Data" })).toBeInTheDocument();
    expect(screen.getByTestId("portal-browser-embed")).toBeInTheDocument();

    const embedProps = vi.mocked(BrowserEmbed).mock.calls[0][0] as ComponentProps<typeof BrowserEmbed>;
    expect(embedProps).toMatchObject({
      accountIdForApi: "101",
      hasContext: true,
      workspaceSurface: "portal",
      actionProfile: "portal-basic",
      lockedBucketName: "research-data-internal",
      lockedBucketLabel: "Research Data",
      quotaMaxSizeGb: 10,
      quotaMaxObjects: 1000,
    });
    expect(embedProps.storageEndpointCapabilities).toEqual({ sse: true, sts: true });
  });

  it("shows a disabled state when the Portal Browser kill switch is off", () => {
    mocks.generalSettings.browser_portal_enabled = false;

    renderPage();

    expect(screen.getByText(/Le Browser Portal est désactivé/i)).toBeInTheDocument();
    expect(screen.queryByTestId("portal-browser-embed")).not.toBeInTheDocument();
  });
});
