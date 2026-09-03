/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CephAdminBucket } from "../../api/cephAdminBuckets";
import {
  loadBucketListReturnContext,
  saveBucketListReturnContext,
} from "./bucketListReturnContext";
import { useBucketOpsNavigation } from "./useBucketOpsNavigation";

const routerMocks = vi.hoisted(() => ({
  location: {
    pathname: "/storage-ops/buckets",
    search: "",
  },
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom",
  );
  return {
    ...actual,
    useLocation: () => routerMocks.location,
    useNavigate: () => routerMocks.navigate,
  };
});

const storageBucket: CephAdminBucket = {
  name: "account-1::bucket-a",
  bucket_name: "bucket-a",
  context_id: "account-1",
};

function createOptions() {
  return {
    items: [storageBucket],
    loading: false,
    mode: "storage-ops" as const,
    persistCurrentListState: vi.fn(),
    selectedEndpointId: 1,
  };
}

describe("useBucketOpsNavigation", () => {
  beforeEach(() => {
    routerMocks.location.pathname = "/storage-ops/buckets";
    routerMocks.location.search = "";
    routerMocks.navigate.mockReset();
    window.sessionStorage.clear();
  });

  it("navigates to compatible row actions", () => {
    const options = createOptions();
    const { result } = renderHook(() => useBucketOpsNavigation(options));

    act(() => result.current.navigateToBucketAction("manager", storageBucket));

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      pathname: "/manager/buckets/bucket-a",
      search: "?ctx=account-1",
    });
  });

  it("persists the list context before opening bucket configuration", () => {
    const options = createOptions();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 420,
    });
    routerMocks.location.search = "?owner=alice";
    const { result } = renderHook(() => useBucketOpsNavigation(options));

    act(() => result.current.openBucketConfiguration(storageBucket));

    expect(options.persistCurrentListState).toHaveBeenCalledOnce();
    expect(
      loadBucketListReturnContext("storage-ops", "storage-ops"),
    ).toMatchObject({
      listUrl: "/storage-ops/buckets?owner=alice",
      rowKey: "account-1::bucket-a",
      scrollY: 420,
    });
    expect(routerMocks.navigate).toHaveBeenCalledWith(
      {
        pathname: "/storage-ops/buckets/bucket-a",
        search: "?ctx=account-1",
      },
      {
        state: {
          bucketListOrigin: {
            surface: "storage-ops",
            scopeKey: "storage-ops",
            listUrl: "/storage-ops/buckets?owner=alice",
          },
        },
      },
    );
  });

  it("restores the saved scroll position and row focus", () => {
    const rowButton = document.createElement("button");
    rowButton.dataset.bucketRowKey = storageBucket.name;
    document.body.appendChild(rowButton);
    saveBucketListReturnContext(
      {
        surface: "storage-ops",
        scopeKey: "storage-ops",
        listUrl: "/storage-ops/buckets",
      },
      storageBucket.name,
      320,
    );
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    const { unmount } = renderHook(() =>
      useBucketOpsNavigation(createOptions()),
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 320, behavior: "auto" });
    expect(rowButton).toHaveFocus();

    unmount();
    requestAnimationFrame.mockRestore();
    scrollTo.mockRestore();
    rowButton.remove();
  });
});
