import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionContext } from "../../api/executionContexts";
import { fetchManagerContext } from "../../api/managerContext";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import { S3AccountProvider, useS3AccountContext } from "./S3AccountContext";

const listExecutionContextsMock = vi.fn();
const fetchManagerContextMock = vi.mocked(fetchManagerContext);

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

vi.mock("../../api/managerContext", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerContext")>("../../api/managerContext");
  return {
    ...actual,
    fetchManagerContext: vi.fn(),
  };
});

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
  const { selectedS3AccountId } = useS3AccountContext();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="selected">{selectedS3AccountId ?? "null"}</div>
      <div data-testid="location">{`${location.pathname}${location.search}`}</div>
      <button type="button" onClick={() => navigate("/manager/next")}>Navigate without context</button>
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
            <S3AccountProvider>
              <Probe />
            </S3AccountProvider>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe("S3AccountProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    listExecutionContextsMock.mockReset();
    fetchManagerContextMock.mockReset();
    listExecutionContextsMock.mockResolvedValue(CONTEXTS);
    fetchManagerContextMock.mockResolvedValue({
      access_mode: "admin",
      iam_identity: "arn:test",
      manager_stats_enabled: true,
      manager_browser_enabled: true,
    });
  });

  it("ignores legacy localStorage keys and falls back to the first context", async () => {
    localStorage.setItem("selectedS3AccountId", "conn-legacy");
    localStorage.setItem("selectedBrowserContextId", "s3u-legacy");
    localStorage.setItem("selectedExecutionContextId", "s3u-2");

    renderProvider("/manager");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedManagerExecutionContextId")).toBe("conn-1");
  });

  it("uses the Manager-specific preference when present", async () => {
    localStorage.setItem("selectedManagerExecutionContextId", "s3u-2");
    localStorage.setItem("selectedS3AccountId", "conn-legacy");

    renderProvider("/manager");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("s3u-2"));
  });

  it("prefers ctx query param over the Manager-specific preference", async () => {
    localStorage.setItem("selectedManagerExecutionContextId", "s3u-2");

    renderProvider("/manager?ctx=conn-1");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedManagerExecutionContextId")).toBe("conn-1");
  });

  it("keeps the mounted tab context when another tab changes the preference", async () => {
    const user = userEvent.setup();
    renderProvider("/manager?ctx=conn-1");
    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));

    localStorage.setItem("selectedManagerExecutionContextId", "s3u-2");
    await user.click(screen.getByRole("button", { name: "Navigate without context" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/manager/next?ctx=conn-1"));
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

    renderProvider("/manager");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(listExecutionContextsMock).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event(EXECUTION_CONTEXTS_REFRESH_EVENT));
    });

    await waitFor(() => expect(listExecutionContextsMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("selected")).toHaveTextContent("conn-1");
    expect(screen.getByTestId("location")).toHaveTextContent("/manager?ctx=conn-1");
  });
});
