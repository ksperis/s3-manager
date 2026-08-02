import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PortalObjectDetailPage from "./PortalObjectDetailPage";
import { OBJECT_PREVIEW_MAX_BYTES } from "../shared/ObjectPreview";

const mocks = vi.hoisted(() => ({
  createPublicLinkMock: vi.fn(),
  deleteObjectMock: vi.fn(),
  downloadObjectMock: vi.fn(),
  fetchObjectDetailMock: vi.fn(),
  fetchObjectVersionsMock: vi.fn(),
  listPublicLinksMock: vi.fn(),
  restoreObjectMock: vi.fn(),
  revokePublicLinkMock: vi.fn(),
  createObjectUrlMock: vi.fn(() => "blob:portal-preview"),
  revokeObjectUrlMock: vi.fn(),
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
          role: "Manager",
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
  fetchPortalStorageSpaceObjectVersions: (...args: unknown[]) => mocks.fetchObjectVersionsMock(...args),
  listPortalStorageSpacePublicLinks: (...args: unknown[]) => mocks.listPublicLinksMock(...args),
  restorePortalStorageSpaceObject: (...args: unknown[]) => mocks.restoreObjectMock(...args),
  revokePortalStorageSpacePublicLink: (...args: unknown[]) => mocks.revokePublicLinkMock(...args),
}));

