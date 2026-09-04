import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserNavigationHistory } from "./useBrowserNavigationHistory";

describe("useBrowserNavigationHistory", () => {
  beforeEach(() => {
    window.history.replaceState(
      { source: "route" },
      "",
      "/browser?view=objects#content",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("anchors the current browser location and records subsequent navigation", async () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    const { rerender } = renderHook(
      ({ prefix }) =>
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
        }),
      { initialProps: { prefix: "" } },
    );

    await waitFor(() => expect(replaceState).toHaveBeenCalledTimes(1));
    expect(replaceState).toHaveBeenCalledWith(
      {
        source: "route",
        browserPage: true,
        bucketName: "bucket-a",
        prefix: "",
      },
      "",
      "/browser?view=objects#content",
    );

    rerender({ prefix: "folder/" });
    await waitFor(() => expect(pushState).toHaveBeenCalledTimes(1));
    expect(pushState).toHaveBeenLastCalledWith(
      {
        source: "route",
        browserPage: true,
        bucketName: "bucket-a",
        prefix: "folder/",
      },
      "",
      "/browser?view=objects#content",
    );
  });

  it("restores a popped browser location without writing it again", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    const { rerender } = renderHook(
      ({ prefix }) =>
        useBrowserNavigationHistory({
          bucketName: "bucket-a",
          prefix,
          onNavigate,
        }),
      { initialProps: { prefix: "folder/" } },
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ browserPage: true }),
    );
    pushState.mockClear();

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            browserPage: true,
            bucketName: "bucket-a",
            prefix: "",
          },
        }),
      );
    });
    expect(onNavigate).toHaveBeenCalledWith({
      bucketName: "bucket-a",
      prefix: "",
    });

    rerender({ prefix: "" });
    await act(async () => Promise.resolve());
    expect(pushState).not.toHaveBeenCalled();
  });

  it("re-anchors the current location when popped navigation is rejected", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn(() => false);
    renderHook(() =>
      useBrowserNavigationHistory({
        bucketName: "bucket-a",
        prefix: "folder/",
        onNavigate,
      }),
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ browserPage: true }),
    );
    pushState.mockClear();

    act(() => {
      window.dispatchEvent(
        new PopStateEvent("popstate", {
          state: {
            browserPage: true,
            bucketName: "bucket-a",
            prefix: "",
          },
        }),
      );
    });

    expect(onNavigate).toHaveBeenCalledWith({
      bucketName: "bucket-a",
      prefix: "",
    });
    expect(pushState).toHaveBeenCalledWith(
      {
        source: "route",
        browserPage: true,
        bucketName: "bucket-a",
        prefix: "folder/",
      },
      "",
      "/browser?view=objects#content",
    );
  });

  it("re-anchors the browser after leaving its history entries", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const onNavigate = vi.fn();
    renderHook(() =>
      useBrowserNavigationHistory({
        bucketName: "bucket-a",
        prefix: "folder/",
        onNavigate,
      }),
    );
    await waitFor(() =>
      expect(window.history.state).toMatchObject({ browserPage: true }),
    );
    pushState.mockClear();

    act(() => {
      window.history.replaceState(
        { source: "external" },
        "",
        window.location.href,
      );
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: { source: "external" } }),
      );
    });

    expect(pushState).toHaveBeenCalledWith(
      {
        source: "external",
        browserPage: true,
        bucketName: "bucket-a",
        prefix: "folder/",
      },
      "",
      "/browser?view=objects#content",
    );
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
