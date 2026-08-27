import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserToolbar from "./BrowserToolbar";
import type { BrowserActionState } from "./browserActions";
import type { BrowserColumnId } from "./browserObjectTableModel";

type ToolbarProps = ComponentProps<typeof BrowserToolbar>;

const pathAction: BrowserActionState = {
  id: "paste",
  section: "path",
  label: "Paste",
  visible: true,
  enabled: true,
};

const selectionAction: BrowserActionState = {
  id: "copy",
  section: "selection",
  label: "Copy",
  visible: true,
  enabled: true,
};

function buildProps(overrides: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    bucketSelector: {
      rootRef: createRef<HTMLDivElement>(),
      filterInputRef: createRef<HTMLInputElement>(),
      lockedBucketName: "documents",
      hasContext: true,
      open: false,
      buttonLabel: "Documents",
      buttonActionLabel: "Current bucket: Documents",
      needsAttention: false,
      workspaceNoun: "bucket",
      workspaceNounPlural: "buckets",
      workspaceNounTitle: "Bucket",
      bucketManagementEnabled: false,
      filter: "",
      loading: false,
      hasError: false,
      totalCount: 1,
      total: 1,
      items: [],
      activeBucketName: "documents",
      displayNameByBucket: new Map(),
      canLoadMore: false,
      loadingMore: false,
      onToggle: vi.fn(),
      onCreateBucket: vi.fn(),
      onFilterChange: vi.fn(),
      onRetry: vi.fn(),
      onSelectBucket: vi.fn(),
      onLoadMore: vi.fn(),
    },
    pathNavigator: {
      inputRef: createRef<HTMLInputElement>(),
      editing: false,
      value: "reports/",
      disabled: false,
      suggestions: [],
      suggestionsLoading: false,
      activeSuggestionIndex: -1,
      breadcrumbs: [
        { label: "root", prefix: "" },
        { label: "reports", prefix: "reports/" },
      ],
      canGoUp: true,
      onStartEditing: vi.fn(),
      onChange: vi.fn(),
      onBlur: vi.fn(),
      onKeyDown: vi.fn(),
      onHoverSuggestion: vi.fn(),
      onSelectSuggestion: vi.fn(),
      onGoUp: vi.fn(),
      onSelectPrefix: vi.fn(),
    },
    deletedObjects: {
      showToggle: false,
      showDeleted: false,
      showRestore: false,
      restoreEnabled: false,
    },
    compactActions: {
      visible: true,
      canUploadFiles: true,
      canUploadFolder: true,
      canCreateFolder: true,
      canRefresh: true,
    },
    selectionActions: {
      visible: false,
      mobileViewport: false,
      summary: "No selection",
      canOpen: false,
      canCopy: false,
      canDownload: false,
      canDelete: false,
    },
    menuResetKey: "documents:reports/:none",
    moreMenu: {
      status: {
        visible: false,
        accessBadge: null,
        onOpenOperations: vi.fn(),
      },
      layout: {},
      pathActions: [],
      selectionActions: [],
      selectionOverflow: false,
    },
    fileInputRef: createRef<HTMLInputElement>(),
    folderInputRef: createRef<HTMLInputElement>(),
    onFileInputChange: vi.fn(),
    onFolderInputChange: vi.fn(),
    onRunPathAction: vi.fn(),
    onRunSelectionAction: vi.fn(),
    ...overrides,
  };
}

