import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBucketPublicAccessController } from "../useBucketPublicAccessController";

const apiMocks = vi.hoisted(() => ({
  getBucketPublicAccessBlock: vi.fn(),
  getCephAdminBucketPublicAccessBlock: vi.fn(),
  updateBucketPublicAccessBlock: vi.fn(),
  updateCephAdminBucketPublicAccessBlock: vi.fn(),
}));

vi.mock("../../../../api/buckets", () => ({
  getBucketPublicAccessBlock: (...args: unknown[]) =>
    apiMocks.getBucketPublicAccessBlock(...args),
  updateBucketPublicAccessBlock: (...args: unknown[]) =>
    apiMocks.updateBucketPublicAccessBlock(...args),
}));

vi.mock("../../../../api/cephAdminBuckets", () => ({
  getCephAdminBucketPublicAccessBlock: (...args: unknown[]) =>
    apiMocks.getCephAdminBucketPublicAccessBlock(...args),
  updateCephAdminBucketPublicAccessBlock: (...args: unknown[]) =>
    apiMocks.updateCephAdminBucketPublicAccessBlock(...args),
}));

function renderPublicAccess(
  overrides: Partial<Parameters<typeof useBucketPublicAccessController>[0]> = {},
) {
  return renderHook(() =>
    useBucketPublicAccessController({
      accountId: "acc-1",
      bucketName: "reports",
      cephAdmin: false,
      enabled: true,
      endpointId: null,
      ...overrides,
    }),
  );
}

const allEnabled = {
  block_public_acls: true,
  ignore_public_acls: true,
  block_public_policy: true,
  restrict_public_buckets: true,
};

describe("useBucketPublicAccessController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, edits, and saves Manager public access flags", async () => {
    apiMocks.getBucketPublicAccessBlock.mockResolvedValue({
      block_public_acls: true,
    });
    apiMocks.updateBucketPublicAccessBlock.mockResolvedValue(allEnabled);
    const { result } = renderPublicAccess();

    await act(async () => result.current.load());
    expect(apiMocks.getBucketPublicAccessBlock).toHaveBeenCalledWith(
      "acc-1",
      "reports",
    );
    expect(result.current.fullyEnabled).toBe(false);
    expect(result.current.partiallyEnabled).toBe(true);
    expect(result.current.dirty).toBe(false);

    act(() => {
      result.current.update("ignore_public_acls", true);
      result.current.update("block_public_policy", true);
      result.current.update("restrict_public_buckets", true);
    });
    expect(result.current.dirty).toBe(true);
    await act(async () => result.current.save());

    expect(apiMocks.updateBucketPublicAccessBlock).toHaveBeenCalledWith(
      "acc-1",
      "reports",
      allEnabled,
    );
    expect(result.current.fullyEnabled).toBe(true);
    expect(result.current.partiallyEnabled).toBe(false);
    expect(result.current.status).toBe("Public access block updated.");
    expect(result.current.dirty).toBe(false);

    act(() => result.current.update("block_public_acls", false));
    expect(result.current.status).toBeNull();
  });

  it("uses the Ceph Admin endpoint for load and save", async () => {
    apiMocks.getCephAdminBucketPublicAccessBlock.mockResolvedValue(allEnabled);
    apiMocks.updateCephAdminBucketPublicAccessBlock.mockResolvedValue(allEnabled);
    const { result } = renderPublicAccess({ cephAdmin: true, endpointId: 7 });

    await act(async () => result.current.load());
    await act(async () => result.current.save());

    expect(apiMocks.getCephAdminBucketPublicAccessBlock).toHaveBeenCalledWith(
      7,
      "reports",
    );
    expect(apiMocks.updateCephAdminBucketPublicAccessBlock).toHaveBeenCalledWith(
      7,
      "reports",
      allEnabled,
    );
  });

  it("normalizes missing API fields to false", async () => {
    apiMocks.getBucketPublicAccessBlock.mockResolvedValue({
      block_public_policy: 1,
      restrict_public_buckets: null,
    });
    const { result } = renderPublicAccess();

    await act(async () => result.current.load());

    expect(result.current.config).toEqual({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: true,
      restrict_public_buckets: false,
    });
  });

  it("does not access APIs without a bucket context", async () => {
    const { result } = renderPublicAccess({ enabled: false });

    await act(async () => result.current.load());
    await act(async () => result.current.save());

    expect(apiMocks.getBucketPublicAccessBlock).not.toHaveBeenCalled();
    expect(apiMocks.updateBucketPublicAccessBlock).not.toHaveBeenCalled();
  });
});
