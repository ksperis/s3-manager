import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import { fetchAdminPendingRequestCounts } from "./adminNavigation";
import { approveAdminPortalRequest, rejectAdminPortalRequest } from "./portalRequests";
import { decideExternalLinkRequest } from "./security";
import { ADMIN_PENDING_REQUESTS_REFRESH_EVENT } from "../utils/adminPendingRequestsRefresh";

describe("admin pending request APIs", () => {
  beforeEach(() => {
    clientMock.get.mockReset();
    clientMock.post.mockReset();
  });

  it("loads the aggregate navigation counters", async () => {
    const payload = { identity_link_requests: 2, portal_requests: 5 };
    const controller = new AbortController();
    clientMock.get.mockResolvedValue({ data: payload });

    await expect(fetchAdminPendingRequestCounts(controller.signal)).resolves.toEqual(payload);
    expect(clientMock.get).toHaveBeenCalledWith(
      "/admin/navigation/pending-requests",
      { signal: controller.signal },
    );
  });

  it("requests a counter refresh after every decision attempt", async () => {
    const onRefresh = vi.fn();
    window.addEventListener(ADMIN_PENDING_REQUESTS_REFRESH_EVENT, onRefresh);
    clientMock.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(new Error("Approval failed after processing"));

    try {
      await decideExternalLinkRequest("identity-1", false);
      await rejectAdminPortalRequest(7, { message: "Rejected" });
      await expect(approveAdminPortalRequest(8)).rejects.toThrow("Approval failed after processing");

      expect(onRefresh).toHaveBeenCalledTimes(3);
    } finally {
      window.removeEventListener(ADMIN_PENDING_REQUESTS_REFRESH_EVENT, onRefresh);
    }
  });
});
