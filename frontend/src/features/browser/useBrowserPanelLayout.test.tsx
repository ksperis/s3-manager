import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserPanelLayout } from "./useBrowserPanelLayout";

const writeBrowserRootUiLayout = vi.hoisted(() => vi.fn());

vi.mock("./browserRootUiState", async () => {
  const actual =
    await vi.importActual<typeof import("./browserRootUiState")>(
      "./browserRootUiState",
    );
  return { ...actual, writeBrowserRootUiLayout };
});

function PanelLayoutHarness({ allowPanels = true }: { allowPanels?: boolean }) {
  const layout = useBrowserPanelLayout({
    allowFoldersPanel: allowPanels,
    initialFoldersPanelWidthPx: 280,
    initialShowFolders: true,
    persistLayout: true,
  });
  return (
    <div
      ref={layout.layoutContainerRef}
      data-testid="layout"
      style={{ gridTemplateColumns: layout.layoutTemplateColumns }}
    >
      <button type="button" onClick={layout.toggleFoldersPanel}>
        Toggle folders
      </button>
      {layout.isFoldersPanelVisible && (
        <div
          role="separator"
          aria-label="Resize folders panel"
          onPointerDown={layout.startFoldersPanelResize}
          onDoubleClick={layout.resetFoldersPanelWidth}
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

  it("resizes and persists only the folders column", async () => {
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
      expect(layout.style.gridTemplateColumns).toBe("280px minmax(0, 1fr)"),
    );
    writeBrowserRootUiLayout.mockClear();

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize folders panel" }),
      { clientX: 286 },
    );
    fireEvent.pointerMove(document, { clientX: 360 });
    fireEvent.pointerUp(document);

    await waitFor(() =>
      expect(layout.style.gridTemplateColumns).toBe("354px minmax(0, 1fr)"),
    );
    expect(writeBrowserRootUiLayout).toHaveBeenLastCalledWith({
      foldersPanelWidthPx: 354,
      showFolders: true,
    });
    expect(document.body.style.cursor).toBe("");
  });

  it("hides the optional folders panel on a narrow viewport without erasing its preference", async () => {
    const { unmount } = render(<PanelLayoutHarness />);
    expect(mediaQueryListeners).toHaveLength(1);

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
    expect(writeBrowserRootUiLayout).toHaveBeenLastCalledWith({
      foldersPanelWidthPx: 280,
      showFolders: true,
    });

    unmount();
    expect(mediaQueryListeners).toHaveLength(0);
  });

  it("toggles folders independently", async () => {
    render(<PanelLayoutHarness />);
    writeBrowserRootUiLayout.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Toggle folders" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("separator", { name: "Resize folders panel" }),
      ).not.toBeInTheDocument(),
    );
    expect(writeBrowserRootUiLayout).toHaveBeenLastCalledWith({
      foldersPanelWidthPx: 280,
      showFolders: false,
    });
  });
});
