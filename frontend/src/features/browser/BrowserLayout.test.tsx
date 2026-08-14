import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS } from "../../components/topbarControlWidths";
import type { SidebarBodyRenderArgs } from "../../components/Sidebar";
import BrowserLayout, { useBrowserSidebarSlot } from "./BrowserLayout";

const useBrowserContextMock = vi.fn();
let capturedLayoutProps: {
  headerTitle?: string;
  hideSidebar?: boolean;
  renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
  topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
} = {};
let capturedSelectorProps: {
  selectedContextId?: string | null;
  selectedLabel?: string;
  triggerMode?: "icon" | "icon_label";
  widthClassName?: string;
} | null = null;

vi.mock("./BrowserContext", () => ({
  BrowserContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useBrowserContext: () => useBrowserContextMock(),
}));

vi.mock("../../api/managerContext", () => ({
  fetchManagerContext: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../../components/Layout", () => ({
  __esModule: true,
  default: (props: {
    headerTitle?: string;
    hideSidebar?: boolean;
    renderSidebarBody?: (args: SidebarBodyRenderArgs) => ReactNode;
    topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
    children?: ReactNode;
  }) => {
    capturedLayoutProps = props;
    return (
      <div>
        {props.topbarControlDescriptors?.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
        {props.renderSidebarBody?.({
          compact: false,
          variant: "desktop",
          closeMobile: vi.fn(),
        })}
        {props.children}
      </div>
    );
  },
}));

vi.mock("../../components/TopbarContextAccountSelector", () => ({
  __esModule: true,
  default: (props: {
    selectedContextId?: string | null;
    selectedLabel?: string;
    triggerMode?: "icon" | "icon_label";
  }) => {
    capturedSelectorProps = props;
    return <button type="button">Browser account selector</button>;
  },
}));

vi.mock("../shared/storageEndpointLabel", () => ({
  formatAccountLabel: (account: { display_name?: string; name?: string }) => account.display_name ?? account.name ?? "Context",
}));

function buildBrowserContext(overrides?: Record<string, unknown>) {
  return {
    contexts: [
      { id: "ctx-1", display_name: "Main account" },
      { id: "ctx-2", display_name: "Archive account" },
    ],
    selectedContextId: "ctx-1",
    setSelectedContextId: vi.fn(),
    requiresContextSelection: true,
    contextsLoaded: true,
    sessionAccountName: null,
    accessError: null,
    ...overrides,
  };
}

function BrowserSidebarSlotConsumer() {
  const { setSidebarBody } = useBrowserSidebarSlot();
  useEffect(() => {
    setSidebarBody(({ compact }) => (
      <div>{compact ? "Compact browser sidebar" : "Browser sidebar body"}</div>
    ));
    return () => {
      setSidebarBody(null);
    };
  }, [setSidebarBody]);
  return <div>Browser page content</div>;
}

describe("BrowserLayout", () => {
  beforeEach(() => {
    capturedLayoutProps = {};
    capturedSelectorProps = null;
    useBrowserContextMock.mockReset();
  });

  it("keeps Browser on the shared topbar shell with a custom sidebar slot", async () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext());

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(capturedLayoutProps.headerTitle).toBe("Browser");
    await waitFor(() => {
      expect(capturedLayoutProps.hideSidebar).toBe(false);
    });
    expect(capturedLayoutProps.renderSidebarBody).toBeDefined();
    expect(screen.getByText("Browser sidebar body")).toBeInTheDocument();
    expect(capturedLayoutProps.topbarControlDescriptors?.map((descriptor) => descriptor.id)).toEqual(["account"]);
    expect(screen.getByRole("button", { name: "Browser account selector" })).toBeInTheDocument();
    expect(capturedSelectorProps).toEqual(
      expect.objectContaining({
        selectedContextId: "ctx-1",
        selectedLabel: "Main account",
        widthClassName: TOPBAR_CONTEXT_SELECTOR_WIDTH_CLASS,
      })
    );
  });

  it("keeps a single page-level Browser heading when context selection blocks the outlet", () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext({ selectedContextId: null }));

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <Routes>
          <Route path="/browser" element={<BrowserLayout />}>
            <Route index element={<BrowserSidebarSlotConsumer />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Browser", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a private Browser connection", level: 2 })).toBeInTheDocument();
    expect(screen.queryByText("Browser page content")).not.toBeInTheDocument();
  });
});
