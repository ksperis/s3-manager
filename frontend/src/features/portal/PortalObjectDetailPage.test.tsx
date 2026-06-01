import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortalObjectDetailPage from "./PortalObjectDetailPage";

const mocks = vi.hoisted(() => ({
  downloadObjectMock: vi.fn(),
  listObjectsMock: vi.fn(),
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
  downloadPortalStorageSpaceObject: (...args: unknown[]) => mocks.downloadObjectMock(...args),
  listPortalStorageSpaceObjects: (...args: unknown[]) => mocks.listObjectsMock(...args),
}));

describe("PortalObjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.downloadObjectMock.mockResolvedValue({ blob: new Blob(["hello"]), filename: "sample_001.fastq.gz" });
    mocks.listObjectsMock.mockResolvedValue({
      prefix: "raw-data/2024/03/",
      prefixes: [],
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

  it("renders object detail tabs, actions, and unavailable states without browser handoff", async () => {
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
    expect(await screen.findByText("512 B")).toBeInTheDocument();
    expect(screen.getByText("Aperçu indisponible pour cet objet.")).toBeInTheDocument();
    expect(screen.getByText("Aucun événement objet disponible.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Versions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Métadonnées" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked|preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Open in Browser/i)).not.toBeInTheDocument();
  });
});
