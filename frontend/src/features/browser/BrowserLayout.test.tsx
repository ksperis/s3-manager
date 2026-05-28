import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BrowserLayout from "./BrowserLayout";

const useBrowserContextMock = vi.fn();
let capturedLayoutProps: {
  headerTitle?: string;
  hideSidebar?: boolean;
  topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
} = {};
let capturedSelectorProps: {
  selectedContextId?: string | null;
  selectedLabel?: string;
  triggerMode?: "icon" | "icon_label";
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
    topbarControlDescriptors?: Array<{ id: string; renderControl: (mode: "icon" | "icon_label") => ReactNode }>;
    children?: ReactNode;
  }) => {
    capturedLayoutProps = props;
    return (
      <div>
        {props.topbarControlDescriptors?.map((descriptor) => (
          <div key={descriptor.id}>{descriptor.renderControl("icon_label")}</div>
        ))}
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
  useDefaultStorageEndpoint: () => ({ defaultEndpointId: null, defaultEndpointName: null }),
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
    sessionAccountName: null,
    ...overrides,
  };
}

describe("BrowserLayout", () => {
  beforeEach(() => {
    capturedLayoutProps = {};
    capturedSelectorProps = null;
    useBrowserContextMock.mockReset();
  });

  it("keeps Browser on the shared topbar shell without a sidebar", () => {
    useBrowserContextMock.mockReturnValue(buildBrowserContext());

    render(
      <MemoryRouter initialEntries={["/browser"]}>
        <BrowserLayout />
      </MemoryRouter>
    );

    expect(capturedLayoutProps.headerTitle).toBe("Browser");
    expect(capturedLayoutProps.hideSidebar).toBe(true);
    expect(capturedLayoutProps.topbarControlDescriptors?.map((descriptor) => descriptor.id)).toEqual(["account"]);
    expect(screen.getByRole("button", { name: "Browser account selector" })).toBeInTheDocument();
    expect(capturedSelectorProps).toEqual(expect.objectContaining({ selectedContextId: "ctx-1", selectedLabel: "Main account" }));
  });
});
