import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchAdminPendingRequestCounts: vi.fn(),
}));

vi.mock("../api/adminNavigation", () => ({
  fetchAdminPendingRequestCounts: mocks.fetchAdminPendingRequestCounts,
}));

import { notifyAdminPendingRequestsRefresh } from "../utils/adminPendingRequestsRefresh";
import {
  ADMIN_PENDING_REQUESTS_REFRESH_INTERVAL_MS,
  useAdminPendingRequestCounts,
} from "./useAdminPendingRequestCounts";

describe("useAdminPendingRequestCounts", () => {
  beforeEach(() => {
    mocks.fetchAdminPendingRequestCounts.mockReset();
    mocks.fetchAdminPendingRequestCounts.mockResolvedValue({
      identity_link_requests: 2,
      portal_requests: 5,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads counters and refreshes them when a decision emits an event", async () => {
    const { result } = renderHook(() => useAdminPendingRequestCounts());
    await waitFor(() => expect(result.current).toEqual({ identity_link_requests: 2, portal_requests: 5 }));
    mocks.fetchAdminPendingRequestCounts.mockResolvedValueOnce({
      identity_link_requests: 1,
      portal_requests: 4,
    });

    act(() => notifyAdminPendingRequestsRefresh());

    await waitFor(() => expect(result.current).toEqual({ identity_link_requests: 1, portal_requests: 4 }));
    expect(mocks.fetchAdminPendingRequestCounts).toHaveBeenCalledTimes(2);
  });

  it("polls every sixty seconds", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAdminPendingRequestCounts());
    await act(async () => Promise.resolve());
    expect(result.current).toEqual({ identity_link_requests: 2, portal_requests: 5 });
    mocks.fetchAdminPendingRequestCounts.mockResolvedValueOnce({
      identity_link_requests: 3,
      portal_requests: 6,
    });

    await act(async () => {
      vi.advanceTimersByTime(ADMIN_PENDING_REQUESTS_REFRESH_INTERVAL_MS);
      await Promise.resolve();
    });

    expect(result.current).toEqual({ identity_link_requests: 3, portal_requests: 6 });
    expect(mocks.fetchAdminPendingRequestCounts).toHaveBeenCalledTimes(2);
  });

  it("keeps the last successful counters when a refresh fails", async () => {
    const { result } = renderHook(() => useAdminPendingRequestCounts());
    await waitFor(() => expect(result.current).toEqual({ identity_link_requests: 2, portal_requests: 5 }));
    mocks.fetchAdminPendingRequestCounts.mockRejectedValueOnce(new Error("Unavailable"));

    act(() => notifyAdminPendingRequestsRefresh());
    await waitFor(() => expect(mocks.fetchAdminPendingRequestCounts).toHaveBeenCalledTimes(2));

    expect(result.current).toEqual({ identity_link_requests: 2, portal_requests: 5 });
  });
});