describe("BrowserToolbar", () => {
  it("routes compact, upload, and deleted-object actions", () => {
    const props = buildProps({
      deletedObjects: {
        showToggle: true,
        showDeleted: true,
        showRestore: true,
        restoreEnabled: true,
      },
    });
    render(<BrowserToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide deleted files" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Restore deleted files in this folder",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "Upload" })).getByRole(
        "menuitem",
        { name: "Upload files" },
      ),
    );

    expect(props.onRunPathAction).toHaveBeenNthCalledWith(
      1,
      "toggleShowDeleted",
    );
    expect(props.onRunPathAction).toHaveBeenNthCalledWith(2, "restore");
    expect(props.onRunPathAction).toHaveBeenNthCalledWith(3, "newFolder");
    expect(props.onRunPathAction).toHaveBeenNthCalledWith(4, "refresh");
    expect(props.onRunPathAction).toHaveBeenNthCalledWith(5, "uploadFiles");
  });

  it("renders the desktop selection bar and routes its primary actions", () => {
    const props = buildProps({
      compactActions: {
        ...buildProps().compactActions,
        visible: false,
      },
      selectionActions: {
        visible: true,
        mobileViewport: false,
        summary: "2 selected",
        canOpen: true,
        canCopy: false,
        canDownload: true,
        canDelete: true,
      },
    });
    render(<BrowserToolbar {...props} />);

    const actionBar = screen.getByRole("toolbar", {
      name: "Browser actions bar",
    });
    expect(within(actionBar).getByText("2 selected")).toBeInTheDocument();
    expect(within(actionBar).getByRole("button", { name: "Copy" })).toBeDisabled();

    fireEvent.click(within(actionBar).getByRole("button", { name: "Open" }));
    fireEvent.click(
      within(actionBar).getByRole("button", { name: "Download" }),
    );
    fireEvent.click(within(actionBar).getByRole("button", { name: "Delete" }));

    expect(props.onRunSelectionAction).toHaveBeenNthCalledWith(1, "open");
    expect(props.onRunSelectionAction).toHaveBeenNthCalledWith(2, "download");
    expect(props.onRunSelectionAction).toHaveBeenNthCalledWith(3, "delete");
  });

  it("presents status, layout, columns, secondary actions, and SSE-C", () => {
    const onOpenOperations = vi.fn();
    const onToggleFolders = vi.fn();
    const onOpenSse = vi.fn();
    const props = buildProps({
      moreMenu: {
        status: {
          visible: true,
          accessBadge: {
            label: "STS",
            title: "STS credentials are active.",
            tone: "success",
            indicatorClassName: "indicator",
          },
          viewLabel: "Compact view",
          operationsCount: 2,
          onOpenOperations,
        },
        layout: {
          folders: { checked: true, onToggle: onToggleFolders },
        },
        columns: {
          summary: "1/2 visible",
          columns: [
            { id: "size", label: "Size" },
            { id: "modified", label: "Modified" },
          ],
          visibleColumnIds: new Set<BrowserColumnId>(["size"]),
          onToggleColumn: vi.fn(),
          onReset: vi.fn(),
        },
        pathActions: [pathAction],
        selectionActions: [selectionAction],
        selectionOverflow: true,
        sse: { enabled: true, active: true, onOpen: onOpenSse },
      },
    });
    render(<BrowserToolbar {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const menu = screen.getByRole("menu", { name: "More" });
    expect(within(menu).getByText("STS")).toBeInTheDocument();
    expect(within(menu).getByText("Compact view")).toBeInTheDocument();
    expect(within(menu).getByText("Selection overflow")).toBeInTheDocument();
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Folders panel" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: /^Columns/i }),
    );
    expect(screen.getByRole("menu", { name: "Columns" })).toBeInTheDocument();

    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Operations overview" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More" })).getByRole(
        "menuitemcheckbox",
        { name: "Folders panel" },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More" })).getByRole(
        "menuitem",
        { name: "Paste" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More" })).getByRole(
        "menuitem",
        { name: "Copy" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: "More" })).getByRole(
        "menuitem",
        { name: /SSE-C/i },
      ),
    );

    expect(onOpenOperations).toHaveBeenCalledOnce();
    expect(onToggleFolders).toHaveBeenCalledOnce();
    expect(props.onRunPathAction).toHaveBeenCalledWith("paste");
    expect(props.onRunSelectionAction).toHaveBeenCalledWith("copy");
    expect(onOpenSse).toHaveBeenCalledOnce();
  });
});
