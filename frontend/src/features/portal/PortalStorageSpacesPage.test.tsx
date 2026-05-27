import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PortalStorageSpacesPage from "./PortalStorageSpacesPage";

const mocks = vi.hoisted(() => ({
  hookResult: {
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
          createdLabel: "May 10, 2023",
          usedBytes: 512,
          quotaBytes: 1024,
          objectCount: 12,
          createdAt: "2026-03-10T10:00:00Z",
          shareCount: 3,
          files: [],
          objectDetail: {
            name: "image_001.jpg",
            path: "research-data/2024/image_001.jpg",
            sizeBytes: 512,
            type: "image/jpeg",
            lastModified: "Jun 10, 2024",
            etag: "mock",
            storageClass: "STANDARD",
            encryption: "AES-256",
            objectUrl: "https://s3.example.com/research-data/image_001.jpg",
            downloadUrl: "https://s3.example.com/research-data/image_001.jpg?download=1",
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
    state: { can_manage_buckets: true },
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

describe("PortalStorageSpacesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists storage spaces and opens the detail route", () => {
    render(
      <MemoryRouter>
        <PortalStorageSpacesPage />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Storage Spaces" })).toBeInTheDocument();
    expect(screen.getByText("Research Data")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data"
    );
    expect(screen.getByRole("button", { name: "+ Create storage space" })).toBeInTheDocument();
  });
});
