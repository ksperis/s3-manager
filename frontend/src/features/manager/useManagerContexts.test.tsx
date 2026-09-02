import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useManagerContexts } from "./useManagerContexts";

const listExecutionContextsMock = vi.fn();

vi.mock("../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

describe("useManagerContexts", () => {
  beforeEach(() => {
    listExecutionContextsMock.mockReset();
  });

  it("loads the Manager catalogue and derives labels", async () => {
    listExecutionContextsMock.mockResolvedValue([
      { id: "source", display_name: "Source account" },
      { id: "target", display_name: "Target connection" },
    ]);

    const { result } = renderHook(() => useManagerContexts());

    expect(result.current.contextsLoading).toBe(true);
    await waitFor(() => expect(result.current.contextsLoading).toBe(false));
    expect(listExecutionContextsMock).toHaveBeenCalledWith("manager");
    expect(result.current.contexts).toHaveLength(2);
    expect(Object.fromEntries(result.current.contextLabelById)).toEqual({
      source: "Source account",
      target: "Target connection",
    });
    expect(result.current.contextsError).toBeNull();
  });

  it("normalizes catalogue errors", async () => {
    listExecutionContextsMock.mockRejectedValue(new Error("Catalogue unavailable"));

    const { result } = renderHook(() => useManagerContexts());

    await waitFor(() => expect(result.current.contextsLoading).toBe(false));
    expect(result.current.contexts).toEqual([]);
    expect(result.current.contextsError).toBe("Catalogue unavailable");
  });
});
