import { render, screen, waitFor, within } from "@testing-library/react";
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
    Object.assign(mocks.hookResult.workspace.spaces[0], {
      role: "Owner",
      status: "Active",
      visibility: "shared",
    });
    mocks.deleteObjectMock.mockResolvedValue(undefined);
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
    mocks.createPublicLinkMock.mockResolvedValue({
      id: 43,
      storage_space_id: "research-data",
      storage_space_name: "Research Data",
      object_key: "raw-data/2024/03/sample_001.fastq.gz",
      object_name: "sample_001.fastq.gz",
      url: "https://public.example.test/new-link",
      status: "Active",
      created_at: "2026-06-01T10:00:00Z",
      expires_at: null,
    });
    mocks.listPublicLinksMock.mockResolvedValue([]);
  });

  it("renders file detail tabs, simple actions, and unavailable advanced states", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "sample_001.fastq.gz" })).toBeInTheDocument();
    expect(screen.getByText("In Research Data. Preview, download, or share this file.")).toBeInTheDocument();
    expect(screen.getByText("Ready to create a public link")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Research Data" }).some((link) =>
      link.getAttribute("href") === "/portal/storage-spaces/research-data"
    )).toBe(true);
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Events" })).toBeInTheDocument();
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(await screen.findByText("hello content")).toBeInTheDocument();
    expect(screen.getByText("Public links")).toBeInTheDocument();
    expect(screen.getByText("Share this file outside the workspace only when anyone with the link should have access.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Public link expiration")).not.toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    expect(screen.queryByText("General information")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(mocks.createPublicLinkMock).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "Create public link" });
    expect(within(dialog).getByLabelText("Public link expiration")).toHaveClass("ui-control");
    expect(within(dialog).getByText("raw-data/2024/03/sample_001.fastq.gz")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create public link" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Set up public link" }));
    expect(mocks.createPublicLinkMock).not.toHaveBeenCalled();
    dialog = screen.getByRole("dialog", { name: "Create public link" });
    await user.click(within(dialog).getByRole("button", { name: "Create link" }));
    await waitFor(() => {
      expect(mocks.createPublicLinkMock).toHaveBeenCalledWith("101", "research-data", {
        object_key: "raw-data/2024/03/sample_001.fastq.gz",
        label: "sample_001.fastq.gz",
        expires_at: null,
      });
    });
    expect(screen.queryByRole("dialog", { name: "Create public link" })).not.toBeInTheDocument();
    expect(await screen.findByText("https://public.example.test/new-link")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://public.example.test/new-link");
    expect(await screen.findByText("Public link copied.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Details" }));
    expect((await screen.findAllByText("512 B")).length).toBeGreaterThan(1);
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("AES256")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Events" }));
    expect(screen.getByText("No file events available.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Versions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Metadata" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.queryByText(/mock|mocked/i)).not.toBeInTheDocument();
  });

  it("shows reasons for disabled sharing and delete actions", async () => {
    mocks.hookResult.workspace.spaces[0].role = "Viewer";
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("hello content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set up public link" })).toBeDisabled();
    expect(screen.getAllByText("Only Owners can create public links.").length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Delete file" })).toBeDisabled();
    expect(screen.getByText("Viewers cannot delete files.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy file location" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete file" }));
    expect(mocks.deleteObjectMock).not.toHaveBeenCalled();
  });

  it("opens structured dialogs for file delete and public link revoke", async () => {
    mocks.listPublicLinksMock.mockResolvedValue([
      {
        id: 42,
        storage_space_id: "research-data",
        storage_space_name: "Research Data",
        object_key: "raw-data/2024/03/sample_001.fastq.gz",
        object_name: "sample_001.fastq.gz",
        url: "https://public.example.test/sample_001.fastq.gz",
        status: "Active",
        created_at: "2026-06-01T10:00:00Z",
        expires_at: null,
      },
    ]);
    mocks.revokePublicLinkMock.mockResolvedValue([]);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("hello content")).toBeInTheDocument();
    expect(screen.getByText("1 active public link")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete file" });
    expect(within(deleteDialog).getByText("raw-data/2024/03/sample_001.fastq.gz")).toBeInTheDocument();
    expect(within(deleteDialog).getByText("This action cannot be undone from the Portal.")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "Cancel" }));

    await user.click(await screen.findByRole("button", { name: "Revoke" }));
    const revokeDialog = screen.getByRole("dialog", { name: "Revoke public link" });
    expect(within(revokeDialog).getByText("sample_001.fastq.gz")).toBeInTheDocument();
    expect(within(revokeDialog).getByText("Anyone using this URL loses access immediately.")).toBeInTheDocument();
    await user.click(within(revokeDialog).getByRole("button", { name: "Revoke link" }));

    await waitFor(() => {
      expect(mocks.revokePublicLinkMock).toHaveBeenCalledWith("101", "research-data", 42);
    });
  });
});
