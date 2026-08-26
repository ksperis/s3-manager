import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserPathEditor } from "./useBrowserPathEditor";

const apiMocks = vi.hoisted(() => ({
  listBrowserObjects: vi.fn(),
}));

vi.mock("../../api/browser", async () => {
  const actual =
    await vi.importActual<typeof import("../../api/browser")>(
      "../../api/browser",
    );
  return {
    ...actual,
    listBrowserObjects: (...args: unknown[]) =>
      apiMocks.listBrowserObjects(...args),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

const response = (prefixes: string[]) => ({
  objects: [],
  prefixes,
  next_continuation_token: null,
});

describe("useBrowserPathEditor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    apiMocks.listBrowserObjects.mockResolvedValue(response([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges history, local, and debounced remote suggestions", async () => {
    apiMocks.listBrowserObjects.mockResolvedValue(
      response(["docs/remote/"]),
    );
    const history = ["docs/reports/"];
    const localPrefixes = ["docs/recent/"];
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useBrowserPathEditor({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        history,
        localPrefixes,
        onCommit,
        prefix: "docs/",
      }),
    );

    act(() => {
      result.current.startEditing();
      result.current.setValue("docs/re");
    });
    expect(result.current.suggestions.map((entry) => entry.value)).toEqual([
      "docs/reports/",
      "docs/recent/",
    ]);
    expect(result.current.suggestionsLoading).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(apiMocks.listBrowserObjects).toHaveBeenCalledWith(
      "acc-1",
      "bucket-a",
      {
        prefix: "docs/",
        query: "re",
        type: "folder",
        maxKeys: 50,
      },
    );
    expect(result.current.suggestions.map((entry) => entry.value)).toEqual([
      "docs/reports/",
      "docs/recent/",
      "docs/remote/",
    ]);
    expect(result.current.suggestionsLoading).toBe(false);
  });

  it("selects and commits suggestions from the keyboard", () => {
    const onCommit = vi.fn();
    const history: string[] = [];
    const localPrefixes = ["docs/recent/"];
    const { result } = renderHook(() =>
      useBrowserPathEditor({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        history,
        localPrefixes,
        onCommit,
        prefix: "docs/",
      }),
    );
    const preventDefault = vi.fn();

    act(() => {
      result.current.startEditing();
      result.current.setValue("docs/re");
    });
    act(() => {
      result.current.handleKeyDown({
        key: "ArrowDown",
        preventDefault,
      } as never);
    });
    expect(result.current.activeSuggestionIndex).toBe(0);

    act(() => {
      result.current.handleKeyDown({
        key: "Enter",
        preventDefault,
      } as never);
    });

    expect(onCommit).toHaveBeenCalledWith("docs/recent/");
    expect(result.current.editing).toBe(false);
    expect(result.current.suggestions).toEqual([]);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it("ignores a remote response after editing is cancelled", async () => {
    const pending = deferred<ReturnType<typeof response>>();
    apiMocks.listBrowserObjects.mockReturnValue(pending.promise);
    const history: string[] = [];
    const localPrefixes: string[] = [];
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useBrowserPathEditor({
        accountId: "acc-1",
        bucketName: "bucket-a",
        enabled: true,
        history,
        localPrefixes,
        onCommit,
        prefix: "",
      }),
    );

    act(() => {
      result.current.startEditing();
      result.current.setValue("rem");
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(apiMocks.listBrowserObjects).toHaveBeenCalledOnce();
    act(() => result.current.cancel());

    await act(async () => {
      pending.resolve(response(["remote/"]));
      await pending.promise;
    });

    expect(result.current.editing).toBe(false);
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.suggestionsLoading).toBe(false);
  });
});
