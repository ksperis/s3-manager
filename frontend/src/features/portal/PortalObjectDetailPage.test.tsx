import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortalObjectDetailPage from "./PortalObjectDetailPage";

const mocks = vi.hoisted(() => ({
  downloadObjectMock: vi.fn(),
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
            lastModified: "12 mars 2024, 10:15:43",
            etag: "mock",
            storageClass: "STANDARD",
            encryption: "AES-256",
            objectUrl: "s3://research-data/raw-data/2024/03/sample_001.fastq.gz",
            downloadUrl: "https://s3.example.com/research-data/sample_001.fastq.gz?download=1",
            versions: [
              { id: "null (actuelle)", sizeBytes: 512, lastModified: "12 mars 2024", actionLabel: "Actuelle", current: true },
              { id: "4f2a1c...b8e9", sizeBytes: 512, lastModified: "11 mars 2024", actionLabel: "Restaurer" },
            ],
            events: [
              { id: "event-1", label: "Objet téléchargé", actor: "Alice", timeLabel: "Il y a 2 min" },
            ],
            previewLines: ["@SEQ_ID_001", "GATTGGGGTTCAAGCAGTATC"],
          },
        },
      ],
      sharesWithMe: [],
      sharesByMe: [],
      publicLinks: [],
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
  downloadPortalStorageSpaceObject: (...args: unknown[]) => mocks.downloadObjectMock(...args),
}));

describe("PortalObjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectMock.mockResolvedValue({ blob: new Blob(["hello"]), filename: "sample_001.fastq.gz" });
  });

  it("renders object detail tabs, actions, and recent events without browser handoff", () => {
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
    expect(screen.getByText("Informations générales")).toBeInTheDocument();
    expect(screen.getByText("Actions rapides")).toBeInTheDocument();
    expect(screen.getByText("Objet téléchargé")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Versions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Métadonnées" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Open in Browser/i)).not.toBeInTheDocument();
  });
});
