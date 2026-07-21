import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionContext } from "../../api/executionContexts";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import { BrowserContextProvider, useBrowserContext } from "./BrowserContext";

const listExecutionContextsMock = vi.fn();

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

const CONTEXTS: ExecutionContext[] = [
  {
    kind: "connection",
    id: "conn-1",
    display_name: "Connection 1",
    capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
  },
  {
    kind: "legacy_user",
    id: "s3u-2",
    display_name: "Legacy User 2",
    capabilities: { can_manage_iam: false, sts_capable: false, admin_api_capable: false },
  },
];

function Probe() {
  const { selectedContextId } = useBrowserContext();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedContextId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/browser/next")}>Navigate without context</button>
    </>
  );
}

function renderProvider(initialEntry: string) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={
            <BrowserContextProvider>
              <Probe />
            </BrowserContextProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("BrowserContextProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    listExecutionContextsMock.mockReset();
    listExecutionContextsMock.mockResolvedValue(CONTEXTS);
  });

  it("ignores legacy localStorage keys and falls back to the first context", async () => {
    localStorage.setItem("selectedS3AccountId", "conn-legacy");
    localStorage.setItem("selectedBrowserContextId", "s3u-legacy");
    localStorage.setItem("selectedExecutionContextId", "s3u-2");

    renderProvider("/browser");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-1");
  });

  it("uses the Browser-specific preference when present", async () => {
    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");
    localStorage.setItem("selectedBrowserContextId", "conn-legacy");

    renderProvider("/browser");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("s3u-2"));
  });

  it("prefers ctx query param over the Browser-specific preference", async () => {
    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");

    renderProvider("/browser?ctx=conn-1");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedBrowserExecutionContextId")).toBe("conn-1");
  });

  it("keeps the mounted tab context when another tab changes the preference", async () => {
    const user = userEvent.setup();
    renderProvider("/browser?ctx=conn-1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));

    localStorage.setItem("selectedBrowserExecutionContextId", "s3u-2");
    await user.click(screen.getByRole("button", { name: "Navigate without context" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/browser/next?ctx=conn-1"));
    expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
  });

  it("reloads execution contexts when refresh event is emitted", async () => {
    listExecutionContextsMock
      .mockResolvedValueOnce(CONTEXTS)
      .mockResolvedValueOnce([
        ...CONTEXTS,
        {
          kind: "connection",
          id: "conn-9",
          display_name: "Connection 9",
          capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
        },
      ]);

    renderProvider("/browser");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(listExecutionContextsMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event(EXECUTION_CONTEXTS_REFRESH_EVENT));
    });

    await waitFor(() => expect(listExecutionContextsMock).toHaveBeenCalledTimes(2));
  });
});
