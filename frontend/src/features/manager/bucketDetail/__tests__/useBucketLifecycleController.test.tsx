import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketLifecycleController } from "../useBucketLifecycleController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketLifecycle: vi.fn(),
  deleteCephAdminBucketLifecycle: vi.fn(),
  getBucketLifecycle: vi.fn(),
  getCephAdminBucketLifecycle: vi.fn(),
  putBucketLifecycle: vi.fn(),
  putCephAdminBucketLifecycle: vi.fn(),
}));

vi.mock("../../../../api/bucketDetails", () => ({
  deleteBucketLifecycle: (...args: unknown[]) =>
    apiMocks.deleteBucketLifecycle(...args),
  getBucketLifecycle: (...args: unknown[]) =>
    apiMocks.getBucketLifecycle(...args),
  putBucketLifecycle: (...args: unknown[]) =>
    apiMocks.putBucketLifecycle(...args),
}));

vi.mock("../../../../api/cephAdminBucketDetails", () => ({
  deleteCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketLifecycle(...args),
  getCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketLifecycle(...args),
  putCephAdminBucketLifecycle: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketLifecycle(...args),
}));

function renderLifecycle(
  overrides: Partial<Parameters<typeof useBucketLifecycleController>[0]> = {},
) {
  return renderHook(() =>
    useBucketLifecycleController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const existingRule = {
  ID: "expire-logs",
  Status: "Enabled",
  Filter: { Prefix: "logs/" },
  Expiration: { Days: 30 },
};

describe("useBucketLifecycleController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and saves Manager lifecycle JSON", async () => {
    apiMocks.getBucketLifecycle.mockResolvedValue({ rules: [existingRule] });
    apiMocks.putBucketLifecycle.mockImplementation(
      (_accountId: unknown, _bucketName: unknown, rules: unknown) =>
        Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle();

    await act(async () => result.current.load());

    expect(apiMocks.getBucketLifecycle).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.rules).toEqual([existingRule]);
    expect(result.current.hasRules).toBe(true);
    expect(result.current.warning).toContain("Rules already exist");
    expect(result.current.dirty).toBe(false);

    const updatedRules = [{ ...existingRule, Status: "Disabled" }];
    act(() => result.current.updateText(JSON.stringify(updatedRules)));
    expect(result.current.dirty).toBe(true);

    await act(async () => result.current.save());

    expect(apiMocks.putBucketLifecycle).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      updatedRules,
    );
    expect(result.current.rules).toEqual(updatedRules);
    expect(result.current.status).toBe("Lifecycle updated");
    expect(result.current.dirty).toBe(false);
  });

  it("rejects invalid JSON and non-object lifecycle rules", async () => {
    const { result } = renderLifecycle();

    act(() => result.current.updateText("{"));
    await act(async () => result.current.save());
    expect(result.current.error).toBe("Lifecycle rules JSON is invalid.");

    act(() => result.current.updateText("{}"));
    await act(async () => result.current.save());
    expect(result.current.error).toBe("JSON must be an array of rules.");

    act(() => result.current.updateText('["not-a-rule"]'));
    await act(async () => result.current.save());
    expect(result.current.error).toBe(
      "Each lifecycle rule must be a JSON object.",
    );
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
  });

  it("validates and saves the expiration quick-add rule through Ceph Admin", async () => {
    apiMocks.putCephAdminBucketLifecycle.mockImplementation(
      (_endpointId: unknown, _bucketName: unknown, rules: unknown) =>
        Promise.resolve({ rules }),
    );
    const { result } = renderLifecycle({ cephAdmin: true, endpointId: 7 });

    act(() => {
      result.current.updateMode("simple");
      result.current.updateExpirationDraft({ noncurrentDays: "" });
    });
    await act(async () => result.current.addExpirationExample());
    expect(result.current.error).toBe(
      "Provide current or noncurrent expiration days.",
    );
    expect(apiMocks.putCephAdminBucketLifecycle).not.toHaveBeenCalled();

    act(() =>
      result.current.updateExpirationDraft({
        noncurrentDays: "90",
        prefix: "archive/",
      }),
    );
    await act(async () => result.current.addExpirationExample());

    expect(apiMocks.putCephAdminBucketLifecycle).toHaveBeenCalledWith(
      7,
      "reports",
      [
        expect.objectContaining({
          Filter: { Prefix: "archive/" },
          NoncurrentVersionExpiration: { NoncurrentDays: 90 },
          Status: "Enabled",
        }),
      ],
    );
    expect(result.current.rules[0].ID).toMatch(/^rule-/);
    expect(result.current.mode).toBe("json");
    expect(result.current.editorVisible).toBe(true);
    expect(result.current.status).toBe("Lifecycle updated");
  });

  it("toggles and deletes the last Ceph Admin rule without reloading", async () => {
    apiMocks.getCephAdminBucketLifecycle.mockResolvedValue({
      rules: [existingRule],
    });
    apiMocks.putCephAdminBucketLifecycle.mockImplementation(
      (_endpointId: unknown, _bucketName: unknown, rules: unknown) =>
        Promise.resolve({ rules }),
    );
    apiMocks.deleteCephAdminBucketLifecycle.mockResolvedValue(undefined);
    const { result } = renderLifecycle({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.toggleRuleStatus(0));

    expect(apiMocks.putCephAdminBucketLifecycle).toHaveBeenCalledWith(
      7,
      "reports",
      [{ ...existingRule, Status: "Disabled" }],
    );
    expect(result.current.rules[0].Status).toBe("Disabled");

    await act(async () => result.current.deleteRule(0));

    expect(apiMocks.deleteCephAdminBucketLifecycle).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.rules).toEqual([]);
    expect(result.current.status).toBe("Lifecycle deleted");
    expect(apiMocks.getCephAdminBucketLifecycle).toHaveBeenCalledOnce();
  });

  it("does not access APIs without an enabled bucket context", async () => {
    const disabled = renderLifecycle({ enabled: false });
    const missingEndpoint = renderLifecycle({
      cephAdmin: true,
      endpointId: null,
    });

    await act(async () => disabled.result.current.load());
    await act(async () => disabled.result.current.save());
    await act(async () => disabled.result.current.deleteRule(0));
    await act(async () => missingEndpoint.result.current.load());
    await act(async () => missingEndpoint.result.current.save());
    await act(async () => missingEndpoint.result.current.deleteRule(0));

    expect(apiMocks.getBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.putBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.getCephAdminBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.putCephAdminBucketLifecycle).not.toHaveBeenCalled();
    expect(apiMocks.deleteCephAdminBucketLifecycle).not.toHaveBeenCalled();
  });
});
