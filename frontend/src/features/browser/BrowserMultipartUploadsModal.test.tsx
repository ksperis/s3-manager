import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MultipartUploadItem } from "../../api/browser";
import BrowserMultipartUploadsModal from "./BrowserMultipartUploadsModal";

const uploadA: MultipartUploadItem = {
  key: "reports/2026/summary.csv",
  upload_id: "upload-a",
  initiated: "2026-03-10T09:10:11Z",
  storage_class: "STANDARD",
  owner: "alice",
};

const baseProps = {
  bucketName: "demo-bucket",
  uploads: [] as MultipartUploadItem[],
  loading: false,
  loadingMore: false,
  error: null as string | null,
  canLoadMore: false,
  abortingUploadIds: new Set<string>(),
  onRefresh: vi.fn(),
  onLoadMore: vi.fn(),
  onAbort: vi.fn(),
  onClose: vi.fn(),
};

function renderModal(overrides: Partial<typeof baseProps> = {}) {
  const props = {
    ...baseProps,
    onRefresh: vi.fn(),
    onLoadMore: vi.fn(),
    onAbort: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  const view = render(<BrowserMultipartUploadsModal {...props} />);
  return { props, ...view };
}

describe("BrowserMultipartUploadsModal", () => {
  it("shows empty state when there are no uploads", () => {
    renderModal({ uploads: [], loading: false });

    expect(screen.getByText("No multipart uploads in progress.")).toBeInTheDocument();
  });

  it("renders upload rows and triggers abort action", async () => {
    const user = userEvent.setup();
    const { props } = renderModal({ uploads: [uploadA] });

    expect(screen.getByText("reports/2026/summary.csv")).toBeInTheDocument();
    expect(screen.getByText("upload-a")).toBeInTheDocument();
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("alice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abort" }));

    expect(props.onAbort).toHaveBeenCalledTimes(1);
    expect(props.onAbort).toHaveBeenCalledWith(uploadA);
  });

  it("shows load more only when pagination is available and triggers modal actions", async () => {
    const user = userEvent.setup();

    const withoutLoadMore = renderModal({ canLoadMore: false });
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(withoutLoadMore.props.onRefresh).toHaveBeenCalledTimes(1);
    withoutLoadMore.unmount();

    const withLoadMore = renderModal({ canLoadMore: true, uploads: [uploadA] });
    const loadMoreButton = screen.getByRole("button", { name: "Load more" });

    await user.click(loadMoreButton);

    expect(withLoadMore.props.onLoadMore).toHaveBeenCalledTimes(1);
  });
});
