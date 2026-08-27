import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketPolicyController } from "../useBucketPolicyController";

const apiMocks = vi.hoisted(() => ({
  deleteBucketPolicy: vi.fn(),
  deleteCephAdminBucketPolicy: vi.fn(),
  getBucketPolicy: vi.fn(),
  getCephAdminBucketPolicy: vi.fn(),
  putBucketPolicy: vi.fn(),
  putCephAdminBucketPolicy: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  deleteBucketPolicyApi: (...args: unknown[]) =>
    apiMocks.deleteBucketPolicy(...args),
  getBucketPolicy: (...args: unknown[]) => apiMocks.getBucketPolicy(...args),
  putBucketPolicy: (...args: unknown[]) => apiMocks.putBucketPolicy(...args),
}));

vi.mock("../../../../api/cephAdmin", () => ({
  deleteCephAdminBucketPolicy: (...args: unknown[]) =>
    apiMocks.deleteCephAdminBucketPolicy(...args),
  getCephAdminBucketPolicy: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketPolicy(...args),
  putCephAdminBucketPolicy: (...args: unknown[]) =>
    apiMocks.putCephAdminBucketPolicy(...args),
}));

function renderPolicy(
  overrides: Partial<Parameters<typeof useBucketPolicyController>[0]> = {},
) {
  return renderHook(() =>
    useBucketPolicyController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

describe("useBucketPolicyController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves a Manager bucket policy", async () => {
    apiMocks.getBucketPolicy.mockResolvedValue({
      policy: { Version: "2012-10-17", Statement: [] },
    });
    apiMocks.putBucketPolicy.mockResolvedValue({
      policy: { Version: "2012-10-17", Statement: [{ Effect: "Deny" }] },
    });
    const { result } = renderPolicy();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketPolicy).toHaveBeenCalledWith("acc-1", "reports");
    expect(result.current.configured).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() =>
      result.current.setText(
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [{ Effect: "Deny" }],
        }),
      ),
    );
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.putBucketPolicy).toHaveBeenCalledWith("acc-1", "reports", {
      Version: "2012-10-17",
      Statement: [{ Effect: "Deny" }],
    });
    expect(result.current.dirty).toBe(false);
  });

  it("uses the Ceph Admin endpoint and owns deletion state", async () => {
    apiMocks.getCephAdminBucketPolicy.mockResolvedValue({
      policy: { Statement: [] },
    });
    apiMocks.deleteCephAdminBucketPolicy.mockResolvedValue(undefined);
    const { result } = renderPolicy({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    expect(apiMocks.getCephAdminBucketPolicy).toHaveBeenCalledWith(7, "reports");
    await act(async () => result.current.remove());

    expect(apiMocks.deleteCephAdminBucketPolicy).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(result.current.configured).toBe(false);
    expect(result.current.text).toBe("");
  });

  it("reports invalid JSON and provides the scoped example", async () => {
    const { result } = renderPolicy();

    act(() => result.current.setText("{"));
    await act(async () => result.current.save());
    expect(result.current.error).toBe(
      "Invalid or unsaved policy (JSON required).",
    );
    expect(apiMocks.putBucketPolicy).not.toHaveBeenCalled();

    act(() => result.current.setText(result.current.example));
    expect(result.current.text).toContain("arn:aws:s3:::reports/*");
  });
});
