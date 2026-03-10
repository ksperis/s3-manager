import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BrowserPage from "./BrowserPage";

const searchBrowserBucketsMock = vi.fn();
const fetchBrowserSettingsMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    unstable_usePrompt: () => {},
  };
});

vi.mock("./BrowserContext", () => ({
  useBrowserContext: () => ({
    contexts: [],
    selectedContextId: null,
    setSelectedContextId: () => {},
    requiresContextSelection: false,
    hasContext: true,
    selectorForApi: "acc-1",
    selectedKind: null,
    sessionAccountName: null,
    accessMode: null,
    setAccessMode: () => {},
    canSwitchAccess: false,
    accessError: null,
  }),
}));

vi.mock("../../api/browser", async () => {
  const actual = await vi.importActual<typeof import("../../api/browser")>("../../api/browser");
  return {
    ...actual,
    searchBrowserBuckets: (...args: unknown[]) => searchBrowserBucketsMock(...args),
    fetchBrowserSettings: (...args: unknown[]) => fetchBrowserSettingsMock(...args),
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/browser"]}>
      <BrowserPage />
    </MemoryRouter>
  );
}

describe("BrowserPage error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchBrowserSettingsMock.mockResolvedValue({
      allow_proxy_transfers: false,
      direct_upload_parallelism: 3,
      proxy_upload_parallelism: 2,
      direct_download_parallelism: 3,
      proxy_download_parallelism: 2,
      other_operations_parallelism: 2,
      streaming_zip_threshold_mb: 200,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("shows backend detail when bucket loading fails with detail", async () => {
    searchBrowserBucketsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: "Forbidden by policy" } },
      message: "Request failed with status code 403",
    });

    renderPage();

    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
  });

  it("falls back to error.message when bucket loading fails without detail", async () => {
    searchBrowserBucketsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: {} },
      message: "Network Error",
    });

    renderPage();

    expect(await screen.findByText("Network Error")).toBeInTheDocument();
  });
});
