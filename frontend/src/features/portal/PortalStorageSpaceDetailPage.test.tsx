import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortalStorageSpaceDetailPage from "./PortalStorageSpaceDetailPage";

const mocks = vi.hoisted(() => ({
  listObjectsMock: vi.fn(),
  uploadObjectMock: vi.fn(),
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
          access: "Private",
          region: "eu-west-3",
          createdLabel: "12 mars 2024",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
          defaultPrefix: "raw-data/2024/03/",
          files: [
            {
              id: "folder-1",
              name: "01-fastq",
              kind: "folder",
              path: "raw-data/2024/03/01-fastq/",
              updatedLabel: "12 mars 2024, 10:10",
              ownerLabel: "Workspace",
              typeLabel: "Dossier",
            },
            {
              id: "file-1",
              name: "sample_001.fastq.gz",
              kind: "file",
              path: "raw-data/2024/03/sample_001.fastq.gz",
              sizeBytes: 512,
              updatedLabel: "12 mars 2024, 10:15",
              ownerLabel: "You",
              mimeType: "application/gzip",
              typeLabel: "Fichier",
            },
          ],
          objectDetail: {
            name: "sample_001.fastq.gz",
            path: "raw-data/2024/03/sample_001.fastq.gz",
            sizeBytes: 512,
            type: "application/gzip",
            lastModified: "12 mars 2024",
            etag: "mock",
            storageClass: "STANDARD",
            encryption: "AES-256",
            objectUrl: "s3://research-data/raw-data/2024/03/sample_001.fastq.gz",
            downloadUrl: "https://s3.example.com/research-data/sample_001.fastq.gz?download=1",
            versions: [],
            events: [],
            previewLines: [],
          },
        },
      ],
      sharesWithMe: [],
      sharesByMe: [],
      publicLinks: [],
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

vi.mock("../../api/portal", () => ({
  listPortalStorageSpaceObjects: (...args: unknown[]) => mocks.listObjectsMock(...args),
  uploadPortalStorageSpaceObject: (...args: unknown[]) => mocks.uploadObjectMock(...args),
}));

describe("PortalStorageSpaceDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listObjectsMock.mockResolvedValue({
      prefix: "raw-data/2024/03/",
      prefixes: ["raw-data/2024/03/01-fastq/"],
      objects: [
        {
          key: "raw-data/2024/03/sample_001.fastq.gz",
          name: "sample_001.fastq.gz",
          size: 512,
          last_modified: "2026-05-27T08:15:00Z",
        },
      ],
      is_truncated: false,
      next_continuation_token: null,
    });
  });

  it("renders a portal object list view and links files to object detail", async () => {
    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data?prefix=raw-data/2024/03/"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId" element={<PortalStorageSpaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Research Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Téléverser" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Nouveau dossier" })).toBeInTheDocument();
    expect(screen.getByText("Racine")).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "01-fastq" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data?prefix=raw-data%2F2024%2F03%2F01-fastq%2F"
    );
    expect(screen.getByRole("link", { name: "sample_001.fastq.gz" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"
    );
    await waitFor(() => {
      expect(mocks.listObjectsMock).toHaveBeenCalledWith("101", "research-data", { prefix: "raw-data/2024/03/" });
    });
    expect(screen.queryByText(/Open in Browser/i)).not.toBeInTheDocument();
  });
});
