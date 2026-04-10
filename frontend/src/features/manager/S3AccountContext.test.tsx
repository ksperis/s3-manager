import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  return <div data-testid="selected">{selectedS3AccountId ?? "null"}</div>;
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

    renderProvider("/manager");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedExecutionContextId")).toBe("conn-1");
  });

  it("uses selectedExecutionContextId when present", async () => {
    localStorage.setItem("selectedExecutionContextId", "s3u-2");
    localStorage.setItem("selectedS3AccountId", "conn-legacy");

    renderProvider("/manager");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("s3u-2"));
  });

  it("prefers ctx query param over selectedExecutionContextId", async () => {
    localStorage.setItem("selectedExecutionContextId", "s3u-2");

    renderProvider("/manager?ctx=conn-1");

    await waitFor(() => expect(screen.getByTestId("selected")).toHaveTextContent("conn-1"));
    expect(localStorage.getItem("selectedExecutionContextId")).toBe("conn-1");
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
  });
});
