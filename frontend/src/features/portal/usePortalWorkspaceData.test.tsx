import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../../components/language";
import { usePortalWorkspaceData } from "./usePortalWorkspaceData";

const mocks = vi.hoisted(() => ({
  fetchPortalActivityMock: vi.fn(),
  fetchPortalAlertsMock: vi.fn(),
  fetchPortalCollaboratorsMock: vi.fn(),
  fetchPortalStateMock: vi.fn(),
  fetchPortalUsageMock: vi.fn(),
  fetchPortalUsageTrendsMock: vi.fn(),
  fetchPortalTrafficMock: vi.fn(),
  listPortalStorageSpacesMock: vi.fn(),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: "101",
    selectedAccount: { id: "101", name: "Account 1", tags: [] },
    hasAccountContext: true,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/portal", () => ({
  fetchPortalCollaborators: (...args: unknown[]) => mocks.fetchPortalCollaboratorsMock(...args),
  fetchPortalState: (...args: unknown[]) => mocks.fetchPortalStateMock(...args),
  listPortalStorageSpaces: (...args: unknown[]) => mocks.listPortalStorageSpacesMock(...args),
}));

vi.mock("../../api/portalActivity", () => ({
  fetchPortalActivity: (...args: unknown[]) => mocks.fetchPortalActivityMock(...args),
  fetchPortalAlerts: (...args: unknown[]) => mocks.fetchPortalAlertsMock(...args),
}));

vi.mock("../../api/portalUsage", () => ({
  fetchPortalUsage: (...args: unknown[]) => mocks.fetchPortalUsageMock(...args),
  fetchPortalUsageTrends: (...args: unknown[]) => mocks.fetchPortalUsageTrendsMock(...args),
  fetchPortalTraffic: (...args: unknown[]) => mocks.fetchPortalTrafficMock(...args),
}));

vi.mock("../../api/healthchecks", () => ({
  fetchPortalWorkspaceHealthOverview: vi.fn(),
}));

function Probe({ includeArchived = false }: { includeArchived?: boolean }) {
  usePortalWorkspaceData({ includeArchived });
  return null;
}

describe("usePortalWorkspaceData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchPortalActivityMock.mockResolvedValue([]);
    mocks.fetchPortalAlertsMock.mockResolvedValue([]);
    mocks.fetchPortalCollaboratorsMock.mockResolvedValue({
      summary: { collaborator_count: 0, external_access_key_count: 0, trend: null },
      collaborators: [],
    });
    mocks.fetchPortalStateMock.mockResolvedValue({});
    mocks.fetchPortalUsageMock.mockResolvedValue(null);
    mocks.fetchPortalUsageTrendsMock.mockResolvedValue(null);
    mocks.fetchPortalTrafficMock.mockResolvedValue(null);
    mocks.listPortalStorageSpacesMock.mockResolvedValue([]);
  });

  it("requests archived Storage Spaces when the caller needs them", async () => {
    render(
      <LanguageProvider>
        <Probe includeArchived />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(mocks.listPortalStorageSpacesMock).toHaveBeenCalledWith("101", { includeArchived: true });
    });
  });

  it("keeps archived Storage Spaces out of default workspace loads", async () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>
    );

    await waitFor(() => {
      expect(mocks.listPortalStorageSpacesMock).toHaveBeenCalledWith("101", undefined);
    });
  });
});
