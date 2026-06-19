import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortalObjectDetailPage from "./PortalObjectDetailPage";

const mocks = vi.hoisted(() => ({
  createPublicLinkMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  downloadObjectMock: vi.fn(),
  fetchObjectDetailMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  hookResult: {
    accountIdForApi: "101",
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
          internalName: "research-data",
          description: "Research Data shared storage",
          role: "Owner",
          status: "Active",
          access: "Shared",
          ownerUserId: 7,
          visibility: "shared",
          region: "eu-west-3",
          createdLabel: "12 mars 2024",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
        },
      ],
      activity: [],
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

vi.mock("../../api/portal", () => ({
  createPortalStorageSpacePublicLink: (...args: unknown[]) => mocks.createPublicLinkMock(...args),
  deletePortalStorageSpaceObject: (...args: unknown[]) => mocks.deleteObjectMock(...args),
  downloadPortalStorageSpaceObject: (...args: unknown[]) => mocks.downloadObjectMock(...args),
  fetchPortalStorageSpaceObjectDetail: (...args: unknown[]) => mocks.fetchObjectDetailMock(...args),
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listPublicLinksMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokePublicLinkMock(...args),
}));

describe("PortalObjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectMock.mockResolvedValue({ blob: new Blob(["hello"]), filename: "sample_001.fastq.gz" });
    mocks.fetchObjectDetailMock.mockResolvedValue({
      key: "raw-data/2024/03/sample_001.fastq.gz",
      name: "sample_001.fastq.gz",
      size: 512,
      last_modified: "2026-05-27T08:15:00Z",
      content_type: "text/plain",
      storage_class: "STANDARD",
      encryption: "AES256",
      preview_type: "text",
      preview_text: "hello content",
      preview_unavailable_reason: null,
    });
    mocks.listPublicLinksMock.mockResolvedValue([]);
  });

  it("renders object detail tabs, simple actions, and unavailable advanced states", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "sample_001.fastq.gz" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aperçu" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Détails" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Événements" })).toBeInTheDocument();
    expect(screen.getByText("Actions rapides")).toBeInTheDocument();
    expect(await screen.findByText("hello content")).toBeInTheDocument();
    expect(screen.getByText("Liens publics")).toBeInTheDocument();
    expect(screen.queryByText("Informations générales")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Détails" }));
    expect(await screen.findByText("512 B")).toBeInTheDocument();
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("AES256")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Événements" }));
    expect(screen.getByText("Aucun événement objet disponible.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Versions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Métadonnées" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
  });
});