describe("PortalObjectDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: mocks.createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: mocks.revokeObjectUrlMock,
    });
    Object.assign(mocks.hookResult.workspace.spaces[0], {
      role: "Manager",
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
    mocks.fetchObjectVersionsMock.mockResolvedValue({
      key: "raw-data/2024/03/sample_001.fastq.gz",
      versioning_status: "Disabled",
      can_restore: false,
      versions: [],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });
    mocks.restoreObjectMock.mockResolvedValue({
      key: "raw-data/2024/03/sample_001.fastq.gz",
      restored_from_version_id: "v1",
      message: "Restored",
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
    expect(screen.getByRole("link", { name: "Back to files" })).toHaveAttribute(
      "href",
      "/portal/storage-spaces/research-data?prefix=raw-data%2F2024%2F03%2F",
    );
    expect(screen.queryByRole("link", { name: "Open in file list" })).not.toBeInTheDocument();
    expect(screen.getByText("Ready to create a public link")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Research Data" }).some((link) =>
      link.getAttribute("href") === "/portal/storage-spaces/research-data"
    )).toBe(true);
    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Sharing" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Events" })).not.toBeInTheDocument();
    expect(screen.getByText("Quick actions")).toBeInTheDocument();
    expect(await screen.findByText("hello content")).toBeInTheDocument();
    expect(screen.queryByText("Public links")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(screen.getByText("Public links")).toBeInTheDocument();
    expect(screen.getByText("Share this file outside the workspace only when anyone with the link should have access.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.queryByLabelText("Public link expiration")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("General information")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(mocks.createPublicLinkMock).not.toHaveBeenCalled();
    let dialog = screen.getByRole("dialog", { name: "Create public link" });
    expect(screen.getByText("Public links")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Public link expiration")).toHaveClass("ui-control");
    expect(within(dialog).getByText("raw-data/2024/03/sample_001.fastq.gz")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Create public link" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create link" }));
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
    expect(screen.getByRole("table")).toHaveClass("responsive-data-table");
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("https://public.example.test/new-link");
    expect(await screen.findByText("Public link copied.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Details" }));
    expect((await screen.findAllByText("512 B")).length).toBeGreaterThan(1);
    expect(screen.getByText("Technical details")).toBeInTheDocument();
    await user.click(screen.getByText("Technical details"));
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("AES256")).toBeInTheDocument();

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
    expect(screen.getAllByText("Only project managers can create public links.").length).toBeGreaterThan(1);
    await user.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(screen.getByText("Public links")).toBeInTheDocument();
    expect(screen.getAllByText("Only project managers can create public links.").length).toBeGreaterThan(1);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("button", { name: "Delete file" })).toBeDisabled();
    expect(screen.getByText("Viewers cannot delete files.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy file location" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete file" }));
    expect(mocks.deleteObjectMock).not.toHaveBeenCalled();
  });

  it("shows an end-user history and restores a selected version non-destructively", async () => {
    const user = userEvent.setup();
    mocks.fetchObjectVersionsMock.mockResolvedValue({
      key: "raw-data/2024/03/sample_001.fastq.gz",
      versioning_status: "Enabled",
      can_restore: true,
      versions: [
        {
          key: "raw-data/2024/03/sample_001.fastq.gz",
          version_id: "v2",
          is_latest: true,
          is_delete_marker: false,
          last_modified: "2026-05-27T08:15:00Z",
          size: 512,
        },
        {
          key: "raw-data/2024/03/sample_001.fastq.gz",
          version_id: "v1",
          is_latest: false,
          is_delete_marker: false,
          last_modified: "2026-05-26T08:15:00Z",
          size: 480,
        },
      ],
      is_truncated: false,
      next_key_marker: null,
      next_version_id_marker: null,
    });

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("tab", { name: "History" }));
    expect(screen.queryByRole("heading", { name: "File history" })).not.toBeInTheDocument();
    expect(screen.getByText("Current version")).toBeInTheDocument();
    expect(screen.getByText("Previous version")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Restoring an older version creates a new current version. The existing history stays available.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    const dialog = screen.getByRole("dialog", { name: "Restore this version?" });
    expect(
      within(dialog).getByText("The current and older versions remain in history."),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Restore version" }));

    await waitFor(() => {
      expect(mocks.restoreObjectMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        "raw-data/2024/03/sample_001.fastq.gz",
        "v1",
      );
    });
    expect(
      await screen.findByText("Version restored. It is now the current version."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Move to trash" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Move file to trash?" });
    expect(
      within(deleteDialog).getByText("The file can be restored from the Trash tab."),
    ).toBeInTheDocument();
  });

  it("keeps recovery guidance available when file history cannot be loaded", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.fetchObjectVersionsMock.mockRejectedValue(new Error("history unavailable"));

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.fastq.gz"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("tab", { name: "History" }));
    expect(screen.getByText("history unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    const dialog = screen.getByRole("dialog", { name: "Delete file" });
    expect(
      within(dialog).getByText(
        "The file will leave the file list. Its recovery status could not be verified.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "If file history is available, the file will appear in Trash.",
      ),
    ).toBeInTheDocument();

    consoleError.mockRestore();
  });

  it("loads an image preview through the shared portal download path", async () => {
    mocks.fetchObjectDetailMock.mockResolvedValue({
      key: "raw-data/2024/03/sample_001.png",
      name: "sample_001.png",
      size: 512,
      last_modified: "2026-05-27T08:15:00Z",
      content_type: "image/png",
      storage_class: "STANDARD",
      encryption: "AES256",
      preview_type: "image",
      preview_text: null,
      preview_unavailable_reason: null,
    });
    mocks.downloadObjectMock.mockResolvedValue({
      blob: new Blob(["image"], { type: "image/png" }),
      filename: "sample_001.png",
    });

    const view = render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/sample_001.png"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByRole("img", { name: "sample_001.png" })).toHaveAttribute(
      "src",
      "blob:portal-preview",
    );
    expect(mocks.downloadObjectMock).toHaveBeenCalledWith(
      "101",
      "research-data",
      "raw-data/2024/03/sample_001.png",
      expect.any(AbortSignal),
    );

    view.unmount();
    expect(mocks.revokeObjectUrlMock).toHaveBeenCalledWith("blob:portal-preview");
  });

  it("does not load an oversized preview and keeps manual download available", async () => {
    const user = userEvent.setup();
    const linkClickMock = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    mocks.fetchObjectDetailMock.mockResolvedValue({
      key: "raw-data/2024/03/large-video.mp4",
      name: "large-video.mp4",
      size: OBJECT_PREVIEW_MAX_BYTES + 1,
      last_modified: "2026-05-27T08:15:00Z",
      content_type: "video/mp4",
      storage_class: "STANDARD",
      encryption: null,
      preview_type: "unavailable",
      preview_text: null,
      preview_unavailable_reason: null,
    });

    render(
      <MemoryRouter initialEntries={["/portal/storage-spaces/research-data/objects/raw-data/2024/03/large-video.mp4"]}>
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(
      await screen.findByText(
        "Preview is limited to files of 50 MiB or less. Download the file to open it.",
      ),
    ).toBeInTheDocument();
    expect(mocks.downloadObjectMock).not.toHaveBeenCalled();

    await user.click(screen.getAllByRole("button", { name: "Download" })[0]);
    await waitFor(() => {
      expect(mocks.downloadObjectMock).toHaveBeenCalledWith(
        "101",
        "research-data",
        "raw-data/2024/03/large-video.mp4",
      );
    });
    linkClickMock.mockRestore();
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
    await user.click(screen.getByRole("tab", { name: "Sharing" }));
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    await user.click(screen.getByRole("button", { name: "Delete file" }));
    const deleteDialog = screen.getByRole("dialog", { name: "Delete file" });
    expect(within(deleteDialog).getByText("raw-data/2024/03/sample_001.fastq.gz")).toBeInTheDocument();
    expect(within(deleteDialog).getByText("This action cannot be undone from the Portal.")).toBeInTheDocument();
    await user.click(within(deleteDialog).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("tab", { name: "Sharing" }));
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
