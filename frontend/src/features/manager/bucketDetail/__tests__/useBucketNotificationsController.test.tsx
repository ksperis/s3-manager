import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildNotificationExample,
  defaultNotificationTemplate,
  useBucketNotificationsController,
} from "../useBucketNotificationsController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketNotifications: vi.fn(),
  deleteCephAdminBucketNotifications: vi.fn(),
  getBucketNotifications: vi.fn(),
  getCephAdminBucketNotifications: vi.fn(),
  putBucketNotifications: vi.fn(),
  putCephAdminBucketNotifications: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketNotifications: (...args: unknown[]) =>
    apiMocks.deleteBucketNotifications(...args),
  getBucketNotifications: (...args: unknown[]) =>
    apiMocks.getBucketNotifications(...args),
  putBucketNotifications: (...args: unknown[]) =>
    apiMocks.putBucketNotifications(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketNotifications(...args),
  getCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketNotifications(...args),
  putCephAdminBucketNotifications: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketNotifications(...args),
}));

function renderNotifications(
  overrides: Partial<Parameters<typeof useBucketNotificationsController>[0]> = {},
) {
  return renderHook(() =>
    useBucketNotificationsController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketNotificationsController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and saves Manager notifications without a redundant reload", async () => {
    const initial = {
      TopicConfigurations: [{ Id: "initial", Events: ["s3:ObjectCreated:*"] }],
    };
    const updated = {
      TopicConfigurations: [{ Id: "updated", Events: ["s3:ObjectRemoved:*"] }],
    };
    apiMocks.getBucketNotifications.mockResolvedValue({ configuration: initial });
    apiMocks.putBucketNotifications.mockResolvedValue({ configuration: updated });
    const { result } = renderNotifications();

    await act(async () => result.current.load());
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateText(JSON.stringify(updated)));
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketNotifications).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      updated,
    );
    expect(apiMocks.getBucketNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("Notifications updated.");
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateText(buildNotificationExample("ACCOUNT1")));
    expect(result.current.status).toBeNull();
  });

  it("rejects JSON values that are not configuration objects", async () => {
    const { result } = renderNotifications();

    act(() => result.current.updateText("[]"));
    await act(async () => result.current.save());

    expect(result.current.error).toBe("Notifications must be valid JSON.");
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
  });

  it("clears Ceph Admin notifications without reloading them", async () => {
    apiMocks.getCephAdminBucketNotifications.mockResolvedValue({
      configuration: { TopicConfigurations: [{ Id: "initial" }] },
    });
    apiMocks.deleteCephAdminBucketNotifications.mockResolvedValue(undefined);
    const { result } = renderNotifications({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.clear());

    expect(apiMocks.deleteCephAdminBucketNotifications).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(apiMocks.getCephAdminBucketNotifications).toHaveBeenCalledTimes(1);
    expect(result.current.configured).toBe(false);
    expect(result.current.text).toBe(defaultNotificationTemplate);
    expect(result.current.status).toBe("Notifications cleared.");
  });

  it("resets locally without API access when context is unavailable", async () => {
    const { result } = renderNotifications({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());
    await act(async () => result.current.clear());

    expect(apiMocks.getBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.putBucketNotifications).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketNotifications).not.toHaveBeenCalled();
    expect(result.current.text).toBe(defaultNotificationTemplate);
  });
});
