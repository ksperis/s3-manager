import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserLayoutMode } from "./browserActions";
import { useBrowserPanelLayout } from "./useBrowserPanelLayout";

const rootUiMocks = vi.hoisted(() => ({
  readBrowserRootUiState: vi.fn(),
  writeBrowserRootActiveLayout: vi.fn(),
  writeBrowserRootUiLayout: vi.fn(),
}));

vi.mock("./browserRootUiState", async () => {
  const actual =
    await vi.importActual<typeof import("./browserRootUiState")>(
      "./browserRootUiState",
    );
  return {
    ...actual,
    readBrowserRootUiState: () => rootUiMocks.readBrowserRootUiState(),
    writeBrowserRootActiveLayout: (...args: unknown[]) =>
      rootUiMocks.writeBrowserRootActiveLayout(...args),
    writeBrowserRootUiLayout: (...args: unknown[]) =>
      rootUiMocks.writeBrowserRootUiLayout(...args),
  };
});

type HarnessProps = {
  allowPanels?: boolean;
  layoutMode?: BrowserLayoutMode;
};

function PanelLayoutHarness({
  allowPanels = true,
  layoutMode = "workbench",
}: HarnessProps) {
  const layout = useBrowserPanelLayout({
    allowFoldersPanel: allowPanels,
    allowInspectorPanel: allowPanels,
    canChangeLayout: true,
    initialFoldersPanelWidthPx: 280,
    initialInspectorPanelWidthPx: 320,
    initialLayoutMode: layoutMode,
    initialShowFolders: true,
    initialShowInspector: true,
    persistLayout: true,
  });
  return (
    <div
      ref={layout.layoutContainerRef}
      data-testid="layout"
      data-layout-mode={layout.activeLayoutMode}
      style={{ gridTemplateColumns: layout.layoutTemplateColumns }}
    >
      <button type="button" onClick={layout.toggleFoldersPanel}>
        Toggle folders
      </button>
      <button type="button" onClick={layout.toggleInspectorPanel}>
        Toggle inspector
      </button>
      <button type="button" onClick={() => layout.changeLayoutMode("standard")}>
        Use standard
      </button>
      {layout.isFoldersPanelVisible && (
        <div
          role="separator"
          aria-label="Resize folders panel"
          onPointerDown={layout.startPanelResize("folders")}
          onDoubleClick={layout.resetFoldersPanelWidth}
        />
      )}
      {layout.isInspectorPanelVisible && (
        <div
          role="separator"
          aria-label="Resize inspector panel"
          onPointerDown={layout.startPanelResize("inspector")}
          onDoubleClick={layout.resetInspectorPanelWidth}
        />
      )}
    </div>
  );
}

describe("useBrowserPanelLayout", () => {
  let mediaQueryMatches = false;
  let mediaQueryListeners: Set<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    rootUiMocks.readBrowserRootUiState.mockReturnValue({
      activeLayout: "workbench",
      density: "comfortable",
      layouts: {
        standard: {
          showFolders: false,
          showInspector: false,
          foldersPanelWidthPx: 240,
          inspectorPanelWidthPx: 300,
          objectColumns: [],
          objectColumnWidths: {},
        },
        workbench: {
          showFolders: true,
          showInspector: true,
          foldersPanelWidthPx: 360,
          inspectorPanelWidthPx: 400,
          objectColumns: [],
          objectColumnWidths: {},
        },
      },
      contextSelections: {},
    });
    mediaQueryMatches = false;
    mediaQueryListeners = new Set();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        get matches() {
          return mediaQueryMatches;
        },
        media: "(max-width: 1023px)",
        onchange: null,
        addEventListener: (_event: string, listener: () => void) =>
          mediaQueryListeners.add(listener),
        removeEventListener: (_event: string, listener: () => void) =>
          mediaQueryListeners.delete(listener),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("resizes a visible panel and persists it for the explicit layout mode", async () => {
    render(<PanelLayoutHarness />);
    const layout = screen.getByTestId("layout");
    vi.spyOn(layout, "getBoundingClientRect").mockReturnValue({
      bottom: 600,
      height: 600,
      left: 0,
      right: 1400,
      top: 0,
      width: 1400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() =>
      expect(layout.style.gridTemplateColumns).toBe(
        "280px minmax(0, 1fr) 320px",
      ),
    );
    rootUiMocks.writeBrowserRootUiLayout.mockClear();

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize folders panel" }),
      { clientX: 286 },
    );
    expect(document.body.style.cursor).toBe("col-resize");
    fireEvent.pointerMove(document, { clientX: 360 });
    fireEvent.pointerUp(document);

    await waitFor(() =>
      expect(layout.style.gridTemplateColumns).toBe(
        "354px minmax(0, 1fr) 320px",
      ),
    );
    expect(rootUiMocks.writeBrowserRootUiLayout).toHaveBeenLastCalledWith(
      {
        foldersPanelWidthPx: 354,
        inspectorPanelWidthPx: 320,
        showFolders: true,
        showInspector: true,
      },
      "workbench",
    );
    expect(document.body.style.cursor).toBe("");
  });

  it("hides panels for a narrow viewport and removes its media listener", async () => {
    const { unmount } = render(<PanelLayoutHarness />);
    expect(mediaQueryListeners).toHaveLength(1);
    expect(
      screen.getByRole("separator", { name: "Resize folders panel" }),
    ).toBeInTheDocument();

    mediaQueryMatches = true;
    act(() => mediaQueryListeners.forEach((listener) => listener()));

    await waitFor(() =>
      expect(
        screen.queryByRole("separator", { name: "Resize folders panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("layout").style.gridTemplateColumns).toBe(
      "minmax(0, 1fr)",
    );

    unmount();
    expect(mediaQueryListeners).toHaveLength(0);
  });

  it("owns panel visibility and restores the selected layout atomically", async () => {
    render(<PanelLayoutHarness />);
    rootUiMocks.writeBrowserRootUiLayout.mockClear();
    rootUiMocks.writeBrowserRootActiveLayout.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Toggle folders" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("separator", { name: "Resize folders panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(rootUiMocks.writeBrowserRootUiLayout).toHaveBeenCalledWith(
      {
        foldersPanelWidthPx: 280,
        inspectorPanelWidthPx: 320,
        showFolders: false,
        showInspector: true,
      },
      "workbench",
    );

    fireEvent.click(screen.getByRole("button", { name: "Use standard" }));
    await waitFor(() =>
      expect(screen.getByTestId("layout")).toHaveAttribute(
        "data-layout-mode",
        "standard",
      ),
    );
    expect(
      screen.queryByRole("separator", { name: "Resize inspector panel" }),
    ).not.toBeInTheDocument();
    expect(rootUiMocks.writeBrowserRootActiveLayout).toHaveBeenLastCalledWith(
      "standard",
    );
    expect(rootUiMocks.readBrowserRootUiState).toHaveBeenCalledOnce();
  });
});
